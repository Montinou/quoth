import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', '.claude-flow', 'src/lib/quoth/__tests__/**'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/db/migrations/**'],
      reporter: ['text', 'text-summary'],
    },
    testTimeout: 10000,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
