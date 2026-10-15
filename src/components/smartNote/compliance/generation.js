// The ONLY place the LLM touches the note. It acts as a constrained scribe:
// it may re-voice the nurse's own words + answers into a compliant narrative,
// but may not introduce any clinical fact. A second "grounding" pass classifies
// each output sentence as supported/unsupported by the source.
//
// Vite-only module (depends on the base44 client), so it is exercised by the
// vitest suite (generation.spec.js) rather than the node unit-test suite.
import { requestSmartNoteDraft, requestSmartNoteGrounding } from '@/components/smartNote/compliance/smartNoteOperations';
import { secureAICall } from "@/components/utils/security";
import { splitSentences } from "./factExtraction";
import { GenerationResponse, GroundingResponse, safeParseLLM } from "./schemas";

// Prompts, models and response contracts live in protected, task-specific
// server operations. The browser sends clinical source material only.

/**
 * Generate the final note from ONLY the nurse's own material.
 * @returns {Promise<{ note: string }>}
 * @throws if the LLM response fails schema validation
 */
export async function generateConstrainedNote(inputs, { userKey, serviceLine = "home_health", visitType = "routine_visit" } = {}) {
  const raw = await secureAICall(
    () => requestSmartNoteDraft({
      draftSentences: inputs.draftSentences || [],
      answers: inputs.answers || [],
      confirmedNegatives: inputs.confirmedNegatives || [],
      serviceLine,
      visitType,
    }),
    userKey
  );

  const parsed = safeParseLLM(GenerationResponse, raw);
  if (!parsed.ok) throw new Error(`Note generation failed: ${parsed.error}`);
  return parsed.data;
}

// A verdict's echo of its sentence may differ in case, spacing, a leading list
// number (the prompt numbers the lines) or end punctuation, and nothing else.
function sentenceKey(text) {
  return String(text ?? "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/[\s.!?;:,]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// One verdict per submitted sentence, matched by text (repeats count once
// each), in any order. Equal counts alone are not enough: three verdicts that
// all repeat the first sentence would leave the other two unchecked.
function everySentenceHasItsVerdict(submitted, verdicts) {
  if (verdicts.length !== submitted.length) return false;
  const pending = new Map();
  for (const sentence of submitted) {
    const key = sentenceKey(sentence);
    pending.set(key, (pending.get(key) || 0) + 1);
  }
  return verdicts.every((verdict) => {
    const key = sentenceKey(verdict.text);
    const left = pending.get(key) || 0;
    pending.set(key, left - 1);
    return left > 0;
  });
}

/**
 * Grounding pass: classify each output sentence as supported/unsupported by the
 * source. Reorganization, tense, and grammar do NOT make a sentence unsupported.
 * @returns {Promise<{ ok: boolean, unsupported: Array, sentences: Array, error?: string }>}
 */
export async function groundNote(outputText, sourceText, { userKey } = {}) {
  try {
    const submitted = splitSentences(outputText);
    const raw = await secureAICall(
      () => requestSmartNoteGrounding({ sentences: submitted, sourceText }),
      userKey
    );

    const parsed = safeParseLLM(GroundingResponse, raw);
    if (!parsed.ok) return { ok: false, unsupported: [], sentences: [], error: parsed.error };
    // Every submitted sentence needs its own verdict. A verdict list that is
    // empty, or drops, merges, repeats or rewrites sentences, would otherwise
    // read as "nothing unsupported" and verify an AI-written note whose
    // unchecked sentences could carry an invented finding.
    if (!everySentenceHasItsVerdict(submitted, parsed.data.sentences)) {
      return {
        ok: false,
        unsupported: [],
        sentences: parsed.data.sentences,
        error: "Verification did not return a result for every sentence. Re-check to verify this note.",
      };
    }
    const unsupported = parsed.data.sentences.filter((s) => s.status === "unsupported");
    return { ok: unsupported.length === 0, unsupported, sentences: parsed.data.sentences };
  } catch (err) {
    return { ok: false, unsupported: [], sentences: [], error: err?.message || "Grounding check failed" };
  }
}