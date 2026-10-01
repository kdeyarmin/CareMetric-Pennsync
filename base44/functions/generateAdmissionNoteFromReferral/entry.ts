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

// Arbitrary referral payloads cannot safely become chart-ready clinical notes
// without patient/tenant provenance, source grounding, and clinician review.
const REFERRAL_ADMISSION_NOTE_AI_ENABLED = false;

Deno.serve(async (req) => {
  if (!REFERRAL_ADMISSION_NOTE_AI_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'referral_admission_note_ai_paused',
      message: 'AI referral admission-note drafting is unavailable pending tenant-scoped provenance and clinician review.',
      admission_note: null,
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { referralData, intakeAnalysis, patientData } = await req.json();

    const prompt = `You are an expert home health nurse creating a comprehensive admission note. Generate a well-structured, Medicare-compliant admission note based on this referral data.

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

AI INTAKE ANALYSIS:
${JSON.stringify(intakeAnalysis, null, 2)}

PATIENT DATA:
${JSON.stringify(patientData, null, 2)}

Generate a comprehensive admission note with the following sections. Use the referral data to populate each section with specific, detailed information:

1. REASON FOR ADMISSION
2. CHIEF COMPLAINT / PRESENTING PROBLEM
3. MEDICAL HISTORY
4. CURRENT MEDICATIONS
5. ALLERGIES
6. VITAL SIGNS (if available)
7. FUNCTIONAL STATUS / ADL ASSESSMENT
8. COGNITIVE STATUS
9. SAFETY ASSESSMENT (fall risk, infection risk, etc.)
10. HOME ENVIRONMENT
11. SUPPORT SYSTEM / CAREGIVER
12. PATIENT/CAREGIVER GOALS
13. INITIAL NURSING ASSESSMENT

Make the note:
- Professional and detailed
- Use specific data from the referral (dates, medications, diagnoses)
- Include clinical observations from the AI analysis
- Highlight any high-priority concerns or risks
- Use bullet points for clarity where appropriate
- Ready for nurse to review and add visit-specific observations

Return ONLY the formatted note text, no JSON structure.`;

    const noteText = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: prompt
    });

    return Response.json({
      success: true,
      admission_note: noteText
    });

  } catch (error) {
    console.error('Admission note generation error:', error);
    return Response.json({ 
      error: 'Failed to generate admission note',
      details: 'Internal server error' 
    }, { status: 500 });
  }
});
