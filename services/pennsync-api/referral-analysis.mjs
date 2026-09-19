// Ported from base44/functions/analyzeReferral.
//
// A dispatcher over four actions. Its own docstring calls it a replacement for
// `analyzeReferralPriority`, `generateReferralTasks` and `matchPatientWithAI`,
// and the frontend calls both it and two of those three — so both live on, and
// both are ported.
//
// They are NOT the same functions with a shared body. Every prompt here is
// shorter and differently worded than its standalone namesake, the task
// generator asks for JSON in-prompt where the standalone passes a
// `response_json_schema`, and the patient projection sends nine fields where
// the standalone sends twenty. Reusing the other modules would have changed
// what the model is asked on a path the frontend actually uses, which is why
// the prompts are reproduced here rather than imported.
//
// `full_analysis` starts priority and match together and only then asks for
// tasks, because the task prompt takes the priority answer as input. That order
// is behaviour, not an implementation detail, and the parity test asserts the
// call sequence rather than just the set.
import { parseLLMJson } from './llm-json.mjs';
import { fail, isObject } from './contracts.mjs';

export const ANALYSIS_MODEL = 'automatic';
export const REFERRAL_ACTIONS = Object.freeze(['analyze_priority', 'generate_tasks', 'match_patient', 'full_analysis']);

/** This dispatcher's own projection: nine fields, and `name` rather than `full_name`. */
export const projectCandidate = patient => ({
  id: patient.id,
  name: `${patient.first_name} ${patient.middle_name || ''} ${patient.last_name}`.trim(),
  mrn: patient.medical_record_number,
  dob: patient.date_of_birth,
  phone: patient.phone,
  address: patient.address,
  insurance: patient.payor,
  physician: patient.physician_name,
  status: patient.status,
});

export function buildPriorityPrompt(extractedData, analysisResults) {
  return `You are a clinical triage AI specializing in home health referral prioritization with advanced Natural Language Processing (NLP) capabilities.

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
{"priority":"urgent|high|normal|low","priority_score":0,"urgency_factors":[""],"clinical_risks":[""],"recommended_response_time":"","reasoning":"","critical_actions":[""]}`;
}

export function buildTasksPrompt(referralData, priorityAnalysis) {
  return `You are an expert home health intake coordinator. Based on the referral data and priority analysis, generate actionable tasks for office and clinical staff.

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
{"tasks":[{"title":"","description":"","type":"call|notify|schedule|order|coordinate|document|safety|followup|other","priority":"high|medium|low","assigned_role":"intake_coordinator|nurse_manager|field_nurse|billing|admin|other","due_date":"YYYY-MM-DD","ai_reason":""}]}`;
}

export function buildMatchPrompt(extractedData, existingPatients) {
  return `You are an expert patient matching system for healthcare records with advanced fuzzy matching capabilities.

Analyze the referral data and compare it against existing patients to find the best match.

REFERRAL PATIENT DATA:
${JSON.stringify(extractedData.demographics, null, 2)}

EXISTING PATIENTS IN SYSTEM (Top Candidates):
${JSON.stringify(existingPatients.map(projectCandidate), null, 2)}

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
{"best_match_id":"id-or-null","confidence_score":0,"confidence_level":"high|medium|low|no_match","match_factors":[""],"discrepancies":[""],"alternative_matches":[{"patient_id":"","patient_name":"","confidence_score":0,"reasons":[""],"discrepancies":[""]}],"recommendation":"use_match|manual_review|create_new","reasoning":""}`;
}

const ask = (integration, prompt) => integration('InvokeLLM', { model: ANALYSIS_MODEL, prompt });

async function analyzePriority(integration, { extractedData, analysisResults }) {
  const priorityAnalysis = await ask(integration, buildPriorityPrompt(extractedData, analysisResults));
  return { success: true, priorityAnalysis: parseLLMJson(priorityAnalysis) || {} };
}

async function generateTasks(integration, { referralData, priorityAnalysis }) {
  const tasks = await ask(integration, buildTasksPrompt(referralData, priorityAnalysis));
  // `(parsed).tasks || []` rather than an Array check: the original takes
  // whatever sits under `tasks`, so a non-array there reaches the caller here
  // too. Its standalone namesake guards with `Array.isArray`; this one does not.
  const parsedTasks = parseLLMJson(tasks) || {};
  return { success: true, tasks: parsedTasks.tasks || [] };
}

async function matchPatient(integration, { extractedData, existingPatients }) {
  const matchAnalysis = await ask(integration, buildMatchPrompt(extractedData, existingPatients));
  return { success: true, matchAnalysis: parseLLMJson(matchAnalysis) || {} };
}

async function fullAnalysis(integration, { extractedData, analysisResults, existingPatients }) {
  // Priority and match start together; tasks waits, because its prompt takes
  // the priority answer. Preserved as ordering, not merely as three calls.
  const [priority, match] = await Promise.all([
    analyzePriority(integration, { extractedData, analysisResults }),
    matchPatient(integration, { extractedData, existingPatients }),
  ]);
  const tasks = await generateTasks(integration, {
    referralData: extractedData,
    priorityAnalysis: priority.priorityAnalysis,
  });
  return { success: true, priority: priority.priorityAnalysis, patientMatch: match.matchAnalysis, tasks: tasks.tasks };
}

export async function analyzeReferral({ params, integration }) {
  const { action, ...rest } = isObject(params) ? params : {};
  switch (action) {
    case 'analyze_priority': return analyzePriority(integration, rest);
    case 'generate_tasks': return generateTasks(integration, rest);
    case 'match_patient': return matchPatient(integration, rest);
    case 'full_analysis': return fullAnalysis(integration, rest);
    // The original answers `{error: 'Invalid action'}` with a 400. This service
    // has one error envelope, so the refusal keeps the status and carries this
    // service's code — the same divergence, and the only one, as the other ports.
    default: return fail(400, 'INVALID_ACTION');
  }
}
