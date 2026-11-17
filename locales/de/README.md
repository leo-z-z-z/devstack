# devstack — Lokaler Dienst-Manager (plattformübergreifend)

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
  Lokaler Dienst-Manager plattformübergreifend（Windows / macOS / Linux）· Electron + React + TypeScript · Einheitlicher Start/Stopp, Statusprüfung, Protokollanzeige
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
  <a href="ko/README.md">한국어</a>
  ｜
  <a href="fr/README.md">Français</a>
  ｜
  <a href="es/README.md">Español</a>
  ｜
  <strong>Deutsch</strong>
  ｜
  <a href="pt/README.md">Português</a>
</p>

## Über

devstack ist ein Desktop-Befehlspanel für lokale Middleware und Dienste, das Dienststart/-stopp, gruppierte serielle Orchestrierung, Echtzeit-Statuserkennung und Portkonfliktwarnungen unterstützt. Es eignet sich für lokale Entwicklungsumgebungen, um Redis, MySQL, PostgreSQL, Elasticsearch, Kibana, MinIO und andere Dienste einheitlich zu starten/stoppen, den Status zu prüfen und Protokolle anzuzeigen, wobei sie bei Bedarf gestartet werden können.

Die Software lädt keine Middleware herunter, entpackt oder installiert sie nicht ; alle Komponenten werden vom Benutzer selbst installiert. Die Software liest nur das vom Benutzer angegebene Installationsverzeichnis und gibt Start-/Stoppbefehle aus. Konfiguration und Protokolle werden nur lokal gespeichert, es werden keine Daten ins Netzwerk hochgeladen.

## Funktionen

- **Einheitlicher Start/Stopp** : Ein-Klick-Start / -Stopp / -Neustart / Installationsverzeichnis öffnen, mit anpassbaren Befehlen und Argumenten
- **Echtzeit-Sichtbarkeit des Status** : Reine TCP-Port-Abfrage + owning PID-Zuordnung, zeigt klar die drei Zustände : laufend / gestoppt / Ausnahme
- **Portkonflikt-Abfangung** : Zeigt den belegenden Prozessnamen und die PID an ; fängt vor dem Start ab, wenn der Dienst nicht gestartet ist, aber der Port bereits belegt ist
- **Direkter Portzugriff** : Die Spalte Port ist ein anklickbarer Link, der mit dem Standardbrowser des Systems geöffnet wird（überschreibbar über `webUrl`）
- **Gruppierte serielle Orchestrierung** : Der Benutzer erstellt manuell Gruppen ; Mitglieder innerhalb einer Gruppe starten seriell von oben nach unten und stoppen in umgekehrter Reihenfolge ; nicht gruppierte Dienste starten parallel
- **Drag-and-Drop-Sortierung** : Das Hauptpanel ist die einzige Sortiermethode ; Gruppenkarten als Ganzes ziehen, Gruppenmitglieder können nur innerhalb ihrer Gruppe gezogen werden
- **Templatesystem** : Eine JSON-Datei pro Komponente ; in das Verzeichnis `presets/` legen, um erkannt zu werden ; einmaliges Ausfüllen beim Erstellen eines neuen Dienstes, entkoppelt von der anschließenden Konfiguration
- **Protokollanzeige** : Erfasst Befehlsstdout/stderr plus den Tail der angegebenen Protokolldatei, separat oder gleichzeitig nutzbar, gespeichert in lokalen Protokolldateien
- **Zwei-Stufen-Bestätigung** : Massenstart / Massenstopp / Dienst löschen erfordern alle eine Bestätigung, das Popup gibt den Auswirkungensumfang und die Ausführungsreihenfolge an
- **Internationalisierung** : 9 Sprachen（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Español / Deutsch / Português）, Umschalten in der oberen Leiste tritt sofort in Kraft

## Anwendungs-Screenshots

![Anwendungs-Screenshot 1](../assets/1.png)
![Anwendungs-Screenshot 2](../assets/2.png)

## Tech-Stack

| Schicht | Technologie | Zweck |
|---------|-------------|-------|
| Hauptprozess | Electron (Node.js) | Prozessverwaltung, Port-Abfrage, Konfiguration lesen/schreiben, Protokoll-End |
| Renderer-Ebene | React 18 + TypeScript | UI und Status-Abonnement, Vite-Build |
| Verpackung | Electron-builder | MSI / NSIS / dmg / AppImage-Verteilungspakete |
| Konfiguration | `services.yaml` | Dienstdefinition, Gruppierung, Reihenfolge, Einstellungen |
| Template | `presets/*.json` | Einzelkomponenten-Template, 6 Top-Level-Schlüssel |

## Schnellstart

### Anforderungen

- Node.js ≥ 18（empfohlen 20+）
- Git
- Lokale installierte Middleware, die Sie verwalten möchten（Redis / MySQL / PostgreSQL / Elasticsearch usw.）

### Installieren & Ausführen

```bash
# Repository klonen
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# Abhängigkeiten installieren
npm install

# Entwicklungsmodus starten（Vite + Electron）
npm run dev

# Nur Web-Debugging ausführen（ohne Electron）
npm run dev:web
```

### Erstellen & Verpacken

```bash
# Renderer-Ebene erstellen + Hauptprozess kompilieren
npm run build

# Erstelle Anwendung starten
npm start

# Zum Verteilungsverzeichnis verpacken
npm run pack

# Vollständiges Verpackungsprogramm（MSI / NSIS / dmg usw.）
npm run dist
```

Build-Artefakte werden in `dist/` oder `release/` ausgegeben, bereit für die direkte Verteilung an Endbenutzer.

### Daten- und Konfigurationsverzeichnis（zur Laufzeit）

Nach dem ersten Start werden Konfiguration und Protokolle an dem plattformstandardmäßigen Ort abgelegt, der Verzeichnisname ist `devstack`：

| Plattform | Pfad |
|----------|------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

Unterverzeichnisse：

- `services.yaml` — Dienstdefinition, Gruppierung, Reihenfolge, Einstellungen（manuelle Bearbeitung ebenfalls wirksam, wird bei Neustart gelesen）
- `presets/` — Benutzerdefinierte JSON-Templates
- `scripts/` — Befehlsbibliothek-Skripte（.bat/.cmd/.ps1/.sh, nach Ordner organisiert）
- `logs/` — Dienstprotokolle und Anwendungslaufzeitprotokolle

> Während der Entwicklung können Sie die Umgebungsvariable `DEVSTACK_DATA_DIR` verwenden, um das Datenverzeichnis an einen beliebigen Ort zu isolieren, um Konflikte mit laufenden Instanzen zu vermeiden.

## Projektstruktur（app/）

```
app/
├── .gitignore          # Git ignoriert（node_modules / dist-electron / .env usw.）
├── .gitattributes      # Zeilenendungsregeln（Quelle einheitlich LF）
├── LICENSE             # Apache-2.0
├── package.json        # Abhängigkeiten und Skripte
├── package-lock.json
├── tsconfig.json       # Renderer-TS-Konfiguration
├── tsconfig.electron.json  # Hauptprozess-TS-Konfiguration
├── vite.config.ts      # Vite-Konfiguration
├── scripts/            # Hilfsskripte（Start, Überprüfung, i18n-Schlüssel-Registrierung usw.）
├── src/
│   ├── main/           # Electron-Hauptprozess（Prozessverwaltung, Port-Abfrage, Konfiguration, Protokolle）
│   ├── renderer/       # React-Renderer-Ebene（Vite）
│   └── shared/         # Gemeinsame Typen
└── test/               # Smoke-, Template-, Pfad-, Statussemantik-Tests usw.
```

## Integrierte Komponenten-Templates

Das Paket enthält 9 integrierte Komponenten-Templates（direkt verwendbar oder zum Kopieren und Ändern）：

| Template-ID | Komponente | Standardport |
|-------------|------------|--------------|
| `redis` | Redis | 6379 |
| `mysql` | MySQL | 3306 |
| `postgresql` | PostgreSQL | 5432 |
| `elasticsearch` | Elasticsearch | 9200 |
| `logstash` | Logstash | 9600 |
| `kibana` | Kibana | 5601 |
| `rocketmq-nameserver` | RocketMQ NameServer | 9876 |
| `rocketmq-broker` | RocketMQ Broker | 10911 |
| `minio` | MinIO | 9000 |

## Mitwirken

Dieses Projekt wird kontinuierlich weiterentwickelt ; Mitwirkung ist willkommen.

- Fehlerfeedback : Bitte reichen Sie [Issues](https://github.com/leo-z-z-z/devstack/issues) ein, beschreiben Sie Reproduktionsschritte und Umgebungsinformationen
- Funktionsvorschläge : Willkommen, neue Komponenten-Templates, neue Plattformunterstützung oder Interaktionsoptimierungen in Issues vorzuschlagen
- Code-Mitwirkung : Repository forken und Pull Request einreichen ; bitte Commit-Nachrichten im Conventional-Commits-Format halten（z. B. `feat:` / `fix:` / `docs:`）

## Lizenz

Dieses Projekt ist unter der [Apache License 2.0](./LICENSE) lizenziert.
