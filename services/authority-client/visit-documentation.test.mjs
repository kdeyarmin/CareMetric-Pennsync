import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHORITY_CONTRACT, STAGING_APP_ID, createStagingAuthorityClient } from './client.mjs';
import { VISIT_DOCUMENTATION_MAX_BYTES } from './visit-documentation.mjs';

const config = { appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_synthetic_test_key', authUserId: '10000000-0000-4000-8000-000000000001',
  email: 'info+pennsync-admin-a@caremetricai.com' };
const visitId = '30000000-0000-4000-8000-000000000abc';
const params = { p_agency_id: 'agency-a', p_visit_id: visitId };
const user = { id: config.authUserId, email: config.email, email_confirmed_at: '2026-09-18T00:00:00Z',
  role: 'authenticated', is_anonymous: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function record() {
  const common = { contract: AUTHORITY_CONTRACT, app_id: STAGING_APP_ID, auth_user_id: config.authUserId, staging: true, synthetic: true };
  return { ...common, context: { ...common, user_id: '6aac58fe36c13a1c49ba7cf8', user_email: config.email,
    identity_version: 1, agency_id: 'agency-a', membership_id: 'membership-a', membership_key: 'agency-a:6aac58fe36c13a1c49ba7cf8',
    membership_version: 1, membership_status: 'active', tenant_role: 'agency_admin', is_platform_owner: false,
    agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' } }, purpose: 'documentation',
  visit: { id: visitId, patient_id: 'patient-a', visit_date: '2026-09-18', visit_type: 'skilled_nursing', status: 'completed',
    nurse_notes: 'Synthetic saved note.\nExact Unicode: é 心 😀', raw_transcription: 'Synthetic source', vital_signs: { pain_level: 0, weight: 70 },
    documentation_source: 'smart_note', grounding_pending: false, emr_handoff_status: 'not_started', emr_handoff_history: [],
    updated_date: '2026-09-18T12:00:00.000Z' }, scope: { agency_id: 'agency-a', membership_id: 'membership-a',
    membership_version: 1, tenant_role: 'agency_admin', patient_id: 'patient-a', access_basis: 'agency_wide', assignment_id: null,
    assignment_version: null } };
}
function harness(handler = () => json(record())) {
  const calls = [];
  const client = createStagingAuthorityClient(config, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/token?grant_type=password')) return json({ user, access_token: 'synthetic.access.token', token_type: 'bearer' });
    if (url.endsWith('/user')) return json(user);
    if (url.endsWith('/logout?scope=local')) return new Response(null, { status: 204 });
    return handler(url, init);
  } });
  return { client, calls };
}
async function signed(handler) {
  const result = harness(handler); await result.client.signIn('Synthetic-test-password-only'); return result;
}

test('exact documentation read preserves source bytes and sends only selected agency and exact Visit UUID', async () => {
  const { client, calls } = await signed();
  assert.deepEqual(await client.rpc('visit_documentation', params), record());
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { ...params, p_app_id: STAGING_APP_ID });
  assert.equal(calls.at(-1).url, `${config.projectUrl}/rest/v1/rpc/pennsync_staging_visit_documentation`);
  assert.deepEqual((await client.rpc('visit_documentation', { ...params, p_visit_id: visitId.toUpperCase() })).visit, record().visit);
  await client.signOut();
});

test('documentation rejects unsupported inputs and receipt-based substitutes before network access', async () => {
  const { client, calls } = await signed(); const count = calls.length;
  for (const input of [null, {}, { p_agency_id: 'agency-a' }, { ...params, p_visit_id: 'not-a-uuid' },
    { ...params, purpose: 'documentation' }, { ...params, p_patient_id: 'patient-a' },
    { ...params, p_request_id: visitId }, { ...params, maxResponseBytes: 9_000_000 }]) {
    await assert.rejects(client.rpc('visit_documentation', input), /INVALID_AUTHORITY_REQUEST/);
  }
  assert.equal(calls.length, count); await client.signOut();
});

test('documentation rejects foreign scope, invented roles, extra fields and malformed clinical projections', async t => {
  const mutations = [
    r => { r.auth_user_id = visitId; }, r => { r.context.user_id = 'foreign'; },
    r => { r.context.membership_status = 'revoked'; }, r => { r.scope.agency_id = 'agency-b'; },
    r => { r.scope.membership_id = 'foreign'; }, r => { r.scope.membership_version++; },
    r => { r.scope.tenant_role = 'clinician'; }, r => { r.scope.patient_id = 'foreign'; },
    r => { r.scope.assignment_id = visitId; }, r => { r.scope.assignment_version = 1; },
    r => { r.context.tenant_role = r.scope.tenant_role = 'manager'; },
    r => { r.scope.access_basis = 'care_team_assignment'; }, r => { r.scope.extra = true; },
    r => { r.purpose = 'schedule'; }, r => { r.visit.id = config.authUserId; },
    r => { r.visit.patient_id = '$unsafe'; }, r => { r.visit.visit_date = '2026-02-30'; },
    r => { r.visit.visit_type = 'routine_visit'; }, r => { r.visit.status = 'scheduled'; },
    r => { r.visit.nurse_notes = ' '; }, r => { r.visit.nurse_notes = 'a'.repeat(250_001); },
    r => { r.visit.raw_transcription = null; }, r => { r.visit.vital_signs.extra = 1; },
    r => { r.visit.vital_signs.weight = '70'; }, r => { r.visit.vital_signs.weight = 1_000_001; },
    r => { r.visit.vital_signs = []; }, r => { r.visit.documentation_source = 'audio'; },
    r => { r.visit.grounding_pending = true; }, r => { r.visit.emr_handoff_status = 'signed_in_emr'; },
    r => { r.visit.emr_handoff_history = [{}]; }, r => { r.visit.documentation_review_ack = null; },
    r => { r.visit.updated_date = '2026-02-30T12:00:00.000Z'; }, r => { r.visit.updated_date = 'invalid'; },
    r => { delete r.visit.nurse_notes; }, r => { r.visit.agency_id = 'agency-a'; }, r => { r.extra = true; },
  ];
  for (const [index, mutate] of mutations.entries()) await t.test(`malformed projection ${index + 1}`, async () => {
    const value = record(); mutate(value); const { client } = await signed(() => json(value));
    await assert.rejects(client.rpc('visit_documentation', params), /INVALID_AUTHORITY_RESPONSE/); await client.signOut();
  });
});

test('assigned clinician scope requires server-stored assignment UUID and current version', async () => {
  const value = record(); value.context.tenant_role = value.scope.tenant_role = 'clinician';
  value.scope.access_basis = 'care_team_assignment'; value.scope.assignment_id = visitId; value.scope.assignment_version = 2;
  const { client } = await signed(() => json(value));
  assert.deepEqual((await client.rpc('visit_documentation', params)).scope, value.scope);
  for (const [key, invalid] of [['assignment_id', null], ['assignment_id', 'invented'], ['assignment_version', 0], ['assignment_version', 1.5]]) {
    const old = value.scope[key]; value.scope[key] = invalid;
    await assert.rejects(client.rpc('visit_documentation', params), /INVALID_AUTHORITY_RESPONSE/); value.scope[key] = old;
  }
  await client.signOut();
});

test('only documentation receives the bounded larger body allowance and oversized bodies are canceled', async () => {
  const value = record(); value.visit.nurse_notes = '\u0001'.repeat(150_000); value.visit.raw_transcription = '\u0001'.repeat(100_000);
  const bytes = new TextEncoder().encode(JSON.stringify(value)); assert.ok(bytes.length > 1024 * 1024);
  const { client } = await signed(() => json(value));
  assert.deepEqual((await client.rpc('visit_documentation', params)).visit, value.visit);
  await assert.rejects(client.rpc('context', { p_agency_id: 'agency-a' }), /INVALID_AUTHORITY_RESPONSE/);
  await client.signOut();
  for (const declared of [false, true]) {
    let canceled = false;
    const large = await signed(() => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(VISIT_DOCUMENTATION_MAX_BYTES + 1)); },
      cancel() { canceled = true; },
    }), { headers: { 'content-type': 'application/json', ...(declared ? { 'content-length': String(VISIT_DOCUMENTATION_MAX_BYTES + 1) } : {}) } }));
    await assert.rejects(large.client.rpc('visit_documentation', params), /INVALID_AUTHORITY_RESPONSE/);
    // A body rejected by the declared length is not consumed; the request aborts.
    if (!declared) assert.equal(canceled, true);
    await large.client.signOut();
  }
});

test('logout fences a late authorized documentation response before it reaches the caller', async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { client } = await signed(async () => { entered(); await gate; return json(record()); });
  const reading = client.rpc('visit_documentation', params).catch(error => error.code);
  await ready; await client.signOut(); release();
  assert.match(await reading, /STALE_AUTHORITY_SESSION|AUTHORITY_REQUEST_ABORTED/);
});
