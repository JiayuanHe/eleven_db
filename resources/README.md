# 图标资源

首次打包前请放入以下文件：

| 文件 | 规格 | 用途 |
| --- | --- | --- |
| `icon.ico` | 256x256 ICO（多分辨率） | NSIS 安装包 / 桌面快捷方式 / 应用窗口 |

如果暂时没有，`npm run dist:win` 仍能成功，electron-builder 会自动用 Electron 默认 icon。正式发布前替换。
