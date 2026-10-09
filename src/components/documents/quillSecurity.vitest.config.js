import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Sanitizer-only tests do not need the React Testing Library setup.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/components/documents/templateRichText.spec.js', 'src/components/utils/security.spec.js'],
    maxWorkers: 2,
  },
});