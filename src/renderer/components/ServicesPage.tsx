/* 服务主页：统计 + 异常条 + 服务/组合卡片列表 + 全部启停二次确认 + 拖拽排序 */
import { useMemo, useState } from 'react';
import { useUiState } from '../store';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { ServiceCard } from './ServiceCard';
import { GroupCard } from './GroupCard';
import { PollIndicator } from './PollIndicator';
import { Icon } from '../icons';
import { shouldOpenConfirm, ConfirmGuardReason } from '../guard';
import { ServiceDefinition, GroupDefinition, healthCategory } from '../../shared/types';

interface TopBlock { gid: string | null; items: ServiceDefinition[] }
interface ExceptionItem {
  s: ServiceDefinition;
  kind: 'action' | 'port';
  note?: string;
  owner?: string;
  ownerPid?: number;
}

export function ServicesPage(): JSX.Element {
  const { snapshot, poll } = useUiState();
  const { t } = useI18n();
  const ui = useUi();
  const [confOpen, setConfOpen] = useState(false);

  const services = snapshot?.services ?? [];
  const groups = snapshot?.groups ?? [];
  const states = snapshot?.states ?? {};

  /* ---------- 顶层块模型 ---------- */
  const blocks = useMemo<TopBlock[]>(() => {
    const out: TopBlock[] = [];
    const seen = new Set<string>();
    for (const s of services) {
      if (s.gid) {
        if (seen.has(s.gid)) continue;
        seen.add(s.gid);
        out.push({ gid: s.gid, items: services.filter(x => x.gid === s.gid) });
      } else {
        out.push({ gid: null, items: [s] });
      }
    }
    return out;
  }, [services]);

  /* ---------- 统计：运行中 + 已停止 + 异常 = 总服务数（healthCategory 单一分类来源） ---------- */
  const stats = useMemo(() => {
    let run = 0, starting = 0, stopping = 0, stopped = 0;
    const exceptions: ExceptionItem[] = [];
    for (const s of services) {
      const o = states[s.id];
      const rawSt = o?.st ?? 'unknown';
      if (rawSt === 'starting') starting++;
      else if (rawSt === 'stopping') stopping++;
      const category = healthCategory(o);
      if (category === 'running') run++;
      else if (category === 'stopped') stopped++;
      else if (o?.actionNote) {
        exceptions.push({ s, kind: 'action', note: o.actionNote, owner: o.owner, ownerPid: o.ownerPid });
      } else {
        exceptions.push({ s, kind: 'port', owner: o?.owner, ownerPid: o?.ownerPid });
      }
    }
    return { run, starting, stopping, stopped, exceptions };
  }, [services, states]);

  /* 自动轮询会探测 running + stopped，用于 PollIndicator 的空闲/忙碌判据 */
  const autoCount = useMemo(() => services.filter(s => {
    const st = states[s.id]?.st ?? 'unknown';
    return st === 'running' || st === 'stopped';
  }).length, [services, states]);

  /* ---------- 全部启停按钮的「无可操作项」弱化态（本地估算；权威判定交给主进程确认计划） ---------- */
  const startEligible = services.filter(s => (states[s.id]?.st ?? 'unknown') === 'stopped').length;
  const stopEligible = services.filter(s => (states[s.id]?.st ?? 'unknown') === 'running').length;
  const startIdle = services.length === 0 || startEligible === 0;
  const stopIdle = services.length === 0 || stopEligible === 0;

  /* ---------- 搜索过滤 ---------- */
  const q = ui.search.trim().toLowerCase();
  const match = (s: ServiceDefinition) =>
    !q || (s.name + ' ' + (s.sub ?? '') + ' ' + s.port).toLowerCase().includes(q);

  const visibleBlocks = useMemo(() => {
    if (!q) return blocks;
    return blocks.filter(b => {
      if (b.gid) {
        const g = groups.find(x => x.id === b.gid);
        const nameHit = g && g.name.toLowerCase().includes(q);
        return nameHit || b.items.some(match);
      }
      return b.items.some(match);
    });
  }, [blocks, q, groups]);

  /* ---------- 全部启停：先守卫，再决定是否弹二次确认 ---------- */
  const onStartAll = () => openConfirm('startAll');
  const onStopAll = () => openConfirm('stopAll');

  /** 不弹窗时的一句话说明。
   *  返回简体原文（不在此处翻译）：toast 通道在 App 统一过 t()，
   *  若在此预翻译，切换语言后 toast 会残留旧语种（双重翻译）。 */
  function guardText(reason: ConfirmGuardReason, kind: 'startAll' | 'stopAll'): string {
    if (reason === 'empty') return '服务列表为空，请先添加服务。';
    if (reason === 'all-busy') return '所有服务正在启动或停止中，请等待完成后再操作。';
    if (reason === 'in-flight') return '组合串行链正在执行中，请等待本次调度完成。';
    if (reason === 'not-ready') return '当前服务状态尚未就绪，请等待探测完成后再操作。';
    return kind === 'startAll' ? '所有服务已在运行中，无需再次启动。' : '所有服务均已停止，无需再次停止。';
  }

  async function openConfirm(kind: 'startAll' | 'stopAll'): Promise<void> {
    // 守卫 1：列表服务数不大于 0，不必请求计划，更不必弹确认框
    if (services.length <= 0) {
      ui.toast(guardText('empty', kind));
      return;
    }
    const plan = await api.buildConfirmPlan(kind);
    // 守卫 2：本次没有任何可执行项 → 不弹窗，改为精准提示
    const guard = shouldOpenConfirm(services.length, plan);
    if (!guard.open) {
      ui.toast(guardText(guard.reason, kind));
      return;
    }
    const stop = plan.stop;
    const msg = stop
      ? `将停止 <b>${plan.total}</b> 项运行中的服务：<b>${plan.parallelCount}</b> 项未分组组件并行安全停止；<b>${plan.serialLanes}</b> 个组合各自按组内从下到上倒序串行、等停止命令退出并确认端口释放后才停下一项，组合之间并行；不会强制杀进程。`
      : `将启动 <b>${plan.total}</b> 项已停止的服务：<b>${plan.parallelCount}</b> 项未分组组件并行发起；<b>${plan.serialLanes}</b> 个组合各自按组内自上而下串行、等上一项就绪再启动下一项，组合之间并行。`;
    let detail = plan.lanes.map(l =>
      (l.serial ? '串行链 ' : '并行 ') + l.label + '：' + l.items.join(' → ')
    ).join('<br>');
    if (plan.busyCount) detail += `<br>本次跳过 ${plan.busyCount} 项执行中（${plan.busyNames.slice(0, 3).join('、')}${plan.busyCount > 3 ? ' 等 ' + plan.busyCount + ' 项' : ''}），不纳入本次调度`;
    if (!stop && plan.conflicts.length) {
      detail += `<br>端口冲突 ${plan.conflicts.length} 项：` + plan.conflicts.slice(0, 3).map(c => `${c.id} :${c.port}`).join('、') + (plan.conflicts.length > 3 ? ` 等 ${plan.conflicts.length} 项` : '') + ' · 该项不启动，所属组合链后续项不再执行';
    }
    ui.openModal({
      kind: 'confirm',
      title: stop ? '全部停止 · 二次确认' : '全部启动 · 二次确认',
      body: msg,
      okText: stop ? '确认全部停止' : '确认全部启动',
      danger: stop,
      detail,
      onOk: () => {
        void (stop ? api.stopAll() : api.startAll()).then(r => {
          if (!r.ok) ui.toast(r.reason ?? '已提交');
        });
      }
    });
  }

  /* ---------- 拖拽 ---------- */
  const onDragMove = async (args: {
    kind: 'block' | 'member';
    srcGid: string | null; srcSvcId: string;
    dstGid: string | null; dstSvcId: string; before: boolean;
  }): Promise<void> => {
    if (q) { ui.toast('搜索结果里无法重排顺序，请先清空搜索词'); return; }
    if (args.kind === 'block') {
      const r = await api.moveBlock(args);
      ui.toast(r === 1 ? '启动顺序已更新' : (r === 0 ? '位置未改变，顺序保持不变' : '该位置无法移动：空组合请先添加成员再调整位置'));
    } else {
      const r = await api.moveMemberInGroup({ gid: args.srcGid!, srcId: args.srcSvcId, dstId: args.dstSvcId, before: args.before });
      ui.toast(r === 1 ? '组内顺序已更新' : (r === 0 ? '位置未改变，顺序保持不变' : '无法移动：目标不在本组内'));
    }
  };

  if (!snapshot) return <div className="page">{t('加载中…')}</div>;

  const issues = stats.exceptions;
  return (
    <div className="page">
      <div className="stats">
        <div className="stat">
          <div className="lb"><span className="dot" style={{ background: '#1CB97A' }} />{t('运行中')}</div>
          <div className="num">{stats.run}</div>
          <div className="hint">{stats.starting + stats.stopping ? t(`${stats.starting} 项启动中${stats.stopping ? ' · ' + stats.stopping + ' 项停止中' : ''}`) : '—'}</div>
        </div>
        <div className="stat">
          <div className="lb"><span className="dot" style={{ background: '#B4BCC8' }} />{t('已停止')}</div>
          <div className="num">{stats.stopped}</div>
          <div className="hint">{t(`共 ${services.length} 项服务 · ${groups.length} 个组合`)}</div>
        </div>
        <div className="stat clickable" onClick={() => issues.length && setConfOpen(v => !v)} title={t('点击查看全部异常')}>
          <div className="lb"><span className="dot" style={{ background: '#E2574C' }} />{t('异常')}</div>
          <div className="num">{issues.length}</div>
          <div className="hint">{issues.length ? t(`${issues.length} 项待处理 · 点击查看`) : t('无异常')}</div>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="confwrap">
          <div className="banner" onClick={() => setConfOpen(v => !v)} title={t('点击展开 / 收起异常详情')}>
            <span className="dot" style={{ background: '#E2574C' }} />
            <span className="bcount">{t(`${issues.length} 项异常`)}</span>
            <span className="btext">
              {issues[0].kind === 'action'
                ? <>{issues[0].s.name}{' · '}{t(issues[0].note ?? '')}</>
                : <>{t('端口')} {issues[0].s.port} {t('被')} {issues[0].owner}{t('（PID ')}{issues[0].ownerPid}{t('）占用')}</>}
              {issues.length > 1 ? t(` · 另有 ${issues.length - 1} 项`) : ''}
            </span>
            <span className="blink">{t(confOpen ? '收起 ▴' : '查看全部 ▾')}</span>
          </div>
          {confOpen && (
            <div className="confpop">
              {issues.map(issue => (
                <div className="cfrow" key={issue.s.id}>
                  <span className="cfn">{issue.s.name}</span>
                  <span className="cfp mono">:{issue.s.port}</span>
                  <span className="cfo">
                    {issue.kind === 'action'
                      ? t(issue.note ?? '')
                      : t('端口冲突') + ' · ' + issue.owner + ' · PID ' + issue.ownerPid}
                  </span>
                  <span className="cfg">{issue.s.gid ? (groups.find(g => g.id === issue.s.gid)?.name ?? '') : t('未分组')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="panel">
        <div className="panelhead">
          <h2>{t('服务列表')}</h2>
          <span className="sub">{t('按视觉顺序启动 / 停止')}</span>
          <PollIndicator poll={poll} running={autoCount} />
          <div className="tools">
            <button
              className={'btn primary' + (startIdle ? ' guard-idle' : '')}
              data-guard={startIdle ? 'idle' : 'ready'}
              onClick={onStartAll}
              title={startIdle ? t(guardText(services.length ? 'no-target' : 'empty', 'startAll')) : t('未分组组件并行启动，组合内自上而下串行')}
            >
              <Icon id="iP" size={11} />{t('全部启动')}
            </button>
            <button
              className={'btn' + (stopIdle ? ' guard-idle' : '')}
              data-guard={stopIdle ? 'idle' : 'ready'}
              onClick={onStopAll}
              title={stopIdle ? t(guardText(services.length ? 'no-target' : 'empty', 'stopAll')) : t('未分组组件并行停止，组合内从下到上倒序安全停止')}
            >
              <Icon id="iS" size={11} />{t('全部停止')}
            </button>
            <button className="btn" onClick={() => ui.openModal({ kind: 'editor', service: null })}>
              {t('添加服务')}
            </button>
            <button className="btn" onClick={() => ui.openModal({ kind: 'group', group: null })}>
              {t('分组管理')}
            </button>
          </div>
        </div>
        <div id="cards">
          {visibleBlocks.length === 0 && (
            <div className="empty">{q ? t('没有匹配的服务或组合，清空搜索词即可显示全部。') : t('暂无服务，点「添加服务」创建。')}</div>
          )}
          {visibleBlocks.map(b => b.gid ? (
            <GroupCard key={b.gid} gid={b.gid} items={b.items} states={states} group={groups.find(g => g.id === b.gid)} onDragMove={onDragMove} />
          ) : (
            <ServiceCard key={b.items[0].id} s={b.items[0]} st={states[b.items[0].id]} seq={0} onDragMove={onDragMove} />
          ))}
        </div>
      </section>
    </div>
  );
}
