import { defineConfig } from 'vitest/config';

// Unit tests only. The Playwright suite in e2e/ is run separately via `test:e2e`.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    environment: 'node',
  },
});
