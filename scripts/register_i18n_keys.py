import json, io

path = r'C:\Users\lzp\WorkBuddy\spaces\2026_11_14_22-15-44\app\src\renderer\i18n-dict.json'
with io.open(path, 'r', encoding='utf-8') as f:
    d = json.load(f)

new_keys = {
    # GroupEditor.tsx 字符串拼接片段
    '组合「': [
        '组合「',
        '組合「',
        'Group «',
        'グループ「',
        '그룹「',
        'Groupe «',
        'Grupo «',
        'Gruppe «',
        'Grupo «'
    ],
    '」已存在，名称必须唯一': [
        '」已存在，名称必须唯一',
        '」已存在，名稱必須唯一',
        '» already exists, name must be unique',
        '」は既に存在します。名前は一意である必要があります',
        '」은(는) 이미 존재합니다. 이름은 고유해야 합니다',
        '» existe déjà ; le nom doit être unique',
        '» ya existe; el nombre debe ser único',
        '» existiert bereits; der Name muss eindeutig sein',
        '» já existe; o nome deve ser único'
    ],
    '」已删除：': [
        '」已删除：',
        '」已刪除：',
        '» deleted:',
        '」を削除しました：',
        '」를 삭제했습니다：',
        '» supprimé :',
        '» eliminado:',
        '» gelöscht:',
        '» exclu:'
    ],
    ' 个成员已回到平铺列表': [
        ' 个成员已回到平铺列表',
        ' 個成員已回到平鋪列表',
        ' members have returned to the flat list',
        ' 個のメンバーがフラットリストに戻りました',
        ' 개 멤버가 플랫 목록으로 돌아왔습니다',
        ' membres sont retournés à la liste plate',
        ' miembros han vuelto a la lista plana',
        ' Mitglieder sind zur flachen Liste zurückgekehrt',
        ' membros retornaram à lista plana'
    ],
    # GroupCard.tsx 确认框 body（模板字符串，作为整体 key 注册）
    '删除「<b>${name}</b>」后，${items.length} 个成员将回到平铺列表，<b>服务本身不受影响</b>，组合配置将被彻底移除，此操作不可撤销。': [
        '删除「<b>${name}</b>」后，${items.length} 个成员将回到平铺列表，<b>服务本身不受影响</b>，组合配置将被彻底移除，此操作不可撤销。',
        '刪除「<b>${name}</b>」後，${items.length} 個成員將回到平鋪列表，<b>服務本身不受影響</b>，組合配置將被徹底移除，此操作不可撤銷。',
        'Delete "<b>${name}</b>", then ${items.length} members will return to the flat list, <b>services themselves are unaffected</b>, group config will be completely removed, this operation is irreversible.',
        '「<b>${name}</b>」を削除した後、${items.length} 個のメンバーがフラットリストに戻ります。<b>サービス自体には影響ありません</b>。グループ設定は完全に削除され、この操作は元に戻せません。',
        '"<b>${name}</b>" を削除した後、${items.length} 人のメンバーがフラットリストに戻ります。<b>サービス自体には影響ありません</b>。グループ設定は完全に削除され、この操作は元に戻せません。',
        '« <b>${name}</b> » supprimé ; ${items.length} membres retourneront à la liste plate. <b>Les services eux-mêmes ne sont pas affectés</b>. La configuration du groupe sera complètement supprimée, cette opération est irréversible.',
        'Eliminar "<b>${name}</b>", luego ${items.length} miembros volverán a la lista plana. <b>Los servicios en sí no se ven afectados</b>. La configuración del grupo se eliminará por completo, esta operación es irreversible.',
        '"<b>${name}</b>" löschen; danach kehren ${items.length} Mitglieder zur flachen Liste zurück. <b>Die Dienste selbst sind nicht betroffen</b>. Die Gruppe wird vollständig entfernt, diese Aktion ist nicht rückgängig zu machen.',
        'Excluir "<b>${name}</b>", depois ${items.length} membros retornarão à lista plana. <b>Os próprios serviços não são afetados</b>. A configuração do grupo será completamente removida, esta operação é irreversível.'
    ],
}

items = list(d.items())
# 插入到 '删除组合' 之后
insert_pos = len(items)
for i, (k, v) in enumerate(items):
    if k == '删除组合':
        insert_pos = i + 1
        break

new_items = items[:insert_pos] + list(new_keys.items()) + items[insert_pos:]
d.clear()
for k, v in new_items:
    d[k] = v

with io.open(path, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
    f.write('\n')

print('Added', len(new_keys), 'new keys. Total:', len(d))
for k in new_keys:
    print('  +', k[:60], '->', len(new_keys[k]), 'languages')
