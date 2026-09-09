// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

// 暴露一个简单的 API 用于测试
contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }
});