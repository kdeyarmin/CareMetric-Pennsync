// Deterministic provenance annotation for the verified note ("show me the
// proof"). For each sentence it lists the clinically-significant values and
// medications it contains and marks whether each traces back to the nurse's
// allowed input (draft + answers + confirmed negatives + opted-in trend
// summary). It uses the SAME extraction the value-guard uses, so the highlight
// the nurse sees matches exactly what gates verification — it never invents a
// source. Pure + offline, so it is unit-testable under `node --test`.
//
// IMPORTANT: loaded by the node test runner, so it may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { splitSentences, extractNumbersAndMeasurements, extractMedications } from "./factExtraction.js";

/**
 * @param {string} noteText the generated / edited note
 * @param {string} allowedInputText draft + answers + confirmed negatives, concatenated
 * @returns {{ text: string, status: "supported"|"unsupported"|"narrative",
 *            tokens: { type: "value"|"medication", value: string, supported: boolean }[] }[]}
 *   one entry per sentence. `narrative` = no hard values/meds to verify;
 *   `supported` = every value/med traces to input; `unsupported` = at least one
 *   value/med isn't found in the input.
 */
export function annotateProvenance(noteText, allowedInputText) {
  if (!noteText) return [];
  const inNums = extractNumbersAndMeasurements(allowedInputText || "");
  const inMeds = extractMedications(allowedInputText || "").map((m) => m.toLowerCase());
  return splitSentences(noteText).map((text) => {
    const tokens = [
      ...extractNumbersAndMeasurements(text).map((value) => ({ type: "value", value, supported: inNums.includes(value) })),
      ...extractMedications(text).map((value) => ({ type: "medication", value, supported: inMeds.includes(value.toLowerCase()) })),
    ];
    const status = tokens.length === 0 ? "narrative" : tokens.every((t) => t.supported) ? "supported" : "unsupported";
    return { text, status, tokens };
  });
}
