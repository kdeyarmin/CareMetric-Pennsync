import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import IndependentSavedVisits from './IndependentSavedVisits';
const state=vi.hoisted(()=>({roster:{},visits:{},visit:{},patient:vi.fn(),listHook:vi.fn(),visitHook:vi.fn(),agency:'agency-a'}));
vi.mock('@/lib/AuthContext',()=>({useAuth:()=>({tenantContext:{agency_id:state.agency}})}));
vi.mock('@/hooks/useScopedPatients',()=>({useScopedPatients:()=>state.roster}));
vi.mock('@/hooks/useAuthorizedVisits',()=>({useAuthorizedVisits:options=>{state.listHook(options);return state.visits}}));
vi.mock('@/hooks/useAuthorizedVisit',()=>({useAuthorizedVisit:options=>{state.visitHook(options);return state.visit}}));
vi.mock('@/functions/getAuthorizedPatient',()=>({getAuthorizedPatient:(...args)=>state.patient(...args)}));
const scope={agency_id:'agency-a',membership_id:'membership-a',membership_version:1,tenant_role:'agency_admin',user_id:'owner'};
const saved={id:'30000000-0000-4000-8000-000000000001',patient_id:'patient-a1',visit_date:'2026-09-18',updated_date:'2026-09-18T12:00:00.000Z',nurse_notes:'Retained fictional note',vital_signs:{pain_level:0,weight:70}};
function mount(url='/ClinicalDocumentation') {
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><IndependentSavedVisits /></MemoryRouter></QueryClientProvider>);
 return {client,...view};
}
beforeEach(()=>{
 vi.clearAllMocks();state.agency='agency-a';
 state.roster={isSuccess:true,data:[{id:'patient-a1',first_name:'Synthetic',last_name:'Patient A1'}]};
 state.visits={isSuccess:true,data:[saved]};state.visit={isSuccess:true,data:saved,tenantScope:scope};
 state.patient.mockResolvedValue({patient:{id:'patient-a1',first_name:'Explicit',last_name:'Fictional'},scope});
});
afterEach(cleanup);
describe('transferred saved clinical visit view',()=>{
 it.each(['patientId=bad%20id','patientId=','patientId=%24where','visitId=not-a-uuid','visitId=','patientId=patient-a1&patientId=patient-a2',`patientId=patient-a1&visitId=${saved.id}`])('denies malformed or ambiguous route %s before mounting data hooks',query=>{
  mount(`/ClinicalDocumentation?${query}`);
  expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
  expect(state.listHook).not.toHaveBeenCalled();expect(state.visitHook).not.toHaveBeenCalled();expect(state.patient).not.toHaveBeenCalled();
 });
 it('selects a patient and exposes only a scoped saved-visit link',async()=>{
  mount();fireEvent.change(screen.getByLabelText('Patient'),{target:{value:'patient-a1'}});
  expect(await screen.findByRole('link',{name:'Open saved visit · 2026-09-18 · Record 1'})).toHaveAttribute('href',`/ClinicalDocumentation?visitId=${saved.id}`);
  expect(state.listHook).toHaveBeenLastCalledWith(expect.objectContaining({agencyId:'agency-a',patientId:'patient-a1',purpose:'schedule',status:'completed'}));
 });
 it('distinguishes multiple records on the same date',()=>{
  state.visits.data=[saved,{...saved,id:'30000000-0000-4000-8000-000000000002'}];
  mount('/ClinicalDocumentation?patientId=patient-a1');
  expect(screen.getByRole('link',{name:'Open saved visit · 2026-09-18 · Record 1'})).toHaveAttribute('href',`/ClinicalDocumentation?visitId=${saved.id}`);
  expect(screen.getByRole('link',{name:'Open saved visit · 2026-09-18 · Record 2'})).toHaveAttribute('href','/ClinicalDocumentation?visitId=30000000-0000-4000-8000-000000000002');
 });
 it('renders the authorized stored note and zero/weight with no editor',async()=>{
  mount(`/ClinicalDocumentation?visitId=${saved.id}`);
  expect(await screen.findByLabelText('Saved note text')).toHaveTextContent('Retained fictional note');
  expect(screen.getByLabelText('Recorded vital signs')).toHaveTextContent('70');
  expect(screen.getByLabelText('Recorded vital signs')).toHaveTextContent('0');
  expect(screen.queryByText(/Use the editor below/)).not.toBeInTheDocument();
  expect(state.patient).toHaveBeenCalledWith({agencyId:'agency-a',patientId:'patient-a1',purpose:'display'});
 });
 it('withholds the note if independent patient permission has changed',async()=>{
  state.patient.mockResolvedValue({patient:{id:'patient-a1',first_name:'Wrong',last_name:'Scope'},scope:{...scope,membership_version:2}});
  mount(`/ClinicalDocumentation?visitId=${saved.id}`);expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();
 });
 it('does not fetch a patient for a denied saved visit',()=>{
  state.visit={isError:true};mount(`/ClinicalDocumentation?visitId=${saved.id}`);expect(screen.getByRole('alert')).toBeVisible();expect(state.patient).not.toHaveBeenCalled();
 });
 it('hides cached content while visit authority is rechecking',async()=>{
  state.visit={isSuccess:false,isPending:true,data:saved,tenantScope:scope};mount(`/ClinicalDocumentation?visitId=${saved.id}`);
  await waitFor(()=>expect(screen.getByText('Verifying saved visit access…')).toBeVisible());
  expect(screen.queryByLabelText('Saved note text')).not.toBeInTheDocument();expect(state.patient).not.toHaveBeenCalled();
 });
 it('does not present list denial as an empty clinical history',()=>{
  state.visits={isError:true,data:[]};mount('/ClinicalDocumentation?patientId=patient-a1');expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByText('No saved visits for this patient.')).not.toBeInTheDocument();
 });
});
