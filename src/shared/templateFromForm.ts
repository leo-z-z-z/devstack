/* ============================================================
 * 表单 → 模板 JSON 的纯函数（不碰 fs / 不依赖 electron）
 * 供「保存为新模板」使用：id 生成去重、安装目录占位符化、6 键结构组装。
 * 与 validateTemplate 的约束对齐：meta.id 合法（isValidTemplateId）且目录内唯一；
 * 软件生成时文件名 = id + '.json'，但修订 54 起用户手改文件名不再强制与 id 一致。
 * ============================================================ */
import type { Template, ActionSpec } from './types';

export interface FormActs { cmd: string; args: string; runner: string; timeout: string; }

export interface TemplateFormInput {
  name: string;
  dir: string;
  logDir: string;
  port: string;
  url: string;
  acts: { start: FormActs; stop: FormActs; restart: FormActs };
}

export interface TemplateBuildOk {
  ok: true;
  id: string;
  file: string;
  template: Template;
}
export interface TemplateBuildErr { ok: false; error: string; }
export type TemplateBuildResult = TemplateBuildOk | TemplateBuildErr;

const ID_MAX = 64;
const FALLBACK_ID = 'custom-template';

/**
 * 显示名 → meta.id / 文件名（修订 49）：直接用显示名原文，保留中文 / 大写 / 空格；
 * 仅剔除文件名非法字符与路径分隔符，避免越界与 Windows 保留名。
 * 不再强制小写连字符 —— 用户要求「显示名称.json」。
 */
export function templateSlug(name: string): string {
  const s = (name ?? '').trim()
    // 路径分隔符 / 控制字符 / Windows 保留字符，一律剔除
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')              // 连续空白压成单个空格
    .replace(/^[.\s]+|[.\s]+$/g, '');  // 去首尾的点与空白
  if (!s) return FALLBACK_ID;
  return Array.from(s).slice(0, ID_MAX).join('').replace(/[.\s]+$/, '') || FALLBACK_ID;
}

/**
 * 校验模板 id 是否可作文件名（放宽版，供主进程 validateTemplate 复用，规则单一来源）。
 * 允许中文 / 大小写字母 / 数字 / 空格 / 连字符 / 下划线 / 点；
 * 拒绝：路径分隔符、控制字符、Windows 保留字符、首尾点或空白、保留设备名、超长。
 */
export function isValidTemplateId(id: string): boolean {
  if (typeof id !== 'string' || !id) return false;
  if (Array.from(id).length > ID_MAX) return false;
  if (id !== id.trim()) return false;
  if (/^[.]|[.]$/.test(id)) return false;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(id)) return false;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) return false;
  return true;
}

/** 与现有 id 去重：重名追加 -2 / -3…（用户要求自动加序号），长度不超 ID_MAX */
export function uniqueTemplateId(base: string, existingIds: string[]): string {
  const used = new Set(existingIds);
  if (!used.has(base)) return base;
  const stem = Array.from(base).slice(0, ID_MAX - 6).join('').replace(/[.\s-]+$/, '');
  for (let i = 2; i < 100000; i++) {
    const suffix = '-' + i;
    const candidate = Array.from(base).slice(0, ID_MAX - suffix.length).join('').replace(/[.\s-]+$/, '') + suffix;
    if (!used.has(candidate)) return candidate;
  }
  return stem + '-' + Date.now().toString(36).slice(-7);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把文本里出现的安装目录替换为 ${installDir}。
 * - 兼容正反斜杠混写（C:/dev/x 与 C:\dev\x 都认）
 * - 仅在路径边界处替换，避免 C:/dev/xxx 误伤 C:/dev/xxx2
 * - 端口是纯数字，不会命中路径形态，天然保持字面值
 */
export function replaceInstallDir(text: string, dir: string): string {
  const raw = (text ?? '').trim();
  const d = (dir ?? '').trim().replace(/[\\/]+$/, '');
  if (!raw || !d) return raw;
  const lead = /^[/\\]/.test(d) ? '[\\\\/]+' : '';
  const parts = d.split(/[\\/]+/).filter(Boolean).map(escapeRegex);
  if (!parts.length) return raw;
  const pattern = lead + parts.join('[\\\\/]+') + '(?=[\\\\/"\'\\s]|$)';
  try {
    return raw.replace(new RegExp(pattern, 'g'), '${installDir}');
  } catch {
    return raw;
  }
}

function toAction(d: FormActs, dir: string): ActionSpec | null {
  if (!d.cmd.trim()) return null;
  const a: ActionSpec = {
    type: 'exec',
    command: replaceInstallDir(d.cmd.trim(), dir),
    args: d.args.trim() ? d.args.trim().split(/\s+/).map(x => replaceInstallDir(x, dir)) : [],
    timeoutMs: parseInt(d.timeout, 10) || 15000
  };
  // 执行器（可选）：单个可执行文件，安装目录下的路径同样占位符化
  const runner = (d.runner ?? '').trim();
  if (runner) a.runner = replaceInstallDir(runner, dir);
  return a;
}

/** 表单 → 合法模板对象；必填校验失败返回 { ok:false, error }
 *  - 新建模式：overrideId 省略，按显示名生成 id 并去重（-copy）
 *  - 覆盖模式：传入来源模板 id，固定沿用该 id 与文件名，不套 slug、不去重；
 *    meta.name 仍取表单显示名（用户要求无需自定义名称/文件名） */
export function buildTemplateFromForm(input: TemplateFormInput, existingIds: string[], overrideId?: string): TemplateBuildResult {
  const name = input.name.trim();
  const dir = input.dir.trim();
  const logDir = input.logDir.trim();
  const port = parseInt(input.port, 10);
  if (!name) return { ok: false, error: '模板名称不能为空' };
  if (!dir) return { ok: false, error: '安装目录不能为空' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: '探测端口必须是 1–65535 的数字' };
  if (!input.acts.start.cmd.trim()) return { ok: false, error: '启动命令不能为空' };

  // 覆盖模式固定沿用来源 id（仅要求 isValidTemplateId 合法，不再强制等于文件名）；新建才去重
  const id = overrideId && isValidTemplateId(overrideId)
    ? overrideId
    : uniqueTemplateId(templateSlug(name), existingIds);
  const start = toAction(input.acts.start, dir) as ActionSpec;
  const webUrl = input.url.trim() || null;

  const template: Template = {
    schemaVersion: 1,
    kind: 'service-template',
    meta: { id, name },
    defaults: {
      displayName: name,
      installDirHint: dir,
      webUrl,
      logDir: logDir || null
    },
    probe: { port },
    actions: {
      start,
      stop: toAction(input.acts.stop, dir),
      restart: toAction(input.acts.restart, dir)
    }
  };
  return { ok: true, id, file: id + '.json', template };
}
