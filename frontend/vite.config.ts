import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/studio/',
  plugins: [
    react({
      babel: {
        plugins: [
          ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:6247',
      '/ws': {
        target: 'ws://localhost:6247',
        ws: true,
      },
    },
  },
});
