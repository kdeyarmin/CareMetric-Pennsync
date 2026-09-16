import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHARED_HELPERS } from '../_shared/backendHelpers.mjs';

// Base44 auth.updateMe lets every signed-in account rewrite every custom User
// field on its own record. Legacy handlers that branch on the caller's
// account_type / agency_name / agency_id / is_approved must therefore rebuild
// those claims from protected sources (withTrustedClaims) before reading them.

const root = resolve(import.meta.dirname, '..', '..');
const functionsDir = resolve(root, 'base44', 'functions');
const CLAIMS = ['account_type', 'agency_name', 'agency_id', 'is_approved'];

// Handlers that read caller claims but authorize every privileged path through
// the protected role / platform-owner / membership helpers instead. Adding a
// name here requires the same review.
const PROTECTED_CLAIM_READERS = new Set([
  'adminResetPassword',
  'autoApproveInvitedUser',
  'autoAssignWorkNumbers',
  'awardBadgeOnCompletion',
  'createUserWithTempPassword',
  'createUserWithTempPasswordV2',
  'ensureSuperAdmin',
  'fixUserAccount',
  'managePhoneNumberPool',
  'preflightStagingReadinessFixture',
  'provisionNurseWorkNumber',
  'resetUserPassword',
  'searchPurchaseTelnyxNumbers',
  'sendFax',
  'sendFaxStatusNotification',
  'sendSms',
  'sendTestSms',
  'startMaskedCall',
  'testTelnyxConnection',
  'userManagement',
  'userManagementV2',
]);

function stripHelpersAndComments(source) {
  return source
    .replace(/\/\/ <<<BEGIN SHARED HELPER: (\w+)[\s\S]*?\/\/ <<<END SHARED HELPER: \1>>>/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function loadHelper() {
  const body = SHARED_HELPERS.trustedCallerClaims;
  return new Function(`${body}\nreturn withTrustedClaims;`)();
}

function fakeBase44({ memberships = [], agencies = [], membershipError = null } = {}) {
  const calls = [];
  return {
    calls,
    asServiceRole: {
      entities: {
        AgencyMembership: {
          async filter(query, sort, limit) {
            calls.push(['AgencyMembership.filter', query, limit]);
            if (membershipError) throw membershipError;
            return memberships.filter((row) => row.user_id === query.user_id && (query.status === undefined || row.status === query.status)).slice(0, limit);
          },
        },
        Agency: {
          async filter(query, sort, limit) {
            calls.push(['Agency.filter', query, limit]);
            return agencies.filter((row) => row.id === query.id).slice(0, limit);
          },
        },
      },
    },
  };
}

const MEMBER = {
  id: 'member-1', membership_key: 'agency-1:u-1', version: 1,
  created_by_user_id: 'owner-1', last_transition_by_user_id: 'owner-1',
  last_transition_by_email_normalized: 'owner@example.test',
  last_transition_at: '2026-01-01T00:00:00.000Z', last_transition_reason: 'Assigned by administrator',
  activated_at: '2026-01-01T00:00:00.000Z',
  user_id: 'u-1',
  user_email_normalized: 'nurse@example.com',
  status: 'active',
  agency_id: 'agency-1',
  tenant_role: 'agency_admin',
};
const AGENCY = { id: 'agency-1', agency_name: 'Penn Home Health', status: 'active' };
const SPOOF = {
  id: 'u-1',
  email: 'Nurse@Example.com',
  role: 'user',
  account_type: 'super_admin',
  agency_name: 'Penn Home Health',
  agency_id: 'agency-1',
  is_approved: true,
  is_active: true,
};

test('self-set super_admin and agency claims are stripped without a membership', async () => {
  const withTrustedClaims = loadHelper();
  const trusted = await withTrustedClaims(fakeBase44(), SPOOF);
  assert.equal(trusted.account_type, 'user');
  assert.equal(trusted.agency_name, '');
  assert.equal(trusted.agency_id, '');
  assert.equal(trusted.is_approved, false);
  assert.equal(trusted.email, SPOOF.email);
  assert.equal(trusted.is_active, true);

  const agencySpoof = await withTrustedClaims(fakeBase44(), { ...SPOOF, account_type: 'agency_admin' });
  assert.equal(agencySpoof.account_type, 'user');
  assert.equal(agencySpoof.agency_name, '');
});

test('tenant claims come only from one active membership in an active agency', async () => {
  const withTrustedClaims = loadHelper();
  const trusted = await withTrustedClaims(fakeBase44({ memberships: [MEMBER], agencies: [AGENCY] }), {
    ...SPOOF,
    account_type: 'staff',
    agency_name: 'Some Other Agency',
  });
  assert.equal(trusted.account_type, 'agency_admin');
  assert.equal(trusted.agency_name, 'Penn Home Health');
  assert.equal(trusted.agency_id, 'agency-1');
  assert.equal(trusted.is_approved, true);

  const clinician = await withTrustedClaims(
    fakeBase44({ memberships: [{ ...MEMBER, tenant_role: 'clinician' }], agencies: [AGENCY] }),
    SPOOF,
  );
  assert.equal(clinician.account_type, 'user', 'a clinician membership never yields a privileged type');
  assert.equal(clinician.agency_name, 'Penn Home Health');
});

test('ambiguous, mismatched, inactive, or failing membership lookups fail closed', async () => {
  const withTrustedClaims = loadHelper();
  const cases = [
    fakeBase44({ memberships: [MEMBER, { ...MEMBER, agency_id: 'agency-2' }], agencies: [AGENCY] }),
    fakeBase44({ memberships: [{ ...MEMBER, user_email_normalized: 'someone@example.com' }], agencies: [AGENCY] }),
    fakeBase44({ memberships: [MEMBER], agencies: [{ ...AGENCY, status: 'suspended' }] }),
    fakeBase44({ memberships: [MEMBER], agencies: [] }),
    fakeBase44({ memberships: [MEMBER], agencies: [{ ...AGENCY, agency_name: '   ' }] }),
    fakeBase44({ membershipError: new Error('datastore unavailable') }),
  ];
  for (const base44 of cases) {
    const trusted = await withTrustedClaims(base44, SPOOF);
    assert.equal(trusted.account_type, 'user');
    assert.equal(trusted.agency_name, '');
    assert.equal(trusted.is_approved, false);
  }
});

test('protected admins and missing callers pass through untouched', async () => {
  const withTrustedClaims = loadHelper();
  const base44 = fakeBase44();
  const admin = { ...SPOOF, role: 'admin', account_type: 'agency_admin', agency_name: 'Agency Two' };
  assert.deepEqual(await withTrustedClaims(base44, admin), admin);
  assert.equal(await withTrustedClaims(base44, null), null);
  assert.equal(await withTrustedClaims(base44, undefined), undefined);
  assert.equal(base44.calls.length, 0, 'no service-role read for admins or anonymous callers');
});

test('the canonical helper never trusts profile claims for grants', () => {
  const body = SHARED_HELPERS.trustedCallerClaims;
  assert.match(body, /if \(profile\.role === 'admin'\) return profile;/);
  assert.match(body, /asServiceRole\.entities\.AgencyMembership\.filter\(\s*\{ user_id: profileId \}/);
  assert.match(body, /PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set\(\['super_admin', 'agency_admin'\]\)/);
  assert.doesNotMatch(body, /profile\.(?:agency_name|agency_id|is_approved|is_manager|staff_role)\b/);
});

test('every legacy handler that reads caller claims wraps each auth.me() in withTrustedClaims', () => {
  const unwrapped = [];
  for (const name of readdirSync(functionsDir).sort()) {
    const entry = resolve(functionsDir, name, 'entry.ts');
    if (!existsSync(entry)) continue;
    const source = readFileSync(entry, 'utf8');
    const code = stripHelpersAndComments(source);
    const callerVars = [...code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*await\s+(?:withTrustedClaims\(base44,\s*await\s+)?base44\.auth\.me\(\)/g)]
      .map((match) => match[1]);
    if (callerVars.length === 0) continue;
    const readsClaims = callerVars.some((variable) => CLAIMS.some((claim) =>
      new RegExp(`\\b${variable}\\s*(?:\\?\\.|\\.)\\s*${claim}\\b`).test(code)));
    if (!readsClaims || PROTECTED_CLAIM_READERS.has(name)) continue;

    const total = (code.match(/base44\.auth\.me\(\)/g) || []).length;
    const wrapped = (code.match(/withTrustedClaims\(base44, await base44\.auth\.me\(\)/g) || []).length;
    const hasHelper = source.includes('// <<<BEGIN SHARED HELPER: trustedCallerClaims');
    if (!hasHelper || wrapped !== total) unwrapped.push(`${name} (${wrapped}/${total} wrapped)`);
  }
  assert.deepEqual(unwrapped, [], `caller claims must be rebuilt before use:\n${unwrapped.join('\n')}`);
});


test('an active membership plus an inactive duplicate never yields a grant', async () => {
  for (const status of ['pending', 'suspended', 'revoked']) {
    const trusted = await loadHelper()(fakeBase44({
      memberships: [MEMBER, { ...MEMBER, id: 'other-row', status }], agencies: [AGENCY],
    }), SPOOF);
    assert.equal(trusted.agency_id, '', status);
    assert.equal(trusted.is_approved, false, status);
  }
});

test('canonical lifecycle fields are required before deriving any legacy grant', async () => {
  for (const invalid of [
    { id: '' }, { membership_key: 'wrong' }, { version: 0 }, { tenant_role: 'owner' },
    { created_by_user_id: '' }, { last_transition_by_user_id: '' },
    { last_transition_by_email_normalized: 'OWNER@example.test' },
    { last_transition_at: 'not-a-date' }, { last_transition_reason: '' },
    { activated_at: null }, { revoked_at: '2026-01-01T00:00:00.000Z' },
    { invitation_id: '$not-an-id' },
  ]) {
    const trusted = await loadHelper()(fakeBase44({ memberships: [{ ...MEMBER, ...invalid }], agencies: [AGENCY] }), SPOOF);
    assert.equal(trusted.is_approved, false, JSON.stringify(invalid));
    assert.equal(trusted.agency_id, '', JSON.stringify(invalid));
  }
});

test('manager approval authority comes from membership, not the editable is_manager flag', async () => {
  const withClaims = loadHelper();
  const spoof = { ...SPOOF, is_manager: true };
  assert.equal((await withClaims(fakeBase44(), spoof)).is_manager, false);
  assert.equal((await withClaims(fakeBase44({ memberships: [{ ...MEMBER, tenant_role: 'clinician' }], agencies: [AGENCY] }), spoof)).is_manager, false);
  assert.equal((await withClaims(fakeBase44({ memberships: [{ ...MEMBER, tenant_role: 'manager' }], agencies: [AGENCY] }), { ...SPOOF, is_manager: false })).is_manager, true);
});

test('wrongly scoped or malformed membership responses never grant access', async () => {
  for (const returned of [null, {}, [null], [{ ...MEMBER, user_id: 'someone-else' }]]) {
    const client = fakeBase44({ agencies: [AGENCY] });
    client.asServiceRole.entities.AgencyMembership.filter = async () => returned;
    assert.equal((await loadHelper()(client, SPOOF)).is_approved, false);
  }
});
