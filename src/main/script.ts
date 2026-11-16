/* ============================================================
 * script 模块：服务脚本目录管理（扫描 / 读取 / 保存 / 删除 / 运行）
 * 目录结构：scripts/{serviceId}/start.{bat|sh|ps1} ...
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scriptsDir, isAbsolutePath } from './paths';
import type { ScriptScanItem, ScriptFileInfo } from '../shared/types';
export { scriptsDir };

const MAX_BYTES = 256 * 1024;

/** 确保脚本根目录存在 */
export function ensureScriptsDir(): void {
  fs.mkdirSync(scriptsDir(), { recursive: true });
}

/** 服务脚本目录路径（路径已规范化） */
export function serviceScriptDir(serviceId: string): string {
  return path.resolve(scriptsDir(), serviceId);
}

/** 脚本文件完整路径，带路径遍历保护（仅允许 scripts/ 目录内） */
export function scriptFilePath(relPath: string): string {
  const dir = path.resolve(scriptsDir());
  const full = path.resolve(dir, relPath);
  const rel = path.relative(dir, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径越界：仅允许 scripts 目录内的文件');
  return full;
}

/** 可运行脚本扩展名：与保存层 saveScriptFile、运行层 resolveInterpreter 的白名单保持一致 */
const RUNNABLE_EXTS = ['.bat', '.cmd', '.ps1', '.sh'];
function isRunnableScript(filename: string): boolean {
  return RUNNABLE_EXTS.includes(path.extname(filename).toLowerCase());
}

/** 扫描所有服务脚本目录——显示所有文件夹，每个文件夹下只列出可运行脚本（.bat/.cmd/.ps1/.sh） */
export function scanScripts(serviceMap: Map<string, string>): ScriptScanItem[] {
  ensureScriptsDir();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(scriptsDir(), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch { return []; }

  return entries.map(serviceId => {
    const dir = serviceScriptDir(serviceId);
    const scripts: ScriptFileInfo[] = [];

    // 读取目录下全部普通文件，仅保留可运行脚本（不限命名，不含子目录）
    let allFiles: string[] = [];
    try {
      allFiles = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isFile() && isRunnableScript(d.name))
        .map(d => d.name)
        .sort();
    } catch { /* 目录不存在或读取失败 */ }

    for (const file of allFiles) {
      const full = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      scripts.push({
        file,
        exists: true,
        size: stat.size,
        ext: path.extname(file).toLowerCase()
      });
    }

    return {
      serviceId,
      serviceName: serviceMap.get(serviceId),
      dir,
      scripts
    };
  });
}

/** 读取脚本文件内容 */
export function readScriptFile(relPath: string): { ok: boolean; text?: string; error?: string } {
  try {
    const full = scriptFilePath(relPath);
    const stat = fs.statSync(full);
    if (stat.size > MAX_BYTES) return { ok: false, error: '文件超过 256KB 上限' };
    return { ok: true, text: fs.readFileSync(full, 'utf8') };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/** 保存脚本文件（原子写，仅允许脚本扩展名） */
export function saveScriptFile(relPath: string, content: string): { ok: boolean; code?: 'path' | 'too-large' | 'write'; message?: string } {
  const base = path.basename(relPath);
  const ext = path.extname(base).toLowerCase();
  if (!['.bat', '.cmd', '.ps1', '.sh'].includes(ext)) {
    return { ok: false, code: 'path', message: '仅允许 .bat / .cmd / .ps1 / .sh 脚本文件' };
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    return { ok: false, code: 'too-large', message: '文件超过 256KB 上限' };
  }
  let full: string;
  try { full = scriptFilePath(relPath); }
  catch (e) { return { ok: false, code: 'path', message: String(e) }; }

  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = full + '.' + process.pid + '.' + Date.now() + '.tmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, full);
    return { ok: true };
  } catch (e) { return { ok: false, code: 'write', message: String(e) }; }
}

/** 删除脚本文件 */
export function deleteScriptFile(relPath: string): { ok: boolean; error?: string } {
  try {
    const full = scriptFilePath(relPath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/** 创建服务脚本目录（如不存在） */
export function createScriptDir(serviceId: string): { ok: boolean; dir?: string; error?: string } {
  try {
    const dir = serviceScriptDir(serviceId);
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, dir };
  } catch (e) { return { ok: false, error: String(e) }; }
}

/** 运行脚本文件（一次性，等待退出），返回输出 */
export function runScriptFile(relPath: string, cwd?: string): Promise<{ ok: boolean; code?: number | null; stdout?: string; stderr?: string; error?: string }> {
  return new Promise(resolve => {
    try {
      const full = scriptFilePath(relPath);
      const ext = path.extname(full).toLowerCase();
      const isWin = process.platform === 'win32';

      let file: string, args: string[];
      if (isWin) {
        if (ext === '.bat' || ext === '.cmd') { file = 'cmd.exe'; args = ['/d', '/s', '/c', full]; }
        else if (ext === '.ps1') { file = 'powershell.exe'; args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', full]; }
        else { file = full; args = []; }
      } else {
        if (ext === '.sh') { file = '/bin/sh'; args = [full]; }
        else { file = full; args = []; }
      }

      const child = spawn(file, args, {
        cwd: cwd || undefined,
        detached: !isWin,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });

      let stdout = '', stderr = '';
      child.stdout?.on('data', d => { stdout += d.toString(); });
      child.stderr?.on('data', d => { stderr += d.toString(); });
      child.on('error', e => resolve({ ok: false, error: String(e) }));
      child.on('exit', code => resolve({ ok: code === 0, code, stdout: stdout.trim() || undefined, stderr: stderr.trim() || undefined }));
    } catch (e) { resolve({ ok: false, error: String(e) }); }
  });
}

/** 判断路径是否为绝对路径（兼容 isAbsolutePath 导出） */
export { isAbsolutePath };
