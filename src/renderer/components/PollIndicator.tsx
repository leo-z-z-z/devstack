/* ============================================================
 * 服务列表标题栏 · 状态轮询可见指示器（v2.46）
 * 紧跟「按视觉顺序启动 / 停止」之后，只保留一个「双线脉搏」心电图图标：
 *   - 空闲（有已启动服务）：蓝色双波形
 *   - 刷新中：提亮一档（浅蓝底 + 波形加深），且主波形像监护仪走纸一样
 *     从左到右重画一次（stroke-dashoffset，约 600ms，整轮一次、完整不割裂）
 *   - 手动全量刷新：提亮再加深一档，与自动心跳可区分
 *   - 0 项已启动（自动刷新暂停）：波形灰化
 * 状态文案不常驻显示，放进 title + aria-label（hover / 读屏可读）。
 * 点击可手动全量刷新（含已停止组件）。data-cycles 暴露已完成轮次数，便于验收核对。
 * 注意：图标内联而非 sprite，因为走纸动画要给主波形 path 加类名，CSS 穿不透 <use>。
 * ============================================================ */
import { api } from '../api';
import { useI18n } from '../i18n-hook';
import { trN } from '../i18n';
import { PollStatus, pollLabel, pollSeconds } from '../poll';

export function PollIndicator({ poll, running }: { poll: PollStatus; running: number }): JSX.Element {
  const { t } = useI18n();
  const busy = poll.phase === 'busy';
  const standby = running <= 0;
  const sec = pollSeconds(poll.pollMs);
  const last = poll.lastAt ? new Date(poll.lastAt).toLocaleTimeString() : '';
  // 图标本身不带文字，状态一律放进 aria-label（读屏可用）。
  // 不再设 title：鼠标移上去不弹 tooltip，避免干扰。
  const label = pollLabel(poll, running, t, trN);
  const aria = label + ' · ' + t('自动探测已启动与已停止的组件；点击可全量刷新所有可操作服务') +
    (last ? ' · ' + t('上次刷新 {time}').replace('{time}', last) : '');

  return (
    <button
      type="button"
      className={'pollchip' + (busy ? ' busy' : '') + (standby ? ' stby' : '')}
      data-poll={busy ? 'busy' : 'idle'}
      data-mode={poll.mode}
      data-scope={busy ? poll.scope : running}
      data-interval={sec}
      data-cycles={poll.cycles}
      data-standby={standby ? '1' : '0'}
      onClick={() => void api.refreshStatus()}
      aria-label={aria}
    >
      <svg className="ekg" width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        {/* pathLength=1 归一化，CSS 用 dashoffset 1→0 让主波形每轮「重新画一遍」 */}
        <path className="ekg-main" pathLength="1"
          d="M1.9 6.6h2.1l1.3-2.8 2.2 5.5 1.6-2.9 1 .7h3"
          fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path className="ekg-sub"
          d="M1.9 11.2h1.9l1-1.7 1.9 3 1.3-1.9 .9 .5h3.1"
          fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
      </svg>
    </button>
  );
}
