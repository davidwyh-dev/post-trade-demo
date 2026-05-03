import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    pool: 'forks',
    isolate: false,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
