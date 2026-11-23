import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

let tauriVersion = 'dev';
try {
  const tauriConf = JSON.parse(readFileSync(path.resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf-8'));
  tauriVersion = tauriConf.version || '2.0.0';
} catch {}

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || (command === 'build' ? tauriVersion : 'dev')),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5188,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/spring-api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/spring-api/, '/api'),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'antd-core': ['antd'],
          'antd-icons': ['@ant-design/icons'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
}));

