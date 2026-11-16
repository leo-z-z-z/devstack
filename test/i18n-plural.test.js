/* ============================================================
 * 国际化（9 语）· 计数感知复数测试
 *
 * 背景：本项目是「文本片段替换式」i18n——词典的键是简体原文片段，
 * 译文按片段整体替换。这类替换天然处理不了单复数：
 * 「3 项服务」会直接翻成 "3 services"，1 项时就变成 "1 services"。
 *
 * 解法：i18n-plural.json 给出每个可数名词短语的【单数 / 复数】两种形态，
 * 引擎在词典层之前先跑一层复数替换——看到「数字 + 名词短语」就按数量选形态。
 *
 * 本测试验证三件事：
 *   1) 各语种的单数 / 复数选形正确（含 0 / 1 / 2 / 5 四个数量）
 *   2) 复数层没有破坏既有词典译文（670+ 条词典键 × 9 语逐条比对）
 *   3) 真实界面句式在 6 个非汉字语种下不残留中文
 *
 * 引擎用 TypeScript 编译器转译 i18n.ts 后在桩环境真实加载，测的是产品代码。
 * 运行：node test/i18n-plural.test.js
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const APP = path.join(__dirname, '..');
const R = path.join(APP, 'src', 'renderer');
const dict = JSON.parse(fs.readFileSync(path.join(R, 'i18n-dict.json'), 'utf8'));
const plural = JSON.parse(fs.readFileSync(path.join(R, 'i18n-plural.json'), 'utf8'));

const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'es', 'de', 'pt'];
const LATIN_LANGS = ['en', 'ko', 'fr', 'es', 'de', 'pt'];
const CJK = /[㐀-鿿]/;

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; fails.push(msg); console.log('  FAIL  ' + msg); }
}
function info(m) { console.log('  INFO  ' + m); }
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------- 真实加载 i18n.ts ---------- */
global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }
};
global.document = { documentElement: { setAttribute: () => {} } };

const tsSrc = fs.readFileSync(path.join(R, 'i18n.ts'), 'utf8');
const jsSrc = ts.transpileModule(tsSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;
const Mod = require('module');
const mm = new Mod('i18n.plural.probe.js');
mm.filename = path.join(R, 'i18n.plural.probe.js');
mm.paths = Mod._nodeModulePaths(R);
const origReq = mm.require.bind(mm);
mm.require = (r) => {
  const s = String(r);
  if (s.includes('i18n-dict.json')) return dict;
  if (s.includes('i18n-plural.json')) return plural;
  return origReq(r);
};
mm._compile(jsSrc, mm.filename);
const I = mm.exports;
const tr = (s, lg) => { I.setLang(lg); return I.tr(s); };

(async () => {
  /* ===== 复数表结构 ===== */
  section('复数表结构');
  const pk = Object.keys(plural.entries);
  ok(plural.rules.length === LANGS.length, '规则条数与语种数一致（' + plural.rules.length + '）');
  ok(plural.rules.every(r => ['none', 'one', 'le1'].includes(r)), '规则取值合法（none / one / le1）');
  ok(pk.length >= 20, '复数表覆盖 ' + pk.length + ' 条可数名词短语');
  const badShape = pk.filter(k => {
    const e = plural.entries[k];
    return !Array.isArray(e) || e.length !== LANGS.length ||
      e.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(x => typeof x !== 'string' || !x.trim()));
  });
  ok(badShape.length === 0, '每条均为 9 语 × [单数, 复数] 且非空' + (badShape.length ? '（异常：' + badShape.join(', ') + '）' : ''));
  const noCjk = pk.filter(k => LATIN_LANGS.some(lg => {
    const i = LANGS.indexOf(lg);
    return CJK.test(plural.entries[k][i][0]) || CJK.test(plural.entries[k][i][1]);
  }));
  ok(noCjk.length === 0, '拉丁 / 韩文语种的复数形态无中文残留' + (noCjk.length ? '（异常：' + noCjk.join(', ') + '）' : ''));

  /* ===== 单数 / 复数选形 ===== */
  section('单数 / 复数选形');
  const CASES = [
    ['en', '3 项', '3 items'], ['en', '1 项', '1 item'], ['en', '0 项', '0 items'], ['en', '5 项', '5 items'],
    ['en', '共 3 项服务 · 2 个组合', 'Total 3 services · 2 groups'],
    ['en', '共 1 项服务 · 1 个组合', 'Total 1 service · 1 group'],
    ['en', '命中 3 / 10 行', 'Matched 3 / 10 lines'],
    ['en', '命中 1 / 1 行', 'Matched 1 / 1 line'],
    ['en', '组合 · 3 项', 'Group · 3 items'],
    ['en', '组合 · 1 项', 'Group · 1 item'],
    ['en', '3 项待处理 · 点击查看', '3 pending items · click to view'],
    ['en', '1 项待处理 · 点击查看', '1 pending item · click to view'],
    ['en', '端口冲突 2 项：', 'Port conflicts 2 items: '],
    ['en', '端口冲突 1 项：', 'Port conflicts 1 item: '],
    ['en', '3 项错误', '3 errors'],
    ['en', '1 项错误', '1 error'],
    ['en', '2 个成员 · 加入后排在组内末尾', '2 members · new members are appended to the end'],
    ['en', '1 个成员 · 加入后排在组内末尾', '1 member · new members are appended to the end'],
    ['en', '1 个成员会回到平铺列表，', '1 member returns to the flat list,'],
    ['en', '2 个成员会回到平铺列表，', '2 members return to the flat list,'],
    ['en', '2 个成员按勾选顺序启动', '2 members start in the order they were checked'],
    ['en', '1 个成员按勾选顺序启动', '1 member starts in the order they were checked'],
    ['de', '1 项', '1 Eintrag'], ['de', '2 项', '2 Einträge'],
    ['fr', '0 项', '0 élément'], ['fr', '1 项', '1 élément'], ['fr', '2 项', '2 éléments'],
    ['es', '1 个组合', '1 grupo'], ['es', '2 个组合', '2 grupos'],
    ['pt', '1 项', '1 item'], ['pt', '2 项', '2 itens'],
    ['zh-CN', '3 项', '3 项'], ['zh-TW', '3 项', '3 項'],
    ['ja', '3 项', '3 件'], ['ko', '3 项', '3개']
  ];
  for (const [lg, src, want] of CASES) {
    const got = tr(src, lg);
    ok(got === want, `[${lg}] ${JSON.stringify(src)} → ${JSON.stringify(want)}` + (got === want ? '' : '，实得 ' + JSON.stringify(got)));
  }

  /* ===== HTML 间隔（<b>数字</b> 名词） ===== */
  section('HTML 间隔：<b>数字</b> 后接名词');
  ok(tr('<b>3</b> 项运行中的服务：', 'en') === '<b>3</b> running services: ', '复数形态');
  ok(tr('<b>1</b> 项运行中的服务：', 'en') === '<b>1</b> running service: ', '单数形态');
  ok(tr('<b>1</b> 个组合各自按组内自上而下串行、等上一项就绪再启动下一项，组合之间并行。', 'en')
    === '<b>1</b> group runs top-down within the group, waiting for the previous one to be ready before starting the next; groups run in parallel.',
    '整句动词一致（group runs / groups run）');

  /* ===== 前置修饰词：修饰词在译文中要跟着名词走 ===== */
  section('前置修饰词：中文「修饰词 + 数字 + 名词」');
  const PRE_CASES = [
    ['en', ' · 另有 2 项', ' · 2 more items'],
    ['en', ' · 另有 1 项', ' · 1 more item'],
    ['fr', ' · 另有 2 项', ' · 2 autres éléments'],
    ['fr', ' · 另有 1 项', ' · 1 autre élément'],
    ['es', ' · 另有 2 项', ' · 2 otros elementos'],
    ['de', ' · 另有 2 项', ' · 2 weitere Einträge'],
    ['pt', ' · 另有 2 项', ' · 2 outros itens'],
    ['ja', ' · 另有 2 项', ' · 他に 2 件'],
    ['ko', ' · 另有 2 项', ' · 외 2개'],
    ['zh-TW', ' · 另有 2 项', ' · 另有 2 項']
  ];
  for (const [lg, src, want] of PRE_CASES) {
    const got = tr(src, lg);
    ok(got === want, `[${lg}] ${JSON.stringify(src)} → ${JSON.stringify(want)}` + (got === want ? '' : '，实得 ' + JSON.stringify(got)));
  }
  ok(!CJK.test(tr(' · 另有 2 项', 'en')), '英文横幅不丢「另有」的「more」语义');

  /* ===== trN：占位符整句 ===== */
  section('trN：数字是 {n} 占位符的整句');
  ok(I.trN && typeof I.trN === 'function', 'i18n 导出 trN');
  I.setLang('en');
  ok(I.trN('正在全量刷新 {n} 项服务', 1) === 'Full refresh of {n} service', 'trN 单数');
  ok(I.trN('正在全量刷新 {n} 项服务', 3) === 'Full refresh of {n} services', 'trN 复数');
  I.setLang('de');
  ok(I.trN('正在全量刷新 {n} 项服务', 1) === 'Vollständige Aktualisierung von {n} Dienst', 'trN 德语单数');
  I.setLang('zh-CN');
  ok(I.trN('正在全量刷新 {n} 项服务', 3) === '正在全量刷新 {n} 项服务', 'trN 简体中文原样返回');
  I.setLang('en');
  ok(I.trN('不在复数表里的句子', 2) === I.tr('不在复数表里的句子'), 'trN 对未登记句子回退到普通翻译');

  /* ===== 回归：复数层不得破坏既有词典译文 ===== */
  section('回归：每条词典键翻译后必须等于其自身译文');
  const keys = Object.keys(dict);
  const broken = [];
  for (const lg of LANGS) {
    I.setLang(lg);
    for (const k of keys) {
      const got = I.tr(k);
      if (got !== dict[k][LANGS.indexOf(lg)]) broken.push({ lg, k, got, want: dict[k][LANGS.indexOf(lg)] });
    }
  }
  ok(broken.length === 0, `词典 ${keys.length} 键 × ${LANGS.length} 语未被复数层破坏（破坏 ${broken.length} 处）`);
  broken.slice(0, 10).forEach(b => info('  ' + b.lg + ' ' + JSON.stringify(b.k) + '\n    got=' + JSON.stringify(b.got) + '\n   want=' + JSON.stringify(b.want)));

  /* ===== 真实界面句式：非汉字语种不得残留中文 ===== */
  section('真实界面句式：6 个非汉字语种下无中文残留');
  const PROBES = [
    '共 3 项服务 · 2 个组合',
    '命中 3 / 10 行',
    '组合 · 1 项',
    '1 项待处理 · 点击查看',
    '端口冲突 2 项：',
    '1 项错误',
    '2 个成员 · 加入后排在组内末尾',
    ' · 另有 2 项',
    '本次跳过 3 项执行中（A、B 等 5 项），不纳入本次调度',
    '<b>3</b> 项运行中的服务：<b>2</b> 项未分组组件并行安全停止；<b>1</b> 个组合各自按组内自上而下串行、等上一项就绪再启动下一项，组合之间并行。',
    '1 个成员会回到平铺列表，',
    '2 个成员按勾选顺序启动',
    '3 项启动中 · 1 项停止中',
    '2 项（',
    '2 项未执行'
  ];
  const residue = [];
  for (const lg of LATIN_LANGS) {
    I.setLang(lg);
    for (const p of PROBES) {
      const out = I.tr(p);
      if (CJK.test(out)) residue.push({ lg, p, out });
    }
  }
  ok(residue.length === 0, `${PROBES.length} 条界面句式在 6 个非汉字语种下无中文残留（残留 ${residue.length} 处）`);
  residue.slice(0, 10).forEach(r => info('  ' + r.lg + ' ' + JSON.stringify(r.p) + ' → ' + JSON.stringify(r.out)));

  /* ===== 调用点契约：数字与名词必须在同一个 t() 载荷里 ===== */
  section('调用点契约：计数必须与名词同载荷');
  const rendererDir = path.join(R, 'components');
  const files = [
    ...fs.readdirSync(R).filter(f => /\.tsx?$/.test(f)).map(f => path.join(R, f)),
    ...fs.readdirSync(rendererDir).filter(f => /\.tsx?$/.test(f)).map(f => path.join(rendererDir, f))
  ];
  // 形如 {someExpr} {t('…名词…')} 的写法：计数在 t() 之外，复数层看不到
  const split = [];
  const re = /\}\s*\{t\('([^']*[项个行组][^']*)'\)\}/g;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src))) split.push(path.basename(f) + ' → ' + m[1]);
  }
  ok(split.length === 0, '没有「计数与名词分处两个 t() 调用」的写法（' + split.length + ' 处）' + (split.length ? '：' + split.join(' | ') : ''));

  console.log('\n============================================================');
  console.log('== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  if (fails.length) { console.log('未达标项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log('复数表 ' + pk.length + ' 条 / 词典 ' + keys.length + ' 键 × ' + LANGS.length + ' 语');
  console.log('============================================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('I18N-PLURAL TEST ERROR', e); process.exit(1); });
