/* 追加 i18n 词典键（9 语），保持既有缩进格式
 * 运行：node scripts/add-i18n-keys.js
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'src', 'renderer', 'i18n-dict.json');
const dict = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 新增键：[简体, 繁, en, ja, ko, fr, es, de, pt]
const NEW = {
  '启动失败：': [
    '启动失败：', '啟動失敗：', 'Start failed: ', '起動失敗：', '시작 실패: ',
    'Échec du démarrage : ', 'Error de inicio: ', 'Startfehler: ', 'Falha ao iniciar: '
  ],
  '命令不存在或路径无法访问：': [
    '命令不存在或路径无法访问：', '命令不存在或路徑無法存取：',
    'Command not found or path not accessible: ',
    'コマンドが存在しないか、パスにアクセスできません：',
    '명령이 존재하지 않거나 경로에 접근할 수 없습니다: ',
    'Commande introuvable ou chemin inaccessible : ',
    'Comando no encontrado o ruta inaccesible: ',
    'Befehl nicht gefunden oder Pfad nicht zugänglich: ',
    'Comando não encontrado ou caminho inacessível: '
  ],
  '没有执行权限：': [
    '没有执行权限：', '沒有執行權限：',
    'Permission denied: ', '実行権限がありません：', '실행 권한이 없습니다: ',
    'Permission refusée : ', 'Permiso denegado: ', 'Ausführungsberechtigung fehlt: ',
    'Permissão negada: '
  ],
  '命令含未展开的占位符': [
    '命令含未展开的占位符', '命令含未展開的佔位符',
    'Command contains unexpanded placeholders',
    'コマンドに未展開のプレースホルダーが含まれています',
    '명령에 확장되지 않은 자리표시자가 포함되어 있습니다',
    'La commande contient des espaces réservés non développés',
    'El comando contiene marcadores de posición sin expandir',
    'Der Befehl enthält nicht aufgelöste Platzhalter',
    'O comando contém marcadores de posição não expandidos'
  ],
  ': 命令含未展开的占位符': [
    ': 命令含未展开的占位符', ': 命令含未展開的佔位符',
    ': command contains unexpanded placeholders',
    ': コマンドに未展開のプレースホルダーが含まれています',
    ': 명령에 확장되지 않은 자리표시자가 포함되어 있습니다',
    ': la commande contient des espaces réservés non développés',
    ': el comando contiene marcadores de posición sin expandir',
    ': der Befehl enthält nicht aufgelöste Platzhalter',
    ': o comando contém marcadores de posição não expandidos'
  ]
};

let added = 0;
for (const [k, v] of Object.entries(NEW)) {
  if (k in dict) { console.log('SKIP（已存在）:', JSON.stringify(k)); continue; }
  dict[k] = v;
  added++;
  console.log('ADD:', JSON.stringify(k));
}

fs.writeFileSync(FILE, JSON.stringify(dict, null, 2) + '\n', 'utf8');
console.log('\n新增 ' + added + ' 键，总键数 ' + Object.keys(dict).length);
