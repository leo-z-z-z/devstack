/* 跨平台斜杠归一测试：保证 win / mac / linux 下命令与参数不被斜杠影响
 * 覆盖：unifySeparatorsFor / normalizeArgFor 三平台纯函数，以及实例化后的
 * command / args / log 分隔符随当前平台正确落地。
 * 运行：node test/path-slash.test.js（需先 npx tsc -p tsconfig.electron.json）
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-slash-'));
process.env.DEVSTACK_DATA_DIR = tmp;

const Module = require('module');
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.0.0-test' },
  ipcMain: { handle: () => {} },
  shell: { openPath: () => Promise.resolve(''), openExternal: () => Promise.resolve() },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: () => Promise.resolve(), on: () => {}, removeListener: () => {} },
  BrowserWindow: class { constructor() {} on() {} webContents = { send() {}, setWindowOpenHandler() {} }; loadURL() {} loadFile() {} isDestroyed() { return false; } }
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

const DIST = path.join(__dirname, '..', 'dist-electron', 'main');
const paths = require(path.join(DIST, 'main', 'paths.js'));
const template = require(path.join(DIST, 'main', 'template.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

(async () => {
  console.log('=== 阶段 1 · unifySeparatorsFor 三平台纯函数 ===');
  // Windows：正斜杠 → 反斜杠
  ok(paths.unifySeparatorsFor('${installDir}/bin/app.exe', true) === '${installDir}\\bin\\app.exe', 'win: / → \\');
  ok(paths.unifySeparatorsFor('C:/dev/minio/data', true) === 'C:\\dev\\minio\\data', 'win: 盘符路径 / → \\');
  ok(paths.unifySeparatorsFor('logs\\*.log', true) === 'logs\\*.log', 'win: 已是反斜杠保持不变');
  // POSIX：反斜杠 → 正斜杠
  ok(paths.unifySeparatorsFor('${installDir}\\bin\\app', false) === '${installDir}/bin/app', 'posix: \\ → /');
  ok(paths.unifySeparatorsFor('/opt/minio\\data', false) === '/opt/minio/data', 'posix: 混合斜杠归一为 /');
  ok(paths.unifySeparatorsFor('logs/*.log', false) === 'logs/*.log', 'posix: 已是正斜杠保持不变');
  // URL / scheme 不能被转坏
  const url = 'http://localhost:9001';
  ok(paths.unifySeparatorsFor(url, true) === url, 'win: http:// URL 原样保留');
  ok(paths.unifySeparatorsFor(url, false) === url, 'posix: http:// URL 原样保留');
  ok(paths.unifySeparatorsFor('file:///opt/x', true) === 'file:///opt/x', 'win: file:// URL 原样保留');

  console.log('=== 阶段 2 · normalizeArgFor 三平台参数归一 ===');
  // POSIX：参数里的 Windows 路径反斜杠 → /
  ok(paths.normalizeArgFor('/opt/minio\\data', false) === '/opt/minio/data', 'posix: 路径参数 \\ → /');
  ok(paths.normalizeArgFor('redis.windows.conf', false) === 'redis.windows.conf', 'posix: 无路径参数不变');
  // Windows：只有明确路径才转，/flag 开关保持
  ok(paths.normalizeArgFor('C:/dev/minio/data', true) === 'C:\\dev\\minio\\data', 'win: 带盘符路径 / → \\');
  ok(paths.normalizeArgFor('C:\\dev/mixed', true) === 'C:\\dev\\mixed', 'win: 混合路径统一为 \\');
  ok(paths.normalizeArgFor('/d', true) === '/d', 'win: /d 开关不被转成 \\d');
  ok(paths.normalizeArgFor('/s', true) === '/s', 'win: /s 开关保持');
  ok(paths.normalizeArgFor('--console-address', true) === '--console-address', 'win: -- 长开关保持');
  ok(paths.normalizeArgFor('-p', false) === '-p', 'posix: -p 短开关保持');
  // 参数里的 scheme 保留
  ok(paths.normalizeArgFor('http://x:9000', true) === 'http://x:9000', 'win: 参数 URL scheme 保留');

  console.log('=== 阶段 3 · 实例化后分隔符随平台落地 ===');
  // 造一个含混合斜杠的模板，验证 command / args 都按当前平台归一
  const tpl = {
    schemaVersion: 1, kind: 'service-template',
    meta: { id: 'slash-demo', name: 'Slash Demo' },
    defaults: { displayName: 'Slash Demo', installDirHint: '/opt/demo', webUrl: null },
    probe: { port: 12345 },
    actions: {
      start: { type: 'exec', command: '${installDir}\\bin\\app', args: ['-f', '${installDir}\\conf\\app.ini'], timeoutMs: 1000 },
      stop: null, restart: null
    }
  };
  const IS_WIN = process.platform === 'win32';
  const instDir = IS_WIN ? 'C:/dev/demo' : '/opt/demo';
  const inst = template.instantiate(tpl, instDir);
  const SEP = IS_WIN ? '\\' : '/';

  const wrongSep = IS_WIN ? '/' : '\\';
  const hasDrive = /^[A-Za-z]:/.test(inst.cfg.acts.start.command);
  ok(!hasDrive && !inst.cfg.acts.start.command.includes(wrongSep) || (IS_WIN && hasDrive),
    '实例化 command 不含异平台分隔符（当前平台 ' + process.platform + '）');
  ok(inst.cfg.acts.start.command === (IS_WIN ? 'C:\\dev\\demo\\bin\\app' : '/opt/demo/bin/app'),
    '实例化 command 平台正确：' + inst.cfg.acts.start.command);
  ok(inst.cfg.acts.start.args[1] === (IS_WIN ? 'C:\\dev\\demo\\conf\\app.ini' : '/opt/demo/conf/app.ini'),
    '实例化 args 路径平台正确：' + inst.cfg.acts.start.args[1]);
  ok(!('log' in inst.cfg), '实例化 cfg 不含已删除的日志字段');
  ok(inst.cfg.acts.start.args[0] === '-f', '实例化 args 开关保持原样：-f');

  console.log('============================================================');
  console.log('== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  console.log('============================================================');
  if (fail > 0) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
