/* 用 app 真实构建产物 runner.js + 真实 services.yaml 复现 Redis 启动
 * 运行：node scripts/repro-redis-real-runner.js
 */
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const yaml = require('js-yaml');

const RUNNER = path.join(__dirname, '..', 'dist-electron', 'main', 'main', 'runner.js');
const YAML = process.env.APPDATA + '\\devstack\\services.yaml';

const runner = require(RUNNER);
const raw = yaml.load(fs.readFileSync(YAML, 'utf8'));
const svc = raw.services.find(s => s.name === 'Redis');

console.log('=== services.yaml 中 Redis 的实际配置 ===');
console.log('dir     =', svc.dir);
console.log('command =', svc.cfg.acts.start.command);
console.log('args    =', JSON.stringify(svc.cfg.acts.start.args));
console.log('---');

console.log('=== app 真实 runner 的解释器解析结果 ===');
const ri = runner.resolveInterpreter(svc.cfg.acts.start.command, svc.cfg.acts.start.runner);
console.log('file   =', JSON.stringify(ri.file));
console.log('prefix =', JSON.stringify(ri.prefix));
console.log('---');

function probe() {
  return new Promise(res => {
    const s = new net.Socket();
    s.setTimeout(800);
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('timeout', () => { s.destroy(); res(false); });
    s.once('error', () => { s.destroy(); res(false); });
    try { s.connect(svc.port, '127.0.0.1'); } catch { res(false); }
  });
}

// 直接调用 app 的 execAction（与 schedule.doStart 完全同一条路径）
console.log('=== 调用 app 的 execAction（真实失败路径） ===');
const h = runner.execAction('svc-k38ptp', svc.cfg.acts.start, svc.dir, (code) => {
  console.log('>>> 子进程退出，code =', code);
});
console.log('pid =', h.pid);

(async () => {
  await new Promise(r => setTimeout(r, 2500));
  const up = await probe();
  console.log('>>> 端口', svc.port, up ? '已 LISTEN（启动成功）' : '未 LISTEN（启动失败）');

  if (!up) {
    console.log('');
    console.log('>>> 结论：app 用未展开的 ${installDir} 去 spawn，Windows 找不到该路径 → ENOENT');
    console.log('>>> 进程立即退出，端口永远不会就绪 → 表现为「启动失败 / 启动超时」');
    process.exit(1);
  }
  console.log('>>> 启动成功');
  process.exit(0);
})();
