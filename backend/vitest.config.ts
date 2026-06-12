import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: [
        'src/context.ts',
        'src/db.ts',
        'src/embeddings.ts',
        'src/llm.ts'
      ],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70
      }
    },
    restoreMocks: true,
    clearMocks: true
  }
});
