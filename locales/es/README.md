# devstack — Gestor de servicios local multiplataforma

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
  Gestor de servicios local multiplataforma（Windows / macOS / Linux）· Electron + React + TypeScript · Inicio/detención unificada, verificación de estado, visualización de registros
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
  <strong>Español</strong>
  ｜
  <a href="de/README.md">Deutsch</a>
  ｜
  <a href="pt/README.md">Português</a>
</p>

## Acerca de

devstack es un panel de comandos de escritorio para middlewares y servicios locales, que admite inicio/detención de servicios, orquestación serial grupal, detección de estado en tiempo real y alertas de conflicto de puerto. Es adecuado para entornos de desarrollo local, permitiendo iniciar/detener de forma uniforme, verificar el estado y ver los registros de Redis, MySQL, PostgreSQL, Elasticsearch, Kibana, MinIO y otros servicios, iniciándolos según sea necesario.

El software no descarga, descomprime ni instala ningún middleware ; todos los componentes los instala el propio usuario. El software solo lee el directorio de instalación especificado por el usuario y emite comandos de inicio/detención. La configuración y los registros se almacenan únicamente localmente, sin subir datos a la red.

## Características

- **Inicio/detención unificado** : Inicio / detención / reinicio / abrir directorio de instalación con un clic, con comandos y argumentos personalizables
- **Visibilidad del estado en tiempo real** : Detección pura de puerto TCP + atribución del PID propietario, mostrando claramente los tres estados : en ejecución / detenido / excepción
- **Intercepción de conflicto de puerto** : Muestra el nombre del proceso ocupante y el PID ; intercepta antes del inicio si el servicio no está iniciado pero el puerto ya está ocupado
- **Acceso directo al puerto** : La columna de puerto es un enlace clicable abierto con el navegador del sistema predeterminado（sobrescribible mediante `webUrl`）
- **Orquestación serial grupal** : El usuario crea grupos manualmente ; los miembros dentro de un grupo inician en serie de arriba a abajo, y se detienen en orden inverso ; los servicios no grupales inician en paralelo
- **Ordenamiento por arrastrar y soltar** : El panel principal es el único método de reordenamiento ; arrastra las tarjetas de grupo como un todo, y los miembros del grupo solo se pueden arrastrar dentro de su grupo
- **Sistema de plantillas** : Una plantilla JSON por componente ; colócala en el directorio `presets/` para que sea reconocida ; llenado único al crear un nuevo servicio, desacoplado de la configuración posterior
- **Visualización de registros** : Captura de stdout/stderr del comando más el tail del archivo de registro especificado, utilizable por separado o simultáneamente, persistente en archivos de registro locales
- **Confirmación en dos pasos** : Inicio masivo / detención masiva / eliminar servicio requieren confirmación, con el popup indicando el alcance del impacto y el orden de ejecución
- **Internacionalización** : 9 idiomas（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Español / Deutsch / Português）, el cambio en la barra superior entra en vigor inmediatamente

## Pila tecnológica

| Capa | Tecnología | Propósito |
|------|------------|-----------|
| Proceso principal | Electron (Node.js) | Gestión de procesos, detección de puerto, lectura/escritura de configuración, tail de registro |
| Capa de renderizado | React 18 + TypeScript | Interfaz de usuario y suscripción al estado, compilación Vite |
| Empaquetado | Electron-builder | Paquetes de distribución MSI / NSIS / dmg / AppImage |
| Configuración | `services.yaml` | Definición de servicio, agrupación, orden, ajustes |
| Plantilla | `presets/*.json` | Plantilla de un solo componente, 6 claves de nivel superior |

## Inicio rápido

### Requisitos

- Node.js ≥ 18（se recomienda 20+）
- Git
- Middleware instalado localmente que desees gestionar（Redis / MySQL / PostgreSQL / Elasticsearch, etc.）

### Instalar y ejecutar

```bash
# Clonar el repositorio
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# Instalar dependencias
npm install

# Iniciar modo desarrollo（Vite + Electron）
npm run dev

# Ejecutar depuración Web solo（sin Electron）
npm run dev:web
```

### Construir y empaquetar

```bash
# Construir capa de renderizado + compilar proceso principal
npm run build

# Iniciar la aplicación construida
npm start

# Empaquetar a directorio de distribución
npm run pack

# Empaquetado completo del instalador（MSI / NSIS / dmg, etc.）
npm run dist
```

Los artefactos de compilación se output a `dist/` o `release/`, listos para distribuir directamente a los usuarios finales.

### Directorio de datos y configuración（en tiempo de ejecución）

Después de la primera ejecución, la configuración y los registros se colocan en la ubicación estándar de la plataforma, el nombre del directorio es `devstack`：

| Plataforma | Ruta |
|----------|------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

Subdirectorios：

- `services.yaml` — Definición de servicio, agrupación, orden, ajustes（la edición manual también tiene efecto, se lee al reiniciar）
- `presets/` — Plantillas JSON personalizadas del usuario
- `scripts/` — Scripts de la biblioteca de comandos（.bat/.cmd/.ps1/.sh, organizados por carpeta）
- `logs/` — Registros de servicio y registros de ejecución de la aplicación

> Durante el desarrollo, puedes usar la variable de entorno `DEVSTACK_DATA_DIR` para aislar el directorio de datos en cualquier ubicación, evitando la contención con instancias en ejecución.

## Estructura del proyecto（app/）

```
app/
├── .gitignore          # Ignorado por Git（node_modules / dist-electron / .env, etc.）
├── .gitattributes      # Reglas de fin de línea（fuente uniformemente LF）
├── LICENSE             # Apache-2.0
├── package.json        # Dependencias y scripts
├── package-lock.json
├── tsconfig.json       # Configuración TS de la capa de renderizado
├── tsconfig.electron.json  # Configuración TS del proceso principal
├── vite.config.ts      # Configuración Vite
├── scripts/            # Scripts auxiliares（inicio, verificación, registro de claves i18n, etc.）
├── src/
│   ├── main/           # Proceso principal Electron（gestión de procesos, detección de puerto, configuración, registros）
│   ├── renderer/       # Capa de renderizado React（Vite）
│   └── shared/         # Tipos compartidos
└── test/               # Pruebas de humo, de plantilla, de ruta, de semántica de estado, etc.
```

## Plantillas de componentes integrados

El paquete incluye 9 plantillas de componentes integrados（utilizables directamente o copiar para modificar）：

| ID de plantilla | Componente | Puerto predeterminado |
|-----------------|------------|-----------------------|
| `redis` | Redis | 6379 |
| `mysql` | MySQL | 3306 |
| `postgresql` | PostgreSQL | 5432 |
| `elasticsearch` | Elasticsearch | 9200 |
| `logstash` | Logstash | 9600 |
| `kibana` | Kibana | 5601 |
| `rocketmq-nameserver` | RocketMQ NameServer | 9876 |
| `rocketmq-broker` | RocketMQ Broker | 10911 |
| `minio` | MinIO | 9000 |

## Contribuir

Este proyecto está en desarrollo continuo ; se aceptan contribuciones.

- Retroalimentación de problemas : Por favor, envía [Issues](https://github.com/leo-z-z-z/devstack/issues), describiendo los pasos de reproducción y la información del entorno
- Sugerencias de funciones : Bienvenido a proponer nuevas plantillas de componentes, nuevo soporte de plataforma u optimizaciones de interacción en Issues
- Contribución de código : Haz Fork del repositorio y envía una Pull Request ; por favor, mantén los mensajes de commit en formato de commit convencional（por ejemplo `feat:` / `fix:` / `docs:`）

## Licencia

Este proyecto está bajo la licencia [Apache License 2.0](./LICENSE).
