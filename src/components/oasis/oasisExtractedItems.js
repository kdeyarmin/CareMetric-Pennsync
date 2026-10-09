// The OASIS values the analyzer READ OUT OF the uploaded PDF, as review rows.
//
// These are not suggestions. Each value is what the agency's own OASIS document
// already says for an item, read by the extraction step; the review tab asks a
// clinician to confirm each one against the PDF, reject a misread, or correct it
// to what the document actually shows, and a supervisor then signs the batch
// off. Nothing here chooses a response.
//
// base44/_shared/backendHelpers.mjs inlines this function verbatim
// (`toString()`) into the broker that saves an upload, so the rows are built on
// the server from the analysis being saved and the review tab and the broker
// can never disagree about their shape.
//
// Pure. No React, no SDK, no imports.

export const OASIS_EXTRACTED_ITEM_MAP = Object.freeze([
  ['M1800', 'Grooming', 'functional_scores', 'm1800_grooming'],
  ['M1810', 'Current ability to dress upper body', 'functional_scores', 'm1810_dress_upper'],
  ['M1820', 'Current ability to dress lower body', 'functional_scores', 'm1820_dress_lower'],
  ['M1830', 'Bathing', 'functional_scores', 'm1830_bathing'],
  ['M1840', 'Toilet transferring', 'functional_scores', 'm1840_toilet_transfer'],
  ['M1850', 'Transferring', 'functional_scores', 'm1850_transferring'],
  ['M1860', 'Ambulation/locomotion', 'functional_scores', 'm1860_ambulation'],
  ['M1400', 'Dyspnea', 'clinical_items', 'dyspnea'],
  ['M1242', 'Frequency of pain', 'clinical_items', 'pain_frequency'],
]);

/**
 * @param {object} pdgmData   The analyzer's structured extraction.
 * @param {Array} itemMap     OASIS_EXTRACTED_ITEM_MAP.
 * @param {string} extractedAt ISO timestamp stamped on every row.
 * @returns {Record<string, {value: string, item_label: string, source: string, extracted_at: string}>}
 */
export function buildExtractedReviewItems(pdgmData, itemMap, extractedAt) {
  const rows = {};
  if (!pdgmData || typeof pdgmData !== 'object' || !Array.isArray(itemMap)) return rows;
  for (const entry of itemMap) {
    if (!Array.isArray(entry) || entry.length !== 4) continue;
    const [itemNumber, label, group, field] = entry;
    const bag = pdgmData[group];
    if (!bag || typeof bag !== 'object') continue;
    const raw = bag[field];
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    const value = String(raw).trim().slice(0, 40);
    if (!value) continue;
    rows[itemNumber] = {
      value,
      item_label: label,
      source: 'pdf_extraction',
      extracted_at: extractedAt,
    };
  }
  return rows;
}
