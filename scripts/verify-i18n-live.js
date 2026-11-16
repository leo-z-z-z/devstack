/* ============================================================
 * 真机 9 语验证：切换语言后逐页 / 逐弹窗扫描 DOM，确认无中文残留
 *
 * 观察点：
 *  1 顶部语言下拉切换后，四个页面（服务 / 日志 / 模板库 / 设置）的可见文本
 *  2 服务编辑器 / 组合编辑器 / 全部启停 toast 三类动态文案
 *  3 以 en/ko/fr/es/de/pt 六个「不用汉字」的语种判定残留（zh-TW / ja 本就用汉字，不判）
 *
 * 使用隔离数据目录 / 独立调试端口，不触碰 %APPDATA%\devstack。
 * 运行：node scripts/verify-i18n-live.js（需先 npm run build）
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const WebSocket = require('ws');

const appRoot = path.resolve(__dirname, '..');
const electronBin = require('electron');
const PORT = 9347;
const LATIN_LANGS = ['en', 'ko', 'fr', 'es', 'de', 'pt'];
const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'es', 'de', 'pt'];
const CJK = /[㐀-鿿]/;

const probePort = spawnSync(process.execPath, ['-e',
  "const s=require('net').createServer();s.once('error',()=>process.exit(1));" +
  "s.listen(" + PORT + ",'127.0.0.1',()=>s.close(()=>process.exit(0)));"], { stdio: 'ignore' });
if (probePort.status !== 0) {
  console.error('[verify-i18n-live] CDP 端口 ' + PORT + ' 已被占用，请先结束残留 electron 进程后重试。');
  process.exit(2);
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-i18nverify-'));
const userData = path.join(dataDir, 'userdata');
const env = { ...process.env, DEVSTACK_DATA_DIR: dataDir, DEVSTACK_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(electronBin, ['.', '--remote-debugging-port=' + PORT, '--user-data-dir=' + userData], {
  cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
});
let mainLog = '';
child.stdout.on('data', d => { mainLog += d.toString(); });
child.stderr.on('data', d => { mainLog += d.toString(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

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
  send(method, params = {}, timeoutMs = 20000) {
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
function targets() {
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
async function until(expr, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await evaluate(expr)) return true; } catch { /* 页面尚未就绪 */ }
    await sleep(130);
  }
  return false;
}

/* 切换顶栏语言下拉 */
const SET_LANG = `(code) => { const sel = document.querySelector('.langsel');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, code); sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.value; }`;

/* 扫描可见文本中的中文残留（跳过语言下拉本身：各语言自称本就是汉字） */
const SCAN = `(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const p = n.parentElement;
    if (!p) continue;
    if (p.closest('.langsel')) continue;          // 语言自名称不参与残留判定
    const t = (n.nodeValue || '').trim();
    if (!t) continue;
    if (!/^[\\u3400-\\u9fff]/.test(t)) continue;
    out.push(t.slice(0, 60));
  }
  return out;
})()`;

async function clickNav(idx) {
  await evaluate(`document.querySelectorAll('.nav span')[${idx}].click(); true`);
  await sleep(320);
}
async function clickByText(sel, text) {
  return evaluate(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
    const hit = els.find(e => (e.textContent || '').includes(${JSON.stringify(text)}));
    if (hit) { hit.click(); return true; } return false; })()`);
}
/* 按位置点击服务列表标题栏工具按钮（语言无关）：
 * 0=全部启动 1=全部停止 2=添加服务(服务编辑器) 3=新建分组(组合编辑器) */
async function clickTool(idx) {
  return evaluate(`(() => { const b = document.querySelectorAll('.panelhead .tools .btn')[${idx}];
    if (!b) return false; b.click(); return true; })()`);
}
async function shot(file) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const dir = path.join(appRoot, '..', 'docs');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, file);
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  return out;
}

(async () => {
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
  ok(await until("!!document.querySelector('.stage')", 25000), 'Electron 窗口已打开且 React 已挂载');
  ok(/\[devstack\] mode=production/.test(mainLog), '以静态产物模式启动');

  const info = await evaluate('window.devstack.appInfo()');
  ok(info && String(info.configPath || '').includes(path.basename(dataDir)),
    '窗口身份校验：configPath 指向本次隔离目录');

  /* ---------- 逐语言逐页扫描 ---------- */
  const NAVS = ['服务列表页', '日志页', '模板库页', '设置页'];
  for (const lang of LANGS) {
    const applied = await evaluate(`(${SET_LANG})(${JSON.stringify(lang)})`);
    ok(applied === lang, '切换语言 → ' + lang);
    await sleep(420);
    for (let i = 0; i < NAVS.length; i++) {
      await clickNav(i);
      const hits = await evaluate(SCAN);
      const label = lang + ' / ' + NAVS[i];
      if (LATIN_LANGS.includes(lang)) {
        ok(hits.length === 0, label + ' 无中文残留' + (hits.length ? '：' + JSON.stringify(hits.slice(0, 3)) : ''));
      } else if (hits.length) {
        console.log('INFO ' + label + '（汉字语种，不判定）残留 ' + hits.length + ' 处');
      }
    }
    /* 动态文案：服务编辑器弹窗 */
    await clickNav(0);
    const opened = await clickTool(2);
    ok(opened, lang + ' / 可打开服务编辑器弹窗');
    if (opened) {
      await sleep(460);
      const hits = await evaluate(SCAN);
      if (LATIN_LANGS.includes(lang)) {
        ok(hits.length === 0, lang + ' / 服务编辑器弹窗 无中文残留' + (hits.length ? '：' + JSON.stringify(hits.slice(0, 3)) : ''));
      }
      await shot('ui-i18n-live-editor-' + lang + '.png');
      await evaluate("document.querySelector('.mask').click(); true");
      await sleep(320);
    }
    /* 动态文案：组合编辑器弹窗 */
    const openedG = await clickTool(3);
    ok(openedG, lang + ' / 可打开组合编辑器弹窗');
    if (openedG) {
      await sleep(460);
      const hits = await evaluate(SCAN);
      if (LATIN_LANGS.includes(lang)) {
        ok(hits.length === 0, lang + ' / 组合编辑器弹窗 无中文残留' + (hits.length ? '：' + JSON.stringify(hits.slice(0, 3)) : ''));
      }
      await evaluate("document.querySelector('.mask').click(); true");
      await sleep(320);
    }
    /* 动态文案：toast（空列表点「全部启动」走守卫提示） */
    await clickTool(0);
    await sleep(460);
    const hits = await evaluate(SCAN);
    if (LATIN_LANGS.includes(lang)) {
      ok(hits.length === 0, lang + ' / toast 提示 无中文残留' + (hits.length ? '：' + JSON.stringify(hits.slice(0, 3)) : ''));
    }
    await shot('ui-i18n-live-' + lang + '.png');
  }

  console.log('\n============================================================');
  console.log('== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  console.log('数据目录：' + dataDir);
  console.log('============================================================');
  try { child.kill(); } catch { /* 已退出 */ }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('VERIFY-I18N-LIVE ERROR', e);
  try { child.kill(); } catch { /* 已退出 */ }
  process.exit(1);
});
