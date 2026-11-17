/* ============================================================
 * 等待 Vite dev server 就绪（npm run dev 的第二条泳道）
 *
 * 端口与 vite.config.ts 共用 DEVSTACK_VITE_PORT，默认 5173，行为与原来的
 * `wait-on http://localhost:5173` 等价；设置该环境变量后可在自检 / 并行
 * 调试时使用独立端口，不会和已运行的 dev 会话抢 5173。
 * 同时探测 IPv4 / IPv6 / localhost，兼容 Vite 在不同 Node 版本下的绑定差异。
 * ============================================================ */
const net = require('node:net');

const port = Number(process.env.DEVSTACK_VITE_PORT || 5173);
const url = 'http://localhost:' + port;
const TIMEOUT_MS = 60000;
const POLL_MS = 100;

function once(host) {
  return new Promise(res => {
    const s = net.connect({ host, port });
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.setTimeout(500, () => { s.destroy(); res(false); });
  });
}
async function ready() {
  return (await once('127.0.0.1')) || (await once('::1')) || (await once('localhost'));
}

(async () => {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ready()) {
      console.log('[devstack] Vite 就绪 ' + url);
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  console.error('[devstack] 等待 Vite 超时 ' + url);
  process.exit(1);
})();
