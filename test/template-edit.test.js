/* 模板 JSON 直接编辑 + 保存：主进程链路自动化测试
 * 覆盖：合法落盘回读、所见即所得、语法错误不写入并定位行列、语义问题不阻断且可就地修复、
 * 路径越界 / 非 .json / 128KB 上限、原子写无 tmp 残留、IPC 通道与参数校验、旧保存 API 无退化、
 * 扫描不补种 / 仅首次运行播种（用户改名删除不被复活，修订 53）、
 * 文件名与 meta.id 解耦（修订 54，改名不再标红）。
 * 运行：node test/template-edit.test.js（需先 tsc -p tsconfig.electron.json）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-tpledit-'));
process.env.DEVSTACK_DATA_DIR = tmp;

const handlers = {};
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.0.0-test' },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: () => Promise.resolve(), on: () => {}, removeListener: () => {} },
  BrowserWindow: class {
    constructor() {}
    on() {}
    webContents = { send() {}, setWindowOpenHandler() {} };
    loadURL() {} loadFile() {} isDestroyed() { return false; }
  }
};
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

const DIST = path.join(__dirname, '..', 'dist-electron', 'main', 'main');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}
function info(msg) { console.log('     ' + msg); }

(async () => {
  const template = require(path.join(DIST, 'template.js'));
  const paths = require(path.join(DIST, 'paths.js'));
  const { registerIpc } = require(path.join(DIST, 'ipc.js'));
  registerIpc();

  template.seedPresets();
  const dir = paths.templateDir();
  const file = 'redis.json';
  const full = path.join(dir, file);
  const original = fs.readFileSync(full, 'utf8');
  const read = () => fs.readFileSync(full, 'utf8');

  /* ---------- 1. 合法保存 ---------- */
  const edited = original.replace(/"name":\s*"[^"]*"/, '"name": "编辑测试 Redis"').replace(/\n$/, '');
  const r1 = template.saveTemplateText(file, edited);
  ok(r1.ok === true && r1.warnings.length === 0, '合法 JSON 保存成功且无语义警告');
  ok(read() === edited, '磁盘内容与编辑器文本逐字一致（不自动补换行 / 不改缩进）');
  const scan1 = template.scanTemplates();
  const it1 = scan1.find(x => x.file === file);
  ok(it1 && it1.state === 'ok' && it1.raw.meta.name === '编辑测试 Redis', '重新扫描读到修改后的名称且校验通过');

  /* ---------- 2. 语法错误 ---------- */
  // 手写尾逗号：JSON.stringify 会修掉尾逗号，不能用它来造语法错误
  const syntaxBad = '{\n  "schemaVersion": 1,\n  "kind": "service-template",\n  "oops": [1, 2, ]\n}';
  const r2 = template.saveTemplateText(file, syntaxBad);
  ok(r2.ok === false && r2.code === 'syntax', 'JSON 语法错误被拒绝写入');
  ok(typeof r2.line === 'number' && r2.line >= 1 && typeof r2.column === 'number' && r2.column >= 1,
    '语法错误返回行列定位（' + r2.line + ':' + r2.column + '）');
  ok(read() === edited, '语法错误时原文件字节不变');

  /* ---------- 3. 路径边界 ---------- */
  const outside = path.join(tmp, 'evil-outside.json');
  const attempts = ['../evil-outside.json', 'presets-evil/x.json', 'redis.txt', path.join(dir, 'evil-abs.json')];
  let blocked = 0;
  for (const f of attempts) {
    const r = template.saveTemplateText(f, edited);
    if (!r.ok && r.code === 'path') blocked++;
  }
  ok(blocked === attempts.length, '4 类非法路径全部拒绝（../、同名前缀子目录、非 .json、绝对路径）');
  ok(!fs.existsSync(outside), '模板目录外未产生任何文件');
  const rr = handlers['read-template-file'](null, '../evil-outside.json');
  ok(rr.ok === false, 'read-template-file 边界异常被捕获为结构化返回（不抛出）');

  /* ---------- 4. 大小上限 ---------- */
  const huge = JSON.stringify({ padding: 'x'.repeat(130 * 1024) });
  const r3 = template.saveTemplateText(file, huge);
  ok(r3.ok === false && r3.code === 'too-large', '超过 128KB 上限被拒绝');
  ok(read() === edited, '超大文本未污染原文件');

  /* ---------- 5. 语义问题：允许保存并就地修复 ---------- */
  const semBad = JSON.parse(edited);
  semBad.schemaVersion = 2;
  const semText = JSON.stringify(semBad, null, 2);
  const r4 = template.saveTemplateText(file, semText);
  ok(r4.ok === true && r4.warnings.length > 0,
    '语法合法但语义不合法时允许保存并返回警告（' + r4.warnings.length + ' 项）');
  ok(read() === semText, '语义有问题的中间态确实写盘（否则损坏模板无法就地修复）');
  const scanBad = template.scanTemplates().find(x => x.file === file);
  ok(scanBad && scanBad.state === 'invalid' && scanBad.errors.length > 0, '扫描将该模板标红并列出错误');
  const fixedText = JSON.stringify({ ...semBad, schemaVersion: 1 }, null, 2);
  const r5 = template.saveTemplateText(file, fixedText);
  ok(r5.ok === true && r5.warnings.length === 0, '就地改回合法值后保存，警告清零');
  ok(template.scanTemplates().find(x => x.file === file).state === 'ok', '重新扫描恢复为可用模板');

  /* ---------- 6. 原子写 ---------- */
  const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  ok(leftovers.length === 0, '模板目录无 .tmp 残留（原子写临时文件已清理）');

  /* ---------- 7. IPC 通道 ---------- */
  ok(typeof handlers['save-template-file'] === 'function', 'IPC 通道 save-template-file 已注册');
  const viaIpc = await handlers['save-template-file'](null, file, edited);
  ok(viaIpc.ok === true, '经 IPC 调用保存成功');
  ok(read() === edited, 'IPC 保存结果落盘正确');
  const badArg = await handlers['save-template-file'](null, { x: 1 }, edited);
  ok(badArg.ok === false && badArg.code === 'path', 'IPC 非字符串参数被拒绝，不进入 fs');
  const viaIpcBad = await handlers['save-template-file'](null, file, '{ not json');
  ok(viaIpcBad.ok === false && viaIpcBad.code === 'syntax', 'IPC 语法错误返回结构化结果');

  /* ---------- 8. 旧保存 API 无退化 ---------- */
  const rawObj = JSON.parse(edited);
  rawObj.meta.name = '旧接口回归';
  template.saveTemplateFile(file, rawObj);
  ok(JSON.parse(read()).meta.name === '旧接口回归', 'saveTemplateFile（服务编辑器保存为模板）仍可写');
  ok(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')).length === 0, '旧 API 同样无 tmp 残留');

  /* ---------- 9. 连续保存取最后一次 ---------- */
  template.saveTemplateText(file, JSON.stringify({ ...rawObj, meta: { ...rawObj.meta, name: 'A' } }, null, 2));
  const last = JSON.stringify({ ...rawObj, meta: { ...rawObj.meta, name: 'B' } }, null, 2);
  template.saveTemplateText(file, last);
  ok(JSON.parse(read()).meta.name === 'B', '连续快速保存以最后一次写入为准（唯一 tmp 不串写）');

  /* ---------- 10. 扫描不补种 + 仅首次运行播种（修订 53） ---------- */
  ok(template.ensureTemplatesSeeded().seeded === 0, '目录已存在时启动播种为 0（不补缺失文件）');
  fs.rmSync(full);
  const scanAfterDel = template.scanTemplates();
  ok(!scanAfterDel.some(x => x.file === file), '删除预设文件后扫描不复活（redis.json 不再出现）');
  ok(scanAfterDel.length === 8, '扫描如实反映目录内容（剩 8 个文件）');
  ok(template.ensureTemplatesSeeded().seeded === 0, '预设缺失也不会在下次启动被补回');
  const mysqlFull = path.join(dir, 'mysql.json');
  fs.renameSync(mysqlFull, path.join(dir, 'my-mysql.json'));
  const scanRen = template.scanTemplates();
  ok(scanRen.some(x => x.file === 'my-mysql.json'), '改名后的文件出现在列表');
  ok(!scanRen.some(x => x.file === 'mysql.json'), '原文件名不再出现（未被补回）');
  const renamed = scanRen.find(x => x.file === 'my-mysql.json');
  ok(renamed && renamed.state === 'ok' && renamed.id === 'mysql',
    '修订 54：改名后 meta.id 不变（mysql），模板仍有效不再标红（文件名仅是存储名）');
  fs.rmSync(dir, { recursive: true, force: true });
  ok(template.ensureTemplatesSeeded().seeded === 9, '目录不存在时首次播种 9 个模板（恢复路径：删文件夹重启）');
  ok(template.scanTemplates().length === 9 && template.scanTemplates().every(x => x.state === 'ok'),
    '首跑播种后扫描 9 个全部可用');

  console.log('\n== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  info('隔离数据目录 ' + dir);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exitCode = fail ? 1 : 0;
})().catch(e => {
  console.error('测试异常：' + (e && e.stack || e));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exitCode = 1;
});
