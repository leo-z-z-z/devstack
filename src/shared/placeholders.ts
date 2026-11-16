/* ============================================================
 * 占位符展开（${installDir} / ${port}）
 *
 * 背景（修订 57）：
 * 模板文件里只允许写占位符（见 templateFromForm.replaceInstallDir 反向还原），
 * 真实路径由「服务的安装目录 / 探测端口」在**落盘与执行前**展开。
 *
 * 历史缺陷：占位符展开只发生在 template.instantiate()（模板实例化），
 * 而用户在「添加 / 编辑服务」表单里直接保存时，命令原文被原样写进
 * services.yaml，${installDir} 就此残留 → 执行层拿字面量去 spawn，
 * Windows 报 ENOENT，表现为「启动失败 / 启动超时」，用户完全看不到原因。
 *
 * 本模块提供展开方向的纯函数，供三处共用（单一语义来源）：
 *   - 保存路径（ServiceEditor / ipc upsert-service）：展开后再落盘
 *   - 执行路径（schedule.doStart / doStop）：兜底展开存量坏配置
 *   - 预检路径（ipc precheck-service）：发现未展开占位符并给出可读原因
 * ============================================================ */
import type { ActionSpec, ServiceDefinition } from './types';

/** 占位符上下文：与服务自身的 dir / port 对应 */
export interface PlaceholderContext {
  installDir: string;
  port: string | number;
}

/** 已知占位符名（用于预检判定「是否还有未展开的占位符」） */
export const KNOWN_PLACEHOLDERS = ['installDir', 'port'] as const;

const PH_RE = /\$\{(\w+)\}/g;

/**
 * 展开单个字符串里的占位符。
 * 未知占位符原样保留（不吞掉、不报错），交由预检 / 执行层暴露给用户。
 */
export function expandPlaceholders(text: string, ctx: PlaceholderContext): string {
  if (!text) return text;
  return text.replace(PH_RE, (m, key: string) => {
    if (key === 'installDir') return ctx.installDir;
    if (key === 'port') return String(ctx.port);
    return m;
  });
}

/** 列出字符串里残留的占位符名（去重） */
export function findPlaceholders(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PH_RE.source, 'g');
  while ((m = re.exec(text))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** 展开动作（command / args / runner 三个字段都可能含占位符） */
export function expandActionPlaceholders(a: ActionSpec | null | undefined, ctx: PlaceholderContext): ActionSpec | null | undefined {
  if (!a) return a;
  if (a.type === 'builtin') return { ...a };
  const runner = (a.runner ?? '').trim();
  return {
    ...a,
    command: a.command ? expandPlaceholders(a.command, ctx) : a.command,
    args: (a.args ?? []).map(x => expandPlaceholders(x, ctx)),
    ...(runner ? { runner: expandPlaceholders(runner, ctx) } : {})
  };
}

/** 展开整个服务的全部动作 */
export function expandServicePlaceholders(s: ServiceDefinition): ServiceDefinition {
  const ctx: PlaceholderContext = { installDir: s.dir, port: s.port };
  return {
    ...s,
    cfg: {
      ...s.cfg,
      acts: {
        start: expandActionPlaceholders(s.cfg.acts.start, ctx) as ActionSpec | null,
        stop: expandActionPlaceholders(s.cfg.acts.stop, ctx) as ActionSpec | null,
        restart: expandActionPlaceholders(s.cfg.acts.restart, ctx) as ActionSpec | null
      }
    }
  };
}

/**
 * 预检用：列出该服务里仍未展开的占位符（含所在字段）。
 * 返回空数组表示命令里没有任何占位符残留。
 */
export function findServicePlaceholderIssues(s: ServiceDefinition): string[] {
  const issues: string[] = [];
  const slots = ['start', 'stop', 'restart'] as const;
  for (const slot of slots) {
    const a = s.cfg.acts[slot];
    if (!a || a.type !== 'exec') continue;
    const found = new Set<string>();
    for (const p of findPlaceholders(a.command ?? '')) found.add(p);
    for (const p of (a.args ?? []).flatMap(x => findPlaceholders(x))) found.add(p);
    if (a.runner) for (const p of findPlaceholders(a.runner)) found.add(p);
    if (found.size) issues.push(slot + ': ' + [...found].join(', '));
  }
  return issues;
}
