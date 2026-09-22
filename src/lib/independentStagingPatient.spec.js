import { describe, it, expect, vi } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { stagingEmails, stagingEnv, stagingFixture } from '@/test/independentStagingFixture';
import { getAuthorizedPatient } from '@/functions/getAuthorizedPatient';
import { patientContexts } from '../../services/authority-store/tests/patient-context-fixture.mjs';

const boundary=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/api/base44Client',()=>({base44:{functions:{invoke:boundary.invoke}}}));
const patient={...patientContexts[0].data,id:'patient-0'};
const display=Object.fromEntries(Object.entries(patient).filter(([key])=>['id','first_name','middle_name','last_name'].includes(key)));
function fixtureForPatient({status=200,beforeReturn,mutate=value=>value}={}) {
  const fixture=stagingFixture(),reads=[];
  const adapter=createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv),{fetchImpl:async(url,options)=>{
    if(!url.endsWith('/pennsync_staging_patient_context')) return fixture.fetch(url,options);
    const body=JSON.parse(options.body); reads.push(body);
    const response=await fixture.fetch(url.replace('/pennsync_staging_patient_context','/pennsync_staging_context'),options);
    if(!response.ok)return response;
    const context=await response.json();
    if(status!==200)return new Response('{}',{status,headers:{'content-type':'application/json'}});
    const common=Object.fromEntries(['contract','app_id','auth_user_id','staging','synthetic'].map(key=>[key,context[key]]));
    const scope=Object.fromEntries(['agency_id','membership_id','membership_version','tenant_role'].map(key=>[key,context[key]]));
    const result=mutate({...common,context,scope,purpose:body.p_purpose,patient:structuredClone(body.p_purpose==='display'?display:patient)});
    if(beforeReturn)await beforeReturn(adapter);
    return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
  }});
  return {adapter,fixture,reads};
}
describe('independent explicit patient context contract bridge',()=>{
  it.each(['display','smart_note_context'])('satisfies the unchanged wrapper for %s with exact stored fields',async purpose=>{
    const {adapter,reads}=fixtureForPatient(); await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password');
    boundary.invoke.mockImplementation(adapter.raw.functions.invoke);
    const result=await getAuthorizedPatient({agencyId:'agency-a',patientId:'patient-0',purpose});
    expect(result).toEqual({success:true,purpose,patient:purpose==='display'?display:patient,scope:{
      agency_id:'agency-a',membership_id:'membership-0',membership_version:1,tenant_role:'agency_admin'}});
    expect(reads).toEqual([{p_app_id:'6a9881683dc68a0bd54f1ef7',p_agency_id:'agency-a',p_patient_id:'patient-0',p_purpose:purpose}]);
    expect(JSON.stringify(result)).not.toContain('auth_user_id'); await adapter.auth.signOut();
  });
  it('preserves absent optional values without deriving names, status, timestamps or history',async()=>{
    const explicit={id:'patient-0',first_name:'Explicit',last_name:'Fictional',status:'hospitalized',updated_date:'2026-09-18T12:00:00.000Z'};
    const {adapter}=fixtureForPatient({mutate:value=>({...value,patient:explicit})});
    await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password'); boundary.invoke.mockImplementation(adapter.raw.functions.invoke);
    expect((await getAuthorizedPatient({agencyId:'agency-a',patientId:'patient-0',purpose:'smart_note_context'})).patient).toEqual(explicit);
    await adapter.auth.signOut();
  });
  it('keeps all other purposes, clinical writes, history and generic entities unavailable without a request',async()=>{
    const {adapter,fixture,reads}=fixtureForPatient();await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password');const count=fixture.requests.length;
    for(const purpose of ['selector','alert_analysis','education_context','visit_summary','health_history_write_base','oasis_analysis_context'])
      await expect(adapter.raw.functions.invoke('getAuthorizedPatient',{agency_id:'agency-a',patient_id:'patient-0',purpose})).rejects.toThrow('STAGING_OPERATION_UNAVAILABLE');
    for(const name of ['getAuthorizedPatientNoteHistory','updateAuthorizedPatient','pennsync_staging_patient_context'])
      await expect(adapter.raw.functions.invoke(name,{})).rejects.toThrow('STAGING_OPERATION_UNAVAILABLE');
    await expect(adapter.raw.functions.invoke('getAuthorizedPatient',{agency_id:'agency-a',patient_id:'patient-0',purpose:'display',extra:true})).rejects.toThrow();
    // Generic entities refuse by name, and before the count so it covers them.
    await expect(adapter.raw.entities.Patient.list()).rejects.toMatchObject({code:'STAGING_OPERATION_UNAVAILABLE'});
    expect(reads).toHaveLength(0);expect(fixture.requests).toHaveLength(count);await adapter.auth.signOut();
  });
  it('rejects wrong patient, current scope drift, malformed fields and audit failures without fallback',async()=>{
    for(const options of [{status:403},{status:503},{mutate:r=>({...r,patient:{...r.patient,id:'foreign'}})},
      {mutate:r=>({...r,scope:{...r.scope,membership_version:2}})}, {mutate:r=>({...r,patient:{...r.patient,clinical_notes:null}})},
      {mutate:r=>{delete r.patient.updated_date;return r;}}]) {
      const {adapter,reads}=fixtureForPatient(options);await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password');
      boundary.invoke.mockImplementation(adapter.raw.functions.invoke);
      await expect(getAuthorizedPatient({agencyId:'agency-a',patientId:'patient-0',purpose:'smart_note_context'})).rejects.toThrow();
      expect(reads).toHaveLength(1);await adapter.auth.signOut();
    }
  });
  it('captures exact requested patient, agency and purpose before asynchronous work',async()=>{
    const input={agency_id:'agency-a',patient_id:'patient-0',purpose:'smart_note_context'};
    const {adapter,reads}=fixtureForPatient({beforeReturn:()=>{input.patient_id='foreign';input.agency_id='agency-b';input.purpose='display';}});
    await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password');
    const result=await adapter.raw.functions.invoke('getAuthorizedPatient',input);
    expect(result.data.patient).toEqual(patient);expect(result.data.purpose).toBe('smart_note_context');
    expect(reads[0].p_patient_id).toBe('patient-0');await adapter.auth.signOut();
  });
  it('discards data arriving after authority invalidation and clears the owned native session',async()=>{
    const {adapter,fixture}=fixtureForPatient({beforeReturn:active=>active.raw.cleanup()});
    await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password');
    await expect(adapter.raw.functions.invoke('getAuthorizedPatient',{agency_id:'agency-a',patient_id:'patient-0',purpose:'display'})).rejects.toThrow();
    expect(adapter.auth.hasSession()).toBe(false);await adapter.auth.signOut();expect(fixture.live.size).toBe(0);
  });
});
