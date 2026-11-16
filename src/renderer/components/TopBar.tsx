import { Icon } from '../icons';
import { useUi } from '../uistate';
import { LANGS } from '../i18n';
import { NavKey } from '../uistate';

export function TopBar({ t, lang, setLang }: {
  t: (s: string) => string;
  lang: string;
  setLang: (c: string) => void;
}): JSX.Element {
  const { nav, setNav, search, setSearch } = useUi();
  // 模板库是独立页面（原型为顶栏按钮），必须给导航入口，否则 TemplatesPage 不可达
  const items: [NavKey, string][] = [['services', '服务'], ['logs', '日志'], ['templates', '模板库'], ['scripts', '指令库'], ['settings', '设置']];
  return (
    <header className="topbar">
      <div className="logo"><Icon id="iW" size={15} /></div>
      <div>
        <div className="tname">Service Deck</div>
        <div className="tsub">{t('本地服务管理器')}</div>
      </div>
      <div className="nav">
        {items.map(([k, label]) => (
          <span key={k} className={nav === k ? 'on' : ''} onClick={() => setNav(k)}>{t(label)}</span>
        ))}
      </div>
      <div className="topright">
        <div className="search">
          <Icon id="iQ" size={12} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('搜索服务 / 组合')}
          />
        </div>
        <select className="langsel" value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
    </header>
  );
}
