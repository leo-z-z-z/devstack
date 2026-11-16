/* 验证：把占位符展开为真实路径后，Redis 能否被 app 的执行层正常拉起
 * 运行：node scripts/verify-redis-expanded.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

const DIR = 'D:\\env\\redis5.0';
// 与 template.ts instantiate() 一致：expand({installDir, port}) 后再 normalize
const ctx = { installDir: DIR, port: '6379' };
function expand(s) { return s.replace(/\$\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m)); }

const action = {
  type: 'exec',
  command: '${installDir}\\redis-server.exe',
  args: ['${installDir}/redis.windows.conf'],
  timeoutMs: 15000
};

const cmd = path.normalize(expand(action.command));
const args = action.args.map(a => path.normalize(expand(a)));
const cwd = path.normalize(expand(DIR));

console.log('=== 展开后的 spawn 调用 ===');
console.log('file =', JSON.stringify(cmd));
console.log('args =', JSON.stringify(args));
console.log('cwd  =', JSON.stringify(cwd));
console.log('---');

const child = spawn(cmd, args, {
  cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false
});

let out = '';
child.stdout.on('data', d => { out += d.toString(); });
child.stderr.on('data', d => { out += d.toString(); });

child.on('error', e => { console.log('>>> ERROR:', e.code, e.message.split('\n')[0]); process.exit(1); });

// 探测 6379 是否被拉起
function probe() {
  return new Promise(res => {
    const s = new net.Socket();
    s.setTimeout(800);
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('timeout', () => { s.destroy(); res(false); });
    s.once('error', () => { s.destroy(); res(false); });
    try { s.connect(6379, '127.0.0.1'); } catch { res(false); }
  });
}

(async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await probe()) {
      console.log('>>> 端口 6379 已 LISTEN —— Redis 启动成功');
      console.log('--- redis 输出 ---');
      console.log(out.split(/\r?\n/).slice(-12).join('\n'));
      console.log('--- 进程 pid =', child.pid);
      process.exit(0);
    }
  }
  console.log('>>> 8 秒内端口未就绪');
  console.log('--- redis 输出 ---');
  console.log(out.slice(-2000));
  process.exit(1);
})();
