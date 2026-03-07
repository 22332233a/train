import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  // 【关键修改】设置为 './'，这样打包后别人双击 index.html 也能正常加载资源
  base: '/train/',
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  // 【可选优化】构建配置
  build: {
    outDir: 'dist', // 输出目录保持默认
    sourcemap: false, // 关闭源码映射，减小文件体积，防止源码泄露
  }
})