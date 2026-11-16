/* 前端访问主进程的封装：window.devstack 由 preload 暴露 */
import type {
  ServiceDefinition, GroupDefinition, Settings, RuntimeState,
  TemplateScanItem, ConfirmAllPlan, PollCycle, ScriptScanItem
} from '../shared/types';

export interface Snapshot {
  services: ServiceDefinition[];
  groups: GroupDefinition[];
  settings: Settings;
  states: Record<string, RuntimeState>;
}

export interface Api {
  getSnapshot(): Promise<Snapshot>;
  toggleService(id: string): Promise<{ ok: boolean; reason?: string }>;
  restartService(id: string): Promise<{ ok: boolean; reason?: string }>;
  interruptStart(id: string): Promise<{ ok: boolean; reason?: string }>;
  groupStart(gid: string): Promise<{ ok: boolean; reason?: string }>;
  groupStop(gid: string): Promise<{ ok: boolean; reason?: string }>;
  startAll(): Promise<{ ok: boolean; reason?: string }>;
  stopAll(): Promise<{ ok: boolean; reason?: string }>;
  buildConfirmPlan(kind: 'startAll' | 'stopAll'): Promise<ConfirmAllPlan>;
  upsertService(s: ServiceDefinition): Promise<{ ok: boolean }>;
  removeService(id: string): Promise<{ ok: boolean }>;
  renameService(id: string, name: string): Promise<{ ok: boolean }>;
  saveGroup(g: GroupDefinition, memberIds: string[]): Promise<{ ok: boolean }>;
  dissolveGroup(gid: string): Promise<{ ok: boolean }>;
  deleteGroup(gid: string): Promise<{ ok: boolean }>;
  moveToGroup(id: string, gid: string | null): Promise<{ ok: boolean }>;
  toggleGroupCollapsed(gid: string, collapsed: boolean): Promise<{ ok: boolean }>;
  moveBlock(args: { srcGid: string | null; srcSvcId: string; dstGid: string | null; dstSvcId: string; before: boolean }): Promise<number>;
  moveMemberInGroup(args: { gid: string; srcId: string; dstId: string; before: boolean }): Promise<number>;
  setSettings(patch: Partial<Settings>): Promise<{ ok: boolean }>;
  refreshStatus(): Promise<{ ok: boolean }>;
  scanTemplates(): Promise<TemplateScanItem[]>;
  deleteTemplate(file: string): Promise<{ ok: boolean }>;
  openTemplateFolder(): Promise<{ ok: boolean }>;
  readTemplateFile(file: string): Promise<{ ok: boolean; text?: string; error?: string }>;
  saveTemplateFile(file: string, text: string): Promise<SaveTemplateResult>;

  // 指令库
  scanScripts(serviceMap: Record<string, string>): Promise<ScriptScanItem[]>;
  readScriptFile(relPath: string): Promise<{ ok: boolean; text?: string; error?: string }>;
  saveScriptFile(relPath: string, content: string): Promise<{ ok: boolean; code?: 'path' | 'too-large' | 'write'; message?: string }>;
  deleteScriptFile(relPath: string): Promise<{ ok: boolean; error?: string }>;
  runScriptFile(relPath: string): Promise<{ ok: boolean; code?: number | null; stdout?: string; stderr?: string; error?: string }>;
  openScriptFolder(): Promise<{ ok: boolean }>;
  createScriptDir(serviceId: string): Promise<{ ok: boolean; dir?: string; error?: string }>;

  openDir(dir: string): Promise<{ ok: boolean }>;
  openUrl(url: string): Promise<{ ok: boolean }>;
  selectFile(kind: 'script' | 'runner', labels: FileDialogLabels): Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  getServiceLog(id: string): Promise<LogLine[]>;
  getActivityLog(): Promise<LogLine[]>;
  precheckService(s: ServiceDefinition): Promise<{ ok: boolean; issues: string[] }>;
  appInfo(): Promise<{ version: string; platform: string; templateDir: string; logDir: string }>;
  onStoreEvent(cb: (ev: StoreEvent) => void): () => void;
}

export interface SaveTemplateResult {
  ok: boolean;
  code?: 'syntax' | 'too-large' | 'path' | 'write';
  message?: string;
  line?: number;
  column?: number;
  warnings: string[];
}

export interface LogLine { ts: string; level: string; tag: string; msg: string; }

/** 原生文件选择框的文案由渲染器按当前语言提供（主进程不持有词典） */
export interface FileDialogLabels {
  title: string;
  exec: string;
  all: string;
  script: string;
  bat: string;
  ps: string;
  sh: string;
}

export type StoreEvent =
  | { type: 'snapshot' }
  | { type: 'service-status'; id: string; state: RuntimeState }
  | { type: 'config-changed' }
  | { type: 'templates-changed' }
  | { type: 'template-scan-progress'; done: number; total: number }
  | { type: 'activity'; level: string; tag: string; msg: string }
  | { type: 'service-log'; id: string; line: LogLine }
  | { type: 'poll-cycle'; cycle: PollCycle };

declare global {
  interface Window { devstack: Api; }
}

export const api: Api = window.devstack;
