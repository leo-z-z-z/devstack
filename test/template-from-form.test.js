/* 表单→模板纯函数测试：id 生成/去重、安装目录占位符化、6 键结构、必填校验
 * 运行：node test/template-from-form.test.js（需先 npx tsc -p tsconfig.electron.json）
 */
const assert = require('node:assert');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist-electron', 'main');
const f = require(path.join(DIST, 'shared', 'templateFromForm.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

function input(over = {}) {
  return {
    name: 'My Redis', dir: 'C:/dev/redis', port: '6379', url: 'http://localhost:6379',
    acts: {
      start: { cmd: 'C:/dev/redis/redis-server.exe', args: 'C:/dev/redis/redis.conf --port 6379', runner: '', timeout: '15000' },
      stop: { cmd: '', args: '', runner: '', timeout: '8000' },
      restart: { cmd: '', args: '', runner: '', timeout: '15000' }
    },
    ...over
  };
}

console.log('== 阶段 1 · templateSlug id 生成（修订 49：显示名原文，保留中文/大写/空格） ==');
ok(f.templateSlug('My Redis') === 'My Redis', '英文显示名保留原文与大写');
ok(f.templateSlug('Kibana 服务') === 'Kibana 服务', '中英混排保留原文');
ok(f.templateSlug('中文服务') === '中文服务', '纯中文直接作 id，不再回退 custom-template');
ok(f.templateSlug('  My   Redis  ') === 'My Redis', '首尾去空白、连续空白压成单个');
ok(f.templateSlug('  ') === 'custom-template', '空名回退 custom-template');
ok(f.templateSlug('a/b\\c:d*e?f"g<h>i|j') === 'abcdefghij', '路径分隔符与 Windows 保留字符剔除');
ok(f.templateSlug('  .hidden.  ') === 'hidden', '首尾点剔除（避免隐藏文件 / 尾点）');
ok(Array.from(f.templateSlug('A'.repeat(100))).length <= 64, '超长名按码点截断到 64 以内');

console.log('== 阶段 1b · isValidTemplateId 放宽后的合法性（单一规则来源） ==');
ok(f.isValidTemplateId('my-redis') === true, '小写连字符合法');
ok(f.isValidTemplateId('Kibana 服务') === true, '中文 / 大写 / 空格合法');
ok(f.isValidTemplateId('Redis 7.0') === true, '数字与中间点合法');
ok(f.isValidTemplateId('a/b') === false, '正斜杠被拒（路径越界防护）');
ok(f.isValidTemplateId('a\\b') === false, '反斜杠被拒');
ok(f.isValidTemplateId('a:b') === false, 'Windows 盘符冒号被拒');
ok(f.isValidTemplateId('a?b') === false, '通配符被拒');
ok(f.isValidTemplateId('.hidden') === false, '首点被拒');
ok(f.isValidTemplateId('tail.') === false, '尾点被拒');
ok(f.isValidTemplateId(' trailing') === false, '首尾空格被拒');
ok(f.isValidTemplateId('CON') === false, 'Windows 保留设备名被拒');
ok(f.isValidTemplateId('com1') === false, '保留设备名不分大小写');
ok(f.isValidTemplateId('a\u0001b') === false, '控制字符被拒');
ok(f.isValidTemplateId('') === false, '空 id 被拒');

console.log('== 阶段 2 · uniqueTemplateId 去重（修订 49：自动加 -2 / -3 序号） ==');
ok(f.uniqueTemplateId('redis', []) === 'redis', '无重名保持原样');
ok(f.uniqueTemplateId('redis', ['redis']) === 'redis-2', '重名加 -2');
ok(f.uniqueTemplateId('redis', ['redis', 'redis-2']) === 'redis-3', '多个重名递增');
ok(f.uniqueTemplateId('redis', ['redis-2']) === 'redis', '无关 id 不干扰');
ok(f.uniqueTemplateId('中文服务', ['中文服务']) === '中文服务-2', '中文名重名同样加序号');
const longBase = 'a'.repeat(64);
const longUnique = f.uniqueTemplateId(longBase, [longBase]);
ok(Array.from(longUnique).length <= 64 && longUnique.endsWith('-2'), '超长 id 加序号仍不超 64');

console.log('== 阶段 3 · replaceInstallDir 占位符化 ==');
ok(f.replaceInstallDir('C:/dev/redis/redis-server.exe', 'C:/dev/redis') === '${installDir}/redis-server.exe', '命令路径前缀替换');
ok(f.replaceInstallDir('C:\\dev\\redis\\redis.conf', 'C:/dev/redis') === '${installDir}\\redis.conf', '反斜杠命令 + 正斜杠 dir');
ok(f.replaceInstallDir('C:/dev/redis/redis.conf', 'C:\\dev\\redis') === '${installDir}/redis.conf', '正斜杠命令 + 反斜杠 dir');
ok(f.replaceInstallDir('/opt/redis/bin/redis-server', '/opt/redis') === '${installDir}/bin/redis-server', 'POSIX 路径替换');
ok(f.replaceInstallDir('"C:/dev/redis/redis.exe" -p 6379', 'C:/dev/redis') === '"${installDir}/redis.exe" -p 6379', '引号内路径替换');
ok(f.replaceInstallDir('C:/dev/redis2/redis.exe', 'C:/dev/redis') === 'C:/dev/redis2/redis.exe', '相似目录名不误伤（边界）');
ok(f.replaceInstallDir('6379', 'C:/dev/redis') === '6379', '纯数字端口保持字面');
ok(f.replaceInstallDir('--port 6379', 'C:/dev/redis') === '--port 6379', '含数字参数不变');
ok(f.replaceInstallDir('redis-server.exe', '') === 'redis-server.exe', '空 dir 不替换');
ok(f.replaceInstallDir('', 'C:/dev/redis') === '', '空文本返回空');
ok(f.replaceInstallDir('${installDir}/bin/x', 'C:/dev/redis') === '${installDir}/bin/x', '已有占位符不重复处理');

console.log('== 阶段 4 · buildTemplateFromForm 结构组装（显示名即文件名） ==');
const r = f.buildTemplateFromForm(input(), []);
ok(r.ok === true, '合法表单构建成功');
ok(r.id === 'My Redis' && r.file === 'My Redis.json', 'id 与文件名用显示名原文');
ok(r.template.meta.id === 'My Redis', 'meta.id 等于显示名（等于文件名）');
ok(r.template.schemaVersion === 1 && r.template.kind === 'service-template', 'schemaVersion/kind 正确');
ok(Object.keys(r.template).length === 6, '顶层 6 键（日志字段已删除）');
ok(r.template.meta.name === 'My Redis' && r.template.defaults.displayName === 'My Redis', 'name/displayName 回填');
ok(r.template.defaults.installDirHint === 'C:/dev/redis', 'installDirHint 保留原值');
ok(r.template.probe.port === 6379, 'probe.port 为数字');
ok(r.template.actions.start.command === '${installDir}/redis-server.exe', 'start.command 占位符化');
ok(r.template.actions.start.args[0] === '${installDir}/redis.conf' && r.template.actions.start.args[1] === '--port', 'args 拆分并占位符化');
ok(r.template.actions.start.args[2] === '6379', 'args 端口保持字面');
ok(r.template.actions.stop === null && r.template.actions.restart === null, '空动作写 null');
ok(Object.keys(r.template.actions).length === 3, 'actions 恰好 3 槽');
ok(JSON.stringify(r.template).indexOf('openDir') === -1, '不含已删除的 openDir');
ok(JSON.stringify(r.template).indexOf('placeholders') === -1, '不含已删除的 placeholders');
ok(!('log' in r.template) && JSON.stringify(r.template).indexOf('captureStdout') === -1, '不含已删除的日志字段');
const cn = f.buildTemplateFromForm(input({ name: '中文服务' }), []);
ok(cn.ok && cn.id === '中文服务' && cn.file === '中文服务.json', '纯中文显示名 → 中文服务.json');

console.log('== 阶段 5 · 必填校验与边界 ==');
ok(f.buildTemplateFromForm(input({ name: '' }), []).ok === false, '空名称被拒');
ok(f.buildTemplateFromForm(input({ dir: '' }), []).ok === false, '空目录被拒');
ok(f.buildTemplateFromForm(input({ port: '' }), []).ok === false, '空端口被拒');
ok(f.buildTemplateFromForm(input({ port: '0' }), []).ok === false, '端口 0 被拒');
ok(f.buildTemplateFromForm(input({ port: '70000' }), []).ok === false, '端口越界被拒');
ok(f.buildTemplateFromForm(input({ port: 'abc' }), []).ok === false, '非数字端口被拒');
ok(f.buildTemplateFromForm(input({ acts: { ...input().acts, start: { cmd: '', args: '', timeout: '15000' } } }), []).ok === false, '空启动命令被拒');
const dup = f.buildTemplateFromForm(input(), ['My Redis']);
ok(dup.ok && dup.id === 'My Redis-2' && dup.file === 'My Redis-2.json', '重名模板自动加序号 -2，绝不覆盖');
const dup3 = f.buildTemplateFromForm(input(), ['My Redis', 'My Redis-2']);
ok(dup3.ok && dup3.id === 'My Redis-3', '第三个同名加序号 -3');
const zeroPort = f.buildTemplateFromForm(input({ port: '1' }), []);
ok(zeroPort.ok && zeroPort.template.probe.port === 1, '端口下界 1 通过');
const maxPort = f.buildTemplateFromForm(input({ port: '65535' }), []);
ok(maxPort.ok && maxPort.template.probe.port === 65535, '端口上界 65535 通过');

console.log('== 阶段 6 · 覆盖模式（固定来源 id，不去重、不自定义文件名） ==');
// 来源 id 已存在于列表：覆盖必须原样沿用，绝不能变成 xxx-2
const ov = f.buildTemplateFromForm(input({ name: '改名后的 Redis' }), ['my-redis'], 'my-redis');
ok(ov.ok === true, '覆盖模式构建成功');
ok(ov.id === 'my-redis' && ov.file === 'my-redis.json', '固定沿用来源 id / 文件名，未加序号');
ok(ov.template.meta.id === 'my-redis', 'meta.id 沿用来源 id（修订 54 起与文件名解耦）');
ok(ov.template.meta.name === '改名后的 Redis' && ov.template.defaults.displayName === '改名后的 Redis', 'meta.name 取表单显示名，无需自定义名称');
ok(ov.template.actions.start.command === '${installDir}/redis-server.exe', '覆盖同样做安装目录占位符化');
// 即使 overrideId 与显示名 slug 完全不同，也以 overrideId 为准
const ov2 = f.buildTemplateFromForm(input(), [], 'legacy-id');
ok(ov2.ok && ov2.id === 'legacy-id' && ov2.file === 'legacy-id.json', '来源 id 不按显示名重算');
// 含中文的来源 id 同样合法（放宽后）
const ovCn = f.buildTemplateFromForm(input(), ['中文服务'], '中文服务');
ok(ovCn.ok && ovCn.id === '中文服务' && ovCn.file === '中文服务.json', '含中文的来源 id 覆盖合法');
// 非法 id 回退到新建 slug 逻辑（防御：渲染器传入脏 id 时不写出非法文件）
const ovBad = f.buildTemplateFromForm(input(), [], 'Bad ID!');
ok(ovBad.ok && f.isValidTemplateId(ovBad.id), '非法来源 id 回退为合法 slug');

console.log('== 阶段 7 · 脚本模式：执行器 runner 字段（可选、占位符化、不污染其余动作） ==');
// runner 留空时不写出该键，保持预设模板 4 键不变
const noRunner = f.buildTemplateFromForm(input(), []);
ok(noRunner.ok && noRunner.template.actions.start.runner === undefined, 'runner 留空不写出该键（兼容旧模板）');
// 填 runner 时写出，并对安装目录下的执行器做占位符化
const withRunner = f.buildTemplateFromForm(input({
  acts: { ...input().acts, start: { cmd: 'C:/dev/redis/start.bat', args: '--port 6379', runner: 'C:/dev/redis/tools/cmd.exe', timeout: '15000' } }
}), []);
ok(withRunner.ok && withRunner.template.actions.start.runner === '${installDir}/tools/cmd.exe', 'runner 写入且路径占位符化');
// PATH 内命令名原样保留（无路径分隔符不会被误伤）
const pathRunner = f.buildTemplateFromForm(input({
  acts: { ...input().acts, start: { cmd: '/opt/app/start.sh', args: '', runner: 'bash', timeout: '15000' } }
}), []);
ok(pathRunner.ok && pathRunner.template.actions.start.runner === 'bash', 'PATH 命令名 runner 原样保留');
// runner 只在所属动作上，不影响 stop/restart
ok((withRunner.template.actions.stop === null || withRunner.template.actions.stop.runner === undefined) && (withRunner.template.actions.restart === null || withRunner.template.actions.restart.runner === undefined), 'runner 不污染其他动作槽');
// 覆盖模式同样保留 runner
const ovRunner = f.buildTemplateFromForm(input({
  acts: { ...input().acts, start: { cmd: '${installDir}/start.sh', args: '', runner: '/bin/bash', timeout: '15000' } }
}), ['my-redis'], 'my-redis');
ok(ovRunner.ok && ovRunner.template.actions.start.runner === '/bin/bash', '覆盖模式同样保留 runner');

console.log('\n== ' + pass + ' PASS / ' + fail + ' FAIL ==');
process.exit(fail ? 1 : 0);
