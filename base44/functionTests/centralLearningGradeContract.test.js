import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {transpileTs} from '../../tools-transpile-ts.mjs';
const original=readFileSync(new URL('../functions/centralLearningGrade/entry.ts',import.meta.url),'utf8');
const code=transpileTs(original.replace(/^import .*createClientFromRequest.*$/m,'const createClientFromRequest=()=>{throw new Error("No default SDK in tests");};').replace(/^Deno\.serve\(.*\);$/m,'')+'\nexport {canonical,sha,gradingSourceFields};').outputText;
const native=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const id=n=>n.toString(16).padStart(24,'0'),uuid='11111111-1111-4111-8111-111111111111',key='x'.repeat(43),ticket='cmg_'+'t'.repeat(43);
async function fixture(options={}){
 const now=Date.now(),calls=[],factories=[],completions=[],dispatches=[];
 const data={User:[{id:id(1),role:'user',is_active:true}],Agency:[{id:id(2),status:'active'}],AgencyMembership:[{id:id(5),user_id:id(1),agency_id:id(2),status:'active',revoked_at:null}],
  TrainingCourse:[{id:id(3),status:'published',archived_status:false,title:'Fixture course'}],TrainingQuestion:[{id:id(4),course_id:id(3),type:'short_answer',active:true,prompt:'Describe the required actions.',rubric:'Rubric from the original course',rationale:'Private rationale',points:1,correct_answer_json:{answer:'PRIVATE_SOURCE_KEY'}}]};
 const claim={contract:'caremetric.pennsync-grading.v1',jobId:uuid,enrollmentId:uuid,versionId:uuid,tenantId:uuid,sourceLearnerId:id(1),sourceAccountId:id(2),sourceRevision:'a'.repeat(64),answerHash:'b'.repeat(64),
  course:{id:id(3),revision:await native.sha(native.canonical(data.TrainingCourse[0]))},questions:[{id:id(4),revision:await native.sha(native.canonical(data.TrainingQuestion[0])),answer:'Synthetic learner response',maxPoints:1}],
  resultTicket:'cmr_'+'r'.repeat(43),expiresAt:new Date(now+120000).toISOString()};
 let claimed=false,resultCalls=0;
 const fetcher=async(url,init)=>{
  calls.push({url,init});assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer '+key);
  const body=JSON.parse(init.body);
  if(url.endsWith('/claim')){
   assert.deepEqual(body,{ticket});if(claimed)return Response.json({}, {status:409});claimed=true;
   return options.claimResponse?options.claimResponse(claim):Response.json(claim);
  }
  assert.equal(url,'https://support-hub-web-production.up.railway.app/api/internal/pennsync-grading/result');
  resultCalls++;assert.equal(body.ticket,claim.resultTicket);assert.equal(body.resultHash,await native.sha(native.canonical(body.result)));
  if(options.resultFailures&&resultCalls<=options.resultFailures)return Response.json({}, {status:502});
  completions.push(body);return Response.json({jobId:claim.jobId,resultHash:body.resultHash,status:'stored'});
 };
 const createClient=request=>{
  factories.push(request);return {asServiceRole:{entities:Object.fromEntries(Object.keys(data).map(name=>[name,{filter:async(query,sort,limit,offset,fields)=>{
   assert.equal(sort,'id');assert.equal(limit,2);assert.equal(offset,0);
   options.read?.({name,query,data});
   return data[name].filter(row=>Object.entries(query).every(([k,v])=>row[k]===v)).map(row=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
  }}])),integrations:{Core:{InvokeLLM:async input=>{
   dispatches.push(input);if(options.grade)return options.grade({input,data,claim});
   return {evaluations:[{questionId:id(4),scoreAwarded:0.75,maxPoints:1,confidence:0.9,feedback:'Synthetic assessment feedback'}]};
  }}}}};
 };
 const env={HUB_LEARNING_GRADING_SECRET:key,CAREMETRIC_HUB_GRADING_ENABLED:'true',...options.env};
 const handler=native.createCentralLearningGrade({getEnv:name=>env[name],createClient,fetcher,now:()=>now});
 const request=(overrides={})=>new Request('https://caremetricai.base44.app/functions/centralLearningGrade',{method:'POST',headers:{'Content-Type':'application/json','Base44-App-Id':'694ec16e72e01b60d22f7cbf','Base44-Service-Authorization':'Bearer SYNTHETIC_SERVICE','X-CareMetric-Grading-Key':key,...overrides.headers},body:JSON.stringify({ticket}),...overrides});
 return {handler,request,data,claim,calls,factories,completions,dispatches};
}
test('deployed prompt and source projection are exactly generated from the existing native grader',()=>execFileSync(process.execPath,['tools-sync-pennsync-grading-provider.mjs','--check']));
test('only the original source prompt/rubric are graded, with a durable result before success',async()=>{
 const f=await fixture();const response=await f.handler(f.request());assert.equal(response.status,200);assert.equal(f.dispatches.length,1);assert.equal(f.completions.length,1);
 const prompt=f.dispatches[0].prompt;assert.ok(prompt.includes('Rubric from the original course'));assert.ok(prompt.includes('Synthetic learner response'));assert.ok(!prompt.includes('PRIVATE_SOURCE_KEY'));
 assert.equal(f.dispatches[0].model,'automatic');assert.equal(f.completions[0].result.outcome,'graded');assert.equal(f.completions[0].result.evaluations[0].scoreAwarded,0.75);
 assert.equal(f.factories[0].url,'https://caremetricai.base44.app/');assert.deepEqual([...f.factories[0].headers.keys()],['base44-app-id','base44-service-authorization']);
 assert.equal((await f.handler(f.request())).status,409);assert.equal(f.dispatches.length,1);
});
test('retries a lost completion callback with identical bytes but invokes the provider only once',async()=>{
 const f=await fixture({resultFailures:2});assert.equal((await f.handler(f.request())).status,200);assert.equal(f.dispatches.length,1);
 const results=f.calls.filter(c=>c.url.endsWith('/result'));assert.equal(results.length,3);assert.ok(results.every(r=>r.init.body===results[0].init.body));
});
test('an unavailable result callback leaves the claimed job pending without another paid grade',async()=>{
 const f=await fixture({resultFailures:3});assert.equal((await f.handler(f.request())).status,202);assert.equal(f.completions.length,0);assert.equal(f.dispatches.length,1);
 assert.equal((await f.handler(f.request())).status,409);assert.equal(f.dispatches.length,1);
});
test('lost dispatch connection after grading begins does not discard the durable outcome',async()=>{
 const controller=new AbortController();const f=await fixture({grade:({claim})=>{controller.abort();return {evaluations:[{questionId:claim.questions[0].id,scoreAwarded:1,maxPoints:1,confidence:1,feedback:'Good'}]};}});
 assert.equal((await f.handler(f.request({signal:controller.signal}))).status,200);assert.equal(f.completions.length,1);
});
for(const name of ['User','Agency','AgencyMembership','TrainingCourse','TrainingQuestion'])test(`changed or revoked ${name} is rejected before paid work`,async()=>{
 const f=await fixture();if(name==='TrainingQuestion')f.data[name][0].rubric='Changed';else f.data[name]=[];
 assert.equal((await f.handler(f.request())).status,200);assert.equal(f.dispatches.length,0);assert.equal(f.completions[0].result.outcome,'not_dispatched');
});
test('native learner revocation during paid grading prevents a completed grade from authorizing course completion',async()=>{
 const f=await fixture({grade:({data,claim})=>{data.User[0].is_active=false;return {evaluations:[{questionId:claim.questions[0].id,scoreAwarded:1,maxPoints:1,confidence:1,feedback:'Good'}]};}});
 assert.equal((await f.handler(f.request())).status,200);assert.equal(f.dispatches.length,1);assert.equal(f.completions[0].result.code,'native_access_revoked');
});
test('ambiguous native memberships fail instead of selecting one tenant',async()=>{
 const f=await fixture();f.data.AgencyMembership.push({...f.data.AgencyMembership[0],id:id(6),agency_id:id(7)});
 assert.equal((await f.handler(f.request())).status,200);assert.equal(f.dispatches.length,0);assert.equal(f.completions[0].result.outcome,'not_dispatched');
});
test('source edits during grading invalidate the result without paying for a replacement grade',async()=>{
 const f=await fixture({grade:({data,claim})=>{data.TrainingQuestion[0].rubric='Changed';return {evaluations:[{questionId:claim.questions[0].id,scoreAwarded:1,maxPoints:1,confidence:1,feedback:'Good'}]};}});
 assert.equal((await f.handler(f.request())).status,200);assert.equal(f.dispatches.length,1);assert.equal(f.completions[0].result.code,'source_changed');
});
test('provider transport failure has an unknown outcome and never silently scores zero or retries',async()=>{
 const f=await fixture({grade:()=>{throw new Error('Synthetic transport detail');}});assert.equal((await f.handler(f.request())).status,200);
 assert.equal(f.dispatches.length,1);assert.deepEqual(f.completions[0].result.outcome,'unknown');assert.equal(f.completions[0].result.evaluations,undefined);
});
for(const bad of [[],[{questionId:id(4),scoreAwarded:2,maxPoints:1,confidence:0.9,feedback:'Bad'}],[{questionId:id(4),scoreAwarded:0.5,maxPoints:2,confidence:0.9,feedback:'Bad'}],[{questionId:id(9),scoreAwarded:1,maxPoints:1,confidence:0.9,feedback:'Bad'}]])test(`partial or invalid provider result ${JSON.stringify(bad).slice(0,45)} is not a grade`,async()=>{
 const f=await fixture({grade:()=>({evaluations:bad})});assert.equal((await f.handler(f.request())).status,200);assert.equal(f.completions[0].result.outcome,'invalid');
});
test('default-off configuration never obtains a claim or loads the SDK',async()=>{
 const f=await fixture({env:{CAREMETRIC_HUB_GRADING_ENABLED:'false'}});assert.equal((await f.handler(f.request())).status,503);assert.equal(f.calls.length+f.factories.length,0);
});
test('browser origins, wrong keys, wrong app and caller-supplied prompts cannot invoke grading',async()=>{
 for(const headers of [{Origin:'null'},{'X-CareMetric-Grading-Key':'bad'},{'Base44-App-Id':'bad'}]){
  const f=await fixture(),request=f.request();for(const [k,v] of Object.entries(headers))request.headers.set(k,v);
  assert.ok([401,403].includes((await f.handler(request)).status));assert.equal(f.calls.length+f.factories.length,0);
 }
 const f=await fixture();assert.equal((await f.handler(f.request({body:JSON.stringify({ticket,prompt:'Arbitrary prompt'})}))).status,400);assert.equal(f.calls.length,0);
});
test('closed claim rejects extra prompts, duplicate questions and stale deadlines',async()=>{
 for(const alter of [c=>({...c,prompt:'forged'}),c=>({...c,questions:[c.questions[0],c.questions[0]]}),c=>({...c,expiresAt:new Date(0).toISOString()})]){
  const f=await fixture({claimResponse:c=>Response.json(alter(c))});assert.equal((await f.handler(f.request())).status,503);assert.equal(f.dispatches.length,0);
 }
});
