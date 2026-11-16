/* 设置页：四项可配置控件（结构对齐原型 setrow/seg/sw）
 * v2.45：删除整机配置导入导出卡片（与模板链路独立的另一套导入导出，用户主动移除）
 */
import { useUiState } from '../store';
import { useI18n } from '../i18n-hook';
import { api } from '../api';

// v2.43：三档间隔（1 / 3 / 5 秒），默认 3 秒；间隔越大，心跳开销与状态发现延迟越低/越高
const POLL_OPTS: [number, string][] = [[1000, '1 秒'], [3000, '3 秒'], [5000, '5 秒']];
const LOGDAY_OPTS: [number, string][] = [[3, '3 天'], [7, '7 天'], [30, '30 天']];

function Seg({ opts, cur, onPick }: { opts: [number, string][]; cur: number; onPick: (v: number) => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="seg">
      {opts.map(([v, key]) => (
        <button type="button" key={v} className={cur === v ? 'on' : ''} onClick={() => onPick(v)}>{t(key)}</button>
      ))}
    </div>
  );
}

function Sw({ on, onToggle, title }: { on: boolean; onToggle: () => void; title: string }): JSX.Element {
  return (
    <div className={'sw' + (on ? ' on' : '')} onClick={onToggle} title={title}>
      <span className="track"><span className="knob" /></span>
    </div>
  );
}

export function SettingsPage(): JSX.Element {
  const { snapshot } = useUiState();
  const { t } = useI18n();
  const st = snapshot?.settings;

  if (!st) return <div className="page">{t('加载中…')}</div>;

  return (
    <div className="page">
      <section className="panel">
        <div className="panelhead"><h2>{t('设置')}</h2></div>
        <div className="card">
          <h4>{t('探测')}</h4>
          <div className="setrow">
            <div>
              <div className="t">{t('状态轮询间隔')}</div>
              <div className="d">{t('TCP 端口探测')}</div>
            </div>
            <div className="r"><Seg opts={POLL_OPTS} cur={st.pollMs} onPick={v => void api.setSettings({ pollMs: v })} /></div>
          </div>
          <div className="setrow">
            <div><div className="t">{t('端口占用快照')}</div><div className="d">{t('连续 2 个周期结论一致才切换归属文案')}</div></div>
            <div className="r"><Sw on={st.portSnapshot} onToggle={() => void api.setSettings({ portSnapshot: !st.portSnapshot })} title={t('点击切换')} /></div>
          </div>
        </div>
        <div className="card">
          <h4>{t('日志与启动')}</h4>
          <div className="setrow">
            <div><div className="t">{t('本地保留天数')}</div><div className="d">{t('输出与文件 tail 只落本地，不联网')}</div></div>
            <div className="r"><Seg opts={LOGDAY_OPTS} cur={st.logDays} onPick={v => void api.setSettings({ logDays: v })} /></div>
          </div>
          <div className="setrow">
            <div><div className="t">{t('开机自启并最小化到托盘')}</div><div className="d">{t('软件退出后服务继续运行')}</div></div>
            <div className="r"><Sw on={st.autoStart} onToggle={() => void api.setSettings({ autoStart: !st.autoStart })} title={t('点击切换')} /></div>
          </div>
        </div>
      </section>
    </div>
  );
}
