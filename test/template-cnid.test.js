/* 修订 49 · 中文/大写/空格模板 id 全链路测试（放开 ID_RE 后的关键回归）
 * 覆盖：中文 id 落盘无警告、扫描识别 ok、实例化服务 id 解耦且通过 config 校验、
 * template 引用保留中文 id、路径分隔符与保留设备名被拒。
 * 运行：node test/template-cnid.test.js（需先 tsc -p tsconfig.electron.json）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-cnid-'));
process.env.DEVSTACK_DATA_DIR = tmp;
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.0.0-test' },
  ipcMain: { handle: () => {} }, shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: () => Promise.resolve(), on: () => {}, removeListener: () => {} },
  BrowserWindow: class { constructor() {} on() {} webContents = { send() {}, setWindowOpenHandler() {} }; loadURL() {} loadFile() {} isDestroyed() { return false; } }
};
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) { if (request === 'electron') return electronStub; return origLoad.apply(this, arguments); };
const DIST = path.join(__dirname, '..', 'dist-electron', 'main', 'main');
const template = require(path.join(DIST, 'template.js'));
const paths = require(path.join(DIST, 'paths.js'));
const config = require(path.join(DIST, 'config.js'));
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } }

(async () => {
  template.seedPresets();
  const dir = paths.templateDir();
  // 1. 中文+大写+空格 id 的合法模板能落盘且无语义警告
  const cn = {
    schemaVersion: 1, kind: 'service-template',
    meta: { id: 'Kibana 服务', name: 'Kibana 服务' },
    defaults: { displayName: 'Kibana 服务', installDirHint: 'C:/dev/kibana', webUrl: null },
    probe: { port: 5601 },
    actions: { start: { type: 'exec', command: 'bin/kibana.bat', args: [], timeoutMs: 15000 }, stop: null, restart: null }
  };
  const file = 'Kibana 服务.json';
  const r = template.saveTemplateText(file, JSON.stringify(cn, null, 2) + '\n');
  ok(r.ok === true && r.warnings.length === 0, '中文/大写/空格 id 模板保存成功且无语义警告 ' + JSON.stringify(r.warnings));

  // 2. 扫描识别为 ok
  const scan = template.scanTemplates();
  const item = scan.find(x => x.id === 'Kibana 服务');
  ok(!!item && item.state === 'ok', '中文 id 模板被扫描识别为 ok');

  // 3. 实例化：服务 id 合法（svc-），能被 config.validateService 接受
  const svc = template.instantiate(item.raw, 'C:/dev/kibana');
  ok(/^[a-z0-9][a-z0-9-]{0,63}$/.test(svc.id), '实例化服务 id 合法且与模板 id 解耦：' + svc.id);
  ok(svc.template === 'Kibana 服务', 'template 引用仍为中文 id');
  const errs = [];
  config.validateService(svc, 0, errs);
  ok(errs.length === 0, '实例化服务通过 config 校验：' + JSON.stringify(errs));

  // 4. 非法 id（含路径分隔符）落盘时给出校验警告
  const bad = JSON.parse(JSON.stringify(cn));
  bad.meta.id = '../evil';
  const rb = template.saveTemplateText('evil.json', JSON.stringify(bad));
  ok(rb.ok === true && rb.warnings.some(w => w.includes('meta.id')), '含路径分隔符的 id 触发 meta.id 校验警告');

  // 5. 保留设备名被拒
  const reserved = JSON.parse(JSON.stringify(cn));
  reserved.meta.id = 'CON';
  const rr = template.saveTemplateText('CON.json', JSON.stringify(reserved));
  ok(rr.warnings.some(w => w.includes('meta.id')), '保留设备名 CON 被拒');

  console.log('\n== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
