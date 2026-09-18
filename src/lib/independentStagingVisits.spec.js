import { describe, it, expect, vi } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { stagingEmails, stagingEnv, stagingFixture } from '@/test/independentStagingFixture';
import { listAuthorizedVisits } from '@/functions/listAuthorizedVisits';
const boundary=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/api/base44Client',()=>({base44:{functions:{invoke:boundary.invoke}}}));
const visit={id:'30000000-0000-4000-8000-000000000001',patient_id:'patient-0',visit_date:'2026-09-18',visit_type:'skilled_nursing',status:'completed',updated_date:'2026-09-18T12:00:00.000Z'};
function fixtureForVisits({status=200,beforeReturn,mutate=value=>value}={}) {
  const fixture=stagingFixture(),reads=[];
  const adapter=createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv),{fetchImpl:async(url,options)=>{
    if(!url.endsWith('/pennsync_staging_visits_schedule')) return fixture.fetch(url,options);
    const body=JSON.parse(options.body); reads.push(body);
    const response=await fixture.fetch(url.replace('/pennsync_staging_visits_schedule','/pennsync_staging_context'),options);
    if(!response.ok)return response;
    const context=await response.json();
    if(status!==200)return new Response('{}',{status,headers:{'content-type':'application/json'}});
    const common=Object.fromEntries(['contract','app_id','auth_user_id','staging','synthetic'].map(key=>[key,context[key]]));
    const scope=Object.fromEntries(['agency_id','membership_id','membership_version','tenant_role'].map(key=>[key,context[key]]));
    const result=mutate({...common,context,scope:{...scope,patient_id:'patient-0',access_basis:'agency_wide',assignment_id:null,assignment_version:null},purpose:'schedule',visits:[{...visit}],page:{page_size:body.p_page_size,sort:'id_asc',after_id:null,has_more:false,next_cursor:null}});
    if(beforeReturn)await beforeReturn(adapter);
    return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
  }});
  return {adapter,fixture,reads};
}
describe('independent saved visit list wrapper bridge',()=>{
 it('feeds the unchanged named-projection wrapper without extra data',async()=>{
  const {adapter,reads}=fixtureForVisits();await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password');boundary.invoke.mockImplementation(adapter.raw.functions.invoke);
  const result=await listAuthorizedVisits({agencyId:'agency-a',patientId:'patient-0',purpose:'schedule',status:'completed',pageSize:2});
  expect(result.visits).toEqual([visit]);expect(result.page.next_cursor).toBeNull();
  expect(reads[0]).toEqual({p_agency_id:'agency-a',p_patient_id:'patient-0',p_status:'completed',p_page_size:2,p_cursor:null,p_app_id:'6a9881683dc68a0bd54f1ef7'});await adapter.auth.signOut();
 });
 it('rejects broader list purposes and a response completed after logout',async()=>{
  const {adapter,reads}=fixtureForVisits({beforeReturn:async value=>value.auth.signOut()});await adapter.auth.signIn(stagingEmails[0],'Synthetic-accepted-password');boundary.invoke.mockImplementation(adapter.raw.functions.invoke);
  await expect(listAuthorizedVisits({agencyId:'agency-a',patientId:'patient-0',purpose:'documentation'})).rejects.toThrow();expect(reads).toHaveLength(0);
  await expect(listAuthorizedVisits({agencyId:'agency-a',patientId:'patient-0',purpose:'schedule'})).rejects.toThrow();
 });
});
