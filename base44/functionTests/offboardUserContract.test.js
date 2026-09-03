import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { transpileTs } from '../../tools-transpile-ts.mjs';

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

test('a failed discovery query counts as a failure, not an empty sweep', () => {
  // `.catch(() => [])` on the discovery queries turned "could not enumerate"
  // into "nothing to revoke", so a total failure to find the records still
  // reported complete: true while PHI access was untouched.
  assert.doesNotMatch(
    SRC,
    /\.catch\(\(\) => \[\]\)/,
    'discovery queries must not swallow errors into an empty array',
  );
  const catches = SRC.match(/\.catch\(\(err\) => \{[\s\S]*?\}\)/g) || [];
  const counting = catches.filter((c) => /results\.failures \+= 1/.test(c));
  assert.ok(
    counting.length >= 4,
    'each of the four revocation discovery queries must count its own failure; '
      + `found ${counting.length}`,
  );
});

test('an incomplete sweep is reported to the caller, not just logged', () => {
  const client = readFileSync(join(process.cwd(), 'src/pages/UserManagement.jsx'), 'utf8');
  assert.match(
    client,
    /payload\.complete === false/,
    'UserManagement must inspect the response: showing the clean-success toast '
      + 'unconditionally tells an admin access was withdrawn when it was not.',
  );
});

test('the client exposes offboarding only to the protected owner and does not promise restored authority', () => {
  const client = readFileSync(join(process.cwd(), 'src/pages/UserManagement.jsx'), 'utf8');
  assert.match(client, /import \{ isSuperAdmin \} from ["']@\/lib\/superAdmin["']/, 'UI must use the protected owner helper');
  assert.match(client, /const canManageOffboarding = isSuperAdmin\(currentUser\)/, 'UI gate must require the protected owner');
  assert.match(client, /disabled=\{currentUser\.email === user\.email \|\| !canManageOffboarding\}/, 'ordinary admins must not receive an actionable offboard control');
  assert.match(client, /does <strong>not<\/strong> restore tenant membership or patient access/, 'reactivation dialog must disclose that tenant authority stays revoked');
  assert.doesNotMatch(client, /They will be able to access the system again/, 'reactivation must not promise restored system access');
});

test('the patient sweep filters server-side instead of scanning every patient', () => {
  assert.match(
    SRC,
    /Patient\.filter\(\s*\{\s*assigned_nurses:/,
    'Listing all patients and filtering in-process silently misses assignments '
      + 'past the row ceiling, leaving live PHI access behind.',
  );
});

const OWNER = {
  id: 'owner-1',
  email: 'Owner@example.test',
  full_name: 'Platform Owner',
  role: 'admin',
  is_active: true,
};
const TARGET = {
  id: 'target-1',
  email: 'Target@example.test',
  full_name: 'Target User',
  role: 'user',
  is_active: true,
};

const membership = (overrides = {}) => {
  const row = {
    id: 'membership-a',
    membership_key: 'agency-a:target-1',
    agency_id: 'agency-a',
    user_id: 'target-1',
    user_email_normalized: 'target@example.test',
    tenant_role: 'clinician',
    status: 'active',
    created_by_user_id: 'owner-1',
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: '2026-09-03T12:00:00.000Z',
    last_transition_reason: 'Membership lifecycle setup',
    version: 1,
    ...overrides,
  };
  if (
    (row.status === 'active' || row.status === 'suspended')
    && row.activated_at === undefined
  ) {
    row.activated_at = '2026-09-03T12:01:00.000Z';
  }
  if (row.status === 'revoked') {
    if (row.revoked_at === undefined) row.revoked_at = '2026-09-03T12:02:00.000Z';
    if (row.revocation_reason === undefined) row.revocation_reason = 'Previously revoked';
  }
  return row;
};

async function loadRuntime({
  caller = OWNER,
  authMeError = null,
  users = [TARGET, OWNER],
  memberships = [membership()],
  superAdminEmail = 'owner@example.test',
  membershipNoopIds = [],
  membershipThrowId = null,
  ignoreMembershipFilters = false,
} = {}) {
  let source = await readFile(
    join(process.cwd(), 'base44/functions/offboardUser/entry.ts'),
    'utf8',
  );
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__offboardMakeClient;',
  );
  const temporaryModule = join(
    tmpdir(),
    `offboard_runtime_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const state = {
    users: users.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
  };
  const calls = {
    userFilters: [],
    userUpdates: [],
    membershipFilters: [],
    membershipUpdates: [],
    sweepFilters: [],
    activityCreates: [],
    events: [],
  };
  const matches = (row, query) =>
    Object.entries(query || {}).every(([key, value]) => row?.[key] === value);
  const sweepEntity = (name) => ({
    filter: async (...args) => {
      calls.sweepFilters.push({ name, args });
      return [];
    },
    update: async () => {
      throw new Error(`${name}.update should not run for an empty sweep`);
    },
  });
  const entities = {
    User: {
      filter: async (query, sort, limit) => {
        calls.userFilters.push({ query, sort, limit });
        return state.users.filter((row) => matches(row, query)).slice(0, limit);
      },
      update: async (id, payload) => {
        calls.events.push(`User.update:${id}`);
        calls.userUpdates.push({ id, payload: { ...payload } });
        const index = state.users.findIndex((row) => row.id === id);
        if (index !== -1) state.users[index] = { ...state.users[index], ...payload };
        return state.users[index];
      },
    },
    AgencyMembership: {
      filter: async (query, sort, limit) => {
        calls.membershipFilters.push({ query, sort, limit });
        const rows = ignoreMembershipFilters
          ? state.memberships
          : state.memberships.filter((row) => matches(row, query));
        return rows.slice(0, limit);
      },
      update: async (id, payload) => {
        calls.events.push(`AgencyMembership.update:${id}`);
        calls.membershipUpdates.push({ id, payload: { ...payload } });
        if (id === membershipThrowId) throw new Error('simulated membership update failure');
        const index = state.memberships.findIndex((row) => row.id === id);
        if (!membershipNoopIds.includes(id) && index !== -1) {
          state.memberships[index] = { ...state.memberships[index], ...payload };
        }
        return state.memberships[index];
      },
    },
    Patient: sweepEntity('Patient'),
    PhoneNumber: sweepEntity('PhoneNumber'),
    OnCallShift: sweepEntity('OnCallShift'),
    UserInvitation: sweepEntity('UserInvitation'),
    ScheduledSms: sweepEntity('ScheduledSms'),
    ScheduledFax: sweepEntity('ScheduledFax'),
    ScheduledSignatureReminder: sweepEntity('ScheduledSignatureReminder'),
    UserActivity: {
      create: async (payload) => {
        calls.activityCreates.push(payload);
        return { id: 'activity-1', ...payload };
      },
    },
  };
  const client = {
    auth: {
      me: async () => {
        if (authMeError) throw authMeError;
        return caller;
      },
    },
    asServiceRole: { entities },
  };

  let handler;
  globalThis.__offboardMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__offboardMakeClient;
  }
  assert.equal(typeof handler, 'function');
  return { handler, state, calls };
}

async function invokeRuntime(handler, body) {
  const response = await handler(new Request('http://local/offboardUser', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { response, json: await response.json() };
}

test('offboard and reactivate deny every non-owner before service-role reads', async () => {
  for (const body of [
    { action: 'offboard', user_id: 'target-1', reason: 'Employment ended' },
    { action: 'reactivate', user_id: 'target-1' },
  ]) {
    const runtime = await loadRuntime({
      caller: { ...OWNER, id: 'other-admin', email: 'other@example.test' },
    });
    const result = await invokeRuntime(runtime.handler, body);
    assert.equal(result.response.status, 403);
    assert.equal(runtime.calls.userFilters.length, 0);
    assert.equal(runtime.calls.membershipFilters.length, 0);
    assert.equal(runtime.calls.userUpdates.length, 0);
    assert.equal(runtime.calls.membershipUpdates.length, 0);
  }
});

test('an anonymous auth rejection returns 401 before every service-role read or write', async () => {
  const runtime = await loadRuntime({
    authMeError: new Error('missing bearer token'),
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 401);
  assert.deepEqual(result.json, { error: 'Unauthorized' });
  assert.equal(runtime.calls.userFilters.length, 0);
  assert.equal(runtime.calls.membershipFilters.length, 0);
  assert.equal(runtime.calls.userUpdates.length, 0);
  assert.equal(runtime.calls.membershipUpdates.length, 0);
  assert.equal(runtime.calls.sweepFilters.length, 0);
  assert.equal(runtime.calls.activityCreates.length, 0);
});

test('a retained active membership aborts before User deactivation and legacy sweeps', async () => {
  const runtime = await loadRuntime({ membershipNoopIds: ['membership-a'] });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 409);
  assert.equal(runtime.state.memberships[0].status, 'active');
  assert.equal(runtime.calls.membershipUpdates.length, 1);
  assert.equal(runtime.calls.userUpdates.length, 0);
  assert.equal(runtime.calls.sweepFilters.length, 0);
});

test('a partial membership update aborts before User deactivation and legacy sweeps', async () => {
  const second = membership({
    id: 'membership-b',
    membership_key: 'agency-b:target-1',
    agency_id: 'agency-b',
    status: 'suspended',
  });
  const runtime = await loadRuntime({
    memberships: [membership(), second],
    membershipThrowId: 'membership-b',
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 409);
  assert.equal(runtime.state.memberships[0].status, 'revoked');
  assert.equal(runtime.state.memberships[1].status, 'suspended');
  assert.equal(runtime.calls.membershipUpdates.length, 2);
  assert.equal(runtime.calls.userUpdates.length, 0);
  assert.equal(runtime.calls.sweepFilters.length, 0);
});

test('duplicate membership identities abort offboarding before every write', async () => {
  const runtime = await loadRuntime({
    memberships: [
      membership(),
      membership({ id: 'membership-duplicate', status: 'revoked' }),
    ],
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 409);
  assert.equal(runtime.calls.membershipUpdates.length, 0);
  assert.equal(runtime.calls.userUpdates.length, 0);
  assert.equal(runtime.calls.sweepFilters.length, 0);

  const leakedScope = await loadRuntime({
    memberships: [
      membership(),
      membership({
        id: 'foreign-membership',
        membership_key: 'foreign-agency:foreign-user',
        agency_id: 'foreign-agency',
        user_id: 'foreign-user',
        user_email_normalized: 'foreign@example.test',
      }),
    ],
    ignoreMembershipFilters: true,
  });
  const leakedResult = await invokeRuntime(leakedScope.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(leakedResult.response.status, 409);
  assert.equal(leakedScope.calls.membershipUpdates.length, 0);
  assert.equal(leakedScope.calls.userUpdates.length, 0);
});

test('all revocable memberships reconcile before User deactivation or cleanup', async () => {
  const memberships = [
    membership({ id: 'membership-p', status: 'pending' }),
    membership({
      id: 'membership-a',
      membership_key: 'agency-b:target-1',
      agency_id: 'agency-b',
    }),
    membership({
      id: 'membership-s',
      membership_key: 'agency-c:target-1',
      agency_id: 'agency-c',
      status: 'suspended',
    }),
    membership({
      id: 'membership-r',
      membership_key: 'agency-d:target-1',
      agency_id: 'agency-d',
      status: 'revoked',
    }),
  ];
  const runtime = await loadRuntime({ memberships });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.results.memberships_revoked, 3);
  assert.equal(result.json.results.memberships_already_revoked, 1);
  assert.equal(runtime.state.memberships.every((row) => row.status === 'revoked'), true);
  assert.equal(runtime.calls.membershipUpdates.length, 3);
  assert.equal(runtime.calls.userUpdates.length, 1);
  assert.equal(runtime.state.users.find((row) => row.id === 'target-1').is_active, false);
  const userUpdateIndex = runtime.calls.events.findIndex((event) => event.startsWith('User.update'));
  const membershipUpdateIndexes = runtime.calls.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.startsWith('AgencyMembership.update'))
    .map(({ index }) => index);
  assert.equal(membershipUpdateIndexes.every((index) => index < userUpdateIndex), true);
});

test('reactivation never restores tenant authority', async () => {
  const revoked = await loadRuntime({
    users: [{ ...TARGET, is_active: false }, OWNER],
    memberships: [membership({ status: 'revoked' })],
  });
  const result = await invokeRuntime(revoked.handler, {
    action: 'reactivate',
    user_id: 'target-1',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.membership_authority_restored, false);
  assert.equal(result.json.membership_reprovisioning_required, true);
  assert.equal(result.json.membership_reprovisioning_available, false);
  assert.equal(revoked.calls.membershipUpdates.length, 0);
  assert.equal(revoked.state.memberships[0].status, 'revoked');
  assert.equal(revoked.state.users.find((row) => row.id === 'target-1').is_active, true);

  const retained = await loadRuntime({
    users: [{ ...TARGET, is_active: false }, OWNER],
    memberships: [membership()],
  });
  const blocked = await invokeRuntime(retained.handler, {
    action: 'reactivate',
    user_id: 'target-1',
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(retained.calls.membershipUpdates.length, 0);
  assert.equal(retained.calls.userUpdates.length, 0);
  assert.equal(retained.state.users.find((row) => row.id === 'target-1').is_active, false);
});
