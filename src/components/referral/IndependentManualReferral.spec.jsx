import { render,screen,fireEvent,cleanup,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe,it,expect,vi,beforeEach,afterEach } from 'vitest';
import IndependentManualReferral from './IndependentManualReferral';
const state=vi.hoisted(()=>({context:{},invoke:vi.fn(),referral:null}));
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({tenantContext:state.context})}));
vi.mock('@/api/base44Client',()=>({base44:{functions:{invoke:(...args)=>state.invoke(...args)}}}));
const id='30000000-0000-4000-8000-000000000001';
function mount(path='/ReferralIntake') {
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return {...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><IndependentManualReferral /></MemoryRouter></QueryClientProvider>),client};
}
beforeEach(()=>{
 vi.clearAllMocks();state.context={user_id:'test-user',agency_id:'agency-a',membership_id:'membership-a',membership_version:1,tenant_role:'agency_admin'};
 state.referral=null;
 state.invoke.mockImplementation(async(name,{action})=>{
  if(action==='staging_roster')return {data:{context:state.context,items:[{id:'patient-a1',display_name:'Synthetic Patient A1',version:1}],next_cursor:null}};
  if(action==='staging_list')return {data:{items:[],next_cursor:null}};
  if(action==='staging_prepare')return {data:{context:state.context,patient:{id:'patient-a1',version:1,display_name:'Synthetic Patient A1'}}};
  if(action==='staging_create')state.referral={id,version:1,status:'new',priority:'normal'};
  if(action==='staging_confirm')state.referral={...state.referral,version:2,status:'ready_for_admission'};
  return {data:{referral:state.referral}};
 });
});
afterEach(cleanup);
describe('independent manual referral transfer',()=>{
 it.each(['agency_admin','manager','office_staff'])('%s creates, reopens and confirms the existing patient without admission or document calls',async role=>{
  state.context.tenant_role=role;mount();fireEvent.change(await screen.findByLabelText('Patient'),{target:{value:'patient-a1'}});
  fireEvent.click(await screen.findByRole('button',{name:'Create manual referral'}));
  expect(await screen.findByText('Needs patient confirmation')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Confirm existing patient'}));
  expect(await screen.findByText('Ready for admission')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Confirm existing patient'})).not.toBeInTheDocument();
  const create=state.invoke.mock.calls.find(([,p])=>p.action==='staging_create')[1].params;
  expect(create).toMatchObject({p_agency_id:'agency-a',p_patient_id:'patient-a1',p_expected_actor_version:1,p_expected_patient_version:1,p_fields:{document_type:'manual',status:'new',manually_confirmed:false}});
  expect(state.invoke.mock.calls.every(([name])=>name==='manageAuthorizedReferral')).toBe(true);
  if(role!=='agency_admin') {
   fireEvent.click(screen.getByRole('link',{name:'Return to referral patients'}));
   expect(await screen.findByLabelText('Patient')).toBeVisible();
   expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }
 });
 it('does not navigate back or update the view after leaving an in-flight creation',async()=>{
  const server=state.invoke.getMockImplementation();let release;
  const gate=new Promise(done=>{release=done;});
  state.invoke.mockImplementation(async(...args)=>{if(args[1].action==='staging_create')await gate;return server(...args);});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/ReferralIntake?patientId=patient-a1']}><Routes>
    <Route path="/ReferralIntake" element={<IndependentManualReferral />} /><Route path="/Patients" element={<h1>Patients destination</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Create manual referral'}));
  await waitFor(()=>expect(state.invoke.mock.calls.some(([,p])=>p.action==='staging_create')).toBe(true));
  fireEvent.click(screen.getByRole('link',{name:'Return to patients'}));
  expect(screen.getByRole('heading',{name:'Patients destination'})).toBeVisible();
  release();await waitFor(()=>expect(state.referral?.id).toBe(id));
  expect(screen.getByRole('heading',{name:'Patients destination'})).toBeVisible();
  expect(state.invoke.mock.calls.some(([,p])=>p.action==='staging_read')).toBe(false);
 });
 it('retains the exact request after an uncertain create response and locks its fields',async()=>{
  const server=state.invoke.getMockImplementation();let first=true;
  state.invoke.mockImplementation(async(...args)=>{if(args[1].action==='staging_create'&&first){first=false;throw new Error('network');}return server(...args);});
  mount('/ReferralIntake?patientId=patient-a1');
  fireEvent.click(await screen.findByRole('button',{name:'Create manual referral'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('retry the same request');
  expect(screen.getByLabelText('Priority')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Retry same referral'}));
  expect(await screen.findByText('Needs patient confirmation')).toBeVisible();
  const requests=state.invoke.mock.calls.filter(([,p])=>p.action==='staging_create').map(([,p])=>p.params);
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
 });
 it('retains uncertain creation through a background roster recheck',async()=>{
  const server=state.invoke.getMockImplementation();let first=true,release;
  state.invoke.mockImplementation(async(...args)=>{if(args[1].action==='staging_create'&&first){first=false;throw new Error('network');}return server(...args);});
  const {client}=mount('/ReferralIntake?patientId=patient-a1');
  fireEvent.click(await screen.findByRole('button',{name:'Create manual referral'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('retry the same request');
  const gate=new Promise(done=>{release=done;});
  state.invoke.mockImplementation(async(...args)=>{if(args[1].action==='staging_roster')await gate;return server(...args);});
  const refresh=client.invalidateQueries({queryKey:['independent-referral-roster']});
  expect(await screen.findByText('Verifying referral access…')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Retry same referral'})).not.toBeInTheDocument();
  release();await refresh;
  fireEvent.click(await screen.findByRole('button',{name:'Retry same referral'}));
  expect(await screen.findByText('Needs patient confirmation')).toBeVisible();
  const requests=state.invoke.mock.calls.filter(([,p])=>p.action==='staging_create').map(([,p])=>p.params);
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
 });
 it('stops fetching further referral pages after leaving the screen',async()=>{
  const server=state.invoke.getMockImplementation();let release;
  const gate=new Promise(done=>{release=done;});
  state.invoke.mockImplementation(async(...args)=>{if(args[1].action==='staging_list'){await gate;return {data:{items:[{referral:{id}}],next_cursor:id}};}return server(...args);});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/ReferralIntake?patientId=patient-a1']}><Routes>
    <Route path="/ReferralIntake" element={<IndependentManualReferral />} /><Route path="/Patients" element={<h1>Patients destination</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  await waitFor(()=>expect(state.invoke.mock.calls.some(([,p])=>p.action==='staging_list')).toBe(true));
  fireEvent.click(screen.getByRole('link',{name:'Return to patients'}));
  expect(screen.getByRole('heading',{name:'Patients destination'})).toBeVisible();
  release();await gate;await new Promise(done=>setTimeout(done,20));
  expect(state.invoke.mock.calls.filter(([,p])=>p.action==='staging_list')).toHaveLength(1);
 });
 it('discovers and opens a saved referral without creating another',async()=>{
  const server=state.invoke.getMockImplementation();state.referral={id,version:2,status:'ready_for_admission',priority:'normal'};
  state.invoke.mockImplementation(async(...args)=>args[1].action==='staging_list'?{data:{items:[{referral:{...state.referral,created_date:'2026-09-18T00:00:00.000Z'}}],next_cursor:null}}:server(...args));
  mount('/ReferralIntake?patientId=patient-a1');
  fireEvent.click(await screen.findByRole('link',{name:'Open referral · 2026-09-18 · Record 1'}));
  expect(await screen.findByText('Ready for admission')).toBeVisible();
  expect(state.invoke.mock.calls.some(([,p])=>p.action==='staging_create')).toBe(false);
 });
 it('withholds the creation form when saved referral access is denied',async()=>{
  const server=state.invoke.getMockImplementation();state.invoke.mockImplementation(async(...args)=>{if(args[1].action==='staging_list')throw new Error('denied');return server(...args);});
  mount('/ReferralIntake?patientId=patient-a1');await screen.findByRole('alert');
  expect(screen.queryByRole('button',{name:'Create manual referral'})).not.toBeInTheDocument();
 });
 it('reopens an already confirmed referral without showing a duplicate write',async()=>{
  state.referral={id,version:2,status:'ready_for_admission',priority:'normal'};
  mount(`/ReferralIntake?patientId=patient-a1&referralId=${id}`);
  expect(await screen.findByText('Ready for admission')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
 });
 it.each(['clinician','social_worker','spiritual_care'])('denies %s before invoking intake reads or writes',role=>{
  state.context.tenant_role=role;mount();expect(screen.getByRole('alert')).toBeVisible();expect(state.invoke).not.toHaveBeenCalled();
 });
 it.each(['patientId=bad%20id','referralId=bad','patientId=patient-a1&referralId=','patientId=patient-a1&patientId=patient-a2'])('denies malformed route %s',query=>{
  mount(`/ReferralIntake?${query}`);expect(screen.getByRole('alert')).toBeVisible();expect(state.invoke).not.toHaveBeenCalled();
 });
 it('withholds cached referral when a current read is denied',async()=>{
  const server=state.invoke.getMockImplementation();state.invoke.mockImplementation(async(...args)=>{if(args[1].action==='staging_read')throw new Error('denied');return server(...args);});
  mount(`/ReferralIntake?patientId=patient-a1&referralId=${id}`);
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('access unavailable'));
  expect(screen.queryByText('Ready for admission')).not.toBeInTheDocument();expect(screen.queryByRole('button')).not.toBeInTheDocument();
 });
});
