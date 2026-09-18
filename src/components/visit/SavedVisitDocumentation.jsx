import { VITAL_FIELDS } from './VitalSignsForm';

const RECORDED_VITALS = [...VITAL_FIELDS, { key: 'weight', label: 'Weight (unit not recorded)', unit: '' }];

/** Display only an already-authorized stored projection; no editor or mutation. */
export default function SavedVisitDocumentation({ visit, patient }) {
  const recorded = RECORDED_VITALS.filter(({ key }) => Number.isFinite(visit.vital_signs?.[key]));
  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Saved visit note</h2>
        <p className="mt-1 text-sm text-slate-600">{patient.first_name} {patient.last_name} · {visit.visit_date}</p>
        <p className="mt-2 text-sm text-slate-600">Read-only saved record. Use the editor below to prepare and review changes; viewing this record does not save or re-verify it.</p>
        <p className="mt-1 text-xs text-slate-500">Record last updated: {visit.updated_date}</p>
      </div>
      <div aria-label="Saved note text" className="whitespace-pre-wrap break-words text-sm text-slate-900">
        {visit.nurse_notes || 'No final note was stored for this visit.'}
      </div>
      <section aria-label="Recorded vital signs">
        <h3 className="font-semibold text-slate-900">Recorded vital signs</h3>
        {recorded.length ? (
          <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {recorded.map(({ key, label, unit }) => (
              <div key={key}>
                <dt className="text-xs text-slate-600">{label}</dt>
                <dd className="text-sm font-medium text-slate-900">{visit.vital_signs[key]}{unit ? ` ${unit}` : ''}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="mt-2 text-sm text-slate-600">No vital signs were stored for this visit.</p>}
      </section>
    </section>
  );
}
