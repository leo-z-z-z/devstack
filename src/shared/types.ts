/* ============================================================
 * 共享类型：ServiceDefinition / GroupDefinition / 模板 / 状态模型
 * 与 docs/technical-design-v2.md 第 3 节契约一致
 * ============================================================ */

/** 动作命令：运行时被统一为 {type,command,args,timeoutMs} 四键 */
export type ActionType = 'exec' | 'builtin';

export interface ActionSpec {
  type: ActionType;
  /** exec 时为可执行文件路径或 PATH 内命令；builtin 时为空 */
  command?: string;
  /** 参数数组，不允许字符串拼接；占位符在实例化时已展开 */
  args?: string[];
  /** 可选执行器：单个可执行文件（如 cmd.exe / pwsh / /bin/bash），不带参数；留空按脚本扩展名自动选 */
  runner?: string;
  /** builtin 动作名，如 killProcessTree */
  builtin?: 'killProcessTree';
  timeoutMs?: number;
}

export interface ProbeSpec {
  /** 完成后探测的端口；无端口的一次性脚本允许缺省 */
  port?: number | null;
}

/** 组件固化配置（services.yaml 中每个服务的形态） */
export interface ServiceConfig {
  acts: Record<'start' | 'stop' | 'restart', ActionSpec | null>;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  /** 所属组合；null 表示平铺 */
  gid: string | null;
  sub?: string;
  port: number;
  webPort?: number;
  webUrl?: string | null;
  dir: string;
  /** 来源模板溯源（元信息，不回读模板） */
  template?: string;
  cfg: ServiceConfig;
}

export interface GroupDefinition {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface ServicesYaml {
  schemaVersion: 1;
  settings: Settings;
  groups: GroupDefinition[];
  services: ServiceDefinition[];
}

export interface Settings {
  pollMs: number;
  portSnapshot: boolean;
  logDays: number;
  autoStart: boolean;
}

/**
 * v2.43 状态轮询间隔：只允许 1 / 3 / 5 秒三档，默认 3 秒。
 * 心跳开销 ≈ 每轮 N 次 TCP 探测 + N 次 netstat/lsof 同步扫描，拉长间隔可线性降低占用；
 * 1 秒档保留给需要尽快发现服务崩溃的场景，5 秒档最省，代价是状态发现延迟最多 5 秒。
 */
export const POLL_INTERVALS: readonly number[] = [1000, 3000, 5000];
export const DEFAULT_POLL_MS = 3000;

export const DEFAULT_SETTINGS: Settings = {
  pollMs: DEFAULT_POLL_MS,
  portSnapshot: true,
  logDays: 7,
  autoStart: true
};

/* ---------- 运行时状态（不落盘） ---------- */
export type St = 'running' | 'starting' | 'stopping' | 'stopped' | 'unknown';

export interface RuntimeState {
  st: St;
  pid?: number;
  uptime?: string;
  /** 只描述端口本身：空闲 / 被占用 / 外部托管，不承载动作失败原因 */
  portNote?: string;
  owner?: string;
  ownerPid?: number;
  /** 动作失败说明（启动超时 / 停止超时），与端口冲突是两条独立语义 */
  actionNote?: string;
  /** 动作令牌：每次动作 +1，旧定时器回调凭它失效 */
  _tk: number;
}

/* ---------- 主页面三分统计：运行中 + 已停止 + 异常 = 服务总数 ---------- */
export type HealthCategory = 'running' | 'stopped' | 'exception';

/**
 * 主页面统计的唯一分类规则：
 * - actionNote（启动/停止失败）与「已停止但端口被外部进程占用」都归异常；
 * - starting 暂归运行中（running 卡下方另有启动中提示），stopping / 待检测归已停止；
 * - running 且端口由外部进程托管仍是运行中，不算异常。
 */
export function healthCategory(st?: RuntimeState): HealthCategory {
  const status = st?.st ?? 'unknown';
  if (st?.actionNote || (status === 'stopped' && st?.owner)) return 'exception';
  if (status === 'running' || status === 'starting') return 'running';
  return 'stopped';
}

/* ---------- 组件 JSON 模板（单组件 · 6 顶层键） ---------- */
export interface TemplateMeta { id: string; name: string; }

export interface Template {
  schemaVersion: 1;
  kind: 'service-template';
  meta: TemplateMeta;
  defaults: {
    displayName: string;
    installDirHint: string;
    webUrl?: string | null;
  };
  probe: { port: number };
  actions: {
    start: ActionSpec;
    stop: ActionSpec | null;
    restart: ActionSpec | null;
  };
}

export type TemplateValidState = 'ok' | 'invalid' | 'missing';

export interface TemplateScanItem {
  id: string;
  file: string;
  state: TemplateValidState;
  errors: string[];
  raw?: Template;
}

/* ---------- 指令库：脚本扫描项 ---------- */
export interface ScriptFileInfo {
  file: string;       // 脚本文件名（如 deploy.bat / es-start.bat）
  exists: boolean;
  size: number;
  ext: string;        // 脚本扩展名（.bat / .cmd / .ps1 / .sh）
}

export interface ScriptScanItem {
  serviceId: string;  // 文件夹名，也是服务脚本标识
  serviceName?: string;
  dir: string;        // 文件夹完整路径
  scripts: ScriptFileInfo[];  // 该文件夹下全部可运行脚本（.bat/.cmd/.ps1/.sh，不限命名）
}

/* ---------- IPC 事件载体 ---------- */
export interface StateSnapshot { [serviceId: string]: RuntimeState; }

export interface PortsConflictItem {
  id: string;
  port: number;
  owner: string;
  ownerPid: number;
  gid: string | null;
}

export interface LanePlanItem { label: string; serial: boolean; items: string[]; }

export interface LanePlan {
  kind: 'startAll' | 'stopAll' | 'groupStart' | 'groupStop';
  lanes: LanePlanItem[];
  skippedBusy: string[];
  conflicts: PortsConflictItem[];
}

/**
 * 二次确认计划里「不弹窗」的具体原因（v2.40 前置守卫）。
 * 纯枚举，不含文案，便于渲染器按语言映射提示。
 */
export type ConfirmSkipReason =
  | 'empty'       // 列表里一个服务都没有
  | 'no-target'   // 全部已处于目标态（点全部启动时全 running / 点全部停止时全 stopped）
  | 'all-busy'    // 全部处于启动中 / 停止中
  | 'in-flight'   // 组合串行链在途，暂时没有可操作项
  | 'not-ready';  // 状态尚未探测完成，或其它不可操作组合

export interface ConfirmAllPlan {
  stop: boolean;
  total: number;
  parallelCount: number;
  serialLanes: number;
  busyCount: number;
  busyNames: string[];
  conflicts: PortsConflictItem[];
  lanes: LanePlanItem[];
  /** 点击前置守卫：列表服务总数，<= 0 时不弹窗 */
  serviceCount: number;
  /** 点击前置守卫：本次是否确有可执行项（total > 0），false 时不弹窗 */
  actionable: boolean;
  /** actionable=false 时的具体原因，供渲染器给出精准提示；可操作时为 null */
  skipReason: ConfirmSkipReason | null;
}

/* ---------- 状态轮询可见性（v2.41） ---------- */
/**
 * 心跳轮次事件：主进程在每轮探测前后各推一次，渲染器据此显示「系统正在刷新服务」。
 * scope 是本轮真正探测的服务数；auto 只含已启动组件，manual 含全部可探测组件。
 * v2.42：0 项已启动时主进程不产生 auto 轮次事件（整轮跳过），manual 由用户点击触发，不受此限。
 */
export interface PollCycle {
  /** 轮次序号：渲染器只接受最新一轮的 end，避免延迟 end 覆盖下一轮 begin */
  seq: number;
  phase: 'begin' | 'end';
  /** auto = 周期刷新（范围仅已启动组件）；manual = 用户点击后的全量刷新 */
  mode: 'auto' | 'manual';
  /** 本轮实际探测的服务数 */
  scope: number;
  /** 当前生效的轮询间隔（毫秒） */
  pollMs: number;
  ts: number;
}
