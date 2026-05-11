import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/stubs/obsidian.ts'),
    },
    include: ['tests/**/*.test.ts'],
  },
});
