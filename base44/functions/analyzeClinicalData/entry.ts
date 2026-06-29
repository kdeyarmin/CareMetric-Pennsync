import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Unified Clinical Data Analysis Function
 * Handles: event extraction, event analysis, trend analysis, and care plan generation
 * Replaces: extractClinicalEvents, analyzeClinicalEvents, analyzeClinicalTrends, generateCarePlanSuggestions
 */

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

    const { action, ...params } = await req.json();

    switch (action) {
      case 'extract_events': {
        const { noteText, patientId } = params;

        const eventsResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "claude_opus_4_8",
          prompt: `Analyze this clinical note and extract ALL significant clinical events with high accuracy.

Clinical Note:
${noteText}

Extract events such as:
- Medication changes (started, stopped, dose changes, side effects)
- Vital sign abnormalities or concerning trends
- New symptoms, symptom exacerbations, or resolutions
- Falls, injuries, or safety incidents
- Wound assessments or changes in wound status
- Cognitive changes or behavioral changes
- Functional status changes (ADL, mobility)
- Pain level changes
- Hospitalizations, ER visits, or physician appointments
- New diagnoses or complications
- Lab results or test results
- Infections or signs of infection
- Equipment/DME orders or changes

For each event:
- type: medication_change, medication_started, medication_stopped, fall, vital_change, symptom_new, symptom_resolved, wound_new, wound_change, cognitive_change, functional_change, pain_change, hospitalization, er_visit, physician_appointment, lab_result, infection, surgery, dme_ordered, other
- title: Brief, specific title (e.g., "BP Elevated to 160/95" not just "Vital Change")
- description: Detailed clinical description with context
- date: Date mentioned or infer from context
- severity: low/medium/high/critical based on clinical significance
- structured_data: Specific details (med name, dosage, vital values, location, etc.)
- source_text: Exact relevant text from note
- requires_followup: true if needs action/monitoring
- confidence: 0-100 (only include events with confidence >= 70)

Be thorough - extract ALL clinically significant events, not just major ones.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"events":[{"type":"","title":"","description":"","date":"","severity":"low|medium|high|critical","structured_data":{},"source_text":"","requires_followup":false,"confidence":0}]}`
        });

        return Response.json({ events: parseLLMJson(eventsResponse)?.events || [] });
      }

      case 'analyze_events':
        return await analyzeEvents(base44, params);

      case 'analyze_trends':
        return await analyzeTrends(base44, params);

      case 'generate_care_plans':
        return await generateCarePlans(base44, params);

      case 'full_clinical_analysis':
        // Complete clinical analysis with all components
        return await fullClinicalAnalysis(base44, params);

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Clinical data analysis error:', error);
    return Response.json({
      error: error.message,
      success: false
    }, { status: 500 });
  }
});

async function extractEvents(base44, params) {
  const { visit_id, patient_id, nurse_notes, visit_date } = params;

  if (!visit_id || !patient_id || !nurse_notes) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const rawResult = await base44.integrations.Core.InvokeLLM({
    model: "claude_opus_4_8",
    prompt: `Extract ALL significant clinical events from this nursing note. Be thorough.

Visit Note:
${nurse_notes}

Extract: medication changes, appointments, hospitalizations, falls, wounds, labs, symptoms, vital changes, cognitive/functional changes, pain, infections, procedures, therapy changes, DME, and other significant events.

For each event provide: event_type, event_title, event_description, structured_data, severity, requires_followup, followup_notes, source_text (exact quote), source_section, extraction_confidence (0-100).

event_type must be one of: medication_change, medication_started, medication_stopped, physician_appointment, hospitalization, er_visit, fall, wound_new, wound_change, lab_result, symptom_new, symptom_resolved, vital_change, cognitive_change, functional_change, pain_change, infection, surgery, therapy_change, dme_ordered, other.
severity must be one of: low, medium, high, critical.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"events":[{"event_type":"","event_title":"","event_description":"","structured_data":{},"severity":"low|medium|high|critical","requires_followup":false,"followup_notes":"","source_text":"","source_section":"","extraction_confidence":0}]}`
  });
  const parsed = parseLLMJson(rawResult) || {};

  // Allowed ClinicalEvent enums; coerce any AI value outside these sets to a
  // safe default so ClinicalEvent.create won't reject the record.
  const ALLOWED_EVENT_TYPES = new Set([
    'medication_change', 'medication_started', 'medication_stopped',
    'physician_appointment', 'hospitalization', 'er_visit', 'fall',
    'wound_new', 'wound_change', 'lab_result', 'symptom_new',
    'symptom_resolved', 'vital_change', 'cognitive_change',
    'functional_change', 'pain_change', 'infection', 'surgery',
    'therapy_change', 'dme_ordered', 'other'
  ]);
  const ALLOWED_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

  // Save extracted events
  const savedEvents = [];
  for (const event of parsed.events || []) {
    // Coerce out-of-enum AI values to safe defaults before persisting
    event.event_type = ALLOWED_EVENT_TYPES.has(event.event_type) ? event.event_type : 'other';
    event.severity = ALLOWED_SEVERITIES.has(event.severity) ? event.severity : 'medium';

    let text_anchor_start = null;
    let text_anchor_end = null;

    if (event.source_text && nurse_notes) {
      const index = nurse_notes.indexOf(event.source_text.trim());
      if (index !== -1) {
        text_anchor_start = index;
        text_anchor_end = index + event.source_text.length;
      }
    }

    const eventData = {
      patient_id,
      visit_id,
      event_date: visit_date,
      ...event,
      text_anchor_start,
      text_anchor_end,
      verified: false
    };

    const savedEvent = await base44.asServiceRole.entities.ClinicalEvent.create(eventData);
    savedEvents.push(savedEvent);
  }

  return Response.json({
    success: true,
    events_extracted: savedEvents.length,
    events: savedEvents
  });
}

async function analyzeEvents(base44, params) {
  const { patient_id } = params;

  if (!patient_id) {
    return Response.json({ error: 'Missing patient_id' }, { status: 400 });
  }

  const events = await base44.entities.ClinicalEvent.filter({
    patient_id,
    verified: false
  }, '-event_date');

  if (events.length === 0) {
    return Response.json({
      success: true,
      flagged_events: [],
      message: 'No unverified events to analyze'
    });
  }

  const patients = await base44.entities.Patient.filter({ id: patient_id });
  const patient = patients[0];

  const eventsContext = events.map(e => ({
    id: e.id,
    type: e.event_type,
    title: e.event_title,
    description: e.event_description,
    structured_data: e.structured_data,
    event_date: e.event_date,
    severity: e.severity,
    extraction_confidence: e.extraction_confidence
  }));

  const result = await base44.integrations.Core.InvokeLLM({
    model: "claude_opus_4_8",
    prompt: `Analyze these clinical events for a patient and identify potential issues:

Patient: ${patient?.first_name} ${patient?.last_name}
Primary Diagnosis: ${patient?.primary_diagnosis}
Current Medications: ${patient?.current_medications?.map(m => m.name).join(', ') || 'None'}

Clinical Events:
${JSON.stringify(eventsContext, null, 2)}

Identify:
1. Missing critical information
2. Potential inconsistencies
3. Events needing clarification
4. Potential duplicates or related events
5. Safety concerns or red flags

Only flag events with actual issues. For each flagged event provide: event_id, issue_category, issue_description, suggested_action, priority, questions_for_clinician.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"flagged_events":[{"event_id":"","issue_category":"","issue_description":"","suggested_action":"","priority":"","questions_for_clinician":[""]}],"overall_summary":""}`
  });
  const parsed = parseLLMJson(result) || {};

  return Response.json({
    success: true,
    flagged_events: parsed?.flagged_events || [],
    overall_summary: parsed?.overall_summary || '',
    total_events_analyzed: events.length
  });
}

async function analyzeTrends(base44, params) {
  const { patient_id } = params;

  if (!patient_id) {
    return Response.json({ error: 'Missing patient_id' }, { status: 400 });
  }

  const [patients, visits, clinicalEvents] = await Promise.all([
    base44.entities.Patient.filter({ id: patient_id }),
    base44.entities.Visit.filter({ patient_id }, '-visit_date', 100),
    base44.entities.ClinicalEvent.filter({ patient_id }, '-event_date', 100)
  ]);

  const patient = patients[0];
  if (!patient) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const vitalsHistory = visits
    .filter(v => v.vital_signs)
    .map(v => ({ date: v.visit_date, vitals: v.vital_signs }));

  const medicationEvents = clinicalEvents.filter(e => e.event_type?.includes('medication'));
  const symptomEvents = clinicalEvents.filter(e => e.event_type?.includes('symptom'));
  const labEvents = clinicalEvents.filter(e => e.event_type?.includes('lab'));

  const result = await base44.integrations.Core.InvokeLLM({
    model: "claude_opus_4_8",
    prompt: `Analyze this patient's clinical data over time and identify significant trends, patterns, and risks.

PATIENT: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis}

VITAL SIGNS HISTORY (${vitalsHistory.length} visits):
${JSON.stringify(vitalsHistory, null, 2)}

MEDICATION CHANGES (${medicationEvents.length} events):
${JSON.stringify(medicationEvents.map(e => ({ date: e.event_date, title: e.event_title, description: e.event_description })), null, 2)}

SYMPTOM PROGRESSION (${symptomEvents.length} events):
${JSON.stringify(symptomEvents.map(e => ({ date: e.event_date, title: e.event_title, severity: e.severity })), null, 2)}

LAB RESULTS (${labEvents.length} events):
${JSON.stringify(labEvents.map(e => ({ date: e.event_date, title: e.event_title })), null, 2)}

Analyze and provide:
1. VITAL SIGNS TRENDS: Overall trend, concerns, rate of change, clinical significance
2. SYMPTOM PATTERNS: Recurring symptoms, progression/resolution, triggers, severity trends
3. MEDICATION ADHERENCE & EFFECTIVENESS
4. COMPARATIVE ANALYSIS: Correlations between metrics
5. PREDICTIVE ANALYTICS: Readmission risk (0-100), deterioration signs, goal achievement likelihood
6. RISK INDICATORS: Early warnings, deteriorating metrics
7. POSITIVE TRENDS: Improvements, goals met

Provide actionable insights for clinicians.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"vital_trends":[{"vital_type":"","trend_direction":"","concern_level":"","description":"","recommendation":""}],"symptom_patterns":[{"symptom":"","pattern":"","severity_trend":"","clinical_notes":""}],"medication_insights":{"adherence_assessment":"","effectiveness_notes":"","concerns":[""]},"risk_indicators":[{"risk_type":"","severity":"","evidence":"","action_needed":""}],"positive_trends":[{"achievement":"","supporting_data":""}],"comparative_insights":[{"correlation":"","metric_a":"","metric_b":"","relationship":"","clinical_significance":""}],"predictive_analytics":{"readmission_risk_score":0,"readmission_risk_level":"","deterioration_risk_score":0,"key_risk_factors":[""],"predicted_outcomes":[{"outcome":"","probability":"","timeframe":"","prevention_strategies":[""]}]},"overall_trajectory":"","priority_recommendations":[""]}`
  });
  const parsed = parseLLMJson(result) || {};

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
    vital_trends: parsed?.vital_trends || [],
    symptom_patterns: parsed?.symptom_patterns || [],
    medication_insights: parsed?.medication_insights || {},
    risk_indicators: parsed?.risk_indicators || [],
    positive_trends: parsed?.positive_trends || [],
    comparative_insights: parsed?.comparative_insights || [],
    predictive_analytics: parsed?.predictive_analytics || {},
    overall_trajectory: parsed?.overall_trajectory || 'unknown',
    priority_recommendations: parsed?.priority_recommendations || []
  });
}

async function generateCarePlans(base44, params) {
  const { patient_id } = params;

  if (!patient_id) {
    return Response.json({ error: 'Missing patient_id' }, { status: 400 });
  }

  const [patients, clinicalEvents, existingCarePlans, visits, incidents] = await Promise.all([
    base44.entities.Patient.filter({ id: patient_id }),
    base44.entities.ClinicalEvent.filter({ patient_id }, '-event_date', 50),
    base44.entities.CarePlan.filter({ patient_id }),
    base44.entities.Visit.filter({ patient_id }, '-visit_date', 10),
    base44.entities.Incident.filter({ patient_id }, '-incident_date', 10)
  ]);

  const patient = patients[0];
  if (!patient) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const result = await base44.integrations.Core.InvokeLLM({
    model: "claude_opus_4_8",
    prompt: `Generate comprehensive care plan suggestions for this home health patient.

PATIENT: ${patient.first_name} ${patient.last_name}, Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
Primary Diagnosis: ${patient.primary_diagnosis}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Medications: ${patient.current_medications?.map(m => `${m.name} ${m.dosage || ''}`).join(', ')}

RECENT CLINICAL EVENTS: ${JSON.stringify(clinicalEvents.slice(0, 20), null, 2)}
RECENT VISITS: ${JSON.stringify(visits.slice(0, 5), null, 2)}
INCIDENTS: ${JSON.stringify(incidents, null, 2)}
EXISTING CARE PLANS: ${existingCarePlans.map(cp => cp.problem).join(', ') || 'None'}

Generate care plan suggestions addressing:
1. Unaddressed clinical needs
2. Risk factors requiring prevention
3. Medication management
4. Functional improvement opportunities
5. Safety concerns
6. Patient education needs
7. Chronic disease management

For each: problem (NANDA-I), measurable goal, 3-5 interventions, expected outcomes, baseline measurement, frequency, priority, rationale, medicare considerations, target_days.

Only suggest NEW care plans not already covered.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"suggestions":[{"problem":"","goal":"","interventions":[""],"expected_outcomes":"","baseline_measurement":"","frequency":"","priority":"","rationale":"","medicare_considerations":"","target_days":0}],"overall_assessment":"","critical_gaps_identified":[""]}`
  });
  const parsed = parseLLMJson(result) || {};

  return Response.json({
    success: true,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    suggestions: parsed?.suggestions || [],
    overall_assessment: parsed?.overall_assessment || '',
    critical_gaps_identified: parsed?.critical_gaps_identified || []
  });
}

async function fullClinicalAnalysis(base44, params) {
  const { patient_id } = params;

  // Run all analyses in parallel
  const [trendsResult, carePlansResult, eventsResult] = await Promise.all([
    analyzeTrends(base44, { patient_id }),
    generateCarePlans(base44, { patient_id }),
    analyzeEvents(base44, { patient_id })
  ]);

  const trendsData = await trendsResult.json();
  const carePlansData = await carePlansResult.json();
  const eventsData = await eventsResult.json();

  return Response.json({
    success: true,
    trends: trendsData,
    care_plan_suggestions: carePlansData,
    event_analysis: eventsData
  });
}