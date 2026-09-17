export default function PatientHistoryNotice({ patientId, error = false }) {
  return (
    <div role={error ? 'alert' : 'status'} className="rounded-xl border border-slate-300 bg-slate-50 p-6 text-sm text-slate-700">
      {!patientId ? 'Select a patient to load their history.' : error
        ? 'Patient history could not be loaded. Reload to try again.'
        : 'Loading patient history…'}
    </div>
  );
}
