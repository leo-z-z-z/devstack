/* React 侧 i18n：语言变更触发重渲染 */
import { useSyncExternalStore } from 'react';
import { tr, getLang, setLang, onLangChange, LANGS } from './i18n';

export function useI18n(): { t: (s: string) => string; lang: string; setLang: (c: string) => void } {
  const lang = useSyncExternalStore(
    (cb) => onLangChange(cb),
    () => getLang(),
    () => getLang()
  );
  return { t: tr, lang, setLang };
}

export { LANGS };
