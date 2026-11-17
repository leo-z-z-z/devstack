# devstack — クロスプラットフォーム ローカルサービスマネージャー

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
  クロスプラットフォーム（Windows / macOS / Linux）ローカルサービスマネージャー · Electron + React + TypeScript · 統一起動・停止・状態確認・ログ閲覧
</p>

<p align="center">
  <a href="zh-CN/README.md">简体中文</a>
  ｜
  <a href="en/README.md">English</a>
  ｜
  <a href="zh-TW/README.md">繁體中文</a>
  ｜
  <strong>日本語</strong>
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

## About

devstack は、ローカルミドルウェアおよびサービス向けのデスクトップコマンドパネルです。サービスの起動・停止、グループによる直列オーケストレーション、リアルタイムの状態検出、ポート競合アラートをサポートします。ローカル開発環境に適しており、Redis、MySQL、PostgreSQL、Elasticsearch、Kibana、MinIO などのサービスを統一的に起動・停止・状態確認・ログ閲覧でき、必要に応じて起動できます。

本ソフトウェアはミドルウェアをダウンロード・解凍・インストールしません。すべてのコンポーネントはユーザー自身がインストールします。ソフトウェアはユーザーが指定したインストールディレクトリを読み取り、起動/停止コマンドを発行するのみです。設定とログはローカルにのみ保存され、ネットワークにデータをアップロードしません。

## 機能

- **統一起動/停止**: ワンクリックで起動 / 停止 / 再起動 / インストールディレクトリを開く。コマンドと引数はカスタマイズ可能
- **リアルタイム状態確認**: 純粋な TCP ポートプローブ + owning PID 帰属判定により、実行中 / 停止 / 例外の3状態を明確に表示
- **ポート競合遮断**: 占有プロセス名と PID を表示。サービスが起動していないのにポートが既に占有されている場合、起動前に遮断
- **ポート直達**: ポート列はクリック可能なリンクで、システムのデフォルトブラウザで開きます（`webUrl` で上書き可能）
- **グループ直列オーケストレーション**: ユーザーが手動でグループを作成。グループ内のメンバーは上から下へ直列に起動し、停止は逆順。グループに属さないサービスは並列で起動
- **ドラッグアンドドロップ並べ替え**: メインパネルの唯一の順序調整方法。グループカードはまとめてドラッグ可能。グループ内メンバーはグループ内でのみドラッグ可能
- **テンプレートシステム**: 1コンポーネントにつき1つの JSON テンプレート。`presets/` ディレクトリに配置すると認識されます。新規サービス作成時に一度だけ入力され、後続の設定とは切り離されます
- **ログ閲覧**: コマンドの stdout/stderr キャプチャ + 指定ログファイルの tail。個別または同時利用が可能。ローカルログファイルに保存
- **二段階確認**: 一括起動 / 一括停止 / サービス削除はすべて確認が必要。ポップアップに影響範囲と実行順序を表示
- **多言語対応**: 9言語（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Español / Deutsch / Português）。トップバー切り替えで即時反映

## アプリケーションスクリーンショット

![アプリケーションスクリーンショット1](../assets/1.png)
![アプリケーションスクリーンショット2](../assets/2.png)

## 技術スタック

| 層 | 技術 | 用途 |
|----|------|------|
| メインプロセス | Electron (Node.js) | プロセス管理、ポート検出、設定の読み書き、ログ tail |
| レンダラー層 | React 18 + TypeScript | UI と状態購読、Vite ビルド |
| パッケージング | Electron-builder | MSI / NSIS / dmg / AppImage 配布パッケージ |
| 設定 | `services.yaml` | サービス定義、グループ化、順序、設定 |
| テンプレート | `presets/*.json` | 単一コンポーネントテンプレート、6つのトップレベルキー |

## クイックスタート

### 要件

- Node.js ≥ 18（推奨 20+）
- Git
- 管理したいミドルウェアがローカルにインストール済みであること（Redis / MySQL / PostgreSQL / Elasticsearch など）

### インストールと実行

```bash
# リポジトリをクローン
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# 依存関係をインストール
npm install

# 開発モードで起動（Vite + Electron）
npm run dev

# Web デバッグのみ実行（Electron を起動しない）
npm run dev:web
```

### ビルドとパッケージング

```bash
# レンダラー層をビルド + メインプロセスをコンパイル
npm run build

# ビルド済みアプリケーションを起動
npm start

# 配布ディレクトリにパッケージ化
npm run pack

# インストーラーをフルパッケージング（MSI / NSIS / dmg など）
npm run dist
```

ビルド成果物は `dist/` または `release/` に出力され、エンドユーザーに直接配布可能です。

### データおよび設定ディレクトリ（実行時）

初回実行後、設定とログはプラットフォーム標準の場所に配置されます。ディレクトリ名は `devstack`：

| プラットフォーム | パス |
|----------|------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

サブディレクトリ：

- `services.yaml` — サービス定義、グループ化、順序、設定（手動編集も有効、再起動時に読み込み）
- `presets/` — ユーザー定義の JSON テンプレート
- `scripts/` — コマンドライブラリスクリプト（.bat/.cmd/.ps1/.sh、フォルダ単位で整理）
- `logs/` — サービスログとアプリケーション実行ログ

> 開発中は環境変数 `DEVSTACK_DATA_DIR` を使用してデータディレクトリを任意の場所に隔離でき、実行中のインスタンスとの競合を避けられます。

## プロジェクト構造（app/）

```
app/
├── .gitignore          # Git 無視（node_modules / dist-electron / .env など）
├── .gitattributes      # 改行コード規則（ソースコードは統一 LF）
├── LICENSE             # Apache-2.0
├── package.json        # 依存関係とスクリプト
├── package-lock.json
├── tsconfig.json       # レンダラー TS 設定
├── tsconfig.electron.json  # メインプロセス TS 設定
├── vite.config.ts      # Vite 設定
├── scripts/            # 補助スクリプト（起動、検証、i18n キー登録など）
├── src/
│   ├── main/           # Electron メインプロセス（プロセス管理、ポート検出、設定、ログ）
│   ├── renderer/       # React レンダラー層（Vite）
│   └── shared/         # 共有型定義
└── test/               # スモークテスト、テンプレート、パス、状態セマンティクステストなど
```

## ビルドイン コンポーネント テンプレート

パッケージには 9 つのビルドイン コンポーネント テンプレートが含まれます（直接使用またはコピーして変更可能）：

| テンプレート ID | コンポーネント | デフォルトポート |
|-------------|-----------|--------------|
| `redis` | Redis | 6379 |
| `mysql` | MySQL | 3306 |
| `postgresql` | PostgreSQL | 5432 |
| `elasticsearch` | Elasticsearch | 9200 |
| `logstash` | Logstash | 9600 |
| `kibana` | Kibana | 5601 |
| `rocketmq-nameserver` | RocketMQ NameServer | 9876 |
| `rocketmq-broker` | RocketMQ Broker | 10911 |
| `minio` | MinIO | 9000 |

## コントリビュート

本プロジェクトは継続的に更新中です。貢献を歓迎します。

- 問題フィードバック: [Issues](https://github.com/leo-z-z-z/devstack/issues) を提出し、再現手順と環境情報を説明してください
- 機能提案: Issues で新コンポーネントテンプレート、新プラットフォーム対応、インタラクション最適化を提案してください
- コード貢献: リポジトリを Fork し、Pull Request を提出してください。コミットメッセージは慣例的コミット形式（例: `feat:` / `fix:` / `docs:`）を維持してください

## ライセンス

本プロジェクトは [Apache License 2.0](./LICENSE) の下でライセンスされています。
