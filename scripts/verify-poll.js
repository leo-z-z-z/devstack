/* ============================================================
 * 真实 Electron 窗口验证：服务列表标题栏「系统正在刷新服务」+ 刷新范围
 *
 * 观察点：
 *  1 指示器紧跟「按视觉顺序启动 / 停止」，且随心跳在 busy / idle 之间跳动
 *  2 v2.42：0 项已启动时心跳整轮跳过——无刷新动画、轮次数不增长，文案提示「自动刷新已暂停」
 *  3 v2.43：默认 3 秒；1 / 3 / 5 秒三档可切换；标题栏与设置页均无补充说明文字
 *  3 改设置页 pollMs 后节奏与文案立即变化
 *  4 注入 1 个真实 LISTEN 服务 + 1 个已停止服务：
 *     自动刷新文案只报「1 项已启动服务」，手动全量刷新报「2 项服务」
 *  5 语言切到英文后指示器无中文残留；布局不换行、不挤占工具按钮
 *
 * 使用隔离数据目录 / 独立调试端口，不触碰 %APPDATA%\devstack。
 * 运行：node scripts/verify-poll.js（需先 npm run build）
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync, execSync } = require('node:child_process');
const WebSocket = require('ws');

const appRoot = path.resolve(__dirname, '..');
const electronBin = require('electron');
const PORT = 9335;

// 端口被上一次验证窗口占用时，CDP 会连到旧窗口（状态全是旧的）而产生一堆假 FAIL。
// 启动 Electron 前先同步确认端口可绑定，不可绑定就明确报错，绝不误连。
const probePort = spawnSync(process.execPath, ['-e',
  "const s=require('net').createServer();s.once('error',()=>process.exit(1));" +
  "s.listen(" + PORT + ",'127.0.0.1',()=>s.close(()=>process.exit(0)));"], { stdio: 'ignore' });
if (probePort.status !== 0) {
  console.error('[verify-poll] CDP 端口 ' + PORT + ' 已被占用（上一次验证窗口可能未退出），请先结束残留 electron 进程后重试。');
  process.exit(2);
}
const LISTEN_PORT = 29302;
const CLOSED_PORT = 29303;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-pollverify-'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

const userData = path.join(dataDir, 'userdata');
const env = { ...process.env, DEVSTACK_DATA_DIR: dataDir, DEVSTACK_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(electronBin, ['.', '--remote-debugging-port=' + PORT, '--user-data-dir=' + userData], {
  cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32'
});
let mainLog = '';
child.stdout.on('data', d => { mainLog += d.toString(); });
child.stderr.on('data', d => { mainLog += d.toString(); });

// 常驻 LISTEN 夹具：让主进程把该服务判定为「已启动 / 外部托管」
const holder = spawn(process.execPath, ['-e',
  "require('net').createServer(function(){}).listen(" + LISTEN_PORT + ",'127.0.0.1');setInterval(function(){},1000)"],
{ stdio: 'ignore', windowsHide: true });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (!m.id || !this.pending.has(m.id)) return;
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, timeoutMs);
    });
  }
}

async function targets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + PORT + '/json/list', r => {
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

let cdp = null;
async function evaluate(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
async function until(expr, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await evaluate(expr)) return true; } catch { /* 页面尚未就绪 */ }
    await sleep(130);
  }
  return false;
}

const CHIP = "document.querySelector('.panelhead .pollchip')";
// v2.44：chip 只渲染图标，状态文案移到 title / aria-label；
// v2.45：图标改为静态刷新箭头（不旋转），busy 通过提亮一档 / manual 更深一档表达
const READ = `(() => { const c = ${CHIP}; if (!c) return null;
  const r = c.getBoundingClientRect();
  const cs = getComputedStyle(c);
  return {
    p: c.dataset.poll, m: c.dataset.mode, n: c.dataset.scope, iv: c.dataset.interval,
    cy: c.dataset.cycles, sb: c.dataset.standby,
    txt: c.getAttribute('title') || '',
    aria: c.getAttribute('aria-label') || '',
    visible: (c.textContent || '').trim(),
    icon: !!c.querySelector('svg'),
    stbyCls: c.classList.contains('stby'), busyCls: c.classList.contains('busy'),
    bg: cs.backgroundColor, col: cs.color,
    w: Math.round(r.width), h: Math.round(r.height)
  }; })()`;

/** 保存真机窗口截图，便于人工核对标题栏视觉 */
async function shot(file) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(appRoot, '..', 'docs', file);
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  return out;
}

/** 连续采样指示器，返回去重后的状态序列 */
async function sample(ms, step = 80) {
  const seen = new Map();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const s = await evaluate(READ);
      if (s) seen.set([s.p, s.m, s.n, s.iv, s.cy, s.sb, s.txt.trim()].join('|'), s);
    } catch { /* 忽略单次采样异常 */ }
    await sleep(step);
  }
  return [...seen.values()];
}

(async () => {
  /* ---------- 连接真实窗口 ---------- */
  let page = null;
  const end = Date.now() + 30000;
  while (!page && Date.now() < end) {
    try {
      const list = await targets();
      page = list.find(x => x.type === 'page' && /index\.html|localhost/.test(x.url));
    } catch { /* 尚未监听 */ }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('未发现 Electron 页面 target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  ok(await until("!!document.querySelector('.stage')", 20000), 'Electron 窗口已打开且 React 已挂载');
  ok(/\[devstack\] mode=production/.test(mainLog), '以静态产物模式启动');

  /* ---------- 1 位置与初始可见性 ---------- */
  const pos = await evaluate(`(() => { const s = document.querySelector('.panelhead .sub');
    const c = ${CHIP}; return { sub: (s||{}).textContent || '', after: !!(s && s.nextElementSibling === c),
    order: [...document.querySelector('.panelhead').children].map(x => x.classList.contains('pollchip') ? 'pollchip' : (x.classList.contains('tools') ? 'tools' : x.tagName)) }; })()`);
  ok(/按视觉顺序启动/.test(pos.sub), '服务列表副标题「按视觉顺序启动 / 停止」存在');
  ok(pos.after, '轮询指示器紧跟该文字之后（不是另起一行 / 不在工具区）');
  ok(pos.order.indexOf('pollchip') >= 0 && pos.order.indexOf('pollchip') < pos.order.indexOf('tools'), '指示器位于「全部启动」等工具按钮之前');

  const n0 = await evaluate('window.devstack.getSnapshot().then(s => s.services.length)');
  ok(n0 === 0, '隔离数据目录：主进程快照确认 0 个服务');
  // 端口检查只能防「端口被占」，防不了「旧窗口刚好释放后仍被 CDP 发现」；用 configPath 直接认窗口
  const info = await evaluate('window.devstack.appInfo()');
  ok(info && String(info.configPath || '').includes(path.basename(dataDir)),
    '窗口身份校验：configPath 指向本次隔离目录（排除误连残留窗口）');

  // v2.42：0 项已启动时整轮跳过，不探测、不广播轮次事件
  const s0 = await sample(5200);
  const cycles0 = s0.length ? s0[0].cy : '0';
  ok(s0.every(x => x.p === 'idle'), '0 项已启动时心跳整轮跳过，始终不出现「正在刷新」');
  ok(s0.every(x => x.icon), '始终渲染静态刷新箭头，无旋转动画');
  ok(s0.every(x => x.cy === cycles0), '0 项已启动期间已完成轮次数不增长（实测 ' + cycles0 + '）');
  ok(s0.some(x => x.sb === '1'), '指示器标记 standby=1');
  ok(s0.some(x => /自动刷新已暂停/.test(x.txt)), '悬停提示说明「自动刷新已暂停」');
  ok(s0.every(x => x.visible === ''), '标题栏只保留刷新图标，界面上没有任何可见文字');
  ok(s0.every(x => x.aria && x.aria.trim().length > 0), '状态文案仍在 aria-label 中，读屏可读');
  ok(s0.every(x => x.w === 22 && x.h === 22), '图标按钮固定 22×22，不随语言 / 文案变宽');
  ok(s0.some(x => x.stbyCls) && s0.every(x => !x.busyCls), '0 项已启动时图标灰化（暂停态独立视觉），无忙碌高亮');
  ok(s0.every(x => x.iv === '3'), 'data-interval 与设置页默认 3 秒档一致');
  const defMs = await evaluate('window.devstack.getSnapshot().then(s => s.settings.pollMs)');
  ok(defMs === 3000, '主进程默认轮询间隔为 3000ms（旧版 1500ms 已迁移）');
  const standbyShot = await shot('ui-poll-indicator-standby.png');
  ok(fs.existsSync(standbyShot), '已保存 0 项已启动的暂停态截图');

  /* ---------- 2 改设置立即生效 ---------- */
  const changed = await evaluate('window.devstack.setSettings({pollMs:1000}).then(r => r.ok)');
  ok(changed === true, '设置页的「状态轮询间隔」写入成功');
  ok(await until(`${CHIP} && ${CHIP}.dataset.interval === '1'`, 8000), '改间隔后指示器秒数立即变为 1 秒');
  const s1 = await sample(2600);
  const idle1 = s1.every(x => x.p === 'idle');
  const noCycle1 = s1.every(x => x.cy === cycles0);
  const s1Detail = () => '（实测 ' + JSON.stringify(s1.map(x => ({ p: x.p, m: x.m, cy: x.cy, txt: x.txt }))) + ' / cycles0=' + cycles0 + '）';
  ok(s1.some(x => x.iv === '1'), '指示器间隔随设置即时更新为 1 秒');
  ok(idle1, '0 项已启动时改间隔也不会触发刷新' + (idle1 ? '' : s1Detail()));
  ok(noCycle1, '改间隔后仍未产生任何刷新轮次' + (noCycle1 ? '' : s1Detail()));
  const ms5 = await evaluate('window.devstack.setSettings({pollMs:5000}).then(() => window.devstack.getSnapshot().then(s => s.settings.pollMs))');
  ok(ms5 === 5000, '5 秒档可写入并即时生效');
  const msBad = await evaluate('window.devstack.setSettings({pollMs:1500}).then(() => window.devstack.getSnapshot().then(s => s.settings.pollMs))');
  ok(msBad === 3000, '旧值 1.5 秒在写入口被钳制回默认 3 秒');
  await evaluate('window.devstack.setSettings({pollMs:1000}).then(r => r.ok)');
  ok(await until(`${CHIP} && ${CHIP}.dataset.interval === '1'`, 8000), '恢复 1 秒间隔供后续阶段验证');

  /* ---------- 3 刷新范围 = 已启动组件 ---------- */
  const mk = (id, port) => JSON.stringify({
    id, name: id, gid: null, sub: 'poll verify', port, dir: dataDir,
    cfg: { acts: { start: { type: 'exec', command: process.platform === 'win32' ? 'cmd.exe' : 'echo', args: ['/c', 'echo hi'] },
      stop: null, restart: null }, capture: false, follow: false }
  });
  const a = await evaluate('window.devstack.upsertService(' + mk('poll-running', LISTEN_PORT) + ')');
  const b = await evaluate('window.devstack.upsertService(' + mk('poll-stopped', CLOSED_PORT) + ')');
  ok(a && a.ok && b && b.ok, '注入 1 个真实 LISTEN 服务 + 1 个已停止服务');
  ok(await until(
    "window.devstack.getSnapshot().then(s => s.states['poll-running'] && s.states['poll-running'].st === 'running' && s.states['poll-stopped'] && s.states['poll-stopped'].st === 'stopped')",
    20000), '首探分类收敛：一个 running / 一个 stopped');
  ok(await until(`${CHIP} && ${CHIP}.dataset.scope === '1'`, 8000), '指示器读取到已启动服务数 1');

  // 1 秒档下「刷新中」只持续 300ms，固定间隔采样会与心跳相位错开；用 MutationObserver 捕获每一次变化
  await evaluate(`(() => { const c = ${CHIP}; window.__pollLog = [];
    window.__pollObs = new MutationObserver(() => window.__pollLog.push({
      p: c.dataset.poll, m: c.dataset.mode, n: c.dataset.scope,
      txt: c.getAttribute('title') || '', visible: (c.textContent || '').trim(),
      busyCls: c.classList.contains('busy'), bg: getComputedStyle(c).backgroundColor
    }));
    window.__pollObs.observe(c, { attributes: true, childList: true, subtree: true, characterData: true });
    return true; })()`);
  const s2 = await sample(3400);
  const log2 = (await evaluate('window.__pollLog')) || [];
  await evaluate('window.__pollObs.disconnect(); true');
  const seen2 = [...s2, ...log2];
  ok(seen2.some(x => x.p === 'busy' && x.m === 'auto' && /正在刷新 1 项已启动服务/.test(x.txt)),
    '悬停提示只报「1 项已启动服务」——已停止组件不在周期刷新范围内');
  ok(seen2.some(x => x.p === 'busy' && x.busyCls && x.bg && x.bg.includes('232')),
    '自动刷新时图标提亮一档（浅蓝底，不旋转）');
  ok(seen2.some(x => x.p === 'idle' && /每 1 秒自动刷新/.test(x.txt)),
    '空闲态悬停提示为「每 1 秒自动刷新」');
  ok(seen2.every(x => (x.visible || '') === ''), '刷新中同样只显示图标，不出现任何文字');
  ok(!seen2.some(x => x.m === 'auto' && /正在刷新 2 项/.test(x.txt)), '自动刷新没有把 2 个服务都算进范围');
  // 轮次推进 / 标记解除用等待式判定：1 秒档 + 高负载时固定采样窗可能刚好错过心跳边界
  ok(await until(`${CHIP} && Number(${CHIP}.dataset.cycles) > ${cycles0}`, 12000),
    '出现已启动组件后自动刷新恢复，轮次数开始推进');
  ok(await until(`${CHIP} && ${CHIP}.dataset.standby === '0'`, 8000), '有已启动组件时解除 standby 标记');

  await until(`${CHIP} && ${CHIP}.dataset.poll === 'idle'`, 6000);
  const idleShot = await shot('ui-poll-indicator-idle.png');
  await until(`${CHIP} && ${CHIP}.dataset.poll === 'busy' && ${CHIP}.dataset.mode === 'auto'`, 6000);
  const busyShot = await shot('ui-poll-indicator-busy.png');
  ok(fs.existsSync(idleShot) && fs.existsSync(busyShot), '已保存空闲 / 刷新中两张真机截图');

  /* ---------- 4 点击 → 手动全量刷新 ---------- */
  await until(`${CHIP} && ${CHIP}.dataset.poll === 'idle'`, 6000);
  const apiInfo = await evaluate("({ has: typeof window.devstack.refreshStatus, chipTag: " + CHIP + ".tagName })");
  ok(apiInfo.has === 'function' && apiInfo.chipTag === 'BUTTON', '指示器是可点击按钮，preload 暴露 refreshStatus 通道');
  // MutationObserver 记录每一次状态变化，避免轮询采样漏掉被快速切走的瞬时态
  await evaluate(`(() => { const c = ${CHIP}; window.__pollLog = [];
    window.__pollObs = new MutationObserver(() => window.__pollLog.push({
      p: c.dataset.poll, m: c.dataset.mode, n: c.dataset.scope,
      txt: c.getAttribute('title') || '', busyCls: c.classList.contains('busy'),
      bg: getComputedStyle(c).backgroundColor
    }));
    window.__pollObs.observe(c, { attributes: true, childList: true, subtree: true, characterData: true });
    return true; })()`);
  await evaluate(`${CHIP}.click(); true`);
  const s3 = await sample(2200, 50);
  const seen = [...s3, ...(await evaluate('window.__pollLog') || [])];
  await evaluate('window.__pollObs.disconnect(); true');
  ok(seen.some(x => x.p === 'busy' && x.m === 'manual'), '点击指示器触发手动全量刷新（图标高亮可见）');
  // 提亮是 transition 渐变，起始帧会读到旧色；切到 5 秒档（busy 620ms）等渐变完成后读稳定值
  await evaluate('window.devstack.setSettings({pollMs:5000}).then(r => r.ok)');
  await until(`${CHIP} && ${CHIP}.dataset.poll === 'idle'`, 8000);
  await evaluate(`${CHIP}.click(); true`);
  ok(await until(`${CHIP}.classList.contains('busy') && ${CHIP}.dataset.mode === 'manual'`, 8000),
    '手动全量刷新进入高亮态');
  // transition 需要 ~180ms，busy 共 620ms：在 busy 期间轮询到一次稳定高亮即可，不赌固定时间点
  let stable = null;
  for (let i = 0; i < 14 && !stable; i++) {
    const v = await evaluate(`(() => { const c = ${CHIP}; const cs = getComputedStyle(c);
      return { bg: cs.backgroundColor, col: cs.color, busy: c.classList.contains('busy') }; })()`);
    if (v.busy && v.bg.includes('220') && v.col.includes('15')) stable = v;
    else await sleep(40);
  }
  ok(!!stable, '手动刷新比自动心跳更深一档（稳定态 ' + (stable ? stable.bg + ' / ' + stable.col : '未采到') + '）');
  ok(await until(`${CHIP}.dataset.poll === 'idle'`, 8000), '手动刷新结束后回到 idle');
  await evaluate('window.devstack.setSettings({pollMs:1000}).then(r => r.ok)');
  ok(seen.some(x => /正在全量刷新 2 项服务/.test(x.txt)), '悬停提示覆盖含已停止组件的全部 2 项服务');

  /* ---------- 5 布局 ---------- */
  const layout = await evaluate(`(() => { const h = document.querySelector('.panelhead');
    const c = ${CHIP}; const t = h.querySelector('.tools');
    const cr = c.getBoundingClientRect(), hr = h.getBoundingClientRect(), tr = t.getBoundingClientRect();
    return { inside: cr.left >= hr.left && cr.right <= hr.right, noOverlap: cr.right <= tr.left + 1,
      height: hr.height, lines: Math.round(hr.height / 22), chipH: cr.height }; })()`);
  ok(layout.inside, '指示器未溢出标题栏');
  ok(layout.noOverlap, '指示器与右侧工具按钮不重叠');
  ok(layout.height <= 44, '标题栏保持单行（实测 ' + layout.height + 'px）');
  ok(layout.chipH >= 18 && layout.chipH <= 28, '指示器高度与标题栏协调（实测 ' + layout.chipH + 'px）');

  /* ---------- 6 设置页：三档间隔 + 无补充说明 ---------- */
  await evaluate(`(() => { const s = [...document.querySelectorAll('.nav span')].find(x => x.textContent.trim() === '设置');
    if (s) s.click(); return !!s; })()`);
  ok(await until("!!document.querySelector('.setrow .seg')", 8000), '设置页可打开');
  const segInfo = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.setrow')].find(r => (r.textContent || '').includes('状态轮询间隔'));
    if (!row) return null;
    return {
      btns: [...row.querySelectorAll('.seg button')].map(b => ({ txt: b.textContent.trim(), on: b.classList.contains('on') })),
      hint: !!row.querySelector('.pollhint'),
      extra: row.querySelectorAll('.d').length
    }; })()`);
  ok(segInfo && segInfo.btns.map(b => b.txt).join('/') === '1 秒/3 秒/5 秒', '设置页提供 1 / 3 / 5 秒三档');
  // 默认 3 秒已在阶段 0 验证；此处只要求选中态与当前生效间隔一致（前面阶段已改成 1 秒）
  const curMs = await evaluate('window.devstack.getSnapshot().then(s => s.settings.pollMs)');
  ok(segInfo && segInfo.btns.filter(b => b.on).map(b => b.txt).join('/') === (curMs / 1000) + ' 秒',
    '选中态与当前生效间隔一致（实测 ' + curMs / 1000 + ' 秒）');
  ok(segInfo && !segInfo.hint && segInfo.extra <= 1, '「状态轮询间隔」已无右侧/下方补充说明文字');
  const settingsShot = await shot('ui-settings-poll-interval.png');
  ok(fs.existsSync(settingsShot), '已保存设置页三档截图');
  await evaluate(`(() => { const row = [...document.querySelectorAll('.setrow')].find(r => (r.textContent || '').includes('状态轮询间隔'));
    const b = [...row.querySelectorAll('.seg button')].find(x => x.textContent.trim() === '5 秒'); if (b) b.click(); return !!b; })()`);
  await evaluate(`(() => { const s = [...document.querySelectorAll('.nav span')].find(x => x.textContent.trim() === '服务');
    if (s) s.click(); return !!s; })()`);
  ok(await until(`${CHIP} && ${CHIP}.dataset.interval === '5'`, 8000), '点选 5 秒档后标题栏立即显示 5 秒');
  await evaluate('window.devstack.setSettings({pollMs:1000}).then(r => r.ok)');
  ok(await until(`${CHIP} && ${CHIP}.dataset.interval === '1'`, 8000), '恢复 1 秒档');

  /* ---------- 7 多语言 ---------- */
  await evaluate("localStorage.setItem('devstack.lang','en'); true");
  await cdp.send('Page.reload', { ignoreCache: true });
  ok(await until(`${CHIP} !== null`, 20000), '切换到英文并重载后指示器仍渲染');
  const en = await evaluate(READ);
  ok(!/[\u3400-\u9fff]/.test(en.txt), '英文下指示器文案无中文残留：' + en.txt);
  const sEn = await sample(2400);
  ok(sEn.some(x => /started|Auto refresh|started services/.test(x.txt)), '英文下仍能看到刷新中 / 空闲状态文案');
  await evaluate("localStorage.setItem('devstack.lang','zh-CN'); true");

  /* ---------- 7 渲染器无 error ---------- */
  const knownNoise = /Unknown VE context|Autofill\.enable|Failed to load resource|favicon|DevTools|Electron Security Warning|Insecure Content-Security-Policy/;
  const rendererErrors = mainLog.split('\n').filter(l => /\[devstack\]\[renderer/.test(l) && !knownNoise.test(l));
  ok(rendererErrors.length === 0, '渲染器无 error 级日志' + (rendererErrors.length ? '：' + rendererErrors[0].slice(0, 120) : ''));

  console.log('\n== 真机验证 ' + pass + ' PASS / ' + fail + ' FAIL ==');
})().catch(e => {
  fail++;
  console.error('验证异常：' + (e && e.stack || e));
  console.log('\n=== 主进程日志（尾部）===\n' + mainLog.split('\n').slice(-25).join('\n'));
  console.log('\n== 真机验证 ' + pass + ' PASS / ' + fail + ' FAIL ==');
}).finally(async () => {
  try { if (cdp && cdp.ws && cdp.ws.readyState === 1) cdp.ws.close(); } catch { /* ignore */ }
  try { holder.kill('SIGKILL'); } catch { /* ignore */ }
  // 杀整棵进程树：只 kill 主进程会留下 GPU / renderer 子进程，连续复跑时会占住 CDP 端口
  if (process.platform === 'win32') {
    try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch { /* 已退出 */ }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* */ } }
  }
  await sleep(700);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exitCode = fail ? 1 : 0;
});
