import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Request/verification tests do not need the UI test suite's DOM dependencies.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  test: {
    environment: 'node',
    include: [
      'src/functions/aiContentAgreementRequests.spec.js',
      'src/functions/verifyAiContentAgreementAcceptance.spec.js',
    ],
  },
});