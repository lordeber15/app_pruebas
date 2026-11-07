import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    // PostGIS corre emulado (amd64) en Mac con Apple Silicon: el arranque puede tardar.
    hookTimeout: 240_000,
    testTimeout: 30_000,
  },
});
