/* 模板库页：左列表（异常标红）+ 右栏（校验结果 / 可直接编辑并保存的 JSON）
 * 编辑器草稿存 localStorage，离开页面再回来不丢；保存经主进程校验 + 原子写。 */
import { useState, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { TemplateScanItem } from '../../shared/types';

type SaveKind = 'ok' | 'warn' | 'err';
interface SaveMsg {
  kind: SaveKind;
  text: string;
  detail?: string;
  warnings?: string[];
}

const draftKey = (file: string) => 'devstack.tpldraft.' + file;
function readDraft(file: string): string | null {
  try { return localStorage.getItem(draftKey(file)); } catch { return null; }
}
function syncDraft(file: string, text: string, disk: string): void {
  try {
    if (text === disk) localStorage.removeItem(draftKey(file));
    else localStorage.setItem(draftKey(file), text);
  } catch { /* 隐私模式 / 配额不足时不影响编辑 */ }
}
function clearDraft(file: string): void {
  try { localStorage.removeItem(draftKey(file)); } catch { /* ignore */ }
}

export function TemplatesPage(): JSX.Element {
  const { t } = useI18n();
  const ui = useUi();
  const [list, setList] = useState<TemplateScanItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [sel, setSel] = useState<string>('');
  const [rawText, setRawText] = useState('');       // 编辑器当前内容
  const [diskText, setDiskText] = useState('');      // 磁盘原文，用于判定 dirty
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);

  const cur = useMemo(() => list.find(x => x.id === sel) ?? null, [list, sel]);
  const dirty = !!cur && rawText !== diskText;
  const errCount = list.filter(x => x.state === 'invalid').length;

  const load = async () => {
    const l = await api.scanTemplates();
    setList(l);
    setSel(prev => (prev && l.some(x => x.id === prev)) ? prev : (l.length ? l[0].id : ''));
  };

  useEffect(() => { void load(); }, []);

  // 只在切换选中项时读取磁盘；list 变化（重扫 / 保存后刷新）绝不覆盖正在编辑的内容
  useEffect(() => {
    if (!sel) { setRawText(''); setDiskText(''); setSaveMsg(null); return; }
    const item = list.find(x => x.id === sel);
    if (!item) return;
    let cancelled = false;
    void api.readTemplateFile(item.file).then(r => {
      if (cancelled) return;
      const disk = r.ok ? (r.text ?? '') : String(r.error ?? '');
      const draft = readDraft(item.file);
      const restored = draft !== null && draft !== disk;
      setDiskText(disk);
      setRawText(restored ? (draft as string) : disk);
      setSaveMsg(null);
      if (restored) ui.toast('已恢复未保存的修改');
    });
    return () => { cancelled = true; };
  }, [sel]);

  const confirmDiscard = (onOk: () => void) => {
    ui.openModal({
      kind: 'confirm',
      title: '放弃未保存的修改？',
      body: '当前模板有未保存的修改，继续将丢弃这些修改。',
      okText: '放弃修改',
      danger: true,
      onOk
    });
  };

  const selectItem = (id: string) => {
    if (id === sel) return;
    if (dirty && cur) {
      const file = cur.file;
      confirmDiscard(() => { clearDraft(file); setSel(id); });
      return;
    }
    setSel(id);
  };

  const onEdit = (v: string) => {
    setRawText(v);
    setSaveMsg(null);
    if (cur) syncDraft(cur.file, v, diskText);
  };

  const onFormat = () => {
    try {
      const pretty = JSON.stringify(JSON.parse(rawText), null, 2);
      onEdit(pretty);
      setSaveMsg({ kind: 'ok', text: 'JSON 已格式化（尚未保存）' });
    } catch (e) {
      setSaveMsg({ kind: 'err', text: 'JSON 语法错误，未写入文件', detail: t('格式化失败：请先修正语法') + ' · ' + String(e) });
    }
  };

  const onRevert = () => {
    if (!cur || !dirty) return;
    const file = cur.file, disk = diskText;
    confirmDiscard(() => {
      clearDraft(file);
      setRawText(disk);
      setSaveMsg(null);
      ui.toast('已还原为磁盘文件');
    });
  };

  const errTitle = (code?: string): string => {
    switch (code) {
      case 'syntax': return 'JSON 语法错误，未写入文件';
      case 'too-large': return '文件超过 128KB 上限';
      case 'path': return '仅允许模板目录内的 .json 文件';
      case 'write': return '写入失败，文件未改动';
      default: return '保存失败，文件未改动';
    }
  };

  const onSave = async () => {
    if (!cur || savingRef.current) return;
    const file = cur.file, text = rawText;
    savingRef.current = true;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await api.saveTemplateFile(file, text);
      if (!r.ok) {
        const at = r.line && r.column ? 'line ' + r.line + ', column ' + r.column + ' · ' : '';
        setSaveMsg({
          kind: 'err',
          text: errTitle(r.code),
          detail: at + (r.message ?? '')
        });
        // 语法错误时把光标移到出错位置，便于直接修改
        if (r.line && r.column && taRef.current) {
          const lines = text.split('\n');
          let pos = 0;
          for (let i = 0; i < r.line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
          pos += Math.max(0, r.column - 1);
          taRef.current.focus();
          taRef.current.setSelectionRange(pos, pos);
        }
        return;
      }
      clearDraft(file);
      setDiskText(text);
      setRawText(text);
      setSaveMsg(r.warnings.length
        ? { kind: 'warn', text: '已保存，但仍有校验问题', warnings: r.warnings }
        : { kind: 'ok', text: '已保存 · 格式校验通过' });
      ui.toast('模板已保存');
      await load();
    } catch (e) {
      setSaveMsg({ kind: 'err', text: '保存失败，文件未改动', detail: String(e) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
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

  const onRescan = async () => {
    setScanning(true);
    await load();
    setScanning(false);
  };

  const onDelete = (item: TemplateScanItem) => {
    ui.openModal({
      kind: 'confirm',
      title: '删除模板文件',
      body: `删除「<b>${item.file}</b>」后将从模板目录移除，<b>不影响已生成的服务</b>。`,
      okText: '确认删除',
      danger: true,
      onOk: () => {
        void api.deleteTemplate(item.file).then(() => {
          clearDraft(item.file);
          ui.toast(item.file + ' 已删除');
          void load();
        });
      }
    });
  };

  return (
    <div className="page">
      <section className="panel">
        <div className="panelhead">
          <h2>{t('组件模板库')} <span className="chip">{list.length}{errCount ? ' · ' + errCount + t(' 异常') : ''}</span></h2>
          <div className="tools">
            <button className="btn" onClick={() => void api.openTemplateFolder()} title={t('用系统资源管理器打开模板目录')}>{t('打开模板文件夹')}</button>
            <button className="btn primary" onClick={() => void onRescan()} disabled={scanning}>
              {scanning ? t('正在校验…') : t('重新扫描校验')}
            </button>
          </div>
        </div>
        <div className="tplwrap">
          <div className="tpllist">
            {list.map(item => (
              <div
                key={item.id}
                className={'tplitem' + (item.state === 'invalid' ? ' bad' : '') + (sel === item.id ? ' on' : '')}
                title={(item.raw?.meta.name ?? item.id) + ' · ' + item.file}
                onClick={() => selectItem(item.id)}
              >
                {item.state === 'invalid' && <span className="tplvm">✗</span>}
                <span>{item.raw?.meta.name ?? item.id}</span>
                <span className="mono">{item.file}</span>
              </div>
            ))}
            {list.length === 0 && <div className="empty">{t('模板目录为空')}</div>}
          </div>
          <div className="tpldetail">
            {cur ? (
              <>
                <div className="tplresult">
                  <div className="tplreshd">
                    {t('格式化校验结果')}
                    {cur.state === 'invalid' && <span className="tplresbadtag">{t(`${cur.errors.length} 项错误`)}</span>}
                    {dirty && <span className="tpldisknote">{t('校验结果基于磁盘文件')}</span>}
                  </div>
                  {cur.state === 'ok'
                    ? <div className="tplresok">{t('格式校验通过 · 可用于新建服务')}</div>
                    : (
                      <div className="tplerrs">
                        {cur.errors.map((e, i) => (
                          <div className="tplerrow" key={i}>
                            <span className="tplerrno">{i + 1}</span>
                            <div><div className="tplerrhead">{t(e)}</div></div>
                          </div>
                        ))}
                      </div>
                    )}
                </div>

                <div className="tpljsonwrap">
                  <div className="tpljsonhd">
                    <div className="tplreshd">
                      {t('JSON 原文 · 可直接编辑')}
                      <span className="mono">{cur.file}</span>
                      {dirty && <span className="tpldirty">● {t('未保存')}</span>}
                    </div>
                    <div className="tools">
                      <button className="btn" onClick={onFormat} disabled={!rawText}>{t('格式化')}</button>
                      <button className="btn" onClick={onRevert} disabled={!dirty}>{t('还原')}</button>
                      <button className="btn primary" onClick={() => void onSave()} disabled={!dirty || saving} title="Ctrl / Cmd + S">
                        {saving ? t('正在保存…') : t('保存修改')}
                      </button>
                      <button className="btn danger tpldel" onClick={() => onDelete(cur)}>{t('删除文件')}</button>
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
                    aria-label={t('JSON 原文')}
                  />
                  {saveMsg && (
                    <div className={'tplsavebar ' + saveMsg.kind}>
                      <div className="tplsavehd">
                        {t(saveMsg.text)}
                        {saveMsg.warnings && saveMsg.warnings.length > 0 ? ' · ' + saveMsg.warnings.length : ''}
                      </div>
                      {saveMsg.detail && <div className="tplsavedetail mono">{t(saveMsg.detail)}</div>}
                      {saveMsg.warnings && saveMsg.warnings.length > 0 && (
                        <div className="tplsavewarns">
                          {saveMsg.warnings.map((w, i) => <div key={i}>· {t(w)}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty">{t('左侧选择一个模板查看详情')}</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
