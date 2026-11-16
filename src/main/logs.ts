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
  }

  get(id: string): LogLine[] { return this.buffers.get(id) ?? []; }

  pushActivity(level: string, tag: string, msg: string): void {
    const line: LogLine = { ts: this.now(), level, tag, msg };
    this.activity.push(line);
    if (this.activity.length > MAX_LINES) this.activity.splice(0, this.activity.length - MAX_LINES);
  }

  getActivity(): LogLine[] { return this.activity; }

  clearService(id: string): void {
    this.buffers.delete(id);
    const h = this.tailHandles.get(id);
    if (h) { h.close(); this.tailHandles.delete(id); }
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
