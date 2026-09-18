import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHORITY_CONTRACT, STAGING_APP_ID, createStagingAuthorityClient } from './client.mjs';

const config = { appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_synthetic_test_key', authUserId: '10000000-0000-4000-8000-000000000001',
  email: 'info+pennsync-admin-a@caremetricai.com' };
const params={p_agency_id:'agency-a',p_patient_id:'patient-a1',p_expected_actor_version:1,p_expected_patient_version:1,p_request_id:'60000000-0000-4000-8000-000000000001',p_fields:{patient_name:'Synthetic Patient A1',priority:'normal',document_type:'manual',status:'new',requires_manual_review:true,manually_confirmed:false}};
const user = { id: config.authUserId, email: config.email, email_confirmed_at: '2026-09-18T00:00:00Z', role: 'authenticated', is_anonymous: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function record() {
 const common={contract:AUTHORITY_CONTRACT,app_id:STAGING_APP_ID,auth_user_id:config.authUserId,staging:true,synthetic:true};
 const context={...common,user_id:'6aac58fe36c13a1c49ba7cf8',user_email:config.email,identity_version:1,is_platform_owner:false,
  agency_id:'agency-a',membership_id:'membership-a',membership_key:'agency-a:6aac58fe36c13a1c49ba7cf8',membership_version:1,membership_status:'active',tenant_role:'agency_admin',agency:{id:'agency-a',name:'Synthetic Agency A',status:'active'}};
 return {contract:'cm.pennsync.s3-referral.staging.v1',staging:true,synthetic:true,app_id:STAGING_APP_ID,action:'create',context,
 request_id:params.p_request_id,replayed:false,receipt:{payload_sha256:'a'.repeat(64),referral_sha256:'b'.repeat(64)},
 referral:{...params.p_fields,id:'30000000-0000-4000-8000-000000000001',agency_id:'agency-a',patient_id:'patient-a1',version:1,
 created_by_user_id:context.user_id,created_by_user_email_normalized:config.email,created_by:config.email,client_request_id:params.p_request_id,
 referral_creation_key:`agency-a:${context.user_id}:${params.p_request_id}`,created_date:'2026-09-18T12:00:00.000Z',updated_date:'2026-09-18T12:00:00.000Z'}};
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



test('finite manual create, confirm and current read preserve exact source states',async()=>{
 let result=record();const {client}=await signed(()=>json(result));
 assert.deepEqual(await client.rpc('s3_create',params),result);
 const confirm=Object.fromEntries(Object.entries(params).filter(([key])=>key!=='p_fields'));confirm.p_referral_id=result.referral.id;confirm.p_expected_referral_version=1;
 confirm.p_request_id='60000000-0000-4000-8000-000000000002';
 result={...result,action:'confirm',request_id:confirm.p_request_id,referral:{...result.referral,version:2,status:'ready_for_admission',requires_manual_review:false,manually_confirmed:true}};
 assert.deepEqual(await client.rpc('s3_confirm',confirm),result);
 const read=Object.fromEntries(Object.entries(confirm).filter(([key])=>!['p_request_id','p_expected_referral_version'].includes(key)));
 const other=Object.fromEntries(Object.entries(result).filter(([key])=>!['request_id','replayed','receipt'].includes(key)));result={...other,action:'read',referral_sha256:'b'.repeat(64)};
 assert.deepEqual(await client.rpc('s3_read',read),result);await client.signOut();
});
test('malformed requests never reach the network',async()=>{
 const {client,calls}=await signed();const before=calls.length;
 for(const value of [{},{...params,p_patient_id:'wrong id'},{...params,p_expected_actor_version:0},{...params,p_request_id:'bad'},
 {...params,p_fields:{...params.p_fields,document_url:'private'}},{...params,p_fields:{...params.p_fields,status:'ready_for_admission'}},
 {...params,p_fields:{...params.p_fields,patient_name:'Customer'}},{...params,p_fields:{...params.p_fields,priority:'other'}}]) {
  await assert.rejects(client.rpc('s3_create',value),/INVALID_AUTHORITY_REQUEST/);
 }
 assert.equal(calls.length,before);await client.signOut();
});
test('foreign, stale, forged or mismatched referral responses are withheld',async t=>{
 const changes=[r=>r.context.membership_version++,r=>r.context.tenant_role='clinician',r=>r.context.auth_user_id='foreign',r=>r.action='confirm',
 r=>r.request_id='60000000-0000-4000-8000-000000000002',r=>r.referral.patient_id='foreign',r=>r.referral.agency_id='agency-b',
 r=>r.referral.priority='urgent',r=>r.referral.patient_name='Synthetic Other',r=>r.referral.version=2,r=>r.referral.created_by='other@example.invalid',
 r=>r.referral.client_request_id='bad',r=>r.referral.referral_creation_key='other',r=>r.referral.updated_date='bad',r=>r.receipt.payload_sha256='bad',
 r=>r.referral.document_url='extra',r=>r.contract=AUTHORITY_CONTRACT];
 for (const [index,change] of changes.entries()) await t.test(`substitution ${index+1}`,async()=>{
  const result=record();change(result);const {client}=await signed(()=>json(result));
  await assert.rejects(client.rpc('s3_create',params),/INVALID_AUTHORITY_RESPONSE/);await client.signOut();
 });
});
test('nested fields are snapshotted and late write responses remain fenced',async()=>{
 let release;const gate=new Promise(done=>{release=done});const result=record();
 const {client}=await signed(async()=>{await gate;return json(result)});
 const input=structuredClone(params);const pending=client.rpc('s3_create',input);input.p_fields.priority='urgent';release();
 assert.deepEqual(await pending,result);await client.signOut();
 let complete;const delayed=new Promise(done=>{complete=done});const second=await signed(async()=>{await delayed;return json(result)});
 const late=second.client.rpc('s3_create',params);second.client.invalidate();complete();await assert.rejects(late);await second.client.signOut();
});

const listParams={p_agency_id:'agency-a',p_patient_id:'patient-a1',p_expected_actor_version:1,p_expected_patient_version:1,p_limit:1,p_after_id:null};
function listing(){const r=record();return {contract:'cm.pennsync.s3-referral-list.staging.v1',staging:true,synthetic:true,app_id:STAGING_APP_ID,action:'list',context:r.context,items:[{referral:r.referral,referral_sha256:'b'.repeat(64)}],next_cursor:null};}
test('saved referral discovery validates exact current records and bounded cursor',async()=>{
 const result=listing(),{client}=await signed(()=>json(result));assert.deepEqual(await client.rpc('s3_list',listParams),result);
 result.next_cursor=result.items[0].referral.id;assert.deepEqual(await client.rpc('s3_list',listParams),result);
 result.items=[];result.next_cursor=null;assert.deepEqual(await client.rpc('s3_list',listParams),result);await client.signOut();
});
for(const patch of [{p_limit:0},{p_limit:51},{p_limit:1.1},{p_after_id:''},{p_after_id:'foreign'},{p_expected_actor_version:0},{extra:true}])test(`saved referral list rejects invalid request ${JSON.stringify(patch)}`,async()=>{
 const {client,calls}=await signed();const count=calls.length;await assert.rejects(client.rpc('s3_list',{...listParams,...patch}),/INVALID_AUTHORITY_REQUEST/);assert.equal(calls.length,count);await client.signOut();
});
for(const [label,change] of [
 ['foreign patient',r=>r.items[0].referral.patient_id='patient-b1'],['foreign agency',r=>r.context.agency_id='agency-b'],
 ['stale membership',r=>r.context.membership_version++],['clinician',r=>r.context.tenant_role='clinician'],
 ['unknown key',r=>r.items[0].extra=true],['bad checksum',r=>r.items[0].referral_sha256='bad'],
 ['duplicate',r=>r.items.push(structuredClone(r.items[0]))],['extra row',r=>r.items.push({...r.items[0],referral:{...r.items[0].referral,id:'30000000-0000-4000-8000-000000000002'}})],
 ['cursor mismatch',r=>r.next_cursor='30000000-0000-4000-8000-000000000002'],['missing cursor',r=>delete r.next_cursor],
 ['extra payload field',r=>r.items[0].referral.document_url='private'],['status mismatch',r=>r.items[0].referral.status='ready_for_admission'],
])test(`saved referral list withholds ${label}`,async()=>{
 const result=listing();change(result);const {client}=await signed(()=>json(result));await assert.rejects(client.rpc('s3_list',listParams),/INVALID_AUTHORITY_RESPONSE/);await client.signOut();
});
test('saved referral pages cannot repeat or precede their anchor',async()=>{
 const result=listing(),{client}=await signed(()=>json(result));await assert.rejects(client.rpc('s3_list',{...listParams,p_after_id:result.items[0].referral.id}),/INVALID_AUTHORITY_RESPONSE/);await client.signOut();
});
