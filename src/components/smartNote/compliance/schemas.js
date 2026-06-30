// Local runtime validation of LLM JSON responses (first real use of the
// already-installed `zod` dependency). Generation/grounding responses are
// validated before use so a malformed response fails loudly instead of
// silently degrading the note.
import { z } from "zod";

export const GenerationResponse = z.object({
  note: z.string().min(1),
});

export const GroundingResponse = z.object({
  sentences: z.array(
    z.object({
      text: z.string(),
      status: z.enum(["supported", "unsupported"]),
      source: z.enum(["draft", "answer", "negative", "none"]).optional(),
    })
  ),
});

// Completeness-critic response. The critic ONLY judges whether each required
// element id is documented/adequate in the draft and may suggest a question — it
// never authors note prose, so this schema deliberately has no free-text "note".
export const CritiqueResponse = z.object({
  elements: z.array(
    z.object({
      id: z.string(),
      documented: z.boolean(),
      adequate: z.boolean().optional(),
      reason: z.string().optional(),
      suggestedQuestion: z.string().optional(),
    })
  ),
});

/**
 * Validate an LLM response (string or object) against a zod schema.
 * @returns {{ ok: true, data: any } | { ok: false, error: string }}
 */
export function safeParseLLM(schema, raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Response was not valid JSON" };
    }
  }
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") };
}
