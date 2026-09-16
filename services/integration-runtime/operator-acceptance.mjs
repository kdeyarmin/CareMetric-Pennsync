import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig, createStore, performDurable, BUCKET } from './runtime.mjs';
import { createProviders } from './providers.mjs';
import { hash, IntegrationError, fail, limitedBytes } from './safety.mjs';

// Operator CLI only: never imported by server.mjs or exposed as an HTTP route.
// Every payload is fixed synthetic data; no caller payload, account lookup,
// clinical record, real recipient, file list or Base44 function is permitted.
export const FIXTURE = 'asset,mileage\nSynthetic acceptance vehicle,12345\n';
const SCHEMA = { type:'object', properties:{asset:{type:'string'},mileage:{type:'integer'}}, required:['asset','mileage'], additionalProperties:false };
const VALIDATION_TOKEN = 'explicit-synthetic-v1';

export async function runOperatorAcceptance(config, { authorization, fetcher = fetch, store: injectedStore, provider: injectedProvider } = {}) {
  if (authorization !== VALIDATION_TOKEN || config.released || !config.configured || !config.anthropicKey || !config.sendgridKey) fail(403,'OPERATOR_ACCEPTANCE_NOT_AUTHORIZED');
  const counts={modelRequests:0,emailSandboxRequests:0,storageUploads:0,storageDownloads:0,stateRequests:0,base44Requests:0};
  const checks={};
  const subject=hash(config.hashKey,[config.appId,'operator-only-synthetic-acceptance-v1']);
  const actor={subject,snapshot:'operator-synthetic-fixture-not-an-employee',canEmail:true};
  async function fixedEgress(input, options = {}) {
    const url=new URL(input);
    const method=options.method || 'GET';
    if(url.username || url.password || url.hash) fail(403,'ACCEPTANCE_EGRESS_REJECTED');
    if(url.origin==='https://api.anthropic.com' && url.pathname==='/v1/messages' && !url.search && method==='POST') {
      if(counts.modelRequests>=3)fail(409,'ACCEPTANCE_MODEL_BUDGET');
      counts.modelRequests++;
    } else if(url.origin==='https://api.sendgrid.com' && url.pathname==='/v3/mail/send' && !url.search && method==='POST') {
      const body=JSON.parse(options.body);
      if(body.mail_settings?.sandbox_mode?.enable!==true || body.personalizations?.length!==1 || body.personalizations[0]?.to?.length!==1
        || body.personalizations[0].to[0]?.email!=='acceptance@example.invalid' || counts.emailSandboxRequests>=1)fail(403,'ACCEPTANCE_EMAIL_NOT_SANDBOXED');
      counts.emailSandboxRequests++;
    } else if(url.origin===config.supabaseUrl) {
      if(url.pathname.startsWith('/rest/v1/rpc/cm_integration_') && !url.search && method==='POST') {
        if(!['cm_integration_reserve','cm_integration_finish','cm_integration_file_get','cm_integration_file_record'].includes(url.pathname.split('/').at(-1)))fail(403,'ACCEPTANCE_RPC_REJECTED');
        const body=JSON.parse(options.body);
        if(body.p_app_id && body.p_app_id!==config.appId)fail(403,'ACCEPTANCE_APP_MISMATCH');
        if(body.p_subject && ![subject,hash(config.hashKey,['synthetic-foreign-subject'])].includes(body.p_subject))fail(403,'ACCEPTANCE_SUBJECT_MISMATCH');
        counts.stateRequests++;
      } else {
        const prefix=`/storage/v1/object/`;
        const suffix=`${BUCKET}/${config.appId}/${subject}/`;
        const upload=url.pathname.startsWith(prefix+suffix) && !url.search && method==='POST';
        const sign=url.pathname.startsWith(prefix+'sign/'+suffix) && !url.search && method==='POST';
        const authenticated=url.pathname.startsWith(prefix+'authenticated/'+suffix) && !url.search && method==='GET';
        const download=url.pathname.startsWith(prefix+'sign/'+suffix) && url.searchParams.has('token') && method==='GET';
        if(!upload&&!sign&&!authenticated&&!download)fail(403,'ACCEPTANCE_STORAGE_PATH_REJECTED');
        if(upload){if(counts.storageUploads>=1)fail(409,'ACCEPTANCE_UPLOAD_BUDGET');counts.storageUploads++;}
        if(download)counts.storageDownloads++;
      }
    } else fail(403,'ACCEPTANCE_EGRESS_REJECTED');
    return fetcher(url.href,{...options,redirect:'error'});
  }
  const store=injectedStore || createStore(config,fixedEgress);
  const raw=injectedProvider || createProviders(config,store,fixedEgress);
  const provide=async(operation,params,ctx)=>{
    if(operation==='SendEmail') {
      const response=await fixedEgress('https://api.sendgrid.com/v3/mail/send',{
        method:'POST',headers:{Authorization:`Bearer ${config.sendgridKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({personalizations:[{to:[{email:'acceptance@example.invalid'}]}],from:{email:config.fromEmail},
          subject:'Synthetic integration acceptance - sandbox only',content:[{type:'text/plain',value:'Synthetic validation. No delivery.'}],
          mail_settings:{sandbox_mode:{enable:true}},tracking_settings:{click_tracking:{enable:false,enable_text:false},open_tracking:{enable:false}}}),
        signal:AbortSignal.timeout(20000),
      });
      if(response.status!==200)fail(502,'EMAIL_SANDBOX_VALIDATION_FAILED');
      return {sandboxValidated:true,delivered:false};
    }
    const started=Date.now();const result=await raw(operation,params,ctx);
    return operation==='CreateFileSignedUrl'?{...result,expires_at_ms:started+60000}:result;
  };
  const invoke=(operation,name,params)=>performDurable({config,req:new Request('https://operator.invalid'),agencyId:'synthetic-not-an-agency',operation,params,
    requestId:`operator-acceptance-20260916-v1-${name}`,authority:async()=>actor,store,provider:provide});
  const text=await invoke('InvokeLLM','text',{prompt:'This is a synthetic API connectivity check. Reply with exactly PENNSYNC_EXTERNAL_OK and no other text.',model:'automatic'});
  checks.textModel = typeof text==='string' && text.trim()==='PENNSYNC_EXTERNAL_OK';
  if(!checks.textModel)fail(502,'SYNTHETIC_TEXT_MISMATCH');
  const structured=await invoke('InvokeLLM','structured',{prompt:'Return the fixed synthetic record: asset is Synthetic acceptance vehicle; mileage is 12345. This is not a real person or vehicle.',model:'automatic',response_json_schema:SCHEMA});
  checks.structuredModel=structured.asset==='Synthetic acceptance vehicle' && structured.mileage===12345;
  if(!checks.structuredModel)fail(502,'SYNTHETIC_STRUCTURED_MISMATCH');
  const uploaded=await invoke('UploadPrivateFile','file',{base64:Buffer.from(FIXTURE).toString('base64'),content_type:'text/csv'});
  if(typeof uploaded.file_uri!=='string'||!uploaded.file_uri.startsWith('cmfile:')||uploaded.private!==true)fail(502,'SYNTHETIC_UPLOAD_MISMATCH');
  checks.privateUpload=true;
  const extracted=await invoke('ExtractDataFromUploadedFile','extract',{file_uri:uploaded.file_uri,json_schema:SCHEMA});
  checks.documentExtraction=extracted.status==='success' && extracted.output.asset==='Synthetic acceptance vehicle' && extracted.output.mileage===12345;
  if(!checks.documentExtraction)fail(502,'SYNTHETIC_EXTRACTION_MISMATCH');
  const id=uploaded.file_uri.slice(7);
  checks.foreignOwnerDenied=(await store.fileGet({p_id:id,p_app_id:config.appId,p_subject:hash(config.hashKey,['synthetic-foreign-subject'])}))===null;
  if(!checks.foreignOwnerDenied)fail(403,'SYNTHETIC_OWNER_BOUNDARY_FAILED');
  // Signing is not a new upload or model call; its request is distinct because
  // a previous short-lived lease may have expired between operator runs.
  const signed=await invoke('CreateFileSignedUrl',`sign-${randomUUID()}`,{file_uri:uploaded.file_uri});
  const downloaded=await fixedEgress(signed.signed_url,{signal:AbortSignal.timeout(15000)});
  if(downloaded.status!==200)fail(502,'SYNTHETIC_DOWNLOAD_FAILED');
  const bytes=await limitedBytes(downloaded,1024);
  checks.downloadBytesMatch=createHash('sha256').update(bytes).digest('hex')===createHash('sha256').update(FIXTURE).digest('hex');
  if(!checks.downloadBytesMatch)fail(502,'SYNTHETIC_DOWNLOAD_MISMATCH');
  const mail=await invoke('SendEmail','mail-sandbox',{to:'acceptance@example.invalid',subject:'Synthetic integration acceptance - sandbox only',body:'Synthetic validation. No delivery.'});
  checks.emailSandboxValidated=mail.sandboxValidated===true && mail.delivered===false;
  const countBefore=counts.modelRequests;
  await invoke('InvokeLLM','text',{prompt:'This is a synthetic API connectivity check. Reply with exactly PENNSYNC_EXTERNAL_OK and no other text.',model:'automatic'});
  checks.paidReplayAvoided=counts.modelRequests===countBefore;
  return {event:'external_integration_operator_acceptance',revision:config.revision,scope:'fixed-synthetic-operator-check-not-employee-acceptance',
    passed:Object.values(checks).every(Boolean),checks,counts,actualEmailDelivery:false,customerRecordsAccessed:false,trafficCutover:false};
}

export async function main(args=process.argv.slice(2),env=process.env,log=value=>process.stdout.write(JSON.stringify(value)+'\n')) {
  if(args.length!==1 || args[0]!=='--execute-synthetic-v1') {log({event:'operator_acceptance_refused',code:'EXPLICIT_FLAG_REQUIRED'});return 2;}
  try {
    const report=await runOperatorAcceptance(loadConfig(env),{authorization:env.INTEGRATIONS_SYNTHETIC_ACCEPTANCE});
    log(report);return report.passed?0:1;
  } catch(error) {
    log({event:'external_integration_operator_acceptance',passed:false,code:error instanceof IntegrationError?error.code:'SYNTHETIC_ACCEPTANCE_UNAVAILABLE',trafficCutover:false});return 1;
  }
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) process.exitCode=await main();
