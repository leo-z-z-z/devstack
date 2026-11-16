/* 弹窗宿主：确认框 / 服务编辑器 / 组合编辑 / 移入组合 */
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { ServiceEditor } from './ServiceEditor';
import { GroupEditor } from './GroupEditor';
import { MoveToGroup } from './MoveToGroup';

export function ModalHost(): JSX.Element {
  const { modal, closeModal } = useUi();
  const { t } = useI18n();

  if (modal.kind === 'none') return <></>;

  const handleCancel = () => { modal.onCancel?.(); closeModal(); };
  const handleDiscard = () => { modal.onDiscard?.(); closeModal(); };

  return (
    <div className="mask on" onClick={(e) => { if (e.target === e.currentTarget && !window.getSelection()?.toString()) handleCancel(); }}>
      <div className="modal">
        {modal.kind === 'confirm' && (
          <>
            <div className="modalhead">
              <h3>{t(modal.title ?? '请确认')}</h3>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div style={{ fontSize: 12, lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: t(modal.body ?? '') }} />
              {modal.detail && <div className="confdetail mono" dangerouslySetInnerHTML={{ __html: t(modal.detail) }} />}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 14 }}>
                {modal.discardText && (
                  <button className="btn" onClick={handleDiscard}>{t(modal.discardText)}</button>
                )}
                <button className="btn" onClick={handleCancel}>{t('取消')}</button>
                <button
                  className={'btn ' + (modal.danger ? 'danger' : 'primary')}
                  onClick={() => { closeModal(); modal.onOk?.(); }}
                >
                  {t(modal.okText ?? '确认')}
                </button>
              </div>
            </div>
          </>
        )}
        {modal.kind === 'editor' && <ServiceEditor service={modal.service ?? null} />}
        {modal.kind === 'group' && <GroupEditor group={modal.group ?? null} renameOnly={modal.renameOnly === true} />}
        {modal.kind === 'move' && modal.service && <MoveToGroup service={modal.service} />}
      </div>
    </div>
  );
}
