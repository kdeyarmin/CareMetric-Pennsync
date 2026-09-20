// Ported from base44/functions/triageReferralWithAI.
//
// The first capability to sequence a brokered model call and a write, and the
// pattern the remaining model-backed ports follow: ask the model, shape the
// answer, record ONLY what may be recorded, and say whether that record was
// made.
//
// **The audit rule is the original's and it is a containment rule**, stated in
// its own comment:
//
//     "Log only the triage category. The analysis contains patient identity and
//      clinical detail; UserActivity is a broad operational audit surface, not
//      a second copy of the referral record."
//
// So the trail entry carries the urgency level and nothing else — the same
// discipline D44 kept for a patched incident, where only the KEYS of the change
// are recorded. `auditUrgencyLevel` normalises an unexpected answer to
// `UNKNOWN` rather than writing whatever the model said into the trail.
//
// **`audit_recorded` returns here, and that is not a reversal of D37.** D37
// deleted the incident port's `audit_recorded` flag because one transaction
// made it impossible for the change and its record to disagree. This handler
// has no transaction to offer: the model call is a network round trip and the
// trail append is another, so a failed append after a successful analysis is a
// state that can really happen. The original swallows it and returns the
// analysis anyway — which is right, because the analysis has already been paid
// for and losing it helps nobody — and this says so in the answer rather than
// silently. **The flag belongs wherever a transaction does not.**
import { parseLLMJson } from './llm-json.mjs';
import { fail } from './contracts.mjs';

export const TRIAGE_MODEL = 'automatic';
export const TRIAGE_URGENCY_LEVELS = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

/** The original's `auditUrgencyLevel`: a known level, or `UNKNOWN`. */
export function auditUrgencyLevel(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return TRIAGE_URGENCY_LEVELS.includes(normalized) ? normalized : 'UNKNOWN';
}

/** The original's prompt, verbatim: the schema it names is what the caller gets. */
export const buildTriagePrompt = referralData =>
  `You are an expert home health triage nurse. Analyze the following unstructured referral data and provide a structured assessment.

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

Return ONLY valid JSON, no markdown or explanation.`;

export async function triageReferral({ params, integration, audit }) {
  const referralData = params.referralData;
  if (typeof referralData !== 'string' || referralData.trim() === '') {
    fail(400, 'REFERRAL_DATA_REQUIRED');
  }
  const raw = await integration('InvokeLLM', {
    model: TRIAGE_MODEL,
    prompt: buildTriagePrompt(referralData),
  });
  const analysis = parseLLMJson(raw) || {};

  // The category and nothing else — see the note at the head of this file.
  let auditRecorded = true;
  try {
    await audit('referral_triage_analysis', {
      detail: { urgency_level: auditUrgencyLevel(analysis?.urgency_level) },
    });
  } catch {
    // Static, like the original's: a provider or store message can echo the
    // prompt, and the prompt is the whole referral.
    auditRecorded = false;
  }
  return {
    success: true,
    analysis,
    processedAt: new Date().toISOString(),
    audit_recorded: auditRecorded,
  };
}
