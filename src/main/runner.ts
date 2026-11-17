/* ============================================================
 * runner 模块：跨平台进程管理
 * - exec / builtin 分发，参数数组不做字符串拼接
 * - POSIX：detached 子进程自建进程组，终止用负 PID 发 SIGTERM（先 TERM 后 KILL）
 * - Windows：taskkill /T /F /PID 杀进程树
 * - 静默后台启动，隐藏控制台；超时与动作令牌收敛
 * ============================================================ */
import { spawn, ChildProcess, execSync } from 'node:child_process';
import path from 'node:path';
import { logs } from './logs';
import { ActionSpec } from '../shared/types';

const IS_WIN = process.platform === 'win32';

export interface RunResult {
  ok: boolean;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  stdoutTail: string[];
  error?: string;
}

export interface Handle {
  pid: number;
  kill: () => Promise<void>;
  child?: ChildProcess;
  /** 修订 57：spawn 失败（如命令路径不存在 → ENOENT）时的原因，供上层写入 actionNote */
  error?: string;
}

const handles = new Map<string, Handle>();

export function getHandle(key: string): Handle | undefined { return handles.get(key); }
export function dropHandle(key: string): void { handles.delete(key); }

/* ---------- 按扩展名选择解释器（runner 可替换执行器文件，参数模板仍按脚本类型） ----------
 * 用户可在动作上指定 runner（单个可执行文件，不带参数）：
 * - 有 runner：file 换成 runner，但「让脚本能跑起来的最小参数模板」仍由脚本扩展名决定
 *   （.bat/.cmd → /d /s /c、.ps1 → -File、.sh → 脚本路径作首参）
 * - 无 runner：沿用默认执行器（cmd.exe / powershell.exe / /bin/sh / 直接执行）
 * 脚本路径始终是 prefix 的最后一项，用户 args 再追加在其后。
 */
export function resolveInterpreter(cmd: string, runner?: string): { file: string; prefix: string[] } {
  const ext = path.extname(cmd).toLowerCase();
  const r = (runner ?? '').trim();
  if (IS_WIN) {
    if (ext === '.bat' || ext === '.cmd') return { file: r || 'cmd.exe', prefix: ['/d', '/s', '/c', cmd] };
    if (ext === '.ps1') return { file: r || 'powershell.exe', prefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cmd] };
    // 其他（.exe / 无扩展名 / Linux 可执行文件）：无 runner 直接执行；有 runner 则把脚本交给它
    return r ? { file: r, prefix: [cmd] } : { file: cmd, prefix: [] };
  }
  // POSIX：.sh 用 sh，其余直接执行（依赖 shebang / exec 位）；有 runner 时一律交给它
  if (ext === '.sh') return { file: r || '/bin/sh', prefix: [cmd] };
  return r ? { file: r, prefix: [cmd] } : { file: cmd, prefix: [] };
}

/* ---------- 执行动作（常驻服务：启动后保持运行，完成判定交给 probe） ---------- */
export function execAction(key: string, action: ActionSpec, cwd: string, onExit?: (code: number | null) => void, onError?: (err: string) => void): Handle {
  const { file, prefix } = resolveInterpreter(action.command ?? '', action.runner);
  const args = [...prefix, ...(action.args ?? [])];

  const child = spawn(file, args, {
    cwd: cwd || undefined,
    detached: !IS_WIN,          // POSIX 自建进程组
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });

  const h: Handle = { pid: child.pid ?? 0, kill: () => killHandle(key), child };
  handles.set(key, h);

  // P0：捕获子进程 stdout/stderr，写入日志系统，避免输出被丢弃
  child.stdout?.on('data', (buf) => {
    buf.toString('utf8').split(/\r?\n/).forEach((line: string) => {
      if (line) logs.push(key, 'i', 'stdout', line);
    });
  });
  child.stderr?.on('data', (buf) => {
    buf.toString('utf8').split(/\r?\n/).forEach((line: string) => {
      if (line) logs.push(key, 'w', 'stderr', line);
    });
  });

  // 修订 57：spawn 失败原因不再被静默吞掉。
  // 典型场景：命令里残留未展开的 ${installDir} → Windows 找不到该路径 → ENOENT。
  // 此前这里只有空回调，错误被丢弃，用户只能看到「启动超时」，无从判断原因。
  child.on('error', (e) => {
    const msg = spawnErrorText(e);
    h.error = msg;
    if (onError) onError(msg);
  });
  child.on('exit', (code) => {
    if (handles.get(key) === h) handles.delete(key);
    if (onExit) onExit(code);
  });
  return h;
}

/** 修订 57：把 spawn 的错误对象压成一行可读原因（ENOENT / EACCES 等） */
export function spawnErrorText(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  const msg = String((e as { message?: string } | null)?.message ?? e);
  const first = msg.split('\n')[0].trim();
  if (code === 'ENOENT') return '命令不存在或路径无法访问：' + first;
  if (code === 'EACCES') return '没有执行权限：' + first;
  if (code) return code + '：' + first;
  return first;
}

/* ---------- 执行一次性命令并等待退出（stop 命令、预检之外的场景） ---------- */
export function execAndWait(action: ActionSpec, cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const { file, prefix } = resolveInterpreter(action.command ?? '', action.runner);
    const args = [...prefix, ...(action.args ?? [])];
    const stdoutTail: string[] = [];
    let settled = false;

    const child = spawn(file, args, {
      cwd: cwd || undefined,
      // 修订 40（交叉验证 K15）：POSIX 下 killChildTree 用负 PID 杀进程组，
      // 一次性命令也必须自建进程组，否则超时杀不掉甚至可能误杀无关组。
      detached: !IS_WIN,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { killChildTree(child); } catch { /* ignore */ }
        resolve({ ok: false, stdoutTail, error: 'timeout' });
      }
    }, timeoutMs);

    const pushTail = (buf: Buffer) => {
      buf.toString('utf8').split(/\r?\n/).forEach(line => {
        if (!line) return;
        stdoutTail.push(line);
        if (stdoutTail.length > 200) stdoutTail.shift();
      });
    };
    child.stdout?.on('data', pushTail);
    child.stderr?.on('data', pushTail);

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdoutTail, error: String(e) });
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, signal, stdoutTail });
    });
  });
}

/* ---------- 跨平台杀进程树 ---------- */
export function killChildTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  if (IS_WIN) {
    try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ }
  } else {
    // detached 子进程是进程组组长，负 PID 杀整组；先 TERM 后 KILL
    try { process.kill(-pid, 'SIGTERM'); } catch { /* 组已不在 */ }
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ } }, 1500).unref();
  }
}

async function killHandle(key: string): Promise<void> {
  const h = handles.get(key);
  if (!h) return;
  handles.delete(key);
  if (h.child) killChildTree(h.child);
}

/** 中断指定服务的启动/停止进程（用于“中断启动”按钮） */
export async function interruptHandle(key: string): Promise<boolean> {
  const h = handles.get(key);
  if (!h) return false;
  handles.delete(key);
  if (h.child) killChildTree(h.child);
  return true;
}

/* ---------- builtin 动作 ---------- */
export async function runBuiltin(key: string, action: ActionSpec, cwd: string): Promise<RunResult> {
  if (action.builtin === 'killProcessTree') {
    const h = handles.get(key);
    if (h?.child) killChildTree(h.child);
    handles.delete(key);
    return { ok: true, stdoutTail: [] };
  }
  return { ok: false, stdoutTail: [], error: 'unsupported builtin: ' + action.builtin };
}
