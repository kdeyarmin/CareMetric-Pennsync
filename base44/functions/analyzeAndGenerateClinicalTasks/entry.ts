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

    const { patientId, analysisType = 'comprehensive' } = await req.json();

    // Fetch comprehensive patient data
    // Reads are scoped to the authenticated user (tenant/RLS) rather than service role
    // to prevent reading patients the caller is not authorized to access (IDOR hardening).
    const [patient, visits, carePlans, alerts, recentTasks] = await Promise.all([
      base44.entities.Patient.filter({ id: patientId }).then(p => p[0]),
      base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5),
      base44.entities.CarePlan.filter({ patient_id: patientId, status: 'active' }),
      base44.entities.PatientAlert.filter({ patient_id: patientId, status: 'active' }),
      base44.asServiceRole.entities.Task.filter({ patient_id: patientId, status: { $in: ['pending', 'in_progress'] } })
    ]);

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const prompt = `You are an expert clinical nurse supervisor analyzing patient data to identify necessary follow-up tasks and interventions.

PATIENT DATA:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Medications: ${JSON.stringify(patient.current_medications?.slice(0, 5) || [])}
Allergies: ${patient.allergies || 'None documented'}

RECENT VISITS (last 5):
${JSON.stringify(visits.map(v => ({
  date: v.visit_date,
  type: v.visit_type,
  notes: v.nurse_notes?.substring(0, 300),
  vitals: v.vital_signs
})), null, 2)}

ACTIVE CARE PLANS:
${JSON.stringify(carePlans.map(cp => ({
  problem: cp.problem,
  goal: cp.goal,
  target_date: cp.target_date,
  frequency: cp.frequency
})), null, 2)}

ACTIVE ALERTS:
${JSON.stringify(alerts.map(a => ({
  type: a.alert_type,
  severity: a.severity,
  message: a.message,
  created: a.created_date
})), null, 2)}

PENDING TASKS:
${JSON.stringify(recentTasks.map(t => ({
  title: t.title,
  type: t.type,
  priority: t.priority,
  due_date: t.due_date
})), null, 2)}

ANALYSIS INSTRUCTIONS:
Analyze the patient's data and generate specific, actionable clinical tasks. Consider:
1. Patterns in vital signs that need follow-up
2. Care plan goals approaching target dates
3. Medication adherence concerns
4. Safety risks (falls, infections, readmission)
5. Documentation gaps or required assessments
6. Coordination needs (physician contact, DME orders, etc.)

Generate tasks that:
- Are specific and actionable
- Have clear due dates/timeframes
- Don't duplicate existing pending tasks
- Are prioritized by clinical urgency
- Include clinical reasoning

Return a JSON array of tasks:
[
  {
    "title": "Clear, specific task title",
    "description": "Detailed description of what needs to be done and why",
    "type": "call|notify|schedule|order|coordinate|document|safety|followup|other",
    "priority": "high|medium|low",
    "due_timeframe": "today|24_hours|48_hours|this_week|next_visit",
    "clinical_rationale": "Why this task is needed (for nurse understanding)",
    "intervention_type": "monitoring|medication|education|safety|coordination|assessment",
    "risk_level": "critical|high|moderate|low",
    "suggested_actions": ["Specific action 1", "Specific action 2"]
  }
]

Prioritize based on:
- HIGH: Immediate safety concerns, acute changes, critical coordination needs
- MEDIUM: Important follow-ups, care plan assessments, routine coordination
- LOW: Documentation updates, routine education, non-urgent scheduling

Generate 3-7 tasks maximum, focusing on most clinically relevant items.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"tasks":[{"title":"","description":"","type":"call|notify|schedule|order|coordinate|document|safety|followup|other","priority":"high|medium|low","due_timeframe":"today|24_hours|48_hours|this_week|next_visit","clinical_rationale":"","intervention_type":"monitoring|medication|education|safety|coordination|assessment","risk_level":"critical|high|moderate|low","suggested_actions":[""]}]}`;

    const rawResponse = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: prompt
    });
    const response = parseLLMJson(rawResponse) || {};

    const suggestedTasks = response.tasks || [];

    // Calculate due dates based on timeframes
    const calculateDueDate = (timeframe) => {
      const date = new Date();
      switch (timeframe) {
        case 'today':
          return date.toISOString().split('T')[0];
        case '24_hours':
          date.setDate(date.getDate() + 1);
          return date.toISOString().split('T')[0];
        case '48_hours':
          date.setDate(date.getDate() + 2);
          return date.toISOString().split('T')[0];
        case 'this_week':
          date.setDate(date.getDate() + 7);
          return date.toISOString().split('T')[0];
        case 'next_visit':
          date.setDate(date.getDate() + 3);
          return date.toISOString().split('T')[0];
        default:
          date.setDate(date.getDate() + 3);
          return date.toISOString().split('T')[0];
      }
    };

    // Add due dates to tasks
    const tasksWithDates = suggestedTasks.map(task => ({
      ...task,
      due_date: calculateDueDate(task.due_timeframe)
    }));

    return Response.json({
      success: true,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      patient_id: patientId,
      tasks: tasksWithDates,
      analysis_timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Clinical task analysis error:', error);
    return Response.json({
      error: 'Failed to analyze and generate tasks',
      details: error.message
    }, { status: 500 });
  }
});