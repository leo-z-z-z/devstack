/* 状态语义回归：端口冲突与动作失败分离
 * 覆盖：
 *  1. 端口恢复空闲后显式清除旧 owner / ownerPid，不把旧冲突残留到新状态；
 *  2. 启动超时写入 actionNote，不写 portNote，也不进入端口冲突清单；
 *  3. 服务卡片用 actionNote 显示动作失败，portNote 只显示端口状态。
 * 运行：node test/status-semantics.test.js（需先 tsc -p tsconfig.electron.json）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-status-'));
process.env.DEVSTACK_DATA_DIR = tmp;

const Module = require('module');
const electronStub = {
  app: { getPath: () => tmp, getVersion: () => '0.0.0-status-test' },
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
const probe = require(path.join(DIST, 'main', 'probe.js'));
const schedule = require(path.join(DIST, 'main', 'schedule.js'));
const { store } = require(path.join(DIST, 'main', 'store.js'));
const { healthCategory } = require(path.join(DIST, 'shared', 'types.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function mkSvc(id, port) {
  return {
    id, name: id, gid: null, port, webUrl: null, dir: tmp,
    cfg: { acts: {
      start: { type: 'exec', command: path.join(tmp, 'definitely-no-such-bin'), args: [], timeoutMs: 350 },
      stop: null,
      restart: null
    } }
  };
}

(async () => {
  console.log('状态语义回归 | 数据目录 ' + tmp);

  /* 1. 旧端口占用者必须被新探测结果显式清空 */
  const p1 = await freePort();
  const staleSvc = mkSvc('stale-owner', p1);
  const patch = await probe.probeOne(staleSvc, new Set());
  ok(patch.st === 'stopped', '空闲端口探测仍为 stopped');
  ok(Object.prototype.hasOwnProperty.call(patch, 'owner') && patch.owner === undefined,
    '空闲端口探测返回 owner=undefined，显式清除旧占用者');
  ok(Object.prototype.hasOwnProperty.call(patch, 'ownerPid') && patch.ownerPid === undefined,
    '空闲端口探测返回 ownerPid=undefined，显式清除旧 PID');
  ok(patch.portNote === '空闲', '空闲端口探测返回 portNote=空闲');

  /* 2. 普通启动失败只写 actionNote，不产生端口冲突 */
  const p2 = await freePort();
  const svc = mkSvc('start-fail', p2);
  store.upsertService(svc);
  store.patchState(svc.id, { st: 'stopped', owner: undefined, ownerPid: undefined, portNote: '空闲' });

  const realProbe = new probe.ProbeScheduler({
    getServices: () => store.services(),
    getSt: id => store.state(id).st,
    onPatch: (id, patch2) => store.patchState(id, patch2),
    pollMs: 100000
  });
  schedule.initSchedule({ probe: realProbe, openUrl: () => {}, openDir: () => {} });

  await schedule.toggle(svc.id);
  ok(store.state(svc.id).st === 'starting', '启动动作进入 starting');
  await sleep(900); // 超过 350ms 定向快探超时
  const after = store.state(svc.id);
  ok(after.st === 'unknown' && after.actionNote === '启动超时',
    '启动超时写入 actionNote（实际：' + after.st + ' / ' + after.actionNote + '）');
  ok(!after.owner && !after.ownerPid, '普通启动失败没有端口占用者');
  ok(after.portNote !== '启动超时', '启动超时不再写进 portNote');

  const plan = schedule.buildConfirmPlan('startAll');
  ok(!plan.conflicts.some(x => x.id === svc.id), '普通启动失败不进入端口冲突清单');

  /* 2b. 点击启动时先做新鲜探测：旧占用者残留不得拦截本次启动 */
  store.patchState(svc.id, { st: 'stopped', owner: 'Ghost.exe', ownerPid: 9999, portNote: '被占用', actionNote: undefined });
  const retry = await schedule.toggle(svc.id);
  const retryState = store.state(svc.id);
  ok(retry.ok === true && retryState.st === 'starting',
    '旧端口占用者残留经点击时新鲜探测后被清除，不再误拦截启动');
  ok(retryState.owner === undefined && retryState.ownerPid === undefined,
    '点击启动后旧 owner / ownerPid 已清空');
  ok(retryState.actionNote === undefined, '重新启动会清除上一轮动作失败标记');
  await sleep(550); // 等第二次定向快探自行超时并清定时器，避免测试进程悬挂

  /* 3. 卡片源码只把 actionNote 作为失败标记，portNote 保持端口语义 */
  const cardSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'components', 'ServiceCard.tsx'), 'utf8');
  ok(/actionNote/.test(cardSrc) && /tag fail/.test(cardSrc), '服务卡片显示独立动作失败标记');
  ok(!/portNote:\s*['"]启动超时['"]/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'schedule.ts'), 'utf8')),
    '调度源码不再把启动超时写进 portNote');

  /* 4. 主页面三分统计分类：运行中 + 已停止 + 异常 = 总数 */
  const categories = [
    [{ st: 'running', _tk: 0 }, 'running'],
    [{ st: 'starting', _tk: 0 }, 'running'],
    [{ st: 'running', owner: 'external.exe', ownerPid: 100, _tk: 0 }, 'running'],
    [{ st: 'stopped', _tk: 0 }, 'stopped'],
    [{ st: 'stopping', _tk: 0 }, 'stopped'],
    [{ st: 'unknown', _tk: 0 }, 'stopped'],
    [{ st: 'unknown', actionNote: '启动超时', _tk: 0 }, 'exception'],
    [{ st: 'stopped', owner: 'holder.exe', ownerPid: 200, _tk: 0 }, 'exception'],
    [{ st: 'running', actionNote: '启动超时', _tk: 0 }, 'exception']
  ];
  const badCategory = categories.filter(([st, expect]) => healthCategory(st) !== expect);
  ok(badCategory.length === 0, 'healthCategory 覆盖运行 / 停止 / 异常全部分类（异常分类 ' + badCategory.length + ' 处偏差）');
  const sum = categories.reduce((acc, [st]) => { acc[healthCategory(st)]++; return acc; }, { running: 0, stopped: 0, exception: 0 });
  ok(sum.running + sum.stopped + sum.exception === categories.length, '运行中 + 已停止 + 异常 恒等于服务总数');

  const pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'components', 'ServicesPage.tsx'), 'utf8');
  ok(/healthCategory/.test(pageSrc) && /异常/.test(pageSrc) && /issues\.length/.test(pageSrc),
    '主页面统计卡使用统一 healthCategory 并展示异常总数');
  ok(!/stats\.conflicts/.test(pageSrc), '主页面不再把动作失败漏在旧 conflicts 统计外');

  console.log('\n== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
