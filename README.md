# Eleven DB — 轻量跨平台桌面端数据库客户端

V0.1 MVP：MySQL 连接 + SQL 编辑器 + 表数据浏览与编辑。

> 详细需求见 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)。

## 下载

**Windows 安装包（v0.1）：**

| 类型 | 文件 | 说明 |
|------|------|------|
| 安装版 | `release/Eleven DB-0.1.0-x64-setup.exe` | NSIS 安装向导，可选安装目录，创建桌面快捷方式 |
| 便携版 | `release/Eleven DB-0.1.0-x64-portable.exe` | 绿色版，无需安装，下载后直接运行 |

> **注意**：首次运行会触发 Windows SmartScreen 警告，点击"更多信息→仍要运行"即可。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 客户端框架 | Electron 32 |
| 渲染层 | React 18 + TypeScript + Vite 5 |
| 编辑器 | Monaco Editor（VS Code 同款内核） |
| 数据库驱动 | mysql2（MySQL） |
| 元数据存储 | **JSON 文件**（`<userData>/data/eleven.json`，存连接配置、执行历史等） |
| 密码 | Electron `safeStorage`（Windows = DPAPI，macOS = Keychain） |

可替换接口（V0.5 / V1.0 接 Oracle / Redis 时不用重构）：
- `ConnectionDriver` —— 不同数据库的实现
- `SecretStore` —— 密码存储（V0.1：safeStorage，可换 1Password / Keychain 等）
- `ConnectionStore` —— 连接配置持久化（V0.1：本地 SQLite）

## 开发

```bash
# 安装依赖（无需 native 模块编译，无需 Visual Studio）
npm install

# 开发模式（Vite + Electron 热更新）
npm run dev

# 类型检查
npm run lint

# 打包生产
npm run build && npm start

# 出安装包 / 绿色版
npm run dist:win      # NSIS .exe 安装包
npm run dist:portable # Portable 绿色版
```

> **依赖说明**：本项目故意只用纯 JS 依赖（无 `better-sqlite3` 等 native 模块），
> 在 Windows 上 `npm install` **不需要 Visual Studio Build Tools**。这降低了
> 安装门槛，代价是元数据用 JSON 文件存储（对 V0.1 数据量完全够用）。
> 真需要本地 SQL 时再换 `sql.js`（纯 WASM）或 Node 22+ 内置 `node:sqlite`。

## 目录结构

```
src/
  main/                 # Electron 主进程
    main.ts             # 应用入口
    ipc.ts              # IPC 路由
    drivers/            # ConnectionDriver 实现（仅 MysqlDriver）
    stores/             # ConnectionStore / SecretStore 实现
    db/                 # SQLite 元数据
  preload/              # contextBridge 暴露受限 API
  renderer/             # React 渲染层
    views/              # 顶层页面（连接管理 / 主工作区）
    components/         # 连接树 / 编辑器 / 结果表 / 状态栏
    lib/                # API 客户端、Monaco 封装
  shared/
    types.ts            # 主/渲染共享类型
    ipc.ts              # IPC 通道常量
```

## 路线图

- **V0.1（当前）** MySQL 连接 + SQL 编辑器 + 表浏览/编辑 + 导入导出 CSV
- **V0.5** Oracle（驱动内置打包）+ 完整导入导出
- **V1.0** Redis + SSH 隧道 + 连接分组 + 主题切换
- **V2.0** Postgres / SQL Server / MongoDB；连接共享

## 预留接口（V1 阶段做 / 不做 / 预留接口）

按需求文档第 8 节，V1 阶段统一**预留接口**：

| 事项 | V0.1 实现 | V1+ 计划 |
| --- | --- | --- |
| 多人协作 / 云同步 | `ConnectionStore` 接口；本地 SQLite 默认实现 | V2 增加云端实现 |
| i18n | 单一 `t(key)` 帮助函数；仅内置中文 key | V2 抽离到独立 locale 文件 |
| CLI 配套 | `bin/eleven-cli.ts` 入口（占位） | V1+ 真正实现 |
| 密码加密 | `safeStorage`（OS Keychain/DPAPI） | 抽象为 `SecretStore` 接口 |
