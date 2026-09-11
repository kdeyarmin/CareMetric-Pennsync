import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFixture,nativeRequest,ACTOR,STAFF,AGENCY} from './centralAdminHarness.mjs';
const op={operation:'support.identity.resolve',sourceUserId:STAFF,sourceAccountId:AGENCY};
const member={id:'6aa200000000000000000001',user_id:STAFF,agency_id:AGENCY,membership_key:`${AGENCY}:${STAFF}`,tenant_role:'clinician',status:'active',version:1,revoked_at:null};
function fixture(overrides={}){return makeFixture({actor:{user_id:ACTOR,role:'platform_admin',method:'sms',operation:op},data:{AgencyMembership:[{...member,...overrides}]}});}
const read=f=>f.handler(nativeRequest(op,{headers:{'X-CareMetric-Hub-Authorization':`Bearer cmh_${'a'.repeat(43)}`}}));
test('resolves protected membership and emits only IDs, relationship and revision',async()=>{
  const f=fixture(),response=await read(f);assert.equal(response.status,200);const result=await response.json();
  assert.deepEqual(Object.keys(result.data).sort(),['accountKind','product','relationship','revision','sourceAccountId','sourceUserId']);
  assert.equal(result.data.relationship,'agency_member');assert.match(result.data.revision,/^[0-9a-f]{64}$/);
  const before=result.data.revision;f.data.AgencyMembership[0].version=2;assert.notEqual((await(await read(f)).json()).data.revision,before);
  assert.ok(f.calls.every(call=>call.limit===2));assert.ok(!JSON.stringify(result).includes('private'));
});
for(const overrides of [{status:'revoked'},{status:'pending'},{revoked_at:'2026-01-01T00:00:00Z'},{version:0},{version:1.5},{tenant_role:'super_admin'},{user_id:AGENCY},{agency_id:STAFF}]){
  test(`rejects invalid protected membership ${JSON.stringify(overrides)}`,async()=>assert.equal((await read(fixture(overrides))).status,403));
}
test('rejects duplicates, missing users and suspended agencies',async()=>{
  for(const change of ['duplicate','missing','suspended','inactive']){
    const f=fixture();if(change==='duplicate')f.data.AgencyMembership.push({...member,id:'6aa200000000000000000002'});
    if(change==='missing')f.data.User=f.data.User.filter(user=>user.id!==STAFF);
    if(change==='suspended')f.data.Agency[0].status='suspended';if(change==='inactive')f.data.User.find(user=>user.id===STAFF).is_active=false;
    assert.equal((await read(f)).status,403);
  }
});
test('custom profile claims cannot substitute for protected membership',async()=>{
  const f=fixture();f.data.AgencyMembership=[];Object.assign(f.data.User.find(user=>user.id===STAFF),{agency_id:AGENCY,account_type:'super_admin',staff_role:'nurse'});
  assert.equal((await read(f)).status,403);
});
test('requires exact operation-bound SMS authority',async()=>{
  const f=fixture();assert.equal((await f.handler(nativeRequest(op))).status,401);
  const g=makeFixture({actor:{user_id:ACTOR,role:'platform_admin',method:'sms',operation:{...op,sourceUserId:AGENCY}}});assert.equal((await read(g)).status,403);assert.equal(g.calls.length,0);
});
