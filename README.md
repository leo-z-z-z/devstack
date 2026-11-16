# devstack — 跨平台本地服务管理器

**Service Deck / 本地服务管理器**：一个面向本地中间件与服务的桌面命令面板，支持服务启停、分组串行编排、实时状态探测与端口冲突告警。

跨平台（Windows / macOS / Linux），由 **Electron（主进程） + React + TypeScript（渲染层）** 构建，配置与日志仅落在本地，不联网上传任何数据。

> 适合本地开发环境：Redis、MySQL、PostgreSQL、Elasticsearch、Logstash、Kibana、RocketMQ、MinIO 等组件，统一起停、查状态、看日志，无需记一堆命令。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| **启停重启** | 四类动作：启动 / 停止 / 重启 / 打开安装目录；命令与参数可自定义 |
| **状态探测** | 纯 TCP 端口探测 + owning PID 归属判定；运行中 / 已停止 / 异常三态 |
| **端口冲突告警** | 展示 LISTEN 状态、占用者进程名与 PID；服务未启动却被占用时启动前拦截 |
| **端口直达** | 端口列为可点击链接，用系统默认浏览器打开（可由 `webUrl` 覆盖） |
| **分组串行编排** | 用户手动创建分组，组内成员从上到下串行启动，停止逆序；未分组服务并行发起 |
| **拖拽排序** | 主面板唯一的顺序调整方式；组卡整块拖动，组内成员仅限组内拖动 |
| **模板系统** | 一个组件一个 JSON 模板，放入 `presets/` 目录即可识别；首次新建服务时一次性填充，与后续配置脱钩 |
| **日志查看** | 命令 stdout/stderr 捕获 + 指定日志文件 tail，支持单独或同时启用 |
| **二次确认** | 全部启动 / 全部停止 / 删除服务均需确认，弹窗写明影响范围与执行顺序 |
| **国际化** | 9 种语言：简体中文（默认）、繁體中文、English、日本語、한국어、Français、Español、Deutsch、Português |
| **日常设置** | 轮询间隔（1/3/5 秒）、端口快照、日志保留天数、开机自启 |

---

## 技术栈

- **主进程**：Electron（Node.js），负责进程托管、端口探测、配置读写、日志 tail
- **渲染层**：React 18 + TypeScript，Vite 构建
- **构建与打包**：`vite build` + `tsc`；Electron-builder 打包（MSI / NSIS / dmg / AppImage）
- **配置格式**：`services.yaml`（服务定义、分组、顺序、设置）
- **模板格式**：`presets/*.json`（单组件，6 顶层键：`schemaVersion / kind / meta / defaults / probe / actions`）

随包自带 9 个组件模板（可直接使用或复制修改）：

| 模板 ID | 组件 | 默认端口 |
|---------|------|----------|
| `redis` | Redis | 6379 |
| `mysql` | MySQL | 3306 |
| `postgresql` | PostgreSQL | 5432 |
| `elasticsearch` | Elasticsearch | 9200 |
| `logstash` | Logstash | 9600 |
| `kibana` | Kibana | 5601 |
| `rocketmq-nameserver` | RocketMQ NameServer | 9876 |
| `rocketmq-broker` | RocketMQ Broker | 10911 |
| `minio` | MinIO | 9000 |

> 本软件不下载、不解压、不安装任何中间件；所有组件由用户自行安装，软件仅读取用户指定的安装目录并下发启停命令。

---

## 快速开始

### 环境要求

- Node.js ≥ 18（推荐 20+）
- 本地已安装你要管理的中间件（Redis/MySQL/ES 等）

### 开发运行

```bash
# 进入项目目录
cd app

# 安装依赖
npm install

# 启动开发模式（Vite + Electron）
npm run dev

# 仅运行 Web 调试（不启 Electron）
npm run dev:web
```

### 构建打包

```bash
# 构建渲染层 + 编译主进程
npm run build

# 启动已构建的应用
npm start

# 打包为分发安装包（目录输出）
npm run pack

# 完整打包安装包（MSI / NSIS / dmg 等）
npm run dist
```

---

## 项目结构（app/）

```
app/
├── .gitignore          # Git 忽略（node_modules / dist-electron / .env 等）
├── .gitattributes      # 换行符规范（源码统一 LF）
├── LICENSE             # Apache-2.0
├── package.json        # 依赖与脚本
├── package-lock.json
├── tsconfig.json       # 渲染层 TS 配置
├── tsconfig.electron.json  # 主进程 TS 配置
├── vite.config.ts      # Vite 配置
├── scripts/            # 辅助脚本（启动、校验、i18n 键注册等）
├── src/
│   ├── main/           # Electron 主进程（进程托管、端口探测、配置、日志）
│   │   ├── index.ts    # 主进程入口
│   │   ├── runner.ts   # 跨平台进程管理（spawn / kill 进程树）
│   │   ├── probe.ts    # 端口探测 + owning PID 归属
│   │   ├── schedule.ts # 批量启停编排（并行区 + 组合串行链）
│   │   ├── script.ts   # 指令库脚本扫描与执行
│   │   ├── template.ts # 模板扫描与校验
│   │   ├── config.ts   # services.yaml 读写与校验
│   │   ├── paths.ts    # 跨平台数据目录与路径归一
│   │   ├── store.ts    # 内存状态容器
│   │   ├── preset.ts   # 随包模板默认命令
│   │   ├── preload.ts  # 预加载脚本
│   │   └── logs.ts     # 日志读取
│   ├── renderer/       # React 渲染层（Vite）
│   │   ├── App.tsx     # 应用壳（顶栏、路由、抽屉、弹窗、toast）
│   │   ├── main.tsx    # 渲染层入口
│   │   ├── i18n.ts / i18n-hook.ts   # 9 语国际化（词典 + 复数层）
│   │   ├── components/ # 各页面与组件（服务、日志、模板、指令库、设置等）
│   │   └── ...
│   └── shared/         # 共享类型（ServiceDefinition / GroupDefinition / ActionSpec 等）
└── test/               # 冒烟、模板、路径、状态语义等测试
```

### 数据与配置目录（运行时）

首次运行后，配置与日志落在平台标准位置，目录名为 `devstack`：

- **Windows**：`%APPDATA%\devstack\`
- **macOS**：`~/Library/Application Support/devstack/`
- **Linux**：`~/.devstack/`

子目录：

- `services.yaml` — 服务定义、分组、顺序、设置（手动编辑也生效，重启读取）
- `presets/` — 用户自定义 JSON 模板
- `scripts/` — 指令库脚本（.bat/.cmd/.ps1/.sh，按文件夹组织）
- `logs/` — 服务日志

> 开发期可通过环境变量 `DEVSTACK_DATA_DIR` 将数据目录隔离到任意位置，避免与已运行实例抢占资源。

---

## 脚本开发与贡献

`scripts/` 目录下包含若干自动化与校验脚本（i18n 键注册、模板校验、Redis 真实运行验证等），可按需扩展。

### 提交规范

提交信息采用惯例式提交，例如：

```
feat: 本地服务管理器桌面应用（Electron + React + TypeScript）
fix: 指令库删除按钮双重翻译
```

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 开源。

---

> 本 README 随仓库初始同步提交，如有功能调整请同步更新文档。详细技术设计见 `docs/technical-design-v2.md`（工作区根目录）。
