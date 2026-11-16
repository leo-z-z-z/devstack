/* 复数表生成器：由 i18n-dict.json 生成 i18n-plural.json
 *
 * i18n-plural.json 是「计数感知复数」的第二层依赖——词典是「文本片段替换」，
 * 处理不了单复数（1 项服务 → "1 services"）。本脚本把复数表固化下来：
 *   - "other"（复数）形态直接沿用 i18n-dict.json 里已有的译文（零回归风险）
 *   - "one"（单数）形态是下方手工撰写的译文
 *   - zh / ja / ko 不变位，单数形态与复数形态相同
 *
 * 维护约定：改词条请改本脚本后重新 `node scripts/gen-plural.js`，
 * 不要直接手改 i18n-plural.json（会被下次生成覆盖）。
 * 若词典里删掉了某个可数名词短语，本脚本会报错退出，避免复数表与词典脱节。
 */
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');
const dict = JSON.parse(fs.readFileSync(path.join(APP, 'src', 'renderer', 'i18n-dict.json'), 'utf8'));

const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'es', 'de', 'pt'];
const IDX = { 'zh-CN': 0, 'zh-TW': 1, en: 2, ja: 3, ko: 4, fr: 5, es: 6, de: 7, pt: 8 };

// [词典键, {en,fr,es,de,pt} 的单数形态, {lang: 覆写 other} 的可选尾空格修正]
const ENTRIES = [
  [' 项', { en: ' item', fr: ' élément', es: ' elemento', de: ' Eintrag', pt: ' item' }],
  ['项错误', { en: ' error', fr: ' erreur', es: ' error', de: ' Fehler', pt: ' erro' }],
  ['行', { en: ' line', fr: ' ligne', es: ' línea', de: ' Zeile', pt: ' linha' }],
  ['个组合', { en: ' group', fr: ' groupe', es: ' grupo', de: ' Gruppe', pt: ' grupo' }],
  ['项服务 ·', { en: ' service ·', fr: ' service ·', es: ' servicio ·', de: ' Dienst ·', pt: ' serviço ·' },
    { 'zh-CN': '项服务 ·', 'zh-TW': '項服務 ·', en: ' services ·', ja: ' 件のサービス ·', ko: ' 개 서비스 ·', fr: ' services ·', es: ' servicios ·', de: ' Dienste ·', pt: ' serviços ·' }],
  [' 项端口冲突', { en: ' port conflict', fr: ' conflit de ports', es: ' conflicto de puerto', de: ' Portkonflikt', pt: ' conflito de porta' }],
  [' 项待处理 · 点击查看', { en: ' pending item · click to view', fr: ' élément en attente · cliquer pour voir', es: ' pendiente · clic para ver', de: ' ausstehend · Klick für Details', pt: ' pendente · clique para ver' }],
  [' 项执行中（', { en: ' item still running (', fr: " élément en cours d'exécution (", es: ' elemento en ejecución (', de: ' Eintrag laufend (', pt: ' item em execução (' }],
  [' 个成员 · 加入后排在组内末尾', { en: ' member · new members are appended to the end', fr: ' membre · les nouveaux sont ajoutés à la fin', es: ' miembro · los nuevos se añaden al final', de: ' Mitglied · neue werden am Ende angehängt', pt: ' membro · novos são adicionados ao fim' }],
  [' 项（', { en: ' item (', fr: ' élément (', es: ' elemento (', de: ' Eintrag (', pt: ' item (' }],
  [' 项：', { en: ' item: ', fr: ' élément : ', es: ' elemento: ', de: ' Eintrag: ', pt: ' item: ' }],
  [' 项未执行', { en: ' item not executed', fr: ' élément non exécuté', es: ' elemento sin ejecutar', de: ' Eintrag nicht ausgeführt', pt: ' item não executado' }],
  [' 项启动中', { en: ' starting', fr: ' en démarrage', es: ' iniciando', de: ' im Start', pt: ' iniciando' }],
  [' 项停止中', { en: ' stopping', fr: " en cours d'arrêt", es: ' deteniéndose', de: ' werden gestoppt', pt: ' parando' }],
  [' 项启动中 · ', { en: ' starting · ', fr: ' en démarrage · ', es: ' iniciando · ', de: ' im Start · ', pt: ' iniciando · ' }],
  [' 项运行中的服务：', { en: ' running service: ', fr: " service en cours d'exécution : ", es: ' servicio en ejecución: ', de: ' laufender Dienst: ', pt: ' serviço em execução: ' }],
  [' 项已停止的服务：', { en: ' stopped service: ', fr: ' service arrêté : ', es: ' servicio detenido: ', de: ' gestoppter Dienst: ', pt: ' serviço parado: ' }],
  [' 项未分组组件并行安全停止；', { en: ' ungrouped component is stopped safely in parallel; ', fr: ' composant non groupé est arrêté en parallèle en toute sécurité ; ', es: ' componente no agrupado se detiene de forma segura en paralelo; ', de: ' nicht gruppierte Komponente wird sicher parallel gestoppt; ', pt: ' componente não agrupado é parado com segurança em paralelo; ' }],
  [' 项未分组组件并行发起；', { en: ' ungrouped component is started in parallel; ', fr: ' composant non groupé démarré en parallèle ; ', es: ' componente no agrupado se inicia en paralelo; ', de: ' nicht gruppierte Komponente wird parallel gestartet; ', pt: ' componente não agrupado é iniciado em paralelo; ' }],
  [' 项 / 未分组项与组合之间并行，组合内', { en: ' item / ungrouped items and groups run in parallel; within a group ', fr: ' élément / les éléments non groupés et les groupes sont parallèles ; dans un groupe ', es: ' elemento / los elementos no agrupados y los grupos se ejecutan en paralelo; dentro de un grupo ', de: ' Eintrag / nicht gruppierte Elemente und Gruppen laufen parallel; innerhalb einer Gruppe ', pt: ' item / itens não agrupados e grupos rodam em paralelo; dentro de um grupo ' }],
  [' 项（完整清单见主面板「端口冲突」）', { en: ' item (full list in the main Port conflicts popup)', fr: ' élément (liste complète dans « Conflits de ports »)', es: ' elemento (lista completa en « Conflictos de puerto »)', de: ' Eintrag (vollständige Liste in « Portkonflikte »)', pt: ' item (lista completa em « Conflitos de porta »)' }],
  [' 个组合各自按组内从下到上倒序串行、等停止命令退出并确认端口释放后才停下一项，组合之间并行；不会强制杀进程。', {
    en: ' group runs in reverse order within the group, waiting for the stop command to exit and the port to be released before the next one; groups run in parallel; no process is force-killed.',
    fr: " groupe s'exécute en série dans l'ordre inverse du groupe, en attendant la fin de la commande d'arrêt et la libération du port avant le suivant ; les groupes sont parallèles ; aucun processus n'est forcé à s'arrêter.",
    es: ' grupo se ejecuta en serie de abajo arriba dentro de cada grupo, esperando a que salga el comando de parada y se libere el puerto antes del siguiente; los grupos se ejecutan en paralelo; no se fuerza la terminación de ningún proceso.',
    de: ' Gruppe läuft innerhalb der Gruppe seriell von unten nach oben; erst nach Ende des Stop-Befehls und Freigabe des Ports folgt der nächste; die Gruppen laufen parallel; Prozesse werden nicht zwangsweise beendet.',
    pt: ' grupo é executado em série de baixo para cima dentro do grupo, aguardando a saída do comando de parada e a liberação da porta antes do próximo; os grupos rodam em paralelo; nenhum processo é encerrado à força.'
  }],
  [' 个组合各自按组内自上而下串行、等上一项就绪再启动下一项，组合之间并行。', {
    en: ' group runs top-down within the group, waiting for the previous one to be ready before starting the next; groups run in parallel.',
    fr: " groupe s'exécute en série de haut en bas dans le groupe, en attendant que l'élément précédent soit prêt avant de lancer le suivant ; les groupes sont parallèles.",
    es: ' grupo se ejecuta en serie de arriba abajo dentro del grupo, esperando a que el anterior esté listo antes de iniciar el siguiente; los grupos se ejecutan en paralelo.',
    de: ' Gruppe läuft innerhalb der Gruppe seriell von oben nach unten; erst wenn der vorherige bereit ist, folgt der nächste; die Gruppen laufen parallel.',
    pt: ' grupo é executado em série de cima para baixo dentro do grupo, aguardando o anterior ficar pronto antes de iniciar o próximo; os grupos rodam em paralelo.'
  }],
  [' 个成员会回到平铺列表，', {
    en: ' member returns to the flat list,',
    fr: ' membre revient à la liste plate,',
    es: ' miembro vuelve a la lista plana,',
    de: ' Mitglied kehrt in die flache Liste zurück,',
    pt: ' membro volta à lista plana,'
  }],
  [' 个成员按勾选顺序启动', {
    en: ' member starts in the order they were checked',
    fr: " membre démarre dans l'ordre de sélection",
    es: ' miembro se inicia en el orden en que se marcaron',
    de: ' Mitglied startet in der Ankreuzreihenfolge',
    pt: ' membro inicia na ordem em que foram marcados'
  }]
];

// 占位符型整句：只能通过 trN() 使用（数字是 {n}，渲染边界看不到真实数字）
const PHRASE_ENTRIES = [
  ['正在全量刷新 {n} 项服务', {
    en: 'Full refresh of {n} service',
    fr: 'Actualisation complète de {n} service',
    es: 'Actualización completa de {n} servicio',
    de: 'Vollständige Aktualisierung von {n} Dienst',
    pt: 'Atualização completa de {n} serviço'
  }],
  ['正在刷新 {n} 项已启动服务', {
    en: 'Refreshing {n} started service',
    fr: 'Actualisation de {n} service démarré',
    es: 'Actualizando {n} servicio iniciado',
    de: '{n} gestarteter Dienst wird aktualisiert',
    pt: 'Atualizando {n} serviço iniciado'
  }]
];

// 每种语言的复数规则（顺序与 LANGS 一致）：
//   none = 不变位（中文 / 日文 / 韩文），单数形态与复数形态相同
//   one  = 仅数量为 1 时用单数（英语 / 西班牙语 / 德语 / 葡萄牙语）
//   le1  = 数量 ≤ 1 时用单数（法语：0 与 1 都用单数）
const out = {
  rules: ['none', 'none', 'one', 'none', 'none', 'le1', 'one', 'one', 'one'],
  entries: {},
  // 前置修饰词条目：中文是「修饰词 + 数字 + 名词」，译文里修饰词要跟着名词走
  // （中文「另有 2 项」→ 英文「2 more items」），因此用整句模板 + {n} 占位符。
  // 匹配时只认中文形态，译文可自由调整词序。
  pre: [
    {
      pre: ' · 另有 ',
      noun: '项',
      forms: [
        [' · 另有 {n} 项', ' · 另有 {n} 项'],
        [' · 另有 {n} 項', ' · 另有 {n} 項'],
        [' · {n} more item', ' · {n} more items'],
        [' · 他に {n} 件', ' · 他に {n} 件'],
        [' · 외 {n}개', ' · 외 {n}개'],
        [' · {n} autre élément', ' · {n} autres éléments'],
        [' · {n} otro elemento', ' · {n} otros elementos'],
        [' · {n} weiterer Eintrag', ' · {n} weitere Einträge'],
        [' · {n} outro item', ' · {n} outros itens']
      ]
    }
  ]
};
const missing = [];
for (const [key, one] of ENTRIES) {
  if (!dict[key]) { missing.push(key); continue; }
  const pkey = key.replace(/^\s+/, '');
  const other = dict[key];
  const pair = LANGS.map((lg) => {
    const i = IDX[lg];
    const otherForm = other[i];
    if (one[lg]) return [one[lg], otherForm];
    return [otherForm, otherForm];   // zh / ja / ko 不变位
  });
  out.entries[pkey] = pair;
}
for (const [key, one] of PHRASE_ENTRIES) {
  if (!dict[key]) { missing.push(key); continue; }
  const other = dict[key];
  out.entries[key] = LANGS.map((lg) => {
    const i = IDX[lg];
    return one[lg] ? [one[lg], other[i]] : [other[i], other[i]];
  });
}

// 「项服务 ·」的 other 形态去掉尾随空格：新的调用点里空格由源串自带，避免双空格
out.entries['项服务 ·'] = out.entries['项服务 ·'].map((p, i) => [p[0], p[1].replace(/\s+$/, '')]);

// 「行」原词典值无前导空格（当时空格来自 JSX），新的调用点空格由源串提供 → 统一补上前导空格
out.entries['行'] = out.entries['行'].map(p => [p[0], p[1].replace(/^/, ' ')]);

// 「项待处理 · 点击查看」补上名词，读起来是「N pending items」
out.entries['项待处理 · 点击查看'] = out.entries['项待处理 · 点击查看'].map((p, i) => [
  p[0],
  i === 2 ? ' pending items · click to view'
    : i === 5 ? ' éléments en attente · cliquer pour voir'
      : i === 6 ? ' pendientes · clic para ver'
        : i === 8 ? ' pendentes · clique para ver'
          : p[1]
]);

// 德语统一用「Eintrag / Einträge」（词典里另有两条曾用「Elemente」，此处对齐）
out.entries['项执行中（'][7] = [' Eintrag laufend (', ' Einträge laufend ('];
out.entries['项 / 未分组项与组合之间并行，组合内'][7] = [
  ' Eintrag / nicht gruppierte Elemente und Gruppen laufen parallel; innerhalb einer Gruppe ',
  ' Einträge / nicht gruppierte Elemente und Gruppen laufen parallel; innerhalb einer Gruppe '
];

if (missing.length) { console.error('词典缺键：', missing); process.exit(1); }
fs.writeFileSync(path.join(APP, 'src', 'renderer', 'i18n-plural.json'),
  JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('写入 i18n-plural.json，条目数 =', Object.keys(out.entries).length);
