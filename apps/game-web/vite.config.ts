import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: ['lvh.me'], proxy: { '/api': 'http://127.0.0.1:3101', '/socket.io': { target: 'http://127.0.0.1:3101', ws: true } } },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
