import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // 开发环境：/api 与 /uploads 代理到本地后端 8080
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 分包：pdfjs 与 antd 体积大，拆为独立 chunk
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          antd: ['antd', '@ant-design/icons'],
        },
      },
    },
  },
});
