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
// Vite-only module (depends on the base44 client via invokeLLM), so its request
// and cache behaviour is tested under Vitest with the client mocked
// (completenessCritic.spec.js), while the pure reconcile logic it feeds is
// unit-tested in criticReconcile.test.js.
import { requestSmartNoteCoverage } from '@/components/smartNote/compliance/smartNoteOperations';
import { secureAICall } from "@/components/utils/security";
import { CritiqueResponse, safeParseLLM } from "./schemas";

// The server owns the auditor prompt, model and bounded response contract.

// Each check is a billed named-model call, and its answer depends only on what
// it is asked: the draft and the required elements. The reviewer asks on every
// mount, so going Back and Next again, or the patient re-check that remounts it
// when the nurse returns to the tab, paid for the same answer again. A
// successful answer is kept for the life of the page, and an identical question
// already in flight shares its request. Memory only, never browser storage: the
// key is the patient's draft. A failure is not kept, so it can be retried.
const CACHE_LIMIT = 20;
const cache = new Map();

/** Test seam: forget every kept answer. */
export function clearCoverageCache() {
  cache.clear();
}

async function requestCritique(payload, userKey) {
  try {
    const raw = await secureAICall(() => requestSmartNoteCoverage(payload), userKey);
    const parsed = safeParseLLM(CritiqueResponse, raw);
    if (!parsed.ok) return { ok: false, elements: [], error: parsed.error };
    return { ok: true, elements: parsed.data.elements };
  } catch (err) {
    return { ok: false, elements: [], error: err?.message || "Completeness check failed" };
  }
}

/**
 * Judge, for each required element, whether the draft documents it adequately.
 * @param {{ draftText: string, elements: Array }} input
 * @returns {Promise<{ ok: boolean, elements: Array, error?: string }>}
 */
export async function critiqueCoverage({ draftText, elements }, { userKey } = {}) {
  if (!draftText || !draftText.trim() || !Array.isArray(elements) || elements.length === 0) {
    return { ok: true, elements: [] };
  }

  const payload = {
    draftText,
    elements: elements.map(e => ({ id: e.id, label: e.label, severity: e.severity, ...(e.hint ? { hint: e.hint } : {}) })),
  };
  const key = JSON.stringify([userKey || "", payload]);
  const kept = cache.get(key);
  if (kept) {
    // Most recently used goes last, so the oldest is the one evicted.
    cache.delete(key);
    cache.set(key, kept);
    return kept;
  }
  const pending = requestCritique(payload, userKey).then((result) => {
    if (!result.ok && cache.get(key) === pending) cache.delete(key);
    return result;
  });
  cache.set(key, pending);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return pending;
}