/* 冒烟测试：主进程核心链路（不启动真实 Electron 窗口）
 * 覆盖：config 读写校验、template 播种/扫描/校验/实例化、store 组合规整与顺序写回、
 * schedule 执行链构建与 v2.39 稳定态守卫。
 * 运行：node test/smoke.test.js（需先 tsc -p tsconfig.electron.json）
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离数据目录：所有读写都指向临时目录
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-test-'));
process.env.DEVSTACK_DATA_DIR = tmp;

// 最小 Electron 桩：config/template 只用 app.getPath('appData')
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
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

const DIST = path.join(__dirname, '..', 'dist-electron', 'main');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

(async () => {
  /* ---------- config ---------- */
  const config = require(path.join(DIST, 'main', 'config.js'));
  const { data, errors, existed } = config.readYaml();
  ok(!existed, 'config: 首读返回默认空配置（文件不存在）');
  ok(errors.length === 0, 'config: 默认配置无校验错误');
  ok(data.schemaVersion === 1, 'config: schemaVersion = 1');

  const bad = config.validateYaml({ services: [{ id: 'BAD ID', name: '', port: 70000, dir: '' }] });
  ok(bad.errors.length > 0, 'config: 非法服务产生校验错误（' + bad.errors.length + ' 项）');

  /* ---------- template ---------- */
  const template = require(path.join(DIST, 'main', 'template.js'));
  const seeded = template.seedPresets();
  ok(seeded.seeded === 9, 'template: 首播 9 个模板，实际 ' + seeded.seeded);
  const seeded2 = template.seedPresets();
  ok(seeded2.seeded === 0, 'template: 二次播种不覆盖用户文件');

  const list = template.scanTemplates();
  ok(list.length === 9, 'template: 扫描出 9 个模板');
  ok(list.every(x => x.state === 'ok'), 'template: 全部模板校验通过');

  // 写一个非法模板
  const dir = require(path.join(DIST, 'main', 'paths.js')).templateDir();
  fs.writeFileSync(path.join(dir, 'bad-name.json'), JSON.stringify({ kind: 'wrong' }), 'utf8');
  const list2 = template.scanTemplates();
  const badItem = list2.find(x => x.id === 'bad-name');
  ok(badItem && badItem.state === 'invalid', 'template: 非法模板标红');
  ok(badItem.errors.length > 0, 'template: 非法模板给出错误清单（' + badItem.errors.length + ' 项）');

  // 实例化
  const redis = list.find(x => x.id === 'redis');
  const inst = template.instantiate(redis.raw, process.platform === 'win32' ? 'C:/dev/redis' : '/opt/redis', '我的 Redis');
  ok(inst.name === '我的 Redis', 'template: 实例化回填显示名');
  ok(inst.template === 'redis', 'template: 实例化写入 template 溯源');
  ok(inst.cfg.acts.start && inst.cfg.acts.start.command.includes(process.platform === 'win32' ? 'redis-server.exe' : 'redis-server'), 'template: 占位符已展开为真实命令：' + inst.cfg.acts.start.command);
  ok(!inst.cfg.acts.start.command.includes('${'), 'template: 展开后无残留占位符');

  /* ---------- store ---------- */
  const storeMod = require(path.join(DIST, 'main', 'store.js'));
  const store = storeMod.store;
  store.upsertService({ id: 'a', name: 'A', gid: null, port: 1001, dir: tmp, cfg: { acts: { start: { type: 'exec', command: 'echo', args: ['hi'] } } } });
  store.upsertService({ id: 'b', name: 'B', gid: null, port: 1002, dir: tmp, cfg: { acts: { start: { type: 'exec', command: 'echo', args: ['hi'] } } } });
  store.upsertService({ id: 'c', name: 'C', gid: null, port: 1003, dir: tmp, cfg: { acts: { start: { type: 'exec', command: 'echo', args: ['hi'] } } } });
  ok(store.services().length === 3, 'store: 写入 3 个服务');

  // 建组 b+c
  store.saveGroup({ id: 'g1', name: 'G1', collapsed: false }, ['b', 'c']);
  ok(store.members('g1').length === 2, 'store: 组合含 2 个成员');
  ok(store.svc('b').gid === 'g1' && store.svc('c').gid === 'g1', 'store: 成员归属正确');
  // 连续性：b、c 相邻
  const ids1 = store.services().map(s => s.id);
  ok(Math.abs(ids1.indexOf('b') - ids1.indexOf('c')) === 1, 'store: 组成员连续（顶层块）');

  // 顶层块移动：把组块移到 a 之前
  const r1 = store.moveBlock('g1', 'b', null, 'a', true);
  ok(r1 === 1, 'store: 顶层块移动成功');
  const ids2 = store.services().map(s => s.id);
  ok(ids2[0] === 'b' && ids2[1] === 'c' && ids2[2] === 'a', 'store: 组块移到最前：' + ids2.join(','));

  // no-op 移动
  const r2 = store.moveBlock('g1', 'b', 'g1', 'b', true);
  ok(r2 === 0, 'store: 拖到自身返回 0（无变化）');

  // 组内重排：c 移到 b 前
  const r3 = store.moveMemberInGroup('g1', 'c', 'b', true);
  ok(r3 === 1, 'store: 组内成员重排成功');
  ok(store.members('g1').map(s => s.id).join(',') === 'c,b', 'store: 组内顺序 c → b');

  /* ---------- schedule 执行链 ---------- */
  const schedule = require(path.join(DIST, 'main', 'schedule.js'));
  // 设置状态：a stopped，b/c stopped
  store.patchState('a', { st: 'stopped' });
  store.patchState('b', { st: 'stopped' });
  store.patchState('c', { st: 'stopped' });
  const lanes = schedule.startAllLanes();
  ok(lanes.length === 2, 'schedule: 全部启动 → 2 条链（a 并行 + g1 串行）');
  const gLane = lanes.find(l => l.serial);
  ok(gLane && gLane.items.map(s => s.id).join(',') === 'c,b', 'schedule: 组合链按组内顺序 c → b');

  // isBusy 排除：c 置为 starting
  store.patchState('c', { st: 'starting' });
  const lanes2 = schedule.startAllLanes();
  const gLane2 = lanes2.find(l => l.serial);
  ok(!gLane2 || !gLane2.items.some(s => s.id === 'c'), 'schedule: 执行中组件被排除在计划外');

  // 二次确认计划
  store.patchState('c', { st: 'stopped' });
  const plan = schedule.buildConfirmPlan('startAll');
  ok(plan.total === 3, 'schedule: 确认计划 total=3');
  ok(plan.parallelCount === 1 && plan.serialLanes === 1, 'schedule: 并行 1 + 串行链 1');

  /* ---------- v2.39 稳定态守卫（不真正拉起进程，只看拦截） ---------- */
  store.patchState('b', { st: 'starting' });
  const rToggle = await schedule.toggle('b');
  ok(rToggle.ok === false && /启动尚未完成/.test(rToggle.reason), 'v2.39: starting 点主按钮被拦截：' + rToggle.reason);
  const rRestart = await schedule.restart('b');
  ok(rRestart.ok === false && /暂不可重启/.test(rRestart.reason), 'v2.39: starting 点重启被拦截：' + rRestart.reason);

  store.patchState('b', { st: 'stopping' });
  const rT2 = await schedule.toggle('b');
  ok(rT2.ok === false && /停止尚未完成/.test(rT2.reason), 'v2.39: stopping 点主按钮被拦截（反向 bug 已修）：' + rT2.reason);
  const rR2 = await schedule.restart('b');
  ok(rR2.ok === false && /暂不可重启/.test(rR2.reason), 'v2.39: stopping 点重启被拦截：' + rR2.reason);

  /* ---------- 汇总 ---------- */
  console.log('\n== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  console.log('数据目录：' + tmp);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR', e); process.exit(1); });
