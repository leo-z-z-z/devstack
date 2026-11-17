# devstack — 跨平台本地服务管理器

<p align="center">
  跨平台（Windows / macOS / Linux）本地服务管理器 · Electron + React + TypeScript · 统一起停、查状态、看日志
</p>

## 选择语言 / Choose a language

- [简体中文](./locales/zh-CN/README.md)
- [繁體中文](./locales/zh-TW/README.md)
- [English](./locales/en/README.md)
- [日本語](./locales/ja/README.md)
- [한국어](./locales/ko/README.md)
- [Français](./locales/fr/README.md)
- [Español](./locales/es/README.md)
- [Deutsch](./locales/de/README.md)
- [Português](./locales/pt/README.md)

---

devstack 是一个面向本地中间件与服务的桌面命令面板，支持服务启停、分组串行编排、实时状态探测与端口冲突告警。适合本地开发环境，把 Redis、MySQL、PostgreSQL、Elasticsearch、Kibana、MinIO 等组件统一起停、查状态、看日志，无需记一堆命令。

软件不下载、不解压、不安装任何中间件；所有组件由用户自行安装，软件仅读取用户指定的安装目录并下发启停命令。配置与日志仅落在本地，不联网上传任何数据。

> 各语言的完整文档请见 `locales/` 下对应的 README。
> ![应用截图1](./assets/1.png)
> ![应用截图2](./assets/2.png)
