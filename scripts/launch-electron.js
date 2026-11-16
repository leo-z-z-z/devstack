/* ============================================================
 * 跨平台 Electron 启动器
 *
 * 为什么要多一层：在 VS Code / WorkBuddy 等 Electron 系 IDE 的集成终端里，
 * 宿主会把 ELECTRON_RUN_AS_NODE=1 注入子进程环境变量，导致 electron.exe
 * 以「纯 Node」模式运行，主进程里 require('electron').app 变成 undefined
 * （报错：Cannot read properties of undefined (reading 'whenReady')）。
 * 同理，宿主注入的 NODE_OPTIONS=--require ... 也会污染应用主进程。
 * 这里在拉起 Electron 前清掉这两个变量，只影响本应用进程，不动用户终端。
 *
 * 用法：node scripts/launch-electron.js [--dev] [--devtools]
 *       --devtools 显式打开开发者工具；默认关闭（npm run dev 不会弹 DevTools 窗口）。
 * ============================================================ */
const { spawn } = require('child_process');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const electronBin = require('electron');   // electron 包导出的是可执行文件路径（字符串）

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const rawArgs = process.argv.slice(2);
// --devtools 是本应用自己的开关，转成环境变量即可；不要透传给 Chromium
// （未知开关会被打印成警告，且可能与 Chromium 内置调试参数混淆）。
const wantDevTools = rawArgs.includes('--devtools') ||
  /^(1|true|yes|on)$/i.test(env.DEVSTACK_DEVTOOLS || '');
const passArgs = rawArgs.filter(a => a !== '--devtools');
if (wantDevTools) env.DEVSTACK_DEVTOOLS = '1';

// 自检 / 自动化验证可指定独立 userData，避免与用户已运行的应用抢 GPU / 磁盘缓存
if (env.DEVSTACK_USER_DATA_DIR) passArgs.push('--user-data-dir=' + env.DEVSTACK_USER_DATA_DIR);
const child = spawn(electronBin, ['.', ...passArgs], {
  cwd: appRoot,
  env,
  stdio: 'inherit'
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { child.kill(sig); } catch { /* 已退出 */ } });
}
child.on('error', (e) => {
  console.error('[devstack] Electron 启动失败：' + e.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code === null ? (signal ? 1 : 0) : code);
});
