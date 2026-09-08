import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import {
  LIVE_READINESS_FIXTURE_AGENCIES,
  LIVE_READINESS_FIXTURE_ACTORS,
  LIVE_READINESS_FIXTURE_SET_ID,
  LIVE_READINESS_STAGING_TARGET,
} from '../../src/lib/liveReadinessFixtureManifest.js';

const functionUrl = new URL('../functions/preflightStagingReadinessFixture/entry.ts', import.meta.url);
const entityUrl = new URL('../entities/StagingReadinessFixture.jsonc', import.meta.url);

const STAGING_APP_ID = LIVE_READINESS_STAGING_TARGET.app_id;
const STAGING_ORIGIN = LIVE_READINESS_STAGING_TARGET.origin;
const FIXTURE_SET_ID = LIVE_READINESS_FIXTURE_SET_ID;
const RELEASE_SENTINEL = `${STAGING_APP_ID}:${FIXTURE_SET_ID}:read-only-v1`;
const USER_BEARER = 'Bearer fixture-user-token';
const SERVICE_BEARER = 'Bearer fixture-service-token';
const ACTOR_KEYS = Object.keys(LIVE_READINESS_FIXTURE_ACTORS)
  .filter((actorKey) => actorKey !== 'platform_owner');
const AGENCY_CODES = Object.fromEntries(Object.entries(LIVE_READINESS_FIXTURE_AGENCIES)
  .map(([agencyKey, agency]) => [agencyKey, agency.agency_code]));

const OWNER = {
  id: 'owner-1',
  email: 'owner@example.test',
  role: 'admin',
  is_active: true,
  disabled: false,
  is_service: false,
  is_verified: true,
};

const ACTORS = {
  admin_a: { user_id: 'user-admin-a', email: 'admin-a@example.test' },
  clinician_a: { user_id: 'user-clinician-a', email: 'clinician-a@example.test' },
  clinician_a_empty: {
    user_id: 'user-clinician-a-empty',
    email: 'clinician-a-empty@example.test',
  },
  admin_b: { user_id: 'user-admin-b', email: 'admin-b@example.test' },
};

const requestBody = () => ({
  fixture_set_id: FIXTURE_SET_ID,
  target: {
    environment: 'staging',
    app_id: STAGING_APP_ID,
    origin: STAGING_ORIGIN,
  },
  actors: structuredClone(ACTORS),
});

const userRows = () => Object.values(ACTORS).map((actor) => ({
  id: actor.user_id,
  email: actor.email,
  role: 'user',
  is_active: true,
  is_verified: true,
  disabled: false,
  is_service: false,
  is_approved: true,
}));

function matches(row, query) {
  return Object.entries(query || {}).every(([key, expected]) => row?.[key] === expected);
}

function project(row, fields) {
  if (!Array.isArray(fields)) return structuredClone(row);
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(row, field))
    .map((field) => [field, structuredClone(row[field])]));
}

async function loadHandler({
  callers = [OWNER, OWNER, OWNER],
  users = userRows(),
  agencies = [],
  memberships = [],
  patients = [],
  assignments = [],
  fixtures = [],
  release = RELEASE_SENTINEL,
  appPublicUrl = STAGING_ORIGIN,
  superAdminEmail = OWNER.email,
  ignoreFilters = new Set(),
  nonArrayEntity = null,
  mutateRows = null,
} = {}) {
  let source = await readFile(functionUrl, 'utf8');
  const globalName = `__stagingPreflightClient_${Math.random().toString(36).slice(2)}`;
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = globalThis.${globalName};`,
  );
  const temporaryModule = join(
    tmpdir(),
    `staging_preflight_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const state = {
    User: structuredClone(users),
    Agency: structuredClone(agencies),
    AgencyMembership: structuredClone(memberships),
    Patient: structuredClone(patients),
    PatientCareTeamAssignment: structuredClone(assignments),
    StagingReadinessFixture: structuredClone(fixtures),
  };
  const runtime = { appPublicUrl };
  const calls = {
    clientConstructions: 0,
    clientRequests: [],
    auth: 0,
    filters: [],
  };
  const handlerFor = (entity) => ({
    filter: async (query, sort, limit, skip, fields) => {
      const entityCall = calls.filters.filter((call) => call.entity === entity).length + 1;
      calls.filters.push({
        entity,
        query: structuredClone(query),
        sort,
        limit,
        skip,
        fields: structuredClone(fields),
      });
      if (nonArrayEntity === entity) return null;
      if (mutateRows) mutateRows({ entity, entityCall, state, runtime, callers });
      const rows = ignoreFilters.has(entity)
        ? state[entity]
        : state[entity].filter((row) => matches(row, query));
      return rows.slice(0, limit).map((row) => project(row, fields));
    },
  });
  const client = {
    auth: {
      me: async () => {
        const value = callers[Math.min(calls.auth, callers.length - 1)];
        calls.auth += 1;
        if (value instanceof Error) throw value;
        return value;
      },
    },
    asServiceRole: {
      entities: Object.fromEntries(Object.keys(state).map((entity) => [entity, handlerFor(entity)])),
    },
  };

  let handler;
  globalThis[globalName] = (request) => {
    calls.clientConstructions += 1;
    calls.clientRequests.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
    });
    if (
      request.headers.get('Authorization') !== USER_BEARER
      || request.headers.get('Base44-Service-Authorization') !== SERVICE_BEARER
    ) {
      throw new Error('Pinned SDK request did not preserve required authentication headers');
    }
    return client;
  };
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (name) => ({
        STAGING_READINESS_PREFLIGHT_RELEASE: release,
        APP_PUBLIC_URL: runtime.appPublicUrl,
        SUPER_ADMIN_EMAIL: superAdminEmail,
      })[name],
    },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis[globalName];
  }
  assert.equal(typeof handler, 'function');
  return { handler, calls, state, runtime };
}

async function invoke(handler, body = requestBody(), {
  method = 'POST',
  appId = STAGING_APP_ID,
  raw = null,
  contentLength = null,
  apiUrl = null,
  dataEnvironment = null,
  state = null,
  functionsVersion = null,
} = {}) {
  const headers = {
    'content-type': 'application/json',
    Authorization: USER_BEARER,
    'Base44-App-Id': appId,
    'Base44-Service-Authorization': SERVICE_BEARER,
  };
  if (apiUrl !== null) headers['Base44-Api-Url'] = apiUrl;
  if (dataEnvironment !== null) headers['X-Data-Env'] = dataEnvironment;
  if (state !== null) headers['Base44-State'] = state;
  if (functionsVersion !== null) headers['Base44-Functions-Version'] = functionsVersion;
  const encoded = raw ?? JSON.stringify(body);
  if (contentLength !== null) headers['content-length'] = contentLength;
  const response = await handler(new Request('https://function.invalid/preflight', {
    method,
    headers,
    ...(method === 'POST' ? { body: encoded } : {}),
  }));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  return { response, json: await response.json() };
}

test('fixture registry stays service-owned with exact canonical identity shapes', async () => {
  const schema = JSON5.parse(await readFile(entityUrl, 'utf8'));
  assert.equal(schema.name, 'StagingReadinessFixture');
  assert.deepEqual(schema.rls, {
    create: false,
    read: false,
    update: false,
    delete: false,
  });
  for (const field of [
    'fixture_set_id',
    'environment',
    'app_id',
    'origin',
    'status',
    'actor_user_ids',
    'agency_ids',
    'patient_ids',
    'assignment_ids',
    'version',
  ]) {
    assert.ok(schema.properties[field], field);
  }
  assert.deepEqual(Object.keys(schema.properties.actor_user_ids.properties), ACTOR_KEYS);
  assert.deepEqual(Object.keys(schema.properties.agency_ids.properties), ['agency_a', 'agency_b']);
  assert.deepEqual(Object.keys(schema.properties.patient_ids.properties), ['a1', 'a2', 'b1']);
  assert.equal(schema.properties.assignment_ids.items.type, 'string');
  assert.equal(schema.properties.assignment_ids.minItems, 1);
  assert.equal(schema.properties.assignment_ids.maxItems, 1);
  assert.equal(schema.properties.version.type, 'integer');
});

test('source is read-only, target-bound, body-bounded, and logs no error details', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /STAGING_READINESS_PREFLIGHT_RELEASE/);
  assert.match(source, /Base44-App-Id/);
  assert.match(source, /X-Data-Env/);
  assert.match(source, /createPinnedSdkRequest/);
  assert.match(source, /Deno\.env\.get\('APP_PUBLIC_URL'\)/);
  assert.match(source, /Deno\.env\.get\('SUPER_ADMIN_EMAIL'\)/);
  assert.match(source, /req\.body\?\.getReader\(\)/);
  assert.match(source, /'Cache-Control': 'no-store'/);
  assert.match(source, /console\.error\('preflightStagingReadinessFixture failed'\)/);
  assert.doesNotMatch(source, /console\.error\([^)]*,\s*error\b/);
  assert.doesNotMatch(
    source,
    /\.(?:create|update|delete|deleteMany|bulkCreate|updateMany|bulkUpdate|importEntities|updateMe|inviteUser|register|verifyOtp|resendOtp|resetPasswordRequest|resetPassword|changePassword)\s*\(/,
  );
  assert.doesNotMatch(source, /\bfetch\s*\(|functions\.invoke|\.integrations\b/);
  assert.doesNotMatch(
    source,
    /user\.(?:account_type|agency_id|agency_name|agency_role|is_manager|staff_role|care_scope)\b/,
  );
  assert.ok(
    source.indexOf("req.method !== 'POST'")
      < source.indexOf('createClientFromRequest(createPinnedSdkRequest(req))'),
  );
  assert.ok(
    source.indexOf('requireRuntimeTarget(req)')
      < source.indexOf('createClientFromRequest(createPinnedSdkRequest(req))'),
  );

  assert.ok(source.includes(`const FIXTURE_SET_ID = '${FIXTURE_SET_ID}';`));
  assert.ok(source.includes(`const STAGING_APP_ID = '${STAGING_APP_ID}';`));
  assert.ok(source.includes(`const STAGING_ORIGIN = '${STAGING_ORIGIN}';`));
  const actorDeclaration = source.match(/const ACTOR_KEYS = \[([^\]]+)\] as const;/);
  assert.ok(actorDeclaration);
  assert.deepEqual(
    [...actorDeclaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ACTOR_KEYS,
  );
  const agencyDeclaration = source.match(/const AGENCY_KEYS = \[([^\]]+)\] as const;/);
  assert.ok(agencyDeclaration);
  assert.deepEqual(
    [...agencyDeclaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    Object.keys(AGENCY_CODES),
  );
  for (const [agencyKey, agencyCode] of Object.entries(AGENCY_CODES)) {
    assert.ok(source.includes(`${agencyKey}: '${agencyCode}'`));
  }

  const finalInspection = source.indexOf('const finalSnapshot = await inspectPreflight');
  const terminalAuth = source.indexOf('const terminalCaller = await base44.auth.me()');
  const terminalTarget = source.indexOf('requireRuntimeTarget(req);', terminalAuth);
  const terminalOwner = source.indexOf('loadProtectedOwner(terminalCaller, owner);');
  const publicDisclosure = source.indexOf('return jsonResponse(publicResult(finalSnapshot));');
  assert.ok(finalInspection < terminalAuth);
  assert.ok(terminalAuth < terminalTarget);
  assert.ok(terminalTarget < terminalOwner);
  assert.ok(terminalOwner < publicDisclosure);
});

test('eligible pristine actors produce only role-keyed, non-identifying readiness output', async () => {
  const { handler, calls } = await loadHandler();
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.equal(json.status, 'point_in_time_read_only_preflight_passed');
  assert.equal(json.point_in_time_clear, true);
  assert.equal(Object.hasOwn(json, 'immutable_authority_clear'), false);
  assert.equal(json.inspection_completed, true);
  assert.equal(Object.hasOwn(json, 'success'), false);
  assert.equal(json.counts.eligible_actors, 4);
  assert.equal(json.counts.agency_code_collisions, 0);
  assert.equal(json.counts.collision_categories, 0);
  assert.equal(json.safeguards.data_mutations_performed, false);
  assert.equal(json.safeguards.outbound_actions_performed, false);
  assert.equal(json.safeguards.credential_values_exposed, false);
  assert.equal(json.safeguards.phi_values_exposed, false);
  assert.equal(json.safeguards.later_writes_authorized, false);
  assert.deepEqual(Object.keys(json.checks.actors), Object.keys(ACTORS));
  assert.deepEqual(json.checks.agency_code_collisions, {
    agency_a: false,
    agency_b: false,
  });
  for (const actor of Object.values(json.checks.actors)) {
    assert.deepEqual(actor, {
      user: 'eligible',
      membership_collision: false,
      patient_collision: false,
      assignment_collision: false,
    });
  }
  const serialized = JSON.stringify(json);
  assert.equal(serialized.includes(OWNER.id), false);
  assert.equal(serialized.includes(OWNER.email), false);
  for (const binding of Object.values(ACTORS)) {
    assert.equal(serialized.includes(binding.user_id), false);
    assert.equal(serialized.includes(binding.email), false);
  }
  for (const agencyCode of Object.values(AGENCY_CODES)) {
    assert.equal(serialized.includes(agencyCode), false);
  }

  assert.equal(calls.auth, 3);
  assert.equal(calls.filters.filter((call) => call.entity === 'Agency').length, 4);
  assert.equal(calls.filters.filter((call) => call.entity === 'User').length, 16);
  assert.equal(calls.filters.filter((call) => call.entity === 'AgencyMembership').length, 10);
  assert.equal(calls.filters.filter((call) => call.entity === 'Patient').length, 8);
  assert.equal(
    calls.filters.filter((call) => call.entity === 'PatientCareTeamAssignment').length,
    8,
  );
  assert.equal(calls.filters.filter((call) => call.entity === 'StagingReadinessFixture').length, 2);
  for (const [agencyKey, agencyCode] of Object.entries(AGENCY_CODES)) {
    const matchingCalls = calls.filters.filter((call) => (
      call.entity === 'Agency' && call.query.agency_code === agencyCode
    ));
    assert.equal(matchingCalls.length, 2, agencyKey);
    for (const call of matchingCalls) assert.deepEqual(call.fields, ['id', 'agency_code']);
  }
  for (const call of calls.filters) {
    assert.equal(call.limit, 2);
    assert.equal(call.skip, undefined);
    assert.ok(Array.isArray(call.fields) && call.fields.length > 0);
  }
});

test('canonical agency-code collisions block using only booleans and bounded counts', async () => {
  const agencies = [
    { id: 'existing-agency-a', agency_code: AGENCY_CODES.agency_a },
    { id: 'unrelated-agency', agency_code: 'UNRELATED' },
  ];
  const { handler } = await loadHandler({ agencies });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.equal(json.status, 'blocked');
  assert.equal(json.point_in_time_clear, false);
  assert.deepEqual(json.checks.agency_code_collisions, {
    agency_a: true,
    agency_b: false,
  });
  assert.equal(json.counts.agency_code_collisions, 1);
  assert.equal(json.counts.collision_categories, 1);
  assert.ok(json.limitations.includes('agency_code_checks_are_bounded_point_in_time_only'));
  assert.ok(json.limitations.includes('does_not_reserve_agency_codes_or_authorize_creation'));
  assert.equal(json.limitations.includes('does_not_prove_agency_key_collision_absence'), false);

  const serialized = JSON.stringify(json);
  for (const agency of agencies) {
    assert.equal(serialized.includes(agency.id), false);
    assert.equal(serialized.includes(agency.agency_code), false);
  }
});

test('agency-code provider ambiguity, malformed rows, and out-of-scope rows fail closed', async () => {
  const cases = [
    {
      agencies: [
        { id: 'agency-a-1', agency_code: AGENCY_CODES.agency_a },
        { id: 'agency-a-2', agency_code: AGENCY_CODES.agency_a },
      ],
    },
    {
      agencies: [{ id: '$malformed', agency_code: AGENCY_CODES.agency_a }],
    },
    {
      agencies: [{ id: 'foreign-agency', agency_code: 'FOREIGN' }],
      ignoreFilters: new Set(['Agency']),
    },
  ];

  for (const options of cases) {
    const { handler, calls } = await loadHandler(options);
    const { response, json } = await invoke(handler);
    assert.equal(response.status, 409);
    assert.equal(Object.hasOwn(json, 'inspection_completed'), false);
    assert.equal(Object.hasOwn(json, 'checks'), false);
    assert.equal(Object.hasOwn(json, 'counts'), false);
    assert.ok(calls.filters.filter((call) => call.entity === 'Agency').length <= 1);
    const serialized = JSON.stringify(json);
    for (const agency of options.agencies) {
      assert.equal(serialized.includes(agency.id), false);
      assert.equal(serialized.includes(agency.agency_code), false);
    }
  }
});

test('agency-code snapshot drift is blocked before any readiness disclosure', async () => {
  const { handler, calls } = await loadHandler({
    mutateRows: ({ entity, entityCall, state }) => {
      if (entity === 'Agency' && entityCall === 3) {
        state.Agency.push({ id: 'racing-agency-a', agency_code: AGENCY_CODES.agency_a });
      }
    },
  });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 409);
  assert.equal(calls.filters.filter((call) => call.entity === 'Agency').length, 4);
  assert.equal(Object.hasOwn(json, 'inspection_completed'), false);
  assert.equal(Object.hasOwn(json, 'checks'), false);
  assert.equal(JSON.stringify(json).includes('racing-agency-a'), false);
  assert.equal(JSON.stringify(json).includes(AGENCY_CODES.agency_a), false);
});

test('terminal owner and runtime target races fail after final inspection without disclosure', async () => {
  for (const ownerPatch of [
    { is_active: false },
    { email: 'changed-during-final-inspection@example.test' },
  ]) {
    const terminalOwner = { ...OWNER };
    const { handler, calls } = await loadHandler({
      callers: [OWNER, OWNER, terminalOwner],
      mutateRows: ({ entity, entityCall }) => {
        if (entity === 'Agency' && entityCall === 3) Object.assign(terminalOwner, ownerPatch);
      },
    });
    const { response, json } = await invoke(handler);

    assert.equal(response.status, 409);
    assert.equal(calls.auth, 3);
    assert.equal(calls.filters.filter((call) => call.entity === 'Agency').length, 4);
    assert.equal(calls.filters.filter((call) => (
      call.entity === 'StagingReadinessFixture'
    )).length, 2);
    assert.equal(Object.hasOwn(json, 'inspection_completed'), false);
    assert.equal(Object.hasOwn(json, 'checks'), false);
    assert.equal(Object.hasOwn(json, 'counts'), false);
    assert.equal(JSON.stringify(json).includes(terminalOwner.email), false);
  }

  const targetRace = await loadHandler({
    mutateRows: ({ entity, entityCall, runtime }) => {
      if (entity === 'Agency' && entityCall === 3) {
        runtime.appPublicUrl = 'https://caremetricai.base44.app/';
      }
    },
  });
  const targetResult = await invoke(targetRace.handler);
  assert.equal(targetResult.response.status, 503);
  assert.equal(targetRace.calls.auth, 3);
  assert.equal(targetRace.calls.filters.filter((call) => call.entity === 'Agency').length, 4);
  assert.equal(Object.hasOwn(targetResult.json, 'inspection_completed'), false);
  assert.equal(Object.hasOwn(targetResult.json, 'checks'), false);
});

test('missing, ineligible, and stale immutable-ID-linked rows block without disclosure', async () => {
  const users = userRows().filter((row) => row.id !== ACTORS.admin_b.user_id);
  const clinician = users.find((row) => row.id === ACTORS.clinician_a.user_id);
  clinician.disabled = true;
  const { handler } = await loadHandler({
    users,
    memberships: [{ id: 'membership-old', user_id: ACTORS.admin_a.user_id }],
    patients: [{ id: 'patient-old', created_by_user_id: ACTORS.clinician_a_empty.user_id }],
    assignments: [{ id: 'assignment-old', user_id: ACTORS.admin_b.user_id }],
    fixtures: [{
      id: 'fixture-old',
      fixture_set_id: FIXTURE_SET_ID,
      environment: 'staging',
      app_id: STAGING_APP_ID,
      origin: STAGING_ORIGIN,
      status: 'removed',
      version: 1,
    }],
  });
  const { response, json } = await invoke(handler);

  assert.equal(response.status, 200);
  assert.equal(json.status, 'blocked');
  assert.equal(json.point_in_time_clear, false);
  assert.equal(json.checks.fixture_registry, 'present');
  assert.equal(json.checks.actors.admin_a.membership_collision, true);
  assert.equal(json.checks.actors.clinician_a.user, 'ineligible');
  assert.equal(json.checks.actors.clinician_a_empty.patient_collision, true);
  assert.equal(json.checks.actors.admin_b.user, 'unavailable');
  assert.equal(json.checks.actors.admin_b.assignment_collision, true);
  assert.equal(json.counts.eligible_actors, 2);
  assert.equal(json.counts.collision_categories, 4);
  const serialized = JSON.stringify(json);
  for (const value of [
    OWNER.id,
    OWNER.email,
    'membership-old',
    'patient-old',
    'assignment-old',
    'fixture-old',
  ]) {
    assert.equal(serialized.includes(value), false);
  }
  for (const binding of Object.values(ACTORS)) {
    assert.equal(serialized.includes(binding.user_id), false);
    assert.equal(serialized.includes(binding.email), false);
  }

  const mismatchedUsers = userRows();
  mismatchedUsers[0].email = 'mismatched-actor@example.test';
  const mismatched = await loadHandler({ users: mismatchedUsers });
  const mismatchedResult = await invoke(mismatched.handler);
  assert.equal(mismatchedResult.response.status, 409);
  const mismatchSerialized = JSON.stringify(mismatchedResult.json);
  assert.equal(mismatchSerialized.includes(mismatchedUsers[0].id), false);
  assert.equal(mismatchSerialized.includes(mismatchedUsers[0].email), false);
});

test('method and trusted runtime target gates reject before client construction', async () => {
  for (const options of [
    { release: null },
    { appPublicUrl: 'https://caremetricai.base44.app/' },
  ]) {
    const { handler, calls } = await loadHandler(options);
    const { response } = await invoke(handler);
    assert.ok([503, 403].includes(response.status));
    assert.equal(calls.clientConstructions, 0);
    assert.equal(calls.filters.length, 0);
  }

  const wrongHeader = await loadHandler();
  const wrongHeaderResult = await invoke(wrongHeader.handler, requestBody(), { appId: 'other-app' });
  assert.equal(wrongHeaderResult.response.status, 403);
  assert.equal(wrongHeader.calls.clientConstructions, 0);

  const wrongPartition = await loadHandler();
  const wrongPartitionResult = await invoke(wrongPartition.handler, requestBody(), {
    dataEnvironment: 'dev',
  });
  assert.equal(wrongPartitionResult.response.status, 403);
  assert.equal(wrongPartition.calls.clientConstructions, 0);

  const untrustedRouting = await loadHandler();
  const untrustedRoutingResult = await invoke(untrustedRouting.handler, requestBody(), {
    apiUrl: 'https://attacker.invalid',
    dataEnvironment: 'prod',
    state: 'signed-but-wrong-context',
    functionsVersion: 'draft',
  });
  assert.equal(untrustedRoutingResult.response.status, 200);
  assert.equal(untrustedRouting.calls.clientRequests.length, 1);
  assert.equal(untrustedRouting.calls.clientRequests[0].url, STAGING_ORIGIN);
  assert.deepEqual(untrustedRouting.calls.clientRequests[0].headers, {
    authorization: USER_BEARER,
    'base44-app-id': STAGING_APP_ID,
    'base44-service-authorization': SERVICE_BEARER,
  });

  const wrongMethod = await loadHandler();
  const wrongMethodResult = await invoke(wrongMethod.handler, null, { method: 'GET' });
  assert.equal(wrongMethodResult.response.status, 405);
  assert.equal(wrongMethodResult.response.headers.get('allow'), 'POST');
  assert.equal(wrongMethod.calls.clientConstructions, 0);
});

test('caller authorization precedes identity-bearing parsing and privileged reads', async () => {
  for (const caller of [
    new Error('no session'),
    { ...OWNER, role: 'user' },
    { ...OWNER, email: 'impostor@example.test' },
    { ...OWNER, is_service: true },
    { ...OWNER, is_verified: false },
  ]) {
    const { handler, calls } = await loadHandler({ callers: [caller] });
    const { response } = await invoke(handler, null, { raw: '{not-json' });
    assert.ok([401, 403].includes(response.status));
    assert.equal(calls.filters.length, 0);
  }
});

test('request shape, target, actor uniqueness, and body size fail closed before reads', async () => {
  const cases = [];
  const production = requestBody();
  production.target.app_id = '694ec16e72e01b60d22f7cbf';
  cases.push(production);
  const extra = requestBody();
  extra.actors.admin_a.password = 'never-echo';
  cases.push(extra);
  const duplicate = requestBody();
  duplicate.actors.admin_b.user_id = duplicate.actors.admin_a.user_id;
  cases.push(duplicate);
  const operator = requestBody();
  operator.actors.admin_a.user_id = '$ne';
  cases.push(operator);
  const ownerCollision = requestBody();
  ownerCollision.actors.admin_a.user_id = OWNER.id;
  cases.push(ownerCollision);
  const ownerEmailCollision = requestBody();
  ownerEmailCollision.actors.admin_a.email = OWNER.email;
  cases.push(ownerEmailCollision);

  for (const body of cases) {
    const { handler, calls } = await loadHandler();
    const { response, json } = await invoke(handler, body);
    assert.equal(response.status, 400);
    assert.equal(calls.filters.length, 0);
    assert.equal(JSON.stringify(json).includes('never-echo'), false);
  }

  const oversized = await loadHandler();
  const { response } = await invoke(oversized.handler, requestBody(), { contentLength: '9000' });
  assert.equal(response.status, 413);
  assert.equal(oversized.calls.filters.length, 0);
});

test('owner contamination and provider scope failures cannot be mistaken for readiness', async () => {
  const ownerMembership = await loadHandler({
    memberships: [{ id: 'owner-membership', user_id: OWNER.id }],
  });
  const ownerResult = await invoke(ownerMembership.handler);
  assert.equal(ownerResult.response.status, 409);

  const ignored = await loadHandler({
    memberships: [{ id: 'foreign-membership', user_id: 'other-user' }],
    ignoreFilters: new Set(['AgencyMembership']),
  });
  const ignoredResult = await invoke(ignored.handler);
  assert.equal(ignoredResult.response.status, 409);

  const duplicateUsers = userRows();
  duplicateUsers.push({ ...duplicateUsers[0], email: 'duplicate@example.test' });
  const duplicate = await loadHandler({ users: duplicateUsers });
  const duplicateResult = await invoke(duplicate.handler);
  assert.equal(duplicateResult.response.status, 409);

  const duplicateEmailUsers = userRows();
  duplicateEmailUsers.push({ ...duplicateEmailUsers[0], id: 'other-user-with-same-email' });
  const duplicateEmail = await loadHandler({ users: duplicateEmailUsers });
  const duplicateEmailResult = await invoke(duplicateEmail.handler);
  assert.equal(duplicateEmailResult.response.status, 409);
});

test('malformed or incomplete lifecycle fields never become eligible by coercion', async () => {
  for (const caller of [
    { ...OWNER, is_active: 'true' },
    { ...OWNER, disabled: 'false' },
    { ...OWNER, is_service: null },
    { ...OWNER, is_verified: 1 },
  ]) {
    const { handler, calls } = await loadHandler({ callers: [caller] });
    const { response } = await invoke(handler);
    assert.equal(response.status, 403);
    assert.equal(calls.filters.length, 0);
  }

  for (const patch of [
    { is_active: 'true' },
    { disabled: 'false' },
    { is_service: null },
    { is_verified: null },
    { is_approved: undefined },
    { is_approved: false },
  ]) {
    const users = userRows();
    Object.assign(users[0], patch);
    const { handler } = await loadHandler({ users });
    const { response, json } = await invoke(handler);
    assert.equal(response.status, 200);
    assert.equal(json.point_in_time_clear, false);
    assert.equal(json.checks.actors.admin_a.user, 'ineligible');
  }
});

test('non-array provider results and mid-request drift fail closed with generic output', async () => {
  const providerFailure = await loadHandler({ nonArrayEntity: 'StagingReadinessFixture' });
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const { response, json } = await invoke(providerFailure.handler);
    assert.equal(response.status, 500);
    assert.deepEqual(json, { error: 'Unable to inspect staging readiness fixture' });
    assert.deepEqual(logs, [['preflightStagingReadinessFixture failed']]);
  } finally {
    console.error = originalError;
  }

  const drift = await loadHandler({
    mutateRows: ({ entity, entityCall, state }) => {
      if (entity === 'User' && entityCall === 5) state.User[0].disabled = true;
    },
  });
  const driftResult = await invoke(drift.handler);
  assert.equal(driftResult.response.status, 409);

  const callerDrift = await loadHandler({
    callers: [OWNER, { ...OWNER, email: 'changed@example.test' }],
  });
  const callerDriftResult = await invoke(callerDrift.handler);
  assert.equal(callerDriftResult.response.status, 409);
});
