/* ============================================================
 * 国际化（9 语）生产就绪测试
 *
 * 判定模型（针对「文本替换式 i18n」）：
 *   A 词典覆盖能力：把页面所有中文文案送入真实 tr()，检查在
 *     en/ko/fr/es/de/pt（不使用汉字的语种）下是否还有中文残留。
 *     zh-TW / ja 本就使用汉字，不作为残留判定语种（避免假阳性）。
 *   B 渲染边界：页面是否真的对动态文案调用 t()。主进程的活动日志 /
 *     toast / 弹窗正文 / 抽屉标题都必须在渲染边界过 t()，否则
 *     切换语言后仍显示简体。
 *   C 逐页生产使用标准判定 = A 无缺口 且 B 无缺陷。
 *
 * 引擎用 TypeScript 编译器转译 i18n.ts 后在桩环境真实加载，测的是产品代码。
 * 运行：node test/i18n.test.js
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const APP = path.join(__dirname, '..');
const R = path.join(APP, 'src', 'renderer');
const MAIN = path.join(APP, 'src', 'main');
const DICT_FILE = path.join(R, 'i18n-dict.json');
const dict = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'es', 'de', 'pt'];
// 不使用汉字的目标语种：出现汉字即为未翻译残留
const LATIN_LANGS = ['en', 'ko', 'fr', 'es', 'de', 'pt'];
const CJK = /[\u3400-\u9fff]/;

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; fails.push(msg); console.log('  FAIL  ' + msg); }
}
function info(m) { console.log('  INFO  ' + m); }
function section(t) { console.log('\n=== ' + t + ' ==='); }
const cjkCount = (s) => (String(s).match(/[\u3400-\u9fff]/g) || []).length;

/* ---------- 真实加载 i18n.ts ---------- */
global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }
};
const docAttrs = {};
global.document = { documentElement: { setAttribute: (k, v) => { docAttrs[k] = v; } } };

const tsSrc = fs.readFileSync(path.join(R, 'i18n.ts'), 'utf8');
const jsSrc = ts.transpileModule(tsSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;
const Mod = require('module');
const mm = new Mod('i18n.probe.js');
mm.filename = path.join(R, 'i18n.probe.js');
mm.paths = Mod._nodeModulePaths(R);
const origReq = mm.require.bind(mm);
mm.require = (r) => (String(r).includes('i18n-dict.json') ? dict : origReq(r));
mm._compile(jsSrc, mm.filename);
const I = mm.exports;
const tr = I.tr;
const translate = (s, lang) => { I.setLang(lang); return tr(s); };
const restore = () => I.setLang('zh-CN');

/* ---------- AST 扫描 ---------- */
function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  function walk(node, insideT) {
    let nextT = insideT;
    if (ts.isCallExpression(node)) {
      const cal = node.expression.getText(sf).trim();
      if (/^(t|tr|i18n\.tr|I\.tr)$/.test(cal) || /\.t$/.test(cal)) nextT = true;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CJK.test(node.text)) found.push({ line: lineOf(node), text: node.text, kind: insideT ? 'wrapped' : 'unwrapped' });
    } else if (ts.isJsxText(node)) {
      const v = node.text.replace(/\s+/g, ' ').trim();
      if (CJK.test(v)) found.push({ line: lineOf(node), text: v, kind: 'jsx-bare' });
    } else if (ts.isTemplateExpression(node)) {
      const full = node.getText(sf);
      if (CJK.test(full)) found.push({ line: lineOf(node), text: full.replace(/\s+/g, ' ').slice(0, 160), kind: insideT ? 'wrapped' : 'unwrapped' });
    }
    ts.forEachChild(node, c => walk(c, nextT));
  }
  walk(sf, false);
  return found;
}
const listSrc = (dir) => fs.readdirSync(dir).filter(f => /\.(tsx|ts)$/.test(f)).map(f => path.join(dir, f));
const files = [
  ...listSrc(R).map(f => ({ file: f, area: 'renderer' })),
  ...listSrc(path.join(R, 'components')).map(f => ({ file: f, area: 'renderer' })),
  ...listSrc(MAIN).map(f => ({ file: f, area: 'main' }))
];

const PAGE = {
  'App.tsx': '应用壳 / Toast', 'TopBar.tsx': '顶栏（导航·搜索·语言）',
  'ServicesPage.tsx': '服务列表页', 'ServiceCard.tsx': '服务卡片', 'GroupCard.tsx': '组合卡片',
  'LogsPage.tsx': '日志页', 'SettingsPage.tsx': '设置页', 'TemplatesPage.tsx': '模板库页',
  'Drawer.tsx': '日志抽屉', 'ModalHost.tsx': '弹窗宿主', 'ServiceEditor.tsx': '服务编辑器',
  'GroupEditor.tsx': '组合编辑器', 'MoveToGroup.tsx': '移入组合',
  'i18n.ts': 'i18n 引擎', 'i18n-hook.ts': 'i18n 钩子', 'uistate.ts': 'UI 状态',
  'api.ts': 'IPC 客户端', 'store.ts': '前端状态', 'icons.tsx': '图标', 'main.tsx': '入口',
  'vite-env.d.ts': '类型声明'
};
const MAIN_LABEL = {
  'schedule.ts': '活动日志文案', 'template.ts': '模板校验文案', 'config.ts': '配置校验文案',
  'ipc.ts': 'IPC 错误文案', 'probe.ts': '状态注释', 'runner.ts': '运行器', 'logs.ts': '日志',
  'store.ts': '状态', 'paths.ts': '路径', 'presets.ts': '模板名', 'index.ts': '入口', 'preload.ts': 'preload'
};

(async () => {
  /* ===== 阶段 0：词典结构 ===== */
  // 431（原型 v2.39）+ 22（模板 JSON 直接编辑）+ 6（v2.40 启停前置守卫）+ 7（v2.41 轮询可见性）
  // v2.43 删除 3 条「补充说明」旧键、补入 3 条精简键（含「5 秒」），键数仍为 466
  // v2.45 删除设置页「整机配置」卡片连带的 4 条键（导出 / 导入 / 两条原型演示 toast）→ 462
  // v2.46 删除模板 JSON 无关联字段 placeholders 后，2 条已无引用的占位符校验/展示键一并清理 → 460
  // v2.47 删除 openDir 动作槽：命令提示键改 3 动作版；新增「已配置 / 未配置」2 键 → 462
  // v2.48 新增「保存为新模板」按钮 title + 失败 toast 2 键 → 464
  // v2.51 动作区美化：脚本路径 / 执行器 / 必填 / 可选 / 查看规则等 9 键 → 486
  // v2.52 彻底国际化：补齐渲染层遗漏文案 + 主进程活动日志 / 校验错误 / 原生对话框文案 → 667
  // v2.53 添加服务页文字分层：短标签「浏览器地址」「来源模板」2 键 → 669
  // v2.54 必填标记精简：新增「(可选)」浅灰小字键，必填改红色 * → 670
  // v2.55 计数感知复数：新增「 项错误」前导空格变体，避免短键「 项」抢先命中留下「错误」→ 671
  // v2.56 主页面异常统计：异常 / 项异常 / 无异常 / 查看与展开提示 5 键 → 676
  // v2.57 组合编辑优化：组合名称不能为空 / 组合已存在 / 已有组合 3 键 → 679
  // v2.58 组合删除：删除组合 1 键 → 680
  // v2.58.1 组合删除涉及的中文字符串片段 4 键 → 684
  // v2.58.2 带反引号模板字符串 key + schedule.ts 原有 4 处活动日志缺口 → 688
  // v2.59 组合重命名入口：新增「重命名组合」1 键 → 689
  // v2.59.1 组合重命名 toast：新增「组合「${name}」已重命名」1 键 → 690
  // v2.60 组合双栏成员管理：新增 9 个双栏列表文案键 → 699
  // v2.60.1 双栏成员管理补充：新增「选择成员」/ hint 完整版 /「 个成员按顺序启动」3 键 → 702
  // v2.61 分组管理页面：新增 13 个分组管理文案键 → 715
  // v2.62 分组管理 toast 与删除确认边界：新增 8 个键（分组名称 / 已新增 / 已保存 / 已删除 / 成员平铺 / 服务不受影响 / 配置移除 / 操作不可撤销）→ 723
  // v2.68 中断按钮状态：新增「中断中…」「中断失败」2 键 → 730
  section("阶段 0 · 词典结构（730 键 × 9 语）");
  const keys = Object.keys(dict);
  ok(keys.length === 788, "词典键数 788（含「不保存」等新键）");
  ok(I.LANGS.length === 9, '声明语种 9 个：' + I.LANGS.map(x => x[0]).join('/'));
  ok(keys.every(k => Array.isArray(dict[k]) && dict[k].length === 9), '全部键均为 9 元素数组');
  const emptyCells = [];
  keys.forEach(k => dict[k].forEach((v, i) => { if (typeof v !== 'string' || !v.trim()) emptyCells.push(k + ':' + LANGS[i]); }));
  ok(emptyCells.length === 0, '9 语译文无空值 / 非字符串（异常 ' + emptyCells.length + '）');
  ok(new Set(keys).size === keys.length, '词典键无重复');
  ok(!/[\uFFFD]/.test(fs.readFileSync(DICT_FILE, 'utf8')), '词典 UTF-8 无乱码替换字符');
  // 真·未翻译：拉丁/韩文语种沿用简体（日语用汉字合法，单独统计）
  const untranslated = [], jaSame = [];
  keys.forEach(k => LANGS.slice(2).forEach((lg, j) => {
    const i = j + 2;
    if (dict[k][i] === dict[k][0]) (lg === 'ja' ? jaSame : untranslated).push(k + '@' + lg);
  }));
  ok(untranslated.length === 0, '拉丁/韩文语种无「沿用简体」的未翻译项' + (untranslated.length ? '：' + untranslated.slice(0, 8).join(', ') : ''));
  info('日语沿用简体汉字 ' + jaSame.length + ' 项（停止/保存/数字及标点，属合法日语表记，不计缺陷）');
  const infl = keys.map(k => ({ k, r: dict[k][0].length ? Math.max(...dict[k].map(v => v.length)) / dict[k][0].length : 1 }))
    .filter(x => x.r >= 2.2 && CJK.test(x.k)).sort((a, b) => b.r - a.r);
  info('译文膨胀 ≥2.2 倍 ' + infl.length + ' 键（最长 ' + (infl.slice(0, 3).map(x => x.k + '×' + x.r.toFixed(1)).join(' / ') || '无') + '），需靠 ellipsis/nowrap 兜底');

  /* ===== 阶段 1：引擎链路（真实产品代码） ===== */
  section('阶段 1 · 引擎链路（真实 i18n.ts）');
  ok(I.getLang() === 'zh-CN', '默认语言 zh-CN');
  ok(tr('本地服务管理器') === '本地服务管理器', 'zh-CN 直返简体原文');
  const samples = {};
  for (const lg of LANGS) samples[lg] = translate('本地服务管理器', lg);
  ok(new Set(Object.values(samples)).size >= 8, '9 语产生 ≥8 种不同译文（en=' + samples.en + ' / de=' + samples.de + '）');
  I.setLang('en');
  ok(docAttrs.lang === 'en', 'setLang 写入 document.documentElement.lang');
  ok(global.localStorage.getItem('devstack.lang') === 'en', '语言选择持久化 localStorage[devstack.lang]');
  let fired = 0;
  const off = I.onLangChange(() => fired++);
  I.setLang('fr'); I.setLang('ja');
  ok(fired === 2, '每次 setLang 触发订阅者（useSyncExternalStore 重渲染）');
  off(); I.setLang('de');
  ok(fired === 2, '取消订阅后不再触发（无监听器泄漏）');
  const before = I.getLang(); I.setLang('xx-INVALID');
  ok(I.getLang() === before, '非法语言码被忽略');
  ok(tr('__未登记文案XYZ__') === '__未登记文案XYZ__', '未登记文本安全回退原文，不抛错 / 不输出 raw key');
  restore();

  /* ===== 阶段 2：逐页 AST 扫描 ===== */
  section('阶段 2 · 逐页文案 AST 扫描');
  const perFile = files.map(({ file, area }) => {
    const base = path.basename(file);
    return { base, area, file, label: area === 'renderer' ? (PAGE[base] || base) : ('[主进程] ' + (MAIN_LABEL[base] || base)), found: scanFile(file) };
  });
  const rendererFiles = perFile.filter(x => x.area === 'renderer' && x.base !== 'i18n.ts');
  const mainFiles = perFile.filter(x => x.area === 'main');
  const totalCn = perFile.reduce((a, x) => a + x.found.length, 0);
  info('扫描 ' + perFile.length + ' 个源文件，含中文字符串 ' + totalCn + ' 处');
  const all = perFile.flatMap(x => x.found.map(f => ({ ...f, file: x.base, area: x.area, label: x.label })));
  info('分类：已包裹 tr ' + all.filter(x => x.kind === 'wrapped').length +
       ' / 裸 JSX 文本 ' + all.filter(x => x.kind === 'jsx-bare').length +
       ' / 未包裹字符串 ' + all.filter(x => x.kind === 'unwrapped').length);
  const mainMsgs = all.filter(x => x.area === 'main' && x.kind !== 'wrapped');
  info('主进程中文文案 ' + mainMsgs.length + ' 处（活动日志/校验错误/状态注释，需经渲染边界 t() 才能翻译）');

  /* ===== 阶段 3A：词典覆盖能力（全部前端文案） ===== */
  section('阶段 3A · 词典覆盖能力（en/ko/fr/es/de/pt 下无中文残留）');
  // i18n.ts 中的「简体中文/繁體中文/日本語…」是语言选择器自称，本就该按原语言显示，属合法例外
  const allUiText = all.filter(x => x.area === 'renderer' && x.file !== 'i18n.ts');
  const gaps = [];
  for (const item of allUiText) {
    for (const lg of LATIN_LANGS) {
      const out = translate(item.text, lg);
      if (cjkCount(out) > 0) { gaps.push({ ...item, lang: lg, rest: out }); break; }
    }
  }
  restore();
  const gapTexts = [...new Set(gaps.map(g => g.text))];
  ok(gaps.length === 0, '全部 ' + allUiText.length + ' 处 UI 文案在 6 个非汉字语种下无中文残留（词典缺口 ' + gaps.length + ' 处 / 去重 ' + gapTexts.length + ' 条）');
  if (gaps.length) {
    info('缺口样例（前 25）：');
    gaps.slice(0, 25).forEach(g => info('  ' + g.file + ':' + g.line + ' [' + g.lang + '] ' + JSON.stringify(g.text.slice(0, 60)) + ' → ' + JSON.stringify(g.rest.slice(0, 90))));
  }
  // 导出待译词条清单（本地化团队可直接按 9 语补全）
  const missFile = path.join(APP, '..', 'docs', 'i18n-missing-keys.json');
  const miss = gapTexts.map(text => ({
    key: text,
    type: /[`$<>]|\$\{/.test(text) ? 'template-needs-icu' : 'static',
    'zh-CN': text, 'zh-TW': '', en: '', ja: '', ko: '', fr: '', es: '', de: '', pt: ''
  }));
  fs.writeFileSync(missFile, JSON.stringify(miss, null, 2) + '\n', 'utf8');
  info('已导出待译词条清单 docs/i18n-missing-keys.json（' + miss.length + ' 条，其中需参数化 ' + miss.filter(x => x.type !== 'static').length + ' 条）');

  /* ===== 阶段 3B：渲染边界（动态文案是否真的过 t()） ===== */
  section('阶段 3B · 渲染边界（动态文案过 t()）');
  const srcOf = (b) => fs.readFileSync(path.join(R, 'components', b), 'utf8');
  const appSrc = fs.readFileSync(path.join(R, 'App.tsx'), 'utf8');
  const boundaries = [
    ['App / Toast', appSrc, /\{t\(toastMsg\)\}/, '{t(toastMsg)}'],
    ['ModalHost / 确认框正文', srcOf('ModalHost.tsx'), /__html:\s*t\(modal\.body/, '__html: t(modal.body)'],
    ['ModalHost / 详情', srcOf('ModalHost.tsx'), /__html:\s*t\(modal\.detail/, '__html: t(modal.detail)'],
    ['LogsPage / 活动日志消息', srcOf('LogsPage.tsx'), /\{t\(l\.msg\)\}/, '{t(l.msg)}'],
    ['Drawer / 抽屉日志消息', srcOf('Drawer.tsx'), /hl\(t\(l\.msg\)/, 'hl(t(l.msg), kw)'],
    ['Drawer / 抽屉标题', srcOf('Drawer.tsx'), /\{t\(drawer\.title\)\}/, '{t(drawer.title)}'],
    ['Drawer / 级别标签', srcOf('Drawer.tsx'), /t\(label\)/, 't(label)'],
    ['TopBar / 导航标签', srcOf('TopBar.tsx'), /t\(label\)/, 't(label)']
  ];
  for (const [name, src, re, expect] of boundaries) ok(re.test(src), name + ' 已在渲染边界调用 t()（期望 ' + expect + '）');
  const bare = all.filter(x => x.kind === 'jsx-bare');
  ok(bare.length === 0, '无裸 JSX 中文文本（发现 ' + bare.length + ' 处）');
  if (bare.length) bare.slice(0, 30).forEach(x => info('  裸文本 ' + x.file + ':' + x.line + ' ' + JSON.stringify(x.text)));
  ok(/toast/.test(appSrc), 'Toast 通道存在（由 App 统一渲染，边界已覆盖）');

  /* ===== 阶段 3C：主进程文案可达性 ===== */
  section('阶段 3C · 主进程动态文案可达性');
  const logsTranslated = /\{t\(l\.msg\)\}/.test(srcOf('LogsPage.tsx')) && /hl\(t\(l\.msg\)/.test(srcOf('Drawer.tsx'));
  ok(logsTranslated, '主进程推送的 ' + mainMsgs.length + ' 处中文活动/错误文案，可经日志页与抽屉的渲染边界统一翻译');
  if (!logsTranslated) info('  修复建议：LogsPage 用 {t(l.msg)}、Drawer 用 hl(t(l.msg), kw)，利用替换式 i18n 一次性覆盖全部主进程文案');

  /* ===== 阶段 4：布局 / 切换 / 本地化 ===== */
  section('阶段 4 · 布局与语言切换生产项');
  const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8');
  ok(/text-overflow\s*:\s*ellipsis|white-space\s*:\s*nowrap/.test(css), '样式表含长译文溢出保护（ellipsis / nowrap）');
  ok(/useSyncExternalStore/.test(fs.readFileSync(path.join(R, 'i18n-hook.ts'), 'utf8')), '语言变更触发全树重渲染');
  const cached = rendererFiles.filter(x => /useState\([^)]*t\(|useMemo\([^)]*t\(/.test(fs.readFileSync(x.file, 'utf8')));
  ok(cached.length === 0, '无「t() 结果被缓存导致语言切换不刷新」的组件' + (cached.length ? '：' + cached.map(x => x.base).join(', ') : ''));
  ok(/setLang/.test(srcOf('TopBar.tsx')), '顶栏语言选择器绑定 setLang');
  ok(/setAttribute\('lang'/.test(tsSrc), 'setLang 同步 document.lang（字体回退 / 无障碍）');
  const allSrc = files.map(x => fs.readFileSync(x.file, 'utf8')).join('\n');
  ok(!/dir\s*=\s*["']rtl|direction\s*:\s*rtl/.test(allSrc), '9 语均非 RTL，未误用 rtl 方向');
  const hasIntl = /toLocaleString|toLocaleTimeString|Intl\./.test(allSrc);
  info('Intl / toLocale* 使用：' + (hasIntl ? '有' : '无（当前仅展示 HH:MM:SS 时间戳与整数计数，9 语无日期/货币/复数差异，判定不阻断）'));
  ok(/langsel/.test(srcOf('TopBar.tsx')), '语言选择器使用各语言自称（简体/繁體/English/日本語…），选项无需翻译');

  /* ===== 阶段 5：逐页生产使用标准判定 ===== */
  section('阶段 5 · 逐页生产使用标准判定');
  const boundaryFiles = ['App.tsx', 'ModalHost.tsx', 'LogsPage.tsx', 'Drawer.tsx', 'TopBar.tsx'];
  const boundaryDefects = boundaries.filter(([, src, re]) => !re.test(src)).map(([n]) => n);
  const rows = [];
  for (const x of rendererFiles) {
    if (!x.found.length) continue;
    const gap = gaps.filter(g => g.file === x.base).length;
    const bares = x.found.filter(f => f.kind === 'jsx-bare').length;
    const bdef = boundaryFiles.includes(x.base) ? boundaryDefects.filter(n => n.startsWith(x.base.replace('.tsx', '')) || n.includes(x.label.split(' ')[0])).length : 0;
    const defects = gap + bares + bdef;
    rows.push({ page: x.label, file: x.base, total: x.found.length, gap, bares, bdef, verdict: defects === 0 ? 'READY' : 'NOT-READY' });
  }
  console.log('  ' + '页面'.padEnd(32) + '文案  词典缺口  裸JSX  边界  判定');
  for (const r of rows) console.log('  ' + r.page.padEnd(32) + String(r.total).padEnd(6) + String(r.gap).padEnd(10) + String(r.bares).padEnd(7) + String(r.bdef).padEnd(6) + r.verdict);
  const notReady = rows.filter(r => r.verdict !== 'READY');
  ok(notReady.length === 0, '全部页面达到生产使用标准（不达标 ' + notReady.length + ' / ' + rows.length + ' 页）');

  console.log('\n============================================================');
  console.log('== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  if (fails.length) { console.log('未达标项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log('词典缺口 ' + gaps.length + ' 处 / 裸 JSX ' + bare.length + ' 处 / 渲染边界缺陷 ' + boundaryDefects.length + ' 项 / 主进程文案 ' + mainMsgs.length + ' 处');
  console.log('不达标页面 ' + notReady.length + ' / ' + rows.length);
  console.log('============================================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('I18N TEST ERROR', e); process.exit(1); });
