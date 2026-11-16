/* i18n：9 语言，词典 + 缺失回退简体；按语言持久化 localStorage['devstack.lang']
 *
 * 两层翻译：
 *   1) 复数层：识别「数字 + 可数名词」片段，按数量选单数 / 复数形态
 *      （i18n-plural.json）。zh / ja / ko 不变位，这两层直接跳过。
 *   2) 词典层：把简体词条整体替换为目标语言译文。
 * 两层都在渲染边界（App / Drawer / ModalHost / LogsPage）统一执行，
 * 保证「谁渲染谁翻译」，不出现预翻译后语言被冻结的双重翻译。
 */
import dict from './i18n-dict.json';
import plural from './i18n-plural.json';

export const LANGS: [string, string][] = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'],
  ['ko', '한국어'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['pt', 'Português']
];

const LI: Record<string, number> = {};
LANGS.forEach((x, i) => { LI[x[0]] = i; });

const D = dict as unknown as Record<string, string[]>;
const KEYS = Object.keys(D).sort((a, b) => b.length - a.length);

/* ---------- 复数表 ---------- */
/** 每条 = [单数形态, 复数形态] × 9 语言，顺序与 LANGS 一致 */
const PF = plural.entries as unknown as Record<string, [string, string][]>;
/** 每种语言的复数规则：none=不变位 / one=仅 1 用单数 / le1=0 与 1 用单数（法语） */
const PRULES = plural.rules as string[];
/** 只在「数字后面紧跟名词」时生效的词条（含 {n} 占位符的整句不参与，走 trN） */
const PKEYS = Object.keys(PF).filter((k) => !k.includes('{')).sort((a, b) => b.length - a.length);
/**
 * 前置修饰词条目：中文形态是「修饰词 + 数字 + 名词」，但译文的修饰词要跟着名词走
 * （中文「另有 2 项」→ 英文「2 more items」）。用整句模板 + {n} 占位符表达，
 * 匹配只认中文形态，译文的词序可自由调整。
 */
interface PreEntry { pre: string; noun: string; forms: [string, string][] }
const PRE = ((plural as unknown as { pre?: PreEntry[] }).pre ?? []);

let lang = 'zh-CN';
try {
  const saved = localStorage.getItem('devstack.lang');
  if (saved && LI[saved] !== undefined) lang = saved;
} catch { /* ignore */ }

let RX: RegExp | null = null;
let PRX: RegExp | null = null;
let PRE_RX: { e: PreEntry; rx: RegExp }[] = [];
let IDX = 0;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(): void {
  IDX = LI[lang];
  RX = lang === 'zh-CN' ? null : new RegExp(KEYS.map(escapeRe).join('|'), 'g');
  // 复数层：数字 → (可选 </b>) → 可选空白 → 可数名词短语。
  // 简体（zh-CN）整串原样返回，不参与；其余语种一律走复数层——即使该语言不变位
  // （ja / ko / zh-TW），也要让复数层先吃掉「数字 + 名词」，否则词典层里
  // 「 项」这类短键会抢先命中，把「 项错误」拆成「 项」+「错误」留下中文。
  PRX = lang === 'zh-CN'
    ? null
    : new RegExp('(\\d+)(<\\/b>)?(\\s*)(' + PKEYS.map(escapeRe).join('|') + ')', 'g');
  // 前置修饰词层：只在有复数规则的语种启用（不变位的语言由词典层处理即可）
  PRE_RX = (lang === 'zh-CN' || PRULES[IDX] === 'none')
    ? []
    : PRE.map((e) => ({
      e,
      rx: new RegExp(escapeRe(e.pre) + '(\\d+)(?:\\s*)' + escapeRe(e.noun), 'g')
    }));
}

/** 该语言在数量 n 时是否用单数形态 */
function useOne(n: number): boolean {
  const rule = PRULES[IDX];
  return rule === 'one' ? n === 1 : rule === 'le1' ? n <= 1 : false;
}

/** 选出该语言的单数 / 复数形态 */
function pick(n: number, key: string): string {
  const e = PF[key];
  if (!e) return key;
  const pair = e[IDX];
  if (!pair) return key;
  return useOne(n) ? pair[0] : pair[1];
}

export function tr(s: string): string {
  let out = String(s);
  // 第 0 层：前置修饰词（中文「修饰词 + 数字 + 名词」→ 译文里修饰词跟着名词走）
  for (const { e, rx } of PRE_RX) {
    out = out.replace(rx, (m, num: string) => {
      const pair = e.forms[IDX];
      if (!pair) return m;
      const tpl = useOne(parseInt(num, 10)) ? pair[0] : pair[1];
      return tpl.replace('{n}', num);
    });
  }
  // 第 1 层：复数。数字保留原样，只替换名词短语；分隔空白由译文自身决定
  if (PRX) {
    out = out.replace(PRX, (m, num: string, tag: string, ws: string, key: string) =>
      num + (tag || '') + pick(parseInt(num, 10), key));
  }
  if (!RX) return out;
  // 第 2 层：词典
  return out.replace(RX, (m) => (D[m] && D[m][IDX]) || m);
}

/**
 * 带数量的整句翻译（如「正在全量刷新 {n} 项服务」）。
 * 数字在译文里是 {n} 占位符，渲染边界看不到真实数字，
 * 因此这类整句无法走复数层，需要在调用处显式给出数量。
 * @param s 简体整句（同时是复数表里的键）
 * @param n 数量，用于选择单数 / 复数形态
 */
export function trN(s: string, n: number): string {
  const e = PF[s];
  if (e && e[IDX]) return useOne(n) ? e[IDX][0] : e[IDX][1];
  return tr(s);
}

export function getLang(): string { return lang; }
export function langName(code: string): string {
  const hit = LANGS.find(x => x[0] === code);
  return hit ? hit[1] : code;
}

const subscribers = new Set<() => void>();
export function setLang(code: string): void {
  if (LI[code] === undefined) return;
  lang = code;
  compile();
  try { localStorage.setItem('devstack.lang', code); } catch { /* ignore */ }
  document.documentElement.setAttribute('lang', code);
  subscribers.forEach(f => f());
}
export function onLangChange(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

compile();
