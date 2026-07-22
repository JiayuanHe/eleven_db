# 打包 Windows 安装包 / 绿色版

工具：`electron-builder` 25。V0.1 仅打 Windows x64，macOS / Linux 在 V0.5+ 加入。

## 一次性准备

```bash
cd D:\workspaces\xlc-coding\eleven_db
npm install                     # 含 electron-builder
```

`package.json` 里已经配好：

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| `appId` | `com.eleven.db` | Windows 注册表用的唯一标识 |
| `productName` | `Eleven DB` | 安装包 / 桌面快捷方式显示名 |
| `directories.output` | `release` | 产物输出目录 |
| `asar` | `true` | 主进程代码打 asar 包，启动稍快 |
| `asarUnpack` | `[]` | 无 native 模块需要解包 |

## 三种产物

### 1. NSIS 安装包（推荐给最终用户）

```bash
npm run dist:win
```

产出：`release/Eleven DB-0.1.0-x64.exe`

特性：
- 自定义安装路径（默认 `C:\Program Files\Eleven DB`，可改）
- 自动建桌面 + 开始菜单快捷方式
- 注册卸载入口到"应用和功能"
- 包体约 150–180 MB

### 2. Portable 绿色版（推荐给运维）

```bash
npm run dist:portable
```

产出：`release/Eleven DB-0.1.0-portable.exe`（实质是自解压 zip）

特性：
- 双击直接运行，不写注册表
- 适合放到 U 盘 / 临时排查机
- 连接配置存在 `userData`（与系统用户绑定），卸载即清

### 3. 同时打两种

```bash
npm run dist:all
```

## 只打不装（自测用）

```bash
npm run pack
```

产出：`release/win-unpacked/Eleven DB.exe`，体积最大、启动最快，省去 NSIS 自解压步骤，适合开发自测。

## 图标

`resources/icon.ico` 缺失时，electron-builder 会用默认占位 icon（不会失败）。要正式发布请自行准备一张 256x256 的 .ico 放到 `resources/icon.ico`。

## 常见问题

**Q: 启动后报 "Cannot find module 'better-sqlite3'"？**
A: 你是从旧版本升级的吧。本项目 V0.1 起已**不依赖 better-sqlite3**，用 JSON 文件存储。
若确实出现，检查 `node_modules` 残留，执行 `rm -rf node_modules package-lock.json && npm install`。

**Q: 安装包太大了能瘦身吗？**
A: V0.5+ 可以把 `electron` 换成 `@electron/asar` + `electron-updater`，或迁移到 Tauri（包体可降到 8MB）。MVP 阶段不需要。

**Q: 想加自动更新？**
A: 用 `electron-updater` + `app-update.yml`，推到 GitHub Releases 即可。V1.0 阶段再接。

**Q: 打包过程报错 "Cannot find module 'electron'"？**
A: `npm install` 没装全。重跑 `npm install` 即可。
