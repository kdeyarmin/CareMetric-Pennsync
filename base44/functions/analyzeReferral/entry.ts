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

/**
 * Unified Referral Analysis Function
 * Handles: priority analysis, task generation, and patient matching
 * Replaces: analyzeReferralPriority, generateReferralTasks, matchPatientWithAI
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
        const user = await base44.auth.me();
        if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { action, ...params } = await req.json();

        switch (action) {
            case 'analyze_priority':
                return await analyzePriority(base44, params);
            
            case 'generate_tasks':
                return await generateTasks(base44, params);
            
            case 'match_patient':
                return await matchPatient(base44, params);
            
            case 'full_analysis':
                // Run all three analyses in parallel for complete referral processing
                return await fullAnalysis(base44, params);
            
            default:
                return Response.json({ error: 'Invalid action' }, { status: 400 });
        }
    } catch (error) {
        console.error('Referral analysis error:', error);
        return Response.json({ 
            error: 'Internal server error',
            success: false
        }, { status: 500 });
    }
});

async function analyzePriority(base44, params) {
    const { extractedData, analysisResults } = params;

    const priorityAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: `You are a clinical triage AI specializing in home health referral prioritization with advanced Natural Language Processing (NLP) capabilities.

Analyze this referral and determine the urgency/priority level based on:
- Medical condition severity and complexity
- Recent hospitalizations or ER visits
- Clinical stability indicators
- Wound severity or infection risks
- Medication complexity and safety concerns
- Fall risk or safety issues
- Cognitive/mental health concerns
- Social determinants and support system
- Discharge planning urgency
- Insurance/authorization timeline pressures
- Unstructured Clinical Notes (NLP)

REFERRAL DATA:
${JSON.stringify(extractedData, null, 2)}

AI-ASSISTED INITIAL ANALYSIS:
${JSON.stringify(analysisResults, null, 2)}

Provide a detailed priority assessment with clear reasoning.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"priority":"urgent|high|normal|low","priority_score":0,"urgency_factors":[""],"clinical_risks":[""],"recommended_response_time":"","reasoning":"","critical_actions":[""]}`
    });

    return Response.json({
        success: true,
        priorityAnalysis: parseLLMJson(priorityAnalysis) || {}
    });
}

async function generateTasks(base44, params) {
    const { referralData, priorityAnalysis } = params;

    const tasks = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: `You are an expert home health intake coordinator. Based on the referral data and priority analysis, generate actionable tasks for office and clinical staff.

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

PRIORITY ANALYSIS:
${JSON.stringify(priorityAnalysis, null, 2)}

Generate tasks in these categories:
1. Immediate/Critical Actions
2. Patient Intake & Verification
3. Clinical Assessment & Coordination
4. Administrative Tasks

Each task should have:
- title, description, type, priority, assigned_role, due_date, ai_reason

Priority-based timing:
- Urgent: Same day or within 4-6 hours
- High: Within 24 hours
- Normal: Within 2-3 days
- Low: Within 1 week

Return 5-12 tasks ordered by priority and due date.

Return ONLY valid JSON, no prose or code fences, with this shape:
{"tasks":[{"title":"","description":"","type":"call|notify|schedule|order|coordinate|document|safety|followup|other","priority":"high|medium|low","assigned_role":"intake_coordinator|nurse_manager|field_nurse|billing|admin|other","due_date":"YYYY-MM-DD","ai_reason":""}]}`
    });

    const parsedTasks = parseLLMJson(tasks) || {};
    return Response.json({ success: true, tasks: parsedTasks.tasks || [] });
}

async function matchPatient(base44, params) {
    const { extractedData, existingPatients } = params;

    const matchAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: `You are an expert patient matching system for healthcare records with advanced fuzzy matching capabilities.

Analyze the referral data and compare it against existing patients to find the best match.

REFERRAL PATIENT DATA:
${JSON.stringify(extractedData.demographics, null, 2)}

EXISTING PATIENTS IN SYSTEM (Top Candidates):
${JSON.stringify(existingPatients.map(p => ({
    id: p.id,
    name: `${p.first_name} ${p.middle_name || ''} ${p.last_name}`.trim(),
    mrn: p.medical_record_number,
    dob: p.date_of_birth,
    phone: p.phone,
    address: p.address,
    insurance: p.payor,
    physician: p.physician_name,
    status: p.status
})), null, 2)}

**CONFIDENCE SCORING GUIDELINES:**
- 90-100%: High confidence - Strong match on name + DOB + additional identifiers
- 70-89%: Medium-high confidence - Good match but has minor discrepancies (quick review recommended)
- 50-69%: Medium confidence - Possible match with notable differences (manual review required)
- Below 50%: Low confidence - Likely different patient (create new record)

**MATCHING CRITERIA (weighted by importance):**
1. **Date of Birth** (30 points): Exact match is critical
2. **Name Matching** (25 points): 
   - Account for nicknames (Bob/Robert, Beth/Elizabeth)
   - Spelling variations (Jon/John, Katherine/Catherine)
   - Married name changes
   - Middle name/initial differences
3. **Phone Number** (15 points): Recent matches weighted higher
4. **Address** (10 points): Consider moves, partial matches
5. **Medical Record Number** (15 points): If available, strong identifier
6. **Insurance Provider** (5 points): Supporting evidence

**DISCREPANCY ANALYSIS:**
For each potential match, identify and list ALL discrepancies:
- Different addresses (person may have moved)
- Phone number mismatches (changed numbers)
- Name variations (nicknames, spelling)
- Insurance changes
- Any data conflicts

**OUTPUT REQUIREMENTS:**
- Best match with confidence score
- List TOP 3 alternative matches if confidence < 90%
- Clear reasoning for each match
- Specific discrepancies that need review
- Actionable recommendation

Return ONLY valid JSON, no prose or code fences, with this shape:
{"best_match_id":"id-or-null","confidence_score":0,"confidence_level":"high|medium|low|no_match","match_factors":[""],"discrepancies":[""],"alternative_matches":[{"patient_id":"","patient_name":"","confidence_score":0,"reasons":[""],"discrepancies":[""]}],"recommendation":"use_match|manual_review|create_new","reasoning":""}`
    });

    return Response.json({
        success: true,
        matchAnalysis: parseLLMJson(matchAnalysis) || {}
    });
}

async function fullAnalysis(base44, params) {
    const { extractedData, analysisResults, existingPatients } = params;

    // Run all analyses in parallel for efficiency
    const [priorityResult, matchResult] = await Promise.all([
        analyzePriority(base44, { extractedData, analysisResults }),
        matchPatient(base44, { extractedData, existingPatients })
    ]);

    const priorityData = await priorityResult.json();
    const matchData = await matchResult.json();

    // Generate tasks based on priority analysis
    const tasksResult = await generateTasks(base44, {
        referralData: extractedData,
        priorityAnalysis: priorityData.priorityAnalysis
    });

    const tasksData = await tasksResult.json();

    return Response.json({
        success: true,
        priority: priorityData.priorityAnalysis,
        patientMatch: matchData.matchAnalysis,
        tasks: tasksData.tasks
    });
}