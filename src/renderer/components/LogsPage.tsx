/* 日志页：全局活动日志 + 各服务日志入口 */
import { useMemo } from 'react';
import { useUiState } from '../store';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { Icon } from '../icons';

export function LogsPage(): JSX.Element {
  const { activity } = useUiState();
  const { snapshot } = useUiState();
  const ui = useUi();
  const { t } = useI18n();

  const rows = useMemo(() => activity.slice().reverse(), [activity]);
  const services = snapshot?.services ?? [];

  return (
    <div className="page">
      <section className="panel">
        <div className="panelhead">
          <h2>{t('全局活动日志')}</h2>
          <span className="sub">{t('整体开始事件与逐服务 OK / WARN')}</span>
        </div>
        <div className="term" style={{ maxHeight: 320 }}>
          {rows.length === 0 && <div style={{ color: '#5C708C', padding: '24px 4px', textAlign: 'center' }}>{t('暂无活动记录')}</div>}
          {rows.map((l, i) => (
            <div className="termrow" key={i}>
              <span className="ts">{l.ts}</span>
              <span className={'lv ' + l.level}>{l.tag}</span>
              <span className="tx">{t(l.msg)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <div className="panelhead">
          <h2>{t('服务日志')}</h2>
          <span className="sub">{t('点服务查看 stdout / 文件 tail')}</span>
        </div>
        <div id="cards">
          {services.map(s => (
            <div className="svc" key={s.id}>
              <div className="svcinfo">
                <div className="line1"><span className="dot" style={{ background: '#B4BCC8' }} /><span className="sname">{s.name}</span></div>
                <div className="line2 mono">:{s.port} · stdout</div>
              </div>
              <div className="acts">
                <button className="btn" onClick={async () => {
                  const lines = await api.getServiceLog(s.id);
                  ui.openDrawer({ title: s.name + ' · 启动日志', chip: 'stdout', lines });
                }}><Icon id="iL" size={11} />{t('查看日志')}</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
