/* ============================================================
 * preload：contextBridge 暴露受控 API 给前端
 * 前端拿不到 Node 能力，只能通过这里调用主进程
 * ============================================================ */
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  // 快照
  getSnapshot: () => invoke('get-snapshot'),

  // 单服务动作
  toggleService: (id: string) => invoke('toggle-service', id),
  restartService: (id: string) => invoke('restart-service', id),
  interruptStart: (id: string) => invoke('interrupt-start', id),

  // 组级动作
  groupStart: (gid: string) => invoke('group-start', gid),
  groupStop: (gid: string) => invoke('group-stop', gid),

  // 全部启停
  startAll: () => invoke('start-all'),
  stopAll: () => invoke('stop-all'),
  buildConfirmPlan: (kind: 'startAll' | 'stopAll') => invoke('build-confirm-plan', kind),

  // 服务配置
  upsertService: (s: unknown) => invoke('upsert-service', s),
  removeService: (id: string) => invoke('remove-service', id),
  renameService: (id: string, name: string) => invoke('rename-service', id, name),

  // 组合
  saveGroup: (g: unknown, memberIds: string[]) => invoke('save-group', g, memberIds),
  dissolveGroup: (gid: string) => invoke('dissolve-group', gid),
  deleteGroup: (gid: string) => invoke('delete-group', gid),
  moveToGroup: (id: string, gid: string | null) => invoke('move-to-group', id, gid),
  toggleGroupCollapsed: (gid: string, collapsed: boolean) => invoke('toggle-group-collapsed', gid, collapsed),

  // 顺序写回
  moveBlock: (args: unknown) => invoke('move-block', args),
  moveMemberInGroup: (args: unknown) => invoke('move-member-in-group', args),

  // 设置
  setSettings: (patch: unknown) => invoke('set-settings', patch),

  // 状态轮询可见性
  refreshStatus: () => invoke('refresh-status'),

  // 模板
  scanTemplates: () => invoke('scan-templates'),
  deleteTemplate: (file: string) => invoke('delete-template', file),
  openTemplateFolder: () => invoke('open-template-folder'),
  readTemplateFile: (file: string) => invoke('read-template-file', file),
  saveTemplateFile: (file: string, text: string) => invoke('save-template-file', file, text),

  // 指令库
  scanScripts: (serviceMap: Record<string, string>) => invoke('scan-scripts', serviceMap),
  readScriptFile: (relPath: string) => invoke('read-script-file', relPath),
  saveScriptFile: (relPath: string, content: string) => invoke('save-script-file', relPath, content),
  deleteScriptFile: (relPath: string) => invoke('delete-script-file', relPath),
  runScriptFile: (relPath: string) => invoke('run-script-file', relPath),
  openScriptFolder: () => invoke('open-script-folder'),
  createScriptDir: (serviceId: string) => invoke('create-script-dir', serviceId),

  // 打开
  openDir: (dir: string) => invoke('open-dir', dir),
  openUrl: (url: string) => invoke('open-url', url),

  // 选脚本文件 / 执行器
  selectFile: (kind: 'script' | 'runner', labels: unknown) => invoke('select-file', kind, labels),

  // 日志
  getServiceLog: (id: string) => invoke('get-service-log', id),
  getActivityLog: () => invoke('get-activity-log'),

  // 命令预检
  precheckService: (s: unknown) => invoke('precheck-service', s),

  // 应用信息
  appInfo: () => invoke('app-info'),

  // 事件订阅：返回取消函数
  onStoreEvent: (cb: (ev: unknown) => void) => {
    const handler = (_e: unknown, ev: unknown) => cb(ev);
    ipcRenderer.on('store-event', handler);
    return () => ipcRenderer.removeListener('store-event', handler);
  }
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('devstack', api);
