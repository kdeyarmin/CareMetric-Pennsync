import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const SOURCE = readFileSync(
  join(process.cwd(), 'base44/functions/awardBadgeOnCompletion/entry.ts'),
  'utf8',
);

function loadAuthorizationHelpers() {
  const start = SOURCE.indexOf('const normalizeEmail');
  const end = SOURCE.indexOf('Deno.serve', start);
  assert.ok(start >= 0 && end > start, 'authorization helpers must be testable before the handler');
  const helperSource = SOURCE.slice(start, end);
  return Function(`${helperSource}\nreturn { isProtectedSuperAdmin, canProcessAttemptBadges };`)();
}

test('an authenticated learner can process only their own attempt', () => {
  const { canProcessAttemptBadges } = loadAuthorizationHelpers();
  const caller = { email: ' Nurse@Example.com ', role: 'user', agency_name: 'Agency A' };

  assert.equal(canProcessAttemptBadges({
    caller,
    ownerEmail: 'nurse@example.com',
    ownerUser: caller,
    configuredSuperAdminEmail: 'owner@example.com',
  }), true);
  assert.equal(canProcessAttemptBadges({
    caller,
    ownerEmail: 'other@example.com',
    ownerUser: { email: 'other@example.com', agency_name: 'Agency A' },
    configuredSuperAdminEmail: 'owner@example.com',
  }), false);
});

test('mutable account_type cannot grant badge-processing privilege', () => {
  const { canProcessAttemptBadges } = loadAuthorizationHelpers();
  const spoofed = {
    email: 'attacker@example.com',
    role: 'user',
    account_type: 'super_admin',
    agency_name: 'Agency A',
  };

  assert.equal(canProcessAttemptBadges({
    caller: spoofed,
    ownerEmail: 'victim@example.com',
    ownerUser: { email: 'victim@example.com', agency_name: 'Agency A' },
    configuredSuperAdminEmail: 'attacker@example.com',
  }), false);
});

test('protected admins are limited to owners in their own non-empty agency', () => {
  const { canProcessAttemptBadges } = loadAuthorizationHelpers();
  const admin = { email: 'admin@example.com', role: 'admin', agency_name: ' Agency A ' };

  assert.equal(canProcessAttemptBadges({
    caller: admin,
    ownerEmail: 'staff@example.com',
    ownerUser: { email: 'staff@example.com', agency_name: 'agency a' },
    configuredSuperAdminEmail: 'owner@example.com',
  }), true);
  assert.equal(canProcessAttemptBadges({
    caller: admin,
    ownerEmail: 'outsider@example.com',
    ownerUser: { email: 'outsider@example.com', agency_name: 'Agency B' },
    configuredSuperAdminEmail: 'owner@example.com',
  }), false);
  assert.equal(canProcessAttemptBadges({
    caller: { ...admin, agency_name: '' },
    ownerEmail: 'staff@example.com',
    ownerUser: { email: 'staff@example.com', agency_name: 'Agency A' },
    configuredSuperAdminEmail: 'owner@example.com',
  }), false);
  assert.equal(canProcessAttemptBadges({
    caller: admin,
    ownerEmail: 'missing@example.com',
    ownerUser: null,
    configuredSuperAdminEmail: 'owner@example.com',
  }), false);
});

test('cross-agency override requires protected admin role and configured email', () => {
  const { isProtectedSuperAdmin, canProcessAttemptBadges } = loadAuthorizationHelpers();
  const owner = { email: ' Owner@Example.com ', role: 'admin', agency_name: '' };

  assert.equal(isProtectedSuperAdmin(owner, 'owner@example.com'), true);
  assert.equal(isProtectedSuperAdmin({ ...owner, role: 'user' }, 'owner@example.com'), false);
  assert.equal(isProtectedSuperAdmin(owner, ''), false);
  assert.equal(canProcessAttemptBadges({
    caller: owner,
    ownerEmail: 'staff@other-agency.example',
    ownerUser: { agency_name: 'Other Agency' },
    configuredSuperAdminEmail: 'owner@example.com',
  }), true);
  assert.equal(canProcessAttemptBadges({
    caller: owner,
    ownerEmail: 'staff@other-agency.example',
    ownerUser: { agency_name: 'Other Agency' },
    configuredSuperAdminEmail: '',
  }), false);
});

test('service-role TrainingAttempt claim occurs only after authorization', () => {
  assert.doesNotMatch(
    SOURCE,
    /await base44\.entities\.TrainingAttempt\.update/,
    'user-mode update conflicts with admin-only TrainingAttempt mutation RLS',
  );
  assert.match(SOURCE, /await base44\.asServiceRole\.entities\.TrainingAttempt\.update/);
  assert.doesNotMatch(SOURCE, /\b(?:user|caller)\??\.account_type\b/);

  const authorization = SOURCE.indexOf('if (!canProcessAttemptBadges');
  const firstServiceRoleUse = SOURCE.indexOf('base44.asServiceRole');
  const privilegedClaim = SOURCE.indexOf('base44.asServiceRole.entities.TrainingAttempt.update');
  assert.ok(authorization >= 0, 'handler must enforce the authorization helper');
  assert.ok(firstServiceRoleUse > authorization, 'no service-role access may precede authorization');
  assert.ok(privilegedClaim > authorization, 'privileged attempt mutation must follow authorization');
});
