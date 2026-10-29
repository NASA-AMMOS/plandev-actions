import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
    typecheck: {
      enabled: true,
      include: ['src/**/*.test.ts', 'src/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
});
