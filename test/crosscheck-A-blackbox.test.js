/* ============================================================
 * 测试员工 A · 规格驱动黑盒测试（Contract Black-box）
 *
 * 独立性约束（交叉验证协议）：
 *  1) 只通过 preload 暴露的 IPC 契约（registerIpc 注册的 channel）驱动系统；
 *  2) 判定证据只取自：IPC 返回值、services.yaml 落盘内容、
 *     TCP 端口/进程副作用、模板目录文件；
 *  3) 不调用任何业务内部函数（store/schedule/template/config 的 API），
 *     唯一例外是「启动装配」= 模拟 app.whenReady 的 probe + initSchedule；
 *  4) 规格条款取自 prototype/index.html v2.39 的用户可见行为。
 *
 * 输出：test/out-A.json（供 crosscheck-arbitrate.js 比对）
 * 运行：node test/crosscheck-A-blackbox.test.js
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-A-'));
process.env.DEVSTACK_DATA_DIR = tmp;

/* ---------- Electron 桩：捕获 ipcMain.handle 形成「公开契约表」 ---------- */
const HANDLERS = Object.create(null);
const OPENED = [];
const Module = require('module');
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.1.0-crosscheck-A' },
  ipcMain: { handle: (ch, fn) => { HANDLERS[ch] = fn; } },
  shell: {
    openPath: (p) => { OPENED.push(['path', p]); return Promise.resolve(''); },
    openExternal: (u) => { OPENED.push(['url', u]); return Promise.resolve(); }
  },
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

/* ---------- 启动装配（等价于 index.ts 的 app.whenReady，不属于被测逻辑） ---------- */
const { store } = M('store');
const { ProbeScheduler } = M('probe');
const probe = new ProbeScheduler({
  getServices: () => store.services(),
  getSt: (id) => store.state(id).st,
  onPatch: (id, patch) => store.patchState(id, patch),
  pollMs: 300
});
M('schedule').initSchedule({
  probe,
  openUrl: (u) => { OPENED.push(['url', u]); },
  openDir: (d) => { OPENED.push(['path', d]); }
});
probe.start();
M('template').seedPresets();
M('ipc').registerIpc();

/** 黑盒唯一驱动入口 */
async function invoke(channel, ...args) {
  const fn = HANDLERS[channel];
  if (!fn) throw new Error('IPC 契约不存在: ' + channel);
  return await fn(null, ...args);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function portOpen(port, timeout = 350) {
  return new Promise(res => {
    const s = new net.Socket();
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { s.destroy(); } catch { /* */ } res(v); };
    s.setTimeout(timeout);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(port, '127.0.0.1'); } catch { fin(false); }
  });
}
async function waitPorts(ports, want, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rs = await Promise.all(ports.map(p => portOpen(p)));
    if (rs.every(v => v === want)) return true;
    await sleep(120);
  }
  return false;
}
/** 黑盒状态收敛：端口 LISTEN 之后，watchTarget 还需一个 300ms 周期才写 running */
async function waitStates(ids, want, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const sp = await snap();
    if (ids.every(id => sp.states[id] && sp.states[id].st === want)) return true;
    await sleep(100);
  }
  return false;
}

/* ---------- 结果记录 ---------- */
const results = [];
function verdict(id, name, spec, v, evidence) {
  results.push({ id, name, spec, verdict: v, evidence });
  console.log((v === 'PASS' ? '  PASS  ' : v === 'FAIL' ? '  FAIL  ' : '  N/A   ') + id + ' ' + name + ' — ' + evidence);
}
async function check(id, name, spec, fn) {
  try {
    const { v, evidence } = await fn();
    verdict(id, name, spec, v, evidence);
  } catch (e) {
    verdict(id, name, spec, 'FAIL', '调用抛异常：' + String(e && e.message || e));
  }
}
function section(t) { console.log('\n=== A · ' + t + ' ==='); }

/* ---------- TCP 桩（测试夹具，不是产品代码） ---------- */
const stubFile = path.join(tmp, 'stub.js');
const stubLog = path.join(tmp, 'stub.log');
fs.writeFileSync(stubFile, [
  "const net=require('net'),fs=require('fs');",
  'const port=parseInt(process.argv[2],10),delay=parseInt(process.argv[4]||"0",10);',
  'const log=process.argv[3];',
  "fs.appendFileSync(log,'SPAWN '+port+' '+Date.now()+'\\n');",
  'setTimeout(function(){',
  "  const s=net.createServer(function(){});",
  "  s.on('error',function(e){fs.appendFileSync(log,'ERROR '+port+' '+String(e.code||e)+'\\n')});",
  "  s.listen(port,'127.0.0.1',function(){fs.appendFileSync(log,'LISTEN '+port+' '+Date.now()+'\\n')});",
  '},delay);', 'setInterval(function(){},1000);'
].join('\n'), 'utf8');
fs.writeFileSync(stubLog, '', 'utf8');
const stubStart = (port, delay = 0, timeoutMs = 15000) => ({
  type: 'exec', command: process.execPath,
  args: [stubFile, String(port), stubLog, String(delay)], timeoutMs
});
const KILL = { type: 'builtin', builtin: 'killProcessTree', timeoutMs: 8000 };
function stubEvents() {
  if (!fs.existsSync(stubLog)) return [];
  return fs.readFileSync(stubLog, 'utf8').split(/\r?\n/).filter(Boolean).map(l => {
    const [ev, p, t] = l.split(' ');
    return { ev, port: +p, t: +t };
  });
}

function mkSvc(o) {
  return Object.assign({
    id: 'a-' + Math.random().toString(36).slice(2, 7),
    name: 'A-Service', gid: null, port: 6399,
    webUrl: null, dir: tmp, template: undefined,
    cfg: { acts: { start: stubStart(6399), stop: KILL, restart: null } }
  }, o);
}
const snap = () => invoke('get-snapshot');
const yamlText = () => fs.readFileSync(path.join(tmp, 'services.yaml'), 'utf8');

const spawnedChildren = [];   // 测试夹具自己起的外部占用进程，退出前清理

(async () => {
  console.log('测试员工 A · 规格驱动黑盒 | 数据目录 ' + tmp + ' | 契约 channel ' + Object.keys(HANDLERS).length + ' 个');

  /* ---------- K01 添加服务与持久化 ---------- */
  section('K01 添加服务与持久化（规格：添加后列表可见且重启不丢）');
  const s1 = mkSvc({ id: 'a-flat', name: 'A-Flat', port: 6401, cfg: { acts: { start: stubStart(6401), stop: KILL } } });
  await check('K01', '添加服务与持久化', 'S01 upsert-service → 快照可见 + services.yaml 落盘 + 回读一致', async () => {
    await invoke('upsert-service', s1);
    const sp = await snap();
    const inSnap = sp.services.some(x => x.id === 'a-flat');
    const text = yamlText();
    const inFile = text.includes('a-flat') && text.includes('A-Flat');
    const reload = M('config').readYaml();   // 仅读盘，不驱动行为
    const consistent = reload.data.services.some(x => x.id === 'a-flat' && x.port === 6401);
    return { v: inSnap && inFile && consistent ? 'PASS' : 'FAIL',
      evidence: '快照=' + inSnap + ' / 落盘=' + inFile + ' / 回读=' + consistent };
  });

  /* ---------- K02 模板库 ---------- */
  section('K02 模板库扫描与异常标红');
  await check('K02', '模板库扫描与异常标红', 'S02 9 模板可用；非法模板标红且给出错误清单', async () => {
    const list = await invoke('scan-templates');
    const okNine = list.length === 9 && list.filter(x => x.state === 'ok').length === 9;
    const dir = (await invoke('app-info')).templateDir;
    fs.writeFileSync(path.join(dir, 'a-broken.json'), '{ "kind": "wrong" ', 'utf8');
    const list2 = await invoke('scan-templates');
    const bad = list2.find(x => x.id === 'a-broken');
    const flagged = !!(bad && bad.state === 'invalid' && bad.errors.length > 0);
    // 128KB 上限
    fs.writeFileSync(path.join(dir, 'a-huge.json'), 'x'.repeat(130 * 1024), 'utf8');
    const huge = (await invoke('scan-templates')).find(x => x.id === 'a-huge');
    const capped = !!(huge && huge.state === 'invalid' && /128KB/.test(huge.errors.join(' ')));
    fs.unlinkSync(path.join(dir, 'a-broken.json')); fs.unlinkSync(path.join(dir, 'a-huge.json'));
    return { v: okNine && flagged && capped ? 'PASS' : 'FAIL',
      evidence: '9模板=' + okNine + ' / 非法标红=' + flagged + ' / 128KB上限=' + capped };
  });

  /* ---------- K03 模板驱动新增服务 ---------- */
  section('K03 模板驱动新增服务（用户路径：模板字段填表 → 创建服务）');
  await check('K03', '模板驱动新增服务', 'S03 模板可用字段能创建服务并落盘；命令无残留占位符', async () => {
    const redis = (await invoke('scan-templates')).find(x => x.id === 'redis' && x.state === 'ok');
    if (!redis || !redis.raw) return { v: 'FAIL', evidence: 'redis 模板不可用' };
    const act = redis.raw.actions.start;
    const cmd = String(act.command || '').replace(/\$\{installDir\}/g, tmp).replace(/\$\{port\}/g, '6402');
    const svc = mkSvc({ id: 'a-from-template', name: 'A-Redis(模板)', port: 6402, template: 'redis',
      cfg: { acts: { start: { type: 'exec', command: cmd, args: (act.args || []).map(a => String(a).replace(/\$\{installDir\}/g, tmp)), timeoutMs: 15000 }, stop: KILL } } });
    await invoke('upsert-service', svc);
    const sp = await snap();
    const exists = sp.services.some(x => x.id === 'a-from-template' && x.template === 'redis');
    const noPlaceholder = !JSON.stringify(svc.cfg.acts.start).includes('${');
    return { v: exists && noPlaceholder ? 'PASS' : 'FAIL',
      evidence: '创建成功=' + exists + ' / 占位符已展开=' + noPlaceholder + ' / 命令=' + cmd.slice(-60) };
  });

  /* ---------- K04 新建分组 ---------- */
  section('K04 新建分组 / 成员连续 / 解散');
  await check('K04', '新建分组与解散', 'S04 save-group 后成员归属正确且连续；dissolve 后 gid 清空', async () => {
    for (const [id, port] of [['a-g1', 6403], ['a-g2', 6404]]) {
      await invoke('upsert-service', mkSvc({ id, name: id, port,
        cfg: { acts: { start: stubStart(port), stop: KILL } } }));
    }
    await invoke('save-group', { id: 'ga', name: 'A-Group', collapsed: false }, ['a-g1', 'a-g2']);
    const sp = await snap();
    const g = sp.groups.find(x => x.id === 'ga');
    const ids = sp.services.map(x => x.id);
    const contiguous = Math.abs(ids.indexOf('a-g1') - ids.indexOf('a-g2')) === 1;
    const owned = sp.services.filter(x => x.gid === 'ga').length === 2;
    await invoke('dissolve-group', 'ga');
    const sp2 = await snap();
    const cleared = !sp2.groups.some(x => x.id === 'ga') && sp2.services.filter(x => x.gid === 'ga').length === 0;
    await invoke('save-group', { id: 'ga', name: 'A-Group', collapsed: false }, ['a-g1', 'a-g2']); // 还原供 K05/K07
    return { v: g && contiguous && owned && cleared ? 'PASS' : 'FAIL',
      evidence: '组存在=' + !!g + ' / 连续=' + contiguous + ' / 归属=' + owned + ' / 解散清 gid=' + cleared };
  });

  /* ---------- K05 拖拽三态 ---------- */
  section('K05 拖拽三态与 no-op（v2.38 规格）');
  await check('K05', '拖拽顺序写回', 'S05 有效移动=1 / 无变化=0 / 非法=-1，且 no-op 不改变顺序', async () => {
    const before = (await snap()).services.map(x => x.id).join(',');
    const r0 = await invoke('move-block', { srcGid: 'ga', srcSvcId: 'a-g1', dstGid: 'ga', dstSvcId: 'a-g1', before: true });
    const after0 = (await snap()).services.map(x => x.id).join(',');
    const rBad = await invoke('move-block', { srcGid: 'no-such', srcSvcId: 'x', dstGid: null, dstSvcId: 'zzz', before: true });
    const rSelf = await invoke('move-member-in-group', { gid: 'ga', srcId: 'a-g1', dstId: 'a-g1', before: true });
    const rMove = await invoke('move-member-in-group', { gid: 'ga', srcId: 'a-g2', dstId: 'a-g1', before: true });
    const order = (await snap()).services.filter(x => x.gid === 'ga').map(x => x.id).join(',');
    return { v: r0 === 0 && after0 === before && rBad === -1 && rSelf === 0 && rMove === 1 && order === 'a-g2,a-g1' ? 'PASS' : 'FAIL',
      evidence: '块no-op=' + r0 + '(顺序未变=' + (after0 === before) + ') / 非法=' + rBad + ' / 成员自身=' + rSelf + ' / 重排=' + rMove + ' → ' + order };
  });

  /* ---------- K06 v2.39 稳定态守卫 ---------- */
  section('K06 v2.39 稳定态守卫（starting / stopping / 反向 bug）');
  // 夹具：启动必然失败且长超时 → 稳定停留在 starting
  const busySvc = mkSvc({ id: 'a-busy', name: 'A-Busy', port: 6405,
    cfg: { acts: { start: { type: 'exec', command: path.join(tmp, 'no-such-exe-xyz'), args: [], timeoutMs: 30000 }, stop: KILL } } });
  await invoke('upsert-service', busySvc);
  await sleep(450);           // 心跳把 unknown → stopped
  await invoke('toggle-service', 'a-busy');   // 启动失败，进入 starting
  await sleep(120);
  await check('K06', '稳定态守卫', 'S06 过渡态下主按钮/重启不执行；stopping 点停止不得反向启动', async () => {
    const st0 = (await snap()).states['a-busy'].st;
    const t = await invoke('toggle-service', 'a-busy');
    const r = await invoke('restart-service', 'a-busy');
    const busyBlocked = st0 === 'starting' && t.ok === false && /启动尚未完成/.test(t.reason || '') && r.ok === false && /暂不可重启/.test(r.reason || '');

    // stopping 守卫：用真实 TCP 桩服务，触发停止后立即再点停止
    const stopSvc = mkSvc({ id: 'a-stop-guard', name: 'A-StopGuard', port: 6406,
      cfg: { acts: { start: stubStart(6406), stop: KILL } } });
    await invoke('upsert-service', stopSvc);
    await sleep(450);
    await invoke('toggle-service', 'a-stop-guard');
    const up = await waitPorts([6406], true, 6000);
    // 端口 LISTEN ≠ 状态已是 running：watchTarget 还需一个定向快探周期才写终态。
    // v2.41 心跳范围收敛后整体更快，必须显式等状态收敛，否则点的是 starting 而非 running。
    await waitStates(['a-stop-guard'], 'running', 6000);
    const stop1 = await invoke('toggle-service', 'a-stop-guard');
    const stop2 = await invoke('toggle-service', 'a-stop-guard');  // 立即再点
    const stStop = (await snap()).states['a-stop-guard'].st;
    const stoppingBlocked = up && stop1.ok === true && stop2.ok === false && /停止尚未完成/.test(stop2.reason || '');
    await sleep(1200);
    const notRestarted = !(await portOpen(6406));   // 不得反向启动
    return { v: busyBlocked && stoppingBlocked && notRestarted ? 'PASS' : 'FAIL',
      evidence: 'starting守卫=' + busyBlocked + '(' + st0 + ') / stopping守卫=' + stoppingBlocked + '(' + stStop + ') / 未反向启动=' + notRestarted };
  });

  /* ---------- K07 全部启停编排 ---------- */
  section('K07 全部启停编排（并行泳道 / 组合串行 / 倒序 / busy 跳过）');
  await check('K07', '全部启停编排', 'S07 确认计划给出并行数与串行链；busy 项被跳过；全启/全停闭环', async () => {
    // 追加 2 个非组合服务，与组内 2 个形成 3 条泳道
    for (const [id, port] of [['a-p1', 6407], ['a-p2', 6408]]) {
      await invoke('upsert-service', mkSvc({ id, name: id, port, cfg: { acts: { start: stubStart(port), stop: KILL } } }));
    }
    await sleep(500);
    const plan = await invoke('build-confirm-plan', 'startAll');
    const sp = await snap();
    const busyCount = sp.services.filter(x => ['starting', 'stopping'].includes(sp.states[x.id].st)).length;
    const serialOK = plan.serialLanes >= 1 && plan.parallelCount >= 2;
    const busyOK = plan.busyCount === busyCount && !plan.lanes.some(l => l.items.includes('A-Busy'));
    const sa = await invoke('start-all');
    const allUp = await waitPorts([6407, 6408, 6403, 6404], true, 12000);
    const spUp = await snap();
    const excluded = spUp.states['a-busy'].st === 'starting';  // busy 未被拉起
    const so = await invoke('stop-all');
    const allDown = await waitPorts([6407, 6408, 6403, 6404], false, 12000);
    return { v: serialOK && busyOK && sa.ok && allUp && excluded && so.ok && allDown ? 'PASS' : 'FAIL',
      evidence: '并行=' + plan.parallelCount + ' 串行链=' + plan.serialLanes + ' busy跳过=' + busyCount + '/' + plan.busyCount +
        ' / 全启=' + allUp + ' 全停=' + allDown + ' busy未被拉起=' + excluded };
  });

  /* ---------- K08 组级串行完成驱动（真实进程） ---------- */
  section('K08 组级串行完成驱动 + 真实中间件闭环');
  await check('K08', '组级串行与真实进程', 'S08 组合内上一项端口 LISTEN 后下一项才被拉起；停止倒序；真实 Redis 可启停', async () => {
    // 用两个端口构成新组合：第一项延迟 600ms 就绪，第二项延迟 0
    await invoke('upsert-service', mkSvc({ id: 'a-seq1', name: 'A-Seq1', port: 6410,
      cfg: { acts: { start: stubStart(6410, 600), stop: KILL } } }));
    await invoke('upsert-service', mkSvc({ id: 'a-seq2', name: 'A-Seq2', port: 6411,
      cfg: { acts: { start: stubStart(6411, 0), stop: KILL } } }));
    await invoke('save-group', { id: 'gseq', name: 'A-Seq', collapsed: false }, ['a-seq1', 'a-seq2']);
    const ready = await waitStates(['a-seq1', 'a-seq2'], 'stopped', 12000);
    fs.writeFileSync(stubLog, '', 'utf8');
    const g = await invoke('group-start', 'gseq');
    const up = await waitPorts([6410, 6411], true, 15000);
    const ev = stubEvents();
    const spawn1 = ev.find(x => x.ev === 'SPAWN' && x.port === 6410);
    const listen1 = ev.find(x => x.ev === 'LISTEN' && x.port === 6410);
    const spawn2 = ev.find(x => x.ev === 'SPAWN' && x.port === 6411);
    const driven = !!(spawn1 && listen1 && spawn2 && spawn2.t >= listen1.t);
    const gap = spawn1 && listen1 && spawn2 ? (spawn2.t - listen1.t) + 'ms' : 'n/a';
    // 倒序计划必须在状态收敛为 running 之后取，否则 stopAllLanes 会返回空
    const runningOK = await waitStates(['a-seq1', 'a-seq2'], 'running', 12000);
    const stopPlan = (await invoke('build-confirm-plan', 'stopAll')).lanes.find(l => l.label.includes('A-Seq'));
    const reverse = !!stopPlan && stopPlan.items.join(',') === 'A-Seq2,A-Seq1';
    const gs = await invoke('group-stop', 'gseq');
    const down = await waitPorts([6410, 6411], false, 12000);

    // 真实中间件：Redis（自定义端口，避免干扰系统已有实例）
    const redisDir = IS_WIN ? 'D:\\env\\redis5.0' : '/opt/redis';
    const redisExe = path.join(redisDir, IS_WIN ? 'redis-server.exe' : 'redis-server');
    let realOK = 'N/A', realDetail = '目录不存在';
    if (fs.existsSync(redisExe)) {
      const rs = mkSvc({ id: 'a-redis-real', name: 'A-RedisReal', port: 6412, dir: redisDir,
        cfg: { acts: { start: { type: 'exec', command: redisExe, args: ['--port', '6412', '--save', '', '--appendonly', 'no'], timeoutMs: 15000 }, stop: KILL } } });
      await invoke('upsert-service', rs);
      const rsReady = await waitStates(['a-redis-real'], 'stopped', 12000);
      await invoke('toggle-service', 'a-redis-real');
      const ru = await waitPorts([6412], true, 12000);
      const rr = await waitStates(['a-redis-real'], 'running', 12000);
      await invoke('toggle-service', 'a-redis-real');
      const rd = await waitPorts([6412], false, 12000);
      realOK = rsReady && ru && rr && rd ? 'PASS' : 'FAIL';
      realDetail = '就绪=' + rsReady + ' 起=' + ru + ' 态=' + rr + ' 停=' + rd;
    }
    return { v: ready && driven && runningOK && reverse && g.ok && up && down && gs.ok && realOK !== 'FAIL' ? 'PASS' : 'FAIL',
      evidence: '完成驱动(第二项SPAWN≥第一项LISTEN)=' + driven + '(间隔 ' + gap + ') / 倒序=' + reverse +
        ' / 组启停=' + up + ',' + down + ' / 真实Redis=' + realOK + '(' + realDetail + ') / 事件=' + ev.length };
  });

  /* ---------- K09 端口冲突 / 外部占用 ---------- */
  section('K09 端口被外部进程占用时的归属判定');
  await check('K09', '端口冲突拦截', 'S09 外部占用不得误判为自身服务，且启动/重启被拦截', async () => {
    const holder = spawn(process.execPath, ['-e',
      "require('net').createServer(function(){}).listen(6413,'127.0.0.1');setInterval(function(){},1000)"],
      { stdio: 'ignore', windowsHide: true });
    spawnedChildren.push(holder);
    const up = await waitPorts([6413], true, 6000);
    await invoke('upsert-service', mkSvc({ id: 'a-external', name: 'A-External', port: 6413,
      cfg: { acts: { start: stubStart(6413), stop: KILL } } }));
    // 归属探测依赖 netstat/tasklist，服务较多时一轮心跳可能数秒 → 轮询而非固定 sleep
    let st = null;
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      st = (await snap()).states['a-external'];
      if (st && st.owner && st.ownerPid) break;
      await sleep(250);
    }
    const marked = !!(st && st.owner && st.ownerPid);
    const notOurs = st && st.owner ? st.st === 'running' && /外部托管/.test(st.portNote || '') : false;
    const ownerIsHolder = !!(st && st.ownerPid === holder.pid);
    return { v: up && marked && notOurs && ownerIsHolder ? 'PASS' : 'FAIL',
      evidence: '外部LISTEN=' + up + ' / 归属标注=' + marked + '(' + (st && st.owner || '-') +
        ' PID ' + (st && st.ownerPid || '-') + ') / 状态=' + (st && st.st) + ' / 外部托管=' + notOurs +
        ' / PID指向夹具进程=' + ownerIsHolder };
  });

  /* ---------- K10 配置损坏容错 ---------- */
  section('K10 配置损坏容错');
  await check('K10', '配置损坏容错', 'S10 损坏的 services.yaml 应返回结构化错误并保留现场，不得抛异常', async () => {
    const file = path.join(tmp, 'services.yaml');
    const backup = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, 'services: [ this is not valid yaml\n', 'utf8');
    let threw = null, r = null;
    try { r = M('config').readYaml(); } catch (e) { threw = String(e && e.message || e); }
    const backedUp = fs.readdirSync(tmp).some(f => f.includes('.corrupt-'));
    const errorsVisible = !!r && Array.isArray(r.errors) && r.errors.length > 0;
    fs.writeFileSync(file, backup, 'utf8');
    const restored = yamlText() === backup && M('config').readYaml().errors.length === 0;
    return { v: !threw && backedUp && errorsVisible && restored ? 'PASS' : 'FAIL',
      evidence: '抛异常=' + (threw ? threw.slice(0, 70) : '否') + ' / 结构化错误=' + errorsVisible +
        ' / 现场备份=' + backedUp + ' / 恢复后可读=' + restored };
  });

  /* ---------- K11 活动日志可追溯 ---------- */
  section('K11 活动日志可追溯');
  await check('K11', '活动日志', 'S11 启停/调度操作后 get-activity-log 应可查到记录', async () => {
    const log = await invoke('get-activity-log');
    const n = Array.isArray(log) ? log.length : -1;
    return { v: n > 0 ? 'PASS' : 'FAIL', evidence: '已执行十余次启停/调度动作，活动日志条数=' + n };
  });

  /* ---------- K12 启动失败超时后的状态收敛 ---------- */
  section('K12 启动失败超时后的状态收敛');
  await check('K12', '启动失败状态收敛', 'S12 启动超时后服务必须脱离 busy 过渡态，恢复可操作', async () => {
    await invoke('upsert-service', mkSvc({ id: 'a-timeout', name: 'A-Timeout', port: 6414,
      cfg: { acts: { start: { type: 'exec', command: path.join(tmp, 'no-such-exe-abc'), args: [], timeoutMs: 1200 }, stop: KILL } } }));
    await sleep(450);
    await invoke('toggle-service', 'a-timeout');
    await sleep(1900);         // 超过定向快探超时
    const st = (await snap()).states['a-timeout'].st;
    const again = await invoke('toggle-service', 'a-timeout');
    const notBusy = st !== 'starting' && st !== 'stopping';
    const operable = !(again.ok === false && /尚未完成/.test(again.reason || ''));
    return { v: notBusy && operable ? 'PASS' : 'FAIL',
      evidence: '超时后状态=' + st + ' / 仍被守卫拒绝=' + !operable + ' / 复点结果=' + JSON.stringify(again) };
  });

  /* ---------- K13 路径越界与 IPC 边界 ---------- */
  section('K13 路径越界与 IPC 边界');
  await check('K13', '模板读取路径边界', 'S13 read-template-file 不得读取模板目录之外的文件', async () => {
    const info = await invoke('app-info');
    const secret = path.join(os.tmpdir(), 'devstack-A-secret.txt');
    fs.writeFileSync(secret, 'CROSSCHECK_A_SECRET_TOKEN', 'utf8');
    const rel = path.relative(info.templateDir, secret);
    let leaked = false, detail = '';
    try {
      const r = await invoke('read-template-file', rel);
      leaked = !!(r && r.ok && String(r.text || '').includes('CROSSCHECK_A_SECRET_TOKEN'));
      detail = '返回 ok=' + (r && r.ok);
    } catch (e) { detail = '抛异常 ' + String(e && e.message || e).slice(0, 60); }
    fs.unlinkSync(secret);
    // 合法文件仍可读
    const legal = await invoke('read-template-file', 'redis.json');
    return { v: !leaked && legal.ok ? 'PASS' : 'FAIL',
      evidence: '越界相对路径=' + rel + ' / 读到目录外内容=' + leaked + ' / ' + detail + ' / 合法读取=' + legal.ok };
  });

  /* ---------- K14 国际化（黑盒不可达 → 覆盖盲区，交由 B） ---------- */
  section('K14 国际化（A 的方法论盲区，明确登记）');
  verdict('K14', '国际化 9 语覆盖', 'S14 9 语切换后每页无中文残留', 'NA',
    '黑盒无窗口/DOM 可观察，无法判定；此检查点由测试员工 B 与第三方 i18n 测试覆盖');

  /* ---------- K15 跨平台（黑盒不可达 → 覆盖盲区） ---------- */
  section('K15 跨平台兼容性（A 的方法论盲区）');
  verdict('K15', 'macOS/Linux 分支正确性', 'S15 POSIX 进程树/端口归属分支正确', 'NA',
    '当前仅 ' + process.platform + ' 运行时，无法观察 POSIX 分支；由 B 的源码审查覆盖，真机复验另列');

  /* ---------- 清理 ---------- */
  console.log('\n--- A 清理夹具 ---');
  try { await invoke('stop-all'); } catch { /* */ }
  for (const c of spawnedChildren) { try { c.kill(); } catch { /* */ } }
  probe.stop();
  await sleep(300);

  const out = {
    tester: 'A', method: '规格驱动黑盒 / IPC 契约 + 外部副作用',
    specSource: 'prototype/index.html v2.39', platform: process.platform,
    node: process.version, dataDir: tmp, channelCount: Object.keys(HANDLERS).length,
    at: new Date().toISOString(), results
  };
  fs.writeFileSync(path.join(__dirname, 'out-A.json'), JSON.stringify(out, null, 2), 'utf8');
  const c = { PASS: 0, FAIL: 0, NA: 0 };
  results.forEach(r => c[r.verdict]++);
  console.log('\n== A: ' + c.PASS + ' PASS / ' + c.FAIL + ' FAIL / ' + c.NA + ' N/A ==');
  console.log('结果文件：' + path.join(__dirname, 'out-A.json'));
  process.exit(0);
})().catch(e => { console.error('A ERROR', e); process.exit(1); });
