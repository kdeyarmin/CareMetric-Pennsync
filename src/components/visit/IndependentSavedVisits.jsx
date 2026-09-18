import { Link, useSearchParams } from 'react-router';
import { useAuth } from '@/lib/AuthContext';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { useAuthorizedVisit } from '@/hooks/useAuthorizedVisit';
import { useQuery } from '@tanstack/react-query';
import { getAuthorizedPatient } from '@/functions/getAuthorizedPatient';
import SavedVisitDocumentation from './SavedVisitDocumentation';

function Unavailable() {
  return <p role="alert">Saved records unavailable. Your access could not be verified.</p>;
}
function OpenVisit({ visitId, agencyId }) {
  const visit = useAuthorizedVisit({ visitId, agencyId, purpose: 'documentation' });
  const scope = visit.tenantScope;
  // One identity-refresh owner: mounting another currentUser hook here would
  // repeatedly invalidate its parent. The patient RPC independently reauthorizes
  // and must match the freshly authorized visit's exact membership scope.
  const patient = useQuery({
    queryKey: ['independent-saved-patient', agencyId, visitId, visit.data?.patient_id,
      scope?.user_id, scope?.membership_id, scope?.membership_version, scope?.tenant_role],
    enabled: visit.isSuccess,
    queryFn: async () => {
      const result = await getAuthorizedPatient({ agencyId, patientId:visit.data.patient_id, purpose:'display' });
      if (!['agency_id','membership_id','membership_version','tenant_role'].every(key => result.scope[key] === scope[key])) {
        throw new Error('SAVED_PATIENT_SCOPE_CHANGED');
      }
      return result.patient;
    },
    retry:false, staleTime:0, gcTime:0, refetchOnMount:'always', refetchOnWindowFocus:'always', refetchOnReconnect:'always',
  });
  if (visit.isError || patient.isError) return <Unavailable />;
  if (!visit.isSuccess || !patient.isSuccess || patient.fetchStatus !== 'idle') return <p role="status">Verifying saved visit access…</p>;
  return <SavedVisitDocumentation visit={visit.data} patient={patient.data} editingAvailable={false} />;
}
function VisitList({ patientId, agencyId }) {
  const visits = useAuthorizedVisits({ agencyId, patientId, purpose:'schedule', status:'completed', sort:'-visit_date', limit:10000 });
  if (visits.isError) return <Unavailable />;
  if (!visits.isSuccess) return <p role="status">Loading saved visits…</p>;
  if (!visits.data.length) return <p>No saved visits for this patient.</p>;
  return <ul className="space-y-3" aria-label="Saved visits">
    {visits.data.map(visit => <li key={visit.id}>
      <Link className="underline" to={`/ClinicalDocumentation?visitId=${encodeURIComponent(visit.id)}`}>
        Open saved visit · {visit.visit_date}
      </Link>
    </li>)}
  </ul>;
}
function PatientSelector({ patientId, onSelect }) {
  const roster = useScopedPatients({ purpose:'roster', sort:'last_name', limit:10000 });
  if (roster.isError) return <Unavailable />;
  if (!roster.isSuccess) return <p role="status">Verifying patient roster…</p>;
  const current = roster.data.some(patient => patient.id === patientId);
  return <>
    <label className="block" htmlFor="saved-visit-patient">Patient</label>
    <select id="saved-visit-patient" className="w-full rounded border p-3" value={current ? patientId : ''}
      onChange={event => onSelect(event.target.value)}>
      <option value="">Select a patient</option>
      {roster.data.map(patient => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name}</option>)}
    </select>
  </>;
}
/** Existing authority boundaries and saved-record renderer, without unported editors. */
export default function IndependentSavedVisits() {
  const { tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id;
  const [params, setParams] = useSearchParams();
  const patientId = params.get('patientId');
  const visitId = params.get('visitId');
  return <main className="mx-auto max-w-4xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Clinical Notes</h1>
    <p>Browse saved visits and read their recorded notes and vital signs. Editing and generation are not available in this staging transfer.</p>
    <Link className="underline" to="/Patients">Return to patients</Link>
    {!agencyId ? <Unavailable /> : <>
      <PatientSelector patientId={visitId ? null : patientId} onSelect={value => setParams(value ? { patientId:value } : {})} />
      {visitId ? <OpenVisit key={`${agencyId}:${visitId}`} visitId={visitId} agencyId={agencyId} />
        : patientId ? <VisitList key={`${agencyId}:${patientId}`} patientId={patientId} agencyId={agencyId} /> : null}
    </>}
  </main>;
}
