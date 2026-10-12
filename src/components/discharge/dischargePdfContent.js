import { formatLocalDate } from '@/lib/dateLocal';

// Both download entry points must include the same reviewed clinical content.
export default function dischargePdfContent(summary) {
  const content = [];
  const add = (label, value) => {
    if (value == null || value === '') return;
    content.push({ type: 'heading', text: label, size: 12 },
      { type: 'text', text: String(value) }, { type: 'spacer', height: 3 });
  };
  const list = values => Array.isArray(values) ? values.join('\n') : '';
  const rows = (values, fields) => Array.isArray(values) ? values.map(value => fields
    .map(field => value?.[field]).filter(part => part != null && part !== '').join(' | ')).filter(Boolean).join('\n') : '';
  add('Primary Diagnosis', summary.primary_diagnosis);
  add('Secondary Diagnoses', list(summary.secondary_diagnoses));
  add('Admission / Discharge', `${formatLocalDate(summary.admission_date) || '—'} to ${formatLocalDate(summary.discharge_date) || '—'}`);
  add('Reason for Admission', summary.reason_for_admission);
  add('Summary of Care', summary.summary_of_care);
  add('Care Plan Outcomes', rows(summary.care_plan_outcomes, ['problem', 'goal', 'outcome', 'notes']));
  add('Medications at Admission', list(summary.medication_summary?.medications_at_admission));
  add('Medications at Discharge', list(summary.medication_summary?.medications_at_discharge));
  add('Medication Changes', rows(summary.medication_summary?.medication_changes, ['change_type', 'medication', 'reason']));
  add('Functional Status at Admission', summary.functional_status?.at_admission);
  add('Functional Status at Discharge', summary.functional_status?.at_discharge);
  add('Functional Improvements', list(summary.functional_status?.improvement_areas));
  add('Patient Education', rows(summary.patient_education_provided, ['topic', 'materials_provided', 'patient_understanding']));
  add('Discharge Disposition', summary.discharge_disposition?.replaceAll('_', ' '));
  add('Discharge Instructions', summary.discharge_instructions);
  add('Follow-up Recommendations', rows(summary.follow_up_recommendations, ['recommendation', 'provider', 'timeframe']));
  add('Review Notes', summary.review_notes);
  if (summary.signature?.signed_by_name) add('Signed By', `${summary.signature.signed_by_name}${summary.signature.signed_date
    ? ` on ${new Date(summary.signature.signed_date).toLocaleString()}` : ''}`);
  return content;
}