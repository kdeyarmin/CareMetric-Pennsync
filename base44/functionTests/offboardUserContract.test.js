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
    /currentUser\.is_active !== true/,
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

test('the client exposes offboarding only to the protected owner and cannot invoke reactivation', () => {
  const client = readFileSync(join(process.cwd(), 'src/pages/UserManagement.jsx'), 'utf8');
  assert.match(client, /import \{[^}]*\bisSuperAdmin\b[^}]*\} from ["']@\/lib\/superAdmin["']/, 'UI must use the protected owner helper');
  assert.match(client, /const canManageOffboarding = isSuperAdmin\(currentUser\)/, 'UI gate must require the protected owner');
  assert.match(client, /disabled=\{!isActive \|\| currentUser\.email === user\.email \|\| !canManageOffboarding\}/, 'inactive accounts and ordinary admins must not receive an actionable status control');
  assert.match(client, /Reactivation temporarily unavailable pending retirement of legacy PHI grants/, 'inactive-account control must explain the hard pause');
  assert.doesNotMatch(client, /Reactivate Identity Only/, 'the confirmation dialog must not offer reactivation');
});

test('reactivation is hard-paused before Base44 client creation while source remains preserved', () => {
  const pause = SRC.indexOf("if (action === 'reactivate')");
  const clientCreation = SRC.indexOf('const base44 = createClientFromRequest(req)');
  const preservedSource = SRC.indexOf('async function reactivateUser');
  assert.ok(pause !== -1 && pause < clientCreation, 'reactivation must return 503 before client creation');
  assert.ok(preservedSource > clientCreation, 'the dormant implementation source must remain available for review');
  assert.match(SRC.slice(pause, clientCreation), /USER_REACTIVATION_PAUSED/);
  assert.match(SRC.slice(pause, clientCreation), /status: 503/);
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
  authMutationOnRead = null,
  users = [TARGET, OWNER],
  memberships = [membership()],
  superAdminEmail = 'owner@example.test',
  membershipNoopIds = [],
  membershipThrowId = null,
  ignoreMembershipFilters = false,
  membershipMutationOnRead = null,
  userPreimageMutation = null,
  userUpdateNoop = false,
  userUpdateThrows = false,
  userUpdateThrowsAfterCommit = false,
  userUpdateCollateralMutation = null,
  freshUserReadObjects = false,
  sweepRows = {},
  sweepNoopEntities = [],
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
    sweeps: Object.fromEntries([
      'Patient',
      'PhoneNumber',
      'OnCallShift',
      'UserInvitation',
      'ScheduledSms',
      'ScheduledFax',
      'ScheduledSignatureReminder',
    ].map((name) => [
      name,
      (sweepRows[name] || []).map((row) => structuredClone(row)),
    ])),
  };
  const calls = {
    clientCreations: 0,
    authReads: 0,
    userFilters: [],
    userUpdates: [],
    membershipFilters: [],
    membershipUpdates: [],
    sweepFilters: [],
    sweepUpdates: [],
    activityCreates: [],
    events: [],
  };
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => (
    Array.isArray(row?.[key]) && !Array.isArray(value)
      ? row[key].includes(value)
      : row?.[key] === value
  ));
  let targetUserReads = 0;
  let membershipReads = 0;
  let authUser = { ...caller };
  const sweepEntity = (name) => ({
    filter: async (query, sort, limit) => {
      calls.sweepFilters.push({ name, args: [query, sort, limit] });
      const rows = state.sweeps[name].filter((row) => matches(row, query));
      return rows.slice(0, limit);
    },
    update: async (id, payload) => {
      calls.sweepUpdates.push({ name, id, payload: { ...payload } });
      const index = state.sweeps[name].findIndex((row) => row.id === id);
      if (!sweepNoopEntities.includes(name) && index !== -1) {
        state.sweeps[name][index] = { ...state.sweeps[name][index], ...payload };
      }
      return state.sweeps[name][index];
    },
  });
  const entities = {
    User: {
      filter: async (query, sort, limit) => {
        calls.userFilters.push({ query, sort, limit });
        if (query?.id === 'target-1') {
          targetUserReads += 1;
          if (targetUserReads === 2 && userPreimageMutation) {
            const index = state.users.findIndex((row) => row.id === 'target-1');
            if (index !== -1) {
              state.users[index] = { ...state.users[index], ...userPreimageMutation };
            }
          }
        }
        const rows = state.users.filter((row) => matches(row, query)).slice(0, limit);
        return freshUserReadObjects ? rows.map((row) => structuredClone(row)) : rows;
      },
      update: async (id, payload) => {
        calls.events.push(`User.update:${id}`);
        calls.userUpdates.push({ id, payload: { ...payload } });
        if (userUpdateThrows) throw new Error('simulated User update failure');
        const index = state.users.findIndex((row) => row.id === id);
        if (!userUpdateNoop && index !== -1) {
          state.users[index] = {
            ...state.users[index],
            ...payload,
            ...(userUpdateCollateralMutation || {}),
          };
        }
        if (userUpdateThrowsAfterCommit) {
          throw new Error('simulated response loss after User update');
        }
        return state.users[index];
      },
    },
    AgencyMembership: {
      filter: async (query, sort, limit) => {
        calls.membershipFilters.push({ query, sort, limit });
        membershipReads += 1;
        if (membershipMutationOnRead?.read === membershipReads) {
          state.memberships.push(structuredClone(membershipMutationOnRead.row));
        }
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
        calls.authReads += 1;
        if (authMeError) throw authMeError;
        if (authMutationOnRead?.read === calls.authReads) {
          authUser = { ...authUser, ...authMutationOnRead.patch };
        }
        return authUser;
      },
    },
    asServiceRole: { entities },
  };

  let handler;
  globalThis.__offboardMakeClient = () => {
    calls.clientCreations += 1;
    return client;
  };
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

test('offboard denies every non-owner before service-role reads', async () => {
  const runtime = await loadRuntime({
    caller: { ...OWNER, id: 'other-admin', email: 'other@example.test' },
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 403);
  assert.equal(runtime.calls.userFilters.length, 0);
  assert.equal(runtime.calls.membershipFilters.length, 0);
  assert.equal(runtime.calls.userUpdates.length, 0);
  assert.equal(runtime.calls.membershipUpdates.length, 0);
});

test('reactivation returns controlled 503 before client creation, privileged reads, or writes', async () => {
  const runtime = await loadRuntime({
    users: [{ ...TARGET, is_active: false }, OWNER],
    memberships: [membership({ status: 'revoked' })],
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'reactivate',
    user_id: 'target-1',
  });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.json, {
    error: 'User reactivation is temporarily unavailable pending retirement of legacy PHI grants',
    code: 'USER_REACTIVATION_PAUSED',
  });
  assert.equal(runtime.calls.clientCreations, 0);
  assert.equal(runtime.calls.userFilters.length, 0);
  assert.equal(runtime.calls.membershipFilters.length, 0);
  assert.equal(runtime.calls.userUpdates.length, 0);
  assert.equal(runtime.calls.membershipUpdates.length, 0);
  assert.equal(runtime.calls.sweepFilters.length, 0);
  assert.equal(runtime.calls.sweepUpdates.length, 0);
  assert.equal(runtime.calls.activityCreates.length, 0);
  assert.equal(runtime.state.users[0].is_active, false);
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

test('offboarding revalidates the exact active nonservice owner at every mutation phase', async () => {
  const cases = [
    {
      name: 'membership mutation',
      read: 2,
      patch: { id: 'different-owner' },
      membershipUpdates: 0,
      userUpdates: 0,
      targetActive: true,
      message: /before membership revocation/,
    },
    {
      name: 'User deactivation',
      read: 3,
      patch: { is_active: false },
      membershipUpdates: 1,
      userUpdates: 0,
      targetActive: true,
      message: /before User deactivation/,
    },
    {
      name: 'legacy cleanup',
      read: 4,
      patch: { is_service: true },
      membershipUpdates: 1,
      userUpdates: 1,
      targetActive: false,
      message: /before legacy cleanup/,
    },
  ];
  for (const scenario of cases) {
    const runtime = await loadRuntime({
      authMutationOnRead: { read: scenario.read, patch: scenario.patch },
    });
    const result = await invokeRuntime(runtime.handler, {
      action: 'offboard',
      user_id: 'target-1',
      reason: 'Employment ended',
    });
    assert.equal(result.response.status, 403, scenario.name);
    assert.match(result.json.error, scenario.message, scenario.name);
    assert.equal(runtime.calls.membershipUpdates.length, scenario.membershipUpdates, scenario.name);
    assert.equal(runtime.calls.userUpdates.length, scenario.userUpdates, scenario.name);
    assert.equal(runtime.state.users[0].is_active, scenario.targetActive, scenario.name);
    assert.equal(runtime.calls.sweepFilters.length, 0, scenario.name);
    assert.equal(runtime.calls.sweepUpdates.length, 0, scenario.name);
    assert.equal(runtime.calls.activityCreates.length, 0, scenario.name);
  }
});

test('offboarding never reports success when the exact built-in User write is absent or corrupt', async () => {
  for (const options of [
    { userUpdateNoop: true },
    { userUpdateCollateralMutation: { role: 'admin' } },
    { userUpdateCollateralMutation: { unexpected_capability: 'elevated' } },
    { userUpdateThrows: true },
  ]) {
    const runtime = await loadRuntime(options);
    const result = await invokeRuntime(runtime.handler, {
      action: 'offboard',
      user_id: 'target-1',
      reason: 'Employment ended',
    });
    assert.equal(result.response.status, 409);
    assert.match(result.json.error, /memberships remain revoked/);
    assert.equal(runtime.state.memberships[0].status, 'revoked');
    assert.equal(runtime.calls.userUpdates.length, 1);
    assert.equal(runtime.calls.sweepFilters.length, 0);
    assert.equal(runtime.calls.activityCreates.length, 0);
  }
});

test('provider-owned User metadata may appear without weakening exact readback', async () => {
  const runtime = await loadRuntime({
    userUpdateCollateralMutation: { updated_date: '2026-09-03T12:30:00.000Z' },
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.complete, true);
  assert.equal(runtime.state.users[0].updated_date, '2026-09-03T12:30:00.000Z');
});

test('an exact User readback resolves a transport error that followed a committed write', async () => {
  const offboard = await loadRuntime({ userUpdateThrowsAfterCommit: true });
  const offboardResult = await invokeRuntime(offboard.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(offboardResult.response.status, 200);
  assert.equal(offboard.state.users[0].is_active, false);
});

test('a concurrent User preimage change blocks the offboard User write after membership revocation', async () => {
  const runtime = await loadRuntime({
    userPreimageMutation: { full_name: 'Concurrent profile edit' },
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 409);
  assert.match(result.json.error, /changed during offboarding/);
  assert.equal(runtime.state.memberships[0].status, 'revoked');
  assert.equal(runtime.state.users[0].is_active, true);
  assert.equal(runtime.calls.userUpdates.length, 0);
  assert.equal(runtime.calls.sweepFilters.length, 0);
});

test('fresh nested User values compare by canonical JSON structure, not object identity', async () => {
  const runtime = await loadRuntime({
    users: [{
      ...TARGET,
      preferences: {
        notifications: { email: true, sms: false },
        work_queues: ['visits', { kind: 'documents', enabled: true }],
      },
      pinned_agencies: ['agency-a', 'agency-b'],
    }, OWNER],
    userPreimageMutation: {
      preferences: {
        work_queues: ['visits', { enabled: true, kind: 'documents' }],
        notifications: { sms: false, email: true },
      },
    },
    freshUserReadObjects: true,
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(runtime.state.users[0].is_active, false);
  assert.equal(runtime.calls.userUpdates.length, 1);
});

test('changed nested User content still fails exact preimage and readback reconciliation', async () => {
  const originalPreferences = {
    notifications: { email: true, sms: false },
    work_queues: ['visits', { kind: 'documents', enabled: true }],
  };
  const changedPreferences = {
    notifications: { email: false, sms: false },
    work_queues: ['visits', { kind: 'documents', enabled: true }],
  };

  const preimage = await loadRuntime({
    users: [{ ...TARGET, preferences: originalPreferences }, OWNER],
    userPreimageMutation: { preferences: changedPreferences },
    freshUserReadObjects: true,
  });
  const preimageResult = await invokeRuntime(preimage.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(preimageResult.response.status, 409);
  assert.match(preimageResult.json.error, /changed during offboarding/);
  assert.equal(preimage.calls.userUpdates.length, 0);

  const readback = await loadRuntime({
    users: [{ ...TARGET, preferences: originalPreferences }, OWNER],
    userUpdateCollateralMutation: { preferences: changedPreferences },
    freshUserReadObjects: true,
  });
  const readbackResult = await invokeRuntime(readback.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(readbackResult.response.status, 409);
  assert.match(readbackResult.json.error, /could not be reconciled/);
  assert.equal(readback.calls.userUpdates.length, 1);
  assert.equal(readback.calls.sweepFilters.length, 0);
});

test('offboarding rechecks the exact revoked membership set before and after User deactivation', async () => {
  const racedMembership = membership({
    id: 'membership-race',
    membership_key: 'agency-b:target-1',
    agency_id: 'agency-b',
  });
  for (const [read, expectedUserUpdates, expectedActive, expectedSweepFilters] of [
    [5, 0, true, 0],
    [6, 1, false, 0],
    [7, 1, false, 8],
  ]) {
    const runtime = await loadRuntime({
      membershipMutationOnRead: { read, row: racedMembership },
    });
    const result = await invokeRuntime(runtime.handler, {
      action: 'offboard',
      user_id: 'target-1',
      reason: 'Employment ended',
    });
    assert.equal(result.response.status, 409);
    assert.match(result.json.error, /Membership set changed/);
    assert.equal(runtime.calls.userUpdates.length, expectedUserUpdates);
    assert.equal(runtime.state.users[0].is_active, expectedActive);
    assert.equal(runtime.calls.sweepFilters.length, expectedSweepFilters);
  }
});

test('patient cleanup sweeps canonical and distinct raw emails with bounded exact readback', async () => {
  const canonical = 'target@example.test';
  const raw = TARGET.email;
  const runtime = await loadRuntime({
    sweepRows: {
      Patient: [
        { id: 'patient-canonical', assigned_nurses: [canonical, 'other@example.test'] },
        { id: 'patient-raw', assigned_nurses: [raw, 'other@example.test'] },
        { id: 'patient-both', assigned_nurses: [canonical, raw, 'other@example.test'] },
      ],
    },
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.complete, true);
  assert.equal(result.json.results.patients_unassigned, 3);
  assert.equal(result.json.results.failures, 0);
  assert.deepEqual(
    runtime.calls.sweepFilters
      .filter(({ name, args }) => name === 'Patient' && args[0]?.assigned_nurses)
      .map(({ args }) => args),
    [
      [{ assigned_nurses: canonical }, '-updated_date', 5000],
      [{ assigned_nurses: raw }, '-updated_date', 5000],
    ],
  );
  const patientReadbacks = runtime.calls.sweepFilters
    .filter(({ name, args }) => name === 'Patient' && args[0]?.id);
  assert.equal(patientReadbacks.length, 6);
  assert.equal(patientReadbacks.every(({ args }) => (
    args[1] === '-updated_date' && args[2] === 10
  )), true);
  assert.equal(
    runtime.calls.sweepUpdates.filter(({ name }) => name === 'Patient').length,
    3,
  );
  assert.deepEqual(
    runtime.state.sweeps.Patient.map((row) => row.assigned_nurses),
    [
      ['other@example.test'],
      ['other@example.test'],
      ['other@example.test'],
    ],
  );
});

test('every cleanup update requires exact readback before complete can be true', async () => {
  const targetEmail = TARGET.email;
  const cases = [
    ['Patient', 'patients_unassigned', {
      id: 'patient-1',
      assigned_nurses: [targetEmail],
      full_name: 'Example Patient',
    }],
    ['PhoneNumber', 'work_numbers_released', {
      id: 'phone-1',
      assigned_to_email: targetEmail,
      status: 'assigned',
    }],
    ['OnCallShift', 'on_call_shifts_cleared', {
      id: 'shift-1',
      assigned_user_email: targetEmail,
      assigned_user_name: 'Target User',
      notes: 'Original note',
    }],
    ['UserInvitation', 'invitations_cancelled', {
      id: 'invite-1',
      email: targetEmail,
      status: 'pending',
    }],
    ['ScheduledSms', 'scheduled_sms_canceled', {
      id: 'sms-1',
      nurse_email: targetEmail,
      status: 'pending',
    }],
    ['ScheduledFax', 'scheduled_faxes_canceled', {
      id: 'fax-1',
      created_by: targetEmail,
      status: 'pending',
    }],
    ['ScheduledSignatureReminder', 'signature_reminders_canceled', {
      id: 'reminder-1',
      requested_by: targetEmail,
      status: 'pending',
    }],
  ];
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [entity, resultField, row] of cases) {
      const runtime = await loadRuntime({
        sweepRows: { [entity]: [row] },
        sweepNoopEntities: [entity],
      });
      const result = await invokeRuntime(runtime.handler, {
        action: 'offboard',
        user_id: 'target-1',
        reason: 'Employment ended',
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.json.success, true);
      assert.equal(result.json.complete, false);
      assert.equal(result.json.results.failures, 1);
      assert.equal(result.json.results[resultField], 0);
      assert.equal(runtime.calls.sweepUpdates.length, 1);
    }
  } finally {
    console.error = originalError;
  }
});

test('exact committed cleanup readbacks are the only rows counted as revoked', async () => {
  const targetEmail = TARGET.email;
  const runtime = await loadRuntime({
    sweepRows: {
      Patient: [{ id: 'patient-1', assigned_nurses: [targetEmail, 'other@example.test'] }],
      PhoneNumber: [{ id: 'phone-1', assigned_to_email: targetEmail, status: 'assigned' }],
      OnCallShift: [{
        id: 'shift-1',
        assigned_user_email: targetEmail,
        assigned_user_name: 'Target User',
        notes: '',
      }],
      UserInvitation: [{ id: 'invite-1', email: targetEmail, status: 'pending' }],
      ScheduledSms: [{ id: 'sms-1', nurse_email: targetEmail, status: 'pending' }],
      ScheduledFax: [{ id: 'fax-1', created_by: targetEmail, status: 'pending' }],
      ScheduledSignatureReminder: [{
        id: 'reminder-1',
        requested_by: targetEmail,
        status: 'pending',
      }],
    },
  });
  const result = await invokeRuntime(runtime.handler, {
    action: 'offboard',
    user_id: 'target-1',
    reason: 'Employment ended',
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.json.complete, true);
  assert.equal(result.json.results.failures, 0);
  for (const field of [
    'patients_unassigned',
    'work_numbers_released',
    'on_call_shifts_cleared',
    'invitations_cancelled',
    'scheduled_sms_canceled',
    'scheduled_faxes_canceled',
    'signature_reminders_canceled',
  ]) {
    assert.equal(result.json.results[field], 1);
  }
  assert.equal(runtime.calls.sweepUpdates.length, 7);
  assert.deepEqual(runtime.state.sweeps.Patient[0].assigned_nurses, ['other@example.test']);
  assert.equal(runtime.state.sweeps.PhoneNumber[0].assigned_to_email, '');
  assert.equal(runtime.state.sweeps.OnCallShift[0].assigned_user_email, '');
  assert.equal(runtime.state.sweeps.UserInvitation[0].status, 'cancelled');
  assert.equal(runtime.state.sweeps.ScheduledSms[0].status, 'canceled');
  assert.equal(runtime.state.sweeps.ScheduledFax[0].status, 'cancelled');
  assert.equal(runtime.state.sweeps.ScheduledSignatureReminder[0].status, 'canceled');
});
