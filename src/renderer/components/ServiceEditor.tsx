/* 服务编辑器：添加 / 编辑服务。选模板即全量回填；三条动作命令逐 tab 编辑 */
import { useState, useEffect } from 'react';
import { useUi } from '../uistate';
import { useI18n } from '../i18n-hook';
import { api } from '../api';
import { ServiceDefinition, ActionSpec, TemplateScanItem } from '../../shared/types';
import { buildTemplateFromForm } from '../../shared/templateFromForm';
import { expandPlaceholders } from '../../shared/placeholders';

type ActKey = 'start' | 'stop' | 'restart';

const ACTION_TABS: [ActKey, string][] = [
  ['start', '启动'], ['stop', '停止'], ['restart', '重启']
];

interface DraftActs { cmd: string; args: string; runner: string; timeout: string; }

function blankActs(): Record<ActKey, DraftActs> {
  return {
    start: { cmd: '', args: '', runner: '', timeout: '15000' },
    stop: { cmd: '', args: '', runner: '', timeout: '15000' },
    restart: { cmd: '', args: '', runner: '', timeout: '15000' }
  };
}

function actsFromSpec(a: ActionSpec | null | undefined): DraftActs {
  if (!a) return { cmd: '', args: '', runner: '', timeout: '15000' };
  return {
    cmd: a.type === 'exec' ? (a.command ?? '') : '',
    args: (a.args ?? []).join(' '),
    runner: a.runner ?? '',
    timeout: String(a.timeoutMs ?? 15000)
  };
}

export function ServiceEditor({ service }: { service: ServiceDefinition | null }): JSX.Element {
  const { t } = useI18n();
  const ui = useUi();
  const [templates, setTemplates] = useState<TemplateScanItem[]>([]);
  const [name, setName] = useState(service?.name ?? '');
  const [dir, setDir] = useState(service?.dir ?? '');
  const [logDir, setLogDir] = useState(service?.logDir ?? '');
  const [port, setPort] = useState(String(service?.port ?? ''));
  const [url, setUrl] = useState(service?.webUrl ?? '');
  const [templateId, setTemplateId] = useState(service?.template ?? '');
  const [acts, setActs] = useState(() => {
    const b = blankActs();
    if (service) {
      for (const k of ['start', 'stop', 'restart'] as const) {
        if (service.cfg.acts[k]) b[k] = actsFromSpec(service.cfg.acts[k]);
      }
    }
    return b;
  });
  const [tab, setTab] = useState<ActKey>('start');
  const [showRules, setShowRules] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);
  // 覆盖确认载荷：点击「覆盖当前模板」时快照当前表单，确认后才真正写盘
  const [pendingOverwrite, setPendingOverwrite] = useState<{ id: string; file: string; text: string } | null>(null);

  useEffect(() => {
    void api.scanTemplates().then(list => setTemplates(list.filter(x => x.state === 'ok')));
  }, []);

  // 来源模板仍在模板目录中，才允许覆盖（空白服务 / 来源已删除时按钮禁用）
  const sourceTpl = templateId ? templates.find(x => x.id === templateId && x.state === 'ok') : undefined;

  /** 回到「空白服务」初值：模板回填后改选空白、或模板失效时都要全量清干净 */
  const resetForm = () => {
    setName('');
    setDir('');
    setLogDir('');
    setPort('');
    setUrl('');
    setActs(blankActs());
    setTab('start');
  };

  const onPickTemplate = async (tid: string) => {
    const tpl = tid ? templates.find(x => x.id === tid) : undefined;
    if (!tid || !tpl?.raw) {
      setTemplateId('');
      resetForm();
      ui.toast(tid ? '模板不可用，已清空表单' : '已清空为空白服务');
      return;
    }
    setTemplateId(tid);
    setName(tpl.raw.defaults.displayName || tpl.raw.meta.name);
    setDir(tpl.raw.defaults.installDirHint || '');
    setLogDir(tpl.raw.defaults.logDir ?? '');
    setPort(String(tpl.raw.probe.port));
    setUrl(tpl.raw.defaults.webUrl ?? '');
    setActs({
      start: actsFromSpec(tpl.raw.actions.start),
      stop: actsFromSpec(tpl.raw.actions.stop),
      restart: actsFromSpec(tpl.raw.actions.restart)
    });
    ui.toast('已回填模板「' + tpl.raw.meta.name + '」');
  };

  const build = (): ServiceDefinition => {
    // 修订 57：落盘前把 ${installDir} / ${port} 展开成真实值。
    // 模板与表单里允许写占位符，但 services.yaml 里必须是展开后的真实路径——
    // 否则执行层会拿字面量去 spawn，Windows 直接 ENOENT（表现为启动失败/超时）。
    const ctx = { installDir: dir.trim(), port: parseInt(port, 10) || 0 };
    const mkAct = (d: DraftActs): ActionSpec | null => {
      if (!d.cmd.trim()) return null;
      const act: ActionSpec = {
        type: 'exec',
        command: expandPlaceholders(d.cmd.trim(), ctx),
        args: d.args.trim() ? d.args.trim().split(/\s+/).map(x => expandPlaceholders(x, ctx)) : [],
        timeoutMs: parseInt(d.timeout, 10) || 15000
      };
      if (d.runner.trim()) act.runner = expandPlaceholders(d.runner.trim(), ctx);
      return act;
    };
    return {
      id: service?.id ?? ('svc-' + Math.random().toString(36).slice(2, 8)),
      name: name.trim() || t('未命名服务'),
      gid: service?.gid ?? null,
      sub: service?.sub,
      port: parseInt(port, 10) || 0,
      webUrl: url.trim() || null,
      dir: dir.trim(),
      logDir: logDir.trim() || undefined,
      template: templateId || undefined,
      cfg: {
        acts: {
          start: mkAct(acts.start),
          stop: mkAct(acts.stop),
          restart: mkAct(acts.restart)
        }
      }
    };
  };

  const onSave = async () => {
    if (!name.trim() || !dir.trim() || !port) { ui.toast('名称 / 安装目录 / 端口为必填'); return; }
    const svc = build();
    const pre = await api.precheckService(svc);
    if (!pre.ok) { ui.toast('命令预检发现问题：' + pre.issues[0]); return; }
    await api.upsertService(svc);
    ui.closeModal();
    ui.toast((service ? '配置已保存：' : '已添加服务：') + svc.name);
  };

  /** 把当前表单另存为模板 JSON：复用底层 save-template-file 的校验与原子写 */
  const onSaveAsTemplate = async () => {
    if (tplSaving) return;
    const built = buildTemplateFromForm({
      name, dir, logDir, port, url, acts
    }, templates.map(x => x.id));
    if (!built.ok) { ui.toast(built.error); return; }
    setTplSaving(true);
    try {
      const res = await api.saveTemplateFile(built.file, JSON.stringify(built.template, null, 2) + '\n');
      if (!res.ok) { ui.toast('模板保存失败：' + (res.message ?? res.code)); return; }
      // 重扫模板目录并选中新模板，让下拉立即出现刚保存的项
      const list = await api.scanTemplates();
      setTemplates(list.filter(x => x.state === 'ok'));
      setTemplateId(built.id);
      if (res.warnings.length) ui.toast('模板已保存' + '（' + res.warnings[0] + '）');
      else ui.toast('模板已保存' + '：' + built.id);
    } finally {
      setTplSaving(false);
    }
  };

  /** 弹出编辑器内的覆盖确认条：沿用来源模板 id / 文件名，仅快照表单内容 */
  const onAskOverwrite = () => {
    if (tplSaving) return;
    if (!sourceTpl) { ui.toast('当前没有来源模板，请先「保存为新模板」'); return; }
    const built = buildTemplateFromForm({
      name, dir, logDir, port, url, acts
    }, templates.map(x => x.id), templateId);
    if (!built.ok) { ui.toast(built.error); return; }
    setPendingOverwrite({ id: built.id, file: built.file, text: JSON.stringify(built.template, null, 2) + '\n' });
  };

  /** 确认覆盖：写回来源文件 → 重扫 → 保持选中该模板 */
  const onConfirmOverwrite = async () => {
    if (!pendingOverwrite || tplSaving) return;
    setTplSaving(true);
    try {
      const res = await api.saveTemplateFile(pendingOverwrite.file, pendingOverwrite.text);
      if (!res.ok) { ui.toast('模板保存失败：' + (res.message ?? res.code)); return; }
      const list = await api.scanTemplates();
      setTemplates(list.filter(x => x.state === 'ok'));
      setTemplateId(pendingOverwrite.id);
      setPendingOverwrite(null);
      if (res.warnings.length) ui.toast('已覆盖 ' + pendingOverwrite.file + '，并重新扫描' + '（' + res.warnings[0] + '）');
      else ui.toast('已覆盖 ' + pendingOverwrite.file + '，并重新扫描');
    } finally {
      setTplSaving(false);
    }
  };

  /** 用原生对话框选脚本 / 执行器，回填到当前 tab */
  const pickFile = async (kind: 'script' | 'runner') => {
    try {
      const res = await api.selectFile(kind, {
        title: kind === 'runner' ? t('选择执行器（可执行文件）') : t('选择脚本文件'),
        exec: t('可执行文件'),
        all: t('所有文件'),
        script: t('脚本 / 可执行文件'),
        bat: t('Windows 批处理'),
        ps: 'PowerShell',
        sh: t('Shell 脚本')
      });
      if (!res.ok || !res.path) return;
      const field = kind === 'script' ? 'cmd' : 'runner';
      setActs(prev => ({ ...prev, [tab]: { ...prev[tab], [field]: res.path } }));
      ui.toast(kind === 'script' ? '已选择脚本文件' : '已选择执行器');
    } catch { ui.toast('选择文件失败'); }
  };

  /** 在当前 tab 的脚本路径末尾插入 ${installDir} 占位符 */
  const insertInstallDir = () => {
    setActs(prev => {
      const c = prev[tab];
      const sep = c.cmd && !/[\\/]$/.test(c.cmd) ? '/' : '';
      return { ...prev, [tab]: { ...c, cmd: c.cmd + sep + '${installDir}' } };
    });
  };

  const cur = acts[tab];
  const curLabel = ACTION_TABS.find(([k]) => k === tab)?.[1] ?? '';
  const curConfigured = !!cur.cmd.trim();
  const curPreview = () => {
    const c = acts[tab];
    // 修订 57：预览展示展开后的真实命令（占位符替换成实际目录 / 端口），
    // 用户看到的必须与真正被执行的一致。
    const ctx = { installDir: dir.trim(), port: parseInt(port, 10) || 0 };
    const parts = [];
    if (c.runner.trim()) parts.push(expandPlaceholders(c.runner.trim(), ctx));
    if (c.cmd.trim()) parts.push(expandPlaceholders(c.cmd.trim(), ctx));
    if (c.args.trim()) parts.push(c.args.trim().split(/\s+/).map(x => expandPlaceholders(x, ctx)).join(' '));
    return parts.join(' ') || t('未配置');
  };

  return (
    <>
      <div className="modalhead">
        <h3>{service ? t('编辑服务') : t('添加服务')}</h3>
        <div className="tools">
          <button className="btn" onClick={ui.closeModal}>{t('取消')}</button>
          <button className="btn" onClick={() => void onSaveAsTemplate()} disabled={tplSaving || !!pendingOverwrite} title={t('把当前表单保存为可复用的模板')}>{tplSaving ? '…' : t('保存为新模板')}</button>
          <button className="btn" onClick={onAskOverwrite} disabled={tplSaving || !sourceTpl || !!pendingOverwrite} title={t('用当前表单覆盖来源模板文件（需二次确认）；模板目录里的模板都可覆盖')}>{t('覆盖当前模板')}</button>
          <button className="btn primary" onClick={() => void onSave()} disabled={!!pendingOverwrite}>{t('保存')}</button>
        </div>
      </div>
      {pendingOverwrite && (
        <div className="card" style={{ borderColor: '#d9534f' }}>
          <h4>{t('覆盖模板 · 二次确认')}</h4>
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            {t('将用当前表单')}{t('覆盖')}{t('模板目录里的文件 ')}<b className="mono">{pendingOverwrite.file}</b>。<br />
            <b>{t('已由该模板生成的服务不受影响')}</b>{t('；此操作直接改写文件，不可撤销。')}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" onClick={() => setPendingOverwrite(null)} disabled={tplSaving}>{t('取消')}</button>
            <button className="btn danger" onClick={() => void onConfirmOverwrite()} disabled={tplSaving}>{tplSaving ? '…' : t('覆盖模板文件')}</button>
          </div>
        </div>
      )}
      <div className="card">
        <div className="cardhead">
          <span className="num">1</span>
          <h4>{t('基本信息')}</h4>
        </div>
        <div className="grid2">
          <div className="field">
            <label className="flabel">{t('显示名称')}<span className="reqstar" title={t('必填')}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('例如：Kibana')} title={t('主面板与服务卡片上显示的名称')} />
          </div>
          <div className="field">
            <label className="flabel">{t('来源模板')}<span className="optnote">{t('(可选)')}</span><i className="qmark" title={t('选模板即全量回填')}>?</i></label>
            <select value={templateId} onChange={e => void onPickTemplate(e.target.value)} title={t('选模板即全量回填')}>
              <option value="">{t('空白服务（从零填写）')}</option>
              {templates.map(x => <option key={x.id} value={x.id}>{x.id} · {x.raw?.meta.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label className="flabel">{t('安装目录')}<span className="reqstar" title={t('必填')}>*</span></label>
            <input value={dir} onChange={e => setDir(e.target.value)} placeholder={t('C:/dev/kibana 或 /opt/kibana')} title={t('组件安装目录，作为动作命令的工作目录 cwd')} />
          </div>
          <div className="field">
            <label className="flabel">{t('探测端口')}<span className="reqstar" title={t('必填')}>*</span></label>
            <input value={port} onChange={e => setPort(e.target.value)} placeholder="5601" title={t('状态探测与端口占用判定用的唯一参数')} />
          </div>
        </div>
        <div className="field">
          <label className="flabel">{t('日志目录')}<span className="optnote">{t('(可选)')}</span><i className="qmark" title={t('该服务运行日志文件所在的目录；留空则使用软件默认日志目录')}>?</i></label>
          <input value={logDir} onChange={e => setLogDir(e.target.value)} placeholder={t('D:/logs/kibana 或 C:/dev/app/logs')} title={t('该服务运行日志文件所在的目录；留空则使用软件默认日志目录')} />
        </div>
        <div className="field">
          <label className="flabel">{t('浏览器地址')}<span className="optnote">{t('(可选)')}</span><i className="qmark" title={t('点击端口时打开的地址；留空默认 http://127.0.0.1:端口')}>?</i></label>
          <input value={url ?? ''} onChange={e => setUrl(e.target.value)} placeholder={t('http://localhost:5601 或 disabled')} title={t('点击端口时打开的地址；留空默认 http://127.0.0.1:端口')} />
        </div>
      </div>
      <div className="card actcard">
        <div className="acthead cardhead">
          <span className="num">2</span>
          <h4>{t('动作命令')}</h4>
          <span className={'actstate' + (curConfigured ? ' on' : '')}>{t(curLabel)}{t(curConfigured ? '已配置' : '未配置')}</span>
        </div>
        <div className="tabs">
          {ACTION_TABS.map(([k, label]) => {
            const configured = !!acts[k].cmd.trim();
            return (
              <span key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
                {t(label)}
                <i className={'actdot' + (configured ? ' on' : '')} title={t(configured ? '已配置' : '未配置')} />
              </span>
            );
          })}
        </div>
        <div className="actform" key={tab}>
          <div className="field">
            <label className="flabel">
              {t('脚本路径')}
              <span className="reqstar" title={t('必填')}>*</span>
              <i className="qmark" title={t('由用户自己编写的启动/停止/重启脚本文件；支持 ${installDir} 等占位符')}>?</i>
            </label>
            <div className="pathrow">
              <input value={cur.cmd} onChange={e => setActs({ ...acts, [tab]: { ...cur, cmd: e.target.value } })} placeholder={t('C:/scripts/start.bat 或 /opt/app/start.sh')} title={t('由用户自己编写的启动/停止/重启脚本文件；支持 ${installDir} 等占位符')} />
              <button className="iconbtn pathbtn" onClick={insertInstallDir} title={t('把安装目录占位符插入脚本路径')}>$</button>
              <button className="iconbtn pathbtn" onClick={() => void pickFile('script')} title={t('从本机选择一个脚本文件')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4.5h4l1.2 1.5H14v5.5H2z" /></svg>
              </button>
            </div>
          </div>
          <div className="actgrid">
            <div className="field">
              <label className="flabel">{t('参数')}<span className="lsub">{t('传给脚本的参数，空格分隔')}</span></label>
              <input value={cur.args} onChange={e => setActs({ ...acts, [tab]: { ...cur, args: e.target.value } })} placeholder="-f config/logstash.conf" title={t('传给脚本的参数，空格分隔')} />
            </div>
            <div className="field">
              <label className="flabel">{t('超时 ms')}</label>
              <input value={cur.timeout} onChange={e => setActs({ ...acts, [tab]: { ...cur, timeout: e.target.value } })} title={t('等待上限；超时即判定该动作失败')} />
            </div>
          </div>
          <div className="field">
            <label className="flabel">
              {t('执行器')}
              <span className="optnote">{t('(可选)')}</span>
              <i className="qmark" title={t('留空则按脚本扩展名自动选择系统工具；填写则只用这一个可执行文件执行，不带参数')}>?</i>
            </label>
            <div className="pathrow">
              <input value={cur.runner} onChange={e => setActs({ ...acts, [tab]: { ...cur, runner: e.target.value } })} placeholder="cmd.exe / pwsh / /bin/bash" title={t('留空则按脚本扩展名自动选择系统工具；填写则只用这一个可执行文件执行，不带参数')} />
              <button className="iconbtn pathbtn" onClick={() => void pickFile('runner')} title={t('从本机选择一个可执行文件作为执行器')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4.5h4l1.2 1.5H14v5.5H2z" /></svg>
              </button>
            </div>
            <div className="rulehint">
              <span>{t('留空按扩展名自动选解释器')} · </span>
              <span className="rulelink" onClick={() => setShowRules(v => !v)}>{t(showRules ? '收起规则' : '查看规则')}</span>
            </div>
            {showRules && <div className="hint">{t('留空自动：.bat/.cmd→cmd.exe，.ps1→powershell.exe，.sh→/bin/sh；其他脚本直接执行')}</div>}
          </div>
          <div className="field">
            <label className="flabel">{t('命令预览')}</label>
            <div className="cmd-preview">{curPreview()}</div>
          </div>
        </div>
      </div>
    </>
  );
}
