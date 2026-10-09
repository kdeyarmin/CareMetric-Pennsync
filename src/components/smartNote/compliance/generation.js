// The ONLY place the LLM touches the note. It acts as a constrained scribe:
// it may re-voice the nurse's own words + answers into a compliant narrative,
// but may not introduce any clinical fact. A second "grounding" pass classifies
// each output sentence as supported/unsupported by the source.
//
// Vite-only module (depends on the base44 client), so it is exercised by the
// build + manual testing rather than the node unit-test suite.
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

/**
 * Grounding pass: classify each output sentence as supported/unsupported by the
 * source. Reorganization, tense, and grammar do NOT make a sentence unsupported.
 * @returns {Promise<{ ok: boolean, unsupported: Array, sentences: Array, error?: string }>}
 */
export async function groundNote(outputText, sourceText, { userKey } = {}) {
  try {
    const raw = await secureAICall(
      () => requestSmartNoteGrounding({ sentences: splitSentences(outputText), sourceText }),
      userKey
    );

    const parsed = safeParseLLM(GroundingResponse, raw);
    if (!parsed.ok) return { ok: false, unsupported: [], sentences: [], error: parsed.error };
    const unsupported = parsed.data.sentences.filter((s) => s.status === "unsupported");
    return { ok: unsupported.length === 0, unsupported, sentences: parsed.data.sentences };
  } catch (err) {
    return { ok: false, unsupported: [], sentences: [], error: err?.message || "Grounding check failed" };
  }
}