# Eleven DB — 轻量跨平台数据库客户端

<div align="center">

![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)
![Rust](https://img.shields.io/badge/Rust-1.70+-orange.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
[![Build](https://github.com/JiayuanHe/eleven-db/actions/workflows/build-tauri.yml/badge.svg)](https://github.com/JiayuanHe/eleven-db/actions)

**高性能 · 跨平台 · 开源**

✨ 使用 Rust 重构，性能提升 3-5 倍 ✨

</div>

## 下载

### Linux 版本
| 文件 | 说明 |
|------|------|
| `release/eleven-db-0.1.0-linux-x64.tar.gz` | Linux x64 便携版 (106MB) |

### Windows 版本
| 类型 | 文件 | 说明 |
|------|------|------|
| 安装版 | `release/Eleven DB-0.1.0-x64.exe` | NSIS 安装向导 |
| 便携版 | `release/Eleven DB-0.1.0-portable.exe` | 绿色版，无需安装 |

> Windows 版本需要使用本机 Windows 环境构建，或通过 GitHub Actions 下载 artifacts。

## 简介

Eleven DB 是一款轻量级跨平台数据库客户端，支持 MySQL、Redis 等主流数据库。提供直观的图形界面，让数据库管理和查询变得简单高效。

## 技术特点

| 特性 | 说明 |
|------|------|
| ⚡ 高性能 | Rust 后端 + Tauri 框架，内存占用低、启动快 |
| 🎯 跨平台 | 支持 Windows、macOS、Linux |
| 🔒 安全 | 密码使用 OS 原生加密（DPAPI/Keychain）存储 |
| 💾 轻量 | 二进制体积仅 ~8MB（对比 Electron ~150MB） |
| 🎨 美观 | 现代 UI 设计，支持深色/浅色主题 |

## 功能

- ✅ MySQL 连接管理
- ✅ SQL 编辑器（Monaco Editor）
- ✅ 表结构浏览与编辑
- ✅ 数据分页查看与编辑
- ✅ CSV/SQL 导入导出
- ✅ Redis 连接与操作
- ✅ 查询历史记录
- 🔜 Oracle 支持（V0.5）
- 🔜 SSH 隧道（V1.0）

## 快速开始

### 环境要求

- **Rust 1.70+** ([安装指南](https://www.rust-lang.org/tools/install))
- **Node.js 18+**
- **前端依赖**: npm

### 安装

```bash
# 克隆项目
git clone https://github.com/JiayuanHe/eleven-db.git
cd eleven-db

# 安装前端依赖
npm install

# 安装 Rust 依赖
cd src-tauri && cargo fetch && cd ..
```

### 开发

```bash
# 开发模式（前端 + Rust 后端）
npm run tauri:dev

# 仅开发前端（Electron）
npm run dev

# 类型检查
npm run lint
```

### 构建

```bash
# 构建生产版本
npm run tauri:build

# 构建 Linux tarball
npm run build
npx electron-builder --linux dir --x64
```

## 项目结构

```
eleven-db/
├── src/                      # 前端源码
│   ├── renderer/             # React 渲染层
│   │   ├── views/            # 页面组件
│   │   ├── components/       # UI 组件
│   │   └── lib/              # 工具函数
│   ├── main/                 # Electron 主进程 (可选)
│   ├── preload/             # Electron 预加载脚本
│   └── shared/              # 共享类型
│
├── src-tauri/               # Rust/Tauri 后端
│   ├── src/
│   │   ├── main.rs          # 程序入口
│   │   ├── lib.rs           # 库入口
│   │   ├── commands.rs      # IPC 命令
│   │   ├── types.rs         # 类型定义
│   │   ├── error.rs         # 错误处理
│   │   ├── stores.rs        # 数据持久化
│   │   ├── crypto.rs        # 密码加密
│   │   ├── connection_manager.rs  # 连接管理
│   │   └── drivers/         # 数据库驱动
│   │       ├── mysql_driver.rs
│   │       └── redis_driver.rs
│   └── Cargo.toml           # Rust 依赖
│
├── release/                 # 发布版本
└── docs/                    # 文档
```

## Rust 版本 vs Electron 版本

| 指标 | Electron 版本 | Rust/Tauri 版本 |
|------|--------------|-----------------|
| 启动时间 | ~2-3 秒 | ~0.5 秒 |
| 内存占用 | ~200MB+ | ~50-80MB |
| 二进制体积 | ~150MB | ~8MB |
| 密码存储 | safeStorage | DPAPI/Keychain |
| 配置位置 | %APPDATA% | ~/.local/share |

**推荐使用 Rust/Tauri 版本** 以获得更好的性能和更小的体积。

## 技术栈

### 前端
- React 18
- TypeScript 5
- Vite 5
- Monaco Editor

### 后端 (Rust)
- Tauri 2.0
- mysql_async
- redis
- tokio

### 构建工具
- electron-builder (Electron 版本)
- cargo (Rust 版本)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v0.2.0 (2024-07-24)
- ✨ 初始 Rust/Tauri 版本发布
- ✨ 支持 MySQL 连接和查询
- ✨ 支持 Redis 连接和操作
- ⚡ 性能大幅提升

### v0.1.0 (2024-07-22)
- ✨ 初始版本发布

## 路线图

- [ ] V0.5: Oracle 支持
- [ ] V0.5: 完整的导入导出功能
- [ ] V1.0: SSH 隧道
- [ ] V1.0: 连接分组
- [ ] V1.0: 主题切换
- [ ] V2.0: PostgreSQL / SQL Server / MongoDB 支持

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

---

<div align="center">

Made with ❤️ by [JiayuanHe](https://github.com/JiayuanHe)

</div>
