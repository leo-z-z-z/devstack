/* 复刻 runner.ts execAction 的 spawn 调用，用于定位 Redis 启动失败原因
 * 运行：node scripts/repro-redis-start.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

// ---- 与 services.yaml 中 Redis 服务的配置完全一致 ----
const action = {
  type: 'exec',
  command: '${installDir}\\redis-server.exe',
  args: ['${installDir}/redis.windows.conf'],
  timeoutMs: 15000
};
const cwd = 'D:\\env\\redis5.0';

// ---- 复刻 runner.ts resolveInterpreter（Windows 分支） ----
function resolveInterpreter(cmd, runner) {
  const ext = path.extname(cmd).toLowerCase();
  const r = (runner || '').trim();
  if (ext === '.bat' || ext === '.cmd') return { file: r || 'cmd.exe', prefix: ['/d', '/s', '/c', cmd] };
  if (ext === '.ps1') return { file: r || 'powershell.exe', prefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cmd] };
  return r ? { file: r, prefix: [cmd] } : { file: cmd, prefix: [] };
}

const { file, prefix } = resolveInterpreter(action.command, action.runner);
const args = [...prefix, ...action.args];

console.log('=== 复刻 app 的 spawn 调用（当前配置） ===');
console.log('file =', JSON.stringify(file));
console.log('args =', JSON.stringify(args));
console.log('cwd  =', JSON.stringify(cwd));
console.log('---');

const child = spawn(file, args, {
  cwd: cwd || undefined,
  detached: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false
});

child.on('error', (e) => {
  console.log('>>> ERROR 事件:', e.code);
  console.log('>>> 完整信息:', e.message.split('\n')[0]);
  console.log('>>> 结论：命令路径不存在 / 无法执行（占位符未展开）');
  process.exit(0);
});
child.on('exit', (code, signal) => {
  console.log('>>> EXIT code =', code, 'signal =', signal);
  process.exit(0);
});
setTimeout(() => { console.log('>>> 3 秒内无 error/exit'); process.exit(0); }, 3000);
