import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/config.js': 'http://localhost:3000'
    }
  },
  build: {
    outDir: resolve(__dirname, '../backend/public'),
    emptyOutDir: true
  }
});
