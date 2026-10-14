import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Unit tests for web helpers (pure logic; no browser needed). */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
