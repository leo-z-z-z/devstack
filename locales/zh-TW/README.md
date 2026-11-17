# devstack — 跨平台本地服務管理器

<p align="center">
  <a href="https://github.com/leo-z-z-z/devstack/stargazers">
    <img src="https://img.shields.io/github/stars/leo-z-z-z/devstack?style=social" alt="Stars"/>
  </a>
  <a href="https://github.com/leo-z-z-z/devstack/network/members">
    <img src="https://img.shields.io/github/forks/leo-z-z-z/devstack?style=social" alt="Forks"/>
  </a>
  <a href="https://github.com/leo-z-z-z/devstack/issues">
    <img src="https://img.shields.io/github/issues/leo-z-z-z/devstack" alt="Issues"/>
  </a>
  <a href="https://github.com/leo-z-z-z/devstack/pulls">
    <img src="https://img.shields.io/github/issues-pr/leo-z-z-z/devstack" alt="Pull Requests"/>
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/leo-z-z-z/devstack" alt="License"/>
  </a>
</p>

<p align="center">
  跨平台（Windows / macOS / Linux）本地服務管理器 · Electron + React + TypeScript · 統一起停、查看狀態、看日誌
</p>

<p align="center">
  <a href="zh-CN/README.md">简体中文</a>
  ｜
  <a href="en/README.md">English</a>
  ｜
  <strong>繁體中文</strong>
  ｜
  <a href="ja/README.md">日本語</a>
  ｜
  <a href="ko/README.md">한국어</a>
  ｜
  <a href="fr/README.md">Français</a>
  ｜
  <a href="es/README.md">Español</a>
  ｜
  <a href="de/README.md">Deutsch</a>
  ｜
  <a href="pt/README.md">Português</a>
</p>

## 關於

devstack 是一個面向本地中介軟體與服務的桌面指令面板，支援服務啟停、分組串列編排、即時狀態偵測與連接埠衝突告警。適合本地開發環境，將 Redis、MySQL、PostgreSQL、Elasticsearch、Kibana、MinIO 等各種服務統一啟停、查看狀態、看日誌，本地開發環境依需求啟動。

軟體不下載、不解壓縮、不安裝任何中介軟體；所有組件由使用者自行安裝，軟體僅讀取使用者指定的安裝目錄並下發啟停指令。配置與日誌僅落在本地，不聯網上傳任何資料。

## 特色

- **統一啟停**：一鍵啟動 / 停止 / 重啟 / 打開安裝目錄，指令與參數可自訂
- **狀態即時可見**：純 TCP 連接埠偵測 + owning PID 歸屬判定，運行中 / 已停止 / 例外三態清楚顯示
- **連接埠衝突攔截**：顯示佔用者進程名稱與 PID，服務未啟動卻已被佔用時啟動前攔截
- **連接埠直達**：連接埠欄位為可點擊連結，使用系統預設瀏覽器開啟（可由 `webUrl` 覆蓋）
- **分組串列編排**：使用者手動建立分組，組內成員由上至下串列啟動，停止則逆序；未分組服務並行發起
- **拖曳排序**：主面板唯一的順序調整方式，組卡整塊拖曳，組內成員僅限組內拖曳
- **模板系統**：一個組件一個 JSON 模板，放入 `presets/` 目錄即可識別，首次新建服務時一次性填充，與後續配置脫鉤
- **日誌檢視**：指令 stdout/stderr 擷取 + 指定日誌檔案 tail，支援單獨或同時啟用，落盤到本地日誌檔案
- **二次確認**：全部啟動 / 全部停止 / 刪除服務均需確認，彈窗說明影響範圍與執行順序
- **國際化**：9 種語言（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Español / Deutsch / Português），頂欄切換即時生效

## 技術棧

| 層 | 技術 | 用途 |
|----|------|------|
| 主進程 | Electron (Node.js) | 進程託管、連接埠偵測、配置讀寫、日誌 tail |
| 渲染層 | React 18 + TypeScript | 介面與狀態訂閱，Vite 建構 |
| 打包 | Electron-builder | MSI / NSIS / dmg / AppImage 分發套件 |
| 配置 | `services.yaml` | 服務定義、分組、順序、設定 |
| 模板 | `presets/*.json` | 單組件模板，6 個最上層鍵 |

## 快速開始

### 環境需求

- Node.js ≥ 18（推薦 20+）
- Git
- 本地已安裝你要管理的中介軟體（Redis / MySQL / PostgreSQL / Elasticsearch 等）

### 安裝與執行

```bash
# 克隆儲存庫
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# 安裝依賴
npm install

# 啟動開發模式（Vite + Electron）
npm run dev

# 僅執行 Web 偵錯（不啟動 Electron）
npm run dev:web
```

### 建構與打包

```bash
# 建構渲染層 + 編譯主進程
npm run build

# 啟動已建構的應用程式
npm start

# 打包為分發目錄
npm run pack

# 完整打包安裝套件（MSI / NSIS / dmg 等）
npm run dist
```

建構產物輸出至 `dist/` 或 `release/`，可直接分發給最終使用者。

### 資料與配置目錄（運行時）

首次運行後，配置與日誌落在平台標準位置，目錄名為 `devstack`：

| 平台 | 路徑 |
|------|------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

子目錄：

- `services.yaml` — 服務定義、分組、順序、設定（手動編輯也生效，重新啟動讀取）
- `presets/` — 使用者自訂 JSON 模板
- `scripts/` — 指令庫腳本（.bat/.cmd/.ps1/.sh，按資料夾組織）
- `logs/` — 服務日誌與軟體運行日誌

> 開發期可透過環境變數 `DEVSTACK_DATA_DIR` 將資料目錄隔離到任意位置，避免與已運行實例搶占資源。

## 專案結構（app/）

```
app/
├── .gitignore          # Git 忽略（node_modules / dist-electron / .env 等）
├── .gitattributes      # 換行符規範（來源碼統一 LF）
├── LICENSE             # Apache-2.0
├── package.json        # 依賴與腳本
├── package-lock.json
├── tsconfig.json       # 渲染層 TS 配置
├── tsconfig.electron.json  # 主進程 TS 配置
├── vite.config.ts      # Vite 配置
├── scripts/            # 輔助腳本（啟動、驗證、i18n 鍵註冊等）
├── src/
│   ├── main/           # Electron 主進程（進程託管、連接埠偵測、配置、日誌）
│   ├── renderer/       # React 渲染層（Vite）
│   └── shared/         # 共享類型
└── test/               # 冒煙、模板、路徑、狀態語義等測試
```

## 隨套組件模板

套件自帶 9 個組件模板（可直接使用或複製修改）：

| 模板 ID | 組件 | 預設連接埠 |
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

## 貢獻

本專案仍在持續更新之中，歡迎您參與。

- 問題回饋：請提交 [Issues](https://github.com/leo-z-z-z/devstack/issues)，描述重現步驟與環境資訊
- 功能建議：歡迎在 Issues 中提出新組件模板、新平台支援或交互優化建議
- 程式碼貢獻：Fork 儲存庫後提交 Pull Request，請保持提交訊息採用慣例式提交（如 `feat:` / `fix:` / `docs:`）

## 授權

本專案基於 [Apache License 2.0](./LICENSE) 開源。
