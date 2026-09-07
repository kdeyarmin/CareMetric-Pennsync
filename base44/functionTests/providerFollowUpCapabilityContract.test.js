import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const FUNCTIONS = [
  'generateFollowUpPortalToken',
  'validateFollowUpToken',
  'submitFollowUpResponse',
];
const T1 = '2026-09-06T12:00:00.000Z';
const T2 = '2026-09-06T12:01:00.000Z';

const clone = (value) => structuredClone(value);

async function loadCapabilityHandler(functionName, makeClient, env = new Map()) {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__providerCapabilityCreateClient;',
  );
  const target = join(
    tmpdir(),
    `provider_capability_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__providerCapabilityCreateClient = makeClient;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => env.get(name) },
  };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

function capabilityRuntime({ ignoreReferralFilters = false } = {}) {
  const state = {
    user: {
      id: 'office-1',
      email: 'office@agency.test',
      role: 'user',
      is_active: true,
      is_verified: true,
    },
    membership: {
      id: 'membership-office',
      membership_key: 'agency-a:office-1',
      agency_id: 'agency-a',
      user_id: 'office-1',
      user_email_normalized: 'office@agency.test',
      tenant_role: 'office_staff',
      status: 'active',
      created_by_user_id: 'owner-1',
      activated_at: T1,
      last_transition_by_user_id: 'owner-1',
      last_transition_by_email_normalized: 'owner@platform.test',
      last_transition_at: T1,
      last_transition_reason: 'Approved intake membership',
      version: 3,
    },
    referral: {
      id: 'referral-a',
      agency_id: 'agency-a',
      created_by_user_id: 'office-1',
      created_by_user_email_normalized: 'office@agency.test',
      created_by: 'office@agency.test',
      client_request_id: 'request-a',
      referral_creation_key: 'agency-a:office-1:request-a',
      version: 4,
      created_date: T1,
      updated_date: T2,
      patient_name: 'Fictional Patient',
      patient_dob: '1940-01-02',
      referral_date: '2026-09-01',
      follow_up_requests: {
        status: 'open',
        generated_at: '2026-09-06T12:02:00.000Z',
        sent_via: null,
        fax_log_id: null,
        counts: { total: 1, critical: 1, high: 0, medium: 0 },
        items: [
          {
            id: 'orders_missing',
            source: 'rules',
            category: 'compliance',
            severity: 'critical',
            title: 'Signed orders',
            needed: 'Signed home health orders',
            why: 'Required before services can be billed.',
            citation: '42 CFR 484.60',
            impact: 'Cannot bill',
            provider_request: {
              question: 'Please provide signed home health orders.',
              response_type: 'text',
              hint: '',
            },
            item_status: 'open',
            response: null,
            answered_at: null,
          },
        ],
      },
    },
    tokens: [],
    notifications: [],
    functionCalls: [],
    tokenUpdates: [],
    referralUpdates: [],
    now: Date.parse('2026-09-06T12:03:00.000Z'),
  };

  const tick = () => {
    state.now += 1000;
    return new Date(state.now).toISOString();
  };
  const matches = (row, query) => Object.entries(query || {}).every(([key, expected]) => {
    if (plainObject(expected) && Object.hasOwn(expected, '$exists')) {
      return (row?.[key] !== undefined) === expected.$exists;
    }
    return row?.[key] === expected;
  });
  const updateRows = (rows, query, operations) => {
    let updated = 0;
    for (const row of rows) {
      if (!matches(row, query)) continue;
      Object.assign(row, clone(operations.$set || {}));
      for (const [key, amount] of Object.entries(operations.$inc || {})) {
        row[key] = Number(row[key] || 0) + Number(amount);
      }
      for (const key of Object.keys(operations.$unset || {})) delete row[key];
      row.updated_date = tick();
      updated += 1;
    }
    return { success: true, updated, has_more: false };
  };
  const filter = (rows, query) => clone(rows.filter((row) => matches(row, query)));
  const scope = {
    agency_id: 'agency-a',
    membership_id: 'membership-office',
    membership_version: 3,
    tenant_role: 'office_staff',
  };
  const client = {
    auth: { me: async () => clone(state.user) },
    functions: {
      invoke: async (name, payload) => {
        state.functionCalls.push([name, clone(payload)]);
        if (name !== 'manageAuthorizedReferral') throw new Error('unexpected function');
        return {
          data: {
            success: true,
            action: 'get',
            referral: clone(state.referral),
            scope: clone(scope),
          },
        };
      },
    },
    asServiceRole: {
      entities: {
        Referral: {
          filter: async (query) => (
            ignoreReferralFilters ? [clone(state.referral)] : filter([state.referral], query)
          ),
          updateMany: async (query, operations) => {
            state.referralUpdates.push({ query: clone(query), operations: clone(operations) });
            return updateRows([state.referral], query, operations);
          },
        },
        ProviderFollowUpToken: {
          create: async (payload) => {
            const row = {
              id: `provider-token-${state.tokens.length + 1}`,
              created_date: tick(),
              updated_date: tick(),
              ...clone(payload),
            };
            state.tokens.push(row);
            return clone(row);
          },
          filter: async (query) => filter(state.tokens, query),
          updateMany: async (query, operations) => {
            state.tokenUpdates.push({ query: clone(query), operations: clone(operations) });
            return updateRows(state.tokens, query, operations);
          },
        },
        AgencyMembership: {
          filter: async (query) => filter([state.membership], query),
        },
        Notification: {
          filter: async (query) => filter(state.notifications, query),
          create: async (payload) => {
            const row = {
              id: `notification-${state.notifications.length + 1}`,
              created_date: tick(),
              updated_date: tick(),
              ...clone(payload),
            };
            state.notifications.push(row);
            return clone(row);
          },
        },
      },
    },
  };
  return { client, state };
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function post(functionName, body, headers = {}) {
  return new Request(`https://functions.base44.app/${functionName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://caremetric-staging.base44.app',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function loadedHandlers(runtime) {
  const handlers = {};
  const env = new Map([
    ['APP_PUBLIC_URL', 'https://caremetric-staging.base44.app'],
  ]);
  for (const name of FUNCTIONS) {
    handlers[name] = await loadCapabilityHandler(name, () => runtime.client, env);
  }
  return handlers;
}

test('provider follow-up capability issues, validates, submits, notifies, and retries without plaintext persistence', async () => {
  const runtime = capabilityRuntime();
  const handlers = await loadedHandlers(runtime);
  const issuedResponse = await handlers.generateFollowUpPortalToken(post(
    'generateFollowUpPortalToken',
    {
      agency_id: 'agency-a',
      referral_id: 'referral-a',
      provider_name: 'Example Practice',
      expires_in_days: 30,
    },
  ));
  assert.equal(issuedResponse.status, 201);
  assert.equal(issuedResponse.headers.get('cache-control'), 'no-store');
  const issued = await issuedResponse.json();
  assert.equal(issued.success, true);
  const link = new URL(issued.portal_link);
  assert.equal(link.origin, 'https://caremetric-staging.base44.app');
  assert.equal(link.pathname, '/followup');
  const plaintextToken = link.searchParams.get('token');
  assert.match(plaintextToken, /^[a-f0-9]{64}$/);
  assert.equal(runtime.state.tokens.length, 1);
  assert.notEqual(runtime.state.tokens[0].token, plaintextToken);
  assert.match(runtime.state.tokens[0].token, /^[a-f0-9]{64}$/);
  assert.equal(runtime.state.referral.follow_up_requests.portal_token_id, 'provider-token-1');
  assert.equal(runtime.state.referral.follow_up_requests.portal_link_active, true);
  assert.doesNotMatch(JSON.stringify(runtime.state.referral), new RegExp(plaintextToken));

  const validationResponse = await handlers.validateFollowUpToken(post(
    'validateFollowUpToken',
    { token: plaintextToken },
  ));
  assert.equal(validationResponse.status, 200);
  const validation = await validationResponse.json();
  assert.deepEqual(validation, {
    valid: true,
    patient_name: 'Fictional Patient',
    patient_dob: '1940-01-02',
    referral_date: '2026-09-01',
    provider_name: 'Example Practice',
    request_status: 'open',
    already_submitted: false,
    items: [
      {
        item_id: 'orders_missing',
        number: 1,
        title: 'Signed orders',
        question: 'Please provide signed home health orders.',
        hint: '',
        why: 'Required before services can be billed.',
        citation: '42 CFR 484.60',
        response_type: 'text',
        item_status: 'open',
      },
    ],
    expires_at: runtime.state.tokens[0].expires_at,
  });
  assert.equal(runtime.state.tokens[0].access_count, 1);

  const payload = {
    token: plaintextToken,
    responses: [{ item_id: 'orders_missing', response_text: 'Signed orders sent securely.' }],
    completed_by: 'Pat Smith',
    credential: 'RN',
  };
  const submitResponse = await handlers.submitFollowUpResponse(post(
    'submitFollowUpResponse',
    payload,
  ));
  assert.equal(submitResponse.status, 200);
  assert.deepEqual(await submitResponse.json(), {
    success: true,
    answered: 1,
    notified: true,
  });
  assert.equal(runtime.state.referral.follow_up_requests.status, 'received');
  assert.equal(runtime.state.referral.follow_up_requests.portal_link_active, false);
  assert.equal(
    runtime.state.referral.follow_up_requests.items[0].response.text,
    'Signed orders sent securely.',
  );
  assert.equal(runtime.state.referral.follow_up_requests.items[0].response.submitted_via, 'portal');
  assert.equal(runtime.state.tokens[0].status, 'delivered');
  assert.equal(runtime.state.tokens[0].is_active, false);
  assert.equal(runtime.state.notifications.length, 1);
  assert.equal(runtime.state.notifications[0].agency_id, 'agency-a');
  assert.equal(runtime.state.notifications[0].user_email, 'office@agency.test');
  assert.doesNotMatch(runtime.state.notifications[0].message, /Fictional Patient|Pat Smith|orders/i);

  const repeatResponse = await handlers.submitFollowUpResponse(post(
    'submitFollowUpResponse',
    payload,
  ));
  assert.equal(repeatResponse.status, 200);
  assert.deepEqual(await repeatResponse.json(), {
    success: true,
    answered: 1,
    already_submitted: true,
  });
  assert.equal(runtime.state.notifications.length, 1);

  const postSubmitValidation = await handlers.validateFollowUpToken(post(
    'validateFollowUpToken',
    { token: plaintextToken },
  ));
  assert.equal(postSubmitValidation.status, 200);
  const postSubmit = await postSubmitValidation.json();
  assert.equal(postSubmit.valid, true);
  assert.equal(postSubmit.already_submitted, true);
  assert.equal(postSubmit.request_status, 'received');

  const conflicting = await handlers.submitFollowUpResponse(post(
    'submitFollowUpResponse',
    { ...payload, responses: [{ item_id: 'orders_missing', response_text: 'Different answer.' }] },
  ));
  assert.equal(conflicting.status, 409);
  assert.match((await conflicting.json()).error, /different response/i);
  assert.equal(runtime.state.notifications.length, 1);
});

test('provider submission rejects an unknown item before claiming or changing the Referral', async () => {
  const runtime = capabilityRuntime();
  const handlers = await loadedHandlers(runtime);
  const issuedResponse = await handlers.generateFollowUpPortalToken(post(
    'generateFollowUpPortalToken',
    { agency_id: 'agency-a', referral_id: 'referral-a' },
  ));
  const plaintextToken = new URL((await issuedResponse.json()).portal_link).searchParams.get('token');
  const tokenUpdateCount = runtime.state.tokenUpdates.length;
  const referralUpdateCount = runtime.state.referralUpdates.length;
  const response = await handlers.submitFollowUpResponse(post(
    'submitFollowUpResponse',
    {
      token: plaintextToken,
      responses: [{ item_id: 'other-agency-item', response_text: 'Forged answer' }],
    },
  ));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /does not belong/);
  assert.equal(runtime.state.tokenUpdates.length, tokenUpdateCount);
  assert.equal(runtime.state.referralUpdates.length, referralUpdateCount);
  assert.equal(runtime.state.referral.follow_up_requests.status, 'open');
});

test('public validation rejects a false-success cross-tenant Referral row without disclosure', async () => {
  const runtime = capabilityRuntime({ ignoreReferralFilters: true });
  const handlers = await loadedHandlers(runtime);
  const issuedResponse = await handlers.generateFollowUpPortalToken(post(
    'generateFollowUpPortalToken',
    { agency_id: 'agency-a', referral_id: 'referral-a' },
  ));
  const plaintextToken = new URL((await issuedResponse.json()).portal_link).searchParams.get('token');
  runtime.state.referral.agency_id = 'agency-b';
  const response = await handlers.validateFollowUpToken(post(
    'validateFollowUpToken',
    { token: plaintextToken },
  ));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    valid: false,
    error: 'This link is no longer valid.',
  });
});

test('provider capability schemas and sources pin single-use tenant provenance', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/ProviderFollowUpToken.jsonc', import.meta.url),
    'utf8',
  ));
  for (const field of [
    'agency_id', 'referral_id', 'token_creation_key', 'request_snapshot_hash',
    'request_snapshot', 'issued_by_user_id', 'issued_by_membership_id',
    'submit_claimed_by', 'submit_claimed_response_hash', 'submission_id',
    'submitted_response_hash', 'version',
  ]) assert.ok(schema.properties[field], field);
  assert.deepEqual(schema.rls, { read: false, create: false, update: false, delete: false });

  const sources = Object.fromEntries(await Promise.all(FUNCTIONS.map(async (name) => [
    name,
    await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8'),
  ])));
  assert.match(sources.generateFollowUpPortalToken, /token: tokenHash/);
  assert.match(sources.generateFollowUpPortalToken, /Referral\.updateMany\(/);
  assert.match(sources.validateFollowUpToken, /request_snapshot_hash/);
  assert.match(sources.validateFollowUpToken, /updated_date: initial\.row\.updated_date/);
  assert.match(sources.submitFollowUpResponse, /submit_claimed_response_hash/);
  assert.match(sources.submitFollowUpResponse, /portal_submission_hash/);
  assert.match(sources.submitFollowUpResponse, /Referral\.updateMany\(/);
  assert.doesNotMatch(sources.submitFollowUpResponse, /temporarily unavailable/);
  for (const source of Object.values(sources)) {
    assert.doesNotMatch(source, /console\.error\([^)]*,\s*(?:error|token|input|body|response)/i);
  }
});
