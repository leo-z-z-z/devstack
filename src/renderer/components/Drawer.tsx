/* 日志抽屉：关键字过滤 + 级别筛选 + 自动跟随 + 放大 */
import { useMemo, useState, useRef, useEffect } from 'react';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { Icon } from '../icons';
import { LogLine } from '../api';

const LVS: [string, string][] = [['all', '全部'], ['i', 'INFO'], ['w', 'WARN'], ['ok', 'OK']];

export function Drawer(): JSX.Element {
  const { drawer, closeDrawer, toggleDrawerWide } = useUi();
  const { t } = useI18n();
  const [kw, setKw] = useState('');
  const [lv, setLv] = useState('all');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  const rows = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return drawer.lines.filter(l => {
      if (lv !== 'all' && l.level !== lv) return false;
      if (k && !(l.tag + ' ' + l.msg).toLowerCase().includes(k)) return false;
      return true;
    });
  }, [drawer.lines, kw, lv]);

  useEffect(() => {
    if (stick && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [rows.length, stick]);

  useEffect(() => { setKw(''); setLv('all'); setStick(true); }, [drawer.title]);

  if (!drawer.open) return <></>;

  return (
    <>
      {/* 点击遮罩层关闭抽屉 */}
      <div
        className="drawer-backdrop"
        onClick={closeDrawer}
      />
      <div
        className={'drawer' + (drawer.open ? ' on' : '') + (drawer.wide ? ' wide' : '')}
      >
      <div className="drawerhead">
        <h3>{t(drawer.title)}</h3>
        <span className="chip">{t(drawer.chip)}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="iconbtn" title={t(drawer.wide ? '还原' : '放大')} onClick={toggleDrawerWide}>
            <Icon id={drawer.wide ? 'iV' : 'iU'} size={13} />
          </button>
          <button className="iconbtn" title={t('关闭')} onClick={closeDrawer}><Icon id="iX" size={13} /></button>
        </div>
      </div>
      <div className="drawerbody">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <div className="search" style={{ width: 180 }}>
            <Icon id="iQ" size={12} />
            <input value={kw} onChange={e => setKw(e.target.value)} placeholder={t('过滤日志关键字')} />
          </div>
          <div>
            {LVS.map(([v, label]) => (
              <span key={v} className={'lvbtn' + (lv === v ? ' on' : '')} onClick={() => setLv(v)}>{t(label)}</span>
            ))}
          </div>
          <span className="mono" style={{ fontSize: 11, color: '#94A3B8' }}>{t(`命中 ${rows.length} / ${drawer.lines.length} 行`)}</span>
        </div>
        <div
          className="term"
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
        >
          {rows.length === 0 && <div style={{ color: '#5C708C', padding: '24px 4px', textAlign: 'center' }}>{t('暂无日志行')}</div>}
          {rows.map((l, i) => (
            <div className="termrow" key={i}>
              <span className="ts">{l.ts}</span>
              <span className={'lv ' + l.level}>{l.tag}</span>
              {hl(t(l.msg), kw)}
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  );
}

function hl(text: string, kw: string): React.ReactNode {
  if (!kw.trim()) return text;
  const k = kw.trim();
  const idx = text.toLowerCase().indexOf(k.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="hl">{text.slice(idx, idx + k.length)}</span>
      {text.slice(idx + k.length)}
    </>
  );
}
