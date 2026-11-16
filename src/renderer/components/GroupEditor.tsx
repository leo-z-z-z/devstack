/* 分组管理：先选分组，再选成员，点保存完成关联 */
import { useState, useRef, useEffect } from 'react';
import { useUi } from '../uistate';
import { useUiState } from '../store';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { GroupDefinition, ServiceDefinition } from '../../shared/types';

export function GroupEditor({ group, renameOnly = false }: { group: GroupDefinition | null; renameOnly?: boolean }): JSX.Element {
  const { t } = useI18n();
  const ui = useUi();
  const { snapshot } = useUiState();
  const services = snapshot?.services ?? [];
  const groups = snapshot?.groups ?? [];

  /* ---------- 仅重命名模式（轻量，来自 GroupCard 更多菜单）---------- */
  if (renameOnly && group) {
    const [name, setName] = useState(group.name);
    const onSave = async () => {
      const trimmed = name.trim();
      if (!trimmed) { const msg = t('分组名称不能为空'); ui.toast(msg); return; }
      const existing = groups.filter(g => g.id !== group!.id);
      if (existing.some(g => g.name.trim() === trimmed)) {
        const msg = t('分组「${name}」已存在，名称必须唯一').replace('${name}', trimmed);
        ui.toast(msg);
        return;
      }
      const g: GroupDefinition = { id: group.id, name: trimmed, collapsed: group.collapsed };
      await api.saveGroup(g, services.filter(s => s.gid === group.id).map(s => s.id));
      ui.closeModal();
      const msg = t('分组「${name}」已重命名').replace('${name}', trimmed);
      ui.toast(msg);
    };
    return (
      <>
        <div className="modalhead">
          <h3>{t('重命名分组 · ') + group.name}</h3>
          <div className="tools">
            <button className="btn" onClick={ui.closeModal}>{t('取消')}</button>
            <button className="btn primary" onClick={() => void onSave()}>{t('保存')}</button>
          </div>
        </div>
        <div className="card">
          <h4>{t('基本信息')}</h4>
          <div className="field">
            <label>{t('分组名称')}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('例如：ELK Stack / Redis 集群')} />
          </div>
        </div>
      </>
    );
  }

  /* ---------- 分组管理模式（主入口）---------- */
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGid, setSelectedGid] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string | null>(null); // 正在双击重命名的 gid
  const [renameDraft, setRenameDraft] = useState('');

  const [left, setLeft] = useState<string[]>([]);
  const [right, setRight] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [deletingGid, setDeletingGid] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  /* 重命名输入框出现后可靠聚焦并选中全文 */
  useEffect(() => {
    if (renameInput && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameInput]);

  /* 分组标签颜色搭配方案：bg + text，简洁美观 */
  const TAG_COLORS = [
    { bg: '#E0F2FE', text: '#0369A1' },   // 蓝
    { bg: '#D1FAE5', text: '#065F46' },   // 绿
    { bg: '#EDE9FE', text: '#5B21B6' },   // 紫
    { bg: '#FCE7F3', text: '#9D174D' },   // 粉
    { bg: '#FFEDD5', text: '#92400E' },   // 橙
    { bg: '#CCFBF1', text: '#115E59' },   // 青
    { bg: '#E0E7FF', text: '#3730A3' },   // 靛
    { bg: '#FEE2E2', text: '#B91C1C' },   // 红
    { bg: '#FEF3C7', text: '#854D0E' },   // 黄
    { bg: '#CFFAF8', text: '#134E4A' },   // 青蓝
  ];

  const tagColorFor = (gid: string) => {
    let hash = 0;
    for (let i = 0; i < gid.length; i++) {
      hash = ((hash << 5) - hash) + gid.charCodeAt(i);
      hash = hash & hash; // 转 32 位整数
    }
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  };

  const serviceById = (id: string) => services.find(s => s.id === id)!;
  const groupById = (gid: string) => groups.find(g => g.id === gid)!;
  const selectedGroup = selectedGid ? groupById(selectedGid) : null;

  /* 当选中的分组变化时，重新计算左右栏 */
  const onSelectGroup = (gid: string | null) => {
    setSelectedGid(gid);
    setRenameInput(null);
    if (!gid) { setLeft([]); setRight([]); return; }
    const currentServices = snapshot?.services ?? [];
    const memberIds = new Set(currentServices.filter(s => s.gid === gid).map(s => s.id));
    setRight(currentServices.filter(s => s.gid === gid).map(s => s.id));
    setLeft(currentServices.filter(s => !memberIds.has(s.id)).map(s => s.id));
  };

  const addOne = (id: string) => {
    setLeft(l => l.filter(x => x !== id));
    setRight(r => [...r, id]);
  };
  const removeOne = (id: string) => {
    setRight(r => r.filter(x => x !== id));
    setLeft(l => [...l, id]);
  };
  const addAll = () => {
    setRight(r => [...r, ...left.filter(x => !r.includes(x))]);
    setLeft([]);
  };
  const removeAll = () => {
    setLeft(l => [...l, ...right]);
    setRight([]);
  };

  /* 右栏拖拽排序 */
  const onDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    setDragIndex(index);
  };
  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoverIndex(index);
  };
  const onDragLeave = () => {
    setHoverIndex(null);
  };
  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const from = dragIndex;
    if (from === null || from === index) { setHoverIndex(null); return; }
    setRight(r => {
      const item = r[from];
      const next = r.filter((_, i) => i !== from);
      next.splice(index, 0, item);
      return next;
    });
    setDragIndex(null);
    setHoverIndex(null);
  };

  /* 新增分组 */
  const onAddGroup = async () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) { const msg = t('分组名称不能为空'); ui.toast(msg); return; }
    if (groups.some(g => g.name.trim() === trimmed)) {
      const msg = t('分组「${name}」已存在，名称必须唯一').replace('${name}', trimmed);
      ui.toast(msg);
      return;
    }
    const gid = 'g' + Date.now().toString(36);
    const g: GroupDefinition = { id: gid, name: trimmed, collapsed: false };
    await api.saveGroup(g, []);
    setNewGroupName('');
    // 刷新快照后重新选中新建的分组
    const refreshed = snapshot?.groups ?? [];
    const created = refreshed.find(g => g.id === gid);
    if (created) onSelectGroup(gid);
    const msg = t('分组「${name}」已新增').replace('${name}', trimmed);
    ui.toast(msg);
  };

  /* 保存：保存当前选中分组的成员配置 */
  const onSave = async () => {
    if (!selectedGid) { const msg = t('请先选择一个分组'); ui.toast(msg); return; }
    const g = groupById(selectedGid);
    await api.saveGroup(g, right);
    ui.closeModal();
    const msg = t('分组「${name}」成员已保存：').replace('${name}', g.name) + right.length + ' 个成员按顺序启动';
    ui.toast(msg);
  };

  /* 删除分组标签（带退场动画，动画结束后实际删除） */
  const onDeleteTag = async (gid: string) => {
    setDeletingGid(gid);
    const g = groups.find(x => x.id === gid);
    const gName = g?.name ?? gid;
    // 等待 250ms 动画完成后再执行真实删除
    setTimeout(async () => {
      await api.deleteGroup(gid);
      if (selectedGid === gid) onSelectGroup(null);
      setDeletingGid(null);
      const msg = t('分组「${name}」已删除：成员已回到平铺列表').replace('${name}', gName);
      ui.toast(msg);
    }, 250);
  };

  /* 开始双击重命名 */
  const onRenameStart = (gid: string, name: string) => {
    setRenameInput(gid);
    setRenameDraft(name);
  };

  /* 完成重命名 */
  const onRenameSave = async (gid: string) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) { setRenameInput(null); return; }
    const existing = groups.filter(g => g.id !== gid);
    if (existing.some(g => g.name.trim() === trimmed)) {
      const msg = t('分组「${name}」已存在，名称必须唯一').replace('${name}', trimmed);
      ui.toast(msg);
      return;
    }
    const g = groupById(gid);
    await api.saveGroup({ ...g, name: trimmed }, services.filter(s => s.gid === gid).map(s => s.id));
    setRenameInput(null);
    const msg = t('分组「${name}」已重命名').replace('${name}', trimmed);
    ui.toast(msg);
  };

  if (!snapshot) return <div className="page">{t('加载中…')}</div>;

  return (
    <>
      <div className="modalhead">
        <h3>{t('分组管理')}</h3>
        <div className="tools">
          <button className="btn" onClick={ui.closeModal}>{t('取消')}</button>
          <button className="btn primary" onClick={() => void onSave()}>{t('保存')}</button>
        </div>
      </div>

      {/* 基本信息：新增分组 + 已有分组列表 */}
      <div className="card">
        <div className="field">
          <label className="newgroup-label">{t('新增分组')}</label>
          <div className="newgroup-row">
            <input
              className="newgroup-input"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              placeholder={t('例如：ELK Stack / Redis 集群')}
              style={{ flex: 1, minWidth: 0 }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void onAddGroup(); }
                else if (e.key === 'Backspace' && !newGroupName.trim() && groups.length > 0) {
                  e.preventDefault();
                  const last = groups[groups.length - 1].id;
                  void onDeleteTag(last);
                }
              }}
            />
            <button className="btn primary newgroup-btn" onClick={() => void onAddGroup()}>{t('新增')}</button>
          </div>
          <span className="hint">{t('分组只是视图容器与顺序编排作用域，不改变服务自身的命令与探测')}</span>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="groups-label">{t('已有分组')}</label>
          <div className="tag-wrap">
            {groups.map((g, idx) => {
              const isRenaming = renameInput === g.id;
              const isDeleting = deletingGid === g.id;
              const color = tagColorFor(g.id);
              const tagStyle = { backgroundColor: color.bg, color: color.text };
              return (
                <span
                  key={g.id}
                  className={'tag' + (isDeleting ? ' deleting' : '')}
                  style={tagStyle}
                  onClick={(e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') return; void onSelectGroup(g.id); }}
                  onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); void onRenameStart(g.id, g.name); }}
                  title={t('单击选中 · 双击重命名')}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      className="rename-input"
                      value={renameDraft}
                      onChange={e => setRenameDraft(e.target.value)}
                      onBlur={() => void onRenameSave(g.id)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void onRenameSave(g.id); } else if (e.key === 'Escape') { setRenameInput(null); } }}
                    />
                  ) : (
                    <>
                      {g.name}
                      <button
                        className="tag-delete"
                        style={{ color: color.text }}
                        onClick={(e) => { e.stopPropagation(); void onDeleteTag(g.id); }}
                        title={t('删除分组')}
                        aria-label={t('删除分组')}
                      >
                        ×
                      </button>
                    </>
                  )}
                </span>
              );
            })}
            {groups.length === 0 && <div className="tag-empty">{t('暂无分组')}</div>}
          </div>
        </div>
      </div>

      {/* 选择成员：仅当有选中的分组时显示 */}
      {selectedGid && (
        <div className="card">
          <h4>
            {t('选择成员')}
            <span className="member-note">· {selectedGroup!.name}</span>
          </h4>
          <p className="dual-hint">{t('左栏可选成员 · 右栏已选成员（拖拽调整启动顺序）')}</p>
          <div className="dual-list">
            {/* 左栏：可选成员 */}
            <div className="dual-col">
              <h5 className="dual-title">{t('可选成员')}</h5>
              <div className="dual-items" id="dual-left">
                {left.map(id => {
                  const s = serviceById(id);
                  return (
                    <div key={id} className="dual-item">
                      <button className="iconbtn dual-add" onClick={() => void addOne(id)} title={t('添加到已选')}>→</button>
                      <div className="dual-info">
                        <div className="dual-name">{s.name}</div>
                        <div className="dual-sub mono">:{s.port} · {s.sub ?? ''}</div>
                      </div>
                    </div>
                  );
                })}
                {left.length === 0 && <div className="dual-empty">{t('全部已加入')}</div>}
              </div>
            </div>

            {/* 中间控制 */}
            <div className="dual-controls">
              <button className="btn" onClick={() => void addAll()} title={t('全部加入')}>{t('全部加入')}</button>
              <button className="btn" onClick={() => void removeAll()} title={t('全部移出')}>{t('全部移出')}</button>
            </div>

            {/* 右栏：已选成员 + 拖拽排序 */}
            <div className="dual-col dual-col-right">
              <h5 className="dual-title">{t('已选成员')}</h5>
              <div
                className="dual-items dual-items-right"
                id="dual-right"
                onDragOver={e => e.preventDefault()}
                onDragLeave={onDragLeave}
                onDrop={e => e.preventDefault()}
              >
                {right.map((id, i) => {
                  const s = serviceById(id);
                  const isHover = hoverIndex !== null && i === hoverIndex;
                  return (
                    <div
                      key={id}
                      className={'dual-item dual-item-right' + (isHover ? ' dual-hover' : '')}
                      draggable
                      onDragStart={e => void onDragStart(e, i)}
                      onDragOver={ev => { ev.preventDefault(); setHoverIndex(i); }}
                      onDragLeave={() => { setHoverIndex(null); }}
                      onDrop={e => { e.preventDefault(); void onDrop(e, i); }}
                    >
                      <button className="iconbtn dual-remove" onClick={() => void removeOne(id)} title={t('移出已选')}>←</button>
                      <div className="dual-info">
                        <div className="dual-name">{s.name}</div>
                        <div className="dual-sub mono">#{i + 1} · :{s.port} · {s.sub ?? ''}</div>
                      </div>
                    </div>
                  );
                })}
                {right.length === 0 && <div className="dual-empty">{t('暂无已选成员')}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
      {!selectedGid && (
        <div className="card empty-tip">
          {t('请从左侧「已有分组」中单击选中一个分组，再在此选择该分组的成员')}
        </div>
      )}
    </>
  );
}
