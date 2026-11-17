/* ============================================================
 * Electron 主进程入口
 * ============================================================ */
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { store } from './store';
import { ProbeScheduler } from './probe';
import { initSchedule } from './schedule';
import { registerIpc } from './ipc';
import { ensureTemplatesSeeded } from './template';
import { appDataRoot } from './paths';
import { logs } from './logs';

// --dev 由 npm run dev 传入；也可显式设置 VITE_DEV_SERVER_URL 覆盖地址。
// 不依赖平台相关的环境变量写法，保证 Windows / macOS / Linux 同一套命令。
const isDev = process.argv.includes('--dev') || !!process.env.VITE_DEV_SERVER_URL;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ||
  'http://localhost:' + (process.env.DEVSTACK_VITE_PORT || 5173);

// 开发者工具默认关闭：npm run dev 不再额外弹出一个独立的 DevTools 窗口。
// 需要排查渲染器问题时显式开启：npm run dev:tools，或 DEVSTACK_DEVTOOLS=1 npm run dev。
// --devtools 由 scripts/launch-electron.js 转成环境变量，不会透传给 Chromium。
const devToolsRequested =
  /^(1|true|yes|on)$/i.test(process.env.DEVSTACK_DEVTOOLS || '') ||
  process.argv.includes('--devtools');

let win: BrowserWindow | null = null;
let probe: ProbeScheduler;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#F4F6F9',   // 与页面底色一致，避免冷启动瞬间闪灰/闪白
    title: '本地服务管理器',
    show: false,                  // 页面加载完成前先不显示，避免白屏闪烁
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  store.attachWindow(win);

  // 启动可观测性：内测时可从终端日志直接判断页面是否真的渲染（而非只开了个空窗口）
  // 这些是开发者诊断日志（主进程不持有词典），统一用英文以保证与界面语言无关
  const wc = win.webContents;
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[devstack] page load failed code=' + code + ' desc=' + desc + ' url=' + url);
  });
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error('[devstack][renderer:' + level + '] ' + message);
  });
  wc.on('did-finish-load', () => {
    console.log('[devstack] page load finished url=' + wc.getURL());
    // 页面加载完成后再显示窗口，避免白屏闪烁
    win?.show();
    // 启动自检：>0 表示 React 已挂载；为 0 通常是 preload 未注入或渲染器脚本报错
    setTimeout(() => {
      void wc.executeJavaScript(
        'document.getElementById("root") ? document.getElementById("root").childElementCount : -1'
      ).then(n => {
        console.log('[devstack] renderer mounted nodes=' + n);
        console.log('[devstack] devtoolsOpened=' + wc.isDevToolsOpened());
      }).catch(() => { /* 页面已关闭 */ });
    }, 1500);
  });

  // 外部链接走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 修订 40（交叉验证 K13）：只允许 http/https 交给系统浏览器
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    // dist-electron/main/main/index.js → ../../renderer/index.html
    void win.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  // 仅显式请求时打开；默认不弹窗，也不影响生产模式
  if (devToolsRequested) win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  console.log('[devstack] mode=' + (isDev ? 'dev' : 'production') +
    ' devtools=' + (devToolsRequested ? 'on' : 'off') +
    ' url=' + (isDev ? DEV_SERVER_URL : path.join(__dirname, '../../renderer/index.html')) +
    ' data=' + appDataRoot());

  // 仅首次运行播种模板（目录已存在则不动，用户改删不被补回）
  ensureTemplatesSeeded();

  // 探测调度器
  probe = new ProbeScheduler({
    getServices: () => store.services(),
    getSt: (id) => store.state(id).st,
    onPatch: (id, patch) => store.patchState(id, patch),
    onCycle: (cycle) => store.pollCycle(cycle),
    pollMs: store.settings().pollMs
  });

  initSchedule({
    probe,
    openUrl: (url) => void shell.openExternal(url),
    openDir: async (dir) => {
      if (!dir || !dir.trim()) return;
      try { await shell.openPath(dir.trim()); } catch { /* 忽略，上层已有 toast 反馈 */ }
    }
  });

  registerIpc();
  createWindow();

  // 冷启动全量基线 + 心跳
  probe.start();
  void probe.baseline();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  probe?.stop();
  logs.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  probe?.stop();
  logs.stopAll();
});
