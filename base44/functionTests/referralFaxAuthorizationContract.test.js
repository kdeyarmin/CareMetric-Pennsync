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
    env: { get: () => undefined },
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

function runtime({ documentScopeAgency = 'agency-a', blockedAreaCodes = [] } = {}) {
  const state = {
    functionCalls: [],
    faxFilters: [],
    faxCreates: [],
    faxUpdates: [],
    activities: [],
    fetches: [],
    faxes: [],
  };
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
            agency_code: 'AGENCY-A',
            office_fax_number_e164: '+17244650444',
            outbound_fax_number_e164: '+17244650441',
            blocked_area_codes: blockedAreaCodes,
            allow_international: false,
          }],
        },
        IntegrationSecret: {
          filter: async () => [{
            id: 'secret-a',
            provider: 'telnyx',
            api_key: 'test-api-key',
            fax_connection_id: 'fax-connection-a',
            is_active: true,
          }],
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
              ...clone(payload),
            };
            state.faxes.push(row);
            return clone(row);
          },
          update: async (id, changes) => {
            state.faxUpdates.push([id, clone(changes)]);
            const row = state.faxes.find((candidate) => candidate.id === id);
            if (row) Object.assign(row, clone(changes));
            return clone(row || {});
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
    status: 'queued',
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
  assert.equal(fixture.state.activities.length, 1);
  assert.doesNotMatch(
    JSON.stringify(fixture.state.activities[0].details),
    /document-a|referral-a|Fictional Office User|7245550123/i,
  );
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

test('ReferralFollowUp uses private document authority and the dedicated fax broker', async () => {
  const page = await readFile(
    new URL('../../src/pages/ReferralFollowUp.jsx', import.meta.url),
    'utf8',
  );
  assert.match(page, /createAuthorizedDocument\(\{/);
  assert.match(page, /purpose:\s*["']referral["']/);
  assert.match(page, /functions\.invoke\(["']sendAuthorizedReferralFax["']/);
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
});
