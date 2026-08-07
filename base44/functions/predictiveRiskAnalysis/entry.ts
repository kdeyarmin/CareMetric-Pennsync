import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, risk_types } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    const [patientData] = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    const denied = await assertPatientAccess(base44, user, patientData);
    if (denied) return denied;

    // Claim before LLM + PatientAlert.create (shared field with predictPatientRisks).
    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `risk-predict-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.asServiceRole.entities.Patient.update(patient_id, {
        risk_predict_claimed_by: claimToken,
      });
    } catch {
      return Response.json({ error: 'Could not claim patient for risk analysis' }, { status: 409 });
    }
    const claimCheck = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].risk_predict_claimed_by !== claimToken) {
      return Response.json({
        success: true,
        already_processed: true,
        alerts_created: 0,
        skipped: 'claimed by concurrent run',
      });
    }

    // Fetch related data
    const [visits, incidents, existingAlerts] = await Promise.all([
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 10),
      base44.asServiceRole.entities.Incident.filter({ patient_id }, '-incident_date', 5),
      base44.asServiceRole.entities.PatientAlert.filter({ patient_id, status: 'active' }, undefined, 5000)
    ]);

    // Calculate age
    const age = calculateAge(patientData.date_of_birth);

    // Analyze vital sign trends
    const vitalTrends = analyzeVitalTrends(visits);

    // Build comprehensive context
    const patientContext = `
PATIENT PROFILE:
- Name: ${patientData.first_name} ${patientData.last_name}
- Age: ${age ?? 'Unknown'}
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patientData.care_type || 'home_health'}
- Status: ${patientData.status || 'active'}

FUNCTIONAL STATUS:
- Ambulation: ${patientData.functional_status?.ambulation || 'Not assessed'}
- ADL Independence: ${patientData.functional_status?.adl_independence || 'Not assessed'}
- Cognitive Status: ${patientData.functional_status?.cognitive_status || 'Not assessed'}
- Fall Risk: ${patientData.functional_status?.fall_risk || 'Not assessed'}

SOCIAL DETERMINANTS:
- Living Situation: ${patientData.social_history?.living_situation || 'Unknown'}
- Primary Language: ${patientData.social_history?.primary_language || 'Not specified'}
- Interpreter Needed: ${patientData.social_history?.interpreter_needed ? 'Yes' : 'No'}
- Support System: ${patientData.social_history?.support_system || 'Not documented'}
- Transportation: ${patientData.social_history?.transportation || 'Not documented'}

MEDICATIONS: ${patientData.current_medications?.length || 0} medications
${patientData.current_medications?.slice(0, 10).map(m => `- ${m.name} ${m.dosage} ${m.frequency}`).join('\n') || 'None documented'}

ALLERGIES: ${patientData.allergies || 'None documented'}

RECENT VISIT HISTORY (Last 10 visits):
${visits.map(v => `- ${v.visit_date} (${v.visit_type}): ${v.nurse_notes?.substring(0, 200) || 'No notes'}...`).join('\n') || 'No recent visits'}

VITAL SIGN TRENDS:
${vitalTrends}

PAST HOSPITALIZATIONS:
${patientData.past_hospitalizations?.map(h => `- ${h.date}: ${h.reason} at ${h.hospital} (${h.length_of_stay} days)`).join('\n') || 'None documented'}

RECENT INCIDENTS (Last 5):
${incidents.map(i => `- ${i.incident_date}: ${i.incident_type} (${i.severity}) - ${i.report?.substring(0, 150)}...`).join('\n') || 'None reported'}

BASELINE VITALS:
- BP: ${patientData.baseline_vitals?.blood_pressure_systolic}/${patientData.baseline_vitals?.blood_pressure_diastolic} mmHg
- HR: ${patientData.baseline_vitals?.heart_rate} bpm
- Temp: ${patientData.baseline_vitals?.temperature}°F
- O2: ${patientData.baseline_vitals?.oxygen_saturation}%
- Weight: ${patientData.baseline_vitals?.weight} lbs
`;

    // Generate risk analysis. Uses response_json_schema, so the structured object
    // is returned directly. (Was assigned to `rawRiskAnalysis` while every use
    // below referenced an undeclared `riskAnalysis` — a guaranteed ReferenceError
    // that 500'd every call, so this clinical feature produced no risk scores or
    // alerts at all.)
    const riskAnalysis = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `You are an expert clinical risk assessment AI for home health/hospice care. Analyze this patient's comprehensive data to predict risk of adverse events and recommend preventative interventions.

${patientContext}

RISK ANALYSIS TASKS:
1. READMISSION RISK (0-100): Analyze likelihood of hospital readmission within 30 days based on:
   - Recent hospitalizations
   - Diagnosis complexity and comorbidities
   - Vital sign instability
   - Medication complexity and potential non-compliance
   - Social determinants (living alone, transportation issues, support system)
   - Fall risk and functional decline
   - Cognitive impairment

2. FALL RISK (0-100): Assess fall likelihood based on:
   - Functional status (ambulation, fall risk score)
   - Age and diagnoses
   - Medications causing dizziness/weakness
   - Cognitive status
   - Home environment factors
   - Previous fall incidents

3. ADVERSE EVENT RISK (0-100): Predict likelihood of adverse clinical events:
   - Vital sign trends showing deterioration
   - Symptom progression
   - Medication errors or interactions
   - Wound complications or infections
   - Acute exacerbations of chronic conditions

4. MEDICATION SAFETY RISK (0-100): Assess medication-related risks:
   - Polypharmacy (number of medications)
   - High-risk medications
   - Cognitive impairment affecting compliance
   - Lack of caregiver support
   - Recent medication changes

5. FUNCTIONAL DECLINE RISK (0-100): Predict likelihood of ADL/IADL decline:
   - Current functional status
   - Diagnosis progression
   - Age factors
   - Social isolation
   - Nutritional concerns

For EACH risk type with score >= 50, provide:
- Specific contributing factors from patient data
- Evidence-based preventative interventions
- Care plan adjustments
- Recommended tasks for care team
- Timeline for reassessment

Be specific, actionable, and clinically sound. Reference actual patient data points.

Return comprehensive risk assessment:`,
      response_json_schema: {
        type: "object",
        properties: {
          risk_scores: {
            type: "object",
            properties: {
              readmission_risk: { type: "number" },
              fall_risk: { type: "number" },
              adverse_event_risk: { type: "number" },
              medication_safety_risk: { type: "number" },
              functional_decline_risk: { type: "number" }
            }
          },
          high_risk_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: {
                  type: "string",
                  enum: [
                    "vital_deterioration",
                    "medication_risk",
                    "fall_risk",
                    "readmission_risk",
                    "infection_risk",
                    "symptom_escalation",
                    "care_gap",
                    "urgent_intervention",
                    "hospice_transition",
                    "caregiver_burnout",
                    "documentation_risk"
                  ]
                },
                severity: {
                  type: "string",
                  enum: ["critical", "high", "medium", "low"]
                },
                risk_score: { type: "number" },
                title: { type: "string" },
                message: { type: "string" },
                contributing_factors: {
                  type: "array",
                  items: { type: "string" }
                },
                recommended_actions: {
                  type: "array",
                  items: { type: "string" }
                },
                care_adjustments: {
                  type: "array",
                  items: { type: "string" }
                },
                reassessment_timeframe: { type: "string" }
              }
            }
          },
          overall_risk_level: { type: "string" },
          summary: { type: "string" }
        }
      }
    });

    // Allowed PatientAlert alert_type values; anything the AI returns outside
    // this set is coerced to a safe default so PatientAlert.create won't reject.
    const ALLOWED_ALERT_TYPES = new Set([
      'vital_deterioration',
      'medication_risk',
      'fall_risk',
      'readmission_risk',
      'infection_risk',
      'symptom_escalation',
      'care_gap',
      'urgent_intervention',
      'hospice_transition',
      'caregiver_burnout',
      'documentation_risk'
    ]);

    // Allowed PatientAlert severity values; anything the AI returns outside this
    // set is coerced to a safe default so PatientAlert.create won't reject.
    const ALLOWED_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

    // Confidence/risk gate: the prompt asks for alerts only at risk_score >= 50,
    // but nothing enforces it — without a floor a low-risk AI alert auto-creates a
    // PatientAlert and adds to alert fatigue. Skip anything below the threshold.
    const minRiskScore = 50;

    // Create or update patient alerts for high-risk findings
    const createdAlerts = [];
    for (const alert of riskAnalysis.high_risk_alerts || []) {
      const riskScore = Number(alert.risk_score);
      if (Number.isFinite(riskScore) && riskScore < minRiskScore) continue;

      const alertType = ALLOWED_ALERT_TYPES.has(alert.alert_type)
        ? alert.alert_type
        : 'urgent_intervention';
      const severity = ALLOWED_SEVERITIES.has(alert.severity)
        ? alert.severity
        : 'medium';

      // Check if similar alert already exists
      const existingSimilar = existingAlerts.find(ea =>
        ea.alert_type === alertType && ea.status === 'active'
      );

      if (!existingSimilar) {
        const newAlert = await base44.asServiceRole.entities.PatientAlert.create({
          patient_id,
          alert_type: alertType,
          severity: severity,
          title: alert.title,
          message: alert.message,
          contributing_factors: alert.contributing_factors,
          recommended_actions: alert.recommended_actions,
          risk_score: alert.risk_score,
          data_sources: {
            analysis_date: new Date().toISOString(),
            patient_age: age,
            diagnoses: patientData.primary_diagnosis,
            recent_visits: visits.length,
            incidents: incidents.length
          },
          status: 'active',
          flagged_urgent: severity === 'critical'
        });
        createdAlerts.push(newAlert);
      }
    }

    return Response.json({
      success: true,
      patient_id,
      risk_scores: riskAnalysis.risk_scores,
      overall_risk_level: riskAnalysis.overall_risk_level,
      summary: riskAnalysis.summary,
      alerts_created: createdAlerts.length,
      high_risk_alerts: riskAnalysis.high_risk_alerts,
      analysis_timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Predictive risk analysis error:', error);
    return Response.json({ 
      success: false,
      error: 'Internal server error' 
    }, { status: 500 });
  }
});

function analyzeVitalTrends(visits) {
  if (!visits || visits.length === 0) return 'No vital sign data available';

  const trends = [];
  const vitals = visits
    .filter(v => v.vital_signs)
    .map(v => ({
      date: v.visit_date,
      ...v.vital_signs
    }));

  if (vitals.length === 0) return 'No vital signs documented in recent visits';

  // BP trend
  const bpReadings = vitals.filter(v => v.blood_pressure_systolic).map(v => v.blood_pressure_systolic);
  if (bpReadings.length >= 2) {
    const recent = bpReadings.slice(0, 3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    trends.push(`BP Systolic avg (last 3): ${avg.toFixed(0)} mmHg`);
  }

  // Weight trend
  const weights = vitals.filter(v => v.weight).map(v => v.weight);
  if (weights.length >= 2) {
    const change = weights[0] - weights[weights.length - 1];
    trends.push(`Weight change: ${change > 0 ? '+' : ''}${change.toFixed(1)} lbs`);
  }

  // O2 trend
  const o2Readings = vitals.filter(v => v.oxygen_saturation).map(v => v.oxygen_saturation);
  if (o2Readings.length >= 2) {
    const recent = o2Readings.slice(0, 3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    trends.push(`O2 Sat avg (last 3): ${avg.toFixed(0)}%`);
  }

  return trends.join('\n') || 'Insufficient data for trend analysis';
}