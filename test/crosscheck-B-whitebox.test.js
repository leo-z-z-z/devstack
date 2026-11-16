/* ============================================================
 * 测试员工 B · 实现驱动白盒 + 故障注入（White-box / Fault Injection）
 *
 * 独立性约束（交叉验证协议）：
 *  1) 不读取 A 的任何结果、不复用 A 的断言；仅按同一份检查点编号 K01–K15 独立判定；
 *  2) 直接 require 主进程内部模块（config/store/schedule/probe/runner/template），
 *     并对源码文本做静态审查；
 *  3) 主动构造 A 不会构造的故障：非法落盘、并发重入、损坏配置、
 *     无心跳下的动作超时、路径前缀绕过、POSIX 分支矛盾、9 语译文替换；
 *  4) 判定证据必须来自真实执行结果或源码可验证事实，不做推测性结论。
 *
 * 输出：test/out-B.json（供 crosscheck-arbitrate.js 比对）
 * 运行：node test/crosscheck-B-whitebox.test.js
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-B-'));
process.env.DEVSTACK_DATA_DIR = tmp;

const Module = require('module');
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.1.0-crosscheck-B' },
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
const SRC = path.join(__dirname, '..', 'src', 'main');
const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const M = (n) => require(path.join(DIST, 'main', n + '.js'));
const srcText = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const config = M('config');
const template = M('template');
const { store } = M('store');
const schedule = M('schedule');
const probeMod = M('probe');
const runner = M('runner');
const logs = M('logs').logs;

const results = [];
function verdict(id, name, method, v, evidence) {
  results.push({ id, name, method, verdict: v, evidence });
  console.log((v === 'PASS' ? '  PASS  ' : v === 'FAIL' ? '  FAIL  ' : '  N/A   ') + id + ' ' + name + ' — ' + evidence);
}
async function check(id, name, method, fn) {
  try {
    const { v, evidence } = await fn();
    verdict(id, name, method, v, evidence);
  } catch (e) {
    verdict(id, name, method, 'FAIL', '白盒执行抛异常：' + String(e && e.stack || e).slice(0, 180));
  }
}
function section(t) { console.log('\n=== B · ' + t + ' ==='); }

/* ---------- 可调 probe 桩：精确控制「就绪」时机，用于确定性重入实验 ---------- */
const ev = [];
let hitDelay = 0;
const fakeProbe = {
  registerOwnedPid(pid) { ev.push({ ev: 'start', pid, t: Date.now() }); },
  watchTarget(id, svc, expect, timeoutMs, onHit) {
    ev.push({ ev: 'watch', id, expect, t: Date.now() });
    const fire = () => { ev.push({ ev: 'hit', id, expect, t: Date.now() }); onHit({ st: expect }); };
    if (hitDelay === 0) fire(); else setTimeout(fire, hitDelay);
    return () => {};
  }
};
function resetEv() { ev.length = 0; }

function mkSvc(o) {
  return Object.assign({
    id: 'b-' + Math.random().toString(36).slice(2, 7), name: 'B-Service', gid: null,
    port: 6599, webUrl: null, dir: tmp,
    cfg: { acts: {
      start: { type: 'exec', command: path.join(tmp, 'no-such-bin'), args: [], timeoutMs: 1000 },
      stop: { type: 'builtin', builtin: 'killProcessTree' },
      restart: null
    } }
  }, o);
}
function setSt(id, st, extra = {}) { store.patchState(id, Object.assign({ st }, extra)); }

(async () => {
  console.log('测试员工 B · 白盒 / 故障注入 | 数据目录 ' + tmp + ' | Node ' + process.version);
  template.seedPresets();

  /* ---------- K01 非法输入落盘（A 只测合法路径） ---------- */
  section('K01 写路径输入校验（故障注入）');
  await check('K01', '添加服务与持久化', '注入 port 越界 / 非法 id / 空命令 / 非字符串 args，观察是否落盘污染', async () => {
    const bad = [
      mkSvc({ id: 'BAD ID', name: 'bad-port', port: 70000 }),
      mkSvc({ id: 'b-nullcmd', name: 'null-cmd', cfg: { acts: { start: { type: 'exec', command: '' } } } }),
      mkSvc({ id: 'b-badargs', name: 'bad-args', cfg: { acts: { start: { type: 'exec', command: 'x', args: [1, null] } } } })
    ];
    let wrote = 0;
    for (const s of bad) { try { store.upsertService(s); wrote++; } catch { /* 期望被拒 */ } }
    const cfgFile = path.join(tmp, 'services.yaml');
    const onDisk = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : '';  // 全部被拒时文件可能尚未生成
    const polluted = onDisk.includes('70000') || onDisk.includes('BAD ID') || onDisk.includes('b-nullcmd');
    const reread = config.readYaml();
    const inconsistent = reread.errors.length > 0 || reread.data.services.length < wrote;
    // IPC 层是否有强制预检
    const ipcSrc = srcText('ipc.ts');
    const hasPrecheck = /upsert-service[\s\S]{0,200}precheck/.test(ipcSrc);
    for (const s of bad) { try { store.removeService(s.id); } catch { /* */ } }
    return { v: !polluted || (hasPrecheck && !inconsistent) ? 'PASS' : 'FAIL',
      evidence: '非法对象被静默写入=' + wrote + '/3 / 落盘污染=' + polluted +
        ' / 回读 errors=' + reread.errors.length + ' / 写路径强制预检=' + hasPrecheck };
  });

  /* ---------- K02 模板校验边界 ---------- */
  section('K02 模板校验边界');
  await check('K02', '模板库扫描与异常标红', 'validateTemplate 逐类边界 + 128KB / 重复 id / 运行时字段', async () => {
    const base = template.scanTemplates().find(x => x.id === 'redis').raw;
    const cases = [
      ['schemaVersion', Object.assign({}, base, { schemaVersion: 9 })],
      ['运行时字段', Object.assign({}, base, { pid: 123 })],
      ['非法 webUrl', Object.assign({}, base, { defaults: Object.assign({}, base.defaults, { webUrl: 'javascript:alert(1)' }) })],
      ['废弃 waitFor', Object.assign({}, base, { actions: Object.assign({}, base.actions, { start: Object.assign({}, base.actions.start, { waitFor: 1 }) }) })]
    ];
    const caught = cases.filter(([, raw]) => template.validateTemplate(raw, 'redis.json', new Set()).length > 0).length;
    const dir = M('paths').templateDir();
    fs.writeFileSync(path.join(dir, 'b-dup.json'), JSON.stringify(base), 'utf8');
    const scan = template.scanTemplates();
    const dupFlagged = scan.some(x => (x.errors || []).some(e => /重复/.test(e)));
    fs.writeFileSync(path.join(dir, 'b-huge.json'), 'x'.repeat(130 * 1024), 'utf8');
    const capped = template.scanTemplates().some(x => x.id === 'b-huge' && x.state === 'invalid');
    fs.unlinkSync(path.join(dir, 'b-dup.json')); fs.unlinkSync(path.join(dir, 'b-huge.json'));
    return { v: caught === cases.length && dupFlagged && capped ? 'PASS' : 'FAIL',
      evidence: '非法模板识别=' + caught + '/' + cases.length + ' / 重复id=' + dupFlagged + ' / 128KB=' + capped };
  });

  /* ---------- K03 模板实例化 ---------- */
  section('K03 模板实例化');
  await check('K03', '模板驱动新增服务', 'instantiate 占位符 / 路径规范化 / 平台命令 / id 唯一性', async () => {
    const t = template.scanTemplates().find(x => x.id === 'redis' && x.state === 'ok').raw;
    const a = template.instantiate(t, tmp, 'B-Redis', 6601);
    const b = template.instantiate(t, tmp, 'B-Redis2', 6602);
    const noPlaceholder = !JSON.stringify(a).includes('${');
    const portOk = a.port === 6601 && a.cfg.acts.start.command.includes('redis-server');
    const idsUnique = a.id !== b.id;
    const norm = path.isAbsolute(a.dir);
    return { v: noPlaceholder && portOk && idsUnique && norm ? 'PASS' : 'FAIL',
      evidence: '占位符清空=' + noPlaceholder + ' / 端口与命令=' + portOk + ' / id唯一=' + idsUnique + ' / 路径规范化=' + norm };
  });

  /* ---------- K04 组合非法输入 ---------- */
  section('K04 组合故障注入');
  await check('K04', '新建分组与解散', 'memberIds 含不存在 id / gid 指向幽灵组 / 解散后清理', async () => {
    const s1 = mkSvc({ id: 'b-g1', port: 6603 }), s2 = mkSvc({ id: 'b-g2', port: 6604 });
    store.upsertService(s1); store.upsertService(s2);
    store.saveGroup({ id: 'gb', name: 'B-Group', collapsed: false }, ['b-g1', 'b-g2', 'ghost-id']);
    const members = store.members('gb').map(x => x.id);
    const noGhost = !members.includes('ghost-id') && members.length === 2;
    store.moveToGroup('b-g1', 'ghost-group');
    const regrouped = config.regroupContiguous(store.services(), store.groups());
    const contiguous = regrouped.filter(x => x.gid === 'ghost-group').length === 1;
    store.dissolveGroup('gb');
    const cleared = store.groups().every(g => g.id !== 'gb') && store.services().every(s => s.gid !== 'gb');
    return { v: noGhost && contiguous && cleared ? 'PASS' : 'FAIL',
      evidence: '幽灵成员被过滤=' + noGhost + ' / 幽灵组规整=' + contiguous + ' / 解散清理=' + cleared };
  });

  /* ---------- K05 拖拽非法参数 ---------- */
  section('K05 拖拽非法参数');
  await check('K05', '拖拽顺序写回', 'null/undefined/跨组/自身/no-op 注入，检查抛异常与数据污染', async () => {
    const before = store.services().map(x => x.id).join(',');
    let threw = null;
    const rs = [];
    try {
      rs.push(store.moveBlock(null, undefined, null, undefined, true));
      rs.push(store.moveMemberInGroup('no-such-group', 'x', 'y', true));
      rs.push(store.moveBlock(null, 'b-g1', null, 'b-g1', true));
      rs.push(store.moveMemberInGroup('gb', 'b-g1', 'b-g1', false));
    } catch (e) { threw = String(e && e.message || e); }
    const after = store.services().map(x => x.id).join(',');
    return { v: !threw && rs.every(r => r <= 0) && before === after ? 'PASS' : 'FAIL',
      evidence: '抛异常=' + (threw || '否') + ' / 返回值=' + JSON.stringify(rs) + ' / 顺序未污染=' + (before === after) };
  });

  /* ---------- K06 v2.39 守卫真值表 ---------- */
  section('K06 守卫真值表');
  await check('K06', '稳定态守卫', '6 状态 × toggle/restart 全组合；owner 冲突拦截', async () => {
    const s = mkSvc({ id: 'b-guard', port: 6605 });
    store.upsertService(s);
    let blocked = 0, expected = 0;
    for (const st of ['starting', 'stopping']) {
      setSt('b-guard', st);
      const t = await schedule.toggle('b-guard');
      const r = await schedule.restart('b-guard');
      expected += 2;
      if (t.ok === false && r.ok === false && /尚未完成|暂不可重启/.test((t.reason || '') + (r.reason || ''))) blocked += 2;
    }
    setSt('b-guard', 'stopped', { owner: 'other.exe', ownerPid: 999 });
    const ownT = await schedule.toggle('b-guard');
    const ownR = await schedule.restart('b-guard');
    expected += 2;
    if (ownT.ok === false && ownR.ok === false) blocked += 2;
    setSt('b-guard', 'stopped', { owner: undefined, ownerPid: undefined });
    return { v: blocked === expected ? 'PASS' : 'FAIL',
      evidence: '拦截=' + blocked + '/' + expected + '（starting/stopping/owner 各 toggle+restart）' };
  });

  /* ---------- K07 编排：并发重入故障注入（A 未覆盖） ---------- */
  section('K07 全部启停编排 · 并发重入');
  await check('K07', '全部启停编排', '连续两次 startAll() 重入，检查组合串行链是否被第二条链抢跑', async () => {
    // 用可控 probe：就绪延迟 600ms，制造重入窗口
    schedule.initSchedule({ probe: fakeProbe, openUrl: () => {}, openDir: () => {} });
    hitDelay = 600; resetEv();
    const x = mkSvc({ id: 'b-seq1', name: 'B-Seq1', port: 6606 }), y = mkSvc({ id: 'b-seq2', name: 'B-Seq2', port: 6607 });
    store.upsertService(x); store.upsertService(y);
    store.saveGroup({ id: 'gseqb', name: 'B-Seq', collapsed: false }, ['b-seq1', 'b-seq2']);
    // 排除其它服务，保证 startAll 只作用于本组合两项
    for (const s of store.services()) setSt(s.id, ['b-seq1', 'b-seq2'].includes(s.id) ? 'stopped' : 'running');
    const r1 = schedule.startAll();
    const r2 = schedule.startAll();           // 立即重入
    await sleep(1600);   // 等整条串行链（2 项 × 600ms 就绪）收尾，避免污染下一检查点
    const w1 = ev.find(e => e.ev === 'watch' && e.id === 'b-seq1');
    const w2 = ev.find(e => e.ev === 'watch' && e.id === 'b-seq2');
    const h1 = ev.find(e => e.ev === 'hit' && e.id === 'b-seq1');
    const outOfOrder = !!(w1 && w2 && h1 && w2.t < h1.t);   // 第二项被拉起早于第一项就绪
    const bothAccepted = r1.ok && r2.ok;      // 无 in-flight 去重
    const body = srcText('schedule.ts').slice(srcText('schedule.ts').indexOf('export function startAll'));
    const hasGuard = /inFlight|pending|already|去重/.test(body.slice(0, 300));
    hitDelay = 0;
    return { v: !outOfOrder && !bothAccepted ? 'PASS' : 'FAIL',
      evidence: '两次调用均受理=' + bothAccepted + ' / 第二项拉起早于第一项就绪=' + outOfOrder +
        '（w2=' + (w2 && w2.t) + ' h1=' + (h1 && h1.t) + '）/ startAll去重守卫=' + hasGuard +
        ' / 事件=' + ev.map(e => e.ev + ':' + (e.id || '')).join('→') };
  });

  /* ---------- K08 完成驱动串行（确定性验证） ---------- */
  section('K08 完成驱动串行');
  await check('K08', '组级串行与真实进程', '可控 probe 验证 done→next：第二项 doStart 不早于第一项 onHit；停止倒序', async () => {
    hitDelay = 350; resetEv();
    setSt('b-seq1', 'stopped'); setSt('b-seq2', 'stopped');
    schedule.startAll();
    await sleep(1000);
    const h1 = ev.find(e => e.ev === 'hit' && e.id === 'b-seq1');
    const s2 = ev.find(e => e.ev === 'start' && e.pid && ev.indexOf(e) > 0);
    const startEvents = ev.filter(e => e.ev === 'watch');
    const secondWatch = startEvents.find(e => e.id === 'b-seq2');
    const driven = !!(h1 && secondWatch && secondWatch.t >= h1.t);
    const lanes = schedule.stopAllLanes();
    const reverse = !!lanes.find(l => l.serial && l.items.map(s => s.id).join(',') === 'b-seq2,b-seq1');
    hitDelay = 0;
    return { v: driven && reverse ? 'PASS' : 'FAIL',
      evidence: '完成驱动(第二项watch≥第一项hit)=' + driven + ' / 倒序链=' + reverse +
        ' / 事件=' + ev.map(e => e.ev + (e.id ? ':' + e.id : '')).join('→') };
  });

  /* ---------- K09 端口归属与冲突链级终止 */
  section('K09 端口归属与冲突');
  await check('K09', '端口冲突拦截', 'probeOne 归属分支 + conflictOf + 冲突时终止所属链后续', async () => {
    const c = mkSvc({ id: 'b-conf', name: 'B-Conf', port: 6608 });
    store.upsertService(c);
    setSt('b-conf', 'stopped', { owner: 'other.exe', ownerPid: 777 });
    const plan = schedule.buildConfirmPlan('startAll');
    const listed = plan.conflicts.some(x => x.id === 'b-conf');
    const before = ev.filter(e => e.ev === 'watch').length;
    hitDelay = 0; resetEv();
    schedule.startAll();
    await sleep(120);
    const confStarted = ev.some(e => e.id === 'b-conf');
    return { v: listed && !confStarted ? 'PASS' : 'FAIL',
      evidence: '确认计划列出冲突=' + listed + ' / 冲突项未启动=' + !confStarted +
        ' / 冲突链级终止代码=' + /return;\s*\/\/|所属组合链后续不再执行/.test(srcText('schedule.ts')) };
  });

  /* ---------- K10 配置损坏容错 ---------- */
  section('K10 配置损坏容错');
  await check('K10', '配置损坏容错', '损坏文件 / 原子写并发 / 错误是否被上层忽略', async () => {
    const yamlFile = path.join(tmp, 'services.yaml');
    const backup = fs.readFileSync(yamlFile, 'utf8');
    fs.writeFileSync(yamlFile, 'services: [ this is not valid yaml\n', 'utf8');
    let threw = null, r = null;
    try { r = config.readYaml(); } catch (e) { threw = String(e && e.message || e).slice(0, 60); }
    // 规格修正：解析失败时返回空配置是必然的，真正要求的是「现场可恢复 + 错误可见」
    const backedUp = fs.readdirSync(tmp).some(f => f.includes('.corrupt-'));
    const errorsVisible = !!r && r.errors.length > 0;
    const dataPreserved = backedUp && errorsVisible;
    fs.writeFileSync(yamlFile, backup, 'utf8');
    const storeSrc = srcText('store.ts');
    const ignoresErrors = /const \{ data \} = readYaml\(\)/.test(storeSrc);   // 丢弃 errors 字段
    const fixedTmp = /file \+ '\.tmp'/.test(srcText('config.ts'));
    return { v: !threw && dataPreserved && !ignoresErrors && !fixedTmp ? 'PASS' : 'FAIL',
      evidence: '读损坏文件抛异常=' + (threw || '否') + ' / 损坏配置现场备份=' + backedUp +
        ' 错误可见=' + errorsVisible + ' / Store丢弃errors=' + ignoresErrors + ' / 固定.tmp并发风险=' + fixedTmp };
  });

  /* ---------- K11 活动日志落库链路 */
  section('K11 活动日志落库链路');
  await check('K11', '活动日志', '源码审查 store.activity → logs.pushActivity 调用链 + 运行时实测', async () => {
    const before = logs.getActivity().length;
    store.activity('i', 'INFO', 'B-CROSSCHECK-MARKER');
    const after = logs.getActivity().length;
    const wired = /pushActivity/.test(srcText('store.ts'));
    return { v: after > before && wired ? 'PASS' : 'FAIL',
      evidence: '活动条数 ' + before + '→' + after + ' / store.activity 落库=' + wired +
        ' / 全仓 pushActivity 调用点=' + (fs.readdirSync(SRC).filter(f => /pushActivity/.test(fs.readFileSync(path.join(SRC, f), 'utf8'))).join(',') || '无') };
  });

  /* ---------- K12 无心跳下的动作超时收敛（关键分歧点） ---------- */
  section('K12 动作超时状态收敛（禁用心跳，纯 watchTarget 路径）');
  await check('K12', '启动失败状态收敛', '真实 ProbeScheduler 但不起心跳；启动必然失败，超时后检查 busy 是否解除', async () => {
    // 真实 probe 实例（不 start），watchTarget 是产品真实实现
    const realProbe = new probeMod.ProbeScheduler({
      getServices: () => store.services(),
      getSt: (id) => store.state(id).st,
      onPatch: (id, patch) => store.patchState(id, patch),
      pollMs: 100000
    });
    schedule.initSchedule({ probe: realProbe, openUrl: () => {}, openDir: () => {} });
    const s = mkSvc({ id: 'b-timeout', name: 'B-Timeout', port: 6609,
      cfg: { acts: { start: { type: 'exec', command: path.join(tmp, 'definitely-no-such-bin'), args: [], timeoutMs: 900 }, stop: null } } });
    store.upsertService(s);
    setSt('b-timeout', 'stopped');
    await schedule.toggle('b-timeout');
    const during = store.state('b-timeout').st;
    await sleep(1500);   // 超过 900ms 定向快探超时
    const after = store.state('b-timeout').st;
    const again = await schedule.toggle('b-timeout');
    const onTimeoutWrite = /else if \(Date\.now\(\) - startAt > timeoutMs\)[\s\S]{0,200}patchState|onTimeout/.test(srcText('probe.ts'));
    return { v: after !== 'starting' && after !== 'stopping' && again.ok !== false ? 'PASS' : 'FAIL',
      evidence: '动作中=' + during + ' / 超时后=' + after + ' / 复点=' + JSON.stringify(again) +
        ' / 超时分支写终态=' + onTimeoutWrite + '（心跳已禁用，排除竞态掩盖）' };
  });

  /* ---------- K13 安全边界：路径 / 协议 / 注入 */
  section('K13 路径越界 / 协议白名单 / 命令注入');
  await check('K13', '模板读取路径边界', 'templateFilePath 校验、startsWith 前缀绕过实测、open-url 协议、shell:false', async () => {
    // 前缀绕过实测：<tmp>/presets-evil/secret.txt
    const evilDir = path.join(tmp, 'presets-evil');
    fs.mkdirSync(evilDir, { recursive: true });
    const secret = path.join(evilDir, 'secret.txt');
    fs.writeFileSync(secret, 'SECRET', 'utf8');
    let deleted = false;
    try { template.deleteTemplateFile('../presets-evil/secret.txt'); } catch { /* */ }
    deleted = !fs.existsSync(secret);
    const tplSrc = srcText('template.ts');
    const readNoGuard = /export function templateFilePath[\s\S]{0,160}return path\.join\(templateDir\(\), file\)/.test(tplSrc);
    const ipcRead = /read-template-file[\s\S]{0,260}readFileSync\(p/.test(srcText('ipc.ts'));
    // 规格修正：判定「是否存在协议白名单」，而不是「是否出现 shell.openExternal」
    const ipcSrc = srcText('ipc.ts');
    const idxSrc = srcText('index.ts');
    const openAt = ipcSrc.indexOf("handle('open-url'"), winAt = idxSrc.indexOf('setWindowOpenHandler');
    const ipcOpenBlock = ipcSrc.slice(openAt, openAt + 420);
    const winOpenBlock = idxSrc.slice(winAt, winAt + 420);
    const urlGuarded = /\^https\?:\\\/\\\//.test(ipcOpenBlock);
    const winGuarded = /\^https\?:\\\/\\\//.test(winOpenBlock);
    const shellFalse = (srcText('runner.ts').match(/shell: false/g) || []).length >= 2;
    const preloadWhitelist = /contextBridge\.exposeInMainWorld/.test(fs.readFileSync(path.join(SRC, 'preload.ts'), 'utf8'));
    const unsafe = deleted || (readNoGuard && ipcRead) || !urlGuarded || !winGuarded;
    return { v: !unsafe && shellFalse && preloadWhitelist ? 'PASS' : 'FAIL',
      evidence: '前缀绕过删除目录外文件=' + deleted + ' / read-template-file无边界=' + (readNoGuard && ipcRead) +
        ' / open-url协议白名单=' + urlGuarded + ' / setWindowOpenHandler白名单=' + winGuarded +
        ' / shell:false=' + shellFalse + ' / preload白名单=' + preloadWhitelist };
  });

  /* ---------- K14 国际化（B 独立验证，不读取 i18n.test.js 结论） ---------- */
  section('K14 国际化 9 语覆盖');
  await check('K14', '国际化 9 语覆盖', '词典结构 + 用产品真实 tr() 对渲染器文案样本跑 6 个非汉字语种', async () => {
    const dict = JSON.parse(fs.readFileSync(path.join(RENDERER, 'i18n-dict.json'), 'utf8'));
    const keys = Object.keys(dict);
    const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'es', 'de', 'pt'];
    const complete = keys.length > 400 && keys.every(k => Array.isArray(dict[k]) && dict[k].length === 9 && dict[k].every(v => typeof v === 'string' && v.length));
    // 用 TypeScript 转译产品真实 i18n.ts（白盒：加载实现本身）
    const ts = require('typescript');
    const i18nSrc = fs.readFileSync(path.join(RENDERER, 'i18n.ts'), 'utf8');
    const js = ts.transpileModule(i18nSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    // 产品引擎用模块级 lang + setLang(code)，tr 只收一个参数；注入 DOM/localStorage 桩
    const jsonStub = Object.assign({}, dict);
    Object.defineProperty(jsonStub, '__esModule', { value: true });
    jsonStub.default = dict;
    // 复数表（v2.55 起 i18n 引擎的第二层依赖）
    const plural = JSON.parse(fs.readFileSync(path.join(RENDERER, 'i18n-plural.json'), 'utf8'));
    const pluralStub = Object.assign({}, plural);
    Object.defineProperty(pluralStub, '__esModule', { value: true });
    pluralStub.default = plural;
    const lsStub = { getItem: () => null, setItem: () => {} };
    const docStub = { documentElement: { setAttribute: () => {} } };
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', 'localStorage', 'document', js)(
      mod, mod.exports,
      (id) => id.includes('i18n-dict') ? jsonStub
        : (id.includes('i18n-plural') ? pluralStub : require(id)),
      lsStub, docStub
    );
    const tr = mod.exports.tr;
    const setLang = mod.exports.setLang;
    if (typeof tr !== 'function' || typeof setLang !== 'function') throw new Error('i18n 引擎加载失败');
    // 从渲染器源码抽取 t('...') 中文实参作为样本
    const samples = new Set();
    const scan = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return scan(p);
      if (!/\.(tsx|ts)$/.test(d.name)) return;
      const text = fs.readFileSync(p, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*['"]([^'"]*[\u4e00-\u9fa5][^'"]*)['"]/g)) samples.add(m[1]);
    });
    scan(RENDERER);
    const list = [...samples].slice(0, 60);
    let broken = 0;
    const examples = [];
    for (const s of list) {
      for (const lang of ['en', 'ko', 'fr', 'es', 'de', 'pt']) {
        setLang(lang);
        const out = tr(s);
        if (/[\u4e00-\u9fa5]/.test(out)) { broken++; if (examples.length < 3) examples.push('[' + lang + ']' + s + '→' + out); break; }
      }
    }
    setLang('zh-CN');
    const roundTrip = tr('服务列表') === '服务列表';
    return { v: complete && broken === 0 && roundTrip ? 'PASS' : 'FAIL',
      evidence: '词典=' + keys.length + '键×9语完整=' + complete + ' / 文案样本=' + list.length +
        ' / 6语种残留中文=' + broken + ' / 例：' + examples.join(' | ') + ' / 切回简体=' + roundTrip };
  });

  /* ---------- K15 跨平台 POSIX 分支 */
  section('K15 跨平台兼容性');
  await check('K15', 'macOS/Linux 分支正确性', '静态审查 runner/probe/paths/presets 双分支，重点负 PID 进程组', async () => {
    const r = srcText('runner.ts');
    const eawBody = r.slice(r.indexOf('export function execAndWait'), r.indexOf('/* ---------- 跨平台杀进程树'));
    const execAndWaitDetached = /detached/.test(eawBody);
    const negativePid = /process\.kill\(-pid/.test(r);
    const contradiction = negativePid && !execAndWaitDetached;   // 非 detached 子进程却用负 PID 杀组
    const posixInterpreter = /\/bin\/sh/.test(r);
    const lsof = /lsof -nP/.test(srcText('probe.ts'));
    const appData = /app\.getPath\('appData'\)/.test(srcText('paths.ts'));
    const platformPreset = /process\.platform/.test(srcText('presets.ts'));
    return { v: !contradiction && posixInterpreter && lsof && appData && platformPreset ? 'PASS' : 'FAIL',
      evidence: '负PID杀组=' + negativePid + ' / execAndWait为detached=' + execAndWaitDetached +
        ' / 分支矛盾=' + contradiction + ' / sh解释器=' + posixInterpreter + ' / lsof=' + lsof +
        ' / appData跨平台=' + appData + ' / presets平台分支=' + platformPreset };
  });

  /* ---------- 输出 ---------- */
  const out = {
    tester: 'B', method: '实现驱动白盒 + 故障注入 / 源码审查',
    platform: process.platform, node: process.version, dataDir: tmp,
    at: new Date().toISOString(), results
  };
  fs.writeFileSync(path.join(__dirname, 'out-B.json'), JSON.stringify(out, null, 2), 'utf8');
  const c = { PASS: 0, FAIL: 0, NA: 0 };
  results.forEach(r => c[r.verdict]++);
  console.log('\n== B: ' + c.PASS + ' PASS / ' + c.FAIL + ' FAIL / ' + c.NA + ' N/A ==');
  console.log('结果文件：' + path.join(__dirname, 'out-B.json'));
  process.exit(0);
})().catch(e => { console.error('B ERROR', e); process.exit(1); });
