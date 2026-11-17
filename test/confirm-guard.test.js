/* ============================================================
 * v2.40：全部启动 / 全部停止「点击前置守卫」测试
 *
 * 覆盖：
 *  A 渲染器决策函数 shkuldOpenCknfirm（TS 转译后真实加载）
 *  B 主进程 buildConfirmPlan 在 空列表 / 全启动 / 全停止 / 全执行中 /
 *    状态未就绪 / 混合态 下的 serviceCount / actionable / skipReason
 *  C 后端 startAll / stopAll 兜底（绕过弹窗直接调 IPC 不误执行）
 *  D 原型与生产 UI 的守卫结构、按钮弱化态、9 语词典
 *
 * 运行：node test/confirm-guard.test.js（需先 tsc -p tsconfig.electron.json）
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const Module = require('module');

const APP = path.join(__dirname, '..');
const R = path.join(APP, 'src', 'renderer');
const DIST = path.join(APP, 'dist-electron', 'main');
const PROTO = path.join(APP, '..', 'prototype', 'index.html');

// 隔离数据目录：所有读写都指向临时目录，绝不碰用户真实 %APPDATA%/devstack
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-guard-'));
process.env.DEVSTACK_DATA_DIR = tmp;

// 最小 Electron 桩：加载主进程模块只需要 app.getPath / ipcMain.handle 等
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

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

/* ---------- A：真实加载 guard.ts ---------- */
function loadGuard() {
  const src = fs.readFileSync(path.join(R, 'guard.ts'), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const mm = new Module('guard.probe.js');
  mm.filename = path.join(R, 'guard.probe.js');
  mm.paths = Module._nodeModulePaths(R);
  mm._compile(js, mm.filename);
  return mm.exports;
}
function mkPlan(over) {
  return Object.assign({
    stop: false, total: 0, parallelCount: 0, serialLanes: 0,
    busyCount: 0, busyNames: [], conflicts: [], lanes: [],
    serviceCount: 0, actionable: false, skipReason: 'no-target'
  }, over);
}

const G = loadGuard();
section('A · 渲染器守卫决策 shouldOpenConfirm');
ok(typeof G.shouldOpenConfirm === 'function', 'guard.ts 导出 shouldOpenConfirm');
const gEmpty = G.shouldOpenConfirm(0, mkPlan({ serviceCount: 0 }));
ok(gEmpty.open === false && gEmpty.reason === 'empty', '列表服务数 0 → 不弹窗 / 原因 empty');
ok(G.shouldOpenConfirm(3, mkPlan({ serviceCount: 0 })).reason === 'empty', '本地快照滞后（3 项）但后端 0 项 → 仍判 empty');
const gReady = G.shouldOpenConfirm(3, mkPlan({ serviceCount: 3, total: 2, actionable: true, skipReason: null }));
ok(gReady.open === true && gReady.reason === 'ready', '本次有可执行项 → 弹二次确认');
for (const r of ['no-target', 'all-busy', 'in-flight', 'not-ready']) {
  const g = G.shouldOpenConfirm(3, mkPlan({ serviceCount: 3, total: 0, actionable: false, skipReason: r }));
  ok(g.open === false && g.reason === r, '无可执行项 · ' + r + ' → 不弹窗并保留原因');
}
ok(G.shouldOpenConfirm(3, mkPlan({ serviceCount: 3, total: 0, actionable: false, skipReason: null })).reason === 'not-ready',
  '后端未给原因时兜底 not-ready');
ok(G.shouldOpenConfirm(3, mkPlan({ serviceCount: 3, total: 0, actionable: true })).open === false,
  'actionable 与 total 矛盾时不弹窗（防御脏数据）');
// 旧版主进程降级兼容：计划里没有 serviceCount / actionable 字段
const legacy = { stop: false, total: 2, parallelCount: 1, serialLanes: 1, busyCount: 0, busyNames: [], conflicts: [], lanes: [] };
ok(G.shouldOpenConfirm(3, legacy).open === true, '旧版计划（无新字段）按 total 降级，仍可弹窗');
ok(G.shouldOpenConfirm(3, Object.assign({}, legacy, { total: 0 })).open === false, '旧版计划 total=0 → 不弹窗');

/* ---------- B：主进程确认计划 ---------- */
section('B · buildConfirmPlan 前置守卫字段');
const store = require(path.join(DIST, 'main', 'store.js')).store;
const schedule = require(path.join(DIST, 'main', 'schedule.js'));

// B1 空列表
const p0s = schedule.buildConfirmPlan('startAll');
ok(p0s.serviceCount === 0, '空列表：serviceCount=0');
ok(p0s.total === 0 && p0s.actionable === false, '空列表：total=0 / actionable=false');
ok(p0s.skipReason === 'empty', '空列表：skipReason=empty');
ok(schedule.buildConfirmPlan('stopAll').skipReason === 'empty', '空列表「全部停止」同样判 empty');
ok(G.shouldOpenConfirm(0, p0s).open === false, '空列表：前后端合判 → 不弹窗');

// 造 3 个服务（1 平铺 + 1 个两成员组合），覆盖混合调度不被破坏
const mk = (id, port) => ({
  id, name: id.toUpperCase(), gid: null, port, dir: tmp,
  cfg: { acts: { start: { type: 'exec', command: 'echo', args: ['hi'] }, stop: null, restart: null } }
});
store.upsertService(mk('a', 2101));
store.upsertService(mk('b', 2102));
store.upsertService(mk('c', 2103));
store.saveGroup({ id: 'g1', name: 'G1', collapsed: false }, ['b', 'c']);
ok(store.services().length === 3, '夹具：写入 3 个服务（含 1 个组合）');
const setAll = (st) => ['a', 'b', 'c'].forEach(id => store.patchState(id, { st }));

// B2 全部已停止
setAll('stopped');
const ps = schedule.buildConfirmPlan('startAll');
ok(ps.serviceCount === 3 && ps.total === 3 && ps.actionable === true, '全部已停止 → 全部启动有 3 项可执行');
ok(ps.skipReason === null, '有可执行项时 skipReason=null');
ok(ps.parallelCount === 1 && ps.serialLanes === 1, '混合调度未回归：并行 1 + 串行链 1');
ok(G.shouldOpenConfirm(3, ps).open === true, '全部已停止 → 点「全部启动」应弹窗');
const pt = schedule.buildConfirmPlan('stopAll');
ok(pt.total === 0 && pt.actionable === false && pt.skipReason === 'no-target', '全部已停止 → 点「全部停止」判 no-target');
ok(G.shouldOpenConfirm(3, pt).open === false, '全部已停止 → 点「全部停止」不弹窗');

// B3 全部已运行
setAll('running');
const rs = schedule.buildConfirmPlan('startAll');
ok(rs.total === 0 && rs.actionable === false && rs.skipReason === 'no-target', '全部已运行 → 点「全部启动」判 no-target');
ok(G.shouldOpenConfirm(3, rs).open === false, '全部已运行 → 点「全部启动」不弹窗');
const rt = schedule.buildConfirmPlan('stopAll');
ok(rt.total === 3 && rt.actionable === true && rt.skipReason === null, '全部已运行 → 点「全部停止」有 3 项可执行');
ok(rt.lanes.length === 2 && rt.lanes.some(l => l.serial), '倒序组合链 + 平铺泳道仍为 2 条');
ok(G.shouldOpenConfirm(3, rt).open === true, '全部已运行 → 点「全部停止」应弹窗');

// B4 全部执行中
store.patchState('a', { st: 'starting' });
store.patchState('b', { st: 'stopping' });
store.patchState('c', { st: 'starting' });
const bs = schedule.buildConfirmPlan('startAll');
ok(bs.total === 0 && bs.busyCount === 3 && bs.skipReason === 'all-busy', '全部启动/停止中 → all-busy / busyCount=3');
ok(schedule.buildConfirmPlan('stopAll').skipReason === 'all-busy', '「全部停止」同样判 all-busy');
ok(G.shouldOpenConfirm(3, bs).reason === 'all-busy', '渲染器保留 all-busy 原因');

// B5 冷启动状态未就绪
setAll('unknown');
const us = schedule.buildConfirmPlan('startAll');
ok(us.total === 0 && us.skipReason === 'not-ready', '全部 unknown（探测中）→ not-ready，不误弹窗');
ok(G.shouldOpenConfirm(3, us).open === false, '渲染器对 not-ready 不弹窗');

// B6 混合态
store.patchState('a', { st: 'stopped' });
store.patchState('b', { st: 'running' });
store.patchState('c', { st: 'starting' });
const ms = schedule.buildConfirmPlan('startAll');
ok(ms.total === 1 && ms.actionable === true && ms.busyCount === 1, '混合态：只调度 1 项已停止，跳过 1 项执行中');
const mt = schedule.buildConfirmPlan('stopAll');
ok(mt.total === 1 && mt.actionable === true, '混合态：全部停止只调度 1 项运行中');
ok(G.shouldOpenConfirm(3, ms).open && G.shouldOpenConfirm(3, mt).open, '混合态两个方向都应弹窗');

/* ---------- C：后端兜底（前端被绕过时也不误执行） ---------- */
section('C · startAll / stopAll 兜底');
setAll('running');
const rStart = schedule.startAll();
ok(rStart.ok === false && /没有需要启动/.test(rStart.reason || ''), '全运行态直接调 startAll() 被拦截：' + rStart.reason);
setAll('stopped');
const rStop = schedule.stopAll();
ok(rStop.ok === false && /没有运行中/.test(rStop.reason || ''), '全停止态直接调 stopAll() 被拦截：' + rStop.reason);

/* ---------- D：源码结构 / 词典 ---------- */
section('D · UI 守卫结构、原型同步与 9 语词典');
const svcSrc = fs.readFileSync(path.join(R, 'components', 'ServicesPage.tsx'), 'utf8');
ok(/services\.length\s*<=\s*0/.test(svcSrc), 'ServicesPage 点击先判断列表服务数是否 > 0');
ok(svcSrc.indexOf('services.length <= 0') > 0 &&
   svcSrc.indexOf('services.length <= 0') < svcSrc.indexOf('api.buildConfirmPlan(kind)'),
   '空列表判断发生在请求确认计划之前（不产生多余 IPC）');
ok(/shouldOpenConfirm\(services\.length,\s*plan\)/.test(svcSrc), '确认计划返回后再做 actionable 守卫');
ok(/if\s*\(!guard\.open\)/.test(svcSrc), '无可执行项时走 toast 分支，不调用 openModal');
ok(svcSrc.indexOf('if (!guard.open)') < svcSrc.indexOf('ui.openModal({'), '不弹窗分支位于 openModal 之前');
ok(/data-guard=/.test(svcSrc) && /guard-idle/.test(svcSrc), '按钮带可观测弱化态（data-guard + guard-idle）');
ok(/\.btn\.guard-idle/.test(fs.readFileSync(path.join(R, 'styles.css'), 'utf8')), '样式表含弱化态定义');
const appSrc = fs.readFileSync(path.join(R, 'App.tsx'), 'utf8');
ok(/clearTimeout\(toastTimer\.current\)/.test(appSrc), 'toast 连续提示会取消上一条定时器（守卫提示不被连点吞掉）');
ok(/useRef/.test(appSrc) && /toastTimer\.current\s*=/.test(appSrc), 'toast 定时器句柄由 useRef 持有并在卸载时清理');

const proto = fs.readFileSync(PROTO, 'utf8');
const cStart = proto.indexOf('function confirmAll(kind)');
const cEnd = proto.indexOf("$('#startAll').addEventListener", cStart);
const cBody = proto.slice(cStart, cEnd);
ok(cStart > 0 && cEnd > cStart, '原型存在 confirmAll 且其事件绑定可定位');
ok(/if\(!S\.length\)/.test(cBody), '原型：列表为空直接提示并返回');
ok(/if\(!count\)/.test(cBody), '原型：0 项可操作直接提示并返回');
ok(cBody.indexOf('if(!S.length)') < cBody.indexOf('confirmModal(') &&
   cBody.indexOf('if(!count)') < cBody.indexOf('confirmModal('), '原型：两道守卫都在弹窗之前');
ok(/if\(!laneCount\(target\)\)/.test(cBody), '原型：点确认时仍保留状态二次校验（弹窗期间状态可能变化）');

const dict = JSON.parse(fs.readFileSync(path.join(R, 'i18n-dict.json'), 'utf8'));
const GUARD_KEYS = [
  '服务列表为空，请先添加服务。',
  '所有服务已在运行中，无需再次启动。',
  '所有服务均已停止，无需再次停止。',
  '所有服务正在启动或停止中，请等待完成后再操作。',
  '组合串行链正在执行中，请等待本次调度完成。',
  '当前服务状态尚未就绪，请等待探测完成后再操作。'
];
ok(Object.keys(dict).length === 788, '词典键数 788');
ok(GUARD_KEYS.every(k => Array.isArray(dict[k]) && dict[k].length === 9), '6 条守卫提示均收录 9 语');
ok(GUARD_KEYS.every(k => dict[k] && dict[k].every(v => typeof v === 'string' && v.trim())), '6 条提示 9 语无空值');
const CJK = /[\u3400-\u9fff]/;
const LATIN = [2, 4, 5, 6, 7, 8]; // en/ko/fr/es/de/pt（ja 用汉字合法，不计）
ok(GUARD_KEYS.every(k => LATIN.every(i => !CJK.test(dict[k][i]))), '6 条提示在 6 个非汉字语种下无中文残留');

/* ---------- 汇总 ---------- */
console.log('\n== ' + pass + ' PASS / ' + fail + ' FAIL ==');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
