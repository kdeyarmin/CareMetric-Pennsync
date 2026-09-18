import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '@/lib/AuthContext';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { base44 } from '@/api/base44Client';

const invoke = async (action,params) => (await base44.functions.invoke('manageAuthorizedReferral',{action,params})).data;
const denied = <p role="alert">Referral access unavailable. Your access could not be verified.</p>;

function Intake({ agencyId, patientId, membershipVersion, membershipId, referralId, onCreated }) {
  const queryClient=useQueryClient();
  const active=useRef(true);
  useEffect(()=>{active.current=true;return ()=>{active.current=false;};},[]);
  const preparation=useQuery({queryKey:['independent-referral-patient',agencyId,patientId,membershipId,membershipVersion],
    queryFn:async()=>{
      const result=await invoke('staging_prepare',{p_agency_id:agencyId,p_patient_id:patientId});
      if (result.context.membership_id!==membershipId || result.context.membership_version!==membershipVersion) throw new Error('REFERRAL_SCOPE_CHANGED');
      return result;
    },
    retry:false,staleTime:0,gcTime:0,refetchOnWindowFocus:'always',refetchOnReconnect:'always'});
  const [priority,setPriority]=useState('normal');
  const [busy,setBusy]=useState(false);
  const readKey=['independent-manual-referral',agencyId,patientId,membershipId,membershipVersion,preparation.data?.patient.version,referralId];
  const reading=useQuery({queryKey:readKey,enabled:!busy && !!referralId && preparation.isSuccess && preparation.fetchStatus==='idle',
    queryFn:()=>invoke('staging_read',{p_agency_id:agencyId,p_patient_id:patientId,p_expected_actor_version:preparation.data.context.membership_version,
      p_expected_patient_version:preparation.data.patient.version,p_referral_id:referralId}),
    retry:false,staleTime:0,gcTime:0,refetchOnWindowFocus:'always',refetchOnReconnect:'always'});
  const referral=referralId ? reading.data?.referral : null;
  const [error,setError]=useState(false);
  const operation=useRef(null);
  const inFlight=useRef(false);
  const perform=async action=>{
    if (inFlight.current || !preparation.isSuccess || preparation.fetchStatus!=='idle') return;
    inFlight.current=true;setBusy(true);setError(false);
    try {
      if (!operation.current) {
        const {context,patient}=preparation.data;
        const params={p_agency_id:agencyId,p_patient_id:patientId,p_expected_actor_version:context.membership_version,p_expected_patient_version:patient.version};
        if (action==='staging_create') Object.assign(params,{p_request_id:crypto.randomUUID(),p_fields:{patient_name:patient.display_name,priority,
          document_type:'manual',status:'new',requires_manual_review:true,manually_confirmed:false}});
        else Object.assign(params,{p_referral_id:referral.id,p_expected_referral_version:1,p_request_id:crypto.randomUUID()});
        operation.current={action,params};
      }
      const pending=operation.current;
      if (referralId) await queryClient.cancelQueries({queryKey:readKey,exact:true});
      if (!active.current) return;
      const result=await invoke(pending.action,pending.params);
      if (!active.current) return;
      // Keep the original request through any uncertain response; only a checked
      // receipt advances the UI. The adapter/session membrane fences late results.
      operation.current=null;
      if (pending.action==='staging_create') onCreated(result.referral.id);
      else queryClient.setQueryData(readKey,result);
    } catch { if (active.current) setError(true); }
    finally {inFlight.current=false;if (active.current) setBusy(false);}
  };
  if (preparation.isError || (referralId && reading.isError)) return denied;
  if (!preparation.isSuccess || preparation.fetchStatus!=='idle' || (referralId && (!reading.isSuccess || reading.fetchStatus!=='idle'))) return <p role="status">Verifying referral access…</p>;
  return <section className="space-y-4" aria-label="Manual referral">
    <h2 className="text-xl font-semibold">{preparation.data.patient.display_name}</h2>
    {!referral ? <>
      <label htmlFor="manual-referral-priority">Priority</label>
      <select id="manual-referral-priority" value={priority} disabled={busy || !!operation.current} onChange={event=>setPriority(event.target.value)}>
        {['low','normal','high','urgent'].map(value=><option key={value} value={value}>{value}</option>)}
      </select>
      <button className="rounded bg-blue-800 p-3 text-white" disabled={busy} onClick={()=>void perform('staging_create')}>
        {busy ? 'Saving…' : operation.current ? 'Retry same referral' : 'Create manual referral'}
      </button>
    </> : <>
      <p>Referral: <span>{referral.id}</span></p>
      <p role="status">{referral.status==='new' ? 'Needs patient confirmation' : 'Ready for admission'}</p>
      <p>Priority: {referral.priority}</p>
      {referral.version===1 && <button className="rounded bg-blue-800 p-3 text-white" disabled={busy} onClick={()=>void perform('staging_confirm')}>
        {busy ? 'Confirming…' : operation.current ? 'Retry same confirmation' : 'Confirm existing patient'}
      </button>}
    </>}
    {error && <p role="alert">The result could not be confirmed. Keep this page open and retry the same request; do not create another referral.</p>}
  </section>;
}

function PatientIntake({ context, patientId, referralId, setParams }) {
  const roster=useScopedPatients({purpose:'roster',sort:'last_name',limit:10000});
  if (roster.isError) return denied;
  if (!roster.isSuccess) return <p role="status">Loading patients…</p>;
  // Select once for this form: pending write receipts cannot be rebound to a
  // different patient by editing the selector while a response is uncertain.
  return <>
    <label htmlFor="manual-referral-patient">Patient</label>
    <select id="manual-referral-patient" value={patientId} disabled={!!patientId} onChange={event=>setParams({patientId:event.target.value})}>
      <option value="">Select an existing patient</option>
      {roster.data.map(patient=><option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>)}
    </select>
    {patientId && <Intake key={`${patientId}:${referralId}`} agencyId={context.agency_id} patientId={patientId} membershipVersion={context.membership_version} membershipId={context.membership_id} referralId={referralId} onCreated={id=>setParams({patientId,referralId:id})} />}
  </>;
}
export default function IndependentManualReferral() {
  const {tenantContext:context}=useAuth();
  const [params,setParams]=useSearchParams();
  const patientId=params.get('patientId') || '';
  const referralId=params.get('referralId');
  const valid=(!params.has('patientId') || /^[A-Za-z0-9_-]{1,128}$/.test(patientId))
    && (!params.has('referralId') || (!!patientId && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(referralId)))
    && params.getAll('patientId').length<=1 && params.getAll('referralId').length<=1;
  return <main className="mx-auto max-w-4xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Referral Intake</h1>
    <p>Create a manual referral for an existing test patient, then confirm the patient match. Document processing and admission are not available in this staging transfer.</p>
    <Link className="underline" to="/Patients">Return to patients</Link>
    {!valid || !context || context.tenant_role!=='agency_admin' ? denied
      : <PatientIntake key={`${context.agency_id}:${context.membership_id}:${context.membership_version}`} context={context} patientId={patientId} referralId={referralId} setParams={setParams} />}
  </main>;
}
