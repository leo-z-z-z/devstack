import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src/renderer') }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-electron/renderer'),
    emptyOutDir: true
  },
  // 默认 5173；自检 / 并行调试可用 DEVSTACK_VITE_PORT 换独立端口
  server: { port: Number(process.env.DEVSTACK_VITE_PORT || 5173), strictPort: true }
});
