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

const TRIAGE_URGENCY_LEVELS = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

function auditUrgencyLevel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return TRIAGE_URGENCY_LEVELS.has(normalized) ? normalized : 'UNKNOWN';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { referralData } = body;

    if (!referralData) {
      return Response.json({ error: 'Referral data required' }, { status: 400 });
    }

    // Use OpenAI to analyze and structure the referral
    const rawAnalysis = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `You are an expert home health triage nurse. Analyze the following unstructured referral data and provide a structured assessment.

REFERRAL DATA:
${referralData}

Provide a JSON response with this exact structure:
{
  "patient_name": "extracted patient name or 'Not provided'",
  "date_of_birth": "extracted DOB or 'Not provided'",
  "primary_diagnosis": "main diagnosis extracted",
  "secondary_diagnoses": ["list of other conditions"],
  "urgency_level": "CRITICAL|HIGH|MEDIUM|LOW",
  "urgency_reason": "brief explanation for urgency assignment",
  "key_risk_factors": ["list of identified risk factors"],
  "clinical_summary": "concise assessment of patient's current status",
  "preliminary_care_plan": {
    "skilled_nursing_frequency": "e.g., 3x weekly",
    "initial_focus_areas": ["primary interventions needed"],
    "medications_to_reconcile": "notable medications mentioned",
    "equipment_needed": ["supplies or equipment required"],
    "safety_concerns": ["identified safety issues"],
    "discharge_readiness": "assessment of current status"
  },
  "admission_notes": "brief notes for admission nurse",
  "data_gaps": ["information missing from referral"]
}

Return ONLY valid JSON, no markdown or explanation.`,
    });
    const analysis = parseLLMJson(rawAnalysis) || {};

    // Log only the triage category. The analysis contains patient identity and
    // clinical detail; UserActivity is a broad operational audit surface, not
    // a second copy of the referral record.
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'referral_triage_analysis',
      details: {
        urgency_level: auditUrgencyLevel(analysis?.urgency_level),
      },
      page: 'referral_triage',
      user_agent: req.headers.get('user-agent'),
    }).catch(() => console.error('Referral triage activity logging failed'));

    return Response.json({
      success: true,
      analysis,
      processedAt: new Date().toISOString(),
    });
  } catch {
    // Provider errors can echo prompt fragments; keep logs static because the
    // prompt contains the full referral payload.
    console.error('Referral triage analysis failed');
    return Response.json(
      { error: 'Triage analysis failed', details: 'Internal server error' },
      { status: 500 }
    );
  }
});
