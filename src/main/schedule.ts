/* ============================================================
 * schedule 模块：顶层块 → 执行链，混合调度（修订 29/32/35/37/39）
 * - 全部启动：未分组并行区 + 各组合自上而下完成驱动串行链，链间并行
 * - 全部停止：未分组并行区 + 各组合从下到上倒序安全停止串行链
 * - 链内完成驱动、每步重读当前实际状态、isBusy 排除执行中组件
 * - 冲突项终止所属链后续（固定链级，不可配置）
 * - toggle / restart 只在稳定态生效（v2.39 守卫，修反向 bug）
 * ============================================================ */
import { store } from './store';
import { execAction, execAndWait, runBuiltin, interruptHandle } from './runner';
import { ProbeScheduler } from './probe';
import { ServiceDefinition, ActionSpec, LanePlanItem, ConfirmAllPlan, ConfirmSkipReason, PortsConflictItem } from '../shared/types';
import { expandActionPlaceholders } from '../shared/placeholders';

const IS_BUSY = (st: string) => st === 'starting' || st === 'stopping';

export interface Ctx {
  probe: ProbeScheduler;
  openUrl: (url: string) => void;
  openDir: (dir: string) => void;
}

let ctx: Ctx | null = null;
export function initSchedule(c: Ctx): void { ctx = c; }

/** v2.41：设置页改「状态轮询间隔」必须重建心跳定时器，否则只在下次启动才生效 */
export function applyPollMs(ms: number): void {
  if (ctx) ctx.probe.setPollMs(ms);
}

/** v2.41：服务列表标题栏「立即刷新」→ 全量扫描（含已停止组件） */
export function refreshAllStatus(): void {
  if (ctx) void ctx.probe.refreshAll();
}

/**
 * 修订 40（交叉验证 K07）：在途链成员集合。
 * 组合串行链等上一项就绪期间，后续成员仍是 stopped，若用户/界面再次触发
 * 全部启动，会被当成新的可启动项另建一条链抢跑，破坏「完成驱动串行」。
 * 这里把整条链在启动时整体标记在途，链结束统一释放。
 */
const pending = new Set<string>();

/* ================= 动作执行基础 ================= */

function defaultTimeout(a: ActionSpec | null | undefined): number {
  return a?.timeoutMs ?? 15000;
}

/**
 * 完成驱动：等待某服务由 doStart / doStop 的 watchTarget 写入期望终态。
 * 组合串行链必须「等上一项就绪 / 等停止释放」才推进下一项（对齐原型 v2.39 runLanes 的 done→next）。
 * 未收敛则超时返回 false，由调用方终止本组合链后续，避免带病推进。
 */
async function waitTerminal(id: string, expect: string, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (store.state(id).st === expect) return true;
    await new Promise<void>(r => setTimeout(r, 100));
  }
  return false;
}

/**
 * 修订 57：执行前兜底展开占位符。
 * 正常路径下 services.yaml 里已是展开后的真实路径（保存时展开）；
 * 这里兜住「存量坏配置 / 手工编辑过的 yaml」——命令里残留 ${installDir} 时，
 * 直接按服务自身的 dir / port 展开再执行，不至于拿字面量去 spawn 必然失败。
 */
function resolveAction(svc: ServiceDefinition, a: ActionSpec | null | undefined): ActionSpec | null | undefined {
  if (!a || a.type !== 'exec') return a;
  return expandActionPlaceholders(a, { installDir: svc.dir, port: svc.port }) as ActionSpec;
}

/** 启动：exec 命令拉起常驻进程；完成判定交给 probe 的定向快探（等端口就绪） */
export async function doStart(svc: ServiceDefinition): Promise<void> {
  const act = resolveAction(svc, svc.cfg.acts.start);
  if (!act) {
    store.patchState(svc.id, { st: 'unknown', actionNote: '启动失败：未配置启动命令' });
    store.activity('w', 'WARN', svc.name + ' 没有启动命令');
    return;
  }
  const tk = store.bumpTk(svc.id);
  // 新动作开始：清掉上一轮的失败说明；端口归属仍由 probe 维护
  store.patchState(svc.id, { st: 'starting', actionNote: undefined });
  store.activity('i', 'INFO', svc.name + ' 启动中：等待端口 ' + svc.port + ' 就绪…');
  if (act.type === 'builtin') {
    const r = await runBuiltin(svc.id, act, svc.dir);
    if (!r.ok) {
      store.patchState(svc.id, { st: 'unknown', actionNote: '启动失败：内置动作不可用' });
      store.activity('w', 'WARN', svc.name + ' 启动失败：内置动作不可用 ' + (r.error ?? ''));
    }
  } else {
    // 修订 57：spawn 失败（如命令路径不存在 → ENOENT）立刻写入 actionNote，
    // 用户直接看到「命令不存在」而不是干等一个「启动超时」。
    const h = execAction(svc.id, act, svc.dir, () => { /* 退出由 probe 收敛 */ }, (err) => {
      if (store.tkOf(svc.id) !== tk) return;
      store.patchState(svc.id, { st: 'unknown', actionNote: '启动失败：' + err });
      store.activity('w', 'WARN', svc.name + ' 启动失败：' + err);
    });
    if (ctx) ctx.probe.registerOwnedPid(h.pid);
  }
  // 定向快探：等端口就绪（最多 timeoutMs）
  if (ctx) {
    ctx.probe.watchTarget(svc.id, svc, 'running', defaultTimeout(act), (patch) => {
      if (store.tkOf(svc.id) !== tk) return;
      store.patchState(svc.id, { ...patch, st: 'running', actionNote: undefined });
      store.activity('ok', 'OK', svc.name + ' 已就绪 · 端口 ' + svc.port + ' LISTEN');
    }, () => {
      if (store.tkOf(svc.id) !== tk) return;
      // 动作失败只写 actionNote，portNote 继续由 probe 表达端口真实状态；
      // 端口空闲时的启动失败不再被主页面当成端口冲突。
      // 修订 57：spawn 已报错时保留那条更具体的原因，不被「启动超时」覆盖。
      const prev = store.state(svc.id).actionNote ?? '';
      if (prev.startsWith('启动失败')) return;
      const next = '启动超时';
      store.patchState(svc.id, { st: 'unknown', actionNote: next });
      store.activity('w', 'WARN', svc.name + ' ' + next + '：端口 ' + svc.port + ' 未就绪，已恢复可操作状态');
    });
  }
}

/** 安全停止：stop 命令退出 → 定向探测确认端口释放 → 写 stopped */
export async function doStop(svc: ServiceDefinition): Promise<void> {
  const act = svc.cfg.acts.stop;
  const tk = store.bumpTk(svc.id);
  store.patchState(svc.id, { st: 'stopping', actionNote: undefined });
  store.activity('i', 'INFO', svc.name + ' 停止中：等待命令退出与端口释放');
  let stopOk = true;
  if (!act) {
    // 无 stop 命令 → killProcessTree
    await runBuiltin(svc.id, { type: 'builtin', builtin: 'killProcessTree', timeoutMs: 8000 }, svc.dir);
  } else if (act.type === 'builtin') {
    await runBuiltin(svc.id, act, svc.dir);
  } else {
    // 修订 57：与 doStart 同一兜底——存量配置里残留的占位符先展开再执行
    const r = await execAndWait(resolveAction(svc, act) as ActionSpec, svc.dir, defaultTimeout(act));
    stopOk = r.ok;
    if (!r.ok) store.activity('w', 'WARN', svc.name + ' 停止命令异常：' + (r.error ?? 'exit ' + r.code));
  }
  // 两段安全停止：确认端口已释放
  if (ctx) {
    ctx.probe.watchTarget(svc.id, svc, 'stopped', 10000, (patch) => {
      if (store.tkOf(svc.id) !== tk) return;
      store.patchState(svc.id, { ...patch, st: 'stopped', actionNote: undefined });
      store.activity(stopOk ? 'ok' : 'w', stopOk ? 'OK' : 'WARN',
        svc.name + (stopOk ? ' 已安全停止（命令已退出，端口 ' + svc.port + ' 已释放）' : ' 停止命令异常，端口 ' + svc.port + ' 已释放'));
    }, () => {
      if (store.tkOf(svc.id) !== tk) return;
      store.patchState(svc.id, { st: 'unknown', actionNote: '停止超时' });
      store.activity('w', 'WARN', svc.name + ' 停止超时：端口 ' + svc.port + ' 未确认释放，已恢复可操作状态');
    });
  }
}

/* ================= v2.39 稳定态守卫 ================= */

/** 主按钮：只在稳定态生效（修「停止中点停止却执行启动」反向 bug） */
export async function toggle(id: string): Promise<{ ok: boolean; reason?: string }> {
  const s = store.svc(id);
  if (!s) return { ok: false, reason: '服务不存在' };
  const st = store.state(id).st;
  if (IS_BUSY(st)) {
    return { ok: false, reason: st === 'starting' ? '启动尚未完成，请等待完成后再操作' : '停止尚未完成，请等待完成后再操作' };
  }
  if (st === 'running') { await doStop(s); return { ok: true }; }
  // 端口冲突只信「点击这一刻」的新鲜探测：已停止服务平时不参与心跳，
  // 无论是否带着旧 owner，都在启动前重新判定一次当前端口归属。
  if (ctx) await ctx.probe.refreshOne(s);
  const stt = store.state(id);
  // 刷新可能把 stopped 收敛为外部托管 running，此时按当前真实状态执行停止。
  if (stt.st === 'running') { await doStop(s); return { ok: true }; }
  if (stt.owner && stt.st === 'stopped') {
    return { ok: false, reason: '启动被拦截：端口 ' + s.port + ' 被 ' + stt.owner + '（PID ' + stt.ownerPid + '）占用' };
  }
  await doStart(s);
  return { ok: true };
}

/** 中断启动：杀掉正在启动的进程，将状态重置为 stopped，恢复可操作 */
export async function interruptStart(id: string): Promise<{ ok: boolean; reason?: string }> {
  const s = store.svc(id);
  if (!s) return { ok: false, reason: '服务不存在' };
  const st = store.state(id).st;
  if (st !== 'starting') return { ok: false, reason: '当前不在启动中，无需中断' };
  const killed = await interruptHandle(id);

  // 等待 1 秒，让被杀的进程有足够时间退出，避免状态判断过早
  await new Promise<void>(r => setTimeout(r, 1000));

  const stt = store.state(id).st;
  // 无论是否找到后台进程，都重置状态，让用户可以重新操作
  store.patchState(id, { st: 'stopped', actionNote: undefined });
  store.activity('i', 'INFO', s.name + ' 已中断启动');

  if (stt === 'running') {
    // 端口已被占用，说明启动进程已脱离控制独立运行（如 ES 等常驻服务 fork 子进程后父进程退出）
    return { ok: true, reason: '启动进程已终止，但服务可能已独立运行，建议点击「停止」按钮' };
  }
  return { ok: true, reason: killed ? undefined : '未找到后台进程，状态已重置' };
}

/** 重启：只在稳定态生效；stopped 直接 start（不再空跑 stop），running 走 stop→start */
export async function restart(id: string): Promise<{ ok: boolean; reason?: string }> {
  const s = store.svc(id);
  if (!s) return { ok: false, reason: '服务不存在' };
  const st = store.state(id).st;
  if (IS_BUSY(st)) {
    return { ok: false, reason: st === 'starting' ? '启动尚未完成，暂不可重启' : '停止尚未完成，暂不可重启' };
  }
  if (ctx && st !== 'running') await ctx.probe.refreshOne(s);
  const stt = store.state(id);
  if (stt.owner && stt.st === 'stopped') {
    return { ok: false, reason: '重启被拦截：端口 ' + s.port + ' 被 ' + stt.owner + '（PID ' + stt.ownerPid + '）占用' };
  }
  if (stt.st === 'stopped') {
    store.activity('i', 'INFO', s.name + ' 重启中：当前已停止，直接启动 · 等待端口 ' + s.port + ' 就绪…');
    await doStart(s);
    return { ok: true };
  }
  store.activity('i', 'INFO', s.name + ' 重启中：stop → 等端口释放 → start');
  await doStop(s);
  // 修订 40：端口未确认释放时不得带病拉起，否则必然端口冲突
  const released = await waitTerminal(s.id, 'stopped', 12000);
  if (!released) {
    store.activity('w', 'WARN', s.name + ' 重启中止：端口 ' + s.port + ' 未确认释放');
    return { ok: false, reason: '端口未确认释放，重启已中止' };
  }
  await doStart(s);
  return { ok: true };
}

/* ================= 执行链构建 ================= */

interface Lane { label: string; serial: boolean; items: ServiceDefinition[]; }

function blocks(): { gid: string | null; items: ServiceDefinition[] }[] {
  const out: { gid: string | null; items: ServiceDefinition[] }[] = [];
  const seen = new Set<string>();
  for (const s of store.services()) {
    if (s.gid) {
      if (seen.has(s.gid)) continue;
      seen.add(s.gid);
      out.push({ gid: s.gid, items: store.members(s.gid) });
    } else {
      out.push({ gid: null, items: [s] });
    }
  }
  return out;
}

function conflictOf(s: ServiceDefinition): boolean {
  const st = store.state(s.id);
  return !!(st.owner && st.st === 'stopped');
}

export function startAllLanes(): Lane[] {
  const out: Lane[] = [];
  for (const b of blocks()) {
    const items = b.items.filter(s => !pending.has(s.id) && !IS_BUSY(store.state(s.id).st) && store.state(s.id).st === 'stopped');
    if (!items.length) continue;
    if (b.gid) out.push({ label: '组合「' + (store.grp(b.gid)?.name ?? b.gid) + '」', items, serial: true });
    else items.forEach(s => out.push({ label: s.name, items: [s], serial: false }));
  }
  return out;
}

export function stopAllLanes(): Lane[] {
  const out: Lane[] = [];
  for (const b of blocks()) {
    const items = b.items.filter(s => !pending.has(s.id) && !IS_BUSY(store.state(s.id).st) && store.state(s.id).st === 'running');
    if (!items.length) continue;
    if (b.gid) out.push({ label: '组合「' + (store.grp(b.gid)?.name ?? b.gid) + '」倒序', items: items.slice().reverse(), serial: true });
    else items.forEach(s => out.push({ label: s.name, items: [s], serial: false }));
  }
  return out;
}

export function groupLanes(gid: string, isStart: boolean): Lane[] {
  const g = store.grp(gid);
  if (!g) return [];
  let ms = store.members(gid);
  if (!isStart) ms = ms.slice().reverse();
  const items = ms.filter(s => !pending.has(s.id) && !IS_BUSY(store.state(s.id).st) && store.state(s.id).st === (isStart ? 'stopped' : 'running'));
  if (!items.length) return [];
  return [{ label: '组合「' + g.name + '」', items, serial: true }];
}

/* ================= 执行链运行：完成驱动、每步重读状态、冲突终止所属链后续 ================= */

async function runLane(lane: Lane, isStart: boolean): Promise<void> {
  lane.items.forEach(s => pending.add(s.id));
  try {
    for (const svc of lane.items) {
      const cur = store.svc(svc.id);
      if (!cur) continue;
      const st = store.state(cur.id).st;
      if (isStart) {
        if (st !== 'stopped') continue;           // 执行中/已启动跳过，继续推进
        if (conflictOf(cur)) {                    // 端口冲突：终止本链后续
          const stt = store.state(cur.id);
          store.activity('w', 'WARN', '端口 ' + cur.port + ' 被 ' + (stt.owner ?? '?') + ' 占用，' + cur.name + ' 未启动，所属组合链后续不再执行');
          return;
        }
        await doStart(cur);
      } else {
        if (st !== 'running') continue;           // 执行中/已停止跳过
        await doStop(cur);
      }
      if (!lane.serial) return;                   // 并行单项链只跑一项，各泳道之间保持并行
      // 完成驱动：组合内等本项真正就绪 / 真正释放后，才推进下一项（自上而下 / 倒序）
      const okStep = await waitTerminal(
        cur.id,
        isStart ? 'running' : 'stopped',
        isStart ? defaultTimeout(cur.cfg.acts.start) + 2000 : 12000
      );
      if (!okStep) return;                        // 本项未在超时内收敛 → 终止本组合链后续
    }
  } finally {
    lane.items.forEach(s => pending.delete(s.id));
  }
}

export function runLanes(lanes: Lane[], isStart: boolean, label: string): void {
  const total = lanes.reduce((a, l) => a + l.items.length, 0);
  store.activity('i', 'INFO', label + ' · 共 ' + total + ' 项 / 未分组项与组合之间并行，组合内' + (isStart ? '自上而下' : '从下到上') + '串行');
  for (const lane of lanes) void runLane(lane, isStart);
}

/* ================= 二次确认计划（纯计算，不执行） ================= */

function lanePlan(lanes: Lane[]): LanePlanItem[] {
  return lanes.map(l => ({ label: l.label, serial: l.serial, items: l.items.map(s => s.name) }));
}

/**
 * v2.40：确认计划同时作为「点击前置守卫」的数据源。
 * 渲染器只在 actionable=true（本次确有可执行项）时弹二次确认；空列表、
 * 全部已在目标态、全部执行中、组合链在途、状态未就绪时一律不弹窗，
 * 改为一句精准提示，避免「将启动 0 项服务」这种无效确认框。
 */
export function buildConfirmPlan(kind: 'startAll' | 'stopAll'): ConfirmAllPlan {
  const stop = kind === 'stopAll';
  const all = store.services();
  const serviceCount = all.length;
  const lanes = stop ? stopAllLanes() : startAllLanes();
  const total = lanes.reduce((a, l) => a + l.items.length, 0);
  const serialLanes = lanes.filter(l => l.serial).length;
  const busy = all.filter(s => IS_BUSY(store.state(s.id).st));
  const inTarget = all.filter(s => store.state(s.id).st === (stop ? 'stopped' : 'running')).length;
  const conflicts: PortsConflictItem[] = stop ? [] : all
    .filter(s => conflictOf(s))
    .map(s => { const stt = store.state(s.id); return { id: s.id, port: s.port, owner: stt.owner ?? '?', ownerPid: stt.ownerPid ?? 0, gid: s.gid }; });

  const actionable = total > 0;
  let skipReason: ConfirmSkipReason | null = null;
  if (!actionable) {
    if (serviceCount === 0) skipReason = 'empty';
    else if (pending.size > 0) skipReason = 'in-flight';
    else if (busy.length === serviceCount) skipReason = 'all-busy';
    else if (inTarget === serviceCount) skipReason = 'no-target';
    else skipReason = 'not-ready';
  }

  return {
    stop,
    total,
    parallelCount: lanes.length - serialLanes,
    serialLanes,
    busyCount: busy.length,
    busyNames: busy.map(s => s.name),
    conflicts,
    lanes: lanePlan(lanes),
    serviceCount,
    actionable,
    skipReason
  };
}

/* ================= 高层动作入口 ================= */

export async function groupStart(gid: string): Promise<{ ok: boolean; reason?: string }> {
  const lanes = groupLanes(gid, true);
  if (!lanes.length) return { ok: false, reason: '组合内没有需要启动的成员' };
  runLanes(lanes, true, '顺序启动组合「' + (store.grp(gid)?.name ?? gid) + '」');
  return { ok: true };
}

export async function groupStop(gid: string): Promise<{ ok: boolean; reason?: string }> {
  const lanes = groupLanes(gid, false);
  if (!lanes.length) return { ok: false, reason: '组合内没有运行中的成员' };
  runLanes(lanes, false, '停止组合「' + (store.grp(gid)?.name ?? gid) + '」');
  return { ok: true };
}

export function startAll(): { ok: boolean; reason?: string } {
  const lanes = startAllLanes();
  if (!lanes.length) return { ok: false, reason: '当前没有需要启动的服务' };
  runLanes(lanes, true, '全部启动');
  return { ok: true };
}

export function stopAll(): { ok: boolean; reason?: string } {
  const lanes = stopAllLanes();
  if (!lanes.length) return { ok: false, reason: '当前没有运行中的服务' };
  runLanes(lanes, false, '全部停止');
  return { ok: true };
}
