/* ============================================================
 * ipc 模块：ipcMain handlers + 事件推送
 * 前端经 contextBridge 暴露的 api 调用，全部走这里
 * ============================================================ */
import { ipcMain, shell, app, dialog, BrowserWindow } from 'electron';
import { store } from './store';
import { scanTemplates, deleteTemplateFile, templateFilePath, saveTemplateText } from './template';
import { scanScripts, readScriptFile, saveScriptFile, deleteScriptFile, createScriptDir, runScriptFile, scriptsDir } from './script';
import fs from 'node:fs';
import {
  toggle, restart, groupStart, groupStop, startAll, stopAll, buildConfirmPlan,
  applyPollMs, refreshAllStatus, interruptStart
} from './schedule';
import { readYaml } from './config';
import { logs } from './logs';
import { templateDir, logDir, servicesYamlPath, normalizeServicePaths } from './paths';
import { findServicePlaceholderIssues } from '../shared/placeholders';
import { ServiceDefinition, GroupDefinition, Settings } from '../shared/types';

export function registerIpc(): void {
  /* ---------- 快照 ---------- */
  ipcMain.handle('get-snapshot', () => store.snapshot());

  /* ---------- 单服务动作（v2.39 稳定态守卫在 schedule 内） ---------- */
  ipcMain.handle('toggle-service', (_e, id: string) => toggle(id));
  ipcMain.handle('restart-service', (_e, id: string) => restart(id));

  /* ---------- 中断启动 ---------- */
  ipcMain.handle('interrupt-start', (_e, id: string) => interruptStart(id));

  /* ---------- 组级动作 ---------- */
  ipcMain.handle('group-start', (_e, gid: string) => groupStart(gid));
  ipcMain.handle('group-stop', (_e, gid: string) => groupStop(gid));

  /* ---------- 全部启停 ---------- */
  ipcMain.handle('start-all', () => startAll());
  ipcMain.handle('stop-all', () => stopAll());
  ipcMain.handle('build-confirm-plan', (_e, kind: 'startAll' | 'stopAll') => buildConfirmPlan(kind));

  /* ---------- 服务配置 ---------- */
  ipcMain.handle('upsert-service', (_e, s: ServiceDefinition) => {
    // 跨平台路径归一：用户手填的反斜杠/正斜杠统一成当前平台分隔符再落盘，
    // 保证 win/mac/linux 下命令与参数都能被 spawn 正确定位。
    try { store.upsertService(normalizeServicePaths(s)); return { ok: true }; }
    catch (e) { return { ok: false, errors: [String(e && (e as Error).message || e)] }; }
  });
  ipcMain.handle('remove-service', (_e, id: string) => { store.removeService(id); logs.clearService(id); return { ok: true }; });
  ipcMain.handle('rename-service', (_e, id: string, name: string) => { store.renameService(id, name); return { ok: true }; });

  /* ---------- 组合 ---------- */
  ipcMain.handle('save-group', (_e, g: GroupDefinition, memberIds: string[]) => { store.saveGroup(g, memberIds); return { ok: true }; });
  ipcMain.handle('dissolve-group', (_e, gid: string) => { store.dissolveGroup(gid); return { ok: true }; });
  ipcMain.handle('delete-group', (_e, gid: string) => { store.deleteGroup(gid); return { ok: true }; });
  ipcMain.handle('move-to-group', (_e, id: string, gid: string | null) => { store.moveToGroup(id, gid); return { ok: true }; });
  ipcMain.handle('toggle-group-collapsed', (_e, gid: string, collapsed: boolean) => { store.toggleGroupCollapsed(gid, collapsed); return { ok: true }; });

  /* ---------- 顺序写回（拖拽） ---------- */
  ipcMain.handle('move-block', (_e, args: { srcGid: string | null; srcSvcId: string; dstGid: string | null; dstSvcId: string; before: boolean }) =>
    store.moveBlock(args.srcGid, args.srcSvcId, args.dstGid, args.dstSvcId, args.before));
  ipcMain.handle('move-member-in-group', (_e, args: { gid: string; srcId: string; dstId: string; before: boolean }) =>
    store.moveMemberInGroup(args.gid, args.srcId, args.dstId, args.before));

  /* ---------- 设置 ---------- */
  ipcMain.handle('set-settings', (_e, patch: Partial<Settings>) => {
    store.setSettings(patch);
    // v2.41：间隔改动必须立即重建心跳，否则设置页看着改了、界面节奏却没变
    if (typeof patch.pollMs === 'number') applyPollMs(patch.pollMs);
    return { ok: true };
  });

  /* ---------- 状态刷新可见性（v2.41） ---------- */
  ipcMain.handle('refresh-status', () => { refreshAllStatus(); return { ok: true }; });

  /* ---------- 模板 ---------- */
  ipcMain.handle('scan-templates', () => scanTemplates());
  ipcMain.handle('delete-template', (_e, file: string) => { deleteTemplateFile(file); return { ok: true }; });
  ipcMain.handle('open-template-folder', () => { shell.openPath(templateDir()); return { ok: true }; });
  ipcMain.handle('read-template-file', (_e, file: string) => {
    try {
      const p = templateFilePath(file);
      return { ok: true, text: fs.readFileSync(p, 'utf8') };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  // 模板页直接编辑 JSON 并保存：校验与原子写都在主进程完成，渲染器不能接触 fs
  ipcMain.handle('save-template-file', (_e, file: string, text: string) => {
    if (typeof file !== 'string' || typeof text !== 'string') {
      return { ok: false, code: 'path', message: 'invalid arguments', warnings: [] };
    }
    return saveTemplateText(file, text);
  });

  /* ---------- 指令库（脚本文件管理） ---------- */
  ipcMain.handle('scan-scripts', (_e, serviceMap: Record<string, string>) => {
    const map = new Map<string, string>(Object.entries(serviceMap));
    return scanScripts(map);
  });
  ipcMain.handle('read-script-file', (_e, relPath: string) => readScriptFile(relPath));
  ipcMain.handle('save-script-file', (_e, relPath: string, content: string) => saveScriptFile(relPath, content));
  ipcMain.handle('delete-script-file', (_e, relPath: string) => deleteScriptFile(relPath));
  ipcMain.handle('run-script-file', async (_e, relPath: string) => runScriptFile(relPath));
  ipcMain.handle('open-script-folder', () => { shell.openPath(scriptsDir()); return { ok: true }; });
  ipcMain.handle('create-script-dir', (_e, serviceId: string) => createScriptDir(serviceId));

  /* ---------- 选脚本文件（动作命令 / 执行器） ----------
   * 对话框文案由渲染器按当前界面语言提供（主进程不持有词典），
   * 未提供时回落到简体原文，保证旧版调用方仍可用。 */
  ipcMain.handle('select-file', async (_e, kind: 'script' | 'runner', labels?: {
    title?: string; exec?: string; all?: string; script?: string; bat?: string; ps?: string; sh?: string;
  }) => {
    const win = BrowserWindow.getFocusedWindow();
    const L = {
      title: labels?.title ?? (kind === 'runner' ? '选择执行器（可执行文件）' : '选择脚本文件'),
      exec: labels?.exec ?? '可执行文件',
      all: labels?.all ?? '所有文件',
      script: labels?.script ?? '脚本 / 可执行文件',
      bat: labels?.bat ?? 'Windows 批处理',
      ps: labels?.ps ?? 'PowerShell',
      sh: labels?.sh ?? 'Shell 脚本'
    };
    const filters = kind === 'runner'
      ? [{ name: L.exec, extensions: ['exe', 'bat', 'cmd', 'ps1', 'sh'] }, { name: L.all, extensions: ['*'] }]
      : [
          { name: L.script, extensions: ['bat', 'cmd', 'ps1', 'sh', 'exe'] },
          { name: L.bat, extensions: ['bat', 'cmd'] },
          { name: L.ps, extensions: ['ps1'] },
          { name: L.sh, extensions: ['sh'] },
          { name: L.all, extensions: ['*'] }
        ];
    const opts: Electron.OpenDialogOptions = {
      title: L.title,
      properties: ['openFile'],
      filters
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  /* ---------- 打开 ---------- */
  ipcMain.handle('open-dir', async (_e, dir: string) => {
    if (!dir || !dir.trim()) return { ok: false, reason: '目录路径为空' };
    try {
      await shell.openPath(dir.trim());
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e && (e as Error).message || e) };
    }
  });
  ipcMain.handle('open-url', (_e, url: string) => {
    // 修订 40（交叉验证 K13）：仅放行 http/https，阻断 file:/javascript:/自定义协议
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅允许 http/https 链接' };
    shell.openExternal(url); return { ok: true };
  });

  /* ---------- 日志 ---------- */
  ipcMain.handle('get-service-log', (_e, id: string) => logs.get(id));
  ipcMain.handle('get-activity-log', () => logs.getActivity());

  /* ---------- 命令预检（静态，不执行进程） ---------- */
  ipcMain.handle('precheck-service', (_e, s: ServiceDefinition) => {
    const issues: string[] = [];
    for (const k of ['start', 'stop', 'restart'] as const) {
      const a = s.cfg.acts[k];
      if (!a) continue;
      if (a.type === 'exec' && (!a.command || !a.command.trim())) issues.push(k + ': exec 命令为空');
      if (a.runner !== undefined && typeof a.runner !== 'string') issues.push(k + ': runner 必须是单个可执行文件字符串');
      if (a.args && a.args.some(x => typeof x !== 'string')) issues.push(k + ': args 含非字符串项');
    }
    if (s.port < 1 || s.port > 65535) issues.push('端口越界');
    // 修订 57：命令里残留未展开的占位符必须当场指出。
    // 占位符本身会在保存时自动展开，但若上下文缺字段（如端口非法、目录为空），
    // 展开后会得到一个坏路径；此处提前拦截，把原因摆到用户面前。
    const ph = findServicePlaceholderIssues(s);
    for (const p of ph) issues.push(p + ': 命令含未展开的占位符');
    return { ok: issues.length === 0, issues };
  });

  /* ---------- 应用信息 ---------- */
  ipcMain.handle('app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    templateDir: templateDir(),
    logDir: logDir(),
    configPath: servicesYamlPath()
  }));
}
