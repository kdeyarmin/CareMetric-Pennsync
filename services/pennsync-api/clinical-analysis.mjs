// Ported from base44/functions/analyzeClinicalEvents and
// base44/functions/analyzeClinicalTrends.
//
// Two capabilities, one module, because they are the same shape over the same
// chart: read what the policies allow, ask the model, return the answer. There
// is no write contract behind either — **a capability that only reads needs
// only a read**, which is D53's sequence with its third step genuinely absent
// rather than paused.
//
// Everything about WHO may read and WHICH rows is the contract's. What is here
// is the two prompts, both the original's verbatim, and the shape of each
// answer, which is `parseLLMJson(raw) || {}` and then a field-by-field
// fallback — exactly as the originals defend themselves against a model that
// answers prose.
import { parseLLMJson } from './llm-json.mjs';
import { fail } from './contracts.mjs';

export const CLINICAL_MODEL = 'automatic';

/** The original's review prompt, verbatim. */
export const buildEventReviewPrompt = (patient, events) =>
  `Analyze these clinical events for a patient and identify potential issues:

Patient Context:
- Name: ${patient?.patient_name ?? ''}
- Primary Diagnosis: ${patient?.primary_diagnosis}
- Current Medications: ${medicationNames(patient?.current_medications) || 'None listed'}

Clinical Events to Review:
${JSON.stringify(events, null, 2)}

For each event, identify:
1. Missing critical information (e.g., medication without dosage, wound without location/stage)
2. Potential inconsistencies (e.g., conflicting information, unlikely values)
3. Events that need clarification or more detail
4. Events that might be duplicates or related to other events
5. Safety concerns or red flags

Only flag events that have actual issues. If an event looks complete and accurate, don't flag it.

For each flagged event, provide:
- The event ID
- Issue category (missing_info, inconsistency, needs_clarification, safety_concern, potential_duplicate)
- Specific issue description
- Suggested action or questions to ask the clinician
- Priority (high, medium, low)

Return ONLY valid JSON, no prose or code fences, with this shape:
{"flagged_events":[{"event_id":"","issue_category":"missing_info|inconsistency|needs_clarification|safety_concern|potential_duplicate","issue_description":"","suggested_action":"","priority":"high|medium|low","questions_for_clinician":[""]}],"overall_summary":""}`;

/** The original's trend prompt, verbatim. */
export const buildTrendPrompt = (patient, vitalsHistory, medication, symptom, lab) =>
  `Analyze this patient's clinical data over time and identify significant trends, patterns, and risks.

PATIENT: ${patient?.patient_name ?? ''}
Primary Diagnosis: ${patient?.primary_diagnosis || 'Not specified'}
Current Medications: ${medicationNames(patient?.current_medications) || 'None'}

VITAL SIGNS HISTORY (${vitalsHistory.length} visits):
${JSON.stringify(vitalsHistory, null, 2)}

MEDICATION CHANGES (${medication.length} events):
${JSON.stringify(medication.map(e => ({ date: e.date, title: e.title, description: e.description })), null, 2)}

SYMPTOM PROGRESSION (${symptom.length} events):
${JSON.stringify(symptom.map(e => ({ date: e.date, title: e.title, description: e.description, severity: e.severity })), null, 2)}

LAB RESULTS (${lab.length} events):
${JSON.stringify(lab.map(e => ({ date: e.date, title: e.title, description: e.description })), null, 2)}

Analyze and provide:

1. VITAL SIGNS TRENDS: For each vital sign (BP, HR, temp, O2, weight), identify:
   - Overall trend (improving, stable, declining, fluctuating)
   - Specific concerns or patterns
   - Rate of change
   - Clinical significance

2. SYMPTOM PATTERNS: Identify:
   - Recurring symptoms
   - Symptom progression or resolution
   - Triggers or correlations
   - Severity trends

3. MEDICATION ADHERENCE & EFFECTIVENESS:
   - Changes over time
   - Potential side effects appearing in timeline
   - Effectiveness indicators

4. COMPARATIVE ANALYSIS: Identify correlations between:
   - Symptoms appearing after medication changes
   - Vital sign changes following symptom reports
   - Lab results correlating with clinical deterioration
   - Time-based patterns (e.g., symptoms worsening before hospitalization)

5. PREDICTIVE ANALYTICS:
   - Calculate hospital readmission risk (0-100 score)
   - Identify early warning signs of clinical deterioration
   - Predict likelihood of care plan goal achievement
   - Forecast potential complications based on current trajectory

6. RISK INDICATORS:
   - Early warning signs
   - Deteriorating metrics
   - Hospital readmission risks

7. POSITIVE TRENDS:
   - Improvements
   - Goals being met
   - Successful interventions

Provide actionable insights for clinicians.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"vital_trends":[{"vital_type":"","trend_direction":"","concern_level":"","description":"","recommendation":""}],"symptom_patterns":[{"symptom":"","pattern":"","severity_trend":"","clinical_notes":""}],"medication_insights":{"adherence_assessment":"","effectiveness_notes":"","concerns":[""]},"risk_indicators":[{"risk_type":"","severity":"","evidence":"","action_needed":""}],"positive_trends":[{"achievement":"","supporting_data":""}],"comparative_insights":[{"correlation":"","metric_a":"","metric_b":"","relationship":"","clinical_significance":""}],"predictive_analytics":{"readmission_risk_score":0,"readmission_risk_level":"","deterioration_risk_score":0,"deterioration_risk_level":"","key_risk_factors":[""],"predicted_outcomes":[{"outcome":"","probability":"","timeframe":"","prevention_strategies":[""]}]},"overall_trajectory":"","priority_recommendations":[""]}`;

/** `patient.current_medications?.map(m => m.name).join(', ')`, guarded. */
export function medicationNames(medications) {
  return Array.isArray(medications)
    ? medications.map(item => item?.name).filter(Boolean).join(', ') : '';
}

export async function analyzeClinicalEvents({ params, integration, contract }) {
  const patientId = params.patient_id;
  // The original's own 400: "Missing patient_id".
  if (typeof patientId !== 'string' || patientId === '') fail(400, 'PATIENT_ID_REQUIRED');
  const read = await contract('reviewClinicalEvents', { patient_id: patientId });
  // The original's early return, before any model call is paid for.
  if (read.events.length === 0) {
    return { success: true, flagged_events: [], message: 'No unverified events to analyze' };
  }
  const raw = await integration('InvokeLLM', {
    model: CLINICAL_MODEL,
    prompt: buildEventReviewPrompt(read.patient, read.events),
  });
  const parsed = parseLLMJson(raw) || {};
  return {
    success: true,
    flagged_events: parsed?.flagged_events || [],
    overall_summary: parsed?.overall_summary || '',
    total_events_analyzed: read.events.length,
  };
}

export async function analyzeClinicalTrends({ params, integration, contract }) {
  const patientId = params.patient_id;
  if (typeof patientId !== 'string' || patientId === '') fail(400, 'PATIENT_ID_REQUIRED');
  const read = await contract('readClinicalTrendContext', { patient_id: patientId });
  // The contract groups each event once; the original filters the same list
  // three times with `event_type?.includes(...)`.
  const group = name => read.events.filter(event => event.group === name);
  const medication = group('medication');
  const symptom = group('symptom');
  const lab = group('lab');
  const raw = await integration('InvokeLLM', {
    model: CLINICAL_MODEL,
    prompt: buildTrendPrompt(read.patient, read.vitals_history, medication, symptom, lab),
  });
  const result = parseLLMJson(raw) || {};
  return {
    success: true,
    patient_name: read.patient.patient_name,
    data_analyzed: {
      visits: read.vitals_history.length,
      medication_events: medication.length,
      symptom_events: symptom.length,
      lab_events: lab.length,
    },
    vitals_data: read.vitals_history,
    vital_trends: result?.vital_trends || [],
    symptom_patterns: result?.symptom_patterns || [],
    medication_insights: result?.medication_insights || {},
    risk_indicators: result?.risk_indicators || [],
    positive_trends: result?.positive_trends || [],
    comparative_insights: result?.comparative_insights || [],
    predictive_analytics: result?.predictive_analytics || {},
    overall_trajectory: result?.overall_trajectory || 'unknown',
    priority_recommendations: result?.priority_recommendations || [],
  };
}
