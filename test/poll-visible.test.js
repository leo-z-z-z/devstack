/* ============================================================
 * v2.41：状态轮询可见性 + 刷新范围收敛测试
 *
 *  A 真实加载 renderer/pkll.ts：文案决策 / 9 语替换 / 占位符
 *  B 真实加载 main/prkbe.ts：周期刷新范围只含 running（+ unknown 首探）
 *  C 手动全量刷新覆盖已停止组件；轮次事件 seq / mode / scope / pollMs
 *  D 设置间隔即时重建心跳（此前 setPollMs 从未被调用）
 *  E 全链路静态接线、样式、词典 676 键 × 9 语
 *
 * 运行：node test/poll-visible.test.js（不需要真实端口 / 不碰用户数据）
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('module');

const APP = path.join(__dirname, '..');
const R = path.join(APP, 'src', 'renderer');
const MAIN = path.join(APP, 'src', 'main');
const SRC = path.join(APP, 'src');
const dict = JSON.parse(fs.readFileSync(path.join(R, 'i18n-dict.json'), 'utf8'));
const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'es', 'de', 'pt'];
const LATIN = ['en', 'ko', 'fr', 'es', 'de', 'pt'];
const CJK = /[\u3400-\u9fff]/;

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; fails.push(msg); console.log('FAIL ' + msg); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const src = (p) => fs.readFileSync(p, 'utf8');

/* ---------- TS 转译加载器（不依赖 dist，改源码即可测） ---------- */
function loadTs(file, inject) {
  const js = ts.transpileModule(src(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  const mm = new Module(path.basename(file) + '.probe.js');
  mm.filename = path.join(path.dirname(file), path.basename(file) + '.probe.js');
  mm.paths = Module._nodeModulePaths(path.dirname(file));
  if (inject) {
    const orig = mm.require.bind(mm);
    mm.require = (r) => {
      for (const k of Object.keys(inject)) if (r.includes(k)) return inject[k];
      return orig(r);
    };
  }
  mm._compile(js, mm.filename);
  return mm.exports;
}

/* ---------- 桩：只对 probe 模块注入，不污染全局 net（否则 process.stdout 会变成哑 Socket） ---------- */
const fakeNet = {
  Socket: class {
    setTimeout() {}
    once(ev, cb) { if (ev === 'error') setImmediate(() => cb(new Error('stub-closed'))); }
    connect() {}
    destroy() {}
  }
};
const fakeCp = { execSync: () => '' };   // findOwner / processName 一律返回空

(async () => {
  /* ===== A：poll.ts 纯逻辑 ===== */
  section('A · 渲染指示器文案决策');
  const pollMod = loadTs(path.join(R, 'poll.ts'));
  ok(pollMod.pollSeconds(1000) === '1', '1000ms → 1 秒');
  ok(pollMod.pollSeconds(3000) === '3', '3000ms → 3 秒');
  ok(pollMod.pollSeconds(5000) === '5', '5000ms → 5 秒');
  ok(pollMod.INITIAL_POLL.pollMs === 3000, '渲染器初始间隔与默认档位一致（3 秒）');
  ok(pollMod.INITIAL_POLL.phase === 'idle' && pollMod.INITIAL_POLL.cycles === 0, '初始态 idle / 0 轮');

  const identity = s => s;
  const idle = { ...pollMod.INITIAL_POLL, pollMs: 3000 };
  const busyAuto = { ...idle, phase: 'busy', mode: 'auto', scope: 3 };
  const busyManual = { ...idle, phase: 'busy', mode: 'manual', scope: 6 };
  ok(pollMod.pollLabel(idle, 3, identity) === '每 3 秒自动刷新', '空闲文案只保留主状态，不带「已启动 N 项」补充');
  ok(!pollMod.pollLabel(idle, 3, identity).includes('·'), '标题栏文案不再有右侧补充说明');
  ok(pollMod.pollLabel(busyAuto, 3, identity) === '正在刷新 3 项服务', '刷新中文案点明本轮探测数');
  ok(pollMod.pollLabel(busyManual, 3, identity) === '正在全量刷新 6 项服务', '手动刷新文案区分全量范围');
  ok(pollMod.pollLabel(idle, 0, identity) === '自动刷新已暂停', '0 项已启动时精简为「自动刷新已暂停」');
  ok(pollMod.pollLabel({ ...idle, phase: 'busy', mode: 'manual', scope: 0 }, 0, identity) === '正在全量刷新 0 项服务',
    '手动全量刷新即使 0 项也照实显示，不被暂停文案覆盖');
  ok(pollMod.pollLabel({ ...idle, pollMs: 1000 }, 3, identity) === '每 1 秒自动刷新', '间隔改为 1 秒后文案同步');
  ok(pollMod.pollLabel({ ...idle, pollMs: 5000 }, 3, identity) === '每 5 秒自动刷新', '间隔改为 5 秒后文案同步');

  /* 真实 i18n.ts：9 语替换式引擎 */
  global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } };
  global.document = { documentElement: { setAttribute: () => {} } };
  const I = loadTs(path.join(R, 'i18n.ts'), { 'i18n-dict.json': dict });
  const cases = [
    ['空闲', idle, 3], ['自动刷新中', busyAuto, 3],
    ['全量刷新中', busyManual, 3], ['无已启动组件·暂停', idle, 0]
  ];
  let langBad = [];
  for (const lg of LANGS) {
    I.setLang(lg);
    for (const [name, p, run] of cases) {
      const out = pollMod.pollLabel(p, run, I.tr);
      if (!out || out.includes('{n}') || out.includes('{s}')) langBad.push(lg + '/' + name + '/占位符未替换:' + out);
      if (LATIN.includes(lg) && CJK.test(out)) langBad.push(lg + '/' + name + '/中文残留:' + out);
    }
  }
  I.setLang('zh-CN');
  ok(langBad.length === 0, '4 类指示文案 × 9 语全部本地化且占位符替换（异常 ' + langBad.length + '）');
  if (langBad.length) langBad.slice(0, 8).forEach(x => console.log('       ' + x));
  I.setLang('en');
  ok(!CJK.test(pollMod.pollLabel(busyAuto, 3, I.tr)) && /Refreshing 3 services/.test(pollMod.pollLabel(busyAuto, 3, I.tr)),
    '英文刷新中文案含 Refreshing 3 services 且无中文');
  I.setLang('zh-CN');

  /* ===== B：心跳刷新范围 ===== */
  section('B · 周期刷新范围 = 已启动组件');
  // probe.ts 现在从 shared/types 读取三档常量（值导入，非 type-only），需注入真实模块
  const sharedTypes = loadTs(path.join(SRC, 'shared', 'types.ts'));
  const { ProbeScheduler } = loadTs(path.join(MAIN, 'probe.ts'), {
    'node:net': fakeNet, 'node:child_process': fakeCp, 'shared/types': sharedTypes
  });
  ok(sharedTypes.DEFAULT_POLL_MS === 3000 && sharedTypes.POLL_INTERVALS.join(',') === '1000,3000,5000',
    '共享常量：三档 1/3/5 秒，默认 3 秒');
  const states = {
    r1: 'running', r2: 'running', s1: 'stopped',
    b1: 'starting', b2: 'stopping', u1: 'unknown'
  };
  const svcs = Object.keys(states).map(id => ({ id, name: id, port: 1 }));
  let patched = [], cycles = [];
  const seenAt = new Map();
  const p = new ProbeScheduler({
    getServices: () => svcs,
    getSt: id => states[id],
    onPatch: (id) => patched.push(id),
    onCycle: c => { cycles.push(c); seenAt.set(c.phase + ':' + c.seq, Date.now()); },
    pollMs: 3000
  });

  await p.sweep();
  await sleep(720);   // 等最短可感知时长后的 end 事件
  const autoPatched = patched.slice().sort().join(',');
  ok(autoPatched === 'r1,r2,s1,u1', '本轮只探测 running(2) + stopped(1) + unknown 首探(1)，未探测 starting/stopping（实得 ' + autoPatched + '）');
  ok(patched.includes('s1'), '已停止组件也被周期心跳探测，端口归属会刷新');
  ok(!patched.includes('b1') && !patched.includes('b2'), '启动中 / 停止中组件交给动作期定向快探');
  const begin = cycles.find(c => c.phase === 'begin');
  const end = cycles.find(c => c.phase === 'end');
  ok(!!begin && !!end, '一轮探测前后各推一次 poll-cycle 事件');
  ok(begin && begin.mode === 'auto' && begin.scope === 3, 'begin.mode=auto / scope=3（本轮刷新的 running + stopped 组件数）');
  ok(begin && begin.pollMs === 3000, '事件携带当前生效的轮询间隔 3000ms');
  ok(begin && end && begin.seq === end.seq, 'begin / end 轮次序号一致，渲染器可据此丢弃过期 end');
  ok(begin && end && end.ts >= begin.ts, 'end 时间戳不早于 begin');
  const busyMs = (seenAt.get('end:' + (begin ? begin.seq : -1)) || 0) - (seenAt.get('begin:' + (begin ? begin.seq : -1)) || 0);
  ok(busyMs >= 600, '短探测被延长到可感知时长（实测 ' + busyMs + 'ms ≥ 600ms）');

  /* ===== B2：0 项 running/stopped 时整轮跳过，出现后立即恢复 ===== */
  section('B2 · 无 running/stopped 组件时不刷新');
  const zeroStates = { b1: 'starting', b2: 'stopping', u1: 'unknown' };
  const zeroSvcs = Object.keys(zeroStates).map(id => ({ id, name: id, port: 2 }));
  let zeroPatched = [], zeroCycles = [];
  const p0 = new ProbeScheduler({
    getServices: () => zeroSvcs,
    getSt: id => zeroStates[id],
    onPatch: (id) => zeroPatched.push(id),
    onCycle: c => zeroCycles.push(c),
    pollMs: 3000
  });
  const seq0 = p0.seq;
  await p0.sweep();
  await sleep(720);
  ok(zeroCycles.length === 0, '0 项 running/stopped 时不广播 begin/end（界面不会出现「正在刷新 0 项」）');
  ok(p0.seq === seq0, '0 项 running/stopped 时不推进轮次序号');
  ok(zeroPatched.join(',') === 'u1', '仍执行 unknown 首探分类，新增服务不会卡在 unknown（实得 ' + zeroPatched.join(',') + '）');
  ok(!zeroPatched.includes('b1') && !zeroPatched.includes('b2'), '启动中 / 停止中组件交给动作期定向快探');
  // 出现一个 stopped 组件后，下一轮立即恢复刷新（stopped 也会被周期探测）
  zeroStates.u1 = 'stopped';
  zeroPatched = []; zeroCycles = [];
  await p0.sweep();
  await sleep(720);
  ok(zeroCycles.some(c => c.phase === 'begin' && c.mode === 'auto' && c.scope === 1),
    '出现 stopped 组件后下一轮立即恢复刷新（scope=1）');
  ok(zeroPatched.includes('u1'), '恢复后该组件被真实探测');
  p0.stop();

  /* ===== C：手动全量刷新 ===== */
  section('C · 点击指示器 → 全量刷新（含已停止组件）');
  patched = []; cycles = [];
  await p.refreshAll();
  await sleep(720);
  const manualPatched = patched.slice().sort().join(',');
  ok(manualPatched === 'r1,r2,s1,u1', '手动刷新覆盖 stopped，仍跳过 starting/stopping（实得 ' + manualPatched + '）');
  const mBegin = cycles.find(c => c.phase === 'begin');
  ok(mBegin && mBegin.mode === 'manual' && mBegin.scope === 4, 'manual 轮次 scope=4，文案可区分「全量刷新」');
  patched = []; cycles = [];
  void p.refreshAll();
  await sleep(40);
  patched = [];
  await p.sweep();
  await sleep(40);
  ok(cycles.every(c => c.mode === 'manual'), '手动刷新期间自动心跳不插队，「正在全量刷新」态不会被瞬间盖掉');
  ok(patched.length === 0, '互斥期间自动 sweep 直接跳过，不重复探测');
  await sleep(720);   // 等 manualBusy 释放
  patched = [];
  await p.refreshAll();
  ok(patched.length === 4, '互斥释放后可再次手动全量刷新');
  await sleep(720);

  /* ===== D：设置间隔即时生效 + 三档钳制 + 可见时长自适应 ===== */
  section('D · 三档间隔 / 旧值迁移 / 1 秒档视觉节奏');
  cycles = [];
  p.setPollMs(1000);
  await sleep(60);
  ok(p.pollMs === 1000, 'setPollMs 更新调度器内部间隔');
  ok(cycles.some(c => c.phase === 'begin' && c.pollMs === 1000), '改设置后立刻跑一轮并推带新间隔的事件');
  await sleep(380);
  const b1s = cycles.find(c => c.phase === 'begin');
  const e1s = cycles.find(c => c.phase === 'end');
  const vis1s = b1s && e1s ? e1s.ts - b1s.ts : -1;
  ok(vis1s >= 240 && vis1s < 500,
    '1 秒档把「刷新中」自适应压到约 300ms，避免 62% 时间常亮（实测 ' + vis1s + 'ms）');
  p.setPollMs(50);
  ok(p.pollMs === 3000, '非法 / 过小间隔被夹回默认 3000ms');
  p.setPollMs(1500);
  ok(p.pollMs === 3000, '旧配置里的 1.5 秒迁移到默认 3 秒');
  p.setPollMs(5000);
  ok(p.pollMs === 5000, '5 秒档生效');
  p.stop();

  /* ===== E：全链路接线与资源 ===== */
  section('E · 全链路接线 / 样式 / 词典');
  const idx = src(path.join(MAIN, 'index.ts'));
  const storeMain = src(path.join(MAIN, 'store.ts'));
  const ipc = src(path.join(MAIN, 'ipc.ts'));
  const sched = src(path.join(MAIN, 'schedule.ts'));
  const preload = src(path.join(MAIN, 'preload.ts'));
  const apiSrc = src(path.join(R, 'api.ts'));
  const storeR = src(path.join(R, 'store.ts'));
  const services = src(path.join(R, 'components', 'ServicesPage.tsx'));
  const settings = src(path.join(R, 'components', 'SettingsPage.tsx'));
  const types = src(path.join(SRC, 'shared', 'types.ts'));
  const css = src(path.join(R, 'styles.css'));
  const probeSrc = src(path.join(MAIN, 'probe.ts'));
  const indicator = src(path.join(R, 'components', 'PollIndicator.tsx'));

  ok(/onCycle:\s*\(cycle\)\s*=>\s*store\.pollCycle\(cycle\)/.test(idx), '主进程入口把轮次事件接到 store.pollCycle');
  ok(/type:\s*'poll-cycle'/.test(storeMain) && /pollCycle\(cycle:/.test(storeMain), '主进程 store 广播 poll-cycle 事件');
  ok(/type:\s*'poll-cycle'/.test(apiSrc) && /c\.seq === p\.seq/.test(storeR), '渲染器订阅事件且用 seq 丢弃过期 end');
  ok(/pollMs: snap\.settings\.pollMs/.test(storeR), 'config-changed 后同步指示器显示的秒数');
  ok(/if \(typeof patch\.pollMs === 'number'\) applyPollMs\(patch\.pollMs\)/.test(ipc), 'set-settings 立即 applyPollMs（修复设置改了不生效）');
  ok(/refresh-status/.test(ipc) && /refreshAllStatus\(\)/.test(ipc), '注册手动全量刷新 IPC');
  ok(/applyPollMs/.test(sched) && /refreshAllStatus/.test(sched), 'schedule 暴露两个新入口');
  ok(/refreshStatus/.test(preload) && /refreshStatus/.test(apiSrc), 'preload / api 暴露 refreshStatus');
  ok(/PollCycle/.test(types), '共享类型定义 PollCycle');
  ok(/if \(!list\.length\) return/.test(probeSrc) && /0 项 running\/stopped 时整轮跳过/.test(probeSrc),
    '主进程 0 项 running/stopped 时整轮跳过刷新，不发 begin/end');
  ok(/void this\.classifyUnknown\(\)/.test(probeSrc), 'unknown 首探分类仍保留，新增服务不会卡在 unknown');
  ok(/data-cycles=\{poll\.cycles\}/.test(indicator), '指示器暴露已完成轮次数供验收核对');
  const config = src(path.join(MAIN, 'config.ts'));
  const proto = src(path.join(APP, '..', 'prototype', 'index.html'));
  ok(/POLL_INTERVALS: readonly number\[\] = \[1000, 3000, 5000\]/.test(types) && /DEFAULT_POLL_MS = 3000/.test(types),
    '共享常量定义三档间隔与默认 3 秒');
  ok(/POLL_INTERVALS\.includes\(settings\.pollMs\)/.test(config) && /DEFAULT_POLL_MS/.test(config),
    '读入旧配置时把 1.5 秒等非档位值迁移到默认 3 秒');
  ok(/minVisibleMs\(\)/.test(probeSrc) && /this\.pollMs \* 0\.3/.test(probeSrc),
    '最短可见时长随间隔自适应，1 秒档不会常亮');
  ok(/\[\['1000','1 秒'\],\['3000','3 秒'\],\['5000','5 秒'\]\]/.test(proto) && /pollMs:'3000'/.test(proto),
    '原型档位与默认值同步为 1/3/5 秒、默认 3 秒');
  const launcher = src(path.join(APP, 'scripts', 'launch-electron.js'));
  const pkg = src(path.join(APP, 'package.json'));
  ok(!/if \(isDev\)\s*\{[^}]*openDevTools/.test(idx), 'dev 分支内不再自动打开 DevTools 窗口');
  ok(/devToolsRequested/.test(idx) && /if \(devToolsRequested\) win\.webContents\.openDevTools/.test(idx),
    'DevTools 改为显式开关控制，且与 isDev 解耦');
  ok(/devtools='/.test(idx) && /rawArgs\.filter\(a => a !== '--devtools'\)/.test(launcher) &&
    /env\.DEVSTACK_DEVTOOLS = '1'/.test(launcher),
    '启动日志标记开关状态；--devtools 转环境变量且不透传 Chromium');
  ok(/"dev:tools"/.test(pkg) && /launch-electron\.js --dev --devtools/.test(pkg) &&
    !/"dev": "[^"]*--devtools/.test(pkg), 'npm run dev 默认关闭，dev:tools 才显式开启');
  const subPos = services.indexOf("t('按视觉顺序启动 / 停止')");
  const chipPos = services.indexOf('<PollIndicator');
  ok(subPos > 0 && chipPos > subPos && chipPos - subPos < 120, '指示器紧跟「按视觉顺序启动 / 停止」之后');
  ok(/running=\{autoCount\}/.test(services), '指示器接收 running + stopped 计数（autoCount）');
  ok(!/pollhint|自动刷新只覆盖已启动组件/.test(settings), '设置页已删除「状态轮询间隔」的补充说明行');
  ok(/\[\[1000, '1 秒'\], \[3000, '3 秒'\], \[5000, '5 秒'\]\]/.test(settings), '设置页提供 1 / 3 / 5 秒三档');
  ok(/\{t\(key\)\}/.test(settings), '档位标签走 t() 渲染边界，9 语可译');
  ok(!/pollring|pollspin|pollchip-dot/.test(css), 'v2.45：无旋转环 / 旋转动画 / 圆点，图标不再启停旋转');
  ok(/\.pollchip\.busy\{[^}]*background:#E8F1FF/.test(css), '刷新中提亮一档（浅蓝底 + 波形加深）');
  ok(/\.pollchip\.busy\[data-mode="manual"\]\{[^}]*background:#DCE9FF/.test(css),
    '手动全量刷新比自动心跳再深一档');
  ok(/@keyframes ekgdraw/.test(css) && /\.busy \.ekg-main\{animation:ekgdraw/.test(css),
    '忙碌时主波形走纸式重画一次（不旋转）');
  ok(/prefers-reduced-motion:reduce\)\{\.panelhead \.pollchip\.busy \.ekg-main\{animation:none\}\}/.test(css),
    '尊重系统「减少动态效果」偏好');
  ok(/panelhead \.pollchip\{[^}]*width:22px[^}]*height:22px/.test(css) && !/\.polltext\{/.test(css),
    '图标按钮固定 22×22，已删除文字省略号规则（v2.44 无可见文案）');
  ok(!/polltext|pollring|pollchip-dot|<Icon /.test(indicator), '指示器不再渲染可见文字 / 旋转环 / 圆点 / sprite 图标');
  ok(/<svg className="ekg"/.test(indicator) && /className="ekg-main"/.test(indicator) && /className="ekg-sub"/.test(indicator),
    '指示器内联「双线脉搏」SVG（主波 + 副波，CSS 可直达 path 做走纸动画）');
  ok(/pathLength="1"/.test(indicator) && /stroke-dasharray:1;stroke-dashoffset:0/.test(css),
    '主波形按 pathLength=1 归一化，dashoffset 1→0 重画一次');
  ok(/aria-label=\{aria\}/.test(indicator),
    '状态文案移入 aria-label，悬停 / 读屏仍可获知（已移除鼠标悬停 title）');
  ok(/standby \? ' stby' : ''/.test(indicator) && /\.pollchip\.stby\{[^}]*color:#94A3B8/.test(css),
    '0 项已启动时图标灰化，暂停态与空闲态视觉可区分');
  ok(Object.keys(dict).length === 788, '词典 788 键');
  const NEW_KEYS = [
    '正在刷新 {n} 项服务', '正在全量刷新 {n} 项服务',
    '每 {s} 秒自动刷新', '自动刷新已暂停',
    '自动探测已启动与已停止的组件；点击可全量刷新所有可操作服务',
    '上次刷新 {time}', '5 秒'
  ];
  ok(!dict['每 {s} 秒自动刷新 · 已启动 {n} 项'] && !dict['暂无已启动服务 · 自动刷新已暂停'] &&
    !dict['自动刷新只覆盖已启动组件，服务列表标题栏可见刷新状态'],
    'v2.43 已清掉带补充说明的旧键，词典无死文案');
  ok(NEW_KEYS.every(k => Array.isArray(dict[k]) && dict[k].length === 9), '7 条新文案均收录 9 语');
  ok(NEW_KEYS.every(k => dict[k] && dict[k].every(v => typeof v === 'string' && v.trim())), '7 条新文案 9 语无空值');
  ok(NEW_KEYS.every(k => LATIN.every((_, j) => !CJK.test(dict[k][[2, 4, 5, 6, 7, 8][j]]))), '7 条新文案在 6 个非汉字语种下无中文残留');
  ok(NEW_KEYS.every(k => LATIN.every((_, j) => {
    const v = dict[k][[2, 4, 5, 6, 7, 8][j]];
    return !/\uFFFD/.test(v) && (/\{n\}|\{s\}|\{time\}/.test(k) ? /\{n\}|\{s\}|\{time\}/.test(v) : true);
  })), '带占位符的译文保留 {n}/{s}/{time} 占位符');

  console.log('\n============================================================');
  console.log('== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  if (fails.length) { console.log('未达标项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log('============================================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  fs.writeSync(2, 'POLL TEST ERROR ' + (e && e.stack ? e.stack : String(e)) + '\n');
  process.exit(1);
});
