/* ============================================================
 * 真实 Electron 窗口验证：模板页直接编辑 JSON → 保存 → 磁盘回读
 * 用隔离数据目录，不触碰 %APPDATA%\devstack；结束后自动关闭窗口并清理。
 * 运行：node scripts/verify-template-edit.js（需先 npm run build）
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const appRoot = path.resolve(__dirname, '..');
const electronBin = require('electron');
const PORT = 9333;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-tplverify-'));
const shotDir = path.resolve(appRoot, '..', 'docs');

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
async function shot(file) {
  // 截图只是交付物，不阻断功能验证；窗口在后台时 CDP 可能拿不到 surface
  try {
    await cdp.send('Page.bringToFront');
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000);
    fs.writeFileSync(path.join(shotDir, file), Buffer.from(r.data, 'base64'));
    console.log('INFO 截图已保存：' + file);
    return true;
  } catch (e) {
    console.log('INFO 截图跳过（' + e.message + '），功能验证继续');
    return false;
  }
}

(async () => {
  // 1. 等 CDP 页面就绪并连接
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

  // 2. 进入模板库页
  await evaluate("document.querySelectorAll('.nav span')[3].click()");
  ok(await until("!!document.querySelector('textarea.tpljson.edit')", 12000), '模板库页出现可编辑 JSON 文本域');
  const fileName = await evaluate("document.querySelector('.tplitem.on .mono')?.textContent || ''");
  ok(/^[a-z0-9-]+\.json$/.test(fileName), '选中模板文件：' + fileName);
  const diskFile = path.join(dataDir, 'presets', fileName);
  const before = fs.readFileSync(diskFile, 'utf8');
  ok(before.length > 50, '隔离模板目录中已播种模板文件');

  // 2.5 布局：删除按钮位于 JSON 工具条「保存修改」之后，校验结果区不再有按钮
  const layout = await evaluate(`(() => {
    const tools = document.querySelector('.tpljsonhd .tools');
    const head = document.querySelector('.tpljsonhd .tplreshd');
    const del = tools && tools.querySelector('.btn.tpldel');
    const save = tools && [...tools.querySelectorAll('button')].find(b => b.textContent.includes('保存修改'));
    if (!tools || !head || !del || !save) return null;
    const d = del.getBoundingClientRect(), s = save.getBoundingClientRect();
    const h = head.getBoundingClientRect(), tw = tools.getBoundingClientRect();
    return {
      afterSave: d.left > s.right,
      sameRow: Math.abs(d.top - s.top) < 3,
      noResultBtn: document.querySelectorAll('.tplresult button').length === 0,
      btnCount: tools.querySelectorAll('button').length,
      noOverlap: tw.left >= h.right - 1,
      gap: Math.round(d.left - s.right)
    };
  })()`);
  ok(!!layout && layout.afterSave && layout.sameRow && layout.noResultBtn && layout.btnCount === 4 && layout.noOverlap,
    '删除按钮位于「保存修改」之后（后置=' + (layout && layout.afterSave) + ' 同行=' + (layout && layout.sameRow) +
    ' 结果区无按钮=' + (layout && layout.noResultBtn) + ' 工具条按钮数=' + (layout && layout.btnCount) +
    ' 不与标题重叠=' + (layout && layout.noOverlap) + ' 间距=' + (layout && layout.gap) + 'px）');

  // 3. 通过 React 原生 setter 修改 JSON（模拟真实输入）
  const changed = await evaluate(`(() => {
    const ta = document.querySelector('textarea.tpljson.edit');
    const o = JSON.parse(ta.value);
    o.meta.name = '内测-编辑验证';
    const v = JSON.stringify(o, null, 2);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, v);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return v;
  })()`);
  ok(await until("!!document.querySelector('.tpldirty')", 5000), '编辑后出现「未保存」标记');

  // 4. 点击「保存修改」
  await evaluate("[...document.querySelectorAll('.tpljsonhd .tools button')].find(b => b.textContent.includes('保存修改')).click()");
  ok(await until("!!document.querySelector('.tplsavebar.ok')", 12000), '保存成功提示出现');
  const after = fs.readFileSync(diskFile, 'utf8');
  ok(JSON.parse(after).meta.name === '内测-编辑验证', '磁盘文件已写入修改后的名称');
  ok(after === changed, '磁盘内容与编辑器文本逐字一致');
  ok(!(await evaluate("!!document.querySelector('.tpldirty')")), '保存后「未保存」标记消失');
  const scanName = await evaluate("document.querySelector('.tplitem.on span:not(.mono)')?.textContent || ''");
  ok(scanName === '内测-编辑验证', '左侧列表已刷新为新名称：' + scanName);
  await shot('ui-template-editor-saved.png');

  // 5. Ctrl+S 快捷键
  const changed2 = await evaluate(`(() => {
    const ta = document.querySelector('textarea.tpljson.edit');
    const o = JSON.parse(ta.value);
    o.defaults.displayName = '快捷键验证';
    const v = JSON.stringify(o, null, 2);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, v);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return v;
  })()`);
  ok(await until("!!document.querySelector('.tpldirty')", 5000), 'Ctrl+S 前置：修改已标记为未保存');
  await evaluate(`(() => {
    const ta = document.querySelector('textarea.tpljson.edit');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    return true;
  })()`);
  ok(await until("document.querySelector('.tplsavebar.ok') !== null && !document.querySelector('.tpldirty')", 12000), 'Ctrl+S 触发保存');
  ok(JSON.parse(fs.readFileSync(diskFile, 'utf8')).defaults.displayName === '快捷键验证', 'Ctrl+S 保存内容已落盘');

  // 6. 语法错误 → 拒绝写入
  await evaluate(`(() => {
    const ta = document.querySelector('textarea.tpljson.edit');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '{ "meta": [1, 2, ] }');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evaluate("[...document.querySelectorAll('.tpljsonhd .tools button')].find(b => b.textContent.includes('保存修改')).click()");
  ok(await until("!!document.querySelector('.tplsavebar.err')", 12000), '语法错误显示红色错误条');
  const errText = await evaluate("document.querySelector('.tplsavebar .tplsavedetail')?.textContent || ''");
  ok(/line \d+, column \d+/.test(errText), '错误条含行列定位：' + errText.slice(0, 90));
  ok(fs.readFileSync(diskFile, 'utf8') === changed2, '语法错误时磁盘文件未被破坏');
  await shot('ui-template-editor-error.png');

  // 7. 磁盘上没有 tmp 残留
  ok(fs.readdirSync(path.join(dataDir, 'presets')).filter(f => f.endsWith('.tmp')).length === 0, '模板目录无 .tmp 残留');

  // 8. 渲染器无 error 级日志（排除 Electron 自身噪声）
  const knownNoise = /Unknown VE context|Autofill\.enable|Failed to load resource|favicon|DevTools|Electron Security Warning|Insecure Content-Security-Policy/;
  const rendererErrors = mainLog.split('\n').filter(l => /\[devstack\]\[renderer/.test(l) && !knownNoise.test(l));
  ok(rendererErrors.length === 0, '渲染器无 error 级日志' + (rendererErrors.length ? '：' + rendererErrors[0].slice(0, 120) : ''));

  console.log('\n== 真机验证 ' + pass + ' PASS / ' + fail + ' FAIL ==');
  console.log('截图：docs/ui-template-editor-saved.png、docs/ui-template-editor-error.png');
})().catch(e => {
  fail++;
  console.error('验证异常：' + (e && e.stack || e));
  console.log('\n=== 主进程日志（尾部）===\n' + mainLog.split('\n').slice(-25).join('\n'));
  console.log('\n== 真机验证 ' + pass + ' PASS / ' + fail + ' FAIL ==');
}).finally(async () => {
  try { wsClose(); } catch { /* ignore */ }
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  await sleep(900);
  try { child.kill('SIGKILL'); } catch { /* 已退出则忽略 */ }
  await sleep(300);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exitCode = fail ? 1 : 0;
});

function wsClose() {
  // CDP 对象持有连接；关闭以避免进程挂住
  if (cdp && cdp.ws && cdp.ws.readyState === 1) cdp.ws.close();
}
