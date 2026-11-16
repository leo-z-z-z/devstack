/* ============================================================
 * 全部启动 / 全部停止：点击前置守卫（v2.40）
 *
 * 规则：
 *   1) 列表服务数 <= 0 → 不弹窗（连确认计划都不必向主进程请求）
 *   2) 确认计划里 total <= 0 / actionable=false → 不弹窗
 *      （全部已在目标态、全部执行中、组合链在途、状态未就绪）
 *   3) 只有本次确有可执行项才弹二次确认
 *
 * 纯数据决策，不含任何文案；提示文案由 ServicesPage 在渲染边界过 t()。
 * 保持零运行时依赖，便于 Node 侧直接转译做单元测试。
 * ============================================================ */
import type { ConfirmAllPlan, ConfirmSkipReason } from '../shared/types';

export type ConfirmGuardReason = ConfirmSkipReason | 'ready' | 'not-ready';

export interface ConfirmGuard {
  open: boolean;
  reason: ConfirmGuardReason;
}

export function shouldOpenConfirm(serviceCount: number, plan: ConfirmAllPlan): ConfirmGuard {
  // 本地快照与后端计划任一为空，都按「列表无服务」处理，避免快照滞后误弹窗。
  // 对旧版主进程（计划里还没有新字段）做降级兼容，避免弹窗整体消失。
  const backendEmpty = typeof plan.serviceCount === 'number' && plan.serviceCount <= 0;
  if (serviceCount <= 0 || backendEmpty) return { open: false, reason: 'empty' };
  const actionable = typeof plan.actionable === 'boolean' ? plan.actionable : plan.total > 0;
  if (actionable && plan.total > 0) return { open: true, reason: 'ready' };
  return { open: false, reason: plan.skipReason ?? 'not-ready' };
}
