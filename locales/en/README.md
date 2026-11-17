# devstack — Local Service Manager

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
  Cross-platform (Windows / macOS / Linux) local service manager · Electron + React + TypeScript · Unified start/stop, status check, log view
</p>

<p align="center">
  <a href="zh-CN/README.md">简体中文</a>
  ｜
  <strong>English</strong>
  ｜
  <a href="zh-TW/README.md">繁體中文</a>
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

## About

devstack is a desktop command panel for local middleware and services, supporting service start/stop, grouped serial orchestration, real-time status detection, and port conflict alerts. It suits local development environments, allowing you to uniformly start/stop, check status, and view logs for Redis, MySQL, PostgreSQL, Elasticsearch, Kibana, MinIO and other services, starting them on demand as needed.

The software does not download, unzip, or install any middleware; all components are installed by the user themselves. The software only reads the installation directory specified by the user and issues start/stop commands. Configuration and logs are stored locally only, with no data uploaded to the network.

## Features

- **Unified start/stop**: One-click start / stop / restart / open installation directory, with customizable commands and arguments
- **Real-time status visibility**: Pure TCP port probing + owning PID attribution, clearly showing running / stopped / exception three states
- **Port conflict interception**: Shows the occupying process name and PID; intercepts before start if the service is not started but the port is already occupied
- **Port direct access**: The port column is a clickable link opened with the system default browser (overridable via `webUrl`)
- **Grouped serial orchestration**: Users manually create groups; members within a group start serially from top to bottom, and stop in reverse order; ungrouped services start in parallel
- **Drag-and-drop sorting**: The main panel's only ordering method; drag group cards as a whole, and group members can only be dragged within their group
- **Template system**: One JSON template per component; drop into the `presets/` directory to be recognized; one-time fill when creating a new service, decoupled from subsequent configuration
- **Log viewing**: Captures command stdout/stderr plus specified log file tail, usable separately or simultaneously, persisted to local log files
- **Two-step confirmation**: Bulk start / bulk stop / delete service all require confirmation, with the popup stating impact scope and execution order
- **Internationalization**: 9 languages (Simplified Chinese / Traditional Chinese / English / Japanese / Korean / French / Spanish / German / Portuguese), top-bar switching takes effect immediately

## Application Screenshots

![Application Screenshot 1](../assets/1.png)
![Application Screenshot 2](../assets/2.png)

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Main Process | Electron (Node.js) | Process management, port probing, config read/write, log tail |
| Renderer Layer | React 18 + TypeScript | UI and status subscription, Vite build |
| Packaging | Electron-builder | MSI / NSIS / dmg / AppImage distribution packages |
| Config | `services.yaml` | Service definition, grouping, ordering, settings |
| Template | `presets/*.json` | Single-component template, 6 top-level keys |

## Quick Start

### Requirements

- Node.js ≥ 18 (recommended 20+)
- Git
- Middleware installed locally that you want to manage (Redis / MySQL / PostgreSQL / Elasticsearch, etc.)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# Install dependencies
npm install

# Start development mode (Vite + Electron)
npm run dev

# Run Web debugging only (without Electron)
npm run dev:web
```

### Build & Package

```bash
# Build renderer layer + compile main process
npm run build

# Launch the built application
npm start

# Package to distribution directory
npm run pack

# Full packaging installer (MSI / NSIS / dmg, etc.)
npm run dist
```

Build artifacts are output to `dist/` or `release/`, ready for direct distribution to end users.

### Data & Config Directory (Runtime)

After first run, configuration and logs are placed in the platform-standard location, directory name `devstack`:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

Subdirectories:

- `services.yaml` — Service definition, grouping, ordering, settings (manual editing takes effect, read on restart)
- `presets/` — User custom JSON templates
- `scripts/` — Command library scripts (.bat/.cmd/.ps1/.sh, organized by folder)
- `logs/` — Service logs and application runtime logs

> During development, you can use the environment variable `DEVSTACK_DATA_DIR` to isolate the data directory to any location, avoiding contention with running instances.

## Project Structure (app/)

```
app/
├── .gitignore          # Git ignore (node_modules / dist-electron / .env, etc.)
├── .gitattributes      # Line ending rules (source uniformly LF)
├── LICENSE             # Apache-2.0
├── package.json        # Dependencies and scripts
├── package-lock.json
├── tsconfig.json       # Renderer TS config
├── tsconfig.electron.json  # Main process TS config
├── vite.config.ts      # Vite config
├── scripts/            # Auxiliary scripts (startup, verification, i18n key registration, etc.)
├── src/
│   ├── main/           # Electron main process (process management, port probing, config, logs)
│   ├── renderer/       # React renderer layer (Vite)
│   └── shared/         # Shared types
└── test/               # Smoke, template, path, status semantics tests, etc.
```

## Built-in Component Templates

The package includes 9 built-in component templates (usable directly or copy to modify):

| Template ID | Component | Default Port |
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

## Contributing

This project is under continuous development; contributions are welcome.

- Issue feedback: Please submit [Issues](https://github.com/leo-z-z-z/devstack/issues), describing reproduction steps and environment information
- Feature suggestions: Welcome to propose new component templates, new platform support, or interaction optimizations in Issues
- Code contribution: Fork the repo and submit a Pull Request; please keep commit messages in conventional commit format (e.g. `feat:` / `fix:` / `docs:`)

## License

This project is licensed under [Apache License 2.0](./LICENSE).
