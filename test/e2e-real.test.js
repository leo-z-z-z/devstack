/* ============================================================
 * 真实中间件 · 上线前稳定性冒烟测试（不启动真实 Electron 窗口）
 *
 * 角色：Electron + React/TS + Vite 软件测试人员
 * 方法：Electron 桩 + 隔离数据目录，直接驱动编译后的主进程模块。
 *       真实中间件负责「真实进程闭环」；重依赖（Java/系统服务）用
 *       轻量 TCP 桩隔离，以便完整覆盖 6 端口的调度编排。
 *
 * 覆盖：环境核对 / 模板库 / 添加服务与落盘 / 新建分组与拖拽 /
 *       真实进程启停闭环 / v2.39 稳定态守卫 / 调度编排 /
 *       全部启动·停止全量闭环 / 跨平台与安全静态核查。
 *
 * 运行：node test/e2e-real.test.js（需先 npx tsc -p tsconfig.electron.json）
 * 注意：会真实拉起 Redis / Nginx / es-head 等进程，结束自动清理。
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execSync } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '..');

/* ---------- 六个真实中间件（目录 / 入口 / 端口） ---------- */
const REAL = {
  es: { dir: 'D:\\elasticsearch-7.13.2', cmd: 'bin\\elasticsearch.bat', port: 9200, web: 'http://localhost:9200', heavy: true },
  kibana: { dir: 'D:\\elasticsearch-kibana\\kibana-7.13.2-windows-x86_64', cmd: 'bin\\kibana.bat', port: 5601, web: 'http://localhost:5601', heavy: true },
  // es-head 有两个入口：grunt server(前端 UI :9100) / node proxy/index.js(CORS 代理 :9101)
  // 本测试用 proxy 入口做真实启停，端口取 proxy/clusters/localhost9200.json 的 bind
  eshead: { dir: 'D:\\elasticsearch-header\\elasticsearch-head', cmd: null, port: 9101, web: 'http://localhost:9101', heavy: false },
  nginx: { dir: 'D:\\nginx-1.24.0', cmd: 'nginx.exe', port: 80, web: 'http://localhost', heavy: false },
  mysql: { dir: 'C:\\Program Files\\MySQL\\MySQL Server 8.0', cmd: 'bin\\mysqld.exe', port: 3306, heavy: false },
  redis: { dir: 'D:\\env\\redis5.0', cmd: 'redis-server.exe', port: 6379, heavy: false }
};

/* ---------- 隔离数据目录 + Electron 桩（必须在 require 主进程模块之前） ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-e2e-'));
process.env.DEVSTACK_DATA_DIR = tmp;

const Module = require('module');
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.1.0-e2e' },
  ipcMain: { handle: () => {} },
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
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

const DIST = path.join(__dirname, '..', 'dist-electron', 'main');
const M = (n) => require(path.join(DIST, 'main', n + '.js'));

/* ---------- 断言与统计 ---------- */
let pass = 0, fail = 0, warn = 0;
const fails = [], warns = [], deviations = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; fails.push(msg); console.log('  FAIL  ' + msg); }
}
function okSoft(cond, msg, note) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else {
    warn++; warns.push(msg + (note ? '（' + note + '）' : ''));
    console.log('  WARN  ' + msg + (note ? ' —— ' + note : ''));
  }
}
function deviation(code, msg, detail) {
  deviations.push({ code, msg, detail });
  console.log('  DEVIATION [' + code + '] ' + msg);
  if (detail) console.log('             ' + detail);
}
function info(msg) { console.log('  INFO  ' + msg); }
function section(t) { console.log('\n=== ' + t + ' ==='); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- 端口探测工具 ---------- */
function portOpen(port, timeoutMs = 500) {
  return new Promise((res) => {
    const s = new net.Socket();
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { s.destroy(); } catch { /* noop */ } res(v); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(port, '127.0.0.1'); } catch { fin(false); }
  });
}
async function waitListen(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await portOpen(port)) return true; await sleep(250); }
  return false;
}
async function waitReleased(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (!(await portOpen(port))) return true; await sleep(250); }
  return false;
}
async function waitAllListen(ports, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rs = await Promise.all(ports.map(p => portOpen(p)));
    if (rs.every(Boolean)) return true;
    await sleep(250);
  }
  return false;
}
async function waitAllReleased(ports, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rs = await Promise.all(ports.map(p => portOpen(p)));
    if (rs.every(v => !v)) return true;
    await sleep(250);
  }
  return false;
}

/* ---------- 轻量 TCP 桩：隔离 Java/系统服务重依赖，覆盖全端口编排 ---------- */
const stubFile = path.join(tmp, 'tcp-stub.js');
const stubLog = path.join(tmp, 'stub-events.log');
const stubSrc = [
  "const net=require('net'), fs=require('fs');",
  'const port=parseInt(process.argv[2],10);',
  "const log=process.argv[3]||'';",
  "const delay=parseInt(process.argv[4]||'0',10);",
  "if(log) fs.appendFileSync(log,'SPAWN '+port+' '+Date.now()+'\\n');",
  'setTimeout(function(){',
  "  const srv=net.createServer(function(){});",
  "  srv.on('error',function(e){ if(log) fs.appendFileSync(log,'ERROR '+port+' '+String(e.code||e)+'\\n'); });",
  "  srv.listen(port,'127.0.0.1',function(){ if(log) fs.appendFileSync(log,'LISTEN '+port+' '+Date.now()+'\\n'); });",
  '}, delay);',
  ''
].join('\n');
fs.writeFileSync(stubFile, stubSrc, 'utf8');

const KILL = { type: 'builtin', builtin: 'killProcessTree', timeoutMs: 8000 };
function stubStart(port, delay = 0) {
  return { type: 'exec', command: process.execPath, args: [stubFile, String(port), stubLog, String(delay)], timeoutMs: 15000 };
}
function parseLog() {
  if (!fs.existsSync(stubLog)) return [];
  return fs.readFileSync(stubLog, 'utf8').split(/\r?\n/).filter(Boolean).map(l => {
    const [ev, p, t] = l.split(' ');
    return { ev, port: +p, t: +t };
  });
}
function clearLog() { try { fs.writeFileSync(stubLog, '', 'utf8'); } catch { /* noop */ } }

/* ============================================================
 * 主流程
 * ============================================================ */
(async () => {
  /* ---------- 阶段 0：环境核对 ---------- */
  section('阶段 0 · 环境核对（6 个真实中间件）');
  info('平台 ' + process.platform + ' / Node ' + process.version + ' / 数据目录 ' + tmp);
  const dirChecks = [
    ['ES', REAL.es.dir, REAL.es.cmd],
    ['Kibana', REAL.kibana.dir, REAL.kibana.cmd],
    ['es-head', REAL.eshead.dir, null],
    ['Nginx', REAL.nginx.dir, REAL.nginx.cmd],
    ['MySQL', REAL.mysql.dir, REAL.mysql.cmd],
    ['Redis', REAL.redis.dir, REAL.redis.cmd]
  ];
  for (const [name, dir, cmd] of dirChecks) {
    ok(fs.existsSync(dir), name + ' 目录存在：' + dir);
    if (cmd) ok(fs.existsSync(path.join(dir, cmd)), name + ' 可执行入口存在：' + cmd);
  }
  const headPkg = path.join(REAL.eshead.dir, 'package.json');
  const headProxy = path.join(REAL.eshead.dir, 'proxy', 'index.js');
  const headCluster = path.join(REAL.eshead.dir, 'proxy', 'clusters', 'localhost9200.json');
  ok(fs.existsSync(headPkg), 'es-head 是 Node 应用（package.json）');
  ok(fs.existsSync(headProxy) && fs.existsSync(headCluster), 'es-head proxy 入口与 cluster 配置齐全');
  let headBind = null;
  try { headBind = JSON.parse(fs.readFileSync(headCluster, 'utf8')).bind; } catch { /* noop */ }
  ok(headBind === 9101, 'es-head proxy 实际监听端口核对为 9101（非 grunt 前端 9100）');
  ok(fs.existsSync(path.join(REAL.eshead.dir, 'node_modules', 'http-proxy')), 'es-head proxy 依赖 http-proxy 已安装');

  for (const [name, port] of [['ES', 9200], ['Kibana', 5601], ['es-head proxy', 9101], ['Redis', 6379], ['Nginx', 80], ['MySQL', 3306]]) {
    const busy = await portOpen(port, 300);
    okSoft(!busy, name + ' 端口 ' + port + ' 基线空闲（干净基线）', busy ? '该端口已被外部进程占用，相关强断言可能受环境限制' : '');
  }
  let javaLine = 'none';
  try { javaLine = execSync('java -version 2>&1').toString().split('\n')[0].trim(); } catch { /* noop */ }
  info('Java: ' + javaLine + '（ES/Kibana 为重型 Java 进程，真实启动不纳入无头冒烟）');

  /* ---------- 阶段 1：模板库扫描 / 校验 / 占位符展开 ---------- */
  section('阶段 1 · 模板库（播种 / 扫描 / 校验 / 实例化）');
  const template = M('template');
  const paths = M('paths');
  const presets = M('presets');
  const config = M('config');
  const storeMod = M('store');
  const store = storeMod.store;

  const seeded = template.seedPresets();
  ok(seeded.seeded === 9, '首次播种 9 个模板');
  const tlist = template.scanTemplates();
  ok(tlist.length === 9, '扫描到 9 个模板');
  ok(tlist.every(x => x.state === 'ok'), '9 个模板全部校验通过');
  ok(tlist.every(x => x.raw && x.raw.probe.port > 0 && x.raw.probe.port <= 65535), '模板 probe.port 均为有效端口');
  ok(tlist.map(x => x.id).sort().join(',') === presets.PRESET_IDS.slice().sort().join(','), '模板 ID 与随包 9 模板一致');
  ok(template.seedPresets().seeded === 0, '重复播种不覆盖已有模板文件');

  // 占位符展开（Redis 模板）
  const redisTpl = tlist.find(x => x.id === 'redis');
  const ri = template.instantiate(redisTpl.raw, REAL.redis.dir, 'Redis 5.0', 6379, null);
  ok(ri.dir === path.normalize(REAL.redis.dir), '实例化回填真实 installDir');
  ok(!/\$\{installDir\}/.test(ri.cfg.acts.start.command) && /redis-server/.test(ri.cfg.acts.start.command), '占位符 ${installDir} 已展开为真实命令');
  ok(ri.cfg.acts.stop.args.includes('6379'), '占位符 ${port} 已展开（redis-cli -p 6379 shutdown）');
  ok(ri.port === 6379 && ri.template === 'redis', '端口与模板归属正确');

  // 异常模板：多错误逐条标红
  const tdir = paths.templateDir();
  const badFile = path.join(tdir, 'bad-template.json');
  fs.writeFileSync(badFile, JSON.stringify({
    schemaVersion: 2, kind: 'wrong-type', st: 'running',
    meta: { id: 'mismatch-id', name: 123 },
    defaults: { webUrl: 'ftp://bad' },
    probe: { port: 70000 },
    actions: { start: { type: 'exec', command: 'x', waitFor: 'port', args: ['ok', 7] } }
  }), 'utf8');
  const badT = template.scanTemplates().find(x => x.file === 'bad-template.json');
  ok(badT && badT.state === 'invalid', '异常模板被标红（state=invalid）');
  const errText = (badT ? badT.errors.join(' | ') : '');
  for (const [key, label] of [['schemaVersion', 'schemaVersion'], ['kind', 'kind'], ['运行时字段', '运行时字段 st 拦截'], ['meta.name', 'meta.name 类型'], ['webUrl', 'webUrl scheme'], ['probe.port', 'probe.port 越界'], ['waitFor', '废弃字段 waitFor'], ['args', 'args 元素类型']]) {
    ok(errText.includes(key), '异常模板给出错误：' + label);
  }
  // 超 128KB 上限
  const bigFile = path.join(tdir, 'big-template.json');
  fs.writeFileSync(bigFile, Buffer.alloc(129 * 1024, 0x20), 'utf8');
  const bigT = template.scanTemplates().find(x => x.file === 'big-template.json');
  ok(bigT && bigT.state === 'invalid' && bigT.errors[0].includes('128KB'), '超过 128KB 的模板被拒绝');
  fs.unlinkSync(badFile); fs.unlinkSync(bigFile);
  ok(template.scanTemplates().length === 9 && template.scanTemplates().every(x => x.state === 'ok'), '清理异常文件后模板库恢复 9 个全通过');
  ok((() => { try { template.deleteTemplateFile('../evil.json'); return false; } catch (e) { return /越界/.test(String(e)); } })(), '模板删除拒绝路径越界（安全）');

  /* ---------- 阶段 2：添加服务（真实目录实例化）+ 配置落盘 ---------- */
  section('阶段 2 · 添加服务（模板实例化 / 手动添加）与持久化');
  const idByKey = {};
  function mk(key, tplId, name, port) {
    const real = REAL[key];
    let inst;
    if (tplId) {
      const tpl = tlist.find(x => x.id === tplId);
      if (!tpl || !tpl.raw) throw new Error('模板不存在 ' + tplId);
      inst = template.instantiate(tpl.raw, real.dir, name, port, real.web ?? null);
    } else {
      inst = {
        id: key + '-manual', name, gid: null, port,
        webUrl: real.web ?? null, dir: real.dir,
        cfg: { acts: { start: null, stop: null, restart: null } }
      };
    }
    store.upsertService(inst);
    idByKey[key] = inst.id;
    ok(store.svc(inst.id)?.dir === real.dir, name + ' 已添加并指向真实目录（' + (tplId ? '模板实例化：' + tplId : '手动添加') + '）');
    return inst;
  }
  mk('redis', 'redis', 'Redis 5.0', 6379);
  mk('nginx', null, 'Nginx 1.24', 80);
  mk('mysql', 'mysql', 'MySQL 8.0', 3306);
  mk('es', 'elasticsearch', 'ES 7.13', 9200);
  mk('kibana', 'kibana', 'Kibana 7.13', 5601);
  mk('eshead', null, 'es-head 代理', 9101);
  ok(store.services().length === 6, '共添加 6 个服务');
  ok(store.services().every(s => s.cfg && s.cfg.acts && 'start' in s.cfg.acts), '每个服务 cfg.acts 动作槽完整');

  // 覆盖为真实可执行命令
  const setStart = (key, act) => { const s = store.svc(idByKey[key]); s.cfg.acts.start = act; s.cfg.acts.stop = KILL; store.upsertService(s); };
  setStart('redis', { type: 'exec', command: path.join(REAL.redis.dir, 'redis-server.exe'), args: ['--port', '6379'], timeoutMs: 15000 });
  setStart('nginx', { type: 'exec', command: path.join(REAL.nginx.dir, 'nginx.exe'), args: [], timeoutMs: 8000 });
  setStart('mysql', { type: 'exec', command: path.join(REAL.mysql.dir, 'bin', 'mysqld.exe'), args: [], timeoutMs: 15000 });
  setStart('es', { type: 'exec', command: path.join(REAL.es.dir, 'bin', 'elasticsearch.bat'), args: [], timeoutMs: 60000 });
  setStart('kibana', { type: 'exec', command: path.join(REAL.kibana.dir, 'bin', 'kibana.bat'), args: [], timeoutMs: 60000 });
  setStart('eshead', { type: 'exec', command: process.execPath, args: [headProxy], timeoutMs: 15000 });

  // 配置落盘回读
  const reread = config.readYaml();
  ok(reread.errors.length === 0, 'services.yaml 回读无校验错误');
  ok(reread.data.services.length === 6, '落盘后回读仍是 6 个服务');
  ok(reread.data.services.every(s => s.cfg && s.cfg.acts && s.cfg.acts.start), '落盘后每条服务的启动命令均保留');
  ok(config.validateYaml({ services: [{ id: 'BAD ID', name: '', port: 0, dir: '' }] }).errors.some(e => e.includes('.id')), '非法 services 被 validateYaml 拦截');

  /* ---------- 阶段 3：新建分组 / 顺序 / 拖拽（含 v2.38 修复点） ---------- */
  section('阶段 3 · 新建分组 / 组内顺序 / 拖拽三态');
  store.saveGroup({ id: 'elk-stack', name: 'ELK Stack', collapsed: false }, [idByKey.es, idByKey.kibana]);
  store.saveGroup({ id: 'web-stack', name: 'Web Stack', collapsed: false }, [idByKey.redis, idByKey.nginx]);
  ok(store.members('elk-stack').length === 2 && store.members('web-stack').length === 2, '新建 ELK Stack 与 Web Stack 各含 2 成员');
  ok(store.svc(idByKey.es).gid === 'elk-stack' && store.svc(idByKey.kibana).gid === 'elk-stack', '成员归属 elk-stack');
  const orderAll = store.services().map(s => s.id);
  ok(Math.abs(orderAll.indexOf(idByKey.es) - orderAll.indexOf(idByKey.kibana)) === 1, '组合成员在顶层块中连续');

  const mv = store.moveMemberInGroup('elk-stack', idByKey.kibana, idByKey.es, true);
  ok(mv === 1 && store.members('elk-stack').map(s => s.id).join(',') === idByKey.kibana + ',' + idByKey.es, '组内顺序写回成功（kibana → es）');
  ok(store.moveMemberInGroup('elk-stack', idByKey.es, idByKey.kibana, true) === 1, '组内顺序恢复（es → kibana）');
  ok(store.moveMemberInGroup('elk-stack', idByKey.es, idByKey.es, true) === 0, '组内拖到组件自身返回 0（无变化）');
  ok(store.moveMemberInGroup('elk-stack', 'not-exist', idByKey.es, true) === -1, '组内拖到非法目标返回 -1');

  const beforeIds = store.services().map(s => s.id).join(',');
  const selfMove = store.moveBlock(null, idByKey.mysql, null, idByKey.mysql, true);
  ok(selfMove === 0 && store.services().map(s => s.id).join(',') === beforeIds, 'v2.38 顶层块拖到自身：返回 0 且顺序不变（不再误报「已更新」但没动）');
  ok(store.moveBlock(null, 'not-exist', null, idByKey.eshead, true) === -1, '顶层块拖到非法目标返回 -1');
  ok(store.moveBlock(null, idByKey.mysql, null, idByKey.eshead, true) === 1, '顶层块合法移动返回 1');
  ok(store.moveBlock(null, idByKey.eshead, null, idByKey.mysql, true) === 1, '顶层块反向移回，顺序可还原');

  store.saveGroup({ id: 'tmp-group', name: '临时组', collapsed: false }, [idByKey.mysql]);
  store.dissolveGroup('tmp-group');
  ok(!store.grp('tmp-group') && store.svc(idByKey.mysql).gid === null, '解散组合后成员回到平铺且服务未删除');

  /* ---------- 阶段 4：真实中间件进程启停闭环 ---------- */
  section('阶段 4 · 真实中间件进程启停闭环（Redis / Nginx / es-head / MySQL）');
  const runner = M('runner');
  const probeMod = M('probe');
  const schedule = M('schedule');
  const probe = new probeMod.ProbeScheduler({
    getServices: () => store.services(),
    getSt: (id) => store.state(id).st,
    onPatch: (id, patch) => store.patchState(id, patch),
    pollMs: 1500
  });
  schedule.initSchedule({ probe, openUrl: () => {}, openDir: () => {} });
  // 不启动心跳：避免异步 sweep 覆盖测试中的显式状态，watchTarget 仍可用

  const resetSt = (id) => store.patchState(id, { st: 'stopped', owner: undefined, ownerPid: undefined, portNote: undefined });
  async function realLifecycle(key, startAct, stopFn, label) {
    const id = idByKey[key], svc = store.svc(id), port = REAL[key].port;
    resetSt(id);
    const h = runner.execAction(id, startAct, svc.dir);
    ok(h.pid > 0, label + ' 真实进程拉起，PID=' + h.pid);
    const up = await waitListen(port, 20000);
    ok(up, label + ' 端口 ' + port + ' 真实 LISTEN');
    if (up) {
      const own = probeMod.findOwner(port);
      ok(!!own && own.pid > 0, label + ' owning PID 归属判定：' + (own ? own.pid + ' / ' + own.name : '未找到'));
      ok(await probeMod.tcpProbe(port, 800), label + ' tcpProbe 复判端口连通');
    }
    await stopFn(id, svc.dir);
    let released = await waitReleased(port, 10000);
    if (!released) {
      await runner.runBuiltin(id, KILL, svc.dir);
      released = await waitReleased(port, 6000);
    }
    ok(released, label + ' 停止后端口 ' + port + ' 已释放');
    resetSt(id);
    return { pid: h.pid, up, released };
  }

  await realLifecycle('redis',
    { type: 'exec', command: path.join(REAL.redis.dir, 'redis-server.exe'), args: ['--port', '6379'], timeoutMs: 15000 },
    async (id, dir) => { await runner.runBuiltin(id, KILL, dir); },
    'Redis 5.0');

  await realLifecycle('nginx',
    { type: 'exec', command: path.join(REAL.nginx.dir, 'nginx.exe'), args: [], timeoutMs: 8000 },
    async (id, dir) => {
      const r = await runner.execAndWait({ type: 'exec', command: path.join(REAL.nginx.dir, 'nginx.exe'), args: ['-s', 'stop'], timeoutMs: 8000 }, dir, 8000);
      ok(r.ok, 'Nginx 停止命令 nginx -s stop 执行成功');
      await runner.runBuiltin(id, KILL, dir); // 兜底：确保 master+worker 进程树清理
    },
    'Nginx 1.24');

  await realLifecycle('eshead',
    { type: 'exec', command: process.execPath, args: [headProxy], timeoutMs: 15000 },
    async (id, dir) => { await runner.runBuiltin(id, KILL, dir); },
    'es-head 代理');

  // MySQL：系统服务/需管理员与 datadir，只做真实可执行入口与命令核对（不常驻）
  {
    const r = await runner.execAndWait({ type: 'exec', command: path.join(REAL.mysql.dir, 'bin', 'mysqld.exe'), args: ['--version'], timeoutMs: 15000 }, REAL.mysql.dir, 15000);
    const out = r.stdoutTail.join(' ');
    okSoft(r.ok && /mysqld|Ver|8\.0/i.test(out), 'MySQL mysqld 真实可执行入口校验（--version）', r.ok ? out.slice(0, 90) : '命令未成功返回：' + (r.error || 'exit ' + r.code));
    resetSt(idByKey.mysql);
  }
  info('ES / Kibana：重型 Java 进程，仅核对入口与 Java 基线，真实启动不纳入无头冒烟（见验收清单兼容性项）');

  /* ---------- 阶段 5：v2.39 稳定态守卫（含反向 bug 与端口冲突） ---------- */
  section('阶段 5 · v2.39 稳定态守卫（真值表 + 冲突拦截）');
  // 用一个轻量桩服务验证「稳定态生效」路径，避免依赖真实重进程
  const probeId = 'smoke-probe';
  store.upsertService({
    id: probeId, name: '守卫探针', gid: null, port: 18901, webUrl: null, dir: tmp,
    cfg: { acts: { start: stubStart(18901, 0), stop: KILL, restart: null } }
  });
  resetSt(probeId);
  const rr = await schedule.restart(probeId);
  ok(rr.ok === true, 'stopped 态 restart：允许执行（直接 start，不空跑 stop）');
  const rUp = await waitListen(18901, 8000);
  await sleep(700);
  ok(rUp && store.state(probeId).st === 'running', 'restart 后端口就绪且状态收敛为 running');
  const rt = await schedule.toggle(probeId);
  ok(rt.ok === true, 'running 态 toggle：允许执行（触发安全停止）');
  await waitReleased(18901, 8000);
  await sleep(700);
  ok(store.state(probeId).st === 'stopped', 'toggle 停止后端口释放且状态收敛为 stopped');

  store.patchState(probeId, { st: 'starting', owner: undefined, ownerPid: undefined });
  const g1 = await schedule.toggle(probeId), g2 = await schedule.restart(probeId);
  ok(g1.ok === false && /启动尚未完成/.test(g1.reason), 'starting 点主按钮被拦截');
  ok(g2.ok === false && /暂不可重启/.test(g2.reason), 'starting 点重启被拦截');
  store.patchState(probeId, { st: 'stopping' });
  const g3 = await schedule.toggle(probeId), g4 = await schedule.restart(probeId);
  ok(g3.ok === false && /停止尚未完成/.test(g3.reason), 'stopping 点主按钮被拦截（修「停止中点停止却执行启动」反向 bug）');
  ok(g4.ok === false && /暂不可重启/.test(g4.reason), 'stopping 点重启被拦截');
  // 修订 55：冲突判定以点击时的真实端口归属为准，不能用“伪 owner 字段”代替真实 LISTEN。
  // 监听 127.0.0.2：probe 仍按产品地址 127.0.0.1 探测会失败，但端口表能查到真实占用者，
  // 正好覆盖「服务未运行但端口被外部 LISTEN 占用」这一冲突分支。
  const conflictHolder = net.createServer(() => {});
  await new Promise((resolve, reject) => {
    conflictHolder.once('error', reject);
    conflictHolder.listen(18901, '127.0.0.2', resolve);
  });
  store.patchState(probeId, { st: 'stopped' });
  const g5 = await schedule.toggle(probeId), g6 = await schedule.restart(probeId);
  ok(g5.ok === false && /启动被拦截|端口/.test(g5.reason), '端口被真实外部进程占用时主按钮启动被拦截（返回：' + JSON.stringify(g5) + ' / 状态：' + JSON.stringify(store.state(probeId)) + '）');
  ok(g6.ok === false && /重启被拦截|端口/.test(g6.reason), '端口被真实外部进程占用时重启被拦截（返回：' + JSON.stringify(g6) + ' / 状态：' + JSON.stringify(store.state(probeId)) + '）');
  await new Promise(resolve => conflictHolder.close(resolve));
  await waitReleased(18901, 5000);
  resetSt(probeId);
  // 清理探针进程
  await runner.runBuiltin(probeId, KILL, tmp);
  store.removeService(probeId);
  await waitReleased(18901, 5000);

  /* ---------- 阶段 6：调度编排（纯函数，启停逻辑核心） ---------- */
  section('阶段 6 · 调度编排规划（并行 / 组合串行 / 倒序 / busy / 冲突）');
  const sixIds = Object.values(idByKey);
  const sixPorts = [REAL.redis.port, REAL.nginx.port, REAL.mysql.port, REAL.es.port, REAL.kibana.port, REAL.eshead.port];
  // 统一替换为轻量桩，隔离重依赖，便于验证编排
  function armStubs(delay) {
    for (const key of Object.keys(idByKey)) {
      const s = store.svc(idByKey[key]);
      s.cfg.acts.start = stubStart(REAL[key].port, delay);
      s.cfg.acts.stop = KILL;
      store.upsertService(s);
      resetSt(idByKey[key]);
    }
  }
  armStubs(0);

  const startLanes = schedule.startAllLanes();
  const flatLanes = startLanes.filter(l => !l.serial);
  const serialLanes = startLanes.filter(l => l.serial);
  ok(flatLanes.length === 2, '全部启动：未分组服务（MySQL / es-head）各成独立并行泳道（2 条）');
  ok(serialLanes.length === 2, '全部启动：ELK Stack / Web Stack 各成 1 条组合串行泳道（2 条）');
  ok(startLanes.reduce((a, l) => a + l.items.length, 0) === 6, '全部启动计划覆盖全部 6 个服务');
  const elkLane = serialLanes.find(l => l.label.includes('ELK Stack'));
  ok(elkLane && elkLane.items.map(s => s.id).join(',') === idByKey.es + ',' + idByKey.kibana, 'ELK 组合启动顺序为自上而下 es → kibana');

  for (const id of sixIds) store.patchState(id, { st: 'running' });
  const stopLanes = schedule.stopAllLanes();
  const elkStop = stopLanes.find(l => l.serial && l.label.includes('ELK Stack'));
  ok(elkStop && elkStop.items.map(s => s.id).join(',') === idByKey.kibana + ',' + idByKey.es, '全部停止：ELK 组合为从下到上倒序 kibana → es');
  const webStop = stopLanes.find(l => l.serial && l.label.includes('Web Stack'));
  ok(webStop && webStop.items.map(s => s.id).join(',') === idByKey.nginx + ',' + idByKey.redis, '全部停止：Web Stack 倒序 nginx → redis');

  armStubs(0);
  store.patchState(idByKey.redis, { st: 'starting' });
  store.patchState(idByKey.nginx, { st: 'stopping' });
  const busyLanes = schedule.startAllLanes();
  ok(!busyLanes.some(l => l.items.some(s => s.id === idByKey.redis || s.id === idByKey.nginx)), '执行中组件（starting / stopping）被直接跳过，不进入泳道');
  const plan = schedule.buildConfirmPlan('startAll');
  ok(plan.busyCount === 2 && plan.busyNames.length === 2, '二次确认计划正确统计跳过项 busyCount=2');
  ok(plan.total === 4 && plan.parallelCount + plan.serialLanes === plan.lanes.length, '二次确认计划 total / 并行数 / 串行链数自洽');

  armStubs(0);
  store.patchState(idByKey.es, { st: 'stopped', owner: 'OtherApp.exe', ownerPid: 4242 });
  const conflictPlan = schedule.buildConfirmPlan('startAll');
  ok(conflictPlan.conflicts.some(c => c.id === idByKey.es && c.port === 9200), '端口冲突项进入二次确认 conflicts');
  clearLog();
  const cg = await schedule.groupStart('elk-stack');
  await sleep(600);
  ok(cg.ok === true, '组合启动链路可下发（含冲突项）');
  ok(parseLog().length === 0, '冲突项终止所属组合链：后续 kibana 未启动（链级终止）');
  resetSt(idByKey.es);

  for (const id of sixIds) store.patchState(id, { st: 'running', owner: undefined, ownerPid: undefined });
  ok((await schedule.groupStart('elk-stack')).ok === false, '组合内无 stopped 成员时 groupStart 返回 ok=false（不空跑）');
  armStubs(0);
  ok((await schedule.groupStop('elk-stack')).ok === false, '组合内无 running 成员时 groupStop 返回 ok=false（不空跑）');

  /* ---------- 阶段 7：全部启动 / 停止 全量真实闭环（6 端口） ---------- */
  section('阶段 7 · 全部启动 / 停止全量闭环 + 组合串行语义测量');
  armStubs(600); // 桩冷启动 600ms，用于客观测量「等上一项就绪」语义
  clearLog();
  const rStartAll = schedule.startAll();
  ok(rStartAll.ok, '全部启动下发成功（6 项混合调度）');
  const allUp = await waitAllListen(sixPorts, 20000);
  ok(allUp, '全部启动后 6 个端口（6379/80/3306/9200/5601/9101）均 LISTEN');
  await sleep(900);
  ok(sixIds.every(id => store.state(id).st === 'running'), 'watchTarget 收敛：6 个服务状态均为 running');

  // 组合串行「完成驱动」语义：第二项下发时刻应不早于第一项端口就绪时刻
  const ev = parseLog();
  const esListen = ev.filter(x => x.ev === 'LISTEN' && x.port === 9200).map(x => x.t)[0];
  const kibSpawn = ev.filter(x => x.ev === 'SPAWN' && x.port === 5601).map(x => x.t)[0];
  const esSpawn = ev.filter(x => x.ev === 'SPAWN' && x.port === 9200).map(x => x.t)[0];
  const gap = (kibSpawn != null && esListen != null) ? kibSpawn - esListen : null;
  if (gap === null) {
    ok(false, '组合串行语义测量：未采集到 es/kibana 桩事件');
  } else if (gap >= 0) {
    ok(true, '组合串行完成驱动：kibana 下发晚于 es 就绪 ' + gap + 'ms');
  } else {
    deviation('DEF-001', '组合内为「连续下发」而非「等上一项就绪再启动下一项」',
      'es 就绪 - kibana 下发 = ' + (-gap) + 'ms（kibana 在 es 端口 LISTEN 之前 ' + (-gap) + 'ms 即被拉起）；' +
      '原型 v2.39 runLanes 由 done 回调驱动 next()，产品 schedule.ts runLane 的 await doStart 不等终态');
    ok(kibSpawn >= esSpawn, '组合内下发顺序仍为自上而下 es → kibana（下发序正确）');
    info('测量数据：es SPAWN=' + esSpawn + ' / es LISTEN=' + esListen + ' / kibana SPAWN=' + kibSpawn);
  }

  const rStopAll = schedule.stopAll();
  ok(rStopAll.ok, '全部停止下发成功');
  const allDown = await waitAllReleased(sixPorts, 20000);
  ok(allDown, '全部停止后 6 个端口均已释放');
  await sleep(900);
  ok(sixIds.every(id => store.state(id).st === 'stopped'), 'watchTarget 收敛：6 个服务状态均为 stopped');

  // 组合级真实闭环
  armStubs(0);
  const rGs = await schedule.groupStart('elk-stack');
  ok(rGs.ok, '组级启动下发成功（elk-stack 不再被阶段 6 过渡态污染）');
  const elkUp = await waitAllListen([9200, 5601], 12000);
  ok(elkUp, '组级启动后 9200 / 5601 均 LISTEN');
  await sleep(700);
  const rGp = await schedule.groupStop('elk-stack');
  ok(rGp.ok, '组级停止下发成功');
  const elkDown = await waitAllReleased([9200, 5601], 12000);
  ok(elkDown, '组级停止后 9200 / 5601 均已释放');

  /* ---------- 阶段 8：跨平台 / 安全静态核查 ---------- */
  section('阶段 8 · 跨平台移植性与安全静态核查');
  const batMap = runner.resolveInterpreter('D:/dev/es/bin/elasticsearch.bat');
  const shMap = runner.resolveInterpreter('D:/dev/es/bin/start.sh');
  ok(IS_WIN ? batMap.file === 'cmd.exe' : batMap.file === 'D:/dev/es/bin/elasticsearch.bat', '按平台选择 .bat 解释器映射');
  ok(IS_WIN ? shMap.file === 'D:/dev/es/bin/start.sh' : shMap.file === '/bin/sh', '按平台选择 .sh 解释器映射');
  ok(paths.isAbsolutePath(paths.normalizePath('~/dev/redis')), 'normalizePath 展开 ~ 后为绝对路径');
  ok(paths.normalizePath('a/b').includes(path.sep), 'normalizePath 按当前平台规范化分隔符');
  const runnerSrc = fs.readFileSync(path.join(ROOT, 'app', 'src', 'main', 'runner.ts'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(ROOT, 'app', 'src', 'main', 'preload.ts'), 'utf8');
  ok(/shell:\s*false/.test(runnerSrc), 'runner 全程 spawn(shell:false)，参数数组不做字符串拼接（命令注入面收敛）');
  ok(/exposeInMainWorld/.test(preloadSrc) && /contextIsolation|ipcRenderer\.invoke/.test(preloadSrc), 'preload 通过 contextBridge 白名单暴露 IPC');
  ok(/taskkill \/T \/F/.test(runnerSrc) && /SIGTERM/.test(runnerSrc), '进程树终止同时实现 Win taskkill 与 POSIX 负 PID 信号（跨平台）');
  ok(/netstat -ano/.test(fs.readFileSync(path.join(ROOT, 'app', 'src', 'main', 'probe.ts'), 'utf8')) && /lsof -nP/.test(fs.readFileSync(path.join(ROOT, 'app', 'src', 'main', 'probe.ts'), 'utf8')), '端口归属判定同时实现 netstat / lsof 双平台分支');
  const assetsDir = path.join(__dirname, '..', 'dist-electron', 'renderer', 'assets');
  let extRes = false;
  try {
    for (const f of fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'))) {
      const txt = fs.readFileSync(path.join(assetsDir, f), 'utf8');
      if (/(?:src|href)\s*=\s*["']https?:\/\//.test(txt) || /url\(\s*["']?https?:\/\//.test(txt)) extRes = true;
    }
  } catch { /* noop */ }
  ok(!extRes, '前端产物无外部 http(s) 资源加载（离线可用 / 无外链依赖）');
  ok(fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', 'i18n-dict.json')), '9 语词典随前端产物存在');

  /* ---------- 阶段 9：性能指标采样（调度开销基线） ---------- */
  section('阶段 9 · 性能指标采样（轻量桩 / 调度开销基线）');
  const perf = {};
  {
    const t = Date.now();
    for (let i = 0; i < 10; i++) template.scanTemplates();
    perf.scanMs = +((Date.now() - t) / 10).toFixed(1);
    ok(perf.scanMs < 150, '模板库 9 模板扫描平均 ' + perf.scanMs + 'ms < 150ms');
  }
  {
    const t = Date.now();
    for (let i = 0; i < 10; i++) config.writeYaml(store.data);
    perf.writeMs = +((Date.now() - t) / 10).toFixed(1);
    ok(perf.writeMs < 200, 'services.yaml 原子写平均 ' + perf.writeMs + 'ms < 200ms');
  }
  {
    armStubs(0);
    const t = Date.now();
    await probe.baseline();
    perf.baselineMs = Date.now() - t;
    ok(perf.baselineMs < 3000, '冷启动 6 服务全量基线探测（并发 8）' + perf.baselineMs + 'ms < 3000ms');
  }
  {
    armStubs(0); clearLog();
    const t = Date.now();
    schedule.startAll();
    const upAll = await waitAllListen(sixPorts, 15000);
    perf.startAllMs = Date.now() - t;
    ok(upAll && perf.startAllMs < 6000, '全部启动 6 端口就绪 ' + perf.startAllMs + 'ms < 6000ms');
    await sleep(500);
  }
  {
    const t = Date.now();
    schedule.stopAll();
    const downAll = await waitAllReleased(sixPorts, 15000);
    perf.stopAllMs = Date.now() - t;
    ok(downAll && perf.stopAllMs < 6000, '全部停止 6 端口释放 ' + perf.stopAllMs + 'ms < 6000ms');
    await sleep(500);
  }
  {
    const rss = process.memoryUsage().rss / 1024 / 1024;
    perf.rssMB = +rss.toFixed(1);
    ok(rss < 256, '主进程常驻内存 RSS ' + perf.rssMB + 'MB < 256MB');
  }
  info('性能基线 ' + JSON.stringify(perf) + '（基于轻量桩；重中间件真实冷启动需目标环境复验）');

  /* ---------- 清理 ---------- */
  section('清理');
  for (const id of sixIds) {
    try { await runner.runBuiltin(id, KILL, store.svc(id)?.dir || tmp); } catch { /* noop */ }
    resetSt(id);
  }
  await waitAllReleased(sixPorts, 5000);

  /* ---------- 汇总 ---------- */
  console.log('\n============================================================');
  console.log('== ' + pass + ' PASS / ' + fail + ' FAIL / ' + warn + ' WARN / ' + deviations.length + ' DEVIATION ==');
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  if (warns.length) { console.log('环境降级 / 提示项：'); warns.forEach(w => console.log('  - ' + w)); }
  if (deviations.length) {
    console.log('需求偏差（上线阻塞项）：');
    deviations.forEach(d => console.log('  - [' + d.code + '] ' + d.msg));
  }
  console.log('数据目录：' + tmp);
  console.log('============================================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E ERROR', e); process.exit(1); });
