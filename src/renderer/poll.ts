/* ============================================================
 * v2.41 状态轮询可见性：纯数据模型 + 文案决策
 * 不依赖 React / Electron，便于在 Node 单测里直接用真实 i18n 验证 9 语。
 * ============================================================ */

export interface PollStatus {
  phase: 'busy' | 'idle';
  /** auto = 周期刷新（范围仅已启动组件）；manual = 点击后的全量刷新 */
  mode: 'auto' | 'manual';
  /** 最近一轮实际探测的服务数 */
  scope: number;
  /** 当前轮次序号：只接受最新一轮的 end，丢弃被延迟的旧 end */
  seq: number;
  pollMs: number;
  /** 上次刷新完成时间戳 */
  lastAt: number;
  /** 已完成轮次数 */
  cycles: number;
}

export const INITIAL_POLL: PollStatus = {
  phase: 'idle', mode: 'auto', scope: 0, seq: 0, pollMs: 3000, lastAt: 0, cycles: 0
};

/** 设置页的 1000/3000/5000 毫秒 → 「1 / 3 / 5 秒」 */
export function pollSeconds(pollMs: number): string {
  const s = pollMs / 1000;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

/**
 * 标题栏指示器的文案。所有中文都通过 t() 过渲染边界，
 * 数字与秒数以 {n} / {s} 占位符在译文里替换，避免拼接出不可译的动态句子。
 *
 * @param tn 可选的「带数量整句翻译」函数（i18n.trN）。这类整句的数字在译文里是
 *           {n} 占位符，渲染边界看不到真实数字，复数层无法自动判断，
 *           需要调用方显式把数量交给 tn 才能选出单数 / 复数形态。
 */
export function pollLabel(
  p: PollStatus, running: number,
  t: (s: string) => string,
  tn?: (s: string, n: number) => string
): string {
  const sec = pollSeconds(p.pollMs);
  const counted = (key: string): string => {
    const s = tn ? tn(key, p.scope) : t(key);
    return s.replace('{n}', String(p.scope));
  };
  // 刷新中优先显示「本轮真实探测数」（手动全量刷新即使 0 项也照实显示）
  if (p.phase === 'busy') {
    return p.mode === 'manual'
      ? counted('正在全量刷新 {n} 项服务')
      : counted('正在刷新 {n} 项服务');
  }
  // v2.43：标题栏只保留主状态，不再重复顶部统计卡已有的「已启动 N 项」
  if (running <= 0) return t('自动刷新已暂停');
  return t('每 {s} 秒自动刷新').replace('{s}', sec);
}
