import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        const { referralData, priorityAnalysis } = await req.json();

        const tasks = await base44.asServiceRole.integrations.Core.InvokeLLM({
            model: "automatic",
            prompt: `You are an expert home health intake coordinator. Based on the following referral data and AI priority analysis, generate a comprehensive list of actionable tasks that need to be completed by office staff and clinical staff for this referral.

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

Return a JSON array of 5-12 tasks ordered by priority and due date.`, 
            response_json_schema: {
                type: "object",
                properties: {
                    tasks: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                description: { type: "string" },
                                type: { type: "string", enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"] },
                                priority: { type: "string", enum: ["high", "medium", "low"] },
                                assigned_role: { type: "string", enum: ["intake_coordinator", "nurse_manager", "field_nurse", "billing", "admin", "other"] },
                                due_date: { type: "string" },
                                ai_reason: { type: "string" }
                            },
                            required: ["title", "description", "type", "priority", "assigned_role", "due_date", "ai_reason"]
                        }
                    }
                }
            }
        });

        return Response.json({ success: true, tasks: Array.isArray(tasks?.tasks) ? tasks.tasks : [] });

    } catch (error) {
        console.error('Error generating referral tasks:', error);
        return Response.json({ 
            error: 'Internal server error',
            success: false
        }, { status: 500 });
    }
});