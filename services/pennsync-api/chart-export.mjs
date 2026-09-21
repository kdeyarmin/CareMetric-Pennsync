// Ported from base44/functions/generatePatientChartPDF.
//
// D53's sequence — read contract, brokered model, trail — with no write
// contract behind it, because the capability produces a document rather than a
// record. Two things a reader should know before changing anything here.
//
// **It renders no PDF, despite its name.** The original asks a model for
// formatted text and answers with the text; nothing in it touches a PDF
// library. That is the same reading D64 made of
// `analyzeAndGenerateClinicalTasks`, whose name says generate and which
// creates nothing — and it is kept rather than corrected, because correcting
// it would change what a caller receives.
//
// **The prompt carries the widest projection in the application** — the
// patient's home address, telephone, electronic address, physician's contact
// details and emergency contact alongside the clinical record — and every
// column of it is named in `contract_chart_export_context` (D64). What the
// model contributes is formatting. A deterministic renderer, of the kind
// `documents.mjs` already holds three of, would produce the same document
// without the disclosure; that is a product decision rather than a porting
// one, and it is recorded in the exit decisions rather than taken here.
import { parseLLMJson } from './llm-json.mjs';
import { fail } from './contracts.mjs';

export const CHART_EXPORT_MODEL = 'automatic';

/** The original's response schema, verbatim. */
export const CHART_EXPORT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    document_content: {
      type: 'string',
      description: 'Full formatted content for the document',
    },
    page_count: {
      type: 'number',
      description: 'Estimated page count',
    },
  },
});

// `x || 'N/A'`, which is the original's — so a stored `0` heart rate reads
// 'N/A' here exactly as it does there. Not tidied into a null check: that
// would change the document for a real value.
const value = (candidate, fallback = 'N/A') => candidate || fallback;
/**
 * `patient.x?.join(', ') || 'None'`.
 *
 * The original would THROW on a non-array — `?.` guards null and undefined,
 * not a string with no `.join` — and the column is jsonb, so a malformed row
 * would take a chart export down. Answering 'None' is the only divergence in
 * this file and it is in the direction of the original's own fallback.
 */
const joined = (list, separator) =>
  (Array.isArray(list) ? list.join(separator) : '') || 'None';
const yesNo = flag => (flag ? 'Yes' : 'No');

/** The original's prompt, interpolation for interpolation. */
export function buildChartPrompt({ patient, visits, incidents }) {
  // `patient.baseline_vitals?.heart_rate || 'N/A'`, with the same guard the
  // original's optional chain gives it.
  const nested = (group, key, fallback = 'N/A') => {
    const held = patient?.[group];
    return value(held === null || typeof held !== 'object' ? undefined : held[key], fallback);
  };
  const secondaryDiagnoses = joined(patient?.secondary_diagnoses, ', ');
  const pastMedicalHistory = joined(patient?.past_medical_history, '; ');
  const visitList = Array.isArray(visits) ? visits : [];
  const incidentList = Array.isArray(incidents) ? incidents : [];
  return `Generate a professional, HIPAA-compliant patient medical chart with the following information:

PATIENT DEMOGRAPHICS:
Name: ${patient?.first_name} ${patient?.middle_name || ''} ${patient?.last_name}
DOB: ${patient?.date_of_birth}
MRN: ${value(patient?.medical_record_number)}
Address: ${value(patient?.address)}
Phone: ${value(patient?.phone)}
Email: ${value(patient?.email)}

PRIMARY CARE PHYSICIAN:
Name: ${value(patient?.physician_name)}
Phone: ${value(patient?.physician_phone)}
Email: ${value(patient?.physician_email)}

EMERGENCY CONTACT:
Name: ${value(patient?.emergency_contact_name)}
Phone: ${value(patient?.emergency_contact_phone)}
Relationship: ${value(patient?.emergency_contact_relationship)}

CLINICAL INFORMATION:
Primary Diagnosis: ${value(patient?.primary_diagnosis)}
Secondary Diagnoses: ${secondaryDiagnoses}
Allergies: ${value(patient?.allergies, 'No known allergies')}
Past Medical History: ${pastMedicalHistory}

BASELINE VITALS:
BP: ${nested('baseline_vitals', 'blood_pressure_systolic')}/${nested('baseline_vitals', 'blood_pressure_diastolic')}
HR: ${nested('baseline_vitals', 'heart_rate')} bpm
RR: ${nested('baseline_vitals', 'respiratory_rate')} rpm
Temp: ${nested('baseline_vitals', 'temperature')}F
O2 Sat: ${nested('baseline_vitals', 'oxygen_saturation')}%
Weight: ${nested('baseline_vitals', 'weight')} lbs
Height: ${nested('baseline_vitals', 'height')} inches
BMI: ${nested('baseline_vitals', 'bmi')}

FUNCTIONAL STATUS:
Ambulation: ${nested('functional_status', 'ambulation')}
ADL Independence: ${nested('functional_status', 'adl_independence')}
Cognitive Status: ${nested('functional_status', 'cognitive_status')}
Fall Risk: ${nested('functional_status', 'fall_risk')}

SOCIAL HISTORY:
Living Situation: ${nested('social_history', 'living_situation')}
Primary Language: ${nested('social_history', 'primary_language', 'English')}
Support System: ${nested('social_history', 'support_system')}
Smoking Status: ${nested('social_history', 'smoking_status')}

ADVANCE DIRECTIVES:
Has Living Will: ${yesNo(patient?.advance_directives?.has_living_will)}
Has Healthcare Proxy: ${yesNo(patient?.advance_directives?.has_healthcare_proxy)}
DNR Status: ${yesNo(patient?.advance_directives?.dnr_status)}

RECENT VISITS (${visitList.length || 0}):
${visitList.slice(0, 10).map((visit, index) => `${index + 1}. ${visit.visit_date}: ${visit.visit_type}`).join('\n')}

CLINICAL INCIDENTS (${incidentList.length || 0}):
${incidentList.slice(0, 10).map((incident, index) => `${index + 1}. ${incident.incident_date}: ${incident.incident_type} (${incident.severity})`).join('\n')}

Create professional medical chart content with:
1. Clear section headers and organization
2. HIPAA-compliant formatting
3. Medical-standard presentation
4. Easy-to-read lists and tables
5. Professional medical terminology`;
}

/**
 * Export one chart.
 *
 * The authorization is the contract's and is not restated here: the original's
 * own gate was an address on a carried row, an `assigned_nurses` entry and the
 * platform owner, and all three are things D21, D22 and D24 removed.
 */
export async function exportPatientChart({ params, contract, integration, audit }) {
  const patientId = typeof params?.patient_id === 'string' ? params.patient_id.trim() : '';
  if (!patientId) fail(400, 'CHART_EXPORT_PATIENT_REQUIRED');
  // The original accepts booleans ONLY, and says why in its own comment: these
  // values flow into a privileged audit record, so a caller-supplied object or
  // string could put arbitrary data — or PHI — into it.
  const includeVisits = params.include_visits === undefined ? true : params.include_visits;
  const includeIncidents = params.include_incidents === undefined
    ? true : params.include_incidents;
  if (typeof includeVisits !== 'boolean' || typeof includeIncidents !== 'boolean') {
    fail(400, 'CHART_EXPORT_FLAGS_INVALID');
  }

  const context = await contract('readChartExportContext', {
    patient_id: patientId, include_visits: includeVisits, include_incidents: includeIncidents,
  });
  const answer = await integration('InvokeLLM', {
    model: CHART_EXPORT_MODEL,
    prompt: buildChartPrompt(context),
    response_json_schema: structuredClone(CHART_EXPORT_SCHEMA),
  });
  const parsed = typeof answer === 'string' ? parseLLMJson(answer) : answer;
  // The original's own coalescing: the structured field, then a bare string,
  // then nothing — and an empty document is a failure rather than a document.
  const document = typeof parsed?.document_content === 'string' ? parsed.document_content
    : (typeof answer === 'string' && !parsed ? answer : '');
  if (!document.trim()) fail(502, 'CHART_EXPORT_EMPTY');
  const pages = Number.isFinite(Number(parsed?.page_count)) ? Number(parsed.page_count) : undefined;

  // D25's trail, where the original wrote `SecurityLog`. The detail is the
  // original's three fields; its `ip_address: 'server-side'` is dropped rather
  // than carried, because a contract cannot observe a request and a constant
  // standing in for an address is worse than an absent one (D36).
  let recorded = true;
  try {
    await audit('export_patient_chart_pdf', {
      detail: {
        patient_id: patientId,
        includes_visits: includeVisits,
        includes_incidents: includeIncidents,
      },
    });
  } catch { recorded = false; }

  const patient = context?.patient ?? {};
  return {
    success: true,
    document,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    mrn: patient.medical_record_number,
    export_date: new Date().toISOString(),
    // The carried `user` table has no name column (D38), so the original's
    // `user.full_name` has no source. The verified address is what the trail
    // records for the same person.
    exported_by: null,
    audit_recorded: recorded,
    ...(pages === undefined ? {} : { pages }),
  };
}
