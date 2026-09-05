import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const functionUrl = new URL(
  '../functions/managePatientCareTeamAssignment/entry.ts',
  import.meta.url,
);
const entityUrl = new URL('../entities/PatientCareTeamAssignment.jsonc', import.meta.url);
const wrapperUrl = new URL('../../src/functions/managePatientCareTeamAssignment.js', import.meta.url);
const mergeUrl = new URL('../../src/components/patient/mergePatients.js', import.meta.url);
const srcRoot = fileURLToPath(new URL('../../src/', import.meta.url));

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const OWNER = {
  id: 'owner-1', email: 'Owner@Example.test', role: 'admin', is_active: true, is_verified: true,
};
const ADMIN = {
  id: 'admin-1', email: 'Admin@Agency.test', role: 'user', is_active: true, is_verified: true,
};
const MANAGER = {
  id: 'manager-1', email: 'Manager@Agency.test', role: 'user', is_active: true, is_verified: true,
};
const CLINICIAN = {
  id: 'clinician-1', email: 'Clinician@Agency.test', role: 'user', is_active: true, is_verified: true,
};
const TARGET = {
  id: 'target-1', email: 'Target@Example.test', role: 'user', is_active: true, is_verified: true,
};

const T1 = '2026-09-03T12:00:00.000Z';
const T2 = '2026-09-03T12:01:00.000Z';

const agency = (overrides = {}) => ({ id: 'agency-a', status: 'active', ...overrides });

const membership = (overrides = {}) => {
  const row = {
    id: 'membership-target',
    membership_key: 'agency-a:target-1',
    agency_id: 'agency-a',
    user_id: 'target-1',
    user_email_normalized: 'target@example.test',
    tenant_role: 'clinician',
    status: 'active',
    created_by_user_id: 'owner-1',
    activated_at: T1,
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: T1,
    last_transition_reason: 'Initial activation',
    version: 1,
    ...overrides,
  };
  if (row.status === 'revoked') {
    if (row.revoked_at === undefined) row.revoked_at = T2;
    if (row.revocation_reason === undefined) row.revocation_reason = 'Membership revoked';
  }
  return row;
};

const callerMembership = (caller, tenantRole, overrides = {}) => membership({
  id: `membership-${caller.id}`,
  membership_key: `agency-a:${caller.id}`,
  user_id: caller.id,
  user_email_normalized: caller.email.toLowerCase(),
  tenant_role: tenantRole,
  ...overrides,
});

const patient = (overrides = {}) => ({
  id: 'patient-a',
  agency_id: 'agency-a',
  created_by_user_id: 'creator-1',
  created_by_user_email_normalized: 'creator@example.test',
  created_by: 'creator@example.test',
  client_request_id: 'patient-request-1',
  patient_creation_key: 'agency-a:creator-1:patient-request-1',
  is_sample: false,
  is_archived: false,
  status: 'active',
  updated_date: T1,
  ...overrides,
});

const assignment = (overrides = {}) => {
  const row = {
    id: 'assignment-1',
    assignment_key: 'agency-a:patient-a:target-1',
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    user_id: 'target-1',
    user_email_normalized: 'target@example.test',
    assignee_membership_id: 'membership-target',
    assignee_membership_version_at_enablement: 1,
    status: 'active',
    source: 'manual',
    created_by_user_id: 'owner-1',
    created_by_user_email_normalized: 'owner@example.test',
    activated_at: T1,
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: T1,
    last_transition_reason: 'Initial assignment',
    last_transition_action: 'grant',
    last_transition_request_id: 'assignment-request-1',
    last_transition_request_key: 'agency-a:patient-a:target-1:assignment-request-1',
    version: 1,
    ...overrides,
  };
  if (row.status === 'suspended' && row.suspended_at === undefined) row.suspended_at = T2;
  if (row.status === 'revoked') {
    if (row.revoked_at === undefined) row.revoked_at = T2;
    if (row.revocation_reason === undefined) row.revocation_reason = 'Assignment revoked';
  }
  return row;
};

async function loadHandler({
  caller = OWNER,
  users = [OWNER, ADMIN, MANAGER, CLINICIAN, TARGET],
  agencies = [agency()],
  memberships = [membership()],
  patients = [patient()],
  assignments = [],
  superAdminEmail = 'owner@example.test',
  ignoreFilters = false,
  nonArrayEntity = null,
  createDuplicate = false,
  mutateCreated = null,
  updateNoop = false,
  updateReportsSuccessWithoutWrite = false,
  updateHasMore = false,
  mutateBeforeAtomicUpdate = null,
  mutateAuthorityOnRecheck = false,
  mutateTargetOnRecheck = false,
  mutatePatientOnRecheck = false,
  enableMutations = true,
} = {}) {
  let source = await readFile(functionUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__careTeamAssignmentMakeClient;',
  );
  if (enableMutations) {
    source = source.replace(
      'const CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false;',
      'const CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = true;',
    );
  }
  const temporaryModule = join(
    tmpdir(),
    `care_team_assignment_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const state = {
    users: users.map((row) => ({ ...row })),
    agencies: agencies.map((row) => ({ ...row })),
    memberships: memberships.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
    assignments: assignments.map((row) => ({ ...row })),
  };
  const calls = { auth: 0, filters: [], creates: [], updates: [] };
  const reads = { authority: 0, target: 0, patient: 0 };

  const filtered = (entity, rows, query, limit) => {
    calls.filters.push({ entity, query: { ...(query || {}) }, limit });
    if (nonArrayEntity === entity) return null;
    const result = ignoreFilters
      ? rows
      : rows.filter((row) => Object.entries(query || {}).every(
        ([key, value]) => row?.[key] === value,
      ));
    return Number.isFinite(limit) ? result.slice(0, limit) : result;
  };

  const matchesQueryField = (row, field, expected) => {
    if (
      expected
      && typeof expected === 'object'
      && !Array.isArray(expected)
      && Object.hasOwn(expected, '$exists')
    ) {
      return Object.hasOwn(row, field) === expected.$exists;
    }
    return row?.[field] === expected;
  };

  const membershipFilter = async (query, sort, limit) => {
    if (query?.user_id === 'admin-1') {
      reads.authority += 1;
      if (mutateAuthorityOnRecheck && reads.authority === 2) {
        const index = state.memberships.findIndex((row) => row.user_id === 'admin-1');
        state.memberships[index] = membership({
          ...state.memberships[index], status: 'revoked', version: 2,
          revoked_at: T2, revocation_reason: 'Concurrent revocation',
          last_transition_at: T2, last_transition_reason: 'Concurrent revocation',
        });
      }
    }
    if (query?.user_id === 'target-1') {
      reads.target += 1;
      if (mutateTargetOnRecheck && reads.target === 2) {
        const index = state.memberships.findIndex((row) => row.user_id === 'target-1');
        state.memberships[index] = membership({
          ...state.memberships[index], version: 2,
          last_transition_at: T2, last_transition_reason: 'Concurrent target change',
        });
      }
    }
    return filtered('AgencyMembership', state.memberships, query, limit);
  };

  const client = {
    auth: {
      me: async () => {
        calls.auth += 1;
        if (caller instanceof Error) throw caller;
        return caller;
      },
    },
    asServiceRole: {
      entities: {
        User: {
          filter: async (query, sort, limit) => filtered('User', state.users, query, limit),
        },
        Agency: {
          filter: async (query, sort, limit) => filtered('Agency', state.agencies, query, limit),
        },
        AgencyMembership: { filter: membershipFilter },
        Patient: {
          filter: async (query, sort, limit) => {
            reads.patient += 1;
            if (mutatePatientOnRecheck && reads.patient === 2) {
              state.patients[0] = { ...state.patients[0], updated_date: T2 };
            }
            return filtered('Patient', state.patients, query, limit);
          },
        },
        PatientCareTeamAssignment: {
          filter: async (query, sort, limit) => (
            filtered('PatientCareTeamAssignment', state.assignments, query, limit)
          ),
          create: async (payload) => {
            calls.creates.push({ ...payload });
            const row = {
              id: `assignment-${state.assignments.length + 1}`,
              ...payload,
              ...(mutateCreated || {}),
            };
            state.assignments.push(row);
            if (createDuplicate) {
              state.assignments.push({ ...row, id: `${row.id}-duplicate` });
            }
            return row;
          },
          updateMany: async (query, operations) => {
            calls.updates.push({
              query: structuredClone(query),
              operations: structuredClone(operations),
            });
            if (mutateBeforeAtomicUpdate) {
              const index = state.assignments.findIndex(
                (row) => row.id === mutateBeforeAtomicUpdate.id,
              );
              if (index !== -1) {
                state.assignments[index] = {
                  ...state.assignments[index],
                  ...mutateBeforeAtomicUpdate,
                };
              }
            }
            const indexes = state.assignments
              .map((row, index) => ({ row, index }))
              .filter(({ row }) => Object.entries(query).every(
                ([field, value]) => matchesQueryField(row, field, value),
              ))
              .map(({ index }) => index);
            if (!updateNoop && !updateReportsSuccessWithoutWrite) {
              for (const index of indexes) {
                const increments = Object.fromEntries(
                  Object.entries(operations.$inc || {}).map(
                    ([field, amount]) => [field, state.assignments[index][field] + amount],
                  ),
                );
                state.assignments[index] = {
                  ...state.assignments[index],
                  ...(operations.$set || {}),
                  ...increments,
                };
              }
            }
            return {
              success: true,
              updated: updateNoop ? 0 : indexes.length,
              has_more: updateHasMore,
            };
          },
        },
      },
    },
  };

  let handler;
  globalThis.__careTeamAssignmentMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__careTeamAssignmentMakeClient;
  }
  assert.equal(typeof handler, 'function');
  return { handler, state, calls };
}

const inspectBody = (overrides = {}) => ({
  action: 'inspect',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  target_user_id: 'target-1',
  ...overrides,
});

const grantBody = (overrides = {}) => ({
  action: 'grant',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  target_user_id: 'target-1',
  client_request_id: 'grant-request-1',
  reason: 'Assign for this episode',
  ...overrides,
});

const transitionBody = (action, expectedVersion, overrides = {}) => ({
  action,
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  target_user_id: 'target-1',
  client_request_id: `${action}-request-${expectedVersion}`,
  expected_version: expectedVersion,
  reason: `${action} assignment`,
  ...overrides,
});

async function invoke(handler, body = grantBody(), { method = 'POST', invalidJson = false } = {}) {
  const response = await handler(new Request('http://local/managePatientCareTeamAssignment', {
    method,
    headers: { 'content-type': 'application/json' },
    body: invalidJson ? '{' : JSON.stringify(body),
  }));
  return { response, json: await response.json() };
}

test('PatientCareTeamAssignment is service-owned, fully versioned, and merge-blocking', async () => {
  const schema = JSON5.parse(await readFile(entityUrl, 'utf8'));
  assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
  for (const field of [
    'assignment_key', 'agency_id', 'patient_id', 'user_id',
    'user_email_normalized', 'assignee_membership_id',
    'assignee_membership_version_at_enablement', 'status', 'source',
    'created_by_user_id', 'created_by_user_email_normalized', 'activated_at',
    'last_transition_by_user_id', 'last_transition_by_email_normalized',
    'last_transition_at', 'last_transition_reason', 'last_transition_action',
    'last_transition_request_id',
    'last_transition_request_key', 'version',
  ]) assert.equal(schema.required.includes(field), true, field);

  const mergeSource = await readFile(mergeUrl, 'utf8');
  assert.match(mergeSource, /SERVER_MERGE_REQUIRED_ENTITIES[\s\S]*PatientCareTeamAssignment/);
  assert.match(mergeSource, /PATIENT_MERGES_PAUSED\s*=\s*true/);
});

test('the client boundary is unwired and invokes only the finite broker', async () => {
  const source = await readFile(wrapperUrl, 'utf8');
  assert.match(source, /functions\.invoke\('managePatientCareTeamAssignment', payload\)/);
  assert.doesNotMatch(source, /\.entities\.|auth\.updateMe|assigned_nurses|ProviderPatientAssignment/);

  const backend = await readFile(functionUrl, 'utf8');
  assert.match(backend, /npm:@base44\/sdk@0\.8\.46/);
  assert.match(backend, /const CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false;/);
  assert.match(backend, /PatientCareTeamAssignment\.updateMany\(/);
  assert.doesNotMatch(backend, /PatientCareTeamAssignment\.update\(/);
  assert.doesNotMatch(backend, /Deno\.env\.get\([^)]*CARE_TEAM/);
  assert.doesNotMatch(
    backend,
    /entities\.ProviderPatientAssignment|(?:row|input|patient)\??\.assigned_nurses/,
  );
  assert.doesNotMatch(backend, /Deno\.serve\s*\(\s*async[\s\S]*console\.error\([^)]*(?:error|body|input)/);

  const allowed = new Set([
    fileURLToPath(wrapperUrl),
    fileURLToPath(new URL('../../src/functions/managePatientCareTeamAssignment.spec.js', import.meta.url)),
  ]);
  const unexpectedCallsites = [];
  for (const path of await listSourceFiles(srcRoot)) {
    if (allowed.has(path)) continue;
    if ((await readFile(path, 'utf8')).includes('managePatientCareTeamAssignment')) {
      unexpectedCallsites.push(path);
    }
  }
  assert.deepEqual(unexpectedCallsites, []);
});

test('assignment mutations are hard-paused before authentication or privileged access', async () => {
  for (const body of [
    grantBody(),
    transitionBody('activate', 1),
    transitionBody('suspend', 1),
    transitionBody('revoke', 1),
  ]) {
    const runtime = await loadHandler({ enableMutations: false });
    const result = await invoke(runtime.handler, body);

    assert.equal(result.response.status, 503);
    assert.equal(result.json.code, 'care_team_assignment_mutations_paused');
    assert.equal(runtime.calls.auth, 0);
    assert.equal(runtime.calls.filters.length, 0);
    assert.equal(runtime.calls.creates.length, 0);
    assert.equal(runtime.calls.updates.length, 0);
  }
});

test('anonymous, disabled, and malformed callers fail before privileged reads or writes', async () => {
  for (const [caller, body, options, status] of [
    [new Error('login required'), grantBody(), {}, 401],
    [{ ...OWNER, is_active: false }, grantBody(), {}, 403],
    [{ ...OWNER, disabled: true }, grantBody(), {}, 403],
    [{ ...OWNER, is_service: true }, grantBody(), {}, 403],
    [{ ...OWNER, is_verified: false }, grantBody(), {}, 403],
    [OWNER, grantBody(), { invalidJson: true }, 400],
    [OWNER, grantBody({ agency_id: { $ne: null } }), {}, 400],
    [OWNER, grantBody({ patient_id: ' patient-a' }), {}, 400],
    [OWNER, grantBody({ status: 'active' }), {}, 400],
    [OWNER, grantBody({ reason: '' }), {}, 400],
    [OWNER, grantBody(), { method: 'PUT' }, 405],
  ]) {
    const runtime = await loadHandler({ caller });
    const result = await invoke(runtime.handler, body, options);
    assert.equal(result.response.status, status);
    assert.equal(runtime.calls.filters.length, 0);
    assert.equal(runtime.calls.creates.length, 0);
    assert.equal(runtime.calls.updates.length, 0);
  }
});

test('the exact protected owner grants one immutable User-id assignment with PHI-safe output', async () => {
  const runtime = await loadHandler();
  const result = await invoke(runtime.handler);

  assert.equal(result.response.status, 201);
  assert.equal(result.json.success, true);
  assert.equal(result.json.idempotent, false);
  assert.deepEqual(runtime.calls.creates[0], {
    assignment_key: 'agency-a:patient-a:target-1',
    agency_id: 'agency-a',
    patient_id: 'patient-a',
    user_id: 'target-1',
    user_email_normalized: 'target@example.test',
    assignee_membership_id: 'membership-target',
    assignee_membership_version_at_enablement: 1,
    status: 'active',
    source: 'manual',
    created_by_user_id: 'owner-1',
    created_by_user_email_normalized: 'owner@example.test',
    activated_at: result.json.assignment.activated_at,
    version: 1,
    last_transition_by_user_id: 'owner-1',
    last_transition_by_email_normalized: 'owner@example.test',
    last_transition_at: result.json.assignment.last_transition_at,
    last_transition_reason: 'Assign for this episode',
    last_transition_action: 'grant',
    last_transition_request_id: 'grant-request-1',
    last_transition_request_key: 'agency-a:patient-a:target-1:grant-request-1',
  });
  assert.deepEqual(Object.keys(result.json.assignment).sort(), [
    'activated_at', 'agency_id', 'id', 'last_transition_at', 'patient_id',
    'revoked_at', 'status', 'suspended_at', 'user_id', 'version',
  ]);
  assert.equal(JSON.stringify(result.json).includes('example.test'), false);
  assert.equal(JSON.stringify(result.json).includes('Assign for this episode'), false);
});

test('only the owner or an exact active agency manager can manage an assignment', async () => {
  for (const [caller, tenantRole, expectedStatus] of [
    [ADMIN, 'agency_admin', 201],
    [MANAGER, 'manager', 201],
    [CLINICIAN, 'clinician', 403],
  ]) {
    const runtime = await loadHandler({
      caller,
      memberships: [callerMembership(caller, tenantRole), membership()],
    });
    const result = await invoke(runtime.handler);
    assert.equal(result.response.status, expectedStatus);
    assert.equal(runtime.calls.creates.length, expectedStatus === 201 ? 1 : 0);
  }

  for (const superAdminEmail of ['', 'someone-else@example.test']) {
    const runtime = await loadHandler({ superAdminEmail });
    const result = await invoke(runtime.handler);
    assert.equal(result.response.status, 403);
    assert.equal(runtime.calls.creates.length, 0);
  }

  const claimOnly = await loadHandler({
    caller: { ...CLINICIAN, account_type: 'super_admin', agency_id: 'agency-a' },
    memberships: [membership()],
  });
  assert.equal((await invoke(claimOnly.handler)).response.status, 403);
});

test('grant and activation require exact current Agency, Patient, User, and membership authority', async () => {
  const cases = [
    { agencies: [agency({ status: 'suspended' })] },
    { agencies: [agency({ id: 'agency-b' })] },
    { patients: [] },
    { patients: [patient({ agency_id: 'agency-b' })] },
    { patients: [patient({ is_archived: true })] },
    { patients: [patient({ created_by_user_id: null })] },
    { patients: [patient({ patient_creation_key: 'forged' })] },
    { users: [OWNER, { ...TARGET, is_active: false }] },
    { memberships: [] },
    { memberships: [membership({ status: 'suspended' })] },
    { memberships: [membership({ user_email_normalized: 'old@example.test' })] },
    { memberships: [membership(), membership({ id: 'duplicate-membership' })] },
  ];
  for (const options of cases) {
    const runtime = await loadHandler(options);
    const result = await invoke(runtime.handler);
    assert.notEqual(result.response.status, 201);
    assert.equal(runtime.calls.creates.length, 0);
  }

  const foreignRows = await loadHandler({
    ignoreFilters: true,
    users: [{ id: 'foreign-user', email: 'foreign@example.test' }, OWNER, TARGET],
  });
  assert.equal((await invoke(foreignRows.handler)).response.status, 409);
  assert.equal(foreignRows.calls.creates.length, 0);
});

test('inspect is read-only and rejects mutation-only fields', async () => {
  const runtime = await loadHandler({ assignments: [assignment()] });
  const result = await invoke(runtime.handler, inspectBody());
  assert.equal(result.response.status, 200);
  assert.equal(result.json.action, 'inspect');
  assert.equal(result.json.assignment.id, 'assignment-1');
  assert.equal(runtime.calls.creates.length, 0);
  assert.equal(runtime.calls.updates.length, 0);

  for (const body of [
    inspectBody({ reason: 'not accepted' }),
    inspectBody({ expected_version: 1 }),
    inspectBody({ client_request_id: 'not accepted' }),
  ]) {
    const invalid = await loadHandler({ assignments: [assignment()] });
    assert.equal((await invoke(invalid.handler, body)).response.status, 400);
    assert.equal(invalid.calls.filters.length, 0);
  }

  const staleIdentity = await loadHandler({
    users: [OWNER, { ...TARGET, email: 'NewTarget@example.test' }],
    memberships: [membership({ user_email_normalized: 'newtarget@example.test', version: 2 })],
    assignments: [assignment()],
  });
  assert.equal((await invoke(staleIdentity.handler, inspectBody())).response.status, 409);
});

test('suspend, activate, and terminal revoke preserve one monotonic row', async () => {
  const runtime = await loadHandler({ assignments: [assignment()] });
  const suspended = await invoke(runtime.handler, transitionBody('suspend', 1));
  assert.equal(suspended.response.status, 200);
  assert.equal(suspended.json.assignment.status, 'suspended');
  assert.equal(suspended.json.assignment.version, 2);

  const activated = await invoke(runtime.handler, transitionBody('activate', 2));
  assert.equal(activated.response.status, 200);
  assert.equal(activated.json.assignment.status, 'active');
  assert.equal(activated.json.assignment.version, 3);

  const revoked = await invoke(runtime.handler, transitionBody('revoke', 3));
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.json.assignment.status, 'revoked');
  assert.equal(revoked.json.assignment.version, 4);
  assert.equal(runtime.state.assignments.length, 1);
  assert.equal(runtime.calls.updates.length, 3);
  assert.deepEqual(runtime.calls.updates.map(({ query }) => ({
    id: query.id,
    status: query.status,
    version: query.version,
  })), [
    { id: 'assignment-1', status: 'active', version: 1 },
    { id: 'assignment-1', status: 'suspended', version: 2 },
    { id: 'assignment-1', status: 'active', version: 3 },
  ]);
  assert.equal(runtime.calls.updates.every(
    ({ operations }) => operations.$inc.version === 1 && operations.$set.version === undefined,
  ), true);

  const cannotActivate = await invoke(runtime.handler, transitionBody('activate', 4));
  assert.equal(cannotActivate.response.status, 409);
  assert.equal(runtime.calls.updates.length, 3);
});

test('exact retries are idempotent while stale and exhausted versions fail closed', async () => {
  const replayRow = assignment({
    status: 'suspended', version: 2, suspended_at: T2,
    last_transition_reason: 'suspend assignment',
    last_transition_action: 'suspend',
    last_transition_request_id: 'suspend-request-1',
    last_transition_request_key: 'agency-a:patient-a:target-1:suspend-request-1',
  });
  const replay = await loadHandler({ assignments: [replayRow] });
  const replayResult = await invoke(replay.handler, transitionBody('suspend', 1));
  assert.equal(replayResult.response.status, 200);
  assert.equal(replayResult.json.idempotent, true);
  assert.equal(replay.calls.updates.length, 0);

  const wrongReplayVersion = await loadHandler({ assignments: [replayRow] });
  const wrongReplayResult = await invoke(
    wrongReplayVersion.handler,
    transitionBody('suspend', 99, { client_request_id: 'suspend-request-1' }),
  );
  assert.equal(wrongReplayResult.response.status, 409);
  assert.equal(wrongReplayVersion.calls.updates.length, 0);

  const stale = await loadHandler({ assignments: [assignment()] });
  assert.equal((await invoke(stale.handler, transitionBody('suspend', 99))).response.status, 409);
  assert.equal(stale.calls.updates.length, 0);

  const exhausted = await loadHandler({
    assignments: [assignment({ version: Number.MAX_SAFE_INTEGER })],
  });
  const exhaustedResult = await invoke(
    exhausted.handler,
    transitionBody('suspend', Number.MAX_SAFE_INTEGER),
  );
  assert.equal(exhaustedResult.response.status, 409);
  assert.equal(exhausted.calls.updates.length, 0);

  const sameState = await loadHandler({ assignments: [assignment()] });
  const sameStateResult = await invoke(
    sameState.handler,
    transitionBody('activate', 1, { client_request_id: 'different-request' }),
  );
  assert.equal(sameStateResult.response.status, 409);
  assert.equal(sameState.calls.updates.length, 0);

  const crossAction = await loadHandler({
    assignments: [assignment({
      last_transition_request_id: 'shared-request',
      last_transition_request_key: 'agency-a:patient-a:target-1:shared-request',
      last_transition_reason: 'Shared reason',
    })],
  });
  const crossActionResult = await invoke(crossAction.handler, transitionBody('activate', 1, {
    client_request_id: 'shared-request',
    reason: 'Shared reason',
  }));
  assert.equal(crossActionResult.response.status, 409);
  assert.equal(crossAction.calls.updates.length, 0);

  const otherActor = await loadHandler({
    caller: ADMIN,
    memberships: [callerMembership(ADMIN, 'agency_admin'), membership()],
    assignments: [replayRow],
  });
  const otherActorResult = await invoke(
    otherActor.handler,
    transitionBody('suspend', 1),
  );
  assert.equal(otherActorResult.response.status, 409);
  assert.equal(otherActor.calls.updates.length, 0);
});

test('conditional transition CAS cannot overwrite a concurrent terminal revocation', async () => {
  const runtime = await loadHandler({
    assignments: [assignment()],
    mutateBeforeAtomicUpdate: {
      id: 'assignment-1',
      status: 'revoked',
      version: 2,
      revoked_at: T2,
      revocation_reason: 'Concurrent terminal revocation',
      last_transition_request_id: 'concurrent-revoke',
      last_transition_request_key: 'agency-a:patient-a:target-1:concurrent-revoke',
      last_transition_reason: 'Concurrent terminal revocation',
      last_transition_action: 'revoke',
      last_transition_at: T2,
    },
  });
  const result = await invoke(runtime.handler, transitionBody('suspend', 1));

  assert.equal(result.response.status, 409);
  assert.equal(runtime.calls.updates.length, 1);
  assert.equal(runtime.state.assignments[0].status, 'revoked');
  assert.equal(runtime.state.assignments[0].version, 2);

  const bindingChange = await loadHandler({
    assignments: [assignment()],
    mutateBeforeAtomicUpdate: {
      id: 'assignment-1',
      assignee_membership_id: 'replacement-membership',
      assignee_membership_version_at_enablement: 2,
    },
  });
  const bindingResult = await invoke(
    bindingChange.handler,
    transitionBody('suspend', 1),
  );
  assert.equal(bindingResult.response.status, 409);
  assert.equal(bindingChange.state.assignments[0].status, 'active');
  assert.equal(
    bindingChange.state.assignments[0].assignee_membership_id,
    'replacement-membership',
  );
});

test('duplicates, corruption, provider anomalies, and false commits cannot return success', async () => {
  for (const rows of [
    [assignment(), assignment({ id: 'assignment-duplicate' })],
    [assignment({ assignment_key: 'forged' })],
    [assignment({ assignee_membership_id: 'other-membership' })],
    [assignment({ version: 1.5 })],
    Array.from({ length: 10 }, (_, index) => assignment({ id: `assignment-${index}` })),
  ]) {
    const runtime = await loadHandler({ assignments: rows });
    const result = await invoke(runtime.handler, inspectBody());
    assert.ok([404, 409].includes(result.response.status));
  }

  const duplicate = await loadHandler({ createDuplicate: true });
  assert.equal((await invoke(duplicate.handler)).response.status, 409);
  assert.equal(duplicate.calls.creates.length, 1);

  const mutated = await loadHandler({ mutateCreated: { created_by_user_id: 'other-actor' } });
  assert.equal((await invoke(mutated.handler)).response.status, 409);

  const polluted = await loadHandler({ mutateCreated: { revoked_at: T2 } });
  assert.equal((await invoke(polluted.handler)).response.status, 409);

  const noop = await loadHandler({ assignments: [assignment()], updateNoop: true });
  assert.equal((await invoke(noop.handler, transitionBody('suspend', 1))).response.status, 409);
  assert.equal(noop.calls.updates.length, 1);

  const falseSuccess = await loadHandler({
    assignments: [assignment()],
    updateReportsSuccessWithoutWrite: true,
  });
  assert.equal(
    (await invoke(falseSuccess.handler, transitionBody('suspend', 1))).response.status,
    409,
  );
  assert.equal(falseSuccess.state.assignments[0].status, 'active');

  const hasMore = await loadHandler({ assignments: [assignment()], updateHasMore: true });
  assert.equal(
    (await invoke(hasMore.handler, transitionBody('suspend', 1))).response.status,
    409,
  );

  const originalError = console.error;
  console.error = () => {};
  try {
    for (const nonArrayEntity of [
      'User', 'Agency', 'AgencyMembership', 'Patient', 'PatientCareTeamAssignment',
    ]) {
      const runtime = await loadHandler({ nonArrayEntity });
      assert.equal((await invoke(runtime.handler)).response.status, 500);
      assert.equal(runtime.calls.creates.length, 0);
    }
  } finally {
    console.error = originalError;
  }
});

test('caller, target, and Patient authority changes block mutation before the first write', async () => {
  for (const option of [
    'mutateAuthorityOnRecheck', 'mutateTargetOnRecheck', 'mutatePatientOnRecheck',
  ]) {
    const runtime = await loadHandler({
      caller: option === 'mutateAuthorityOnRecheck' ? ADMIN : OWNER,
      memberships: option === 'mutateAuthorityOnRecheck'
        ? [callerMembership(ADMIN, 'agency_admin'), membership()]
        : [membership()],
      [option]: true,
    });
    const result = await invoke(runtime.handler);
    assert.ok([403, 409].includes(result.response.status));
    assert.equal(runtime.calls.creates.length, 0);
    assert.equal(runtime.calls.updates.length, 0);
  }
});

test('restrictive transitions preserve identity evidence after assignee deletion', async () => {
  const runtime = await loadHandler({
    agencies: [agency({ status: 'cancelled' })],
    users: [OWNER],
    memberships: [],
    patients: [],
    assignments: [assignment({ user_email_normalized: 'old@example.test' })],
  });
  const result = await invoke(runtime.handler, transitionBody('revoke', 1));
  assert.equal(result.response.status, 200);
  assert.equal(result.json.assignment.status, 'revoked');
  assert.equal(runtime.state.assignments[0].user_email_normalized, 'old@example.test');
  assert.equal(runtime.calls.filters.some(({ entity }) => entity === 'User'), false);
  assert.equal(runtime.calls.filters.some(({ entity }) => entity === 'Patient'), false);
});

test('an agency manager cannot restrict the protected owner from stored evidence', async () => {
  const protectedAssignment = assignment({
    user_id: 'owner-1',
    user_email_normalized: 'owner@example.test',
    assignment_key: 'agency-a:patient-a:owner-1',
    last_transition_request_key: 'agency-a:patient-a:owner-1:assignment-request-1',
  });
  const runtime = await loadHandler({
    caller: MANAGER,
    memberships: [callerMembership(MANAGER, 'manager')],
    assignments: [protectedAssignment],
  });
  const result = await invoke(runtime.handler, transitionBody('revoke', 1, {
    target_user_id: 'owner-1',
  }));

  assert.equal(result.response.status, 403);
  assert.equal(runtime.calls.updates.length, 0);
});
