/* 服务卡：状态点 + 名称 + 副行 + 端口区 + 动作按钮组 + 主按钮 */
import { useState, useRef, useEffect } from 'react';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { Icon } from '../icons';
import { ServiceDefinition, RuntimeState } from '../../shared/types';

const STC: Record<string, { c: string; tag: string }> = {
  running: { c: '#1CB97A', tag: '' },
  starting: { c: '#F2A33A', tag: '启动中' },
  stopping: { c: '#F2A33A', tag: '停止中' },
  stopped: { c: '#B4BCC8', tag: '已停止' },
  unknown: { c: '#B4BCC8', tag: '检测中' }
};

interface DragMoveArgs {
  kind: 'block' | 'member';
  srcGid: string | null; srcSvcId: string;
  dstGid: string | null; dstSvcId: string; before: boolean;
}

export function serviceUrl(s: ServiceDefinition): string {
  if (s.webUrl && s.webUrl !== 'disabled') return s.webUrl;
  return 'http://127.0.0.1:' + (s.webPort || s.port);
}

export function ServiceCard({ s, st, seq, onDragMove }: {
  s: ServiceDefinition;
  st: RuntimeState | undefined;
  seq: number;
  onDragMove: (a: DragMoveArgs) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const ui = useUi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const btnMoreRef = useRef<HTMLButtonElement>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [interruptBusy, setInterruptBusy] = useState(false);
  const [dragOver, setDragOver] = useState<'before' | 'after' | null>(null);

  /* 点击页面其他区域关闭菜单 */
  useEffect(() => {
    const onDocumentClick = (e: MouseEvent) => {
      if (!menuOpen) return;
      const target = e.target as HTMLElement;
      if (btnMoreRef.current && btnMoreRef.current.contains(target)) return;
      // 菜单是 fixed 定位，不在 btnMoreRef 内部，直接关闭
      setMenuOpen(false);
    };
    document.addEventListener('click', onDocumentClick, true);
    return () => document.removeEventListener('click', onDocumentClick, true);
  }, [menuOpen]);

  const state = st?.st ?? 'unknown';
  const on = state === 'running' || state === 'stopping';
  const err = !!(st?.owner && state === 'stopped');   // 只有真实占用者才算端口冲突
  const actionFail = !!st?.actionNote;                 // 启动/停止失败是独立语义
  const x = STC[state] ?? STC.unknown;
  const busy = state === 'starting' || state === 'stopping';

  const mainTitle = state === 'starting' ? '启动尚未完成，请等待完成后再操作'
    : state === 'stopping' ? '停止尚未完成，请等待完成后再操作'
    : (on ? '停止' : '启动');
  const rstTitle = state === 'starting' ? '启动尚未完成，暂不可重启'
    : state === 'stopping' ? '停止尚未完成，暂不可重启'
    : '重启';

  // 副行里的中文片段单独过 t()，用户自填的 sub / dir 不参与替换
  const sub = state === 'starting'
    ? (s.sub ?? '') + ' · ' + t('等待 ') + s.port + t(' 就绪')
    : state === 'stopping'
      ? (s.sub ?? '') + ' · ' + t('停止命令执行中，等待端口释放')
      : (s.sub ?? '') + ' · ' + s.dir;

  const pmainText = ':' + (s.webUrl && s.webUrl !== 'disabled' ? (s.webPort || s.port) : s.port);
  const pnote = () => {
    if (state === 'running') return (st?.pid ? 'PID ' + st.pid : '') + (st?.uptime ? ' · ' + st.uptime : '');
    return st?.portNote ?? (err ? '被占用' : '空闲');
  };

  const onToggle = async () => {
    setToggleBusy(true);
    try {
      const r = await api.toggleService(s.id);
      if (!r.ok && r.reason) ui.toast(r.reason);
    } finally {
      setToggleBusy(false);
    }
  };
  const onInterruptStart = async () => {
    setInterruptBusy(true);
    try {
      const r = await api.interruptStart(s.id);
      if (r.ok) {
        ui.toast(r.reason ? s.name + '：' + r.reason : s.name + '已中断启动');
      } else {
        ui.toast(r.reason ?? '中断失败');
      }
    } catch (e) {
      ui.toast(s.name + ' 中断启动异常：' + String(e));
    } finally {
      setInterruptBusy(false);
    }
  };
  const onRestart = async () => {
    const r = await api.restartService(s.id);
    if (!r.ok && r.reason) ui.toast(r.reason);
  };

  const url = serviceUrl(s);
  const portClickable = state === 'running' && s.webUrl !== 'disabled';

  /* ---------- 拖拽 ---------- */
  const dragKind: 'block' | 'member' = s.gid ? 'member' : 'block';
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind: dragKind, gid: s.gid, id: s.id }));
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
    if (!data) return;
    if (data.kind === 'member' && data.gid !== s.gid) { ui.toast('组内成员仅可在本组内调整顺序；跨组请用 ⋯ → 移入组合'); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    await onDragMove({
      kind: data.kind as 'block' | 'member',
      srcGid: data.gid, srcSvcId: data.id,
      dstGid: s.gid, dstSvcId: s.id, before
    });
  };

  return (
    <div
      className={'svc' + (err ? ' conflict' : '') + (actionFail ? ' actionfail' : '') + (dragOver ? ' drop-' + dragOver : '')}
      data-id={s.id}
      data-gid={s.gid ?? undefined}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(null)}
      onDrop={onDrop}
    >
      <span className="grip" draggable title={s.gid ? t('拖动调整组内顺序（仅限本组）') : t('拖动调整启动顺序')} onDragStart={onDragStart}>
        <Icon id="iG" size={12} />
      </span>
      {seq > 0 && <span className="seq">{String(seq).padStart(2, '0')}</span>}
      <div className="svcinfo">
        <div className="line1">
          <span className="dot" style={{ background: x.c }} />
          <a className="sname" onClick={() => ui.openModal({ kind: 'editor', service: s })}>{s.name}</a>
          {x.tag && <span className={'tag' + (busy ? ' warn' : '')}>{t(x.tag)}</span>}
          {actionFail && <span className="tag fail" title={t(st?.actionNote ?? '')}>{t(st?.actionNote ?? '')}</span>}
        </div>
        <div className="line2 mono">{sub}</div>
      </div>
      <div className="portbox">
        {portClickable
          ? <a className="portlink" title={url} onClick={() => void api.openUrl(url)}>{pmainText} ↗</a>
          : <span className={'portplain' + (err ? ' err' : '')}>{pmainText}</span>}
        <div className={'portnote mono' + (err ? ' err' : '')}>{t(pnote())}</div>
      </div>
      <div className="acts">
        <button className="iconbtn" title={t('打开目录')} onClick={() => void api.openDir(s.dir)}><Icon id="iF" size={13} /></button>
        <button className="iconbtn" title={t('启动日志')} onClick={() => void openLog()}><Icon id="iL" size={13} /></button>
        <button className="iconbtn" title={t(rstTitle)} onClick={() => void onRestart()}><Icon id="iR" size={13} /></button>
        <button ref={btnMoreRef} className="iconbtn" title={t('更多')} onClick={(e) => {
          e.stopPropagation();
          if (menuOpen) { setMenuOpen(false); return; }
          const btn = btnMoreRef.current;
          if (btn) {
            const rect = btn.getBoundingClientRect();
            setMenuPosition({ top: rect.bottom + 6, left: rect.right - 154 });
          }
          setMenuOpen(true);
        }}><Icon id="iM" size={13} /></button>
        <button className={'btn js-toggle' + (on ? '' : ' primary') + (busy || toggleBusy ? ' btn-busy' : '')} disabled={busy || toggleBusy} title={t(mainTitle)} onClick={() => void onToggle()}>
          <Icon id={on ? 'iS' : 'iP'} size={11} />{busy || toggleBusy ? t('操作中…') : t(on ? '停止' : '启动')}
        </button>
        {state === 'starting' && <button className="btn danger" disabled={interruptBusy} onClick={() => void onInterruptStart()} title={t('中断启动')}>{interruptBusy ? t('中断中…') : t('中断启动')}</button>}
      </div>
      {menuOpen && menuPosition && (
        <div className="menu" style={{ top: menuPosition.top, left: menuPosition.left }} onMouseLeave={() => setMenuOpen(false)}>
          <div data-m="edit" onClick={() => { setMenuOpen(false); ui.openModal({ kind: 'editor', service: s }); }}>{t('编辑配置')}</div>
          <div data-m="move" onClick={() => { setMenuOpen(false); ui.openModal({ kind: 'move', service: s }); }}>{t('移入组合…')}</div>
          {s.gid && <div data-m="leave" onClick={async () => { setMenuOpen(false); await api.moveToGroup(s.id, null); ui.toast(s.name + ' 已移出组合'); }}>{t('移出组合')}</div>}
          <div data-m="del" className="danger" onClick={() => {
            setMenuOpen(false);
            ui.openModal({
              kind: 'confirm',
              title: '删除服务',
              body: `删除「<b>${s.name}</b>」后将从 services.yaml 移除，端口与命令配置一并清除，不可恢复。`,
              okText: '确认删除',
              danger: true,
              onOk: () => { void api.removeService(s.id); ui.toast(s.name + ' 已删除'); }
            });
          }}>{t('删除服务')}</div>
        </div>
      )}
    </div>
  );

  async function openLog(): Promise<void> {
    const lines = await api.getServiceLog(s.id);
    ui.openDrawer({ title: s.name + ' · 启动日志', chip: 'stdout', lines });
  }
}
