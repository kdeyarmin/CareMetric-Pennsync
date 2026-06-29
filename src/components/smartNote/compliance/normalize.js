// Deterministic normalization of a nurse's rough draft before compliance
// scanning. Pure + offline. Fixes common dictation mishears (via the shared
// medical dictionary) and tidies whitespace/bullets without ever changing
// clinical meaning or adding content.
import { enhanceTranscription } from "../../utils/medicalDictionary.js";

/**
 * @param {string} text raw draft (typed, dictated, or bulleted)
 * @returns {string} normalized draft
 */
export function normalizeDraft(text) {
  if (!text || !text.trim()) return "";
  let out = enhanceTranscription(text); // correct medication/term mishears
  out = out
    .replace(/\r\n?/g, "\n") // normalize line endings
    .replace(/[ \t]+/g, " ") // collapse runs of spaces/tabs
    .replace(/ *\n */g, "\n") // trim around line breaks
    .replace(/\n{3,}/g, "\n\n") // cap blank-line runs
    .trim();
  return out;
}
