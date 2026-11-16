/* ============================================================
 * 国际化（9 语）· 主进程文案可译性测试
 *
 * 背景：主进程（活动日志 / 校验错误 / 原生对话框）产生的文案本身是简体，
 * 统一在渲染边界（LogsPage / Drawer / ModalHost / Toast）过 t() 翻译。
 * test/i18n.test.js 的阶段 3C 只校验「渲染边界存在」，不校验
 * 「主进程的中文片段是否真的都在词典里」——本测试补上这一环：
 * 把主进程 / 共享层里每一处中文片段喂给真实 tr()，检查 6 个
 * 非汉字语种（en/ko/fr/es/de/pt）下是否还有中文残留。
 *
 * 引擎用 TypeScript 编译器转译 i18n.ts 后在桩环境真实加载，测的是产品代码。
 * 运行：node test/i18n-main.test.js
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const APP = path.join(__dirname, '..');
const R = path.join(APP, 'src', 'renderer');
const MAIN = path.join(APP, 'src', 'main');
const SHARED = path.join(APP, 'src', 'shared');
const dict = JSON.parse(fs.readFileSync(path.join(R, 'i18n-dict.json'), 'utf8'));
// 不使用汉字的目标语种：出现汉字即为未翻译残留
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
const mm = new Mod('i18n.probe.js');
mm.filename = path.join(R, 'i18n.probe.js');
mm.paths = Mod._nodeModulePaths(R);
const origReq = mm.require.bind(mm);
mm.require = (r) => (String(r).includes('i18n-dict.json') ? dict : origReq(r));
mm._compile(jsSrc, mm.filename);
const I = mm.exports;
const translate = (s, lang) => { I.setLang(lang); return I.tr(s); };

/* ---------- AST 扫描：抓出主进程 / 共享层的全部中文片段 ---------- */
function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  function walk(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CJK.test(node.text)) found.push({ line: lineOf(node), text: node.text });
    } else if (ts.isTemplateExpression(node)) {
      const full = node.getText(sf);
      if (CJK.test(full)) found.push({ line: lineOf(node), text: full.replace(/\s+/g, ' ').slice(0, 200) });
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);
  return found;
}
const listSrc = (dir) => fs.readdirSync(dir).filter(f => /\.tsx?$/.test(f)).map(f => path.join(dir, f));
const files = [
  ...listSrc(MAIN).map(f => ({ file: f, area: 'main' })),
  ...listSrc(SHARED).map(f => ({ file: f, area: 'shared' }))
];

(async () => {
  section('主进程 / 共享层中文片段可译性');
  const perFile = files.map(x => ({ ...x, base: path.basename(x.file), found: scanFile(x.file) }));
  const total = perFile.reduce((a, x) => a + x.found.length, 0);
  info('扫描 ' + perFile.length + ' 个文件，含中文字符串 ' + total + ' 处');

  const gaps = [];
  for (const x of perFile) {
    for (const item of x.found) {
      for (const lg of LATIN_LANGS) {
        const out = translate(item.text, lg);
        if (CJK.test(out)) { gaps.push({ ...item, file: x.base, lang: lg, rest: out }); break; }
      }
    }
  }
  I.setLang('zh-CN');
  const uniq = [...new Set(gaps.map(g => g.file + ':' + g.text))];
  ok(gaps.length === 0, '主进程/共享层 ' + total + ' 处中文片段在 6 个非汉字语种下均可翻译（缺口 ' + gaps.length + ' 处 / 去重 ' + uniq.length + ' 条）');
  gaps.slice(0, 30).forEach(g => info('  缺口 ' + g.file + ':' + g.line + ' [' + g.lang + '] ' + JSON.stringify(g.text.slice(0, 60)) + ' → ' + JSON.stringify(g.rest.slice(0, 90))));

  // 原生文件选择框：标题与过滤器名由渲染器按当前语言下发
  section('原生文件选择框文案');
  const ipc = fs.readFileSync(path.join(MAIN, 'ipc.ts'), 'utf8');
  ok(/labels\?\.title/.test(ipc) && /labels\?\.all/.test(ipc), '主进程使用渲染器下发的本地化标题 / 过滤器名');
  const editor = fs.readFileSync(path.join(R, 'components', 'ServiceEditor.tsx'), 'utf8');
  const dialogKeys = ['选择执行器（可执行文件）', '选择脚本文件', '可执行文件', '所有文件', '脚本 / 可执行文件', 'Windows 批处理', 'Shell 脚本'];
  const missing = dialogKeys.filter(k => !(k in dict));
  ok(missing.length === 0, '原生对话框 ' + dialogKeys.length + ' 条文案均已收录 9 语' + (missing.length ? '（缺：' + missing.join(', ') + '）' : ''));
  ok(dialogKeys.every(k => /t\('/.test(editor) && editor.includes(k)), '渲染器逐条经 t() 传给主进程');
  const noCjk = dialogKeys.every(k => LATIN_LANGS.every(lg => !CJK.test(translate(k, lg))));
  ok(noCjk, '原生对话框文案在 6 个非汉字语种下无中文残留');

  // 翻译边界唯一性：toast / 抽屉 / 弹窗三条通道都在渲染边界统一过 t()，
  // 载荷必须携带简体原文；若在投递前先 t() 一次，切语言后会残留旧语种（双重翻译）。
  section('翻译边界唯一性（禁止双重翻译）');
  const rendererFiles = [
    ...listSrc(R).map(f => ({ file: f, name: path.basename(f) })),
    ...listSrc(path.join(R, 'components')).map(f => ({ file: f, name: path.basename(f) }))
  ];
  const dbl = [];
  for (const x of rendererFiles) {
    const src = fs.readFileSync(x.file, 'utf8');
    // toast / openDrawer 载荷里出现独立的 t( 即双重翻译（排除 guardText( 这类标识符）
    const re = /(ui\.toast\((?:[^()]|\([^()]*\))*?(?<![A-Za-z0-9_$])t\()|(openDrawer\(\{[^}]*?(?<![A-Za-z0-9_$])t\()/g;
    let m;
    while ((m = re.exec(src))) {
      dbl.push(x.name + ' → ' + m[0].slice(0, 60));
    }
  }
  ok(dbl.length === 0, '无「投递前预翻译 + 渲染边界再翻译」的双重翻译' + (dbl.length ? '：' + dbl.join(' | ') : ''));

  const appSrc = fs.readFileSync(path.join(R, 'App.tsx'), 'utf8');
  ok(/\{t\(toastMsg\)\}/.test(appSrc), 'Toast 通道在 App 统一过 t()（渲染边界唯一）');
  const drawerSrc = fs.readFileSync(path.join(R, 'components', 'Drawer.tsx'), 'utf8');
  ok(/\{t\(drawer\.title\)\}/.test(drawerSrc), '抽屉标题在 Drawer 统一过 t()（渲染边界唯一）');
  const modalSrc = fs.readFileSync(path.join(R, 'components', 'ModalHost.tsx'), 'utf8');
  ok(/t\(modal\.title/.test(modalSrc) && /t\(modal\.body/.test(modalSrc) && /t\(modal\.okText/.test(modalSrc),
    '弹窗标题 / 正文 / 按钮在 ModalHost 统一过 t()（渲染边界唯一）');

  console.log('\n============================================================');
  console.log('== ' + pass + ' PASS / ' + fail + ' FAIL ==');
  if (fails.length) { console.log('未达标项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log('主进程/共享层中文片段 ' + total + ' 处 / 翻译缺口 ' + gaps.length + ' 处');
  console.log('============================================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('I18N-MAIN TEST ERROR', e); process.exit(1); });
