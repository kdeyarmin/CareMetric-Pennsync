// Ported from base44/functions/analyzeReferralIntake.
//
// One `InvokeLLM`, no entity row, and one guard that matters more than it
// looks: an empty payload answers a canned analysis WITHOUT calling the model.
// The original's comment says why — "without this guard, an empty payload still
// fires a claude_opus call that times out at the 120s proxy limit" — so the
// branch is a cost and latency control, not a validation nicety. Dropping it
// would turn an instant answer into a two-minute failure.
import { parseLLMJson } from './llm-json.mjs';
import { isObject } from './contracts.mjs';

export const INTAKE_MODEL = 'automatic';

/** The answer the original gives when there is nothing to analyse. */
export const EMPTY_REFERRAL_ANALYSIS = Object.freeze({
  missing_critical_info: { high_priority: ['No referral data provided — cannot analyze.'] },
  suggested_next_steps: [],
});

/** Exactly the original's condition: absent, or an object with no keys. */
export const nothingToAnalyse = extractedData =>
  !extractedData || (typeof extractedData === 'object' && Object.keys(extractedData).length === 0);

export function buildIntakePrompt(extractedData, analysisResults) {
  return `You are an expert home health intake coordinator. Analyze this referral data and provide comprehensive insights.

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
}

export async function analyzeReferralIntake({ params, integration }) {
  const input = isObject(params) ? params : {};
  if (nothingToAnalyse(input.extractedData)) {
    // Structurally cloned rather than returned frozen, so a caller reading the
    // answer cannot reach back into the module's constant.
    return { success: true, analysis: structuredClone(EMPTY_REFERRAL_ANALYSIS) };
  }
  const response = await integration('InvokeLLM', {
    model: INTAKE_MODEL,
    prompt: buildIntakePrompt(input.extractedData, input.analysisResults),
  });
  return { success: true, analysis: parseLLMJson(response) || {} };
}
