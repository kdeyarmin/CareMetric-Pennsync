// Deterministic hallucination guard. Confirms that every clinically-significant
// value (measurement / vital / dose) and every medication appearing in the
// GENERATED note also appears in the nurse's INPUT (draft + answers + confirmed
// negatives). Anything in the output but not the input is flagged. Pure +
// offline, so it runs even with no connectivity.
import { extractNumbersAndMeasurements, extractMedications } from "./factExtraction.js";

/**
 * @param {string} outputText the generated note
 * @param {string} allowedInputText draft + answers + confirmed negatives, concatenated
 * @returns {{ ok: boolean, unverified: {type:string, value:string}[] }}
 */
export function valueGuard(outputText, allowedInputText) {
  const inNums = extractNumbersAndMeasurements(allowedInputText);
  const inMeds = extractMedications(allowedInputText).map((m) => m.toLowerCase());

  /** @type {{type:string, value:string}[]} */
  const unverified = [];

  for (const n of extractNumbersAndMeasurements(outputText)) {
    if (!inNums.includes(n)) unverified.push({ type: "number", value: n });
  }
  for (const m of extractMedications(outputText)) {
    if (!inMeds.includes(m.toLowerCase())) unverified.push({ type: "medication", value: m });
  }

  return { ok: unverified.length === 0, unverified };
}
