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

    // Skip the expensive LLM call when there's nothing to analyze — without
    // this guard, an empty payload still fires a claude_opus call that times
    // out at the 120s proxy limit.
    if (!extractedData || (typeof extractedData === 'object' && Object.keys(extractedData).length === 0)) {
      return Response.json({
        success: true,
        analysis: {
          missing_critical_info: { high_priority: ['No referral data provided — cannot analyze.'] },
          suggested_next_steps: []
        }
      });
    }

    // Use AI to comprehensively analyze the referral
    const analysisPrompt = `You are an expert home health intake coordinator. Analyze this referral data and provide comprehensive insights.

REFERRAL DATA:
${JSON.stringify(extractedData, null, 2)}

EXISTING ANALYSIS:
${JSON.stringify(analysisResults, null, 2)}

Provide a JSON response with the following structure:
{
  "category": {
    "primary": "cardiac|respiratory|wound_care|orthopedic|neurological|diabetes|post_surgical|general_medical|hospice|palliative",
    "secondary": ["list of secondary categories if applicable"],
    "specialty_requirements": ["any special certifications or skills needed"]
  },
  "missing_critical_info": {
    "high_priority": ["critical items missing that block admission"],
    "medium_priority": ["important items missing but admission can proceed"],
    "low_priority": ["nice-to-have items missing"]
  },
  "risk_assessment": {
    "clinical_complexity": "low|medium|high|critical",
    "readmission_risk": "low|medium|high",
    "fall_risk": "low|medium|high",
    "infection_risk": "low|medium|high",
    "key_concerns": ["specific clinical concerns to monitor"]
  },
  "suggested_next_steps": [
    {
      "action": "description of action",
      "priority": "immediate|urgent|high|medium|low",
      "timeframe": "within X hours/days",
      "responsible_role": "nurse|admin|physician|coordinator"
    }
  ],
  "assignment_recommendations": {
    "ideal_nurse_qualifications": ["IV therapy", "wound care certified", etc.],
    "visit_frequency_suggested": "daily|3x_week|2x_week|weekly",
    "estimated_episode_length": "30|60|90 days",
    "requires_specialized_skills": true|false
  },
  "care_coordination_needs": {
    "physician_contact_priority": "immediate|high|routine",
    "dme_orders_needed": ["list of equipment"],
    "therapy_services_recommended": ["PT", "OT", "ST"],
    "other_services": ["home health aide", "social work", etc.]
  },
  "compliance_alerts": [
    "any regulatory or compliance concerns identified"
  ],
  "documentation_gaps": [
    "specific documentation that should be obtained before first visit"
  ]
}

Return ONLY valid JSON matching the structure above, no prose or code fences.`;

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: analysisPrompt
    });

    return Response.json({
      success: true,
      analysis: parseLLMJson(response) || {}
    });

  } catch (error) {
    console.error('Referral analysis error:', error);
    return Response.json({ 
      error: 'Failed to analyze referral',
      details: 'Internal server error' 
    }, { status: 500 });
  }
});