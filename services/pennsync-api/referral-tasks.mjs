// Ported from base44/functions/generateReferralTasks.
//
// Unlike its two siblings this one DOES pass `response_json_schema`, because
// its schema carries `required` at every level and the provider takes it. The
// contrast is in the originals on purpose, so the schema is reproduced here
// rather than replaced with the tolerant parser the others use.
//
// Two oddities are preserved rather than corrected, because a port that fixes
// the original is a different function:
//
// - The prompt asks for `priority` as `'urgent', 'high', 'normal', 'low'` while
//   the schema's enum is `["high", "medium", "low"]`. The model is therefore
//   asked for values the schema rejects. That is what callers see today.
// - `due_date` is described as YYYY-MM-DD in the prompt and typed as a bare
//   string in the schema, so nothing enforces the format.
//
// Both are recorded here so the next reader knows they were seen and kept, not
// missed. Changing either belongs in a change about this feature, not in a port.
import { isObject } from './contracts.mjs';

export const TASKS_MODEL = 'automatic';

/** The schema the original sends, reproduced exactly, enum mismatch included. */
export const REFERRAL_TASKS_SCHEMA = Object.freeze({
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
          assigned_role: { type: 'string', enum: ['intake_coordinator', 'nurse_manager', 'field_nurse', 'billing', 'admin', 'other'] },
          due_date: { type: 'string' },
          ai_reason: { type: 'string' },
        },
        required: ['title', 'description', 'type', 'priority', 'assigned_role', 'due_date', 'ai_reason'],
      },
    },
  },
});

export function buildTasksPrompt(referralData, priorityAnalysis) {
  return `You are an expert home health intake coordinator. Based on the following referral data and AI priority analysis, generate a comprehensive list of actionable tasks that need to be completed by office staff and clinical staff for this referral.

Prioritize tasks based on the referral's urgency. Ensure tasks are specific, measurable, achievable, relevant, and time-bound (SMART).

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

PRIORITY ANALYSIS:
${JSON.stringify(priorityAnalysis, null, 2)}

Generate tasks in the following categories:
1. **Immediate/Critical Actions**: Based on priority level and clinical risks
2. **Patient Intake & Verification**: Demographics, insurance, physician orders
3. **Clinical Assessment & Coordination**: Nurse assignment, visit scheduling, care planning
4. **Administrative Tasks**: Documentation, authorization, billing setup

Each task should have:
- title: Concise task description
- description: Detailed instructions for completion
- type: 'call', 'notify', 'schedule', 'order', 'coordinate', 'document', 'safety', 'followup', 'other'
- priority: Match or derive from referral priority ('urgent', 'high', 'normal', 'low')
- assigned_role: 'intake_coordinator', 'nurse_manager', 'field_nurse', 'billing', 'admin', 'other'
- due_date: YYYY-MM-DD format, calculated based on priority
- ai_reason: Brief explanation why this task was generated

Priority-based timing:
- Urgent: Same day or within 4-6 hours
- High: Within 24 hours
- Normal: Within 2-3 days
- Low: Within 1 week

Use 'critical_actions' from priority analysis for urgent tasks.
Reference missing_information, clinical_risks, and urgency_factors to create targeted tasks.

Return a JSON array of 5-12 tasks ordered by priority and due date.`;
}

export async function generateReferralTasks({ params, integration }) {
  const input = isObject(params) ? params : {};
  const tasks = await integration('InvokeLLM', {
    model: TASKS_MODEL,
    prompt: buildTasksPrompt(input.referralData, input.priorityAnalysis),
    response_json_schema: structuredClone(REFERRAL_TASKS_SCHEMA),
  });
  // The original answers an empty array rather than failing when the model
  // returns something without a `tasks` array, so a caller always gets a list.
  return { success: true, tasks: Array.isArray(tasks?.tasks) ? tasks.tasks : [] };
}
