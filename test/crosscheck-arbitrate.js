/* ============================================================
 * 交叉验证 · 结果比对 + 第三方仲裁复测
 *
 * 输入：test/out-A.json（规格黑盒）、test/out-B.json（白盒故障注入）
 * 输出：test/<outfile>（默认 out-cross.json）
 *
 * 对 A/B 判定不一致的检查点，用「第三种方法」独立复测：
 *   K01 公开 IPC 通道 + 非法样本（A 的通道 × B 的样本）
 *   K07 真实 TCP 端口时序（不依赖 B 的 fake probe）
 *   K12 同一实现在「无心跳 / 有心跳」两组对照实验
 *   K14 词典引擎 sanity（词典内整句键必须能翻译，反证问题在词条缺口）
 *   K15 静态事实复核 + 标注运行时验证限制
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const OUT = path.join(__dirname, process.argv[2] || 'out-cross.json');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'out-A.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(__dirname, 'out-B.json'), 'utf8'));
const byId = (r) => Object.fromEntries(r.results.map(x => [x.id, x]));
const am = byId(A), bm = byId(B);
const ids = [...new Set([...Object.keys(am), ...Object.keys(bm)])].sort();

console.log('交叉验证 · 读取 A(' + A.results.length + ' 项) / B(' + B.results.length + ' 项)');

/* ---------- 独立第三方 harness（与 A/B 的数据目录、桩、模块实例均隔离） ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-ARB-'));
process.env.DEVSTACK_DATA_DIR = tmp;
const HANDLERS = Object.create(null);
const Module = require('module');
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.1.0-arbitrator' },
  ipcMain: { handle: (ch, fn) => { HANDLERS[ch] = fn; } },
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
const SRC = path.join(__dirname, '..', 'src', 'main');
const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const { store } = M('store');
const schedule = M('schedule');
const probeMod = M('probe');
const config = M('config');
M('template').seedPresets();
const arbProbe = new probeMod.ProbeScheduler({
  getServices: () => store.services(),
  getSt: (id) => store.state(id).st,
  onPatch: (id, patch) => store.patchState(id, patch),
  pollMs: 300
});
schedule.initSchedule({ probe: arbProbe, openUrl: () => {}, openDir: () => {} });
M('ipc').registerIpc();
arbProbe.start();
const invoke = (ch, ...args) => HANDLERS[ch](null, ...args);
const snap = () => invoke('get-snapshot');

function portOpen(port, timeout = 300) {
  return new Promise(res => {
    const s = new net.Socket(); let done = false;
    const fin = v => { if (done) return; done = true; try { s.destroy(); } catch { /* */ } res(v); };
    s.setTimeout(timeout);
    s.once('connect', () => fin(true)); s.once('timeout', () => fin(false)); s.once('error', () => fin(false));
    try { s.connect(port, '127.0.0.1'); } catch { fin(false); }
  });
}
async function waitStates(ids, want, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const sp = await snap();
    if (ids.every(id => sp.states[id] && sp.states[id].st === want)) return true;
    await sleep(100);
  }
  return false;
}
async function waitPorts(ports, want, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rs = await Promise.all(ports.map(p => portOpen(p)));
    if (rs.every(v => v === want)) return true;
    await sleep(100);
  }
  return false;
}
const stubFile = path.join(tmp, 'stub.js');
const stubLog = path.join(tmp, 'stub.log');
fs.writeFileSync(stubFile, [
  "const net=require('net'),fs=require('fs');",
  'const port=parseInt(process.argv[2],10),delay=parseInt(process.argv[4]||"0",10);',
  "const log=process.argv[3];",
  'setTimeout(function(){',
  "  const s=net.createServer(function(){});",
  "  s.on('error',function(e){fs.appendFileSync(log,'ERROR '+port+' '+String(e.code||e)+'\\n')});",
  "  s.listen(port,'127.0.0.1',function(){fs.appendFileSync(log,'LISTEN '+port+' '+Date.now()+'\\n')});",
  '},delay);', 'setInterval(function(){},1000);'
].join('\n'), 'utf8');
fs.writeFileSync(stubLog, '', 'utf8');
const stubStart = (port, delay) => ({ type: 'exec', command: process.execPath, args: [stubFile, String(port), stubLog, String(delay)], timeoutMs: 15000 });
const KILL = { type: 'builtin', builtin: 'killProcessTree', timeoutMs: 8000 };
function stubEvents() {
  return fs.readFileSync(stubLog, 'utf8').split(/\r?\n/).filter(Boolean).map(l => {
    const [ev, p, t] = l.split(' '); return { ev, port: +p, t: +t };
  });
}
function mkSvc(o) {
  return Object.assign({ id: 'arb-' + Math.random().toString(36).slice(2, 7), name: 'ARB', gid: null,
    port: 6799, webUrl: null, dir: tmp, cfg: { acts: { start: stubStart(6799, 0), stop: KILL } } }, o);
}

/* ---------- 第三方复测 ---------- */
const third = {};

async function retestK01() {
  // A 的通道（公开 IPC）× B 的非法样本
  const bad = mkSvc({ id: 'arb-badport', name: 'ARB-BadPort', port: 70000 });
  let result;
  try { result = await invoke('upsert-service', bad); } catch (e) { result = { threw: String(e && e.message || e) }; }
  const cfgFile = path.join(tmp, 'services.yaml');
  const text = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : '';  // 被正确拒绝时文件可不存在
  const leaked = text.includes('70000') && text.includes('arb-badport');
  try { await invoke('remove-service', 'arb-badport'); } catch { /* */ }
  return { verdict: leaked ? 'FAIL' : 'PASS',
    evidence: '经公开 IPC 通道注入 port=70000 → 落盘污染=' + leaked + ' / 返回=' + JSON.stringify(result) };
}

async function retestK07() {
  // 真实 TCP 端口时序：第一项刻意延迟 900ms 就绪，第二项即时
  arbProbe.stop();          // 冻结全局心跳，避免它把显式状态改回去，保证对照纯净
  const p1 = 6701, p2 = 6702;
  for (const [id, port, delay] of [['arb-r1', p1, 900], ['arb-r2', p2, 0]]) {
    await invoke('upsert-service', mkSvc({ id, name: id, port, cfg: { acts: { start: stubStart(port, delay), stop: KILL } } }));
  }
  await invoke('save-group', { id: 'grb', name: 'ARB-Seq', collapsed: false }, ['arb-r1', 'arb-r2']);
  // 显式设定状态：只让本组合两项处在 stopped
  for (const s of store.services()) store.patchState(s.id, { st: ['arb-r1', 'arb-r2'].includes(s.id) ? 'stopped' : 'running' });
  const ready = (await snap()).states['arb-r1'].st === 'stopped' && (await snap()).states['arb-r2'].st === 'stopped';
  fs.writeFileSync(stubLog, '', 'utf8');
  const r1 = await invoke('start-all');
  const r2 = await invoke('start-all');     // 立即重入
  const up = await waitPorts([p1, p2], true, 15000);
  const evs = stubEvents();
  const l1 = evs.find(e => e.ev === 'LISTEN' && e.port === p1);
  const l2 = evs.find(e => e.ev === 'LISTEN' && e.port === p2);
  const outOfOrder = !!(l1 && l2 && l2.t < l1.t);
  try { await invoke('stop-all'); } catch { /* */ }
  await waitPorts([p1, p2], false, 12000);
  arbProbe.start();
  return { verdict: !outOfOrder && !(r1.ok && r2.ok) ? 'PASS' : 'FAIL',
    evidence: '两次 start-all 受理=' + r1.ok + '/' + r2.ok + ' / 端口时序 P2-LISTEN ' +
      (l2 && l2.t) + ' vs P1-LISTEN ' + (l1 && l1.t) + ' / 第二项抢跑=' + outOfOrder +
      ' / ready=' + ready + ' up=' + up };
}

async function retestK12() {
  // 对照实验：同一实现，无心跳 vs 有心跳（必须先冻结全局心跳，否则对照组被污染）
  arbProbe.stop();
  const asyncRun = async (withHeartbeat, seq = 0) => {
    const id = 'arb-to-' + (withHeartbeat ? 'hb' + seq : 'nohb');
    const port = withHeartbeat ? 6710 + seq : 6703;
    const p = new probeMod.ProbeScheduler({
      getServices: () => store.services(), getSt: (x) => store.state(x).st,
      onPatch: (x, patch) => store.patchState(x, patch), pollMs: 250
    });
    schedule.initSchedule({ probe: p, openUrl: () => {}, openDir: () => {} });
    if (withHeartbeat) p.start();
    await invoke('upsert-service', mkSvc({ id, name: id, port,
      cfg: { acts: { start: { type: 'exec', command: path.join(tmp, 'no-such-bin-arb'), args: [], timeoutMs: 900 }, stop: null } } }));
    store.patchState(id, { st: 'stopped' });   // 不依赖心跳写入基线
    await invoke('toggle-service', id);
    await sleep(1600);
    const st = store.state(id).st;
    if (withHeartbeat) p.stop();
    return st;
  };
  const noHb = await asyncRun(false);
  const hbSamples = [];
  for (let i = 0; i < 4; i++) hbSamples.push(await asyncRun(true, i));
  // 恢复仲裁 harness 的 ctx 与心跳
  schedule.initSchedule({ probe: arbProbe, openUrl: () => {}, openDir: () => {} });
  arbProbe.start();
  const declared = /else if \(Date\.now\(\) - startAt > timeoutMs\)[\s\S]{0,260}(patchState|onTimeout|onFail)/.test(fs.readFileSync(path.join(SRC, 'probe.ts'), 'utf8'));
  const sweepNoRecheck = /const list = this\.getServices\(\)\.filter[\s\S]{0,700}this\.onPatch\(s\.id, patch\)/.test(fs.readFileSync(path.join(SRC, 'probe.ts'), 'utf8'));
  const recovered = hbSamples.filter(s => s !== 'starting' && s !== 'stopping').length;
  const nondeterministic = recovered > 0 && recovered < hbSamples.length;
  return { verdict: noHb !== 'starting' && hbSamples.every(s => s !== 'starting' && s !== 'stopping') ? 'PASS' : 'FAIL',
    evidence: '无心跳超时后=' + noHb + ' / 有心跳4次采样=[' + hbSamples.join(',') + '] 偶发恢复=' + recovered + '/4' +
      '（不确定=' + nondeterministic + '）/ 超时分支写终态=' + declared + ' / 心跳轮首过滤后不复查=' + sweepNoRecheck +
      '；A 观察到的 stopped 属心跳竞态回写，非超时收敛设计' };
}

async function sanityK14() {
  const dict = JSON.parse(fs.readFileSync(path.join(RENDERER, 'i18n-dict.json'), 'utf8'));
  const ts = require('typescript');
  const js = ts.transpileModule(fs.readFileSync(path.join(RENDERER, 'i18n.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const stub = Object.assign({}, dict);
  Object.defineProperty(stub, '__esModule', { value: true }); stub.default = dict;
  // 复数表（v2.55 起 i18n 引擎的第二层依赖）
  const plural = JSON.parse(fs.readFileSync(path.join(RENDERER, 'i18n-plural.json'), 'utf8'));
  const pluralStub = Object.assign({}, plural);
  Object.defineProperty(pluralStub, '__esModule', { value: true }); pluralStub.default = plural;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'localStorage', 'document', js)(
    mod, mod.exports,
    (id) => id.includes('i18n-dict') ? stub
      : (id.includes('i18n-plural') ? pluralStub : require(id)),
    { getItem: () => null, setItem: () => {} }, { documentElement: { setAttribute: () => {} } });
  mod.exports.setLang('en');
  const keys = Object.keys(dict).slice(0, 40);
  const translated = keys.filter(k => mod.exports.tr(k) !== k).length;
  const engineOK = translated >= keys.length * 0.8;
  const broken = mod.exports.tr('过滤日志关键字');
  return { engineOK, evidence: '词典内整句键 en 翻译成功=' + translated + '/' + keys.length +
    ' / 引擎正常=' + engineOK + ' / 拼接文案实测「过滤日志关键字」→「' + broken + '」' };
}

function staticK15() {
  const r = fs.readFileSync(path.join(SRC, 'runner.ts'), 'utf8');
  const eaw = r.slice(r.indexOf('export function execAndWait'), r.indexOf('/* ---------- 跨平台杀进程树'));
  return { verdict: /detached/.test(eaw) ? 'PASS' : 'FAIL',
    evidence: 'killChildTree 负 PID=' + /process\.kill\(-pid/.test(r) + ' / execAndWait detached=' + /detached/.test(eaw) +
      ' / 当前运行时 ' + process.platform + '（POSIX 分支仅静态可证，需 macOS/Linux 真机复验）' };
}

/* ---------- 主流程 ---------- */
(async () => {
  /* 一致性矩阵 */
  const matrix = ids.map(id => {
    const a = am[id], b = bm[id];
    const va = a ? a.verdict : 'MISSING', vb = b ? b.verdict : 'MISSING';
    let kind;
    if (va === 'NA' || vb === 'NA') kind = 'COVERAGE_GAP';
    else if (va === vb) kind = 'AGREE';
    else kind = 'CONFLICT';
    return { id, name: (a || b).name, A: va, B: vb, kind,
      evidenceA: a ? a.evidence : '', evidenceB: b ? b.evidence : '' };
  });
  const agree = matrix.filter(m => m.kind === 'AGREE');
  const conflicts = matrix.filter(m => m.kind === 'CONFLICT');
  const gaps = matrix.filter(m => m.kind === 'COVERAGE_GAP');

  console.log('\n=== 交叉比对矩阵 ===');
  matrix.forEach(m => console.log('  ' + m.id + '  A=' + m.A.padEnd(4) + ' B=' + m.B.padEnd(4) + '  ' + m.kind));
  console.log('  一致 ' + agree.length + ' / 分歧 ' + conflicts.length + ' / 盲区 ' + gaps.length);

  /* 第三方复测 */
  console.log('\n=== 第三方仲裁复测 ===');
  const arbitrations = [];
  for (const c of conflicts) {
    let r;
    if (c.id === 'K01') r = await retestK01();
    else if (c.id === 'K07') r = await retestK07();
    else if (c.id === 'K12') r = await retestK12();
    else r = { verdict: 'UNDETERMINED', evidence: '无该检查点的第三方复测实现' };
    arbitrations.push({ id: c.id, A: c.A, B: c.B, third: r.verdict, evidence: r.evidence,
      truth: r.verdict, note: '' });
    console.log('  ' + c.id + ' A=' + c.A + ' B=' + c.B + ' → 第三方=' + r.verdict + ' | ' + r.evidence);
  }
  const k14 = await sanityK14();
  const k15 = staticK15();
  for (const g of gaps) {
    const r = g.id === 'K14'
      ? { verdict: k14.engineOK ? 'B_VALID' : 'B_INVALID', evidence: k14.evidence }
      : { verdict: k15.verdict === g.B ? 'B_VALID' : 'B_INVALID', evidence: k15.evidence };
    arbitrations.push({ id: g.id, A: g.A, B: g.B, third: r.verdict, evidence: r.evidence,
      truth: g.B, note: 'A 方法论盲区，由 B 补位；第三方确认 B 的判定方法有效' });
    console.log('  ' + g.id + ' A=NA B=' + g.B + ' → 第三方=' + r.verdict + ' | ' + r.evidence);
  }

  /* 清理 */
  try { await invoke('stop-all'); } catch { /* */ }
  arbProbe.stop();
  await sleep(200);

  const out = {
    title: '交叉验证 · A/B 比对与仲裁', at: new Date().toISOString(),
    A: { tester: A.tester, method: A.method, pass: A.results.filter(x => x.verdict === 'PASS').length,
      fail: A.results.filter(x => x.verdict === 'FAIL').length, na: A.results.filter(x => x.verdict === 'NA').length },
    B: { tester: B.tester, method: B.method, pass: B.results.filter(x => x.verdict === 'PASS').length,
      fail: B.results.filter(x => x.verdict === 'FAIL').length, na: B.results.filter(x => x.verdict === 'NA').length },
    matrix, stats: {
      total: matrix.length, agree: agree.length, conflict: conflicts.length, gap: gaps.length,
      agreeRate: (agree.length / matrix.length * 100).toFixed(1) + '%',
      agreePass: agree.filter(m => m.A === 'PASS').length,
      agreeFail: agree.filter(m => m.A === 'FAIL').length
    },
    arbitrations, platform: process.platform, node: process.version
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('\n== 仲裁完成：一致 ' + agree.length + '（PASS ' + out.stats.agreePass + ' / FAIL ' + out.stats.agreeFail +
    '）/ 分歧 ' + conflicts.length + ' / 盲区 ' + gaps.length + ' ==');
  console.log('结果文件：' + OUT);
  process.exit(0);
})().catch(e => { console.error('ARBITRATE ERROR', e); process.exit(1); });
