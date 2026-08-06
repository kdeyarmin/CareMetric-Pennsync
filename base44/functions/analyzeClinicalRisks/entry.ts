import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Tolerant JSON extractor: we ask for strict JSON in-prompt instead of passing
// response_json_schema, because the provider rejects deeply-nested object
// schemas that lack an explicit `required` array at every level.
function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}


// <<<BEGIN SHARED HELPER: formatAge — generated, edit base44/_shared/backendHelpers.mjs>>>
function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function calculateAge(dob, now = new Date()) {
  const birth = parseLocalDate(dob);
  const today = parseLocalDate(now);
  if (!birth || !today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
function formatAge(dob, now = new Date(), fallback = 'Unknown') {
  const age = calculateAge(dob, now);
  return age == null ? fallback : age;
}
// <<<END SHARED HELPER: formatAge>>>

/** Explicit patient access — Patient RLS treats role:admin as platform-wide. */
async function assertPatientAccess(base44, user, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  const isSuperAdmin = user.account_type === 'super_admin';
  const isAgencyScopedAdmin =
    user.account_type === 'agency_admin'
    || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
  const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.includes(user.email);
  if (!isPlatformAdmin && !isAgencyScopedAdmin && patient.created_by !== user.email && !isAssigned) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isAgencyScopedAdmin) {
    if (!user.agency_name) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const agencyUsers = await base44.asServiceRole.entities.User
      .list('-created_date', 5000).catch(() => []);
    const agencyEmails = new Set(
      (agencyUsers || [])
        .filter((u) => u.agency_name === user.agency_name && u.email)
        .map((u) => u.email),
    );
    const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
      || (Array.isArray(patient.assigned_nurses)
        && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
    if (!inAgency) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const { patientId } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'Patient ID required' }, { status: 400 });
    }

    const [patientRow] = await base44.asServiceRole.entities.Patient
      .filter({ id: patientId }, '', 1).catch(() => []);
    const denied = await assertPatientAccess(base44, user, patientRow);
    if (denied) return denied;
    const patientData = patientRow;

    const [visits, oasisRecords, incidents] = await Promise.all([
      base44.asServiceRole.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20),
      base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 3),
      base44.asServiceRole.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 10)
    ]);
    const latestOASIS = oasisRecords[0];
    const recentVisits = visits.slice(0, 5);

    // Build comprehensive context for AI
    const prompt = `You are an expert clinical decision support system specializing in home health care. Analyze this patient's complete history to identify potential health deteriorations, care plan deviations, and proactive interventions needed.

PATIENT PROFILE:
- Name: ${patientData.first_name} ${patientData.last_name}
- Age: ${formatAge(patientData.date_of_birth)}
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patientData.allergies || 'None documented'}
- Current Medications: ${JSON.stringify(patientData.current_medications || [])}
- Status: ${patientData.status}
- Admission Date: ${patientData.admission_date}

BASELINE DATA:
- Baseline Vitals: ${JSON.stringify(patientData.baseline_vitals || {})}
- Functional Status: ${JSON.stringify(patientData.functional_status || {})}
- Social History: ${JSON.stringify(patientData.social_history || {})}

RECENT OASIS ASSESSMENT (${latestOASIS ? `from ${latestOASIS.created_date}` : 'Not available'}):
${latestOASIS ? `
- Functional Level: ${latestOASIS.pdgm_data?.functional_impairment_level || 'Not assessed'}
- Clinical Grouping: ${latestOASIS.pdgm_data?.clinical_grouping || 'Not specified'}
- Comorbidities: ${JSON.stringify(latestOASIS.pdgm_data?.comorbidity_level || [])}
- Admission Source: ${latestOASIS.pdgm_data?.admission_source || 'Unknown'}
- Extracted Data: ${JSON.stringify(latestOASIS.extracted_data || {})}
` : 'No OASIS assessment available'}

RECENT VISIT HISTORY (Last 5 visits):
${recentVisits.map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Status: ${v.status}
Vital Signs: ${JSON.stringify(v.vital_signs || {})}
Notes: ${v.nurse_notes?.substring(0, 300) || 'No notes'}...
`).join('\n---\n')}

RECENT INCIDENTS (${incidents.length}):
${incidents.map(inc => `
Date: ${inc.incident_date}
Type: ${inc.incident_type}
Severity: ${inc.severity}
Details: ${JSON.stringify(inc.details || {})}
`).join('\n---\n')}

ANALYSIS REQUIREMENTS:

1. **VITAL SIGNS DETERIORATION**: Compare recent vitals to baseline. Identify concerning trends (BP elevation, O2 decline, heart rate changes, etc.)

2. **FUNCTIONAL DECLINE**: Compare recent visit observations to OASIS functional assessment. Identify mobility, ADL, or cognitive changes.

3. **MEDICATION CONCERNS**: Review current medications for:
   - Drug-drug interactions
   - Contraindications with diagnoses
   - Missing medications for conditions
   - High-risk medications (anticoagulants, insulin, narcotics)

4. **DIAGNOSIS-SPECIFIC MONITORING**: Based on primary diagnosis, identify what should be monitored and if it's being adequately assessed.

5. **CARE PLAN ADHERENCE**: Compare visit documentation to care plan interventions. Are goals being addressed? Are interventions being performed?

6. **INCIDENT PATTERNS**: Identify recurring incidents (falls, hospitalizations, medication errors) and root causes.

7. **SOCIAL DETERMINANTS**: Consider living situation, caregiver support, and social factors that may impact health.

8. **PREDICTIVE RISK FACTORS**: Identify early warning signs of:
   - Hospital readmission risk
   - Falls risk
   - Infection risk
   - Wound deterioration
   - Mental health decline

For EACH identified risk or concern, provide:
- **Severity**: critical, high, medium, low
- **Clinical Evidence**: Specific data points supporting this concern
- **Recommended Interventions**: Evidence-based nursing actions (prioritize top 3)
- **Rationale**: Why this intervention is recommended
- **Expected Outcomes**: What improvement to monitor for
- **Patient Education Topics**: What patient/family should understand
- **Nurse Education Resources**: If nurse needs training in this area

Return comprehensive JSON analysis.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"overall_risk_score":0,"risk_level":"","clinical_alerts":[{"alert_type":"","severity":"","title":"","clinical_evidence":[""],"recommended_interventions":[{"intervention":"","priority":0,"rationale":"","expected_outcome":""}],"patient_education_topics":[""],"nurse_education_resources":[""],"monitoring_frequency":"","escalation_criteria":""}],"trend_analysis":{"vital_signs_trend":"","functional_status_trend":"","care_plan_progress":"","incident_frequency":""},"care_plan_deviations":[{"care_plan_problem":"","deviation_description":"","corrective_action":""}],"medication_concerns":[{"concern_type":"","medications_involved":[""],"risk_description":"","recommendation":""}],"predictive_insights":{"readmission_risk":"","fall_risk":"","infection_risk":"","deterioration_risk":""}}`;

    const raw = await base44.integrations.Core.InvokeLLM({ model: "automatic", prompt });
    const result = parseLLMJson(raw) || {};

    return Response.json({
      success: true,
      patient_id: patientId,
      analysis_date: new Date().toISOString(),
      clinical_alerts: result?.clinical_alerts || [],
      trend_analysis: result?.trend_analysis || {},
      care_plan_deviations: result?.care_plan_deviations || [],
      medication_concerns: result?.medication_concerns || [],
      predictive_insights: result?.predictive_insights || {},
      overall_risk_score: result?.overall_risk_score || 0,
      risk_level: result?.risk_level || 'unknown'
    });

  } catch (error) {
    console.error('Error analyzing clinical risks:', error);
    return Response.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
});