import json, io

path = r'C:\Users\lzp\WorkBuddy\spaces\2026_11_14_22-15-44\app\src\renderer\i18n-dict.json'
with io.open(path, 'r', encoding='utf-8') as f:
    d = json.load(f)

# 1. 删除旧的无反引号模板字符串 key（如果存在）
old_template_key = '删除「<b>${name}</b>」后，${items.length} 个成员将回到平铺列表，<b>服务本身不受影响</b>，组合配置将被彻底移除，此操作不可撤销。'
if old_template_key in d:
    del d[old_template_key]
    print('Removed old template key (no backticks)')

# 2. 注册带反引号的模板字符串 key（源代码中 node.getText 会包含反引号）
new_template_key = '`删除「<b>${name}</b>」后，${items.length} 个成员将回到平铺列表，<b>服务本身不受影响</b>，组合配置将被彻底移除，此操作不可撤销。`'
d[new_template_key] = [
    '`删除「<b>${name}</b>」后，${items.length} 个成员将回到平铺列表，<b>服务本身不受影响</b>，组合配置将被彻底移除，此操作不可撤销。`',
    '`刪除「<b>${name}</b>」後，${items.length} 個成員將回到平鋪列表，<b>服務本身不受影響</b>，組合配置將被徹底移除，此操作不可撤銷。`',
    '`Delete "<b>${name}</b>", then ${items.length} members will return to the flat list, <b>services themselves are unaffected</b>, group config will be completely removed, this operation is irreversible.`',
    '`「<b>${name}</b>」を削除した後、${items.length} 個のメンバーがフラットリストに戻ります。<b>サービス自体には影響ありません</b>。グループ設定は完全に削除され、この操作は元に戻せません。`',
    '`"<b>${name}</b>" を削除した後、${items.length} 人のメンバーがフラットリストに戻ります。<b>サービス自体には影響ありません</b>。グループ設定は完全に削除され、この操作は元に戻せません。`',
    '`« <b>${name}</b> » supprimé ; ${items.length} membres retourneront à la liste plate. <b>Les services eux-mêmes ne sont pas affectés</b>. La configuration du groupe sera complètement supprimée, cette opération est irréversible.`',
    '`Eliminar "<b>${name}</b>", luego ${items.length} miembros volverán a la lista plana. <b>Los servicios en sí no se ven afectados</b>. La configuración del grupo se eliminará por completo, esta operación es irreversible.`',
    '`"<b>${name}</b>" löschen; danach kehren ${items.length} Mitglieder zur flachen Liste zurück. <b>Die Dienste selbst sind nicht betroffen</b>. Die Gruppe wird vollständig entfernt, diese Aktion ist nicht rückgängig zu machen.`',
    '`Excluir "<b>${name}</b>", depois ${items.length} membros retornarão à lista plana. <b>Os próprios serviços não são afetados</b>. A configuração do grupo será completamente removida, esta operação é irreversível.`'
]

# 3. 注册 schedule.ts 中的 4 个原有缺口（活动日志字符串）
schedule_keys = {
    '启动失败：未配置启动命令': [
        '启动失败：未配置启动命令',
        '啟動失敗：未配置啟動命令',
        'Start failed: start command not configured',
        '起動失敗：起動コマンドが設定されていません',
        '시작 실패: 시작 명령이 구성되지 않았습니다',
        'Échec du démarrage : commande de démarrage non configurée',
        'Error de inicio: comando de inicio no configurado',
        'Startfehler: Startbefehl nicht konfiguriert',
        'Falha ao iniciar: comando de inicialização não configurado'
    ],
    '启动失败：内置动作不可用': [
        '启动失败：内置动作不可用',
        '啟動失敗：內置動作不可用',
        'Start failed: built-in action not available',
        '起動失敗：組み込みアクションを利用できません',
        '시작 실패: 기본 작업을 사용할 수 없습니다',
        'Échec du démarrage : action intégrée indisponible',
        'Error de inicio: acción integrada no disponible',
        'Startfehler: eingebaute Aktion nicht verfügbar',
        'Falha ao iniciar: ação interna não disponível'
    ],
    ' 启动失败：内置动作不可用 ': [
        ' 启动失败：内置动作不可用 ',
        ' 啟動失敗：內置動作不可用 ',
        ' Start failed: built-in action not available ',
        ' 起動失敗：組み込みアクションを利用できません ',
        ' 시작 실패: 기본 작업을 사용할 수 없습니다 ',
        ' Échec du démarrage : action intégrée indisponible ',
        ' Error de inicio: acción integrada no disponible ',
        ' Startfehler: eingebaute Aktion nicht verfügbar ',
        ' Falha ao iniciar: ação interna não disponível '
    ],
    '启动失败': [
        '启动失败',
        '啟動失敗',
        'Start failed',
        '起動失敗',
        '시작 실패',
        'Échec du démarrage',
        'Error de inicio',
        'Startfehler',
        'Falha ao iniciar'
    ],
}

# 合并所有新 key
all_new = {new_template_key: d[new_template_key]}
all_new.update(schedule_keys)

items = list(d.items())
# 插入到 '删除组合' 之后
insert_pos = len(items)
for i, (k, v) in enumerate(items):
    if k == '删除组合':
        insert_pos = i + 1
        break

new_items = items[:insert_pos] + list(all_new.items()) + items[insert_pos:]
d.clear()
for k, v in new_items:
    d[k] = v

with io.open(path, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
    f.write('\n')

print('Total keys:', len(d))
print('Added template key with backticks')
print('Added 4 schedule.ts keys')
