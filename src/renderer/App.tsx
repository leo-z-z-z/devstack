/* 应用壳：顶栏 + 页面路由 + 抽屉 + 弹窗 + toast */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { UiContext, NavKey, ModalSpec, DrawerSpec, UiContextValue } from './uistate';
import { TopBar } from './components/TopBar';
import { ServicesPage } from './components/ServicesPage';
import { LogsPage } from './components/LogsPage';
import { SettingsPage } from './components/SettingsPage';
import { TemplatesPage } from './components/TemplatesPage';
import { ScriptsPage } from './components/ScriptsPage';
import { Drawer } from './components/Drawer';
import { ModalHost } from './components/ModalHost';
import { SpriteDefs, Icon } from './icons';
import { useI18n } from './i18n-hook';

export function App(): JSX.Element {
  const { t, lang, setLang } = useI18n();
  const [nav, setNav] = useState<NavKey>('services');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalSpec>({ kind: 'none' });
  const [drawer, setDrawer] = useState<DrawerSpec>({ open: false, title: '', chip: '', lines: [], wide: false });
  const [toastMsg, setToastMsg] = useState('');
  const [tempExpand, setTempExpandState] = useState<Record<string, boolean>>({});

  // 连续提示时必须取消上一条的定时器，否则旧的 3.2s 回调会提前吞掉新提示
  // （全部启停守卫改为纯 toast 反馈后，快速连点两个按钮很容易触发）
  const toastTimer = useRef<number | undefined>(undefined);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 3200);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
  }, []);

  const ctx: UiContextValue = useMemo(() => ({
    nav, setNav,
    search, setSearch,
    modal, openModal: setModal, closeModal: () => setModal({ kind: 'none' }),
    drawer,
    openDrawer: (d) => setDrawer({ ...d, open: true, wide: false }),
    closeDrawer: () => setDrawer(x => ({ ...x, open: false })),
    toggleDrawerWide: () => setDrawer(x => ({ ...x, wide: !x.wide })),
    toastMsg, toast,
    tempExpand, setTempExpand: setTempExpandState
  }), [nav, search, modal, drawer, toastMsg, toast, tempExpand]);

  return (
    <UiContext.Provider value={ctx}>
      <SpriteDefs />
      <div className="stage">
        <div className="win">
          <TopBar t={t} lang={lang} setLang={setLang} />
          {nav === 'services' && <ServicesPage />}
          {nav === 'logs' && <LogsPage />}
          {nav === 'settings' && <SettingsPage />}
          {nav === 'templates' && <TemplatesPage />}
          {nav === 'scripts' && <ScriptsPage />}
          <Drawer />
          <ModalHost />
          <div className={'toast' + (toastMsg ? ' on' : '')}>{t(toastMsg)}</div>
        </div>
      </div>
    </UiContext.Provider>
  );
}
