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
        const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
        const user = await base44.auth.me();
        if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { extractedData, analysisResults } = await req.json();

        // Analyze referral and determine priority using AI
        const priorityAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
            model: "automatic",
            prompt: `You are a clinical triage AI specializing in home health referral prioritization with advanced Natural Language Processing (NLP) capabilities to extract crucial details from unstructured clinical notes.

Analyze this referral and determine the urgency/priority level based on:
- **Medical condition severity and complexity**: Prioritize acute conditions, rapid deterioration, or complex care needs
- **Recent hospitalizations or ER visits**: Flag recent admissions as higher risk requiring prompt follow-up
- **Clinical stability indicators**: Assess vital signs, lab results, and reported symptoms for instability
- **Wound severity or infection risks**: Evaluate wound characteristics and infection signs for urgency
- **Medication complexity and safety concerns**: Identify polypharmacy, new high-risk medications, or potential adverse drug events
- **Fall risk or safety issues**: Prioritize patients with high fall risk, environmental hazards, or cognitive impairment
- **Cognitive/mental health concerns**: Assess for acute changes in mental status, severe depression, or unmanaged behavioral issues
- **Social determinants and support system**: Consider lack of caregiver support, unstable housing, or food insecurity
- **Discharge planning urgency**: Referrals from acute care settings require quicker response times
- **Insurance/authorization timeline pressures**: Note any deadlines for pre-authorization or benefit expiration
- **Unstructured Clinical Notes (NLP)**: Use advanced text analysis to find hidden risks, critical events, or unaddressed needs in free-text fields, physician notes, discharge summaries, or handwritten comments

REFERRAL DATA (including all extracted information, structured and unstructured):
${JSON.stringify(extractedData, null, 2)}

AI-ASSISTED INITIAL ANALYSIS:
${JSON.stringify(analysisResults, null, 2)}

Provide a detailed priority assessment with clear reasoning and identify specific phrases or keywords from unstructured data that influenced your decision.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"priority":"urgent|high|normal|low","priority_score":0,"urgency_factors":[""],"clinical_risks":[""],"recommended_response_time":"","reasoning":"","critical_actions":[""]}`
        });

        return Response.json({
            success: true,
            priorityAnalysis: parseLLMJson(priorityAnalysis) || {}
        });

    } catch (error) {
        console.error('Error analyzing referral priority:', error);
        return Response.json({ 
            error: 'Internal server error',
            success: false
        }, { status: 500 });
    }
});