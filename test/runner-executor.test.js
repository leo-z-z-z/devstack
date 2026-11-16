/* 脚本模式核心：resolveInterpreter 三平台执行器解析
 * - runner 留空：按脚本扩展名选默认系统工具（.bat/.cmd/.ps1/.sh/其他）
 * - runner 指定：file 换成该可执行文件，但「让脚本跑起来的最小参数模板」仍按扩展名保留
 * 运行：node test/runner-executor.test.js（需先 npx tsc -p tsconfig.electron.json）
 */
const path = require('node:path');

const RUNNER = path.join(__dirname, '..', 'dist-electron', 'main', 'main', 'runner.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

/** 以指定 process.platform 重新加载 runner 模块（IS_WIN 在加载时固化） */
function loadAs(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  delete require.cache[require.resolve(RUNNER)];
  return require(RUNNER);
}
const realPlatform = process.platform;
function restore() {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  delete require.cache[require.resolve(RUNNER)];
}

try {
  console.log('== 阶段 1 · Windows：默认执行器（runner 留空） ==');
  let R = loadAs('win32');
  let r = R.resolveInterpreter('C:/app/start.bat');
  ok(r.file === 'cmd.exe' && JSON.stringify(r.prefix) === JSON.stringify(['/d', '/s', '/c', 'C:/app/start.bat']), '.bat 默认 cmd.exe /d /s /c');
  r = R.resolveInterpreter('C:/app/stop.cmd');
  ok(r.file === 'cmd.exe' && r.prefix[0] === '/d', '.cmd 同样走 cmd.exe');
  r = R.resolveInterpreter('C:/app/x.ps1');
  ok(r.file === 'powershell.exe' && r.prefix.slice(0, 4).join(' ') === '-NoProfile -ExecutionPolicy Bypass -File', '.ps1 默认 powershell.exe -File');
  r = R.resolveInterpreter('C:/app/tool.exe');
  ok(r.file === 'C:/app/tool.exe' && r.prefix.length === 0, '.exe 直接执行、无前缀');

  console.log('== 阶段 2 · Windows：runner 替换执行器、参数模板保留 ==');
  r = R.resolveInterpreter('C:/app/start.bat', 'cmd.exe');
  ok(r.file === 'cmd.exe' && JSON.stringify(r.prefix) === JSON.stringify(['/d', '/s', '/c', 'C:/app/start.bat']), '指定 cmd.exe 跑 .bat：最小参数不丢');
  r = R.resolveInterpreter('C:/app/x.ps1', 'pwsh');
  ok(r.file === 'pwsh' && r.prefix[0] === '-NoProfile' && r.prefix[r.prefix.length - 1] === 'C:/app/x.ps1', '指定 pwsh 跑 .ps1：执行器替换、-File 模板保留');
  r = R.resolveInterpreter('C:/app/tool.exe', 'C:/tools/wrapper.exe');
  ok(r.file === 'C:/tools/wrapper.exe' && JSON.stringify(r.prefix) === JSON.stringify(['C:/app/tool.exe']), '指定执行器跑 .exe：脚本作为首参传入');
  r = R.resolveInterpreter('C:/app/start.bat', '  cmd.exe  ');
  ok(r.file === 'cmd.exe', 'runner 首尾空白被 trim');

  console.log('== 阶段 3 · Linux/mac：默认执行器 ==');
  R = loadAs('linux');
  r = R.resolveInterpreter('/opt/app/start.sh');
  ok(r.file === '/bin/sh' && JSON.stringify(r.prefix) === JSON.stringify(['/opt/app/start.sh']), '.sh 默认 /bin/sh');
  r = R.resolveInterpreter('/opt/app/launcher');
  ok(r.file === '/opt/app/launcher' && r.prefix.length === 0, '无扩展名可执行文件直接执行（依赖 shebang）');

  console.log('== 阶段 4 · Linux/mac：runner 替换执行器 ==');
  r = R.resolveInterpreter('/opt/app/start.sh', '/bin/bash');
  ok(r.file === '/bin/bash' && JSON.stringify(r.prefix) === JSON.stringify(['/opt/app/start.sh']), '指定 /bin/bash 跑 .sh');
  r = R.resolveInterpreter('/opt/app/launcher', '/bin/bash');
  ok(r.file === '/bin/bash' && JSON.stringify(r.prefix) === JSON.stringify(['/opt/app/launcher']), '指定 /bin/bash 跑可执行文件');
  r = R.resolveInterpreter('/opt/app/start.sh', 'bash');
  ok(r.file === 'bash', 'PATH 内命令名 runner 原样作为 file');

  console.log('== 阶段 5 · macOS 与 Linux 行为一致 ==');
  R = loadAs('darwin');
  r = R.resolveInterpreter('/opt/app/start.sh', '/bin/zsh');
  ok(r.file === '/bin/zsh' && r.prefix[0] === '/opt/app/start.sh', 'darwin 下 runner 同样生效');
} finally {
  restore();
}

console.log('\n== ' + pass + ' PASS / ' + fail + ' FAIL ==');
process.exit(fail ? 1 : 0);
