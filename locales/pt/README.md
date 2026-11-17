# devstack — Gerenciador de Serviços Local Multiplataforma

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
  Gerenciador de Serviços Local Multiplataforma（Windows / macOS / Linux）· Electron + React + TypeScript · Iniciar/parar unificado, verificar status, visualizar logs
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
  <a href="de/README.md">Deutsch</a>
  ｜
  <strong>Português</strong>
  ｜
</p>

## Sobre

devstack é um painel de comandos de desktop para middlewares e serviços locais, suportando início/parada de serviços, orquestração serial em grupo, detecção de estado em tempo real e alertas de conflito de porta. É adequado para ambientes de desenvolvimento local, permitindo iniciar/parar uniformemente, verificar o estado e visualizar logs de Redis, MySQL, PostgreSQL, Elasticsearch, Kibana, MinIO e outros serviços, iniciando-os sob demanda.

O software não baixa, descompacta nem instala nenhum middleware ; todos os componentes são instalados pelo próprio usuário. O software lê apenas o diretório de instalação especificado pelo usuário e emite comandos de início/parada. A configuração e os logs são armazenados apenas localmente, sem enviar dados para a rede.

## Funcionalidades

- **Início/parada unificado** : Início / parada / reiniciar / abrir diretório de instalação com um clique, com comandos e argumentos personalizáveis
- **Visibilidade do estado em tempo real** : Detecção pura de porta TCP + atribuição do PID proprietário, mostrando claramente os três estados : em execução / parado / exceção
- **Interceptação de conflito de porta** : Mostra o nome do processo ocupante e o PID ; intercepta antes do início se o serviço não estiver iniciado, mas a porta já estiver ocupada
- **Acesso direto à porta** : A coluna de porta é um link clicável aberto com o navegador do sistema padrão（sobrescrevível via `webUrl`）
- **Orquestração serial em grupo** : O usuário cria grupos manualmente ; membros dentro de um grupo iniciam em série de cima para baixo, e param em ordem reversa ; serviços não agrupados iniciam em paralelo
- **Ordenação por arrastar e soltar** : O painel principal é o único método de reordenação ; arraste os cartões de grupo como um todo, e membros do grupo só podem ser arrastados dentro de seu grupo
- **Sistema de templates** : Um arquivo JSON template por componente ; coloque no diretório `presets/` para ser reconhecido ; preenchimento único ao criar um novo serviço, desacoplado da configuração subsequente
- **Visualização de logs** : Captura do stdout/stderr do comando mais o tail do arquivo de log especificado, usável separadamente ou simultaneamente, persistindo em arquivos de log locais
- **Confirmação em duas etapas** : Início em massa / parada em massa / excluir serviço requerem confirmação, com o popup indicando o escopo de impacto e a ordem de execução
- **Internacionalização** : 9 idiomas（简体中文 / 繁體中文 / English / 日本語 / 한국어 / Français / Español / Deutsch / Português）, mudança na barra superior entra em vigor imediatamente

## Pilha de Tecnologia

| Camada | Tecnologia | Propósito |
|--------|------------|-----------|
| Processo principal | Electron (Node.js) | Gerenciamento de processos, detecção de porta, leitura/escrita de configuração, tail de log |
| Camada de renderização | React 18 + TypeScript | Interface e assinatura de estado, build Vite |
| Empacotamento | Electron-builder | Pacotes de distribuição MSI / NSIS / dmg / AppImage |
| Configuração | `services.yaml` | Definição de serviço, agrupamento, ordem, configurações |
| Template | `presets/*.json` | Template de componente único, 6 chaves de nível superior |

## Início Rápido

### Requisitos

- Node.js ≥ 18（recomendado 20+）
- Git
- Middleware instalado localmente que você deseja gerenciar（Redis / MySQL / PostgreSQL / Elasticsearch, etc.）

### Instalar e Executar

```bash
# Clonar o repositório
git clone https://github.com/leo-z-z-z/devstack.git
cd devstack/app

# Instalar dependências
npm install

# Iniciar modo de desenvolvimento（Vite + Electron）
npm run dev

# Executar depuração Web apenas（sem Electron）
npm run dev:web
```

### Construir e Empacotar

```bash
# Construir camada de renderização + compilar processo principal
npm run build

# Iniciar o aplicativo construído
npm start

# Empacotar para diretório de distribuição
npm run pack

# Empacotamento completo do instalador（MSI / NSIS / dmg, etc.）
npm run dist
```

Os artefatos de build são output para `dist/` ou `release/`, prontos para distribuição direta aos usuários finais.

### Diretório de Dados e Configuração（em tempo de execução）

Após a primeira execução, a configuração e os logs são colocados no local padrão da plataforma, o nome do diretório é `devstack`：

| Plataforma | Caminho |
|----------|---------|
| Windows | `%APPDATA%\devstack\` |
| macOS | `~/Library/Application Support/devstack/` |
| Linux | `~/.devstack/` |

Subdiretórios：

- `services.yaml` — Definição de serviço, agrupamento, ordem, configurações（edição manual também tem efeito, lido na reinicialização）
- `presets/` — Templates JSON personalizados do usuário
- `scripts/` — Scripts da biblioteca de comandos（.bat/.cmd/.ps1/.sh, organizados por pasta）
- `logs/` — Logs de serviço e logs de tempo de execução do aplicativo

> Durante o desenvolvimento, você pode usar a variável de ambiente `DEVSTACK_DATA_DIR` para isolar o diretório de dados em qualquer local, evitando concorrência com instâncias em execução.

## Estrutura do Projeto（app/）

```
app/
├── .gitignore          # Ignorado pelo Git（node_modules / dist-electron / .env, etc.）
├── .gitattributes      # Regras de fim de linha（fonte uniformemente LF）
├── LICENSE             # Apache-2.0
├── package.json        # Dependências e scripts
├── package-lock.json
├── tsconfig.json       # Configuração TS da camada de renderização
├── tsconfig.electron.json  # Configuração TS do processo principal
├── vite.config.ts      # Configuração Vite
├── scripts/            # Scripts auxiliares（início, verificação, registro de chaves i18n, etc.）
├── src/
│   ├── main/           # Processo principal Electron（gerenciamento de processos, detecção de porta, configuração, logs）
│   ├── renderer/       # Camada de renderização React（Vite）
│   └── shared/         # Tipos compartidos
└── test/               # Testes de fumaça, de template, de caminho, de semântica de estado, etc.
```

## Templates de Componentes Integrados

O pacote inclui 9 templates de componentes integrados（usáveis diretamente ou copiar para modificar）：

| ID do template | Componente | Porta padrão |
|----------------|------------|--------------|
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

Este projeto está em desenvolvimento contínuo ; contribuições são bem-vindas.

- Feedback de problemas : Por favor, envie [Issues](https://github.com/leo-z-z-z/devstack/issues), descrevendo as etapas de reprodução e informações do ambiente
- Sugestões de funcionalidades : Bem-vindo a propor novos templates de componentes, novo suporte de plataforma ou otimizações de interação em Issues
- Contribuição de código : Faça um Fork do repositório e envie um Pull Request ; por favor, mantenha as mensagens de commit no formato de commit convencional（por exemplo `feat:` / `fix:` / `docs:`）

## Licença

Este projeto está sob a licença [Apache License 2.0](./LICENSE).
