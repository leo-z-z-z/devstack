/* ============================================================
 * 随包模板：按平台生成 9 个组件模板的默认命令
 * 应用跨平台；模板属于用户机器，启动命令按当前平台给出
 * ============================================================ */
import { Template } from '../shared/types';

const IS_WIN = process.platform === 'win32';

/** 平台相关的可执行文件名与路径分隔 */
function exe(name: string): string {
  return IS_WIN ? name + '.exe' : name;
}
function script(bin: string, base: string): string {
  // Windows 用 .bat/.cmd，POSIX 用无扩展脚本
  const winExts: Record<string, string> = {
    elasticsearch: '.bat', kibana: '.bat', logstash: '.bat',
    mqnamesrv: '.cmd', mqbroker: '.cmd', pg_ctl: '.exe'
  };
  const suffix = IS_WIN ? (winExts[base] || '.bat') : '';
  return '${installDir}/bin/' + bin + suffix;
}
function j(...parts: string[]): string {
  // 模板内统一用 /，实例化时按平台规范化
  return parts.join('/');
}

interface PresetArgs {
  id: string; name: string; displayName: string; installDirHint: string;
  webUrl?: string | null; port: number;
  logDir?: string | null;
  startCmd: string; startArgs?: string[]; timeoutMs?: number;
  stop?: { type: 'exec'; command: string; args: string[]; timeoutMs: number } | null;
}

function mk(p: PresetArgs): Template {
  return {
    schemaVersion: 1,
    kind: 'service-template',
    meta: { id: p.id, name: p.name },
    defaults: { displayName: p.displayName, installDirHint: p.installDirHint, webUrl: p.webUrl ?? null, logDir: p.logDir ?? null },
    probe: { port: p.port },
    actions: {
      start: { type: 'exec', command: p.startCmd, args: p.startArgs ?? [], timeoutMs: p.timeoutMs ?? 15000 },
      stop: p.stop === null
        ? null
        : (p.stop ?? { type: 'builtin', builtin: 'killProcessTree', timeoutMs: 8000 }),
      restart: null
    }
  };
}

const KILL_TREE = { type: 'builtin' as const, builtin: 'killProcessTree' as const, timeoutMs: 8000 };

/** 生成 9 个随包模板；命令按当前平台给出 */
export function buildPresets(): Template[] {
  const H = (d: string) => IS_WIN ? 'C:/dev/' + d : '/opt/' + d;
  return [
    mk({
      id: 'redis', name: 'Redis', displayName: 'Redis', installDirHint: H('redis'),
      port: 6379,
      logDir: '${installDir}/logs',
      startCmd: j('${installDir}', exe('redis-server')),
      startArgs: IS_WIN ? ['${installDir}/redis.windows.conf'] : ['${installDir}/redis.conf'],
      stop: { type: 'exec', command: j('${installDir}', exe('redis-cli')), args: ['-p', '${port}', 'shutdown'], timeoutMs: 8000 }
    }),
    mk({
      id: 'mysql', name: 'MySQL', displayName: 'MySQL', installDirHint: H('mysql'),
      port: 3306,
      logDir: '${installDir}/data',
      startCmd: j('${installDir}', 'bin', exe('mysqld')),
      startArgs: ['--defaults-file=${installDir}/my.ini'],
      stop: { type: 'exec', command: j('${installDir}', 'bin', exe('mysqladmin')), args: ['-u', 'root', 'shutdown'], timeoutMs: 10000 }
    }),
    mk({
      id: 'postgresql', name: 'PostgreSQL', displayName: 'PostgreSQL', installDirHint: H('pgsql'),
      port: 5432,
      logDir: '${installDir}/data',
      startCmd: j('${installDir}', 'bin', exe('pg_ctl')),
      startArgs: ['-D', '${installDir}/data', '-l', '${installDir}/pg.log', 'start'],
      stop: { type: 'exec', command: j('${installDir}', 'bin', exe('pg_ctl')), args: ['-D', '${installDir}/data', 'stop', '-m', 'fast'], timeoutMs: 10000 }
    }),
    mk({
      id: 'elasticsearch', name: 'Elasticsearch', displayName: 'Elasticsearch', installDirHint: H('elk/elasticsearch'),
      port: 9200, webUrl: 'http://localhost:9200',
      logDir: '${installDir}/logs',
      startCmd: script('elasticsearch', 'elasticsearch'), timeoutMs: 60000
    }),
    mk({
      id: 'logstash', name: 'Logstash', displayName: 'Logstash', installDirHint: H('elk/logstash'),
      port: 9600,
      logDir: '${installDir}/logs',
      startCmd: script('logstash', 'logstash'),
      startArgs: ['-f', '${installDir}/config/logstash.conf'], timeoutMs: 60000
    }),
    mk({
      id: 'kibana', name: 'Kibana', displayName: 'Kibana', installDirHint: H('elk/kibana'),
      port: 5601, webUrl: 'http://localhost:5601',
      logDir: '${installDir}/logs',
      startCmd: script('kibana', 'kibana'), timeoutMs: 60000
    }),
    mk({
      id: 'rocketmq-nameserver', name: 'RocketMQ NameServer', displayName: 'RocketMQ NameServer', installDirHint: H('rocketmq'),
      port: 9876,
      logDir: '${installDir}/logs',
      startCmd: script('mqnamesrv', 'mqnamesrv'), timeoutMs: 30000
    }),
    mk({
      id: 'rocketmq-broker', name: 'RocketMQ Broker', displayName: 'RocketMQ Broker', installDirHint: H('rocketmq'),
      port: 10911,
      logDir: '${installDir}/logs',
      startCmd: script('mqbroker', 'mqbroker'),
      startArgs: ['-n', '127.0.0.1:9876'], timeoutMs: 30000
    }),
    mk({
      id: 'minio', name: 'MinIO', displayName: 'MinIO', installDirHint: H('minio'),
      port: 9000, webUrl: 'http://localhost:9001',
      logDir: '${installDir}/logs',
      startCmd: j('${installDir}', exe('minio')),
      startArgs: ['server', '${installDir}/data', '--console-address', ':9001']
    })
  ];
}

/** 兼容旧字段：stop 缺省时给 killProcessTree；exec stop 用模板自身 */
export function presetDefaults(): Template[] {
  return buildPresets().map(t => ({
    ...t,
    actions: { ...t.actions, stop: t.actions.stop ?? KILL_TREE }
  }));
}

export const PRESET_IDS = buildPresets().map(t => t.meta.id);
