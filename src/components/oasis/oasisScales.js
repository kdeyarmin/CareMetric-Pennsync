/**
 * oasisScales — per-item OASIS-E functional (M1800–M1870) response scales.
 *
 * The OASIS-E ADL/IADL items do NOT share one scale: M1810 and M1845 have 4
 * responses (0–3), M1840 has 5 (0–4), M1850 has 6 (0–5), and M1830/M1860 have 7
 * (0–6). A single flat 0–6 option list both under-counts the 0–6 items (the old
 * 0–3 truncation) AND over-counts the 0–3/0–5 items (offering responses that don't
 * exist for that item). This module gives each item exactly its valid range.
 *
 * Labels are a concise, accurate graduated-assistance scale (not the verbatim CMS
 * response text, which is item-specific and lengthy) — enough for the quick-entry
 * draft tool to record the correct LEVEL without offering invalid codes.
 */

export const ASSIST_LABELS = [
  '0 – Independent',
  '1 – With assistive device',
  '2 – Minimal assistance from person',
  '3 – Moderate assistance from person',
  '4 – Substantial/maximal assistance',
  '5 – Dependent, does not participate',
  '6 – Unable to perform',
];

/** Highest valid response value for each OASIS-E functional item. */
export const OASIS_ITEM_MAX = {
  m1800: 3, // Grooming
  m1810: 3, // Dressing upper body
  m1820: 3, // Dressing lower body
  m1830: 6, // Bathing
  m1840: 4, // Toilet transferring
  m1845: 3, // Toileting hygiene
  m1850: 5, // Transferring
  m1860: 6, // Ambulation / locomotion
};

/** Build the {value,label}[] option list for an item, capped at its valid max. */
export function scaleOptions(maxValue) {
  const max = Number.isInteger(maxValue) ? Math.max(0, Math.min(6, maxValue)) : 6;
  return ASSIST_LABELS.slice(0, max + 1).map((label, i) => ({ value: String(i), label }));
}

/** Convenience: options for a given M-item key (e.g. 'm1860'). */
export function optionsForItem(itemKey) {
  return scaleOptions(OASIS_ITEM_MAX[String(itemKey).toLowerCase()]);
}

/** M1242 Pain frequency is a distinct 0–3 scale with its own labels. */
export const PAIN_FREQUENCY_OPTIONS = [
  { value: '0', label: '0 – No pain' },
  { value: '1', label: '1 – Less than daily' },
  { value: '2', label: '2 – Daily, not constantly' },
  { value: '3', label: '3 – All the time' },
];
