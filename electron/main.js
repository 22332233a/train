import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// --- 核心修复开始 ---
// 在 ES Module 中，必须显式转换 URL 为文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- 核心修复结束 ---

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // 使用上面定义的 __dirname
      preload: path.join(__dirname, 'preload.js')
    },
  });

  // 智能判断开发/生产环境
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // 开发模式：加载 Vite 服务器
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // 生产模式：加载打包后的文件
    // 注意：打包后 dist 通常在 main.js 的上一级目录
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// 监听 App 就绪
app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});