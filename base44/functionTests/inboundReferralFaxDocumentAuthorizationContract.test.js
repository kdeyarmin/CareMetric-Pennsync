import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const ENTRY_URL = new URL('../functions/getAuthorizedInboundReferralFax/entry.ts', import.meta.url);

async function loadHandler(makeClient) {
  let source = await readFile(ENTRY_URL, 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__inboundFaxDocumentCreateClient;',
  );
  const target = join(
    tmpdir(),
    `inbound_fax_document_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__inboundFaxDocumentCreateClient = makeClient;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: () => null } };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
    delete globalThis.__inboundFaxDocumentCreateClient;
  }
  return handler;
}

const referralResult = (overrides = {}) => ({
  success: true,
  action: 'get',
  referral: {
    id: 'referral-a',
    agency_id: 'agency-a',
    version: 3,
    updated_date: '2026-09-06T12:00:00.000Z',
    follow_up_requests: {
      status: 'received',
      fax_back: {
        incoming_fax_id: 'incoming-a',
        matched_signals: ['patient_name', 'patient_dob'],
        auto_answered_count: 1,
      },
    },
    ...overrides,
  },
  scope: {
    agency_id: 'agency-a',
    membership_id: 'membership-a',
    membership_version: 2,
    tenant_role: 'office_staff',
  },
});

const faxRow = (overrides = {}) => ({
  id: 'incoming-a',
  agency_id: 'agency-a',
  ingress_binding_id: 'binding-a',
  ingress_binding_key: 'telnyx:integration-a:+12155550190',
  ingress_binding_version: 1,
  integration_secret_id: 'integration-a',
  received_to_number: '+12155550190',
  received_at: '2026-09-06T11:00:00.000Z',
  telnyx_fax_id: 'provider-fax-a',
  document_url: 'https://media.telnyx.test/incoming-a.pdf',
  processing_status: 'completed',
  status: 'routed',
  routed_to: 'ReferralFollowUp:referral-a',
  routed_at: '2026-09-06T12:00:00.000Z',
  suggested_referral_id: 'referral-a',
  version: 2,
  created_date: '2026-09-06T11:00:00.000Z',
  updated_date: '2026-09-06T12:00:00.000Z',
  ...overrides,
});

function request(body = {
  agency_id: 'agency-a',
  referral_id: 'referral-a',
  incoming_fax_id: 'incoming-a',
}) {
  return new Request('https://app.test/functions/getAuthorizedInboundReferralFax', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function runtime({ referral = referralResult(), fax = faxRow() } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      auth: {
        me: async () => ({
          id: 'user-a',
          email: 'intake@example.test',
          role: 'user',
          is_active: true,
          is_verified: true,
        }),
      },
      functions: {
        invoke: async (name, payload) => {
          calls.push({ type: 'invoke', name, payload: structuredClone(payload) });
          return structuredClone(referral);
        },
      },
      asServiceRole: {
        entities: {
          IncomingFax: {
            filter: async (query, sort, limit) => {
              calls.push({ type: 'filter', query: structuredClone(query), sort, limit });
              return [structuredClone(fax)];
            },
          },
        },
      },
    },
  };
}

test('authorized staff receive an exact no-store fax capability after two referral checks', async () => {
  const state = runtime();
  const handler = await loadHandler(() => state.client);
  const response = await handler(request());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, {
    success: true,
    referral_id: 'referral-a',
    incoming_fax_id: 'incoming-a',
    delivery: { download_url: 'https://media.telnyx.test/incoming-a.pdf' },
    scope: {
      agency_id: 'agency-a',
      membership_id: 'membership-a',
      membership_version: 2,
      tenant_role: 'office_staff',
    },
  });
  assert.equal(state.calls.filter((call) => call.type === 'invoke').length, 2);
  assert.equal(state.calls.filter((call) => call.type === 'filter').length, 2);
  for (const call of state.calls.filter((item) => item.type === 'filter')) {
    assert.deepEqual(call.query, { id: 'incoming-a', agency_id: 'agency-a' });
    assert.equal(call.limit, 10);
  }
});

test('foreign or false-success IncomingFax rows are rejected without disclosing a URL', async () => {
  const state = runtime({ fax: faxRow({ agency_id: 'agency-b' }) });
  const handler = await loadHandler(() => state.client);
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(await response.json()), /media\.telnyx/);
  assert.equal(state.calls.filter((call) => call.type === 'invoke').length, 1);
});

test('fax document path stores no capability on Referral or in browser source', async () => {
  const [worker, page, wrapper] = await Promise.all([
    readFile(new URL('../functions/processInboundFaxes/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/ReferralFollowUp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/functions/getAuthorizedInboundReferralFax.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(worker, /fax_back\s*:\s*\{[\s\S]{0,300}document_url/);
  assert.doesNotMatch(page, /tracking\.fax_back\.document_url/);
  assert.match(page, /getAuthorizedInboundReferralFax\(/);
  assert.match(wrapper, /functions\.invoke\('getAuthorizedInboundReferralFax'/);
});


test('a suggestion can be reviewed without pretending it is an accepted referral attachment', async () => {
  const state = runtime({
    referral: referralResult({ follow_up_requests: { status: 'sent', items: [] } }),
    fax: faxRow({ status: 'unread', routed_to: null, routed_at: null,
      ai_category: 'referral', suggested_routing: 'admin', processing_notification_state: 'completed' }),
  });
  const handler = await loadHandler(() => state.client);
  const response = await handler(request({ agency_id: 'agency-a', referral_id: 'referral-a',
    incoming_fax_id: 'incoming-a', relationship: 'suggested' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).delivery.download_url, 'https://media.telnyx.test/incoming-a.pdf');
  assert.equal(state.calls.filter((call) => call.type === 'invoke').length, 2);
});

test('suggestion requests cannot expose another referral fax or an unfinished result', async () => {
  for (const invalid of [{ suggested_referral_id: 'referral-b' }, { processing_status: 'processing' },
    { processing_notification_state: 'started' }, { agency_id: 'agency-b' }]) {
    const state = runtime({
      referral: referralResult({ follow_up_requests: { status: 'sent', items: [] } }),
      fax: faxRow({ status: 'unread', routed_to: null, routed_at: null,
        ai_category: 'referral', suggested_routing: 'admin', processing_notification_state: 'completed', ...invalid }),
    });
    const handler = await loadHandler(() => state.client);
    const response = await handler(request({ agency_id: 'agency-a', referral_id: 'referral-a',
      incoming_fax_id: 'incoming-a', relationship: 'suggested' }));
    assert.equal(response.status, 409);
    assert.doesNotMatch(JSON.stringify(await response.json()), /media\.telnyx/);
  }
});
