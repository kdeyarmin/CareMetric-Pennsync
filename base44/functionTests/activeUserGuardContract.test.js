import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Contract: a NEW authenticated backend function must refuse deactivated users.
 *
 * Offboarding sets is_active:false but deliberately leaves role/account_type
 * intact, and the Base44 platform does not reject entity-API calls from a
 * deactivated session -- so an offboarded user holding a live session still
 * satisfies every ordinary auth check. Each function has to refuse them itself.
 *
 * This is a ratchet, not a clean bill of health. The functions below predate the
 * rule and are still unguarded; the list exists so that adding a new
 * authenticated function without the guard fails here instead of silently
 * widening the gap. Removing a name from this list (after adding the guard) is
 * always a safe change -- the test requires the list to stay accurate in both
 * directions, so stale entries fail too.
 *
 * To guard a function: inline the requireActiveUser shared helper and call
 *   if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
 * immediately after the auth check, then run `pnpm run sync:shared-helpers`.
 */

const FUNCTIONS_DIR = join(process.cwd(), 'base44/functions');

/** Authenticated functions that do not yet refuse a deactivated caller. */
const UNGUARDED_LEGACY_FUNCTIONS = new Set([
  // Empty: all authenticated functions now refuse deactivated callers.
  // Keep the Set (and the ratchet tests below) so new unguarded functions fail CI.
]);

function authenticatedFunctions() {
  const out = [];
  for (const entry of readdirSync(FUNCTIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let src;
    try {
      src = readFileSync(join(FUNCTIONS_DIR, entry.name, 'entry.ts'), 'utf8');
    } catch {
      continue;
    }
    if (!src.includes('auth.me()')) continue;
    out.push({ name: entry.name, guarded: src.includes('is_active === false') });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

test('a new authenticated function refuses deactivated users', () => {
  const missing = authenticatedFunctions()
    .filter((f) => !f.guarded && !UNGUARDED_LEGACY_FUNCTIONS.has(f.name))
    .map((f) => f.name);

  assert.deepEqual(
    missing,
    [],
    'These authenticated functions do not refuse a deactivated caller. An '
      + 'offboarded user with a live session can still call them. Inline the '
      + 'requireActiveUser shared helper and guard the auth check:\n  '
      + missing.join('\n  '),
  );
});

test('the legacy exemption list stays accurate as functions are guarded', () => {
  const guardedButListed = authenticatedFunctions()
    .filter((f) => f.guarded && UNGUARDED_LEGACY_FUNCTIONS.has(f.name))
    .map((f) => f.name);

  assert.deepEqual(
    guardedButListed,
    [],
    'These are now guarded and must be removed from UNGUARDED_LEGACY_FUNCTIONS '
      + 'so the list keeps showing the real remaining debt:\n  '
      + guardedButListed.join('\n  '),
  );
});

test('the exemption list does not name functions that no longer exist', () => {
  const known = new Set(authenticatedFunctions().map((f) => f.name));
  const stale = [...UNGUARDED_LEGACY_FUNCTIONS].filter((n) => !known.has(n)).sort();
  assert.deepEqual(stale, [], `Stale entries: ${stale.join(', ')}`);
});
