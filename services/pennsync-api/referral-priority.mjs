// Ported from base44/functions/analyzeReferralPriority.
//
// The original authorizes, reads `{extractedData, analysisResults}` from the
// body, makes one `Core.InvokeLLM` call and answers with the parsed result. The
// authorization is gone from this module because the service resolved it before
// the handler ran; everything else is preserved, including two things that look
// like details and are not:
//
// - **The prompt is the contract.** It is what the model is asked, so a
//   reworded version is a different function even when the code around it
//   matches. It is reproduced verbatim and a parity test drives the original
//   and this module with the same input and compares the call arguments.
// - **The parser is deliberately tolerant.** The original's comment explains
//   why it does not pass `response_json_schema`: the provider rejects deeply
//   nested object schemas that lack an explicit `required` array at every
//   level. So the model is asked for strict JSON in-prompt and the answer is
//   salvaged here — code fences stripped, then a braces-substring fallback. A
//   stricter parser would turn answers the original accepted into failures.
import { isObject } from './contracts.mjs';
// Shared with `referral-intake.mjs`: both originals carry the same extractor
// and the same comment explaining why it is tolerant.
export { parseLLMJson } from './llm-json.mjs';
import { parseLLMJson } from './llm-json.mjs';

/**
 * The prompt the original sends, with the same two interpolations.
 *
 * `JSON.stringify(value, null, 2)` returns undefined for undefined input, and
 * the original interpolated it regardless — so a missing field becomes the
 * literal "undefined" in the prompt there and here.
 */
export function buildPriorityPrompt(extractedData, analysisResults) {
  return `You are a clinical triage AI specializing in home health referral prioritization with advanced Natural Language Processing (NLP) capabilities to extract crucial details from unstructured clinical notes.

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
{"priority":"urgent|high|normal|low","priority_score":0,"urgency_factors":[""],"clinical_risks":[""],"recommended_response_time":"","reasoning":"","critical_actions":[""]}`;
}

/** The model selector the original passes. "automatic" lets the broker choose. */
export const PRIORITY_MODEL = 'automatic';

/**
 * The handler. `integration` is the capability `app.mjs` bound to this caller;
 * this module never sees the credential that authorizes the call.
 */
export async function analyzeReferralPriority({ params, integration }) {
  const input = isObject(params) ? params : {};
  const priorityAnalysis = await integration('InvokeLLM', {
    model: PRIORITY_MODEL,
    prompt: buildPriorityPrompt(input.extractedData, input.analysisResults),
  });
  // The original answers `{}` rather than null when the model returns something
  // unparseable, so a caller always receives an object to read fields from.
  return { success: true, priorityAnalysis: parseLLMJson(priorityAnalysis) || {} };
}
