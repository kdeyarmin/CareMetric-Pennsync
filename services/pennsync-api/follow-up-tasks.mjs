// Ported from base44/functions/generateFollowUpTasks.
//
// D53's order with a read contract in front, the shape D58 established and
// D62 refined: authorize the chart and take only what a read purpose
// discloses, ask the model, record what may be recorded.
//
// **The body keys are the original's** (D58): `noteText`, `patientId`,
// `visitId`, `visitType` and `diagnosis` are what its callers send.
import { fail } from './contracts.mjs';

export const FOLLOW_UP_MODEL = 'automatic';

/** The original's response schema, verbatim, enums included. */
export const FOLLOW_UP_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string', enum: ['call', 'notify', 'schedule', 'order', 'coordinate', 'document', 'safety', 'followup', 'other'] },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          due_timeframe: { type: 'string', enum: ['today', '24_hours', '48_hours', 'this_week', 'next_visit'] },
          ai_reason: { type: 'string' },
        },
      },
    },
  },
});

/**
 * The original's `patientContext` line, composed from what the contract
 * disclosed plus the caller's own `diagnosis` fallback — which is the
 * original's order: the chart's primary diagnosis first, then theirs.
 */
export function buildPatientContext(context, diagnosis) {
  const secondary = Array.isArray(context?.secondary_diagnoses)
    ? context.secondary_diagnoses.join(', ') : '';
  return `Patient: ${context?.patient_name ?? ''}, Primary Diagnosis: `
    + `${context?.primary_diagnosis || diagnosis || 'Not documented'}, `
    + `Secondary Diagnoses: ${secondary || 'None'}`;
}

/** The original's prompt, verbatim. */
export const buildFollowUpPrompt = (noteText, patientContext, visitType) =>
  `You are a home health/hospice clinical supervisor reviewing a finalized nursing note. Extract specific follow-up tasks the clinician must complete after this visit.

FINALIZED NOTE:
${noteText}

${patientContext ? `PATIENT CONTEXT:\n${patientContext}` : ''}
VISIT TYPE: ${visitType || 'routine_visit'}

Extract 2-5 concrete, actionable follow-up tasks. Focus ONLY on tasks clearly evidenced or implied by the note:
- Physician contact / notifications needed (e.g., "Contact MD re: elevated BP 172/96")
- Orders to obtain (wound care supplies, labs, medication changes)
- Scheduling (follow-up visits, recertification due, specialist referrals)
- Patient/family callbacks or education reinforcement
- Safety monitoring items (fall risk, infection signs)
- Documentation to complete

Return JSON array of tasks.`;

export async function generateFollowUpTasks({ params, integration, contract }) {
  const noteText = params.noteText;
  const patientId = typeof params.patientId === 'string' ? params.patientId.trim() : '';
  const visitId = params.visitId === undefined || params.visitId === null
    ? null : String(params.visitId).trim();
  // The original's own 400s, in its own words and its own order.
  if (typeof noteText !== 'string' || noteText.trim() === '') fail(400, 'NOTE_TEXT_REQUIRED');
  if (patientId === '' || patientId.length > 200) fail(400, 'PATIENT_ID_REQUIRED');
  if (params.visitId !== undefined
    && (typeof params.visitId !== 'string' || visitId === '' || visitId.length > 200)) {
    fail(400, 'VISIT_ID_INVALID');
  }

  const context = await contract('getFollowUpTaskContext',
    { patient_id: patientId, visit_id: visitId });

  const answer = await integration('InvokeLLM', {
    model: FOLLOW_UP_MODEL,
    prompt: buildFollowUpPrompt(noteText,
      buildPatientContext(context, params.diagnosis), params.visitType),
    response_json_schema: FOLLOW_UP_SCHEMA,
  });
  // `Array.isArray(response?.tasks) ? response.tasks : []`, exactly.
  const tasks = Array.isArray(answer?.tasks) ? answer.tasks : [];

  const stored = await contract('recordFollowUpTasks',
    { patient_id: patientId, visit_id: visitId, tasks });
  return {
    success: true,
    tasks_created: stored.tasks_created,
    tasks: stored.tasks,
    tasks_skipped: stored.tasks_skipped,
    patient_name: context.patient_name,
    ...(stored.already_processed
      ? { already_processed: true, skipped: stored.skipped } : {}),
  };
}
