/* 前端 store：订阅后端事件，维护单一状态快照 */
import { useSyncExternalStore } from 'react';
import { api, Snapshot, StoreEvent, LogLine } from './api';
import { RuntimeState } from '../shared/types';
import { INITIAL_POLL, PollStatus } from './poll';

export interface UiState {
  snapshot: Snapshot | null;
  activity: LogLine[];
  serviceLogs: Record<string, LogLine[]>;
  ready: boolean;
  /** v2.41：轮询轮次状态，驱动服务列表标题栏的刷新指示器 */
  poll: PollStatus;
}

let state: UiState = {
  snapshot: null, activity: [], serviceLogs: {}, ready: false, poll: { ...INITIAL_POLL }
};
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(l => l());
}

function setState(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  emit();
}

function handleEvent(ev: StoreEvent): void {
  if (ev.type === 'poll-cycle') {
    const c = ev.cycle;
    const p = state.poll;
    if (c.phase === 'begin') {
      setState({ poll: { ...p, phase: 'busy', mode: c.mode, scope: c.scope, seq: c.seq, pollMs: c.pollMs } });
    } else if (c.seq === p.seq) {
      // 过期 end 直接忽略，否则会把下一轮的「刷新中」提前抹掉
      setState({ poll: { ...p, phase: 'idle', scope: c.scope, seq: c.seq, pollMs: c.pollMs, lastAt: c.ts, cycles: p.cycles + 1 } });
    }
  } else if (ev.type === 'service-status') {
    const snap = state.snapshot;
    if (!snap) return;
    setState({ snapshot: { ...snap, states: { ...snap.states, [ev.id]: ev.state as RuntimeState } } });
  } else if (ev.type === 'config-changed') {
    void refresh();
  } else if (ev.type === 'activity') {
    setState({ activity: [...state.activity, { ts: '', level: ev.level, tag: ev.tag, msg: ev.msg }].slice(-500) });
  } else if (ev.type === 'service-log') {
    const cur = state.serviceLogs[ev.id] ?? [];
    setState({ serviceLogs: { ...state.serviceLogs, [ev.id]: [...cur, ev.line].slice(-500) } });
  }
}

export async function refresh(): Promise<void> {
  const snap = await api.getSnapshot();
  // 设置页改间隔会触发 config-changed，这里同步指示器显示的秒数
  setState({ snapshot: snap, ready: true, poll: { ...state.poll, pollMs: snap.settings.pollMs } });
}

export async function initStore(): Promise<void> {
  await refresh();
  const act = await api.getActivityLog();
  setState({ activity: act });
  api.onStoreEvent(handleEvent);
}

export function useUiState(): UiState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => state,
    () => state
  );
}
