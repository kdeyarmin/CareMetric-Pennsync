import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * offboardUser is a self-contained Deno entry, so there is no unit harness that
 * can call reactivateUser() directly. These are source-level contract tests:
 * they pin the two guards that make offboarding actually hold, so a future edit
 * that removes one fails here instead of silently reopening the hole.
 *
 * Both guards exist because offboarding clears is_active but deliberately keeps
 * role/account_type — so an offboarded administrator still looks like an admin
 * to this function, and the platform does not yet reject inactive sessions.
 */

const SRC = readFileSync(
  join(process.cwd(), 'base44/functions/offboardUser/entry.ts'),
  'utf8',
);

test('the caller must still be an active account', () => {
  assert.match(
    SRC,
    /currentUser\.is_active === false/,
    'offboardUser must reject a deactivated caller; without this an offboarded '
      + 'admin keeps a working session and can drive this function.',
  );
});

test('reactivate has no self-exemption', () => {
  const guard = SRC.slice(SRC.indexOf('async function reactivateUser'));
  assert.match(
    guard,
    /if \(targetIsPrivileged && !callerIsSuperAdmin\) \{/,
    'Only a super admin may reactivate a privileged account.',
  );
  assert.doesNotMatch(
    guard,
    /targetUser\.email !== currentUser\.email/,
    'Exempting self-targeting lets an offboarded admin reactivate their own '
      + 'account, undoing the offboarding.',
  );
});

test('offboard still refuses self-targeting', () => {
  assert.match(
    SRC,
    /You cannot offboard your own account/,
    'Self-offboard must stay blocked.',
  );
});

test('a partial revocation sweep is reported, not hidden', () => {
  // These counts land in the UserActivity audit record, where they read as
  // proof that PHI access was withdrawn.
  assert.match(SRC, /failures: 0/, 'results must track failed revocation writes');
  assert.match(SRC, /sweep_truncated/, 'results must flag a truncated patient sweep');
  assert.match(
    SRC,
    /complete: clean/,
    'the response must distinguish a clean sweep from a partial one',
  );
});

test('the patient sweep filters server-side instead of scanning every patient', () => {
  assert.match(
    SRC,
    /Patient\.filter\(\s*\{\s*assigned_nurses:/,
    'Listing all patients and filtering in-process silently misses assignments '
      + 'past the row ceiling, leaving live PHI access behind.',
  );
});
