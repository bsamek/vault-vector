import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    alias: {
      '@vault-vector/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
