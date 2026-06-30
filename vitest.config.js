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
    // a single heavy mount/hook can momentarily exceed the budget on a busy CI box
    // (a 2–4 core runner saturated by 35 jsdom files), aborting a test mid-async.
    // Raise the ceiling generously so contention can't; this must comfortably
    // exceed the asyncUtilTimeout in src/test/setup.js times the number of
    // sequential waitFor calls in a single test (currently 2 × 10s). Parallelism /
    // isolation are left at Vitest's defaults (per-file isolation is already
    // correct) so the suite stays fast. A longer ceiling only delays — it can't
    // mask a never-true assertion.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
