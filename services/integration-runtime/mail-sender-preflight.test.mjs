import test from 'node:test';
import assert from 'node:assert/strict';
import { runMailAcceptance } from './operator-mail-acceptance.mjs';
import { loadConfig } from './runtime.mjs';

const base = () => loadConfig({ SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
  INTEGRATIONS_HASH_KEY: '1'.repeat(64), INTEGRATIONS_ENCRYPTION_KEY: '2'.repeat(64), SENDGRID_API_KEY: 'synthetic',
  NOTIFICATION_FROM_EMAIL: 'sender@example.test', RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40) });

for (const fromEmail of ['', undefined, null, 'not-an-email', 'a'.repeat(321), 'sender@example.test\r\nBcc: other@example.test']) {
  test(`bad sender ${String(fromEmail).slice(0, 30)} creates no irreversible acceptance receipt`, async () => {
    let reads = 0, requests = 0;
    await assert.rejects(() => runMailAcceptance({ ...base(), fromEmail }, {
      authorization: 'explicit-mail-sandbox-v1',
      store: { reserve() { reads++; assert.fail('sender validation must precede the reservation'); } },
      fetcher() { requests++; assert.fail('no provider or state requests before sender validation'); },
    }), error => ['INVALID_TEXT', 'INVALID_EMAIL'].includes(error.code));
    assert.equal(reads, 0); assert.equal(requests, 0);
  });
}
