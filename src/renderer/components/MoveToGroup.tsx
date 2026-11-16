/* 移入组合弹窗 */
import { useState } from 'react';
import { useUi } from '../uistate';
import { useUiState } from '../store';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { ServiceDefinition } from '../../shared/types';

export function MoveToGroup({ service }: { service: ServiceDefinition }): JSX.Element {
  const { t } = useI18n();
  const ui = useUi();
  const { snapshot } = useUiState();
  const groups = snapshot?.groups ?? [];
  const services = snapshot?.services ?? [];
  const [sel, setSel] = useState<string>('');

  const onOk = async () => {
    if (sel === '__new') {
      ui.closeModal();
      ui.openModal({ kind: 'group', group: null });
      return;
    }
    if (!sel) { ui.toast('请选择目标组合'); return; }
    const g = groups.find(x => x.id === sel);
    await api.moveToGroup(service.id, sel);
    ui.closeModal();
    ui.toast(service.name + ' 已移入组合：' + (g?.name ?? sel));
  };

  return (
    <>
      <div className="modalhead">
        <h3>{t('移入组合 · ') + service.name}</h3>
        <div className="tools">
          <button className="btn" onClick={ui.closeModal}>{t('取消')}</button>
          <button className="btn primary" onClick={() => void onOk()}>{t('确认')}</button>
        </div>
      </div>
      <div className="card">
        <h4>{t('选择目标组合')}</h4>
        <div className="picklist">
          {groups.map(g => (
            <label className="pick" key={g.id}>
              <input type="radio" name="mvg" checked={sel === g.id} onChange={() => setSel(g.id)} />
              <div>
                <div className="pn">{g.name}</div>
                <div className="pd">{t(`${services.filter(s => s.gid === g.id).length} 个成员 · 加入后排在组内末尾`)}</div>
              </div>
            </label>
          ))}
          <label className="pick">
            <input type="radio" name="mvg" checked={sel === '__new'} onChange={() => setSel('__new')} />
            <div>
              <div className="pn">{t('新建组合…')}</div>
              <div className="pd">{t('创建后以本服务为第一个成员')}</div>
            </div>
          </label>
        </div>
      </div>
    </>
  );
}
