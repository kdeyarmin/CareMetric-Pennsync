import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';

// The Hub owns the durable job and completion writer. This function only grades
// a single consumed capability against the original, revision-bound source.
const APP_ID='694ec16e72e01b60d22f7cbf',APP_ORIGIN='https://caremetricai.base44.app';
const HUB='https://support-hub-web-production.up.railway.app/api/internal/pennsync-grading';
const encoder=new TextEncoder(),nativeId=/^[a-f0-9]{24}$/,hash=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type Row=Record<string,unknown>;
type Entity={filter:(query:Row,sort:string,limit:number,offset:number,fields:string[])=>Promise<unknown>};
type Client={asServiceRole:{entities:Record<string,Entity>;integrations:{Core:{InvokeLLM:(input:Row)=>Promise<unknown>}}};cleanup?:()=>void};
type Question={id:string;revision:string;answer:string;maxPoints:number};
type Claim={contract:string;jobId:string;enrollmentId:string;versionId:string;tenantId:string;sourceLearnerId:string;sourceAccountId:string;
  sourceRevision:string;answerHash:string;course:{id:string;revision:string};questions:Question[];resultTicket:string;expiresAt:string};
type Evaluation={questionId:string;scoreAwarded:number;maxPoints:number;confidence:number;feedback:string};
type Options={getEnv:(name:string)=>string|undefined;createClient?:(request:Request)=>Client;fetcher?:typeof fetch;now?:()=>number};

function object(v:unknown):Row{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid object');return v as Row;}
function exact(v:unknown,keys:string[]):Row{const r=object(v);if(Object.keys(r).sort().join('|')!==[...keys].sort().join('|'))throw new Error('Invalid fields');return r;}
function pattern(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))throw new Error('Invalid identity');return v;}
function boundedText(v:unknown,max:number,empty=false):string{if(typeof v!=='string'||v.length>max||!empty&&!v.trim())throw new Error('Invalid text');return v;}
function number(v:unknown,min:number,max:number):number{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Invalid number');return v;}
function canonical(v:unknown):string{
  if(v===null||['string','number','boolean'].includes(typeof v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  const r=object(v);return '{'+Object.keys(r).sort().map(k=>JSON.stringify(k)+':'+canonical(r[k])).join(',')+'}';
}
async function sha(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(v))),b=>b.toString(16).padStart(2,'0')).join('');}
async function secretMatches(expected:string,actual:string){
  if(actual.length!==expected.length)return false;
  const a=await sha(expected),b=await sha(actual);let mismatch=0;
  for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;
}
async function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();let abort=()=>{};
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{abort=()=>reject(new Error('Deadline'));signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
}
async function readJson(input:Request|Response,max:number,signal:AbortSignal):Promise<unknown>{
  if(input.headers.get('content-length')&&Number(input.headers.get('content-length'))>max)throw new Error('Oversized body');
  const reader=input.body?.getReader();if(!reader)throw new Error('Missing body');let length=0;const chunks:Uint8Array[]=[];
  try{while(true){const r=await bounded(reader.read(),signal);if(r.done)break;length+=r.value.length;if(length>max)throw new Error('Oversized body');chunks.push(r.value);}}
  catch(error){void reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  const data=new Uint8Array(length);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}
export function parseGradingClaim(value:unknown,now:number):Claim{
  const r=exact(value,['contract','jobId','enrollmentId','versionId','tenantId','sourceLearnerId','sourceAccountId','sourceRevision','answerHash','course','questions','resultTicket','expiresAt']);
  if(r.contract!=='caremetric.pennsync-grading.v1')throw new Error('Invalid contract');
  for(const key of ['jobId','enrollmentId','versionId','tenantId'])pattern(r[key],uuid);
  for(const key of ['sourceLearnerId','sourceAccountId'])pattern(r[key],nativeId);
  for(const key of ['sourceRevision','answerHash'])pattern(r[key],hash);
  const course=exact(r.course,['id','revision']);pattern(course.id,nativeId);pattern(course.revision,hash);
  pattern(r.resultTicket,/^cmr_[A-Za-z0-9_-]{43}$/);
  const expiry=Date.parse(boundedText(r.expiresAt,40));if(!Number.isFinite(expiry)||expiry<=now+10000||expiry>now+180000)throw new Error('Invalid deadline');
  if(!Array.isArray(r.questions)||!r.questions.length||r.questions.length>100)throw new Error('Invalid question count');
  const ids=new Set<string>();
  for(const q of r.questions){const row=exact(q,['id','revision','answer','maxPoints']);const id=pattern(row.id,nativeId);pattern(row.revision,hash);boundedText(row.answer,12000);number(row.maxPoints,0.000001,100);if(ids.has(id))throw new Error('Duplicate question');ids.add(id);}
  return r as unknown as Claim;
}
export function validateGradingResult(value:unknown,questions:Question[]):Evaluation[]{
  const r=exact(value,['evaluations']);if(!Array.isArray(r.evaluations)||r.evaluations.length!==questions.length)throw new Error('Incomplete result');
  const seen=new Set<string>();const evaluations=r.evaluations.map(value=>{
    const e=exact(value,['questionId','scoreAwarded','maxPoints','confidence','feedback']),id=pattern(e.questionId,nativeId),q=questions.find(q=>q.id===id);
    if(!q||seen.has(id)||e.maxPoints!==q.maxPoints)throw new Error('Invalid result binding');seen.add(id);
    return {questionId:id,scoreAwarded:number(e.scoreAwarded,0,q.maxPoints),maxPoints:q.maxPoints,confidence:number(e.confidence,0,1),feedback:boundedText(e.feedback,8000,true)};
  });
  return questions.map(q=>evaluations.find(e=>e.questionId===q.id)!);
}

// BEGIN NATIVE GRADING SOURCE
// Generated from the existing native educator prompt and exact source projection.
const gradingSourceFields:Record<string,string[]>={"TrainingCourse":["id","created_date","updated_date","title","short_description","description","training_type","annual_cycle_year","category","business_line_scope","employee_audience","purpose","reading_level","role_targets","tags","estimated_minutes","status","version","created_by","published_by","published_date","approved_by","approved_at","learning_objectives","passing_score","certificate_valid_months","is_mandatory","recurrence_rule","ai_generated","needs_sme_review","policy_references","citation_count","enable_certificate","requires_attestation","attestation_text","ceu_hours","allow_answer_review","include_case_scenarios","include_key_takeaways","certificate_wording","references_json","ai_prompt_json","retake_settings_json","test_settings_json","attachment_urls","attachment_names","archived_status","real_world_relevance","regulatory_crosswalk_json","competency_skills_json","pre_assessment_json","brain_sparks_json"],"TrainingQuestion":["id","created_date","updated_date","course_id","type","prompt","options_json","correct_answer_json","rationale","rubric","difficulty","question_bank_tag","version","active","source_citations_json","order_index","points"]};
function educatorPrompt(questionsForGrading:unknown){return `You are an experienced healthcare compliance educator and clinical instructor with expertise in CMS Conditions of Participation, OSHA standards, and evidence-based clinical practice. Patient safety is your top priority. Grade each learner response below and return JSON only.

GRADING CRITERIA:
- Award full points when the response demonstrates correct understanding AND practical application ability
- Award partial points (50-75%) when the response shows understanding but misses key details or clinical specifics
- Award minimal points (25%) when the response shows basic awareness but significant gaps in understanding
- Award zero points when the response is incorrect, dangerously wrong, or shows no understanding
- For clinical/compliance questions: accuracy is paramount — incorrect clinical information must receive zero points regardless of how well-written
- For scenario-based questions: evaluate whether the learner's proposed actions would lead to safe, compliant patient care
- Be strict on safety-critical content (medication errors, patient safety, HIPAA violations) but fair on stylistic differences

FEEDBACK REQUIREMENTS:
- Explain what was correct in the response
- Identify what was missing or incorrect with specific detail
- For incorrect answers: explain the correct approach and why it matters for patient care
- Keep feedback constructive and educational — this is a learning opportunity

Return this exact JSON structure:
{"evaluations":[{"questionId":"","scoreAwarded":0,"maxPoints":1,"confidence":0.0,"feedback":""}]}

Questions to grade:
${JSON.stringify(questionsForGrading)}`;}
// END NATIVE GRADING SOURCE

export function createCentralLearningGrade({getEnv,createClient=createClientFromRequest,fetcher=fetch,now=Date.now}:Options){
  const reply=(status:number,code:string)=>Response.json({status:code},{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
  return async(request:Request):Promise<Response>=>{
    let client:Client|undefined;
    try{
      const key=getEnv('HUB_LEARNING_GRADING_SECRET')??'';
      if(getEnv('CAREMETRIC_HUB_GRADING_ENABLED')!=='true'||!/^[A-Za-z0-9_-]{43,128}$/.test(key))return reply(503,'unconfigured');
      if(request.method!=='POST')return reply(405,'method_not_allowed');
      if(request.headers.get('Origin')?.trim())return reply(403,'forbidden');
      if(!await secretMatches(key,request.headers.get('X-CareMetric-Grading-Key')??''))return reply(401,'unauthenticated');
      if(request.headers.get('Content-Type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return reply(415,'unsupported_content_type');
      const service=request.headers.get('Base44-Service-Authorization')??'',dataEnv=request.headers.get('X-Data-Env');
      if(request.headers.get('Base44-App-Id')!==APP_ID||dataEnv!==null&&dataEnv!=='prod'||!/^Bearer [^\s,]+$/.test(service)||service.length>8192)return reply(403,'forbidden');
      const initial=AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
      let ticket:string;
      try{ticket=pattern(exact(await readJson(request,1024,initial),['ticket']).ticket,/^cmg_[A-Za-z0-9_-]{43}$/);}catch{return reply(400,'invalid_request');}
      const callback=async(path:string,body:unknown,signal:AbortSignal)=>{
        const response=await bounded(fetcher(HUB+path,{method:'POST',redirect:'manual',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)}),signal);
        if(response.redirected||response.status>=300&&response.status<400)throw new Error('Redirect refused');
        return response;
      };
      const claimed=await callback('/claim',{ticket},initial);
      if(!claimed.ok)return reply(claimed.status===401?401:claimed.status===403?403:claimed.status===409?409:503,'claim_unavailable');
      const claim=parseGradingClaim(await readJson(claimed,250000,initial),now());
      // After a claim, preserve the outcome even if the dispatcher's response is
      // lost. Completion never depends on the original socket remaining open.
      const workDeadline=Math.min(now()+90000,Date.parse(claim.expiresAt)-1000);
      const work=AbortSignal.timeout(Math.max(1,workDeadline-now()));
      let sourceSignal=AbortSignal.any([work,AbortSignal.timeout(Math.max(1,Math.min(20000,workDeadline-now()-10000)))]);
      const persist=async(outcome:Row)=>{
        const payload={contract:claim.contract,jobId:claim.jobId,answerHash:claim.answerHash,sourceRevision:claim.sourceRevision,...outcome};
        const resultHash=await sha(canonical(payload)),body={ticket:claim.resultTicket,resultHash,result:payload};
        for(let attempt=0;attempt<3;attempt++){
          try{
            const response=await callback('/result',body,work);
            if(!response.ok){if(response.status<500)return false;continue;}
            const ack=exact(await readJson(response,4096,work),['jobId','resultHash','status']);
            return ack.jobId===claim.jobId&&ack.resultHash===resultHash&&ack.status==='stored';
          }catch{if(work.aborted)return false;}
        }
        return false;
      };
      const read=async(name:string,id:string,fields:string[])=>{
        sourceSignal.throwIfAborted();
        const data=await bounded(client!.asServiceRole.entities[name].filter({id},'id',2,0,fields),sourceSignal);
        if(!Array.isArray(data)||data.length!==1||object(data[0]).id!==id)throw new Error('Source unavailable');
        const row=object(data[0]);return Object.fromEntries(fields.filter(f=>row[f]!==undefined).map(f=>[f,row[f]]));
      };
      const requireNativeLearner=async()=>{
        const learner=await read('User',claim.sourceLearnerId,['id','role','is_active']);if(learner.is_active===false)throw new Error('Learner unavailable');
        const agency=await read('Agency',claim.sourceAccountId,['id','status']);if(!['active','trial'].includes(String(agency.status)))throw new Error('Agency unavailable');
        if(learner.role!=='admin'){
          sourceSignal.throwIfAborted();
          const memberships=await bounded(client!.asServiceRole.entities.AgencyMembership.filter({user_id:claim.sourceLearnerId,status:'active'},'id',2,0,['id','user_id','agency_id','status','revoked_at']),sourceSignal);
          if(!Array.isArray(memberships)||memberships.length!==1)throw new Error('Membership unavailable');
          const m=object(memberships[0]);if(m.user_id!==claim.sourceLearnerId||m.agency_id!==claim.sourceAccountId||m.status!=='active'||m.revoked_at)throw new Error('Membership unavailable');
        }
      };
      let questionsForGrading:Row[];
      try{
        client=createClient(new Request(APP_ORIGIN,{method:'POST',headers:{'Base44-App-Id':APP_ID,'Base44-Service-Authorization':service}}));
        await requireNativeLearner();
        const course=await read('TrainingCourse',claim.course.id,gradingSourceFields.TrainingCourse);
        if(course.status!=='published'||course.archived_status===true||await sha(canonical(course))!==claim.course.revision)throw new Error('Source changed');
        questionsForGrading=[];
        for(const question of claim.questions){
          const q=await read('TrainingQuestion',question.id,gradingSourceFields.TrainingQuestion);
          if(q.active!==true||q.course_id!==claim.course.id||!['short_answer','scenario_based'].includes(String(q.type))||await sha(canonical(q))!==question.revision||(q.points||1)!==question.maxPoints)throw new Error('Source changed');
          questionsForGrading.push({questionId:question.id,question:boundedText(q.prompt,12000),rubric:boundedText(q.rubric||q.rationale,60000),learnerAnswer:question.answer,maxPoints:question.maxPoints});
        }
        if(encoder.encode(JSON.stringify(questionsForGrading)).length>200000)throw new Error('Source too large');
      }catch{
        return await persist({outcome:'not_dispatched',code:'source_unavailable'})?reply(200,'stored'):reply(202,'pending');
      }
      let raw:unknown;
      try{
        work.throwIfAborted();
        if(now()>=workDeadline-10000)return await persist({outcome:'not_dispatched',code:'source_unavailable'})?reply(200,'stored'):reply(202,'pending');
        // One invocation only. A timeout or transport exception may still have
        // incurred provider work and must remain unknown rather than retry.
        raw=await bounded(client.asServiceRole.integrations.Core.InvokeLLM({prompt:educatorPrompt(questionsForGrading),model:'automatic',response_json_schema:{
          type:'object',additionalProperties:false,required:['evaluations'],properties:{evaluations:{type:'array',items:{type:'object',additionalProperties:false,
            required:['questionId','scoreAwarded','maxPoints','confidence','feedback'],properties:{questionId:{type:'string'},scoreAwarded:{type:'number'},maxPoints:{type:'number'},confidence:{type:'number'},feedback:{type:'string'}}}}}}}),
          AbortSignal.any([work,AbortSignal.timeout(Math.max(1,Math.min(60000,workDeadline-now()-10000)))]));
      }catch{return await persist({outcome:'unknown',code:'provider_outcome_unknown'})?reply(200,'stored'):reply(202,'pending');}
      let evaluations:Evaluation[];
      try{evaluations=validateGradingResult(raw,claim.questions);}catch{return await persist({outcome:'invalid',code:'provider_result_invalid'})?reply(200,'stored'):reply(202,'pending');}
      sourceSignal=AbortSignal.any([work,AbortSignal.timeout(6000)]);
      try{await requireNativeLearner();}catch{return await persist({outcome:'invalid',code:'native_access_revoked'})?reply(200,'stored'):reply(202,'pending');}
      try{
        const currentCourse=await read('TrainingCourse',claim.course.id,gradingSourceFields.TrainingCourse);
        if(await sha(canonical(currentCourse))!==claim.course.revision)throw new Error('Course changed');
        for(const q of claim.questions)if(await sha(canonical(await read('TrainingQuestion',q.id,gradingSourceFields.TrainingQuestion)))!==q.revision)throw new Error('Question changed');
      }catch{return await persist({outcome:'invalid',code:'source_changed'})?reply(200,'stored'):reply(202,'pending');}
      return await persist({outcome:'graded',evaluations})?reply(200,'stored'):reply(202,'pending');
    }catch{return reply(503,'unavailable');}
    finally{try{client?.cleanup?.();}catch{/* No sensitive diagnostics. */}}
  };
}
Deno.serve(createCentralLearningGrade({getEnv:name=>Deno.env.get(name)}));
