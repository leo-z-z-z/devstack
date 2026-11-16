/* 组合卡：组头（折叠 + 聚合状态 + 组级按钮）+ 成员卡（缩进 + 序号） */
import { useState } from 'react';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { Icon } from '../icons';
import { ServiceCard } from './ServiceCard';
import { ServiceDefinition, GroupDefinition, RuntimeState } from '../../shared/types';

interface DragMoveArgs {
  kind: 'block' | 'member';
  srcGid: string | null; srcSvcId: string;
  dstGid: string | null; dstSvcId: string; before: boolean;
}

export function GroupCard({ gid, items, states, group, onDragMove }: {
  gid: string;
  items: ServiceDefinition[];
  states: Record<string, RuntimeState>;
  group: GroupDefinition | undefined;
  onDragMove: (a: DragMoveArgs) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const ui = useUi();
  const [dragOver, setDragOver] = useState<'before' | 'after' | null>(null);

  const g = group;
  const name = g?.name ?? gid;
  const expanded = g ? !g.collapsed : true;

  const runCount = items.filter(s => ['running', 'starting', 'stopping'].includes(states[s.id]?.st)).length;
  const allRun = items.length > 0 && runCount === items.length;
  const aggText = items.length === 0 ? '空组合 · 待添加成员'
    : runCount === 0 ? '全部停止'
    : runCount === items.length ? '全部运行'
    : runCount + '/' + items.length + ' 运行中';

  const ports = items.map(s => s.port).join(' → ');

  const onToggleFold = async () => {
    if (!g) return;
    await api.toggleGroupCollapsed(gid, !g.collapsed);
  };

  const onGroupStart = async () => {
    const r = await api.groupStart(gid);
    if (!r.ok && r.reason) ui.toast(r.reason);
  };
  const onGroupStop = async () => {
    const r = await api.groupStop(gid);
    if (!r.ok && r.reason) ui.toast(r.reason);
  };

  /* ---------- 组块拖拽 ---------- */
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'block', gid, id: items[0]?.id ?? '' }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOver(e.clientY < r.top + r.height / 2 ? 'before' : 'after');
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    let data: { kind: string; gid: string | null; id: string } | null = null;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!data || data.kind !== 'block') return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    await onDragMove({ kind: 'block', srcGid: data.gid, srcSvcId: data.id, dstGid: gid, dstSvcId: items[0]?.id ?? '', before });
  };

  return (
    <div className={'grp' + (dragOver ? ' drop-' + dragOver : '')} data-gid={gid} onDragOver={onDragOver} onDragLeave={() => setDragOver(null)} onDrop={onDrop}>
      <div className={'grph' + (expanded ? '' : ' folded')}>
        <span className="grip" draggable title={t('拖动整个组合调整启动顺序')} onDragStart={onDragStart}>
          <Icon id="iG" size={12} />
        </span>
        <button className="iconbtn" onClick={() => void onToggleFold()} title={expanded ? t('折叠组合') : t('展开组合')}>
          <Icon id={expanded ? 'iD' : 'iN'} size={13} />
        </button>
        <span className="gname" onClick={() => void onToggleFold()}>{name}</span>
        <span className="gtag">{t(`组合 · ${items.length} 项`)}</span>
        <span className="gstat"><span className="dot" style={{ background: runCount === 0 ? '#B4BCC8' : (runCount === items.length ? '#1CB97A' : '#F2A33A') }} />{t(aggText)}</span>
        {!expanded && <span className="gports mono">{ports}</span>}
        <div className="gtools">
          {allRun
            ? <button className="btn" onClick={() => void onGroupStop()} title={t('按组内逆序逐个停止，等停止命令退出且端口释放后再停下一个')}><Icon id="iS" size={11} />{t('停止组')}</button>
            : <button className="btn primary" onClick={() => void onGroupStart()} title={t('按组内自上而下顺序逐个启动，等上一项就绪再启动下一项')}><Icon id="iP" size={11} />{t('启动组')}</button>}
          <button className="btn danger" onClick={() => {
            ui.openModal({
              kind: 'confirm',
              title: '解散组合',
              body: `解散「<b>${name}</b>」后，${items.length} 个成员会回到平铺列表，<b>服务不会被删除</b>，命令与端口配置全部保留。`,
              okText: '确认解散',
              danger: true,
              onOk: () => { void api.dissolveGroup(gid); ui.toast('组合已解散，成员已回到平铺列表'); }
            });
          }}>{t('解散组合')}</button>
        </div>
      </div>
      {expanded && (
        <div className="grpm">
          {items.length === 0 && <div className="empty" style={{ padding: 16 }}>{t('暂无成员 · 用「⋯ → 编辑组合 / 添加成员」加入服务')}</div>}
          {items.map((s, i) => (
            <ServiceCard key={s.id} s={s} st={states[s.id]} seq={i + 1} onDragMove={onDragMove} />
          ))}
        </div>
      )}
    </div>
  );
}
