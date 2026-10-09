import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OWNER_SUPER_ADMIN_EMAIL,
  ownerSuperAdminEmailFor,
  withOwnerSuperAdminEmail,
} from './scripts/owner-super-admin-email.mjs';

const PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';

function run({ env = {}, dotenv = null, command = 'build', mode = 'production' }) {
  const root = mkdtempSync(join(tmpdir(), 'owner-email-'));
  try {
    if (dotenv !== null) writeFileSync(join(root, '.env'), dotenv);
    const seen = [];
    withOwnerSuperAdminEmail((configEnv) => { seen.push(configEnv); return {}; }, { root, env })({ command, mode });
    assert.equal(seen.length, 1, 'the wrapped config function runs exactly once');
    return env.VITE_SUPER_ADMIN_EMAIL;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('owner app id in process.env supplies the owner email for a build', () => {
  assert.equal(run({ env: { VITE_BASE44_APP_ID: PRODUCTION_APP_ID } }), OWNER_SUPER_ADMIN_EMAIL);
});

test('owner app id delivered only through a .env file still supplies it', () => {
  // The defect: Base44 builders can deliver the app id through a .env file
  // that only Vite's loadEnv reads, and the old check read process.env alone.
  assert.equal(run({ dotenv: `VITE_BASE44_APP_ID=${PRODUCTION_APP_ID}\n` }), OWNER_SUPER_ADMIN_EMAIL);
});

test('the dev server (editor preview) is covered, not only builds', () => {
  assert.equal(
    run({ env: { VITE_BASE44_APP_ID: PRODUCTION_APP_ID }, command: 'serve', mode: 'development' }),
    OWNER_SUPER_ADMIN_EMAIL,
  );
});

test('an explicit or blank-but-set value is handled without overriding a real one', () => {
  assert.equal(
    run({ env: { VITE_BASE44_APP_ID: PRODUCTION_APP_ID, VITE_SUPER_ADMIN_EMAIL: 'someone@example.com' } }),
    'someone@example.com',
  );
  assert.equal(
    run({ env: { VITE_BASE44_APP_ID: PRODUCTION_APP_ID, VITE_SUPER_ADMIN_EMAIL: '' } }),
    OWNER_SUPER_ADMIN_EMAIL,
  );
  assert.equal(
    ownerSuperAdminEmailFor({
      processEnv: { VITE_BASE44_APP_ID: PRODUCTION_APP_ID },
      fileEnv: { VITE_SUPER_ADMIN_EMAIL: 'file@example.com' },
    }),
    null,
  );
});

test('any other app, or no app id at all, stays fail-closed', () => {
  assert.equal(run({ env: { VITE_BASE44_APP_ID: 'some-other-app' } }), undefined);
  assert.equal(run({ dotenv: 'VITE_BASE44_APP_ID=some-other-app\n' }), undefined);
  assert.equal(run({}), undefined);
});
