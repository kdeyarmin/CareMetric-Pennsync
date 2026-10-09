// LLM "completeness critic" — the smarter, second-opinion gap detector that
// backstops the deterministic keyword scan (presenceDetection.js). The keyword
// scan is fast and offline but over-counts: a NEGATED or merely-mentioned keyword
// ("no fall assessment done") falsely marks an element documented, so the nurse is
// never asked the question. This pass re-reads the draft and judges, per required
// element, whether it is ACTUALLY documented and specific enough.
//
// Hard constraints (mirrors generation.js's grounding pass):
//   - It outputs ONLY judgments over the fixed list of element ids we pass in —
//     never note prose, never a new clinical fact. The pure reconcile step
//     (criticReconcile.js) additionally drops any id we didn't ask about.
//   - It is ADVISORY: it can only add a question or a "be more specific" nudge.
//     The deterministic scan stays the floor and critical gating is unchanged.
//   - Online-only and best-effort: any error returns { ok: false } and the caller
//     silently keeps the deterministic result (it must work offline).
//
// Vite-only module (depends on the base44 client via invokeLLM), so — like
// generation.js — it is exercised by the build + manual testing, while the pure
// reconcile logic it feeds is unit-tested in criticReconcile.test.js.
import { requestSmartNoteCoverage } from '@/components/smartNote/compliance/smartNoteOperations';
import { secureAICall } from "@/components/utils/security";
import { CritiqueResponse, safeParseLLM } from "./schemas";

// The server owns the auditor prompt, model and bounded response contract.

/**
 * Judge, for each required element, whether the draft documents it adequately.
 * @param {{ draftText: string, elements: Array }} input
 * @returns {Promise<{ ok: boolean, elements: Array, error?: string }>}
 */
export async function critiqueCoverage({ draftText, elements }, { userKey } = {}) {
  if (!draftText || !draftText.trim() || !Array.isArray(elements) || elements.length === 0) {
    return { ok: true, elements: [] };
  }

  try {
    const raw = await secureAICall(
      () => requestSmartNoteCoverage({
        draftText,
        elements: elements.map(e => ({ id: e.id, label: e.label, severity: e.severity, ...(e.hint ? { hint: e.hint } : {}) })),
      }),
      userKey
    );

    const parsed = safeParseLLM(CritiqueResponse, raw);
    if (!parsed.ok) return { ok: false, elements: [], error: parsed.error };
    return { ok: true, elements: parsed.data.elements };
  } catch (err) {
    return { ok: false, elements: [], error: err?.message || "Completeness check failed" };
  }
}