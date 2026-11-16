/* ============================================================
 * 启动链路自检（可选，非产品运行时依赖）
 *
 * 真实拉起两次 Electron 窗口，验证：
 *   npm run dev   → Vite HMR 模式，页面来自 http://localhost:5173
 *   npm start     → 构建产物模式，页面来自 dist-electron/renderer/index.html
 * 检查主进程模式、窗口进程、端口、模板播种、页面加载、React 挂载、控制台错误。
 *
 * 用法：
 *   npm run check:launch
 *   LAUNCH_ONLY=dev LAUNCH_DUMP=1 node scripts/launch-check.js   # 单场景 + 完整输出
 *
 * 注意：会短暂弹出应用窗口与 DevTools，验证结束后自动关闭；
 *       数据写入系统临时目录的隔离文件夹，不会动你的 %APPDATA%\devstack。
 * ============================================================ */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const CWD = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 自检用独立 Vite 端口与独立 userData：用户同时开着 npm run dev 也不会互相抢
const SELF_PORT = 5199;

function portOnce(host, port) {
  return new Promise(res => {
    const s = net.connect({ host, port });
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.setTimeout(900, () => { s.destroy(); res(false); });
  });
}
async function portOpen(port) {
  // Vite 默认监听 localhost，在 Node 20 下可能优先绑定 IPv6 ::1
  return (await portOnce('127.0.0.1', port)) || (await portOnce('::1', port)) || (await portOnce('localhost', port));
}
function electronCount() {
  if (process.platform === 'win32') {
    try {
      const o = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', { encoding: 'utf8' });
      return (o.match(/electron\.exe/g) || []).length;
    } catch { return -1; }
  }
  try {
    const o = execSync("ps -eo args | grep -i '[E]lectron' | grep -v grep | wc -l", { encoding: 'utf8' });
    return parseInt(o.trim(), 10) || 0;
  } catch { return -1; }
}
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* */ }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* */ } }
  }
}

async function runScenario(name, args, expectDev) {
  const dataDir = path.join(os.tmpdir(), 'devstack-launchcheck-' + name + '-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });
  const scenarioEnv = {
    ...process.env,
    DEVSTACK_DATA_DIR: dataDir,
    DEVSTACK_USER_DATA_DIR: path.join(dataDir, 'userdata')
  };
  if (expectDev) {
    scenarioEnv.DEVSTACK_VITE_PORT = String(SELF_PORT);
    scenarioEnv.VITE_DEV_SERVER_URL = 'http://localhost:' + SELF_PORT;
  }
  const child = spawn(npmCmd, args, {
    cwd: CWD,
    env: scenarioEnv,
    shell: process.platform === 'win32',       // Windows 下 npm.cmd 必须经 cmd.exe
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { err += d.toString(); });

  const deadline = Date.now() + 75000;
  while (Date.now() < deadline && !out.includes('[devstack] mode=')) {
    if (child.exitCode !== null) break;
    await sleep(300);
  }
  // 等待渲染器挂载日志而不是固定 sleep：高负载时 4.2s 可能不够，会误报「白屏」
  const mountDeadline = Date.now() + 15000;
  while (Date.now() < mountDeadline && !/\[devstack\] renderer mounted nodes=\d+/.test(out + '\n' + err)) {
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  await sleep(800);   // 给模板播种 / 控制台错误回传留余量

  const presetsDir = path.join(dataDir, 'presets');
  const presetCount = fs.existsSync(presetsDir)
    ? fs.readdirSync(presetsDir).filter(f => /\.json$/i.test(f)).length : 0;
  const selfPort = await portOpen(SELF_PORT);
  const alive = child.exitCode === null;
  const ecount = electronCount();
  const all = out + '\n' + err;
  const fatal = all.match(/Uncaught Exception|Cannot find module|ERR_MODULE_NOT_FOUND|Error: ENOENT[^\n]*index\.html/g) || [];
  const pageLoaded = all.includes('[devstack] page load finished');
  const pageFailed = all.includes('[devstack] page load failed');
  const mountMatch = all.match(/\[devstack\] renderer mounted nodes=(\d+)/);
  const mounted = !!mountMatch && Number(mountMatch[1]) > 0;
  const rendererError = /\[devstack\]\[renderer:3\]/.test(all);

  const checks = [
    ['主进程启动并打印模式', all.includes('[devstack] mode=' + (expectDev ? 'dev' : 'production'))],
    ['进程存活（75s 内未退出）', alive],
    ['Electron 窗口进程存在', ecount !== 0],
    ['Vite dev server 状态正确', expectDev ? selfPort : !selfPort],
    ['首次播种模板 9 个', presetCount === 9],
    ['渲染器页面真实加载完成', pageLoaded && !pageFailed],
    ['React 根节点已挂载（非白屏）', mounted],
    ['渲染器无 error 级控制台错误', !rendererError],
    ['无致命加载错误', fatal.length === 0]
  ];

  console.log('\n=== 场景：' + name + ' (npm ' + args.join(' ') + ') ===');
  if (process.env.LAUNCH_DUMP === '1') {
    console.log('--- stdout(全) ---\n' + out.slice(0, 6000));
    console.log('--- stderr(全) ---\n' + err.slice(0, 6000));
  }
  console.log('  数据目录(隔离): ' + dataDir);
  console.log('  主进程日志: ' + (all.split('\n').find(l => l.includes('[devstack] mode=')) || '(无)'));
  console.log('  页面日志: ' + (all.split('\n').filter(l => l.includes('[devstack] page load') || l.includes('renderer mounted nodes')).join(' | ') || '(无)'));
  console.log('  Vite: ' + (out.split('\n').find(l => /ready in|Local:/.test(l)) || '(无)').trim());
  console.log('  自检端口 ' + SELF_PORT + '=' + selfPort + ' / electron 进程=' + ecount + ' / presets=' + presetCount + ' / alive=' + alive);
  let pass = 0;
  for (const [label, ok] of checks) { console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label); if (ok) pass++; }
  if (rendererError) console.log('  渲染器错误: ' + (all.split('\n').filter(l => l.includes('[devstack][renderer:3]')).slice(0, 3).join(' | ') || ''));

  killTree(child);
  await sleep(800);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* 进程占用时忽略 */ }
  return { name, pass, total: checks.length };
}

(async () => {
  const results = [];
  const only = process.env.LAUNCH_ONLY || '';
  if (!only || only === 'dev') results.push(await runScenario('dev', ['run', 'dev'], true));
  if (!only || only === 'start') {
    if (results.length) await sleep(1200);
    results.push(await runScenario('start', ['start'], false));
  }
  const p = results.reduce((a, r) => a + r.pass, 0);
  const t = results.reduce((a, r) => a + r.total, 0);
  console.log('\n=== 启动链路自检：' + p + '/' + t + ' PASS ===');
  process.exit(p === t ? 0 : 1);
})().catch(e => { console.error('LAUNCH_CHECK_ERROR', e); process.exit(2); });
