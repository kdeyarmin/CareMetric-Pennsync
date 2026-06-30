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
import { invokeLLM } from "@/lib/invokeLLM";
import { secureAICall } from "@/components/utils/security";
import { CritiqueResponse, safeParseLLM } from "./schemas";

// Completeness judging is a bounded classification task over the nurse's own
// draft, so it runs on the fast Sonnet tier (same as note generation).
const CRITIC_MODEL = "claude_sonnet_4_6";

function buildElementBlock(elements) {
  return elements
    .map((e) => {
      const need = e.hint ? ` | adequate answer covers: ${e.hint}` : "";
      return `- id: ${e.id} | ${e.label} (${e.severity})${need}`;
    })
    .join("\n");
}

/**
 * Judge, for each required element, whether the draft documents it adequately.
 * @param {{ draftText: string, elements: Array }} input
 * @returns {Promise<{ ok: boolean, elements: Array, error?: string }>}
 */
export async function critiqueCoverage({ draftText, elements }, { userKey, model = CRITIC_MODEL } = {}) {
  if (!draftText || !draftText.trim() || !Array.isArray(elements) || elements.length === 0) {
    return { ok: true, elements: [] };
  }

  const prompt = `You are a Medicare home-health/hospice documentation completeness auditor.

For EACH required element id listed below, decide using ONLY the nurse's draft:
- "documented": true if the draft genuinely addresses this element with real clinical
  content. A NEGATED mention ("no fall assessment done"), a stray keyword, or a generic
  phrase that doesn't actually document the element is NOT documented (false).
- "adequate": true if what is documented is specific enough to survive a Medicare audit;
  false if it is vague/conclusory (e.g. "patient is homebound" with no reason).
- "reason": a brief phrase on what's missing (only when documented or adequate is false).
- "suggestedQuestion": a short question that would elicit the missing detail.

RULES:
- Judge ONLY the element ids listed. Do NOT invent new ids or topics.
- Do NOT write any note text or clinical facts. Output judgments only.
- When unsure, mark documented:false so the nurse is prompted (safer to ask).

REQUIRED ELEMENTS:
${buildElementBlock(elements)}

NURSE DRAFT:
${draftText}

Return JSON: { "elements": [ { "id": "<one of the ids above>", "documented": true|false, "adequate": true|false, "reason": "...", "suggestedQuestion": "..." } ] }`;

  try {
    const raw = await secureAICall(
      () =>
        invokeLLM({
          prompt,
          model,
          response_json_schema: {
            type: "object",
            properties: {
              elements: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    documented: { type: "boolean" },
                    adequate: { type: "boolean" },
                    reason: { type: "string" },
                    suggestedQuestion: { type: "string" },
                  },
                  required: ["id", "documented"],
                },
              },
            },
            required: ["elements"],
          },
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
