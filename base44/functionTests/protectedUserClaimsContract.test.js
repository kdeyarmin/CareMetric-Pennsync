import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

function helperBody(source, name) {
  const start = `// <<<BEGIN SHARED HELPER: ${name}`;
  const end = `// <<<END SHARED HELPER: ${name}>>>`;
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `${name} BEGIN marker is required`);
  assert.notEqual(to, -1, `${name} END marker is required`);
  return source.slice(from, to);
}

test('shared admin and scheduler gates trust only Base44 protected role', () => {
  const canonical = read('base44/_shared/backendHelpers.mjs');
  const admin = canonical.match(/isAdminLike:\s*`([\s\S]*?)`,\n/)[1];
  const scheduler = canonical.match(/schedulerAuth:\s*`([\s\S]*?)`,\n/)[1];

  assert.match(admin, /u\.role === 'admin'/);
  assert.doesNotMatch(admin, /account_type|agency_|is_active|is_manager|staff_role|is_approved/);
  assert.match(scheduler, /user\.role === 'admin'/);
  assert.doesNotMatch(scheduler, /account_type|agency_|is_active|is_manager|staff_role|is_approved/);
});

test('platform-owner helper requires protected role plus backend-configured identity', () => {
  const canonical = read('base44/_shared/backendHelpers.mjs');
  const helper = canonical.match(/protectedUserAuthz:\s*`([\s\S]*?)`,\n/)[1];

  assert.match(helper, /user\.role === 'admin'/);
  assert.match(helper, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/);
  assert.match(helper, /normalizeProtectedEmail\(user\.email\) === configuredEmail/);
  assert.doesNotMatch(helper, /account_type|agency_|is_active|is_manager|staff_role|is_approved/);
});

test('ensureSuperAdmin cannot turn a custom-field spoof into protected role', () => {
  const source = read('base44/functions/ensureSuperAdmin/entry.ts');
  const helper = helperBody(source, 'protectedUserAuthz');

  assert.match(helper, /user\.role === 'admin'/);
  assert.match(source, /if \(!isProtectedSuperAdmin\(caller\)\)/);
  assert.doesNotMatch(source, /callerIsSuper\s*=\s*caller\.account_type/);
  assert.doesNotMatch(source, /User\.update\([^)]*\{\s*role\s*:/s);
});

test('account and credential mutation paths use protected authorization', () => {
  const expectations = [
    ['base44/functions/userManagement/entry.ts', /const isAdmin = isProtectedAdmin\(currentUser\)/, /const callerIsSuperAdmin = isProtectedSuperAdmin\(currentUser\)/, /const targetIsPrivileged = targetUser\.role === 'admin'/],
    ['base44/functions/fixUserAccount/entry.ts', /if \(!isProtectedAdmin\(currentUser\)\)/, /const isSuperAdmin = isProtectedSuperAdmin\(currentUser\)/, /const targetIsPrivileged = targetUser\?\.role === 'admin'/],
    ['base44/functions/resetUserPassword/entry.ts', /if \(!isProtectedAdmin\(currentUser\)\)/, /const callerIsSuperAdmin = isProtectedSuperAdmin\(currentUser\)/, /const targetIsPrivileged = targetUser\.role === 'admin'/],
    ['base44/functions/adminResetPassword/entry.ts', /if \(!isProtectedAdmin\(currentUser\)\)/, /const callerIsSuperAdmin = isProtectedSuperAdmin\(currentUser\)/, /const targetIsPrivileged = targetUser\.role === 'admin'/],
    ['base44/functions/createUserWithTempPassword/entry.ts', /if \(!isProtectedAdmin\(user\)\)/, /const callerIsSuperAdmin = isProtectedSuperAdmin\(user\)/],
    ['base44/functions/offboardUser/entry.ts', /const isAdmin = isProtectedAdmin\(currentUser\)/, /const callerIsSuperAdmin = isProtectedSuperAdmin\(currentUser\)/],
    ['base44/functions/saveTelnyxSecret/entry.ts', /const isSuperAdmin = isProtectedSuperAdmin\(user\)/],
    ['base44/functions/discoverTelnyxResources/entry.ts', /if \(!isProtectedSuperAdmin\(user\)\)/],
    ['base44/functions/backfillTcpaQuietHours/entry.ts', /if \(!isProtectedSuperAdmin\(user\)\)/],
    ['base44/functions/searchPurchaseTelnyxNumbers/entry.ts', /!isProtectedSuperAdmin\(user\)/],
    ['base44/functions/managePhoneNumberPool/entry.ts', /!isProtectedSuperAdmin\(user\)/],
  ];

  for (const [file, ...patterns] of expectations) {
    const source = read(file);
    helperBody(source, 'protectedUserAuthz');
    for (const pattern of patterns) assert.match(source, pattern, file);
  }
});

test('remaining integration-admin entry gates reject account_type-only callers', () => {
  const roleOnlyGates = [
    'base44/functions/getTelnyxSecretStatus/entry.ts',
    'base44/functions/testTelnyxConnection/entry.ts',
    'base44/functions/checkAllIntegrations/entry.ts',
    'base44/functions/savePayrollProfile/entry.ts',
    'base44/functions/saveVisitPointConfig/entry.ts',
    'base44/functions/saveFollowUpRuleConfig/entry.ts',
  ];

  for (const file of roleOnlyGates) {
    const source = read(file);
    assert.match(source, /const isAdmin = user\??\.role === 'admin';/, file);
  }
});

test('staff-role reconciliation cannot be bypassed with a custom admin claim', () => {
  const source = read('base44/functions/enforceStaffRoleIntegrity/entry.ts');
  const adminPredicate = source.match(/const isAdminUser = ([^;]+);/);
  assert.ok(adminPredicate, 'isAdminUser predicate is required');
  assert.match(adminPredicate[1], /user\.role === 'admin'/);
  assert.doesNotMatch(adminPredicate[1], /account_type|agency_|is_manager|staff_role|is_approved/);
});
