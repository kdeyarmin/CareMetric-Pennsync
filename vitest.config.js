import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Component / integration test runner (React Testing Library + jsdom).
//
// This is intentionally SEPARATE from the existing pure-logic unit tests, which
// run under `node --test` against `*.test.js` files (see package.json
// `test:utils`). Vitest here only picks up `*.test.jsx` and `*.spec.*` files so
// the two runners never collide. `npm test` runs both.
//
// We use esbuild's automatic JSX runtime (not @vitejs/plugin-react, which exists
// for HMR/Fast Refresh that tests don't need) so JSX compiles to react/jsx-runtime
// calls without each file having to import React.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.jsx', 'src/**/*.spec.{js,jsx}'],
    // Keep the node:test util suites (and backend) out of Vitest's scope.
    exclude: ['node_modules', 'dist', 'base44'],
    // Defaults are 5000ms. Under the full parallel run (many jsdom files at once)
    // a single heavy mount/hook can momentarily exceed 5s on a busy CI box; raise
    // the ceiling so contention doesn't abort a test mid-async. Parallelism /
    // isolation are left at Vitest's defaults (per-file isolation is already
    // correct) so the suite stays fast.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
