/* ============================================================
 * 真实启动验证：npm run dev 不再弹出独立的 Developer Tools 窗口
 *
 * 场景 A：npm run dev        → 主进程日志 devtools=off / devtoolsOpened=false
 * 场景 B：npm run dev:tools  → 显式开关仍可打开 devtools=on / devtoolsOpened=true
 *
 * 判定依据是 Electron 自己的 webContents.isDevToolsOpened()，不是源码文本。
 * 两个场景使用独立 Vite 端口 + 独立数据目录，不触碰 %APPDATA%\devstack。
 * 运行：npm run verify:devtools（需先 npm run build）
 * ============================================================ */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch { /* 已退出 */ }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* */ } }
  }
}

async function runScenario(name, script, vitePort, expectOn) {
  console.log('\n=== 场景：' + name + ' (npm run ' + script + ') ===');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstack-dtverify-'));
  const env = {
    ...process.env,
    DEVSTACK_DATA_DIR: dataDir,
    DEVSTACK_USER_DATA_DIR: path.join(dataDir, 'userdata'),
    DEVSTACK_VITE_PORT: String(vitePort)
  };
  // IDE 注入 / 外部环境都不得影响本次判定
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.VITE_DEV_SERVER_URL;
  delete env.DEVSTACK_DEVTOOLS;

  const child = spawn(npmCmd, ['run', script], {
    cwd: appRoot,
    env,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d.toString(); });
  child.stderr.on('data', d => { log += d.toString(); });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !/devtoolsOpened=(true|false)/.test(log)) {
    if (child.exitCode !== null) break;
    await sleep(300);
  }
  await sleep(400);

  const modeLine = (log.split('\n').find(l => l.includes('[devstack] mode=')) || '').trim();
  const opened = /devtoolsOpened=(true|false)/.exec(log);
  const alive = child.exitCode === null;
  console.log('  数据目录(隔离): ' + dataDir);
  console.log('  ' + (modeLine || '(未捕获主进程模式行)'));

  ok(/\[devstack\] mode=dev/.test(log), '以 dev 模式启动（与 npm run dev 同一代码路径）');
  ok(modeLine.includes('devtools=' + (expectOn ? 'on' : 'off')),
    '启动日志标记 devtools=' + (expectOn ? 'on' : 'off'));
  ok(!!opened && opened[1] === String(expectOn),
    '窗口实际状态 devtoolsOpened=' + expectOn + '（实测 ' + (opened ? opened[1] : '未捕获') + '）');
  ok(log.includes('[devstack] page load finished') && !log.includes('[devstack] page load failed'), '页面真实加载完成');
  ok(alive, '进程在观察期内未退出');
  ok(!/Uncaught Exception|Cannot read properties of undefined/.test(log), '无致命启动错误');

  killTree(child);
  await sleep(1000);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* 进程占用时忽略 */ }
}

(async () => {
  await runScenario('默认关闭', 'dev', 5201, false);
  await sleep(1200);
  await runScenario('显式开启', 'dev:tools', 5202, true);
  console.log('\n=== 真机验证：' + pass + '/' + (pass + fail) + ' PASS ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('DEVTOOLS_VERIFY_ERROR', e); process.exit(2); });
