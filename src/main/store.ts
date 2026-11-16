/* ============================================================
 * store：内存中的唯一状态源（配置 + 运行时状态 + 设置）
 * 前端只读快照；所有写操作经 store 统一入口并广播事件
 * ============================================================ */
import { BrowserWindow } from 'electron';
import { readYaml, writeYaml, regroupContiguous, validateService } from './config';
import {
  ServicesYaml, ServiceDefinition, GroupDefinition, Settings, RuntimeState, St, PollCycle,
  POLL_INTERVALS, DEFAULT_POLL_MS
} from '../shared/types';

export type StoreEvent =
  | { type: 'snapshot' }
  | { type: 'service-status'; id: string; state: RuntimeState }
  | { type: 'config-changed' }
  | { type: 'templates-changed' }
  | { type: 'template-scan-progress'; done: number; total: number }
  | { type: 'activity'; level: string; tag: string; msg: string }
  | { type: 'service-log'; id: string; line: LogLine }
  | { type: 'poll-cycle'; cycle: PollCycle };

export interface LogLine { ts: string; level: string; tag: string; msg: string; }

class Store {
  data: ServicesYaml;
  states: Map<string, RuntimeState> = new Map();
  /** 修订 40：启动时配置校验错误不再被静默丢弃，供 UI / 排障读取 */
  loadErrors: string[] = [];
  private win: BrowserWindow | null = null;

  constructor() {
    const { data, errors } = readYaml();
    this.loadErrors = errors;
    this.data = { ...data, services: regroupContiguous(data.services, data.groups) };
    for (const s of this.data.services) this.states.set(s.id, this.freshState());
  }

  attachWindow(win: BrowserWindow): void { this.win = win; }

  private broadcast(ev: StoreEvent): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('store-event', ev);
  }

  freshState(): RuntimeState { return { st: 'unknown', _tk: 0 }; }

  /* ---------- 查询 ---------- */
  services(): ServiceDefinition[] { return this.data.services; }
  groups(): GroupDefinition[] { return this.data.groups; }
  settings(): Settings { return this.data.settings; }
  svc(id: string): ServiceDefinition | undefined { return this.data.services.find(s => s.id === id); }
  grp(id: string): GroupDefinition | undefined { return this.data.groups.find(g => g.id === id); }
  members(gid: string): ServiceDefinition[] { return this.data.services.filter(s => s.gid === gid); }
  state(id: string): RuntimeState { return this.states.get(id) ?? this.freshState(); }

  snapshot(): {
    services: ServiceDefinition[];
    groups: GroupDefinition[];
    settings: Settings;
    states: Record<string, RuntimeState>;
  } {
    const states: Record<string, RuntimeState> = {};
    for (const s of this.data.services) states[s.id] = this.state(s.id);
    return { services: this.data.services, groups: this.data.groups, settings: this.data.settings, states };
  }

  /* ---------- 状态写入（probe 是唯一状态写入者的落点） ---------- */
  patchState(id: string, patch: Partial<RuntimeState>): void {
    const cur = this.state(id);
    const next: RuntimeState = { ...cur, ...patch };
    const changed = cur.st !== next.st || cur.pid !== next.pid || cur.portNote !== next.portNote
      || cur.owner !== next.owner || cur.ownerPid !== next.ownerPid || cur.actionNote !== next.actionNote;
    this.states.set(id, next);
    if (changed) this.broadcast({ type: 'service-status', id, state: next });
  }

  setSt(id: string, st: St): void {
    const s = this.svc(id);
    if (!s) return;
    this.patchState(id, { st });
  }

  bumpTk(id: string): number {
    const cur = this.state(id);
    const tk = (cur._tk || 0) + 1;
    this.states.set(id, { ...cur, _tk: tk });
    return tk;
  }

  tkOf(id: string): number { return this.state(id)._tk || 0; }

  /* ---------- 配置写入 ---------- */
  private persist(): void {
    this.data.services = regroupContiguous(this.data.services, this.data.groups);
    writeYaml(this.data);
    this.broadcast({ type: 'config-changed' });
  }

  upsertService(s: ServiceDefinition): void {
    // 修订 40（交叉验证 K01）：写路径强制校验，非法定义不得落盘污染配置
    const errs: string[] = [];
    validateService(s as unknown, 0, errs);
    if (errs.length) throw new Error('服务定义非法：' + errs.join('；'));
    const i = this.data.services.findIndex(x => x.id === s.id);
    if (i >= 0) this.data.services[i] = s;
    else { this.data.services.push(s); this.states.set(s.id, this.freshState()); }
    this.persist();
  }

  removeService(id: string): void {
    this.data.services = this.data.services.filter(s => s.id !== id);
    this.states.delete(id);
    this.persist();
  }

  renameService(id: string, name: string): void {
    const s = this.svc(id);
    if (s) { s.name = name; this.persist(); }
  }

  /* ---------- 组合 ---------- */
  saveGroup(g: GroupDefinition, memberIds: string[]): void {
    const idx = this.data.groups.findIndex(x => x.id === g.id);
    if (idx >= 0) this.data.groups[idx] = g;
    else this.data.groups.push(g);
    // 成员归属：先把这些 id 的 gid 指向本组，其它组内但不在名单的移出
    for (const s of this.data.services) {
      if (memberIds.includes(s.id)) s.gid = g.id;
      else if (s.gid === g.id) s.gid = null;
    }
    // 成员按 memberIds 顺序连续排入
    const members = memberIds.map(id => this.svc(id)!).filter(Boolean);
    const others = this.data.services.filter(s => !memberIds.includes(s.id));
    const firstPos = this.data.services.findIndex(s => memberIds.includes(s.id));
    const insertAt = firstPos < 0 ? others.length : others.slice(0, firstPos).length;
    this.data.services = [...others.slice(0, insertAt), ...members, ...others.slice(insertAt)];
    for (const id of memberIds) if (!this.states.has(id)) this.states.set(id, this.freshState());
    this.persist();
  }

  dissolveGroup(gid: string): void {
    for (const s of this.data.services) if (s.gid === gid) s.gid = null;
    this.data.groups = this.data.groups.filter(g => g.id !== gid);
    this.persist();
  }

  /** 删除组合（危险操作）：彻底移除组合配置，成员 gid 置 null，服务本身不删除 */
  deleteGroup(gid: string): void {
    const g = this.grp(gid);
    if (!g) return;
    for (const s of this.data.services) if (s.gid === gid) s.gid = null;
    this.data.groups = this.data.groups.filter(x => x.id !== gid);
    this.persist();
    this.activity('w', 'WARN', '组合「' + g.name + '」已删除：' + this.members(gid).length + ' 个成员已回到平铺列表');
  }

  moveToGroup(id: string, gid: string | null): void {
    const s = this.svc(id);
    if (!s) return;
    s.gid = gid;
    this.persist();
  }

  toggleGroupCollapsed(gid: string, collapsed: boolean): void {
    const g = this.grp(gid);
    if (g) { g.collapsed = collapsed; this.persist(); }
  }

  /* ---------- 顺序写回（顶层块模型） ---------- */
  private blocks(): { gid: string | null; items: ServiceDefinition[] }[] {
    const out: { gid: string | null; items: ServiceDefinition[] }[] = [];
    const seen = new Set<string>();
    for (const s of this.data.services) {
      if (s.gid) {
        if (seen.has(s.gid)) continue;
        seen.add(s.gid);
        out.push({ gid: s.gid, items: this.members(s.gid) });
      } else {
        out.push({ gid: null, items: [s] });
      }
    }
    return out;
  }

  /** 移动顶层块到目标块前/后；返回 1 成功 / 0 无变化 / -1 非法 */
  moveBlock(srcGid: string | null, srcSvcId: string, dstGid: string | null, dstSvcId: string, before: boolean): number {
    const srcKey = srcGid ?? 'flat:' + srcSvcId;
    const dstKey = dstGid ?? 'flat:' + dstSvcId;
    const bs = this.blocks();
    const keyOf = (b: { gid: string | null; items: ServiceDefinition[] }) => b.gid ?? 'flat:' + b.items[0].id;
    const i = bs.findIndex(b => keyOf(b) === srcKey);
    const j0 = bs.findIndex(b => keyOf(b) === dstKey);
    if (i < 0 || j0 < 0) return -1;
    if (i === j0) return 0;
    const orig = this.data.services.map(s => s.id).join(',');
    const moved = bs.splice(i, 1)[0];
    const j = bs.findIndex(b => keyOf(b) === dstKey);
    bs.splice(before ? j : j + 1, 0, moved);
    const arr: ServiceDefinition[] = [];
    bs.forEach(b => b.items.forEach(s => arr.push(s)));
    if (arr.map(s => s.id).join(',') === orig) return 0;
    this.data.services = arr;
    this.persist();
    return 1;
  }

  /** 组内成员重排；返回 1 / 0 / -1 */
  moveMemberInGroup(gid: string, srcId: string, dstId: string, before: boolean): number {
    if (srcId === dstId) return 0;
    const cur = this.members(gid).map(s => s.id);
    const orig = cur.join(',');
    const ids = cur.slice();
    const i = ids.indexOf(srcId);
    if (i < 0 || ids.indexOf(dstId) < 0) return -1;
    ids.splice(i, 1);
    const j = ids.indexOf(dstId);
    ids.splice(before ? j : j + 1, 0, srcId);
    if (ids.join(',') === orig) return 0;
    const map = new Map(this.members(gid).map(s => [s.id, s]));
    const startIdx = this.data.services.findIndex(s => s.gid === gid);
    const blockLen = this.members(gid).length;
    const arr = ids.map(id => map.get(id)!).filter(Boolean);
    if (arr.length !== blockLen) return -1;
    this.data.services.splice(startIdx, blockLen, ...arr);
    this.persist();
    return 1;
  }

  /* ---------- 设置 ---------- */
  setSettings(patch: Partial<Settings>): void {
    const next = { ...this.data.settings, ...patch };
    // v2.43：写入口也做三档钳制，保证快照 / 落盘 / probe 实际间隔三者一致
    if (typeof next.pollMs === 'number' && !POLL_INTERVALS.includes(next.pollMs)) {
      next.pollMs = DEFAULT_POLL_MS;
    }
    this.data.settings = next;
    this.persist();
  }

  /* ---------- 活动日志 / 服务日志 ---------- */
  activity(level: string, tag: string, msg: string): void {
    // 修订 40（交叉验证 K11）：活动消息同时落入日志缓冲，供 get-activity-log 回看。
    // 延迟 require 避免与 logs.ts（其自身 import store）形成顶层循环依赖。
    try { require('./logs').logs.pushActivity(level, tag, msg); } catch { /* logs 尚未加载 */ }
    this.broadcast({ type: 'activity', level, tag, msg });
  }

  serviceLog(id: string, line: LogLine): void {
    this.broadcast({ type: 'service-log', id, line });
  }

  /** v2.41：轮询轮次事件，供服务列表标题栏显示「系统正在刷新服务」 */
  pollCycle(cycle: PollCycle): void {
    this.broadcast({ type: 'poll-cycle', cycle });
  }
}

export const store = new Store();
