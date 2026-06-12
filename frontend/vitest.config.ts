import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: [
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/styles.css',
        'src/components/Icon.tsx'
      ],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 65,
        lines: 65
      }
    },
    restoreMocks: true,
    clearMocks: true
  }
});
