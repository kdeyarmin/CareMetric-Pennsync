import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHORITY_CONTRACT, STAGING_APP_ID, createStagingAuthorityClient } from './client.mjs';

const config = { appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_synthetic_test_key', authUserId: '10000000-0000-4000-8000-000000000001',
  email: 'info+pennsync-admin-a@caremetricai.com' };
const params = { p_agency_id: 'agency-a', p_patient_id: 'patient-a1', p_status:null, p_page_size:1, p_cursor:null };
const user = { id: config.authUserId, email: config.email, email_confirmed_at: '2026-09-18T00:00:00Z', role: 'authenticated', is_anonymous: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const visit = { id:'30000000-0000-4000-8000-000000000001',patient_id:'patient-a1',visit_date:'2026-09-18',visit_type:'skilled_nursing',status:'completed',updated_date:'2026-09-18T12:00:00.000Z' };
function record() {
 const common={contract:AUTHORITY_CONTRACT,app_id:STAGING_APP_ID,auth_user_id:config.authUserId,staging:true,synthetic:true};
 const context={...common,user_id:'6aac58fe36c13a1c49ba7cf8',user_email:config.email,identity_version:1,is_platform_owner:false,
  agency_id:'agency-a',membership_id:'membership-a',membership_key:'agency-a:6aac58fe36c13a1c49ba7cf8',membership_version:1,membership_status:'active',tenant_role:'agency_admin',agency:{id:'agency-a',name:'Synthetic Agency A',status:'active'}};
 const scope={agency_id:'agency-a',membership_id:'membership-a',membership_version:1,tenant_role:'agency_admin',patient_id:'patient-a1',access_basis:'agency_wide',assignment_id:null,assignment_version:null};
 return {...common,context,scope,purpose:'schedule',visits:[{...visit}],page:{page_size:1,sort:'id_asc',after_id:null,has_more:false,next_cursor:null}};
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


test('saved visit metadata stays exact and caller cursor mutations cannot change a pending binding',async()=>{
 const first=record();first.page.has_more=true;const cursor={...first.scope,version:1,after_id:visit.id,purpose:'schedule',status:null,sort:'id_asc',page_size:1,subject_user_id:first.context.user_id};first.page.next_cursor=cursor;
 const {client}=await signed(()=>json(first));assert.deepEqual(await client.rpc('visits_schedule',params),first);await client.signOut();
 let release;const barrier=new Promise(done=>{release=done});
 const next=record();next.visits=[];next.page.after_id=visit.id;
 const bound=await signed(async()=>{await barrier;return json(next)});
 const input={...params,p_cursor:structuredClone(cursor)};const pending=bound.client.rpc('visits_schedule',input);
 input.p_cursor.membership_version=7;release();assert.deepEqual(await pending,next);await bound.client.signOut();
});
test('unsupported page/filter/cursor inputs fail before HTTP',async()=>{
 const {client,calls}=await signed();const count=calls.length;
 for(const input of [null,{}, {...params,p_patient_id:null},{...params,p_page_size:51},{...params,p_status:'scheduled'}, {...params,p_cursor:{}},{...params,p_cursor:[]},{...params,extra:true}]) await assert.rejects(client.rpc('visits_schedule',input),/INVALID_AUTHORITY_REQUEST/);
 assert.equal(calls.length,count);await client.signOut();
});
test('metadata, scope and pagination substitutions are withheld',async t=>{
 const changes=[r=>r.visits[0].nurse_notes='private',r=>r.visits[0].patient_id='foreign',r=>r.visits[0].id='bad',
 r=>r.visits[0].visit_date='2026-02-30',r=>r.visits[0].updated_date='invalid',r=>r.visits[0].status='scheduled',
 r=>r.scope.membership_version++,r=>r.scope.assignment_id=visit.id,r=>r.scope.patient_id='foreign',r=>r.page.page_size=2,
 r=>r.page.after_id=visit.id,r=>r.page.has_more=true,r=>r.page.next_cursor={},r=>r.visits.push({...visit}),r=>r.context.membership_status='revoked'];
 for(const [index,change] of changes.entries()) await t.test(`invalid response ${index+1}`,async()=>{const value=record();change(value);const {client}=await signed(()=>json(value));await assert.rejects(client.rpc('visits_schedule',params),/INVALID_AUTHORITY_RESPONSE/);await client.signOut();});
});
test('late list response after session invalidation stays hidden',async()=>{
 let release;const gate=new Promise(done=>{release=done});const {client}=await signed(async()=>{await gate;return json(record())});
 const pending=client.rpc('visits_schedule',params);client.invalidate();release();await assert.rejects(pending);await client.signOut();
});
