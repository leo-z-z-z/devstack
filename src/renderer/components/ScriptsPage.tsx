/* 指令库页：左侧树状结构（文件夹 + 脚本文件）+ 右侧脚本内容编辑器
 * 每个文件夹一个服务，内含任意脚本文件（不限命名规则），
 * 支持查看/编辑/保存/删除/运行，并通过添加服务时指定脚本路径来使用。 */
import { useState, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { ScriptScanItem, ScriptFileInfo } from '../../shared/types';

interface SaveMsg {
  kind: 'ok' | 'warn' | 'err';
  text: string;
  detail?: string;
}

function draftKey(serviceId: string, file: string): string {
  return `devstack.scriptdraft.${serviceId}.${file}`;
}
function readDraft(serviceId: string, file: string): string | null {
  try { return localStorage.getItem(draftKey(serviceId, file)); } catch { return null; }
}
function syncDraft(serviceId: string, file: string, text: string, disk: string): void {
  try {
    if (text === disk) localStorage.removeItem(draftKey(serviceId, file));
    else localStorage.setItem(draftKey(serviceId, file), text);
  } catch { /* ignore */ }
}
function clearDraft(serviceId: string, file: string): void {
  try { localStorage.removeItem(draftKey(serviceId, file)); } catch { /* ignore */ }
}

const SCRIPT_ICON: Record<string, string> = {
  '.bat': '❖',
  '.cmd': '❖',
  '.ps1': '☰',
  '.sh': '⋈'
};

export function ScriptsPage(): JSX.Element {
  const { t } = useI18n();
  const ui = useUi();

  const [scanItems, setScanItems] = useState<ScriptScanItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selService, setSelService] = useState<string>('');
  const [selFile, setSelFile] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 已展开的文件夹 serviceId
  const [rawText, setRawText] = useState('');       // 编辑器当前内容
  const [diskText, setDiskText] = useState('');      // 磁盘原文，用于判定 dirty
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null);
  const [running, setRunning] = useState<{ serviceId: string; file: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);
  const [pendingSwitch, setPendingSwitch] = useState<{ serviceId: string; file: string } | null>(null); // 待执行的切换目标
  const [rescanKey, setRescanKey] = useState(0); // 重新扫描计数，用于触发当前文件重新加载

  const curService = useMemo(() => scanItems.find(x => x.serviceId === selService) ?? null, [scanItems, selService]);
  const curFile: ScriptFileInfo | undefined = curService?.scripts.find(s => s.file === selFile);
  const dirty = !!curService && !!curFile && rawText !== diskText;

  // 加载脚本目录
  const load = async () => {
    const snap = await api.getSnapshot();
    const serviceMap: Record<string, string> = {};
    for (const s of snap.services) serviceMap[s.id] = s.name;
    const items = await api.scanScripts(serviceMap);
    setScanItems(items);
    // 首次加载：展开第一个文件夹，选中其第一个脚本
    if (items.length && !selService) {
      setExpanded(new Set([items[0].serviceId]));
      setSelService(items[0].serviceId);
      setSelFile(items[0].scripts.length ? items[0].scripts[0].file : '');
    } else if (!items.some(x => x.serviceId === selService)) {
      setSelService('');
      setSelFile('');
    }
  };

  useEffect(() => { void load(); }, []);

  // 切换选中脚本时读取磁盘内容；list 变化（重扫 / 保存后刷新）不覆盖正在编辑的内容
  useEffect(() => {
    if (!selService || !selFile) { setRawText(''); setDiskText(''); setSaveMsg(null); return; }
    const info = curService?.scripts.find(s => s.file === selFile);
    if (!info || !info.exists) { setRawText(''); setDiskText(''); setSaveMsg(null); return; }
    let cancelled = false;
    void api.readScriptFile(`${selService}/${selFile}`).then(r => {
      if (cancelled) return;
      const disk = r.ok ? (r.text ?? '') : String(r.error ?? '');
      const draft = readDraft(selService, selFile);
      const restored = draft !== null && draft !== disk;
      setDiskText(disk);
      setRawText(restored ? (draft as string) : disk);
      setSaveMsg(null);
      if (restored) ui.toast('已恢复未保存的修改');
    });
    return () => { cancelled = true; };
  }, [selService, selFile, rescanKey]);

  const toggleFolder = (serviceId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  };

  // 取服务的第一个脚本文件名；切换服务后自动定位到首个脚本，避免右侧空白
  const firstFileOf = (serviceId: string): string => {
    const svc = scanItems.find(x => x.serviceId === serviceId);
    return svc?.scripts.length ? svc.scripts[0].file : '';
  };

  const doSwitch = (target: { serviceId: string; file: string }) => {
    setSelService(target.serviceId);
    setSelFile(target.file || firstFileOf(target.serviceId));
    setPendingSwitch(null);
  };

  const selectService = (serviceId: string) => {
    if (serviceId === selService) return;
    if (dirty && curService && curFile) {
      const target: { serviceId: string; file: string } = { serviceId, file: '' };
      setPendingSwitch(target);
      ui.openModal({
        kind: 'confirm',
        title: t('是否保存修改？'),
        body: t('当前脚本') + '「<b>' + curFile.file + '</b>」' + t('有未保存的修改，是否保存后继续？'),
        okText: t('保存'),
        discardText: t('不保存'),
        onOk: () => {
          void onSave().then(success => {
            if (success) {
              doSwitch(target);
            }
          });
        },
        onDiscard: () => {
          if (curService && curFile) {
            clearDraft(curService.serviceId, curFile.file);
          }
          doSwitch(target);
        },
        onCancel: () => {
          // 取消切换，留在当前编辑页
          setPendingSwitch(null);
        }
      });
      return;
    }
    setSelService(serviceId);
    setSelFile(firstFileOf(serviceId));
  };

  const selectFile = (serviceId: string, file: string) => {
    if (serviceId === selService && file === selFile) return;
    if (dirty && curService && curFile) {
      const target: { serviceId: string; file: string } = { serviceId, file };
      setPendingSwitch(target);
      ui.openModal({
        kind: 'confirm',
        title: t('是否保存修改？'),
        body: t('当前脚本') + '「<b>' + curFile.file + '</b>」' + t('有未保存的修改，是否保存后继续？'),
        okText: t('保存'),
        discardText: t('不保存'),
        onOk: () => {
          void onSave().then(success => {
            if (success) {
              doSwitch(target);
            }
          });
        },
        onDiscard: () => {
          if (curService && curFile) {
            clearDraft(curService.serviceId, curFile.file);
          }
          doSwitch(target);
        },
        onCancel: () => {
          setPendingSwitch(null);
        }
      });
      return;
    }
    setSelService(serviceId);
    setSelFile(file);
  };

  const onEdit = (v: string) => {
    setRawText(v);
    setSaveMsg(null);
    if (curFile) syncDraft(selService, selFile, v, diskText);
  };

  const onRescan = async () => {
    setScanning(true);
    await load();
    setRescanKey(prev => prev + 1); // 触发当前选中脚本文件从磁盘重新加载
    setScanning(false);
  };

  const onSave = async (): Promise<boolean> => {
    if (!curService || !curFile || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await api.saveScriptFile(`${selService}/${curFile.file}`, rawText);
      if (!r.ok) {
        setSaveMsg({ kind: 'err', text: '保存失败，文件未改动', detail: r.message ?? '' });
        return false;
      }
      clearDraft(selService, selFile);
      setDiskText(rawText);
      setRawText(rawText);
      setSaveMsg({ kind: 'ok', text: '脚本已保存' });
      ui.toast('脚本已保存');
      await load();
      return true;
    } catch (e) {
      setSaveMsg({ kind: 'err', text: '保存失败，文件未改动', detail: String(e) });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!curService || !curFile) return;
    ui.openModal({
      kind: 'confirm',
      title: t('删除脚本文件'),
      body: t('删除脚本文件') + '「<b>' + curFile.file + '</b>」' + t('后不可恢复，确认删除？'),
      okText: t('确认删除'),
      danger: true,
      onOk: () => {
        void api.deleteScriptFile(`${selService}/${curFile.file}`).then(r => {
          if (!r.ok) { ui.toast('删除失败：' + (r.error ?? '')); return; }
          clearDraft(selService, selFile);
          ui.toast(curFile.file + ' 已删除');
          void load();
        });
      }
    });
  };

  const onRun = async () => {
    if (!curService || !curFile) return;
    setRunning({ serviceId: curService.serviceId, file: curFile.file });
    try {
      const r = await api.runScriptFile(`${selService}/${curFile.file}`);
      if (r.ok) {
        ui.toast('脚本执行成功');
        const out = (r.stdout ?? '').trim();
        if (out) ui.toast(out.slice(0, 200));
      } else {
        ui.toast('脚本执行失败：' + (r.error ?? '退出码 ' + r.code));
        const err = (r.stderr ?? '').trim();
        if (err) ui.toast(err.slice(0, 200));
      }
    } catch (e) {
      ui.toast('脚本执行异常：' + String(e));
    } finally {
      setRunning(null);
    }
  };

  const onOpenFolder = async () => {
    const r = await api.openScriptFolder();
    if (!r.ok) ui.toast('打开脚本文件夹失败');
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void onSave();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart, end = ta.selectionEnd;
      const next = rawText.slice(0, s) + '  ' + rawText.slice(end);
      onEdit(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };

  return (
    <div className="page">
      <section className="panel">
        <div className="panelhead">
          <h2>{t('指令库')} <span className="chip">{scanItems.length}</span></h2>
          <div className="tools">
            <button className="btn" onClick={() => void onOpenFolder()} title={t('用系统资源管理器打开脚本目录')}>{t('打开脚本文件夹')}</button>
            <button className="btn primary" onClick={() => void onRescan()} disabled={scanning}>
              {scanning ? t('正在扫描…') : t('重新扫描')}
            </button>
          </div>
        </div>

        <div className="tplwrap" style={{ minHeight: '400px' }}>
          {/* 左侧：树状结构（文件夹 + 脚本文件） */}
          <div className="tpllist" style={{ width: '260px' }}>
            <div className="tplnotice">
              <span className="ico">ⓘ</span>
              <span>{t('仅识别可运行脚本（.bat / .cmd / .ps1 / .sh），且须放在文件夹下')}</span>
            </div>
            {scanItems.length === 0 && (
              <div className="empty" style={{ padding: '20px 10px' }}>{t('暂无脚本目录')}</div>
            )}
            {scanItems.map(item => (
              <div key={item.serviceId} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* 文件夹节点 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    backgroundColor: selService === item.serviceId ? '#F1F5F9' : 'transparent',
                    transition: 'background-color 0.15s'
                  }}
                  onClick={(e) => { e.stopPropagation(); toggleFolder(item.serviceId); }}
                  title={item.serviceName ?? item.serviceId}
                >
                  <span>{expanded.has(item.serviceId) ? '▾' : '▸'}</span>
                  <span>📁</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {item.serviceName ?? item.serviceId}
                  </span>
                  <span className="mono" style={{ fontSize: '10px', color: '#94A3B8', marginLeft: 'auto', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.serviceId}
                  </span>
                </div>

                {/* 脚本文件子节点（仅在展开时显示） */}
                {expanded.has(item.serviceId) && (
                  <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {item.scripts.length === 0 && (
                      <div style={{ padding: '4px 8px', color: '#94A3B8', fontSize: '11px' }}>
                        {t('该文件夹暂无脚本')}
                      </div>
                    )}
                    {item.scripts.map(s => (
                      <div
                        key={s.file}
                        onClick={(e) => { e.stopPropagation(); selectFile(item.serviceId, s.file); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          backgroundColor:
                            selService === item.serviceId && selFile === s.file
                              ? '#E0F2FE'
                              : 'transparent',
                          transition: 'background-color 0.15s'
                        }}
                        title={s.file}
                      >
                        <span className="mono" style={{ fontSize: '11px' }}>
                          {SCRIPT_ICON[s.ext] ?? '📄'}
                        </span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {s.file}
                        </span>
                        <span className="mono" style={{ fontSize: '10px', color: '#94A3B8' }}>{s.ext}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 右侧：仅展示选中脚本的内容编辑器 */}
          <div className="tpldetail" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {!selFile ? (
              <div className="empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: '20px', color: '#CBD5E1', marginBottom: 8 }}>📄</div>
                <div style={{ color: '#64748B' }}>{t('左侧选择一个脚本文件')}</div>
              </div>
            ) : (
              <>
                {/* 内容编辑器 */}
                <div className="tpljsonwrap">
                  <div className="tpljsonhd">
                    <div className="tplreshd" style={{ flex: 1 }}>
                      {t('脚本内容')} <span className="mono">{curFile?.file ?? ''}</span>
                      {dirty && <span className="tpldirty">● {t('未保存')}</span>}
                    </div>
                    <div className="tools" style={{ gap: 6 }}>
                      {curFile?.exists && (
                        <>
                          <button className="btn primary" onClick={() => void onRun()} disabled={!!curService && (running?.serviceId === curService.serviceId && running?.file === curFile.file || saving)}>
                            {curService && running?.serviceId === curService.serviceId && running?.file === curFile.file ? t('正在运行…') : t('运行脚本')}
                          </button>
                          <button className="btn danger tpldel" onClick={() => void onDelete()}>{t('删除脚本')}</button>
                        </>
                      )}
                      <button className="btn" onClick={() => void onSave()} disabled={!dirty || saving} title="Ctrl / Cmd + S">
                        {saving ? t('正在保存…') : t('保存修改')}
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={taRef}
                    className="tpljson edit mono"
                    value={rawText}
                    onChange={e => onEdit(e.target.value)}
                    onKeyDown={onKeyDown}
                    spellCheck={false}
                    wrap="off"
                    aria-label={t('脚本内容')}
                    disabled={!curFile || !curFile.exists}
                  />
                  {saveMsg && (
                    <div className={`tplsavebar ${saveMsg.kind}`}>
                      <div className="tplsavehd">{t(saveMsg.text)}</div>
                      {saveMsg.detail && <div className="tplsavedetail mono">{t(saveMsg.detail)}</div>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
