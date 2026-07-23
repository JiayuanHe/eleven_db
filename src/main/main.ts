import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { connectionManager } from './connection-manager';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: '11 — Eleven DB',
    backgroundColor: '#1f2128',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 里需要用 Node API
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外链走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173/');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
    );
  }
}

app.whenReady().then(async () => {
  // 隐藏默认菜单栏（File / Edit / View / Window / Help）—— 全部功能 UI 自带
  Menu.setApplicationMenu(null);

  registerIpc();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', async () => {
  await connectionManager.closeAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});