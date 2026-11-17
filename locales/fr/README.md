# devstack — Gestionnaire de services local multiplateforme

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
  Gestionnaire de services local multiplateforme（Windows / macOS / Linux）· Electron + React + TypeScript · Démarrage/arrêt unifié, vérification de l'état, consultation des logs
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
  <strong>Français</strong>
  ｜
  <a href="es/README.md">Español</a>
  ｜
  <a href="de/README.md">Deutsch</a>
  ｜
  <a href="pt/README.md">Português</a>
</p>

## À propos

devstack est un panneau de commande de bureau pour les middlewares et services locaux, prenant en charge le démarrage/arrêt des services, l'orchestration sérielle groupée, la détection d'état en temps réel et les alertes de conflit de port. Il convient aux environnements de développement locaux, vous permettant de démarrer/arrêter uniformément, de vérifier l'état et de consulter les logs de Redis, MySQL, PostgreSQL, Elasticsearch, Kibana, MinIO et autres services, en les démarrant à la demande.

Le logiciel ne télécharge, ne décompresse et n'installe aucun middleware ; tous les composants sont installés par l'utilisateur lui-même. Le logiciel lit uniquement le répertoire d'installation spécifié par l'utilisateur et émet des commandes de démarrage/arrêt. La configuration et les logs sont stockés localement uniquement, aucune donnée n'est uploadée sur le réseau.

## Fonctionnalités

- **Démarrage/arrêt unifié** : Démarrage / arrêt / redémarrage / ouvrir le répertoire d'installation en un clic, commandes et arguments personnalisables
- **Visibilité de l'état en temps réel** : Détection TCP de port pur + attribution du PID propriétaire, affichant clairement les trois états : en cours d'exécution / arrêté / exception
- **Interception de conflit de port** : Affiche le nom du processus occupant et le PID ; intercepte avant le démarrage si le service n'est pas démarré mais que le port est déjà occupé
- **Accès direct au port** : La colonne de port est un lien cliquable ouvert avec le navigateur système par défaut (surchargeable via `webUrl`)
- **Orchestration sérielle groupée** : L'utilisateur crée manuellement des groupes ; les membres d'un groupe démarrent en série de haut en bas, et s'arrêtent dans l'ordre inverse ; les services non groupés démarrent en parallèle
- **Tri par glisser-déposer** : Le panneau principal est la seule méthode de réorganisation ; faites glisser les cartes de groupe en entier, et les membres du groupe ne peuvent être glissés qu'à l'intérieur de leur groupe
- **Système de templates** : Un fichier JSON template par composant ; déposez-le dans le répertoire `presets/` pour qu'il soit reconnu ; remplissage unique lors de la création d'un nouveau service, découplé de la configuration ultérieure
- **Consultation des logs** : Capture du stdout/stderr des commandes plus le tail du fichier de log spécifié, utilisable séparément ou simultanément, persistant dans les fichiers de logs locaux
- **Confirmation en deux étapes** : Démarrage en masse / arrêt en masse / suppression de service nécessitent tous une confirmation, le popup indiquant la portée d'impact et l'ordre d'exécution
- **Internationalisation** : 9 langues（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Español / Deutsch / Português）, changement dans la barre supérieure prenant effet immédiatement

## Stack technique

| Couche | Technologie | But |
|--------|-------------|-----|
| Processus principal | Electron (Node.js) | Gestion des processus, détection de port, lecture/écriture de configuration, tail de log |
| Couche de rendu | React 18 + TypeScript | Interface et abonnement à l'état, build Vite |
| Empaquetage | Electron-builder | Paquets de distribution MSI / NSIS / dmg / AppImage |
| Configuration | `services.yaml` | Définition de service, regroupement, ordre, paramètres |
| Template | `presets/*.json` | Template mono-composant, 6 clés de premier niveau |

## Démarrage rapide

### Prérequis

- Node.js ≥ 18（recommandé 20+）
- Git
- Middleware installé localement que vous souhaitez gérer（Redis / MySQL / PostgreSQL / Elasticsearch, etc.）

### Installer et exécuter

```bash
# Cloner le dépôt
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# Installer les dépendances
npm install

# Démarrer le mode développement（Vite + Electron）
npm run dev

# Exécuter le débogage Web uniquement（sans Electron）
npm run dev:web
```

### Construire et empaqueter

```bash
# Construire la couche de rendu + compiler le processus principal
npm run build

# Lancer l'application construite
npm start

# Empaqueter vers le répertoire de distribution
npm run pack

# Emballage complet d'installateur（MSI / NSIS / dmg, etc.）
npm run dist
```

Les artefacts de build sont output dans `dist/` ou `release/`, prêts à être distribués aux utilisateurs finaux.

### Répertoire de données et de configuration（à l'exécution）

Après le premier lancement, la configuration et les logs sont placés à l'emplacement standard de la plateforme, le répertoire s'appelle `devstack`：

| Plateforme | Chemin |
|----------|--------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

Sous-répertoires :

- `services.yaml` — Définition de service, regroupement, ordre, paramètres（l'édition manuelle prend effet, lu au redémarrage）
- `presets/` — Templates JSON personnalisés de l'utilisateur
- `scripts/` — Scripts de la bibliothèque de commandes（.bat/.cmd/.ps1/.sh, organisés par dossier）
- `logs/` — Logs de service et logs de runtime de l'application

> Pendant le développement, vous pouvez utiliser la variable d'environnement `DEVSTACK_DATA_DIR` pour isoler le répertoire de données à n'importe quel emplacement, évitant la concurrence avec les instances en cours d'exécution.

## Structure du projet（app/）

```
app/
├── .gitignore          # Ignoré par Git（node_modules / dist-electron / .env, etc.）
├── .gitattributes      # Règles de fin de ligne（source uniformément LF）
├── LICENSE             # Apache-2.0
├── package.json        # Dépendances et scripts
├── package-lock.json
├── tsconfig.json       # Config TS de la couche de rendu
├── tsconfig.electron.json  # Config TS du processus principal
├── vite.config.ts      # Config Vite
├── scripts/            # Scripts auxiliaires（démarrage, vérification, enregistrement de clés i18n, etc.）
├── src/
│   ├── main/           # Processus principal Electron（gestion des processus, détection de port, configuration, logs）
│   ├── renderer/       # Couche de rendu React（Vite）
│   └── shared/         # Types partagés
└── test/               # Tests de fumée, de template, de chemin, de sémantique d'état, etc.
```

## Templates de composants intégrés

Le paquet inclut 9 templates de composants intégrés（utilisables directement ou à copier pour modifier）：

| ID du template | Composant | Port par défaut |
|----------------|-----------|-----------------|
| `redis` | Redis | 6379 |
| `mysql` | MySQL | 3306 |
| `postgresql` | PostgreSQL | 5432 |
| `elasticsearch` | Elasticsearch | 9200 |
| `logstash` | Logstash | 9600 |
| `kibana` | Kibana | 5601 |
| `rocketmq-nameserver` | RocketMQ NameServer | 9876 |
| `rocketmq-broker` | RocketMQ Broker | 10911 |
| `minio` | MinIO | 9000 |

## Contribuer

Ce projet est en développement continu ; les contributions sont les bienvenues.

- Retour d'incident : Veuillez soumettre des [Issues](https://github.com/leo-z-z-z/devstack/issues), en décrivant les étapes de reproduction et les informations d'environnement
- Suggestions de fonctionnalités : Bienvenue à proposer de nouveaux templates de composants, de nouveaux supports de plateforme ou des optimisations d'interaction dans les Issues
- Contribution de code : Forkez le dépôt et soumettez une Pull Request ; veuillez conserver les messages de commit au format commit conventionnel（par exemple `feat:` / `fix:` / `docs:`）

## Licence

Ce projet est sous licence [Apache License 2.0](./LICENSE).
