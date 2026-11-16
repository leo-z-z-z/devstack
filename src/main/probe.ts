/* ============================================================
 * probe 模块：状态唯一写入者
 * - 冷启动全量基线（并发受控、失败隔离、先 unknown 后 patch）
 * - 全局心跳（SETTINGS.pollMs）+ 动作期 300ms 定向快探
 * - v2.41：心跳向渲染器广播轮次事件，让「系统正在刷新服务」可见
 * - v2.42：周期刷新范围 = 已启动 + 已停止组件；0 项运行中/已停止时整轮跳过，不探测、不广播轮次
 * - v2.43：间隔收敛为 1 / 3 / 5 秒三档（默认 3 秒），最短可见时长按间隔自适应
 * - 纯 TCP 端口探测 + owning PID 归属判定（Windows netstat / POSIX lsof）
 * ============================================================ */
import net from 'node:net';
import { execSync } from 'node:child_process';
import {
  ServiceDefinition, RuntimeState, St, PollCycle, POLL_INTERVALS, DEFAULT_POLL_MS
} from '../shared/types';

const IS_WIN = process.platform === 'win32';
/** 「刷新中」最短可感知时长上限：本地端口探测常在几十毫秒内完成，否则用户根本看不到 */
const MIN_CYCLE_VISIBLE_MS = 620;

/* ---------- 单次 TCP 探测 ---------- */
export function tcpProbe(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try { sock.connect(port, '127.0.0.1'); } catch { finish(false); }
  });
}

/* ---------- owning PID 归属（跨平台） ---------- */
export interface OwnerInfo { pid: number; name: string }

export function findOwner(port: number): OwnerInfo | null {
  try {
    if (IS_WIN) {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString();
      const line = out.split(/\r?\n/).find(l => l.includes(':' + port));
      if (!line) return null;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (!pid) return null;
      const name = processName(pid) || 'unknown';
      return { pid, name };
    }
    // macOS / Linux：lsof 查 LISTEN 的 PID 与命令名
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const line = out.split(/\r?\n/).slice(1).find(l => l.trim());
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[1], 10);
    if (!pid) return null;
    return { pid, name: parts[0] || 'unknown' };
  } catch {
    return null;
  }
}

function processName(pid: number): string {
  try {
    if (IS_WIN) {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString();
      const parts = out.trim().split(/\s+/);
      return parts[0] || '';
    }
    const out = execSync(`ps -p ${pid} -o comm=`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.trim();
  } catch { return ''; }
}

/* ---------- 单服务状态探测（含归属判定） ---------- */
export async function probeOne(svc: ServiceDefinition, ownedPids: Set<number>): Promise<Partial<RuntimeState>> {
  const ok = await tcpProbe(svc.port, 800);
  if (ok) {
    const owner = findOwner(svc.port);
    if (owner && ownedPids.has(owner.pid)) {
      // 自己树内的进程持有端口 → 正常 running；显式清空旧归属，避免端口易主后残留
      return { st: 'running', pid: owner.pid, owner: undefined, ownerPid: undefined, portNote: undefined };
    }
    if (owner) {
      // 端口通但 PID 不在已知树内 → 外部托管，不算冲突
      return { st: 'running', pid: owner.pid, owner: owner.name, ownerPid: owner.pid, portNote: '外部托管' };
    }
    return { st: 'running', owner: undefined, ownerPid: undefined, portNote: undefined };
  }
  // 端口不通：若此前 known tree 里有进程占用 → 冲突（服务未跑但端口被占）
  const owner = findOwner(svc.port);
  if (owner && !ownedPids.has(owner.pid)) {
    return { st: 'stopped', pid: undefined, owner: owner.name, ownerPid: owner.pid, portNote: '被占用' };
  }
  // 没有占用者时必须显式清空 owner / ownerPid，否则旧冲突会一直残留，
  // 把普通启动失败误判成端口冲突（旧字段浅合并无法自动消失）。
  return { st: 'stopped', pid: undefined, owner: undefined, ownerPid: undefined, portNote: '空闲' };
}

/* ---------- 探测调度器：并发受控的全量基线 + 全局心跳 ---------- */
export class ProbeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ownedPids = new Set<number>();
  private onPatch: (id: string, patch: Partial<RuntimeState>) => void;
  private getServices: () => ServiceDefinition[];
  private getSt: (id: string) => St;
  private pollMs: number;
  /** 轮次事件回调（可选：测试夹具不传也能正常工作） */
  private onCycle?: (c: PollCycle) => void;
  private seq = 0;
  private manualBusy = false;
  private classifying = false;

  constructor(opts: {
    getServices: () => ServiceDefinition[];
    getSt: (id: string) => St;
    onPatch: (id: string, patch: Partial<RuntimeState>) => void;
    pollMs: number;
    onCycle?: (c: PollCycle) => void;
  }) {
    this.getServices = opts.getServices;
    this.getSt = opts.getSt;
    this.onPatch = opts.onPatch;
    this.pollMs = opts.pollMs;
    this.onCycle = opts.onCycle;
  }

  registerOwnedPid(pid: number): void { if (pid) this.ownedPids.add(pid); }
  unregisterOwnedPid(pid: number): void { this.ownedPids.delete(pid); }

  /** 点击启动/重启前对单服务做一次新鲜探测，防止旧端口占用者残留误拦截 */
  async refreshOne(svc: ServiceDefinition): Promise<void> {
    try { this.onPatch(svc.id, await probeOne(svc, this.ownedPids)); } catch { /* 保留当前状态 */ }
  }

  /** 设置页修改间隔后立即重建定时器并跑一轮，让用户马上看到新节奏 */
  setPollMs(ms: number): void {
    // v2.43：只接受 1 / 3 / 5 秒三档，非法值（含旧版 1.5 秒）回落默认 3 秒
    this.pollMs = POLL_INTERVALS.includes(ms) ? ms : DEFAULT_POLL_MS;
    this.restart();
    void this.sweep();
  }

  start(): void { this.restart(); }

  /** 轮次事件：begin 在探测前，end 在探测后（短探测会被延长到可感知时长） */
  private emitCycle(phase: 'begin' | 'end', mode: 'auto' | 'manual',
    scope: number, seq: number, ts: number): void {
    if (!this.onCycle) return;
    this.onCycle({ seq, phase, mode, scope, pollMs: this.pollMs, ts });
  }

  /**
   * 最短可感知时长随间隔自适应：1 秒档压到 300ms，否则 620ms 的保底会让指示器
   * 每轮有 62% 时间在转圈，看起来像卡住；3 / 5 秒档仍保持 620ms 完整可见。
   */
  private minVisibleMs(): number {
    return Math.min(MIN_CYCLE_VISIBLE_MS, Math.max(240, Math.round(this.pollMs * 0.3)));
  }

  private endCycle(seq: number, mode: 'auto' | 'manual', scope: number,
    beganAt: number, onDone?: () => void): void {
    const hold = Math.max(0, this.minVisibleMs() - (Date.now() - beganAt));
    const done = () => {
      // 期间已有新一轮 begin（例如用户改了间隔或点了立即刷新），丢弃本轮 end
      if (seq === this.seq) this.emitCycle('end', mode, scope, seq, Date.now());
      if (onDone) onDone();
    };
    if (hold > 0) { const t = setTimeout(done, hold); t.unref(); } else done();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private restart(): void {
    this.stop();
    this.timer = setInterval(() => this.sweep(), this.pollMs);
    this.timer.unref();
  }

  /** 冷启动全量基线：并发 8，失败隔离 */
  async baseline(): Promise<void> {
    const list = this.getServices();
    const CONC = 8;
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const s = list[idx++];
        try {
          const patch = await probeOne(s, this.ownedPids);
          this.onPatch(s.id, patch);
        } catch {
          this.onPatch(s.id, { st: 'unknown' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, worker));
  }

  /**
   * 心跳扫一轮。
   * - 周期刷新范围 = running + stopped 组件：端口归属、被占用/空闲状态会随时间变化，
   *   周期探测可保持列表状态与真实情况同步。
   *   starting / stopping 已有 300ms 定向快探；unknown 由 classifyUnknown() 独立处理，
   *   二者均不进入本轮周期探测。
   * - 0 项 running/stopped 时整轮跳过——不发 begin/end、不推进 seq、不做 TCP +
   *   netstat/lsof 探测，界面既不会显示「正在刷新 0 项」，也不会把「上次刷新时间」
   *   无意义地往前推。定时器仍按 pollMs 做一次纯内存状态检查，一旦有组件进入
   *   running/stopped（动作期快探 / 手动全量刷新 / 冷启动基线），下一轮立即恢复刷新。
   * - 冷启动 baseline() / 手动 refreshAll() 仍是全量扫描，端口归属与冲突由此更新。
   */
  private sweeping = false;
  async sweep(): Promise<void> {
    // 手动全量刷新期间不发自动 begin，否则会把用户刚点出来的「全量刷新」态瞬间盖掉
    if (this.manualBusy) return;
    // 首探与周期刷新解耦：即使本轮没有可刷新项，也要让新服务 / 超时自愈态收敛
    void this.classifyUnknown();
    if (this.sweeping) return;
    const list = this.getServices().filter(s => {
      const st = this.getSt(s.id);
      return st === 'running' || st === 'stopped';
    });
    if (!list.length) return;
    this.sweeping = true;
    const seq = ++this.seq;
    const beganAt = Date.now();
    try {
      this.emitCycle('begin', 'auto', list.length, seq, beganAt);
      await this.runProbes(list);
      this.endCycle(seq, 'auto', list.length, beganAt);
    } finally {
      this.sweeping = false;
    }
  }

  /** 并发受控探测（并发 8，失败隔离）；状态判等由 store.patchState 完成 */
  private async runProbes(list: ServiceDefinition[]): Promise<void> {
    const CONC = 8;
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        const s = list[idx++];
        try {
          const patch = await probeOne(s, this.ownedPids);
          this.onPatch(s.id, patch);
        } catch { /* ignore */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, worker));
  }

  /**
   * unknown 首探 / 超时自愈：与周期刷新并行、并发受控，且有独立重入锁。
   * 不占用 sweep 的 sweeping 锁，避免新增服务因一轮慢探测就长时间停在 unknown。
   */
  private async classifyUnknown(): Promise<void> {
    if (this.classifying) return;
    const list = this.getServices().filter(s => this.getSt(s.id) === 'unknown');
    if (!list.length) return;
    this.classifying = true;
    try { await this.runProbes(list); } finally { this.classifying = false; }
  }

  /** 用户点击标题栏刷新指示器：全量扫描（含已停止组件），用于刷新端口归属 / 冲突 */
  async refreshAll(): Promise<void> {
    if (this.manualBusy) return;
    this.manualBusy = true;
    const seq = ++this.seq;
    const beganAt = Date.now();
    try {
      const list = this.getServices().filter(s => this.getSt(s.id) !== 'starting' && this.getSt(s.id) !== 'stopping');
      this.emitCycle('begin', 'manual', list.length, seq, beganAt);
      await this.runProbes(list);
      // 互斥一直保持到 end 事件发完，保证「正在全量刷新」完整展示，不被自动心跳插队
      this.endCycle(seq, 'manual', list.length, beganAt, () => { this.manualBusy = false; });
    } catch {
      this.emitCycle('end', 'manual', 0, seq, Date.now());
      this.manualBusy = false;
    }
  }

  /** 动作期定向快探：只探目标组件，300ms 间隔，直到出现期望终态或超时 */
  watchTarget(id: string, svc: ServiceDefinition, expect: St, timeoutMs: number,
    onHit: (patch: Partial<RuntimeState>) => void, onTimeout?: () => void): () => void {
    let stopped = false;
    const startAt = Date.now();
    const iv = setInterval(async () => {
      if (stopped) return;
      try {
        const patch = await probeOne(svc, this.ownedPids);
        if (patch.st === expect) {
          stopped = true;
          clearInterval(iv);
          onHit(patch);
        } else if (Date.now() - startAt > timeoutMs) {
          stopped = true;
          clearInterval(iv);
          // 修订 40（交叉验证 K12）：超时必须解除过渡态，否则 isBusy 永久为真、组件再不可操作
          if (onTimeout) onTimeout();
        }
      } catch { /* ignore */ }
    }, 300);
    iv.unref();
    return () => { stopped = true; clearInterval(iv); };
  }
}
