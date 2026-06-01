import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: resolve(__dirname, '../backend/public'),
    emptyOutDir: true
  }
});
