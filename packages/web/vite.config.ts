import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA 已禁用：cc-remote 通过 URL 参数（?server=&token=）加载，无需离线缓存
    // 且 SW 缓存会导致前端更新后用户看到旧版 UI
  ],
  server: {
    port: 5173,
    host: true,
  },
});
