import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const guard = readFileSync(
  join(process.cwd(), 'base44/functions/enforceStaffRoleIntegrity/entry.ts'),
  'utf8',
);
const userManagement = readFileSync(
  join(process.cwd(), 'base44/functions/userManagement/entry.ts'),
  'utf8',
);
const directCreate = readFileSync(
  join(process.cwd(), 'base44/functions/createUserWithTempPassword/entry.ts'),
  'utf8',
);
const onUserSignup = readFileSync(
  join(process.cwd(), 'base44/functions/onUserSignup/entry.ts'),
  'utf8',
);
const autoApprove = readFileSync(
  join(process.cwd(), 'base44/functions/autoApproveInvitedUser/entry.ts'),
  'utf8',
);

test('staff role integrity guard uses invitations as authoritative copy', () => {
  assert.match(guard, /UserInvitation\.list\('-updated_date', READ_LIMIT\)/);
  assert.match(guard, /invitation\?\.status !== 'accepted'/);
  assert.match(guard, /User\.update\(row\.id,\s*\{\s*staff_role: authoritativeRole\s*\}\)/);
  assert.match(guard, /skipped_no_invitation/);
  assert.match(guard, /skipped_admin/);
});

test('admin staff_role changes update the authoritative invitation row', () => {
  assert.match(userManagement, /upsertAcceptedUserInvitationForUser/);
  assert.match(userManagement, /targetUser\?\.is_approved !== true/);
  assert.match(userManagement, /status:\s*'accepted'/);
  assert.match(userManagement, /normalizeEmail\(inv\.email \|\| inv\.invited_email\)/);
});

test('direct user creation leaves an actionable invitation for signup approval', () => {
  assert.match(directCreate, /UserInvitation\.create\(\{/);
  assert.match(directCreate, /status:\s*'pending'/);
  assert.doesNotMatch(directCreate, /accepted_at:\s*now\.toISOString\(\)/);
});

test('signup handlers consume pending invitations before marking them accepted', () => {
  for (const source of [onUserSignup, autoApprove]) {
    const pendingLookup = source.indexOf("status: 'pending'");
    const userUpdate = source.indexOf('entities.User.update');
    const acceptedUpdate = source.indexOf("status: 'accepted'", userUpdate);
    assert.ok(pendingLookup >= 0, 'handler must query pending invitations');
    assert.ok(userUpdate > pendingLookup, 'handler must apply the invitation to a user');
    assert.ok(acceptedUpdate > userUpdate, 'handler must accept only after applying user metadata');
  }
});
