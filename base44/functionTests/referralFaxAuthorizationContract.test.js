import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const FUNCTION_NAME = 'sendAuthorizedReferralFax';

async function loadHandler(makeClient) {
  let source = await readFile(
    new URL(`../functions/${FUNCTION_NAME}/entry.ts`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__referralFaxCreateClient;',
  );
  const target = join(
    tmpdir(),
    `referral_fax_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__referralFaxCreateClient = makeClient;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (key) => key === 'OUTBOUND_DELIVERY_RELEASE' ? 'enabled-v1' : undefined },
  };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

const clone = (value) => structuredClone(value);

function runtime({
  documentScopeAgency = 'agency-a',
  blockedAreaCodes = [],
  retryConfig = { agency_id: 'agency-a', max_retries: 3 },
  seededFaxes = [],
  integrationSecrets = null,
} = {}) {
  const state = {
    functionCalls: [],
    faxFilters: [],
    faxCreates: [],
    faxUpdates: [],
    faxUpdateMany: [],
    activities: [],
    fetches: [],
    faxes: clone(seededFaxes),
    updateSequence: 0,
  };
  const nextUpdatedDate = () => {
    state.updateSequence += 1;
    return new Date(Date.parse('2026-09-06T13:00:00.000Z') + state.updateSequence).toISOString();
  };
  const telnyxSecrets = integrationSecrets || [{
    id: 'secret-a',
    provider: 'telnyx',
    api_key: 'test-api-key',
    fax_connection_id: 'fax-connection-a',
    is_active: true,
    updated_date: '2026-09-06T11:54:00.000Z',
  }];
  const scope = {
    agency_id: 'agency-a',
    membership_id: 'membership-a',
    membership_version: 3,
    tenant_role: 'office_staff',
  };
  const referralEnvelope = {
    success: true,
    action: 'get',
    referral: {
      id: 'referral-a',
      agency_id: 'agency-a',
      patient_id: null,
      version: 7,
      updated_date: '2026-09-06T12:00:00.000Z',
      follow_up_requests: {
        status: 'open',
        portal_link_active: true,
        portal_token_id: 'token-a',
      },
    },
    scope,
  };
  const documentEnvelope = {
    success: true,
    purpose: 'fax',
    document: {
      id: 'document-a',
      file_name: 'referral-follow-up-request.pdf',
      file_size: 1234,
      file_type: 'application/pdf',
      category: 'referral',
      patient_id: null,
    },
    delivery: {
      download_url: 'https://files.base44.app/private/document-a.pdf?signature=short-lived',
      expires_in_seconds: 900,
    },
    scope: { ...scope, agency_id: documentScopeAgency },
  };
  const client = {
    auth: {
      me: async () => ({
        id: 'office-1',
        email: 'Office@Agency.test',
        full_name: 'Fictional Office User',
        role: 'user',
        is_active: true,
        is_verified: true,
      }),
    },
    functions: {
      invoke: async (name, payload) => {
        state.functionCalls.push([name, clone(payload)]);
        if (name === 'manageAuthorizedReferral') return { data: clone(referralEnvelope) };
        if (name === 'getAuthorizedDocument') return { data: clone(documentEnvelope) };
        throw new Error('unexpected function');
      },
    },
    asServiceRole: {
      entities: {
        Agency: {
          filter: async (query) => {
            if (query.id === 'agency-a' || query.agency_code === 'AGENCY-A') {
              return [{ id: 'agency-a', agency_code: 'AGENCY-A', status: 'active' }];
            }
            return [];
          },
        },
        AgencySettings: {
          filter: async () => [{
            id: 'agency-settings-a',
            updated_date: '2026-09-06T11:55:00.000Z',
            agency_code: 'AGENCY-A',
            office_fax_number_e164: '+17244650444',
            outbound_fax_number_e164: '+17244650441',
            blocked_area_codes: blockedAreaCodes,
            allow_international: false,
          }],
        },
        IntegrationSecret: {
          filter: async (query) => clone(telnyxSecrets.filter((row) => Object.entries(query).every(
            ([key, value]) => row[key] === value,
          ))),
        },
        FaxRetryConfig: {
          filter: async (query) => {
            if (!retryConfig) return [];
            return Object.entries(query).every(([key, value]) => retryConfig[key] === value)
              ? [clone(retryConfig)]
              : [];
          },
        },
        FaxLog: {
          filter: async (query) => {
            state.faxFilters.push(clone(query));
            return clone(state.faxes.filter((row) => Object.entries(query).every(
              ([key, value]) => row[key] === value,
            )));
          },
          create: async (payload) => {
            state.faxCreates.push(clone(payload));
            const row = {
              id: `fax-${state.faxes.length + 1}`,
              created_date: new Date().toISOString(),
              updated_date: nextUpdatedDate(),
              ...clone(payload),
            };
            state.faxes.push(row);
            return clone(row);
          },
          update: async (id, changes) => {
            state.faxUpdates.push([id, clone(changes)]);
            const row = state.faxes.find((candidate) => candidate.id === id);
            if (row) Object.assign(row, clone(changes), { updated_date: nextUpdatedDate() });
            return clone(row || {});
          },
          updateMany: async (query, changes) => {
            state.faxUpdateMany.push([clone(query), clone(changes)]);
            const matches = state.faxes.filter((row) => Object.entries(query).every(
              ([key, value]) => row[key] === value,
            ));
            for (const row of matches) {
              if (changes.$set) Object.assign(row, clone(changes.$set));
              if (changes.$inc) {
                for (const [key, value] of Object.entries(changes.$inc)) {
                  row[key] = (Number(row[key]) || 0) + Number(value);
                }
              }
              row.updated_date = nextUpdatedDate();
            }
            return { success: true, updated: matches.length, has_more: false };
          },
        },
        UserActivity: {
          create: async (payload) => {
            state.activities.push(clone(payload));
            return { id: 'activity-a', ...clone(payload) };
          },
        },
      },
    },
  };
  const fetch = async (url, options) => {
    state.fetches.push([url, clone(options)]);
    return Response.json({ data: { id: 'telnyx-fax-a', status: 'queued' } });
  };
  return { client, state, fetch };
}

function faxRequest(overrides = {}) {
  return new Request('https://functions.base44.app/sendAuthorizedReferralFax', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agency_id: 'agency-a',
      referral_id: 'referral-a',
      document_id: 'document-a',
      to_number: '(724) 555-0123',
      to_name: 'Example Practice',
      document_name: 'Follow-up request',
      ...overrides,
    }),
  });
}

function faxRetryRequest(faxLogId = 'fax-source') {
  return new Request('https://functions.base44.app/sendAuthorizedReferralFax', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ retry_fax_log_id: faxLogId }),
  });
}

const retryableFax = {
  id: 'fax-source',
  created_date: '2026-09-06T12:00:00.000Z',
  updated_date: '2026-09-06T12:05:00.000Z',
  agency_id: 'agency-a',
  referral_id: 'referral-a',
  document_id: 'document-a',
  from_number: '+17244650441',
  to_number: '+17245550123',
  to_name: 'Example Practice',
  document_name: 'Follow-up request',
  sent_by: 'office@agency.test',
  sent_by_user_id: 'office-1',
  sent_by_membership_id: 'membership-a',
  sent_by_membership_version: 3,
  telnyx_fax_id: 'telnyx-fax-source',
  provider_submission_attempt_id: 'submission-attempt-source',
  provider_submission_state: 'accepted',
  provider_accepted_at: '2026-09-06T12:00:01.000Z',
  provider_terminal_status: 'failed',
  provider_terminal_at: '2026-09-06T12:05:00.000Z',
  status: 'failed',
  retry_count: 0,
  retry_generation: 0,
  next_retry_at: '2026-09-06T12:06:00.000Z',
  retry_claimed_by: null,
  retry_claimed_at: null,
  retry_claimed_by_user_id: null,
};

test('referral fax re-proves both brokers, sends a signed private document, and stores no delivery URL', async () => {
  const fixture = runtime();
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    success: true,
    log_id: 'fax-1',
    status: 'sending',
  });
  assert.deepEqual(fixture.state.functionCalls.map(([name]) => name), [
    'manageAuthorizedReferral',
    'getAuthorizedDocument',
    'manageAuthorizedReferral',
    'getAuthorizedDocument',
  ]);
  assert.equal(fixture.state.functionCalls[1][1].purpose, 'fax');
  assert.equal(fixture.state.faxCreates.length, 1);
  assert.equal(fixture.state.faxCreates[0].agency_id, 'agency-a');
  assert.equal(fixture.state.faxCreates[0].referral_id, 'referral-a');
  assert.equal(fixture.state.faxCreates[0].document_id, 'document-a');
  assert.equal(fixture.state.faxCreates[0].to_number, '+17245550123');
  assert.equal(fixture.state.faxCreates[0].sent_by_user_id, 'office-1');
  assert.equal(fixture.state.faxCreates[0].provider_submission_state, 'pending');
  assert.equal(fixture.state.faxCreates[0].provider, 'telnyx');
  assert.equal(fixture.state.faxCreates[0].integration_secret_id, 'secret-a');
  assert.equal(
    fixture.state.faxCreates[0].integration_secret_updated_at,
    '2026-09-06T11:54:00.000Z',
  );
  assert.equal(fixture.state.faxCreates[0].fax_connection_id, 'fax-connection-a');
  assert.equal(fixture.state.faxCreates[0].sender_settings_id, 'agency-settings-a');
  assert.equal(
    fixture.state.faxCreates[0].sender_settings_updated_at,
    '2026-09-06T11:55:00.000Z',
  );
  assert.match(fixture.state.faxCreates[0].provider_submission_attempt_id, /^[0-9a-f-]{36}$/i);
  assert.equal(Object.hasOwn(fixture.state.faxCreates[0], 'document_url'), false);
  assert.equal(fixture.state.fetches.length, 1);
  const providerPayload = JSON.parse(fixture.state.fetches[0][1].body);
  assert.equal(providerPayload.connection_id, 'fax-connection-a');
  assert.equal(providerPayload.from, '+17244650441');
  assert.equal(providerPayload.to, '+17245550123');
  assert.equal(
    providerPayload.media_url,
    'https://files.base44.app/private/document-a.pdf?signature=short-lived',
  );
  assert.equal(fixture.state.faxes[0].telnyx_fax_id, 'telnyx-fax-a');
  assert.equal(fixture.state.faxes[0].status, 'sending');
  assert.equal(fixture.state.faxes[0].provider_submission_state, 'accepted');
  assert.ok(Number.isFinite(Date.parse(fixture.state.faxes[0].provider_accepted_at)));
  assert.equal(fixture.state.activities.length, 1);
  assert.doesNotMatch(
    JSON.stringify(fixture.state.activities[0].details),
    /document-a|referral-a|Fictional Office User|7245550123/i,
  );
});

test('network ambiguity is quarantined and a repeated click cannot submit the fax twice', async () => {
  const fixture = runtime();
  fixture.fetch = async (url, options) => {
    fixture.state.fetches.push([url, clone(options)]);
    throw new TypeError('simulated network interruption');
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  try {
    const first = await handler(faxRequest());
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), {
      success: true,
      log_id: 'fax-1',
      status: 'submission_unknown',
      requires_reconciliation: true,
    });
    const second = await handler(faxRequest());
    assert.equal(second.status, 202);
    assert.deepEqual(await second.json(), {
      success: true,
      deduped: true,
      log_id: 'fax-1',
      status: 'submission_unknown',
      requires_reconciliation: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fixture.state.fetches.length, 1);
  assert.equal(fixture.state.faxCreates.length, 1);
  assert.equal(fixture.state.faxes[0].provider_submission_state, 'indeterminate');
  assert.equal(fixture.state.faxes[0].telnyx_fax_id, undefined);
});

test('an old unresolved submission blocks a new document send for the same referral and destination', async () => {
  const fixture = runtime({
    seededFaxes: [{
      ...retryableFax,
      id: 'fax-unknown',
      document_id: 'older-document',
      created_date: '2025-01-01T00:00:00.000Z',
      status: 'submission_unknown',
      provider_submission_state: 'indeterminate',
      provider_terminal_status: undefined,
      provider_terminal_at: undefined,
    }],
  });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    success: true,
    deduped: true,
    log_id: 'fax-unknown',
    status: 'submission_unknown',
    requires_reconciliation: true,
  });
  assert.equal(fixture.state.faxCreates.length, 0);
  assert.equal(fixture.state.fetches.length, 0);
});

test('an unresolved submission blocks duplicate sends across authorized users in the same tenant', async () => {
  const fixture = runtime({
    seededFaxes: [{
      ...retryableFax,
      id: 'fax-other-user-unknown',
      sent_by: 'other@agency.test',
      sent_by_user_id: 'office-2',
      created_date: '2025-01-01T00:00:00.000Z',
      status: 'submission_unknown',
      provider_submission_state: 'indeterminate',
      provider_terminal_status: undefined,
      provider_terminal_at: undefined,
    }],
  });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 202);
  assert.equal((await response.json()).log_id, 'fax-other-user-unknown');
  assert.equal(fixture.state.faxCreates.length, 0);
  assert.equal(fixture.state.fetches.length, 0);
});

test('a contender created in the preflight race is suppressed before either later row can dispatch', async () => {
  const fixture = runtime();
  const createFax = fixture.client.asServiceRole.entities.FaxLog.create;
  fixture.client.asServiceRole.entities.FaxLog.create = async (payload) => {
    const created = await createFax(payload);
    fixture.state.faxes.push({
      ...clone(created),
      id: 'fax-concurrent-owner',
      created_date: new Date(Date.parse(created.created_date) - 1000).toISOString(),
      updated_date: '2026-09-06T13:00:00.500Z',
      sent_by: 'other@agency.test',
      sent_by_user_id: 'office-2',
    });
    return created;
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    deduped: true,
    log_id: 'fax-concurrent-owner',
    status: 'queued',
  });
  assert.equal(fixture.state.fetches.length, 0);
  assert.equal(fixture.state.faxes.find((row) => row.id === 'fax-1').status, 'failed');
  assert.equal(
    fixture.state.faxes.find((row) => row.id === 'fax-1').provider_submission_state,
    'rejected',
  );
});

test('a retry contender cannot dispatch beside a concurrent authorized submission', async () => {
  const fixture = runtime({ seededFaxes: [retryableFax] });
  const createFax = fixture.client.asServiceRole.entities.FaxLog.create;
  fixture.client.asServiceRole.entities.FaxLog.create = async (payload) => {
    const created = await createFax(payload);
    fixture.state.faxes.push({
      ...clone(created),
      id: 'fax-concurrent-owner',
      created_date: new Date(Date.parse(created.created_date) - 1000).toISOString(),
      updated_date: '2026-09-06T13:00:00.500Z',
      retry_of_fax_log_id: undefined,
      retry_count: 0,
      retry_generation: 0,
      sent_by: 'other@agency.test',
      sent_by_user_id: 'office-2',
    });
    return created;
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRetryRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    deduped: true,
    log_id: 'fax-concurrent-owner',
    status: 'queued',
  });
  assert.equal(fixture.state.fetches.length, 0);
  const source = fixture.state.faxes.find((row) => row.id === 'fax-source');
  const contender = fixture.state.faxes.find((row) => row.id === 'fax-2');
  assert.equal(source.status, 'failed');
  assert.equal(source.retry_count, 0);
  assert.equal(source.retry_generation, 0);
  assert.equal(source.next_retry_at, null);
  assert.equal(source.retry_claimed_by, null);
  assert.equal(contender.status, 'failed');
  assert.equal(contender.provider_submission_state, 'rejected');
});

test('an already-bound provider fax id is quarantined instead of crossing FaxLog tenants', async () => {
  const fixture = runtime({
    seededFaxes: [{
      ...retryableFax,
      id: 'foreign-fax-log',
      agency_id: 'agency-b',
      referral_id: 'referral-b',
      document_id: 'document-b',
      to_number: '+13125550182',
      telnyx_fax_id: 'telnyx-fax-a',
      status: 'sending',
    }],
  });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  const data = await response.json();
  assert.equal(response.status, 202);
  assert.equal(data.requires_reconciliation, true);
  assert.match(data.warning, /identity conflicts/i);
  assert.equal(fixture.state.fetches.length, 1);
  const own = fixture.state.faxes.find((row) => row.agency_id === 'agency-a');
  assert.equal(own.status, 'submission_unknown');
  assert.equal(own.provider_submission_state, 'indeterminate');
  assert.equal(own.telnyx_fax_id, undefined);
  assert.equal(fixture.state.faxes.find((row) => row.id === 'foreign-fax-log').status, 'sending');
});

test('a provider id collision appearing after acceptance quarantines the accepted row', async () => {
  const fixture = runtime();
  const updateMany = fixture.client.asServiceRole.entities.FaxLog.updateMany;
  let insertedCollision = false;
  fixture.client.asServiceRole.entities.FaxLog.updateMany = async (query, changes) => {
    const result = await updateMany(query, changes);
    if (!insertedCollision && changes?.$set?.provider_submission_state === 'accepted') {
      insertedCollision = true;
      fixture.state.faxes.push({
        ...clone(fixture.state.faxes.find((row) => row.id === query.id)),
        id: 'foreign-fax-log',
        agency_id: 'agency-b',
        referral_id: 'referral-b',
        document_id: 'document-b',
        updated_date: '2026-09-06T13:00:00.500Z',
      });
    }
    return result;
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  const data = await response.json();
  assert.equal(response.status, 202);
  assert.equal(data.status, 'submission_unknown');
  assert.equal(data.requires_reconciliation, true);
  assert.match(data.warning, /conflicts with another record/i);
  assert.equal(fixture.state.fetches.length, 1);
  const own = fixture.state.faxes.find((row) => row.id === 'fax-1');
  const foreign = fixture.state.faxes.find((row) => row.id === 'foreign-fax-log');
  assert.equal(own.status, 'submission_unknown');
  assert.equal(own.provider_submission_state, 'indeterminate');
  assert.equal(own.telnyx_fax_id, 'telnyx-fax-a');
  assert.equal(foreign.status, 'sending');
  assert.equal(foreign.telnyx_fax_id, 'telnyx-fax-a');
});

test('provider dispatch never starts until the created FaxLog is durably readable', async () => {
  const fixture = runtime();
  fixture.client.asServiceRole.entities.FaxLog.create = async (payload) => {
    fixture.state.faxCreates.push(clone(payload));
    return {
      id: 'fax-uncommitted',
      created_date: '2026-09-06T13:00:00.000Z',
      updated_date: '2026-09-06T13:00:00.000Z',
      ...clone(payload),
    };
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 500);
  assert.equal(fixture.state.fetches.length, 0);
  assert.equal(fixture.state.faxes.length, 0);
});

test('a lost ambiguity-state update remains blocked by the durable pending attempt', async () => {
  const fixture = runtime();
  fixture.fetch = async (url, options) => {
    fixture.state.fetches.push([url, clone(options)]);
    throw new TypeError('simulated network interruption');
  };
  fixture.client.asServiceRole.entities.FaxLog.updateMany = async () => ({
    success: true,
    updated: 0,
    has_more: false,
  });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  try {
    const first = await handler(faxRequest());
    assert.equal(first.status, 202);
    assert.match((await first.json()).warning, /do not resend/i);
    assert.equal(fixture.state.faxes[0].provider_submission_state, 'pending');
    const second = await handler(faxRequest());
    assert.equal(second.status, 202);
    assert.equal((await second.json()).requires_reconciliation, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fixture.state.fetches.length, 1);
  assert.equal(fixture.state.faxCreates.length, 1);
});

test('an accepted provider response is recovered from readback when the CAS response is lost', async () => {
  const fixture = runtime();
  const updateMany = fixture.client.asServiceRole.entities.FaxLog.updateMany;
  let loseAcceptedResponse = true;
  fixture.client.asServiceRole.entities.FaxLog.updateMany = async (query, changes) => {
    const result = await updateMany(query, changes);
    if (loseAcceptedResponse && changes?.$set?.provider_submission_state === 'accepted') {
      loseAcceptedResponse = false;
      throw new Error('simulated response loss after apply');
    }
    return result;
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'sending');
  assert.equal(fixture.state.fetches.length, 1);
  assert.equal(fixture.state.faxes[0].status, 'sending');
  assert.equal(fixture.state.faxes[0].provider_submission_state, 'accepted');
});

test('an ambiguous provider HTTP response is quarantined instead of reported as a safe failure', async () => {
  const fixture = runtime();
  fixture.fetch = async (url, options) => {
    fixture.state.fetches.push([url, clone(options)]);
    return Response.json({ errors: [{ title: 'upstream unavailable' }] }, { status: 503 });
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 202);
  assert.equal((await response.json()).requires_reconciliation, true);
  assert.equal(fixture.state.faxes[0].status, 'submission_unknown');
  assert.equal(fixture.state.faxes[0].provider_submission_state, 'indeterminate');
});

test('a definite provider rejection is recorded as rejected and remains ineligible for retry', async () => {
  const fixture = runtime();
  fixture.fetch = async (url, options) => {
    fixture.state.fetches.push([url, clone(options)]);
    return Response.json({ errors: [{ title: 'Invalid fax destination' }] }, { status: 422 });
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'Fax provider rejected the request');
  assert.equal(fixture.state.faxes[0].status, 'failed');
  assert.equal(fixture.state.faxes[0].provider_submission_state, 'rejected');
  assert.equal(fixture.state.faxes[0].provider_terminal_status, undefined);
});

test('manual retry re-authorizes the private document, atomically claims the source, and logs a new attempt', async () => {
  const fixture = runtime({ seededFaxes: [retryableFax] });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRetryRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    log_id: 'fax-2',
    status: 'sending',
    retry_of_fax_log_id: 'fax-source',
  });
  assert.deepEqual(fixture.state.functionCalls.map(([name]) => name), [
    'manageAuthorizedReferral',
    'getAuthorizedDocument',
    'manageAuthorizedReferral',
    'getAuthorizedDocument',
  ]);
  assert.equal(fixture.state.fetches.length, 1);
  assert.equal(fixture.state.faxCreates.length, 1);
  assert.equal(fixture.state.faxCreates[0].retry_of_fax_log_id, 'fax-source');
  assert.equal(fixture.state.faxCreates[0].retry_generation, 1);
  assert.equal(fixture.state.faxCreates[0].retry_count, 1);
  assert.equal(fixture.state.faxes[0].status, 'retried');
  assert.equal(fixture.state.faxes[0].retry_count, 1);
  assert.equal(fixture.state.faxes[0].retry_generation, 1);
  assert.equal(fixture.state.faxes[0].next_retry_at, null);
  assert.equal(fixture.state.faxes[0].retry_claimed_by, null);
  assert.equal(fixture.state.faxUpdateMany.length, 3);
});

test('a definitely rejected retry consumes exactly one retry generation', async () => {
  const fixture = runtime({
    seededFaxes: [retryableFax],
    retryConfig: { agency_id: 'agency-a', max_retries: 1 },
  });
  fixture.fetch = async (url, options) => {
    fixture.state.fetches.push([url, clone(options)]);
    return Response.json({ errors: [{ title: 'Invalid fax destination' }] }, { status: 422 });
  };
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  try {
    const first = await handler(faxRetryRequest());
    assert.equal(first.status, 502);
    assert.equal(fixture.state.faxes[0].status, 'failed');
    assert.equal(fixture.state.faxes[0].retry_count, 1);
    assert.equal(fixture.state.faxes[0].retry_generation, 1);
    assert.equal(fixture.state.faxes[0].next_retry_at, null);
    assert.equal(fixture.state.faxes[1].provider_submission_state, 'rejected');

    const second = await handler(faxRetryRequest());
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /Maximum retries/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fixture.state.fetches.length, 1);
});

test('manual retry rejects indeterminate, legacy, and concurrently claimed source rows before transmission', async () => {
  for (const source of [
    { ...retryableFax, provider_submission_state: 'indeterminate' },
    { ...retryableFax, document_url: 'https://legacy.example/fax.pdf' },
    {
      ...retryableFax,
      provider_terminal_at: '2026-09-06T11:59:59.000Z',
    },
    { ...retryableFax, failure_notify_claimed_by: 'notify-claim-1' },
  ]) {
    const fixture = runtime({ seededFaxes: [source] });
    const handler = await loadHandler(() => fixture.client);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fixture.fetch;
    let response;
    try {
      response = await handler(faxRetryRequest());
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(response.status, 409);
    assert.equal(fixture.state.fetches.length, 0);
    assert.equal(fixture.state.faxCreates.length, 0);
  }

  const fixture = runtime({ seededFaxes: [retryableFax] });
  fixture.client.asServiceRole.entities.FaxLog.updateMany = async () => ({
    success: true,
    updated: 0,
    has_more: false,
  });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRetryRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 409);
  assert.equal(fixture.state.fetches.length, 0);
  assert.equal(fixture.state.faxCreates.length, 0);
});

test('referral fax rejects cross-tenant document scope before configuration, logging, or transmission', async () => {
  const fixture = runtime({ documentScopeAgency: 'agency-b' });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Document authorization response was invalid/);
  assert.equal(fixture.state.faxCreates.length, 0);
  assert.equal(fixture.state.fetches.length, 0);
});

test('referral fax enforces agency destination controls before creating a FaxLog', async () => {
  const fixture = runtime({ blockedAreaCodes: ['724'] });
  const handler = await loadHandler(() => fixture.client);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetch;
  let response;
  try {
    response = await handler(faxRequest());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /blocked/);
  assert.equal(fixture.state.faxCreates.length, 0);
  assert.equal(fixture.state.fetches.length, 0);
});

test('referral fax requires exactly one active, exact Telnyx integration', async () => {
  for (const integrationSecrets of [
    [{
      id: 'secret-a',
      provider: 'telnyx',
      fax_connection_id: 'fax-connection-a',
      is_active: true,
    }],
    [{
      id: 'secret-a',
      provider: 'telnyx',
      api_key: 'test-api-key',
      fax_connection_id: 'fax-connection-a',
      is_active: false,
    }],
    [
      {
        id: 'secret-a',
        provider: 'telnyx',
        api_key: 'test-api-key-a',
        fax_connection_id: 'fax-connection-a',
        is_active: true,
      },
      {
        id: 'secret-b',
        provider: 'telnyx',
        api_key: 'test-api-key-b',
        fax_connection_id: 'fax-connection-b',
        is_active: true,
      },
    ],
  ]) {
    const fixture = runtime({ integrationSecrets });
    const handler = await loadHandler(() => fixture.client);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fixture.fetch;
    let response;
    try {
      response = await handler(faxRequest());
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Fax integration is not configured/);
    assert.equal(fixture.state.faxCreates.length, 0);
    assert.equal(fixture.state.fetches.length, 0);
  }
});

test('ReferralFollowUp uses private document authority and the dedicated fax broker', async () => {
  const page = await readFile(
    new URL('../../src/pages/ReferralFollowUp.jsx', import.meta.url),
    'utf8',
  );
  assert.match(page, /createAuthorizedDocument\(\{/);
  assert.match(page, /purpose:\s*["']referral["']/);
  assert.match(page, /functions\.invoke\(["']sendAuthorizedReferralFax["']/);
  assert.match(page, /data\.requires_reconciliation\s*\|\|\s*data\.status\s*===\s*["']submission_unknown["']/);
  assert.match(page, /do not send it again until its status is reconciled/i);
  assert.match(page, /faxSubmissionInFlightRef\.current/);
  assert.doesNotMatch(page, /Core\.UploadFile|functions\.invoke\(["']sendFax["']/);

  const source = await readFile(
    new URL(`../functions/${FUNCTION_NAME}/entry.ts`, import.meta.url),
    'utf8',
  );
  assert.match(source, /functions\.invoke\('manageAuthorizedReferral'/);
  assert.match(source, /functions\.invoke\('getAuthorizedDocument'/);
  assert.match(source, /purpose:\s*'fax'/);
  assert.match(source, /document_id:\s*input\.documentId/);
  assert.doesNotMatch(source, /document_url:\s*finalDocument\.delivery/);
  assert.doesNotMatch(source, /console\.error\([^)]*,\s*(?:error|input|body|document|referral)/i);

  const wrapper = await readFile(
    new URL('../../src/functions/sendAuthorizedReferralFax.js', import.meta.url),
    'utf8',
  );
  assert.match(wrapper, /functions\.invoke\('sendAuthorizedReferralFax'/);
});
