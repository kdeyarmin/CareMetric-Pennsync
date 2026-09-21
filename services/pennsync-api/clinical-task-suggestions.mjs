// Ported from base44/functions/analyzeAndGenerateClinicalTasks.
//
// A READ and a model call, with nothing behind them (D64). The capability's
// name says "generate" and it creates no task: it suggests them, dates them
// and hands them back. Reading it as a write is the mistake D64 exists to stop.
//
// Every scoping decision is the contract's. What is here is the original's
// prompt, its due-date map and its answer shape.
import { parseLLMJson } from './llm-json.mjs';
import { fail } from './contracts.mjs';

export const TASK_SUGGESTION_MODEL = 'automatic';

/**
 * The original's `calculateDueDate`, kept exactly — case-sensitive switch,
 * `default` of three days, and no normalisation of the model's answer.
 *
 * D63 computes a due date from the value that is STORED, because a stored
 * column and a stored date could otherwise disagree. Nothing here is stored,
 * so there is no second thing to agree with and the original's map stands.
 * The only change is WHICH day it counts from: the store's own, which the
 * contract returns, rather than whichever zone a service happened to run in.
 */
export function dueDate(today, timeframe) {
  const days = { today: 0, '24_hours': 1, '48_hours': 2, this_week: 7, next_visit: 3 };
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + (Object.hasOwn(days, timeframe) ? days[timeframe] : 3));
  return base.toISOString().split('T')[0];
}

/** The original's prompt, verbatim; the contract shaped every list in it. */
export const buildTaskSuggestionPrompt = context =>
  `You are an expert clinical nurse supervisor analyzing patient data to identify necessary follow-up tasks and interventions.

PATIENT DATA:
Name: ${context.patient?.patient_name ?? ''}
Primary Diagnosis: ${context.patient?.primary_diagnosis}
Secondary Diagnoses: ${(context.patient?.secondary_diagnoses ?? []).join(', ') || 'None'}
Medications: ${JSON.stringify((context.patient?.current_medications ?? []).slice(0, 5))}
Allergies: ${context.patient?.allergies || 'None documented'}

RECENT VISITS (last 5):
${JSON.stringify(context.visits, null, 2)}

ACTIVE ALERTS:
${JSON.stringify(context.alerts, null, 2)}

PENDING TASKS:
${JSON.stringify(context.tasks, null, 2)}

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

export async function analyzeAndGenerateClinicalTasks({ params, integration, contract }) {
  const patientId = typeof params.patientId === 'string' ? params.patientId.trim() : '';
  // The original's own 400: "Patient ID required", with its length bound.
  if (patientId === '' || patientId.length > 200) fail(400, 'PATIENT_ID_REQUIRED');

  const context = await contract('readClinicalTaskContext', { patient_id: patientId });
  const raw = await integration('InvokeLLM', {
    model: TASK_SUGGESTION_MODEL,
    prompt: buildTaskSuggestionPrompt(context),
  });
  const response = parseLLMJson(raw) || {};
  const suggested = Array.isArray(response.tasks) ? response.tasks : [];
  return {
    success: true,
    patient_name: context.patient.patient_name,
    patient_id: context.patient.id,
    tasks: suggested.map(task => ({ ...task, due_date: dueDate(context.today, task?.due_timeframe) })),
    analysis_timestamp: new Date().toISOString(),
  };
}
