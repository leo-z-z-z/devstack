/* ============================================================
 * config 模块：services.yaml 读写、schema 校验、groups 规整
 * 顺序即 services 数组顺序；组合成员必须连续（顶层块模型）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { servicesYamlPath, appDataRoot } from './paths';
import {
  ServicesYaml, ServiceDefinition, GroupDefinition, Settings, DEFAULT_SETTINGS,
  POLL_INTERVALS, DEFAULT_POLL_MS
} from '../shared/types';

/* ---------- 原子写（写临时文件再 rename，防止半写坏配置） ---------- */
function atomicWrite(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 修订 40（交叉验证 K10）：唯一临时名，避免并发写互相覆盖 / rename 竞态
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/* ---------- 校验 ---------- */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ACTION_KEYS = ['start', 'stop', 'restart'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateAction(v: unknown, field: string, errs: string[]): void {
  if (v === null || v === undefined) return;
  if (!isPlainObject(v)) { errs.push(field + ': 动作必须是对象或 null'); return; }
  if (v.type !== 'exec' && v.type !== 'builtin') { errs.push(field + ': type 必须是 exec / builtin'); return; }
  if (v.type === 'exec' && typeof v.command !== 'string') errs.push(field + ': exec 需要 command 字符串');
  if (v.type === 'exec' && typeof v.command === 'string' && !v.command.trim()) errs.push(field + ': exec 命令不能为空');
  if (v.type === 'builtin' && v.builtin !== 'killProcessTree') errs.push(field + ': builtin 目前只支持 killProcessTree');
  if (v.args !== undefined && !Array.isArray(v.args)) errs.push(field + ': args 必须是数组');
  if (v.args !== undefined && (v.args as unknown[]).some(a => typeof a !== 'string')) errs.push(field + ': args 每项必须是字符串');
  if (v.timeoutMs !== undefined && (typeof v.timeoutMs !== 'number' || v.timeoutMs <= 0)) errs.push(field + ': timeoutMs 必须是正数');
}

export function validateService(v: unknown, idx: number, errs: string[]): ServiceDefinition | null {
  const p = 'services[' + idx + ']';
  if (!isPlainObject(v)) { errs.push(p + ': 必须是对象'); return null; }
  if (typeof v.id !== 'string' || !ID_RE.test(v.id)) errs.push(p + '.id: 需要小写字母数字连字符');
  if (typeof v.name !== 'string' || !v.name.trim()) errs.push(p + '.name: 必填');
  if (typeof v.port !== 'number' || v.port < 1 || v.port > 65535) errs.push(p + '.port: 需要 1–65535 数字');
  if (typeof v.dir !== 'string' || !v.dir.trim()) errs.push(p + '.dir: 必填');
  const cfg = v.cfg as Record<string, unknown> | undefined;
  if (!isPlainObject(cfg) || !isPlainObject(cfg.acts)) {
    errs.push(p + '.cfg: 需要 cfg.acts 四条动作');
  } else {
    for (const k of ACTION_KEYS) validateAction(cfg.acts[k], p + '.cfg.acts.' + k, errs);
  }
  if (errs.some(e => e.startsWith(p))) return null;
  return {
    id: v.id as string,
    name: v.name as string,
    gid: (v.gid as string | null) ?? null,
    sub: v.sub as string | undefined,
    port: v.port as number,
    webPort: v.webPort as number | undefined,
    webUrl: (v.webUrl as string | null | undefined) ?? null,
    dir: v.dir as string,
    template: v.template as string | undefined,
    cfg: v.cfg as ServiceDefinition['cfg']
  };
}

export function validateYaml(raw: unknown): { data: ServicesYaml; errors: string[] } {
  const errs: string[] = [];
  const groups: GroupDefinition[] = [];
  const services: ServiceDefinition[] = [];
  if (!isPlainObject(raw)) return { data: emptyYaml(), errors: ['根节点必须是对象'] };
  const settings = isPlainObject(raw.settings) ? raw.settings : {};
  const st: Settings = {
    // v2.43：旧配置里的 1.5 秒等非档位值迁移到默认 3 秒，保证设置页必然有一档选中
    pollMs: typeof settings.pollMs === 'number' && POLL_INTERVALS.includes(settings.pollMs)
      ? settings.pollMs : DEFAULT_POLL_MS,
    portSnapshot: typeof settings.portSnapshot === 'boolean' ? settings.portSnapshot : DEFAULT_SETTINGS.portSnapshot,
    logDays: typeof settings.logDays === 'number' ? settings.logDays : DEFAULT_SETTINGS.logDays,
    autoStart: typeof settings.autoStart === 'boolean' ? settings.autoStart : DEFAULT_SETTINGS.autoStart
  };
  if (Array.isArray(raw.groups)) {
    raw.groups.forEach((g: unknown, i: number) => {
      const p = 'groups[' + i + ']';
      if (!isPlainObject(g) || typeof g.id !== 'string' || typeof g.name !== 'string') {
        errs.push(p + ': 需要 id 与 name'); return;
      }
      groups.push({ id: g.id as string, name: g.name as string, collapsed: !!g.collapsed });
    });
  }
  if (Array.isArray(raw.services)) {
    const seen = new Set<string>();
    raw.services.forEach((v: unknown, i: number) => {
      const s = validateService(v, i, errs);
      if (s) {
        if (seen.has(s.id)) { errs.push('services[' + i + '].id: 重复 id ' + s.id); return; }
        seen.add(s.id);
        if (s.gid && !groups.some(g => g.id === s.gid)) {
          errs.push('services[' + i + '].gid: 指向不存在的组合 ' + s.gid);
          s.gid = null;
        }
        services.push(s);
      }
    });
  } else {
    errs.push('services: 需要数组');
  }
  return { data: { schemaVersion: 1, settings: st, groups, services }, errors: errs };
}

function emptyYaml(): ServicesYaml {
  return { schemaVersion: 1, settings: { ...DEFAULT_SETTINGS }, groups: [], services: [] };
}

/* ---------- 读写 ---------- */
export function readYaml(): { data: ServicesYaml; errors: string[]; existed: boolean } {
  const file = servicesYamlPath();
  if (!fs.existsSync(file)) return { data: emptyYaml(), errors: [], existed: false };
  try {
    const raw = yaml.load(fs.readFileSync(file, 'utf8'));
    const { data, errors } = validateYaml(raw);
    return { data, errors, existed: true };
  } catch (e) {
    // 修订 40（交叉验证 K10）：损坏配置绝不静默丢弃，先保留现场副本供恢复
    try {
      const backup = file + '.corrupt-' + Date.now();
      fs.copyFileSync(file, backup);
      return { data: emptyYaml(), errors: ['YAML 解析失败，原文件已备份为 ' + path.basename(backup) + '：' + String(e)], existed: true };
    } catch {
      return { data: emptyYaml(), errors: ['YAML 解析失败: ' + String(e)], existed: true };
    }
  }
}

export function writeYaml(data: ServicesYaml): void {
  const ordered = serializeYaml(data);
  atomicWrite(servicesYamlPath(), ordered);
}

function serializeYaml(d: ServicesYaml): string {
  return yaml.dump(d, {
    indent: 2,
    noRefs: true,
    sortKeys: false,
    lineWidth: 120
  });
}

/* ---------- 组合连续性规整：保证同组成员在数组中连续（顶层块模型） ---------- */
export function regroupContiguous(services: ServiceDefinition[], groups: GroupDefinition[]): ServiceDefinition[] {
  const out: ServiceDefinition[] = [];
  const placed = new Set<string>();
  for (const s of services) {
    if (!s.gid) { out.push(s); continue; }
    if (placed.has(s.gid)) continue;
    placed.add(s.gid);
    for (const m of services.filter(x => x.gid === s.gid)) out.push(m);
  }
  return out;
}

export { appDataRoot };
