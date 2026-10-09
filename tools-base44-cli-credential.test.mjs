import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { credentialKind, installCliCredential, main, SESSION_LIFETIME_MS } from './tools-base44-cli-credential.mjs';

const PAT = 'b44u_SYNTHETIC_TEST_ONLY_NOT_A_REAL_TOKEN';
const WORKSPACE = 'b44k_SYNTHETIC_TEST_ONLY_NOT_A_REAL_SECRET';

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'b44-cli-credential-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('only a workspace key or a personal access token is a publishing credential', () => {
  assert.equal(credentialKind(WORKSPACE), 'workspace_api_key');
  assert.equal(credentialKind(` ${PAT}\n`), 'personal_access_token');
  for (const value of [undefined, '', 'b44k_', 'b44u_', 'b44x_SYNTHETIC', 'sk-SYNTHETIC', 'eyJ.a.b', `${PAT}\nOTHER`]) {
    assert.equal(credentialKind(value), null, String(value));
  }
});

test('a workspace key is left to the CLI and writes no session file', () => withHome((home) => {
  assert.deepEqual(installCliCredential({ env: { BASE44_API_KEY: WORKSPACE }, home }),
    { ok: true, kind: 'workspace_api_key', session_written: false });
  assert.equal(existsSync(join(home, '.base44')), false);
}));

test('a personal access token becomes an owner-only CLI session that never refreshes early', () => withHome((home) => {
  const now = 1_700_000_000_000;
  const result = installCliCredential({ env: { BASE44_API_KEY: PAT }, home, now });
  assert.deepEqual(result, { ok: true, kind: 'personal_access_token', session_written: true });
  const file = join(home, '.base44', 'auth', 'auth.json');
  const session = JSON.parse(readFileSync(file, 'utf8'));
  // The CLI's AuthDataSchema: non-empty tokens, positive integer expiry, an
  // email and a name. The access token is what it sends as Bearer.
  assert.equal(session.accessToken, PAT);
  assert.ok(session.refreshToken.length > 0 && session.refreshToken !== PAT);
  assert.equal(session.expiresAt, now + SESSION_LIFETIME_MS);
  assert.ok(Number.isSafeInteger(session.expiresAt));
  assert.match(session.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  assert.ok(session.name.length > 0);
  assert.equal(statSync(file).mode & 0o777, 0o600);
}));

test('anything else is refused without writing, and nothing reveals the credential', () => withHome((home) => {
  for (const value of ['', 'sk-SYNTHETIC', 'b44x_SYNTHETIC']) {
    const lines = [];
    assert.equal(main({ env: { BASE44_API_KEY: value }, home, log: (line) => lines.push(line) }), 2);
    assert.equal(JSON.parse(lines[0]).code, 'BASE44_PUBLISH_KEY_REQUIRED');
  }
  assert.equal(existsSync(join(home, '.base44')), false);
  for (const value of [PAT, WORKSPACE]) {
    const lines = [];
    assert.equal(main({ env: { BASE44_API_KEY: value }, home, log: (line) => lines.push(line) }), 0);
    assert.equal(lines.join('').includes(value), false);
  }
}));
