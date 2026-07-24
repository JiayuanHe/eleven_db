# Eleven DB — Rust/Tauri 版本

基于 TypeScript/Electron 版本的 Rust/Tauri 重构，提供更快的性能和更小的二进制体积。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri 2.0 |
| 渲染层 | React 18 + TypeScript + Vite |
| 编辑器 | Monaco Editor（VS Code 同款内核） |
| 数据库驱动 | mysql_async（MySQL）+ redis-rs（Redis） |
| 密码加密 | Windows DPAPI / macOS Keychain |
| 元数据存储 | JSON 文件（`~/.local/share/eleven-db/eleven.json`） |

## 性能优势

- **启动时间**：Rust 二进制启动比 Node.js 快 2-3 倍
- **内存占用**：Rust 程序内存占用通常比 Electron 低 50-70%
- **二进制体积**：Tauri 打包后通常 < 10MB（对比 Electron 的 150MB+）
- **原生性能**：数据库操作直接在 Rust 中执行，无 JS 桥接开销

## 构建要求

- Rust 1.70+
- Node.js 18+
- Windows Build Tools（仅 Windows）

## 开发

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装前端依赖
npm install

# 开发模式（需要先运行 Rust 后端）
cargo run &        # 启动 Rust 后端
npm run dev:renderer  # 启动 Vite 开发服务器

# 或者使用 Tauri 开发模式
npm run tauri:dev
```

## 生产构建

```bash
# 构建前端和后端
npm run build

# 构建 Tauri 应用
npm run tauri:build
```

## 架构

```
src-tauri/
├── src/
│   ├── main.rs              # Tauri 入口
│   ├── lib.rs               # 库入口，初始化逻辑
│   ├── commands.rs          # Tauri IPC 命令
│   ├── types.rs             # 共享类型定义
│   ├── error.rs             # 错误类型
│   ├── crypto.rs            # 密码加密（DPAPI/Keychain）
│   ├── stores.rs            # JSON 持久化
│   ├── connection_manager.rs # 连接池管理
│   └── drivers/
│       ├── mod.rs
│       ├── mysql_driver.rs  # MySQL 驱动
│       └── redis_driver.rs  # Redis 驱动
```

## IPC 命令

### 连接管理
- `list_connections` - 列出所有连接
- `get_connection` - 获取连接详情
- `create_connection` - 创建新连接
- `update_connection` - 更新连接
- `remove_connection` - 删除连接
- `test_connection` - 测试连接
- `list_objects` - 列出数据库对象

### SQL 操作
- `execute_sql` - 执行 SQL
- `list_history` - 查询历史
- `clear_history` - 清除历史

### 表操作
- `get_table_schema` - 获取表结构
- `get_table_data` - 获取表数据
- `commit_table` - 提交更改
- `get_table_detail` - 获取表详情
- `alter_table` - 修改表结构

### Redis 操作
- `redis_list_databases` - 列出数据库
- `redis_list_keys` - 列出键
- `redis_describe_key` - 键信息
- `redis_get_value` - 获取值
- `redis_set_value` - 设置值
- `redis_expire` - 设置过期
- `redis_delete` - 删除键

## 与 Electron 版本的差异

| 特性 | Electron 版本 | Tauri 版本 |
|---|---|---|
| 启动速度 | ~2-3 秒 | ~0.5-1 秒 |
| 内存占用 | ~200MB+ | ~50-80MB |
| 二进制体积 | ~150MB | ~8MB |
| 密码存储 | safeStorage | DPAPI/Keychain |
| 配置位置 | %APPDATA% | ~/.local/share |

## 路线图

- [x] MySQL 连接与查询
- [x] Redis 连接与操作
- [x] 表结构浏览与编辑
- [x] CSV/SQL 导入导出
- [ ] 密码加密存储
- [ ] 连接分组
- [ ] 主题切换
- [ ] CLI 工具
