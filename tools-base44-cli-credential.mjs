// Hands the configured persistent Base44 credential to the Base44 CLI.
//
// The CLI reads BASE44_API_KEY itself only when it is a workspace API key
// (`b44k_`), which it sends as an `api_key` header. Any other request it signs
// as `Authorization: Bearer <accessToken>` from its session file,
// ~/.base44/auth/auth.json. A Base44 personal access token (`b44u_`) is sent
// exactly that way, and on 2026-10-09 Base44 answered 200 to a read of the
// production app with one as Bearer and 401 with it as `api_key`. So for a
// personal access token this writes that session file, owner-only, with the
// token as the access token and an expiry a few hours out so the CLI never
// tries to refresh it (a 401 makes the CLI attempt a refresh with the
// placeholder below, which fails, so a refused token stays a loud failure).
//
// It prints nothing about the credential and never logs in. A workspace key
// needs no file, and anything else is refused, as the preflight already did.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SESSION_LIFETIME_MS = 6 * 60 * 60 * 1000;
const NOT_REFRESHABLE = 'personal-access-token-is-not-refreshable';

export function credentialKind(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || /\s/.test(key)) return null;
  if (/^b44k_.+/.test(key)) return 'workspace_api_key';
  if (/^b44u_.+/.test(key)) return 'personal_access_token';
  return null;
}

export function sessionFor(token, now = Date.now()) {
  return {
    accessToken: token,
    refreshToken: NOT_REFRESHABLE,
    expiresAt: now + SESSION_LIFETIME_MS,
    email: 'github-actions@users.noreply.github.com',
    name: 'GitHub Actions',
  };
}

export function installCliCredential({ env = process.env, home = homedir(), now = Date.now() } = {}) {
  const key = typeof env.BASE44_API_KEY === 'string' ? env.BASE44_API_KEY.trim() : '';
  const kind = credentialKind(key);
  if (kind === 'workspace_api_key') return { ok: true, kind, session_written: false };
  if (kind !== 'personal_access_token') return { ok: false, code: 'BASE44_PUBLISH_KEY_REQUIRED' };
  const dir = join(home, '.base44', 'auth');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'auth.json');
  writeFileSync(file, `${JSON.stringify(sessionFor(key, now))}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { ok: true, kind, session_written: true };
}

export function main({ env = process.env, home = homedir(), log = console.log } = {}) {
  const result = installCliCredential({ env, home });
  log(JSON.stringify(result));
  return result.ok ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
