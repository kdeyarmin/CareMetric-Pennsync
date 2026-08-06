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

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch comprehensive patient data using the RLS-scoped client (NOT
    // asServiceRole) so the platform enforces that this user may access this
    // patient — prevents cross-patient IDOR via a guessed patient_id. Mirrors
    // the safe pattern in processCompletedVisit / expandClinicalPhrase.
    const [patient] = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    // Claim before LLM + PatientAlert.create so concurrent runs cannot both
    // see empty alerts and duplicate high-risk rows.
    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `risk-predict-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.asServiceRole.entities.Patient.update(patient_id, {
        risk_predict_claimed_by: claimToken,
      });
    } catch {
      return Response.json({ error: 'Could not claim patient for risk prediction' }, { status: 409 });
    }
    const claimCheck = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].risk_predict_claimed_by !== claimToken) {
      return Response.json({
        success: true,
        already_processed: true,
        alerts_created: 0,
        alerts: [],
        skipped: 'claimed by concurrent run',
      });
    }

    const [visits, incidents, alerts] = await Promise.all([
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 20),
      base44.asServiceRole.entities.Incident.filter({ patient_id }, undefined, 5000),
      base44.asServiceRole.entities.PatientAlert.filter({ patient_id, status: 'active' }, undefined, 5000)
    ]);

    const completedVisits = visits.filter(v => v.status === 'completed');
    const recentVisits = completedVisits.slice(0, 5);

    // Prepare data for AI analysis
    const analysisData = {
      patient_info: {
        age: calculateAge(patient.date_of_birth),
        primary_diagnosis: patient.primary_diagnosis,
        secondary_diagnoses: patient.secondary_diagnoses || [],
        care_type: patient.care_type,
        admission_date: patient.admission_date,
        functional_status: patient.functional_status,
        social_history: patient.social_history,
        past_hospitalizations: patient.past_hospitalizations || []
      },
      recent_vitals: recentVisits.map(v => ({
        date: v.visit_date,
        vitals: v.vital_signs,
        notes_excerpt: v.nurse_notes?.substring(0, 200)
      })),
      vital_trends: calculateVitalTrends(recentVisits),
      incident_history: incidents.map(i => ({
        type: i.incident_type,
        date: i.incident_date,
        severity: i.severity
      })),
      existing_alerts: alerts.map(a => ({
        type: a.alert_type,
        severity: a.severity
      }))
    };

    // AI Risk Prediction
    const predictionPrompt = `You are an expert clinical risk assessment AI for home health and hospice care. Analyze the following patient data and predict risks for adverse events.

PATIENT DATA:
${JSON.stringify(analysisData, null, 2)}

ANALYZE FOR THE FOLLOWING RISKS:
1. Hospital Readmission Risk (30-day)
2. Fall Risk
3. Disease Exacerbation Risk (CHF, COPD, diabetes, etc.)
4. Medication Non-adherence Risk
5. Functional Decline Risk
6. Infection Risk
7. Pressure Injury Risk
8. Caregiver Burnout Risk

For each risk category:
- Assign a risk score (0-100, where 100 is highest risk)
- Identify specific contributing factors from the data
- Provide actionable recommendations for risk mitigation
- Determine urgency level (low, medium, high, critical)

Pay special attention to:
- Vital sign trends (worsening or unstable)
- Recent incidents or hospitalizations
- Unmet care plan goals
- Diagnosis-specific warning signs
- Social determinants of health
- Gaps in care or documentation

Be specific and evidence-based in your predictions.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"overall_risk_level":"low|medium|high|critical","risk_assessments":[{"risk_type":"","risk_score":0,"urgency":"low|medium|high|critical","contributing_factors":[""],"recommendations":[""],"evidence":""}],"immediate_actions_needed":[""],"monitoring_priorities":[""]}`;

    const rawRiskPredictions = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: predictionPrompt
    });
    const riskPredictions = parseLLMJson(rawRiskPredictions) || {};

    // Create alerts for high-risk findings. `risk_assessments` is not a required
    // field in the LLM response schema, so guard against a missing/non-array
    // value rather than throwing "undefined is not iterable" (an unhandled 500).
    const newAlerts = [];
    const riskAssessments = Array.isArray(riskPredictions?.risk_assessments)
      ? riskPredictions.risk_assessments
      : [];
    for (const risk of riskAssessments) {
      if (risk.risk_score >= 70 && risk.urgency !== 'low') {
        // Check if alert already exists
        const existingAlert = alerts.find(a => 
          a.alert_type === mapRiskToAlertType(risk.risk_type) && 
          a.status === 'active'
        );

        if (!existingAlert) {
          const alert = await base44.asServiceRole.entities.PatientAlert.create({
            patient_id: patient_id,
            alert_type: mapRiskToAlertType(risk.risk_type),
            severity: risk.urgency === 'critical' ? 'critical' : 
                     risk.risk_score >= 85 ? 'high' : 'medium',
            title: `High ${risk.risk_type} Risk Detected`,
            message: `AI analysis indicates elevated risk (${risk.risk_score}/100). ${risk.evidence}`,
            contributing_factors: risk.contributing_factors,
            recommended_actions: risk.recommendations,
            risk_score: risk.risk_score,
            data_sources: {
              analysis_date: new Date().toISOString(),
              vital_trends: analysisData.vital_trends,
              recent_visits_count: recentVisits.length,
              incidents_count: incidents.length
            },
            status: 'active',
            flagged_urgent: risk.urgency === 'critical'
          });
          newAlerts.push(alert);
        }
      }
    }

    // Log the risk assessment
    await base44.asServiceRole.entities.SystemLog.create({
      job_name: 'AI Risk Prediction',
      job_type: 'other',
      status: 'success',
      message: `Analyzed risks for patient ${patient.first_name} ${patient.last_name}`,
      details: {
        patient_id,
        overall_risk_level: riskPredictions.overall_risk_level,
        high_risk_count: riskAssessments.filter(r => r.risk_score >= 70).length,
        alerts_created: newAlerts.length,
        analyzed_by: user.email
      }
    });

    return Response.json({
      success: true,
      patient_id,
      overall_risk_level: riskPredictions.overall_risk_level,
      risk_assessments: riskAssessments,
      immediate_actions: riskPredictions.immediate_actions_needed,
      monitoring_priorities: riskPredictions.monitoring_priorities,
      alerts_created: newAlerts.length,
      trends: analysisData.vital_trends
    });

  } catch (error) {
    console.error('Error predicting patient risks:', error);
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});

// Helper function to calculate vital sign trends
function calculateVitalTrends(visits) {
  const trends = {};
  const vitalKeys = ['blood_pressure_systolic', 'heart_rate', 'oxygen_saturation', 'weight', 'pain_level'];

  vitalKeys.forEach(key => {
    const values = visits
      .filter(v => v.vital_signs?.[key])
      .map(v => ({ date: v.visit_date, value: v.vital_signs[key] }))
      .reverse();

    if (values.length >= 2) {
      const recent = values.slice(-3).map(v => v.value);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const previous = values.slice(0, Math.max(values.length - 3, 1)).map(v => v.value);
      const prevAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

      const change = avg - prevAvg;
      const changePercent = prevAvg !== 0 ? (change / prevAvg) * 100 : 0;

      trends[key] = {
        current_avg: Math.round(avg * 10) / 10,
        previous_avg: Math.round(prevAvg * 10) / 10,
        change: Math.round(change * 10) / 10,
        change_percent: Math.round(changePercent),
        trend: changePercent > 5 ? 'increasing' : changePercent < -5 ? 'decreasing' : 'stable',
        values: values
      };
    }
  });

  return trends;
}

// Map risk types to alert types
function mapRiskToAlertType(riskType) {
  const mapping = {
    'Hospital Readmission Risk': 'readmission_risk',
    'Fall Risk': 'fall_risk',
    'Disease Exacerbation Risk': 'symptom_escalation',
    'Medication Non-adherence Risk': 'medication_risk',
    'Functional Decline Risk': 'care_gap',
    'Infection Risk': 'infection_risk',
    'Pressure Injury Risk': 'infection_risk',
    'Caregiver Burnout Risk': 'caregiver_burnout'
  };
  
  return mapping[riskType] || 'urgent_intervention';
}