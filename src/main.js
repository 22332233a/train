// ✅ Vue 前端入口（浏览器用）
// 注意：Electron 主进程代码在 electron/main.js，别放这里！
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
