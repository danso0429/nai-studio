import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // .env, .env.local 등을 프로젝트 루트(frontend의 부모)에서 로드
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const basePath = env.VITE_BASE_PATH || '/studio/';
  const devProxyPort = env.DEV_PROXY_PORT || '6247';

  return {
    base: basePath,
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
        '/api': `http://localhost:${devProxyPort}`,
        '/ws': {
          target: `ws://localhost:${devProxyPort}`,
          ws: true,
        },
      },
    },
  };
});
