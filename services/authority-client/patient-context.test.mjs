import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHORITY_CONTRACT, STAGING_APP_ID, createStagingAuthorityClient } from './client.mjs';
import { patientContexts } from '../authority-store/tests/patient-context-fixture.mjs';

const config = { appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_synthetic_test_key', authUserId: '10000000-0000-4000-8000-000000000001',
  email: 'info+pennsync-admin-a@caremetricai.com' };
const params = { p_agency_id: 'agency-a', p_patient_id: 'patient-a1', p_purpose: 'smart_note_context' };
const user = { id: config.authUserId, email: config.email, email_confirmed_at: '2026-09-18T00:00:00Z', role: 'authenticated', is_anonymous: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function record(purpose = 'smart_note_context') {
  const common = { contract: AUTHORITY_CONTRACT, app_id: STAGING_APP_ID, auth_user_id: config.authUserId, staging: true, synthetic: true };
  const patient = structuredClone(patientContexts[0].data);
  return { ...common, context: { ...common, user_id: '6aac58fe36c13a1c49ba7cf8', user_email: config.email,
    identity_version: 1, agency_id: 'agency-a', membership_id: 'membership-a', membership_key: 'agency-a:6aac58fe36c13a1c49ba7cf8',
    membership_version: 1, membership_status: 'active', tenant_role: 'agency_admin', is_platform_owner: false,
    agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' } }, purpose,
  patient: purpose === 'display' ? Object.fromEntries(Object.entries(patient).filter(([key]) => ['id','first_name','middle_name','last_name'].includes(key))) : patient,
  scope: { agency_id: 'agency-a', membership_id: 'membership-a', membership_version: 1, tenant_role: 'agency_admin' } };
}
async function signed(handler = () => json(record())) {
  const calls = [];
  const client = createStagingAuthorityClient(config, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/token?grant_type=password')) return json({ user, access_token: 'synthetic.access.token', token_type: 'bearer' });
    if (url.endsWith('/user')) return json(user);
    if (url.endsWith('/logout?scope=local')) return new Response(null, { status: 204 });
    return handler(url, init);
  } });
  await client.signIn('Synthetic-test-password-only'); return { client, calls };
}

test('both patient purposes preserve exact explicit projections and bind only the selected scope', async () => {
  for (const purpose of ['display','smart_note_context']) {
    const { client, calls } = await signed(() => json(record(purpose)));
    assert.deepEqual(await client.rpc('patient_context', { ...params, p_purpose: purpose }), record(purpose));
    assert.deepEqual(JSON.parse(calls.at(-1).init.body), { ...params, p_purpose: purpose, p_app_id: STAGING_APP_ID });
    assert.equal(calls.at(-1).url, `${config.projectUrl}/rest/v1/rpc/pennsync_staging_patient_context`);
    await client.signOut();
  }
});
test('absent optional fields stay absent and clinical status is not derived from active authority', async () => {
  const value = record(); value.patient = { id: params.p_patient_id, first_name: '😀'.repeat(100), last_name: 'Context',
    status: 'hospitalized', updated_date: '2026-09-18T12:00:00.000Z' };
  value.context.tenant_role = value.scope.tenant_role = 'clinician';
  const { client } = await signed(() => json(value));
  assert.deepEqual((await client.rpc('patient_context', params)).patient, value.patient);
  assert.equal(Object.hasOwn(value.patient,'enhanced_notes_history'), false);
  await client.signOut();
});
test('unsupported purposes and scope substitutes are rejected before HTTP', async () => {
  const { client, calls } = await signed(); const count = calls.length;
  for (const input of [null, {}, { ...params, p_purpose: 'selector' }, { ...params, p_purpose: 'history' },
    { ...params, p_patient_id: '$unsafe' }, { ...params, patient_id: 'patient-a1' }, { ...params, p_expected_actor_version: 1 }]) {
    await assert.rejects(client.rpc('patient_context', input), /INVALID_AUTHORITY_REQUEST/);
  }
  assert.equal(calls.length,count); await client.signOut();
});
test('malformed, extra and foreign context data never crosses the strict client', async t => {
  const changes = [r => { r.patient.id='foreign'; }, r => { r.purpose='display'; }, r => { r.extra=true; },
    r => { r.context.membership_status='revoked'; }, r => { r.scope.agency_id='agency-b'; },
    r => { r.scope.membership_id='foreign'; }, r => { r.scope.membership_version++; }, r => { r.scope.extra=true; },
    r => { r.scope.tenant_role=r.context.tenant_role='manager'; }, r => { r.patient.extra=true; },
    r => { delete r.patient.first_name; }, r => { delete r.patient.status; }, r => { delete r.patient.updated_date; },
    r => { r.patient.first_name='😀'.repeat(101); }, r => { r.patient.last_name='\ufeffName'; },
    r => { r.patient.last_name='Name\u00a0'; }, r => { r.patient.first_name=''; },
    r => { r.patient.middle_name=null; }, r => { r.patient.status='inactive'; }, r => { r.patient.care_type='other'; },
    r => { r.patient.date_of_birth='2026-02-29'; }, r => { r.patient.date_of_birth='0000-01-01'; },
    r => { r.patient.updated_date='2026-09-18T12:00:00Z'; }, r => { r.patient.updated_date='2026-02-30T12:00:00.000Z'; },
    r => { r.patient.updated_date='2026-09-18T08:00:00.000-04:00'; },
    r => { r.patient.secondary_diagnoses=[{}]; }, r => { r.patient.past_medical_history=[null]; },
    r => { r.patient.current_medications=[[]]; }, r => { r.patient.chronic_conditions=Array(501).fill({}); },
    r => { r.patient.enhanced_notes_history=Array(5001).fill({}); }, r => { r.patient.wounds=[null]; },
    r => { r.patient.functional_status=[]; }, r => { r.patient.clinical_notes=1; },
  ];
  for (const [index, change] of changes.entries()) await t.test(`refuse mutation ${index+1}`, async () => {
    const value=record(); change(value); const {client}=await signed(()=>json(value));
    await assert.rejects(client.rpc('patient_context',params), /INVALID_AUTHORITY_RESPONSE/); await client.signOut();
  });
  const display=record('display'); display.patient.clinical_notes='Synthetic hidden clinical field';
  const {client}=await signed(()=>json(display));
  await assert.rejects(client.rpc('patient_context',{...params,p_purpose:'display'}), /INVALID_AUTHORITY_RESPONSE/); await client.signOut();
});
test('patient context retains the one MiB response bound and cancels oversized streamed bytes', async () => {
  let canceled=false;
  const {client}=await signed(()=>new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1048577)); }, cancel() { canceled=true; },
  }), {headers:{'content-type':'application/json'}}));
  await assert.rejects(client.rpc('patient_context',params), /INVALID_AUTHORITY_RESPONSE/);
  assert.equal(canceled,true); await client.signOut();
});
test('logout and caller input mutation cannot release or relabel a delayed response', async () => {
  let release, entered;
  const ready=new Promise(resolve=>{entered=resolve;}); const gate=new Promise(resolve=>{release=resolve;});
  const {client,calls}=await signed(async()=>{entered(); await gate; return json(record());});
  const input={...params}; const pending=client.rpc('patient_context',input).catch(error=>error.code);
  await ready; input.p_patient_id='foreign'; await client.signOut(); release();
  assert.match(await pending,/STALE_AUTHORITY_SESSION|AUTHORITY_REQUEST_ABORTED/);
  assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('pennsync_staging_patient_context')).init.body).p_patient_id,params.p_patient_id);
});
