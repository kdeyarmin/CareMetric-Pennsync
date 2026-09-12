import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ACTOR, NATIVE, makeFixture, nativeRequest } from './centralAdminHarness.mjs';

const fields=JSON.parse(readFileSync(new URL('../_shared/pennsyncLearningSourceFields.json',import.meta.url),'utf8'));
const operation={operation:'learning.source.snapshot'};
const sms={headers:{'X-CareMetric-Hub-Authorization':'Bearer cmh_'+'x'.repeat(43)}};
const id=n=>n.toString(16).padStart(24,'0');
function fixture(options={}) {
  const data=Object.fromEntries(Object.keys(fields).filter(name=>!['User','Agency','AgencyMembership'].includes(name)).map(name=>[name,[]]));
  data.TrainingCourse=[{id:id(1),title:'Original course',status:'published',passing_score:83,ceu_hours:1.25,retake_settings_json:{maximum:2},private_unrelated:'omit'}];
  data.TrainingModule=[{id:id(2),course_id:id(1),type:'lesson',content_json:{sections:[{heading:'Section',body:'Exact lesson'}]}},{id:id(3),content:{text:'Standalone training'},is_required:true}];
  data.TrainingQuestion=[{id:id(4),course_id:id(1),type:'multi_select',prompt:'Select both',correct_answer_json:{answer:['a','b']},options_json:[{value:'a',label:'First'},{value:'b',label:'Second'}]}];
  data.TrainingCompletion=[{id:id(5),training_module_id:id(3),nurse_email:'unregistered@example.test',status:'assigned',due_date:'2026-12-01'}];
  return makeFixture({...options,actor:{user_id:ACTOR,role:'platform_admin',method:'sms',operation},data:{...data,...options.data}});
}
async function snapshot(f,options=sms) {
  const response=await f.handler(nativeRequest(operation,options));
  return {status:response.status,body:await response.json()};
}
test('complete schema field inventory and inline deployed implementation remain exact',()=>{
  for(const [name,projected] of Object.entries(fields)) {
    if(['User','Agency','AgencyMembership'].includes(name))continue;
    const schema=JSON.parse(readFileSync(new URL(`../entities/${name}.jsonc`,import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,''));
    assert.deepEqual(projected,['id','created_date','updated_date',...Object.keys(schema.properties)]);
  }
  execFileSync(process.execPath,['tools-sync-pennsync-learning-source.mjs','--check']);
});
test('preserves exact course policy, all question formats and unassigned legacy identity evidence',async()=>{
  const f=fixture();const result=await snapshot(f);assert.equal(result.status,200);
  const {payload,sourceRevision}=result.body.data;const source=JSON.parse(payload);
  assert.equal(createHash('sha256').update(payload).digest('hex'),sourceRevision);
  assert.equal(source.scope,'private-administrator-migration');
  assert.equal(source.sourceAppId,'694ec16e72e01b60d22f7cbf');
  assert.equal(source.records.TrainingCourse[0].fields.ceu_hours,1.25);
  assert.deepEqual(source.records.TrainingQuestion[0].fields.correct_answer_json,{answer:['a','b']});
  assert.equal(source.records.TrainingCompletion[0].fields.nurse_email,'unregistered@example.test');
  assert.equal(source.records.TrainingCompletion[0].fields.status,'assigned');
  assert.equal(source.records.TrainingModule[1].fields.course_id,undefined);
  assert.equal(payload.includes('private_unrelated'),false);assert.equal(payload.includes('private-patient'),false);
  assert.deepEqual(Object.keys(source.records).sort(),Object.keys(fields).sort());
  assert.equal(f.calls.filter(x=>x.entity==='TrainingCompletion').length,2);
  assert.equal(f.calls.filter(x=>x.entity==='User'&&x.query.id===NATIVE).length,2);
});
test('requires current SMS operation and never accepts legacy JWT source reads',async()=>{
  const f=fixture();assert.equal((await snapshot(f,{})).status,401);assert.equal(f.calls.length,0);
  const mismatch=makeFixture({actor:{user_id:ACTOR,role:'platform_admin',method:'sms',operation:{operation:'overview'}}});
  assert.equal((await snapshot(mismatch)).status,403);assert.equal(mismatch.calls.length,0);
});
test('all pages retained, stable canonical payload across reads and extra native fields discarded',async()=>{
  const courses=Array.from({length:251},(_,i)=>({id:id(i+1),title:`Course ${i}`,unknown:'private'}));
  const f=fixture({data:{TrainingCourse:courses},extraFields:true});
  const a=await snapshot(f),b=await snapshot(f);assert.equal(a.status,200);assert.equal(a.body.data.payload,b.body.data.payload);
  assert.equal(JSON.parse(a.body.data.payload).records.TrainingCourse.length,251);
  assert.equal(a.body.data.payload.includes('unknown'),false);
});
test('source changes during complete second scan fail instead of preserving a mixed revision',async()=>{
  let reads=0;const f=fixture({read:call=>call.entity==='TrainingCourse'?[{id:id(1),title:++reads===1?'First':'Changed'}]:undefined});
  assert.equal((await snapshot(f)).status,503);
});
test('unpaged, duplicate and oversized sources fail closed',async()=>{
  for(const rows of [[{id:id(1)},{id:id(1)}],[{id:id(2)},{id:id(1)}],[{id:id(1),description:'x'.repeat(750001)}]]) {
    const f=fixture({read:call=>call.entity==='TrainingCourse'?rows:undefined});assert.equal((await snapshot(f)).status,503);
  }
});
test('native role revocation during source reads prevents delivery',async()=>{
  let reads=0;const f=fixture({read:call=>call.entity==='User'&&call.query.id===NATIVE?[{id:NATIVE,role:++reads===1?'admin':'user'}]:undefined});
  assert.equal((await snapshot(f)).status,403);
});
test('external assets and embedded credentials become hashed references without fetching them',async()=>{
  const f=fixture({data:{TrainingModule:[{id:id(2),course_id:id(1),video_url:'https://vendor.test/video?token=secret',content_json:{text:'Read https://source.test/doc',token:'secret'}}]}});
  const result=await snapshot(f);assert.equal(result.status,200);const source=JSON.parse(result.body.data.payload);
  assert.equal(result.body.data.payload.includes('vendor.test'),false);assert.equal(result.body.data.payload.includes('Read https'),false);
  assert.equal(source.references.length,3);assert.ok(source.references.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));
  assert.equal(f.hubs.length,1);assert.equal(f.failures.length,0);
});
