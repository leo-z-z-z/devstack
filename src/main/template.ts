/* ============================================================
 * template 模块：单一模板目录（播种 / 扫描 / 逐文件校验 / 实例化）
 * 目录监听自动静默重扫；手动重扫带逐文件进度
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { templateDir } from './paths';
import { presetDefaults } from './presets';
import { Template, TemplateScanItem, ServiceDefinition, ActionSpec, ServiceConfig } from '../shared/types';
import { normalizePath, normalizeArg } from './paths';
import { isValidTemplateId } from '../shared/templateFromForm';

const MAX_BYTES = 128 * 1024;

/* ---------- 播种：缺文件才写，绝不覆盖用户文件 ---------- */
export function seedPresets(): { seeded: number } {
  const dir = templateDir();
  fs.mkdirSync(dir, { recursive: true });
  let seeded = 0;
  for (const t of presetDefaults()) {
    const file = path.join(dir, t.meta.id + '.json');
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(t, null, 2) + '\n', 'utf8');
      seeded++;
    }
  }
  return { seeded };
}

/* ---------- 仅首次运行播种（修订 53） ----------
 * 只在模板目录不存在时播种一次；之后目录完全交给用户管理——
 * 用户改名 / 删除预设文件不会被「补回」，扫描与重启都如实反映文件夹内容。
 * 想恢复全部预设：删除模板文件夹，下次启动自动重新播种。 */
export function ensureTemplatesSeeded(): { seeded: number } {
  if (fs.existsSync(templateDir())) return { seeded: 0 };
  return seedPresets();
}

/* ---------- 校验 ---------- */
const META_KEYS = ['id', 'name'];
const DEFAULT_KEYS = ['displayName', 'installDirHint', 'webUrl'];
const ACTION_SLOTS = ['start', 'stop', 'restart'];
const RUNTIME_FORBIDDEN = ['st', 'status', 'pid', 'uptime', 'groupId', 'collapsed', '_tk', 'owner', 'ownerPid', 'jobId'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// filename 仅保留作签名兼容（调用方仍传磁盘名），修订 54 起不再用于「文件名 = id」一致性校验
export function validateTemplate(raw: unknown, filename: string, dupIds: Set<string>): string[] {
  const errs: string[] = [];
  if (!isObj(raw)) return ['文件顶层必须是 JSON 对象'];
  for (const k of RUNTIME_FORBIDDEN) {
    if (k in raw) errs.push('存在运行时字段 ' + k + '（模板只存静态配置）');
  }
  if (raw.schemaVersion !== 1) errs.push('schemaVersion 必须为 1');
  if (raw.kind !== 'service-template') errs.push('kind 必须为 service-template');
  if (!isObj(raw.meta)) errs.push('缺少 meta');
  else {
    for (const k of META_KEYS) if (typeof raw.meta[k] !== 'string') errs.push('meta.' + k + ' 必须是字符串');
    if (typeof raw.meta.id === 'string') {
      // 修订 49：允许中文 / 大小写 / 空格作 id，仅挡路径分隔符与非法字符（规则见 isValidTemplateId）
      if (!isValidTemplateId(raw.meta.id)) errs.push('meta.id 不能含路径分隔符 / 控制字符，首尾不能是点或空格');
      // 修订 54：删除「文件名须与 meta.id 一致」校验——id 才是唯一业务键（服务引用 + 目录查重），
      // 文件名仅是磁盘存储名；用户自由改文件名（elasticsearch2.json）不再标红。
      if (dupIds.has(raw.meta.id)) errs.push('meta.id 在目录内重复：' + raw.meta.id);
      dupIds.add(raw.meta.id);
    }
  }
  if (!isObj(raw.defaults)) errs.push('缺少 defaults');
  else {
    for (const k of DEFAULT_KEYS) {
      if (raw.defaults[k] !== undefined && raw.defaults[k] !== null && typeof raw.defaults[k] !== 'string')
        errs.push('defaults.' + k + ' 必须是字符串或 null');
    }
    if (typeof raw.defaults.webUrl === 'string' && raw.defaults.webUrl !== 'disabled' && !/^https?:\/\//.test(raw.defaults.webUrl))
      errs.push('defaults.webUrl scheme 非法：只允许 http:// / https:// 或填 disabled');
  }
  if (!isObj(raw.probe) || typeof raw.probe.port !== 'number' || raw.probe.port < 1 || raw.probe.port > 65535)
    errs.push('probe.port 必须是 1–65535 数字');
  if (!isObj(raw.actions)) errs.push('缺少 actions');
  else {
    for (const slot of ACTION_SLOTS) {
      const a = raw.actions[slot];
      if (a === null || a === undefined) continue;
      if (!isObj(a)) { errs.push('actions.' + slot + ' 必须是对象或 null'); continue; }
      validateTemplateAction(a, 'actions.' + slot, errs);
    }
  }
  return errs;
}

function validateTemplateAction(a: Record<string, unknown>, field: string, errs: string[]): void {
  if ('waitFor' in a) errs.push(field + ': 废弃字段 waitFor 已从模型删除');
  if (a.type !== 'exec' && a.type !== 'builtin') { errs.push(field + ': type 必须是 exec / builtin'); return; }
  if (a.type === 'exec' && typeof a.command !== 'string') errs.push(field + ': exec 需要 command 字符串');
  if (a.type === 'builtin' && a.builtin !== 'killProcessTree') errs.push(field + ': builtin 目前只支持 killProcessTree');
  if (a.args !== undefined) {
    if (!Array.isArray(a.args)) errs.push(field + ': args 必须是数组');
    else if ((a.args as unknown[]).some(x => typeof x !== 'string')) errs.push(field + ': args 每项必须是字符串');
  }
  // runner 可选：单个可执行文件（可为 PATH 内命令名或绝对路径），不接受数组/对象
  if (a.runner !== undefined && typeof a.runner !== 'string') errs.push(field + ': runner 必须是字符串（单个可执行文件）');
  if (typeof a.runner === 'string' && a.runner.trim().length === 0) errs.push(field + ': runner 不能是空字符串');
  if (a.timeoutMs !== undefined && (typeof a.timeoutMs !== 'number' || (a.timeoutMs as number) <= 0))
    errs.push(field + ': timeoutMs 必须是正数');
}

/* ---------- 扫描 ----------
 * 如实读取目录，绝不补种（修订 53）：用户在文件夹里改名 / 删除文件后，
 * 「重新扫描校验」必须如实反映文件夹内容，不得把预设文件静默补回。 */
export function scanTemplates(): TemplateScanItem[] {
  const dir = templateDir();
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json')).sort();
  } catch { return []; }
  const dupIds = new Set<string>();
  return files.map(f => {
    const full = path.join(dir, f);
    const base: TemplateScanItem = { id: f.replace(/\.json$/i, ''), file: f, state: 'ok', errors: [] };
    let text = '';
    try {
      const stat = fs.statSync(full);
      if (stat.size > MAX_BYTES) { base.state = 'invalid'; base.errors = ['文件超过 128KB 上限']; return base; }
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      base.state = 'invalid'; base.errors = ['读取失败: ' + String(e)]; return base;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      base.state = 'invalid'; base.errors = ['JSON 语法错误: ' + String(e)]; return base;
    }
    const errs = validateTemplate(raw, f, dupIds);
    if (errs.length) { base.state = 'invalid'; base.errors = errs; return base; }
    base.raw = raw as Template;
    base.id = (raw as Template).meta.id;
    return base;
  });
}

/* ---------- 占位符展开 ---------- */
function expand(str: string, ctx: Record<string, string>): string {
  return str.replace(/\$\{(\w+)\}/g, (m, key) => ctx[key] ?? m);
}

export function instantiate(t: Template, installDir: string, displayName?: string, port?: number, webUrl?: string | null): ServiceDefinition {
  const dir = normalizePath(installDir || t.defaults.installDirHint);
  const p = port ?? t.probe.port;
  const ctx: Record<string, string> = { installDir: dir, port: String(p) };
  const expandAction = (a: ActionSpec | null): ActionSpec | null => {
    if (!a) return null;
    if (a.type === 'builtin') return { ...a };
    const runner = (a.runner ?? '').trim();
    return {
      type: 'exec',
      command: normalizePath(expand(a.command ?? '', ctx)),
      // 参数里的路径片段同样要按平台统一分隔符（原实现只展开占位符，
      // Windows 模板的 ${installDir}\data 在 POSIX 会残留反斜杠导致路径找不到）。
      args: (a.args ?? []).map(x => normalizeArg(expand(x, ctx))),
      ...(runner ? { runner: normalizePath(expand(runner, ctx)) } : {}),
      timeoutMs: a.timeoutMs
    };
  };
  const cfg: ServiceConfig = {
    acts: {
      start: expandAction(t.actions.start),
      stop: expandAction(t.actions.stop),
      restart: expandAction(t.actions.restart)
    }
  };
  const name = (displayName && displayName.trim()) || t.defaults.displayName || t.meta.name;
  return {
    // 修订 49：模板 id 放宽后可能含中文 / 大写 / 空格，而服务 id 受 config.ts 严格 ID_RE
    // （小写字母数字连字符）约束，故服务 id 独立生成，与模板 id 解耦
    id: 'svc-' + Math.random().toString(36).slice(2, 8),
    name,
    gid: null,
    port: p,
    webUrl: webUrl !== undefined ? webUrl : (t.defaults.webUrl ?? null),
    dir,
    template: t.meta.id,
    cfg
  };
}

/* ---------- 打开文件夹 / 删除文件 ---------- */
/**
 * 严格限定在模板目录内。
 * 修订 40（交叉验证 K13）：原直接用 path.join + startsWith 前缀判断，
 * 既允许 read-template-file 读任意文件，也会被 ../presets-evil/x 这类
 * 同名前缀目录绕过。改用 path.relative 判定，统一给读/写/删三条链路使用。
 */
export function templateFilePath(file: string): string {
  const dir = path.resolve(templateDir());
  const full = path.resolve(dir, file);
  const rel = path.relative(dir, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径越界：仅允许模板目录内的文件');
  return full;
}

export function deleteTemplateFile(file: string): void {
  const full = templateFilePath(file);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

/** 原子写：唯一 tmp + rename，避免写一半崩溃留下损坏的模板文件 */
let tmpSeq = 0;
function atomicWriteTemplate(full: string, text: string): void {
  // 自增序号保证同一毫秒内连续两次保存也不会复用同一个 tmp
  const tmp = full + '.' + process.pid + '.' + Date.now() + '.' + (++tmpSeq) + '.tmp';
  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, full);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* 已不存在 */ }
    throw e;
  }
}

export function saveTemplateFile(file: string, raw: Template): void {
  const full = templateFilePath(file);
  atomicWriteTemplate(full, JSON.stringify(raw, null, 2) + '\n');
}

/* ---------- 模板页直接编辑 JSON：校验 → 原子写 ----------
 * 口径：JSON 语法错误 / 路径越界 / 超过上限 → 拒绝写入（文件不留半截垃圾）；
 * 语义校验不通过仍允许保存（否则一个已损坏的模板无法就地修复），
 * 但把问题作为 warnings 返回，由页面明确标出，并可被下一次扫描标红。
 */
export interface SaveTemplateResult {
  ok: boolean;
  code?: 'syntax' | 'too-large' | 'path' | 'write';
  /** 技术细节（JSON.parse / fs 原始消息），供排障，不作为翻译主体 */
  message?: string;
  line?: number;
  column?: number;
  /** 语义校验问题：不阻断写入 */
  warnings: string[];
}

function lineColumn(text: string, pos: number): { line: number; column: number } {
  const parts = text.slice(0, Math.max(0, pos)).split('\n');
  return { line: parts.length, column: (parts[parts.length - 1] ?? '').length + 1 };
}

/** V8 的某些 JSON 错误（Node 22 的 Unexpected token）不附带 position，
 * 这里做一次轻量词法扫描，定位尾逗号 / 未闭合字符串 / 括号不配对。 */
function jsonErrorPosition(text: string): number {
  let inStr = false, esc = false, strStart = -1;
  const stack: number[] = [];
  let lastComma = -1, lastNonWs = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; strStart = i; lastNonWs = i; continue; }
    if (/\s/.test(c)) continue;
    if (c === '{' || c === '[') { stack.push(i); lastNonWs = i; continue; }
    if (c === '}' || c === ']') {
      if (lastNonWs === lastComma) return lastComma;     // 尾逗号
      if (!stack.pop()) return i;                        // 多余的右括号
      lastNonWs = i;
      continue;
    }
    if (c === ',') { lastComma = i; lastNonWs = i; continue; }
    lastNonWs = i;
  }
  if (inStr) return strStart;
  if (stack.length) return stack[stack.length - 1];
  return Math.max(0, lastNonWs);
}

export function saveTemplateText(file: string, text: string): SaveTemplateResult {
  if (path.basename(file) !== file || !/\.json$/i.test(file)) {
    return { ok: false, code: 'path', message: 'only top-level .json files are allowed', warnings: [] };
  }
  let full: string;
  try { full = templateFilePath(file); }
  catch (e) { return { ok: false, code: 'path', message: String(e), warnings: [] }; }

  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { ok: false, code: 'too-large', message: 'exceeds ' + MAX_BYTES + ' bytes', warnings: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const msg = String(e);
    const m = /position (\d+)/.exec(msg);
    const lc = lineColumn(text, m ? Number(m[1]) : jsonErrorPosition(text));
    return { ok: false, code: 'syntax', message: msg, line: lc.line, column: lc.column, warnings: [] };
  }

  const warnings = validateTemplate(raw, file, new Set());
  try {
    atomicWriteTemplate(full, text);
  } catch (e) {
    return { ok: false, code: 'write', message: String(e), warnings };
  }
  return { ok: true, warnings };
}
