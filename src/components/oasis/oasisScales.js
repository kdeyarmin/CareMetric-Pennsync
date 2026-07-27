/**
 * oasisScales — per-item OASIS-E functional (M1800–M1870) response scales.
 *
 * The OASIS-E ADL/IADL items do NOT share one scale: M1810 and M1845 have 4
 * responses (0–3), M1840 has 5 (0–4), M1850 has 6 (0–5), and M1830/M1860 have 7
 * (0–6). A single flat 0–6 option list both under-counts the 0–6 items (the old
 * 0–3 truncation) AND over-counts the 0–3/0–5 items (offering responses that don't
 * exist for that item). This module gives each item exactly its valid range.
 *
 * Labels are ITEM-SPECIFIC and mirror the main OASIS form (oasisQuestions.jsx),
 * because the recorded value's MEANING is defined by that form and by the
 * outcome-measure engine. A generic graduated-assistance scale mislabeled the
 * higher codes — e.g. M1830 code 6 means "Unable to rate — artificial opening"
 * on the form, but the generic scale offered it as "Unable to perform", so a
 * quick-entry nurse would record a totally-dependent bather under a code the
 * rest of the app reads as not-ratable.
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

/**
 * Per-item response labels, index = response code. Wording mirrors the main
 * OASIS form so quick-entry and the form record the same meaning per code.
 */
export const ITEM_LABELS = {
  m1800: [
    '0 – Able to groom self unaided',
    '1 – Grooming utensils must be placed within reach',
    '2 – Someone must assist the patient',
    '3 – Patient depends entirely upon someone else',
  ],
  m1810: [
    '0 – No assistance needed',
    '1 – With minor difficulty or helper makes adaptations',
    '2 – Someone must assist',
    '3 – Totally dependent',
  ],
  m1820: [
    '0 – No assistance needed',
    '1 – With minor difficulty or helper makes adaptations',
    '2 – Someone must assist',
    '3 – Totally dependent',
  ],
  m1830: [
    '0 – Able to bathe self in shower/tub independently',
    '1 – With minimal person assistance to bathe',
    '2 – With partial person assistance; patient performs part',
    '3 – With extensive person assistance; minimal patient effort',
    '4 – Unable to bathe self; total person assistance',
    '5 – Unable to bathe self and refused',
    '6 – Unable to rate — patient has artificial opening',
  ],
  m1840: [
    '0 – Able to independently transfer',
    '1 – Able to transfer with minimal assistance',
    '2 – Able to bear weight and pivot with assistance',
    '3 – Unable to bear weight; totally dependent',
    '4 – Bedfast, unable to use toilet/commode',
  ],
  m1845: [
    '0 – Able to manage all toileting independently',
    '1 – Can manage with use of devices/difficulty',
    '2 – Someone must help with clothing or use devices',
    '3 – Patient depends entirely on another person',
  ],
  m1850: [
    '0 – Able to independently transfer',
    '1 – Transfers with minimal human assistance',
    '2 – Unable to transfer self but able to bear weight and pivot',
    '3 – Unable to transfer and unable to bear weight',
    '4 – Bedfast, unable to transfer but able to turn and position self in bed',
    '5 – Bedfast, unable to transfer and unable to turn and position self',
  ],
  m1860: [
    '0 – Able to independently walk on all surfaces',
    '1 – With minor difficulty on uneven surfaces',
    '2 – Requires use of one-handed device',
    '3 – Requires use of two-handed device or walker',
    '4 – Requires human supervision to ambulate',
    '5 – Chairfast, able to wheel self independently',
    '6 – Bedfast, unable to ambulate or be up in a chair',
  ],
};

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

/** Options for a given M-item key (e.g. 'm1860'), using its form-accurate labels. */
export function optionsForItem(itemKey) {
  const key = String(itemKey).toLowerCase();
  const labels = ITEM_LABELS[key];
  if (labels) return labels.map((label, i) => ({ value: String(i), label }));
  return scaleOptions(OASIS_ITEM_MAX[key]);
}

/**
 * M1242 Frequency of Pain is a distinct OASIS-E 0–4 scale with its own labels.
 * Code 1 ("pain that does not interfere with activity or movement") is a real
 * CMS level; omitting it (the prior 0–3 list did) shifted every subsequent
 * response one code below its true value.
 */
export const PAIN_FREQUENCY_OPTIONS = [
  { value: '0', label: '0 – Patient has no pain' },
  { value: '1', label: '1 – Pain does not interfere with activity or movement' },
  { value: '2', label: '2 – Less often than daily' },
  { value: '3', label: '3 – Daily, but not constantly' },
  { value: '4', label: '4 – All of the time' },
];
