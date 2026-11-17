# devstack — 크로스 플랫폼 로컬 서비스 매니저

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
  크로스 플랫폼（Windows / macOS / Linux）로컬 서비스 매니저 · Electron + React + TypeScript · 통합 시작/중지, 상태 확인, 로그 보기
</p>

<p align="center">
  <a href="zh-CN/README.md">简体中文</a>
  ｜
  <a href="en/README.md">English</a>
  ｜
  <a href="zh-TW/README.md">繁體中文</a>
  ｜
  <a href="ja/README.md">日本語</a>
  ｜
  <strong>한국어</strong>
  ｜
  <a href="fr/README.md">Français</a>
  ｜
  <a href="es/README.md">Español</a>
  ｜
  <a href="de/README.md">Deutsch</a>
  ｜
  <a href="pt/README.md">Português</a>
</p>

## 소개

devstack는 로컬 미들웨어 및 서비스를 위한 데스크톱 명령 패널로, 서비스 시작/중지, 그룹별 직렬 오케스트레이션, 실시간 상태 감지, 포트 충돌 경고를 지원합니다. 로컬 개발 환경에 적합하며, Redis, MySQL, PostgreSQL, Elasticsearch, Kibana, MinIO 등 서비스를 통합적으로 시작/중지하고 상태를 확인하며 로그를 볼 수 있으며, 필요에 따라 시작할 수 있습니다.

본 소프트웨어는 미들웨어를 다운로드, 압축 해제, 설치하지 않습니다. 모든 구성 요소는 사용자가 직접 설치합니다. 소프트웨어는 사용자가 지정한 설치 디렉토리만 읽고 시작/중지 명령을 내릴 뿐입니다. 구성 및 로그는 로컬에만 저장되며 네트워크로 데이터를 업로드하지 않습니다.

## 기능

- **통합 시작/중지**: 원클릭 시작 / 중지 / 재시작 / 설치 디렉토리 열기, 명령 및 인자 사용자 지정 가능
- **실시간 상태 확인**: 순수 TCP 포트 프로빙 + owning PID 귀속 판단, 실행 중 / 중지됨 / 예외 3가지 상태를 명확히 표시
- **포트 충돌 차단**: 점유 프로세스 이름과 PID 표시, 서비스가 시작되지 않았는데 포트가 이미 점유된 경우 시작 전 차단
- **포트 바로가기**: 포트 열은 클릭 가능한 링크로 시스템 기본 브라우저로 열림 (`webUrl`로 덮어쓰기 가능)
- **그룹 직렬 오케스트레이션**: 사용자가 수동으로 그룹 생성, 그룹 내 구성원은 위에서 아래로 직렬 시작, 중지는 역순, 그룹에 속하지 않은 서비스는 병렬 시작
- **드래그 앤 드롭 정렬**: 메인 패널의 유일한 순서 조정 방법, 그룹 카드 전체 드래그, 그룹 내 구성원은 그룹 내에서만 드래그 가능
- **템플릿 시스템**: 구성 요소당 하나의 JSON 템플릿, `presets/` 디렉토리에 배치하면 인식됨, 새 서비스 생성 시 한 번만 채워지며 후속 구성과 분리됨
- **로그 보기**: 명령어 stdout/stderr 캡처 + 지정된 로그 파일 tail, 개별 또는 동시 사용 가능, 로컬 로그 파일에 저장
- **이중 확인**: 일괄 시작 / 일괄 중지 / 서비스 삭제 모두 확인 필요, 팝업에 영향 범위 및 실행 순서 표시
- **다국어**: 9개 언어（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Español / Deutsch / Português）, 상단 바 전환 시 즉시 적용

## 애플리케이션 스크린샷

![애플리케이션 스크린샷 1](../assets/1.png)
![애플리케이션 스크린샷 2](../assets/2.png)

## 기술 스택

| 계층 | 기술 | 용도 |
|----|------|------|
| 메인 프로세스 | Electron (Node.js) | 프로세스 관리, 포트 프로빙, 구성 읽기/쓰기, 로그 tail |
| 렌더러 레이어 | React 18 + TypeScript | UI 및 상태 구독, Vite 빌드 |
| 패키징 | Electron-builder | MSI / NSIS / dmg / AppImage 배포 패키지 |
| 구성 | `services.yaml` | 서비스 정의, 그룹화, 순서, 설정 |
| 템플릿 | `presets/*.json` | 단일 구성 요소 템플릿, 6개 최상위 키 |

## 빠른 시작

### 요구사항

- Node.js ≥ 18（추천 20+）
- Git
- 관리하려는 미들웨어가 로컬에 설치되어 있어야 함（Redis / MySQL / PostgreSQL / Elasticsearch 등）

### 설치 및 실행

```bash
# 저장소 클론
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# 종속성 설치
npm install

# 개발 모드 실행（Vite + Electron）
npm run dev

# Web 디버깅만 실행（Electron 시작 안 함）
npm run dev:web
```

### 빌드 및 패키징

```bash
# 렌더러 레이어 빌드 + 메인 프로세스 컴파일
npm run build

# 빌드된 애플리케이션 시작
npm start

# 배포 디렉토리로 패키징
npm run pack

# 전체 설치 관리자 패키징（MSI / NSIS / dmg 등）
npm run dist
```

빌드 산출물은 `dist/` 또는 `release/`에 출력되며 최종 사용자에게 직접 배포 가능합니다.

### 데이터 및 구성 디렉토리（런타임）

첫 실행 후 구성 및 로그는 플랫폼 표준 위치에 배치되며 디렉토리 이름은 `devstack`입니다：

| 플랫폼 | 경로 |
|----------|------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

하위 디렉토리：

- `services.yaml` — 서비스 정의, 그룹화, 순서, 설정（수동 편집도 적용, 재시작 시 읽음）
- `presets/` — 사용자 정의 JSON 템플릿
- `scripts/` — 명령어 라이브러리 스크립트（.bat/.cmd/.ps1/.sh, 폴더별 구성）
- `logs/` — 서비스 로그 및 애플리케이션 런타임 로그

> 개발 중에는 환경 변수 `DEVSTACK_DATA_DIR`을 사용하여 데이터 디렉토리를 임의 위치에 격리할 수 있으며, 실행 중인 인스턴스와의 경합을 피할 수 있습니다.

## 프로젝트 구조（app/）

```
app/
├── .gitignore          # Git 무시（node_modules / dist-electron / .env 등）
├── .gitattributes      # 줄 끝 규칙（소스 코드는 LF로 통일）
├── LICENSE             # Apache-2.0
├── package.json        # 종속성 및 스크립트
├── package-lock.json
├── tsconfig.json       # 렌더러 TS 구성
├── tsconfig.electron.json  # 메인 프로세스 TS 구성
├── vite.config.ts      # Vite 구성
├── scripts/            # 보조 스크립트（시작, 검증, i18n 키 등록 등）
├── src/
│   ├── main/           # Electron 메인 프로세스（프로세스 관리, 포트 프로빙, 구성, 로그）
│   ├── renderer/       # React 렌더러 레이어（Vite）
│   └── shared/         # 공유 타입
└── test/               # 스모크, 템플릿, 경로, 상태 의미론 테스트 등
```

## 기본 제공 구성 요소 템플릿

패키지에는 9가지 기본 제공 구성 요소 템플릿이 포함되어 있습니다（직접 사용하거나 복사하여 수정 가능）：

| 템플릿 ID | 구성 요소 | 기본 포트 |
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

## 기여

본 프로젝트는 지속적으로 업데이트 중이며 기여를 환영합니다.

- 문제 피드백: [Issues](https://github.com/leo-z-z-z/devstack/issues)를 제출하고 재현 단계 및 환경 정보 설명
- 기능 제안: Issues에 새 구성 요소 템플릿, 새 플랫폼 지원, 상호 작용 최적화 제안
- 코드 기여: 저장소를 Fork하고 Pull Request 제출, 커밋 메시지는 관례적 커밋 형식 유지（예: `feat:` / `fix:` / `docs:`）

## 라이선스

본 프로젝트는 [Apache License 2.0](./LICENSE)에 따라 라이선스됩니다.
