// Explicit fictional values only. Never derive clinical fields from display_name.
import { createHash } from 'node:crypto';
export const PATIENT_CONTEXT_APP = '6a9881683dc68a0bd54f1ef7';
export const patientContexts = [
  { patientId: 'patient-a1', agencyId: 'agency-a', data: {
    id: 'patient-a1', first_name: 'Fictional Zoë', middle_name: '', last_name: 'Context A',
    date_of_birth: '1950-02-28', medical_record_number: 'SYNTHETIC-ONLY-A', status: 'active', care_type: 'home_health',
    primary_diagnosis: 'Fictional demonstration diagnosis', secondary_diagnoses: ['Synthetic secondary example'],
    chronic_conditions: [{ description: 'Fictional condition', observed: false }],
    past_medical_history: ['Synthetic history'], current_medications: [{ name: 'Fictional medication', dose: 'Example only' }],
    allergies: 'Fictional allergy note', functional_status: { example: 'Synthetic functional assessment', score: 0 },
    wounds: [{ description: 'Fictional wound', present: false }],
    enhanced_notes_history: [{ note: 'Explicit fictional retained history', metadata: { synthetic: true } }],
    clinical_notes: 'Fictional clinical context.\nPreserve é 心 😀', updated_date: '2026-09-18T12:00:00.000Z',
  } },
  { patientId: 'patient-a2', agencyId: 'agency-a', data: {
    id: 'patient-a2', first_name: 'Fictional', last_name: 'Display Only',
  } },
  { patientId: 'patient-b1', agencyId: 'agency-b', data: {
    id: 'patient-b1', first_name: 'Fictional', last_name: 'Context B', status: 'hospitalized',
    updated_date: '2026-09-18T12:01:00.000Z',
  } },
];

export async function seedPatientContexts(db, records = patientContexts) {
  const inserted = [];
  for (const record of records) {
    const text = JSON.stringify(record.data);
    const provenance = createHash('sha256').update(`LOCAL_SYNTHETIC_PATIENT_CONTEXT:${record.patientId}:${text}`).digest('hex');
    const result = await db.query(`insert into pennsync_private.patient_context
      (app_id,agency_id,patient_id,version,provenance_kind,provenance_sha256,data,data_sha256)
      values($1,$2,$3,$4,'synthetic_fixture',$5,$6::jsonb,encode(sha256(convert_to(($6::jsonb)::text,'UTF8')),'hex'))
      returning *`, [PATIENT_CONTEXT_APP, record.agencyId, record.patientId, record.version ?? 1, provenance, text]);
    inserted.push(result.rows[0]);
  }
  return inserted;
}
