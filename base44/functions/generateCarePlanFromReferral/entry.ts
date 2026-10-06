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

// Arbitrary referral payloads cannot safely become clinical care plans without
// patient/tenant provenance, source grounding, and explicit clinician review.
const REFERRAL_CARE_PLAN_DRAFT_ENABLED = false;

Deno.serve(async (req) => {
  if (!REFERRAL_CARE_PLAN_DRAFT_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'referral_care_plan_draft_paused',
      message: 'AI referral care-plan drafting is unavailable pending tenant-scoped provenance and clinician review.',
      care_plans: [],
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { referralData, intakeAnalysis, existingCarePlans = [] } = await req.json();

    const prompt = `You are an expert home health care planning specialist. Generate comprehensive, Medicare-compliant care plans based on this referral data.

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

AI INTAKE ANALYSIS:
${JSON.stringify(intakeAnalysis, null, 2)}

EXISTING CARE PLANS (if any):
${JSON.stringify(existingCarePlans, null, 2)}

Generate 3-5 care plans that address the patient's primary needs. Each care plan should follow this structure and be specific, measurable, and achievable.

Return a JSON array of care plans with this exact structure:
[
  {
    "problem": "Clear nursing diagnosis (e.g., 'Impaired mobility related to post-surgical status')",
    "goal": "Specific, measurable goal with timeframe (e.g., 'Patient will ambulate 50 feet with walker independently within 30 days')",
    "interventions": [
      "Specific nursing intervention 1",
      "Specific nursing intervention 2",
      "Specific nursing intervention 3"
    ],
    "frequency": "How often to assess (e.g., 'Each visit', 'Weekly', '3x per week')",
    "baseline_measurement": "Current state/measurement (e.g., 'Currently ambulates 20 feet with max assist')",
    "target_days": 30 or 60 or 90,
    "priority": "high|medium|low",
    "rationale": "Brief clinical rationale for this care plan"
  }
]

GUIDELINES:
- Address primary diagnosis and complications
- Include medication management if applicable
- Address functional limitations and ADL needs
- Include patient/caregiver education
- Consider safety issues (falls, infection, etc.)
- Avoid duplicating existing care plans
- Make goals SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
- Use professional nursing language
- Prioritize based on clinical urgency and patient needs`;

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: prompt,
      response_json_schema: {
        type: "object",
        properties: {
          care_plans: {
            type: "array",
            items: {
              type: "object",
              properties: {
                problem: { type: "string" },
                goal: { type: "string" },
                interventions: {
                  type: "array",
                  items: { type: "string" }
                },
                frequency: { type: "string" },
                baseline_measurement: { type: "string" },
                target_days: { type: "number" },
                priority: { type: "string" },
                rationale: { type: "string" }
              }
            }
          }
        }
      }
    });

    return Response.json({
      success: true,
      care_plans: response.care_plans || []
    });

  } catch (error) {
    console.error('Care plan generation error:', error);
    // Generic client-facing message; detail stays server-side only (matches the
    // hardened userManagement pattern — leaking error.message aids reconnaissance).
    return Response.json({
      error: 'Failed to generate care plans'
    }, { status: 500 });
  }
});