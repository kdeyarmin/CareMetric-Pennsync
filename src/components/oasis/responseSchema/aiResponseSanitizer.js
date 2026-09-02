// Defensive sanitisation of anything a model returns about an OASIS item.
//
// WHY THIS IS DEFENSIVE AND NOT JUST A PROMPT CHANGE
// Prompts are asked, not enforced. A model that has been told "do not return a
// code" still can — through a field nobody planned for, or inside prose. This
// module is the boundary that makes such a code inert: it is stripped before it
// can reach state, storage, the clipboard, an export, or a calculation.
//
// AI may return evidence, uncertainty, discrepancies, questions, documentation
// guidance and non-code summaries. It may never return a final official OASIS
// response, and no PennSync surface may treat one as selectable.
//
// Pure functions. No React, no SDK.

/** Fields that carried model-chosen codes and must never survive. */
export const FORBIDDEN_AI_RESPONSE_KEYS = Object.freeze([
  "suggested_response",
  "suggested_value",
  "suggested_code",
  "recommended_score",
  "recommended_response",
  "recommended_code",
  "auto_update",
  "autoUpdate",
  "prefill",
  "prefilled_response",
  "response_value",
  "response",
  "code",
  "codes",
  "selected_code",
  "oasis_response",
  "answer",
]);

/** Keys an AI payload MAY keep. Anything else is dropped. */
export const ALLOWED_AI_KEYS = Object.freeze([
  "item_number",
  "item_id",
  "definition_id",
  "evidence",
  "evidence_quote",
  "source_excerpt",
  "uncertainty",
  "discrepancy",
  "discrepancies",
  "missing_information",
  "question",
  "questions",
  "documentation_guidance",
  "guidance",
  "summary",
  "rationale",
  "confidence_note",
]);

/**
 * Strip every code-bearing field from one AI item payload.
 *
 * Returns `{ clean, stripped }` — `stripped` names what was removed so a
 * surface can log or surface that the model tried, rather than failing silently.
 */
export function sanitizeAiItemPayload(payload) {
  const stripped = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { clean: {}, stripped };
  }
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_AI_RESPONSE_KEYS.includes(key)) { stripped.push(key); continue; }
    if (!ALLOWED_AI_KEYS.includes(key)) { stripped.push(key); continue; }
    clean[key] = typeof value === "string" ? stripCodeAssertions(value) : value;
  }
  return { clean, stripped };
}

/**
 * Recursively neutralise code assertions in any model-controlled value.
 *
 * `sanitizeAiItemPayload` drops code-bearing FIELDS. This handles the other
 * half: free text nested inside allowed fields — `questions_to_ask`,
 * `documentation_tips` and the like — where a model can still write
 * "M1830 = 6" in prose that is otherwise legitimate guidance.
 */
export function sanitizeAiText(value) {
  if (typeof value === "string") return stripCodeAssertions(value);
  if (Array.isArray(value)) return value.map(sanitizeAiText);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeAiText(v);
    return out;
  }
  return value;
}

/** Sanitise a whole array of AI item payloads. */
export function sanitizeAiItems(items) {
  const stripped = [];
  const clean = (Array.isArray(items) ? items : []).map((it) => {
    const r = sanitizeAiItemPayload(it);
    stripped.push(...r.stripped);
    return r.clean;
  });
  return { clean, stripped: [...new Set(stripped)] };
}

/**
 * Neutralise an assertion of a final code inside free text.
 *
 * Evidence and guidance are kept; a sentence that TELLS the clinician which code
 * to enter is not evidence, it is a selection. Conservative by design — it
 * rewrites the assertion rather than deleting the surrounding paragraph.
 */
export function stripCodeAssertions(text) {
  let s = String(text ?? "");
  // "code 3", "Code: 3", "answer 04", "select NA", "enter UK"
  s = s.replace(
    /\b(?:enter|select|choose|mark|code|answer|score)\s*(?:as|is|:|=)?\s*["']?(?:0[0-9]|1[0-5]|[0-9]|NA|UK)["']?\b/gi,
    "[code removed — select this response in your EMR]",
  );
  // "M1830 = 6", "M1830: 6"
  s = s.replace(
    /\bM\d{4}\s*(?:=|:|->|—)\s*["']?(?:0[0-9]|1[0-5]|[0-9]|NA|UK)["']?/gi,
    "[code removed — select this response in your EMR]",
  );
  return s;
}

/**
 * Whether a value looks like an OASIS code an AI path must not emit.
 * Used by contract tests and by the write validator's belt-and-braces check.
 */
export function looksLikeOasisCode(value) {
  if (typeof value === "number") return true;
  if (typeof value !== "string") return false;
  return /^(?:0[0-9]|1[0-5]|[0-9]|NA|UK)$/i.test(value.trim());
}

/** The one message a surface shows where a prefill used to be offered. */
export const NO_AI_PREFILL_NOTICE =
  "PennSync does not select OASIS responses. The analysis below shows supporting evidence and "
  + "open questions only — choose every official response yourself from the wording in your EMR.";
