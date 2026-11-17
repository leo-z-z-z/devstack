/* ============================================================
 * logs 模块：stdout 环形缓冲 + 文件 tail + 全局活动日志
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { logDir } from './paths';
import { store, LogLine } from './store';

const MAX_LINES = 500;

class LogBuffer {
  private buffers = new Map<string, LogLine[]>();
  private activity: LogLine[] = [];
  private tailHandles = new Map<string, { close: () => void }>();

  private now(): string {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
  }

  push(id: string, level: string, tag: string, msg: string): void {
    const line: LogLine = { ts: this.now(), level, tag, msg };
    const buf = this.buffers.get(id) ?? [];
    buf.push(line);
    if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
    this.buffers.set(id, buf);
    store.serviceLog(id, line);
    // P1：落盘到服务日志文件
    this.writeToFile(id, line);
  }

  get(id: string): LogLine[] { return this.buffers.get(id) ?? []; }

  pushActivity(level: string, tag: string, msg: string): void {
    const line: LogLine = { ts: this.now(), level, tag, msg };
    this.activity.push(line);
    if (this.activity.length > MAX_LINES) this.activity.splice(0, this.activity.length - MAX_LINES);
    // P1：落盘到软件运行日志
    this.writeAppLog(line);
  }

  getActivity(): LogLine[] { return this.activity; }

  clearService(id: string): void {
    this.buffers.delete(id);
    const h = this.tailHandles.get(id);
    if (h) { h.close(); this.tailHandles.delete(id); }
  }

  // P1：将单条日志追加写入服务独立日志文件 logs/<id>.log
  private writeToFile(id: string, line: LogLine): void {
    try {
      const dir = logDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}.log`);
      const logLine = `${line.ts} [${line.level}] ${line.tag}: ${line.msg}\n`;
      fs.appendFileSync(file, logLine, 'utf8');
    } catch { /* ignore，文件写失败不应阻断内存日志 */ }
  }

  // P1：将单条活动日志追加写入软件运行日志 logs/app.log
  private writeAppLog(line: LogLine): void {
    try {
      const dir = logDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'app.log');
      const logLine = `${line.ts} [${line.level}] ${line.tag}: ${line.msg}\n`;
      fs.appendFileSync(file, logLine, 'utf8');
    } catch { /* ignore */ }
  }

  // P1：删除超过设定天数的 .log 文件
  cleanupOldLogs(days: number): void {
    try {
      const dir = logDir();
      if (!fs.existsSync(dir)) return;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        const full = path.join(dir, file);
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(full);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // P1：启动清理定时器，立即执行一次， thereafter 每小时检查一次
  startCleanupTimer(days: number): void {
    this.cleanupOldLogs(days);
    setInterval(() => {
      try { this.cleanupOldLogs(days); } catch { /* ignore */ }
    }, 60 * 60 * 1000).unref();
  }

  /** 文件 tail：跟随服务的 log.file，简单轮询增量读取（跨平台、无原生依赖） */
  followFile(id: string, file: string, tag: string): void {
    if (!file) return;
    const full = path.isAbsolute(file) ? file : path.join(logDir(), file);
    if (this.tailHandles.has(id)) return;
    let offset = 0;
    let stopped = false;
    const iv = setInterval(() => {
      if (stopped) return;
      try {
        if (!fs.existsSync(full)) return;
        const stat = fs.statSync(full);
        if (stat.size < offset) offset = 0; // 轮转重置
        if (stat.size === offset) return;
        const fd = fs.openSync(full, 'r');
        const len = stat.size - offset;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        fs.closeSync(fd);
        offset = stat.size;
        buf.toString('utf8').split(/\r?\n/).forEach(line => {
          if (line) this.push(id, 'i', tag, line);
        });
      } catch { /* ignore */ }
    }, 1500);
    iv.unref();
    this.tailHandles.set(id, { close: () => { stopped = true; clearInterval(iv); } });
  }

  stopAll(): void {
    for (const h of this.tailHandles.values()) h.close();
    this.tailHandles.clear();
  }
}

export const logs = new LogBuffer();

// P1：模块加载后延迟启动日志清理，确保 store 已初始化
setTimeout(() => {
  try {
    const days = store.settings().logDays ?? 7;
    logs.startCleanupTimer(days);
  } catch { /* settings 尚未就绪时忽略 */ }
}, 0);
