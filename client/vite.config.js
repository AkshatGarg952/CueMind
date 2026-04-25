import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: path.resolve(currentDirectory, '..'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(currentDirectory, '../shared'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
    fs: {
      allow: [path.resolve(currentDirectory, '..')],
    },
  },
});
