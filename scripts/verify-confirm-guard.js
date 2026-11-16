/* ============================================================
 * 真实 Electron 窗口验证：全部启动 / 全部停止 的「点击前置守卫」
 *
 * 场景 1：服务列表为空 → 点两个按钮都不弹窗，只给一句明确提示
 * 场景 2：注入 1 个服务并等探测收敛为 stopped
 *          → 点「全部停止」不弹窗；点「全部启动」正常弹二次确认
 *
 * 使用隔离数据目录 / 独立调试端口，不触碰 %APPDATA%\devstack；结束自动关窗清理。
 * 运行：node scripts/verify-confirm-guard.js（需先 npm run build）
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const appRoot = path.resolve(__dirname, '..');
const electronBin = require('electron');
const PORT = 9334;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-guardverify-'));

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
  cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe']
});
let mainLog = '';
child.stdout.on('data', d => { mainLog += d.toString(); });
child.stderr.on('data', d => { mainLog += d.toString(); });

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
async function until(expr, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await evaluate(expr)) return true; } catch { /* 页面尚未就绪 */ }
    await sleep(180);
  }
  return false;
}

const BTNS = "document.querySelectorAll('.panelhead .tools button[data-guard]')";
async function clickGuard(index) {
  // 等上一次 toast 消失，保证读到的是本次点击产生的新提示
  await until("!document.querySelector('.toast.on')", 6000);
  await evaluate(`${BTNS}[${index}].click(); true`);
  // 等「弹窗出现」或「toast 出现」，避免异步 IPC 往返导致的固定延时误判
  await until("!!document.querySelector('.mask.on') || !!document.querySelector('.toast.on')", 5000);
  await sleep(160);
  return evaluate(`(() => ({
    modal: !!document.querySelector('.mask.on'),
    title: (document.querySelector('.mask.on .modalhead h3')?.textContent || '').trim(),
    body: (document.querySelector('.mask.on .modal .card > div')?.textContent || '').trim(),
    toast: (document.querySelector('.toast.on')?.textContent || '').trim(),
    guards: [...${BTNS}].map(b => b.dataset.guard)
  }))()`);
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

  /* ---------- 场景 1：服务列表为空 ---------- */
  const n0 = await evaluate('window.devstack.getSnapshot().then(s => s.services.length)');
  ok(n0 === 0, '隔离数据目录：主进程快照确认 0 个服务');
  ok(await until("!!document.querySelector('#cards .empty')", 12000), '空列表占位提示可见');

  const r1 = await clickGuard(0);
  ok(!r1.modal, '空列表点「全部启动」未弹二次确认框');
  ok(/服务列表为空/.test(r1.toast), '空列表点「全部启动」给出明确提示：' + r1.toast);
  ok(r1.guards[0] === 'idle' && r1.guards[1] === 'idle', '空列表时两个按钮都呈弱化态');

  const r2 = await clickGuard(1);
  ok(!r2.modal, '空列表点「全部停止」未弹二次确认框');
  ok(/服务列表为空/.test(r2.toast), '空列表点「全部停止」给出明确提示：' + r2.toast);

  /* ---------- 场景 2：唯一服务处于已停止 ---------- */
  const svc = {
    id: 'guard-svc', name: '守卫验证服务', gid: null, sub: 'guard test',
    port: 29301, dir: dataDir,
    cfg: {
      acts: {
        start: { type: 'exec', command: process.platform === 'win32' ? 'cmd.exe' : 'echo', args: ['/c', 'echo hi'] },
        stop: null, restart: null
      },
      capture: false, follow: false
    }
  };
  const add = await evaluate('window.devstack.upsertService(' + JSON.stringify(svc) + ')');
  ok(add && add.ok, '注入 1 个测试服务成功');
  ok(await until("!!document.querySelector('#cards .svc')", 12000), '服务卡片出现在列表');
  ok(await until(
    "window.devstack.getSnapshot().then(s => s.services.length === 1 && s.states['guard-svc'] && s.states['guard-svc'].st === 'stopped')",
    25000), '探测收敛：唯一服务状态为 stopped');

  const r3 = await clickGuard(1);
  ok(!r3.modal, '全部已停止时点「全部停止」未弹窗');
  ok(/所有服务均已停止|无需再次停止/.test(r3.toast), '全部已停止时给出「无需操作」提示：' + r3.toast);
  ok(r3.guards[1] === 'idle' && r3.guards[0] === 'ready', '按钮弱化态随状态切换：仅「全部启动」可操作');

  const r4 = await clickGuard(0);
  ok(r4.modal, '有可启动项时点「全部启动」正常弹出二次确认');
  ok(/全部启动 · 二次确认/.test(r4.title), '弹窗标题正确：' + r4.title);
  ok(/将启动/.test(r4.body) && /1/.test(r4.body), '弹窗正文写明将启动 1 项（不再是「将启动 0 项」）');
  await evaluate("document.querySelectorAll('.mask.on .modal .btn')[0].click(); true");
  ok(await until("!document.querySelector('.mask.on')", 5000), '取消按钮可关闭确认框（未真正拉起进程）');

  /* ---------- 渲染器无 error ---------- */
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
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(900);
  try { child.kill('SIGKILL'); } catch { /* 已退出则忽略 */ }
  await sleep(300);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exitCode = fail ? 1 : 0;
});
