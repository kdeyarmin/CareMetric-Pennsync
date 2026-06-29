import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Missing patient_id' }, { status: 400 });
    }

    // Fetch comprehensive historical data
    const [patients, visits, clinicalEvents] = await Promise.all([
      base44.entities.Patient.filter({ id: patient_id }),
      base44.entities.Visit.filter({ patient_id }, '-visit_date', 100),
      base44.entities.ClinicalEvent.filter({ patient_id }, '-event_date', 100)
    ]);

    const patient = patients[0];
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Extract vital signs over time
    const vitalsHistory = visits
      .filter(v => v.vital_signs)
      .map(v => ({
        date: v.visit_date,
        vitals: v.vital_signs
      }));

    // Group events by type
    const medicationEvents = clinicalEvents.filter(e =>
      e.event_type?.includes('medication')
    );
    const symptomEvents = clinicalEvents.filter(e =>
      e.event_type?.includes('symptom')
    );
    const labEvents = clinicalEvents.filter(e =>
      e.event_type?.includes('lab')
    );

    // Analyze trends with AI
    const rawTrends = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `Analyze this patient's clinical data over time and identify significant trends, patterns, and risks.

PATIENT: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}

VITAL SIGNS HISTORY (${vitalsHistory.length} visits):
${JSON.stringify(vitalsHistory, null, 2)}

MEDICATION CHANGES (${medicationEvents.length} events):
${JSON.stringify(medicationEvents.map(e => ({ date: e.event_date, title: e.event_title, description: e.event_description })), null, 2)}

SYMPTOM PROGRESSION (${symptomEvents.length} events):
${JSON.stringify(symptomEvents.map(e => ({ date: e.event_date, title: e.event_title, description: e.event_description, severity: e.severity })), null, 2)}

LAB RESULTS (${labEvents.length} events):
${JSON.stringify(labEvents.map(e => ({ date: e.event_date, title: e.event_title, description: e.event_description })), null, 2)}

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
{"vital_trends":[{"vital_type":"","trend_direction":"","concern_level":"","description":"","recommendation":""}],"symptom_patterns":[{"symptom":"","pattern":"","severity_trend":"","clinical_notes":""}],"medication_insights":{"adherence_assessment":"","effectiveness_notes":"","concerns":[""]},"risk_indicators":[{"risk_type":"","severity":"","evidence":"","action_needed":""}],"positive_trends":[{"achievement":"","supporting_data":""}],"comparative_insights":[{"correlation":"","metric_a":"","metric_b":"","relationship":"","clinical_significance":""}],"predictive_analytics":{"readmission_risk_score":0,"readmission_risk_level":"","deterioration_risk_score":0,"deterioration_risk_level":"","key_risk_factors":[""],"predicted_outcomes":[{"outcome":"","probability":"","timeframe":"","prevention_strategies":[""]}]},"overall_trajectory":"","priority_recommendations":[""]}`
    });
    const result = parseLLMJson(rawTrends) || {};

    return Response.json({
      success: true,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      data_analyzed: {
        visits: vitalsHistory.length,
        medication_events: medicationEvents.length,
        symptom_events: symptomEvents.length,
        lab_events: labEvents.length
      },
      vitals_data: vitalsHistory,
      vital_trends: result?.vital_trends || [],
      symptom_patterns: result?.symptom_patterns || [],
      medication_insights: result?.medication_insights || {},
      risk_indicators: result?.risk_indicators || [],
      positive_trends: result?.positive_trends || [],
      comparative_insights: result?.comparative_insights || [],
      predictive_analytics: result?.predictive_analytics || {},
      overall_trajectory: result?.overall_trajectory || 'unknown',
      priority_recommendations: result?.priority_recommendations || []
    });

  } catch (error) {
    console.error('Error analyzing clinical trends:', error);
    return Response.json({
      error: error.message
    }, { status: 500 });
  }
});