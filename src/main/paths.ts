/* ============================================================
 * 跨平台数据目录：Windows %APPDATA% / macOS ~/Library/Application Support / Linux XDG
 * ============================================================ */
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import type { ActionSpec, ServiceDefinition } from '../shared/types';
import { expandActionPlaceholders } from '../shared/placeholders';

const APP_DIR_NAME = 'devstack';
const IS_WIN = process.platform === 'win32';

/** 应用数据根目录（开发期在仓库内隔离，打包后用系统标准位置） */
export function appDataRoot(): string {
  if (process.env.DEVSTACK_DATA_DIR) return process.env.DEVSTACK_DATA_DIR;
  try {
    // Electron app.getPath('appData') 已按平台给出标准位置
    return path.join(app.getPath('appData'), APP_DIR_NAME);
  } catch {
    // 非 Electron 环境（单元测试）退回用户目录
    return path.join(os.homedir(), '.devstack');
  }
}

export function servicesYamlPath(): string {
  return path.join(appDataRoot(), 'services.yaml');
}

export function templateDir(): string {
  return path.join(appDataRoot(), 'presets');
}

export function logDir(): string {
  return path.join(appDataRoot(), 'logs');
}

export function scriptsDir(): string {
  return path.join(appDataRoot(), 'scripts');
}

/** 把用户输入的 ~ 展开（模板/表单允许手填路径） */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * 跨平台路径分隔符归一 + 绝对路径判定。
 * path.normalize 只在本平台转换：POSIX 下不会把 \ 当分隔符，Windows 下把 / 转成 \。
 * 这里先按平台把「异平台分隔符」显式替换掉，再交给 path.normalize，
 * 使「模板写 / 或 \ 都能在三平台正确落地」，不被斜杠影响执行。
 */
export function unifySeparatorsFor(p: string, isWin: boolean): string {
  // URL / scheme（http://、data:、file: 等）不是路径，原样保留，避免把 :// 转坏
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || /^(data|mailto|file):/i.test(p)) return p;
  return isWin ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/');
}

function unifySeparators(p: string): string {
  return unifySeparatorsFor(p, IS_WIN);
}

/** 路径规范化为当前平台分隔符（双向兼容 \ 与 /） */
export function normalizePath(p: string): string {
  return path.normalize(unifySeparators(expandHome(p)));
}

/**
 * 参数项里的路径片段归一：只处理含 ${installDir} 占位符或看起来是路径的参数。
 * 用纯字符串替换而非 path.normalize —— 参数可能是 "/flag"、"-p"、"--console-address"、
 * ":9001"、"server" 这类开关/字面量，path.normalize 会破坏它们。
 * 这里只做分隔符字符替换，且跳过 URL scheme。
 */
export function normalizeArgFor(a: string, isWin: boolean): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a) || /^(data|mailto):/i.test(a)) return a;
  if (isWin) {
    // 只统一「明确是路径」的参数：带盘符或已含反斜杠（混合分隔符）。
    // 形如 /d、/s、/c 的 Windows 开关不含这两者，保持原样，避免被转成 \d 而失效。
    if (/^[A-Za-z]:/.test(a) || a.includes('\\')) return a.replace(/\//g, '\\');
    return a;
  }
  // POSIX 下 \ 不是开关前缀，参数里的反斜杠几乎都来自 Windows 模板路径，统一成 /
  return a.replace(/\\/g, '/');
}

export function normalizeArg(a: string): string {
  return normalizeArgFor(a, IS_WIN);
}

/**
 * 整条服务定义里的路径字段归一（供保存入口调用，覆盖用户手填的反斜杠路径）
 *
 * 修订 57：展开与归一的顺序是「先展开占位符、再归一分隔符」。
 * 模板与表单里允许写 ${installDir} / ${port}，落盘前必须展开成真实值——
 * 否则执行层会拿字面量去 spawn（Windows ENOENT），表现为「启动失败 / 启动超时」。
 * 展开在前，才能让 ${installDir}/redis.windows.conf 这类混合分隔符
 * 拿到真实目录后再统一成当前平台分隔符。
 */
export function normalizeServicePaths(s: ServiceDefinition): ServiceDefinition {
  const normAct = (a: ActionSpec | null | undefined): ActionSpec | null | undefined => {
    if (!a || a.type !== 'exec') return a;
    // runner 是单个可执行文件：绝对路径或 PATH 内命令名都交给 normalizePath
    // （命令名如 bash / cmd.exe 经 path.normalize 保持不变，不会被破坏）
    const runner = (a.runner ?? '').trim();
    // 先展开占位符（用服务自身的 dir / port），再归一分隔符
    const ex = expandActionPlaceholders(a, { installDir: s.dir, port: s.port });
    if (!ex || ex.type !== 'exec') return ex as ActionSpec | null | undefined;
    const exRunner = (ex.runner ?? '').trim();
    return {
      ...ex,
      command: ex.command ? normalizePath(ex.command) : ex.command,
      args: (ex.args ?? []).map(normalizeArg),
      ...(exRunner ? { runner: normalizePath(exRunner) } : {})
    };
  };
  return {
    ...s,
    dir: normalizePath(s.dir),
    logDir: s.logDir ? normalizePath(s.logDir) : s.logDir,
    cfg: {
      ...s.cfg,
      acts: {
        start: normAct(s.cfg.acts.start) as ActionSpec | null,
        stop: normAct(s.cfg.acts.stop) as ActionSpec | null,
        restart: normAct(s.cfg.acts.restart) as ActionSpec | null
      }
    }
  };
}

/** 判断是否为绝对路径（Windows 盘符或 UNC、POSIX 根路径） */
export function isAbsolutePath(p: string): boolean {
  return path.isAbsolute(expandHome(p));
}
