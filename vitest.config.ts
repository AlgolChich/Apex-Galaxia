import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Tests import workspace packages by name; the aliases point at the TypeScript
// sources so `pnpm test` works from a clean clone without a build step.
export default defineConfig({
  resolve: {
    alias: {
      '@apex-galaxia/core': here('./packages/core/src/index.ts'),
      '@apex-galaxia/adapters': here('./packages/adapters/src/index.ts'),
    },
  },
  test: {
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'packages',
          include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      'apps/desktop/vitest.config.ts',
    ],
  },
});
