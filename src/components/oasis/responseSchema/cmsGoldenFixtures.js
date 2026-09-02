// CMS-derived GOLDEN FIXTURES — an independent transcription.
//
// WHY THIS FILE IS SEPARATE FROM THE REGISTRY
// A test that reads the registry and asserts the registry matches proves
// nothing. These fixtures were transcribed from the final OASIS-E2 All-Item
// instrument effective 2026-04-01 (see `sources.js` for URL, dates and
// SHA-256), by hand, WITHOUT reading `v2CmsE2.js`. The conformance test
// compares the two, so a typo in either side fails.
//
// Applicability was derived from the final Time Point instruments by checking
// each item's presence as a real item definition — not a skip-instruction
// cross-reference — in SOC, ROC, FU, TRN, DC and DAH.
//
// If CMS republishes the instrument, this file is re-transcribed from the new
// artifact FIRST, and the registry is then reconciled to it — never the reverse.

/** Item number → the exact CMS response codes, in published order. */
export const CMS_GOLDEN_CODES = Object.freeze({
  // 3x5 living-arrangement / availability-of-assistance grid.
  M1100: Object.freeze(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15"]),
  M1306: Object.freeze(["0", "1"]),
  M1340: Object.freeze(["0", "1", "2"]),
  M1400: Object.freeze(["0", "1", "2", "3", "4"]),
  M1620: Object.freeze(["0", "1", "2", "3", "4", "5", "NA", "UK"]),
  // Check-all-that-apply. 7 is "None of the above".
  M1740: Object.freeze(["1", "2", "3", "4", "5", "6", "7"]),
  M1830: Object.freeze(["0", "1", "2", "3", "4", "5", "6"]),
  M1840: Object.freeze(["0", "1", "2", "3", "4"]),
  M1860: Object.freeze(["0", "1", "2", "3", "4", "5", "6"]),
  M1870: Object.freeze(["0", "1", "2", "3", "4", "5"]),
  M2001: Object.freeze(["0", "1", "9"]),
  M2010: Object.freeze(["0", "1", "NA"]),
  M2020: Object.freeze(["0", "1", "2", "3", "NA"]),
  // Grid: one code per row.
  M2401: Object.freeze(["0", "1", "NA"]),
  M2420: Object.freeze(["1", "2", "3", "4", "UK"]),
});

/** Item number → the CMS time points that collect it. */
export const CMS_GOLDEN_TIMEPOINTS = Object.freeze({
  M1100: Object.freeze(["SOC", "ROC"]),
  M1306: Object.freeze(["SOC", "ROC", "FU", "DC"]),
  M1340: Object.freeze(["SOC", "ROC", "DC"]),
  M1400: Object.freeze(["SOC", "ROC", "DC"]),
  M1620: Object.freeze(["SOC", "ROC", "DC"]),
  M1740: Object.freeze(["SOC", "ROC", "DC"]),
  M1830: Object.freeze(["SOC", "ROC", "FU", "DC"]),
  M1840: Object.freeze(["SOC", "ROC", "FU", "DC"]),
  M1860: Object.freeze(["SOC", "ROC", "FU", "DC"]),
  M1870: Object.freeze(["SOC", "ROC", "DC"]),
  M2001: Object.freeze(["SOC", "ROC"]),
  M2010: Object.freeze(["SOC", "ROC"]),
  M2020: Object.freeze(["SOC", "ROC", "DC"]),
  M2401: Object.freeze(["TRN", "DC"]),
  // Agency discharge ONLY. An inpatient-facility transfer is M2410.
  M2420: Object.freeze(["DC"]),
});

/** Item number → the shape CMS publishes it in. */
export const CMS_GOLDEN_SHAPES = Object.freeze({
  M1100: "matrix_choice",
  M1740: "multi_select",
  M2401: "grid",
  M1306: "single", M1340: "single", M1400: "single", M1620: "single",
  M1830: "single", M1840: "single", M1860: "single", M1870: "single",
  M2001: "single", M2010: "single", M2020: "single", M2420: "single",
});

/** M2401's published rows. */
export const CMS_GOLDEN_M2401_ROWS = Object.freeze(["b", "c", "d", "e", "f"]);

/** Codes CMS omits at a given time point. */
export const CMS_GOLDEN_CODE_OMISSIONS = Object.freeze({
  // "Omit 'UK' option on DC".
  M1620: Object.freeze({ DC: Object.freeze(["UK"]) }),
});

/** M1740's mutually exclusive response. */
export const CMS_GOLDEN_EXCLUSIVE_CODES = Object.freeze({ M1740: Object.freeze(["7"]) });

/**
 * Meanings that MUST hold, quoted from the instrument. These are the specific
 * facts the legacy set got wrong, so a regression here is the regression.
 */
export const CMS_GOLDEN_MEANINGS = Object.freeze([
  Object.freeze({ item: "M1830", code: "6", contains: "bathed totally by another person" }),
  Object.freeze({ item: "M1340", code: "2", contains: "known but not observable" }),
  Object.freeze({ item: "M1400", code: "4", contains: "At rest" }),
  Object.freeze({ item: "M1840", code: "2", contains: "bedside commode" }),
  Object.freeze({ item: "M1840", code: "3", contains: "bedpan/urinal" }),
  Object.freeze({ item: "M1860", code: "1", contains: "one-handed device" }),
  Object.freeze({ item: "M1870", code: "3", contains: "nasogastric tube or gastrostomy" }),
  Object.freeze({ item: "M2001", code: "9", contains: "not taking any medications" }),
  Object.freeze({ item: "M2010", code: "0", contains: "No" }),
  Object.freeze({ item: "M2020", code: "1", contains: "prepared in advance" }),
  Object.freeze({ item: "M2020", code: "2", contains: "reminders" }),
  Object.freeze({ item: "M1740", code: "7", contains: "None of the above" }),
  Object.freeze({ item: "M2420", code: "2", contains: "remained in the community" }),
  Object.freeze({ item: "M2420", code: "3", contains: "non-institutional hospice" }),
  Object.freeze({ item: "M1306", code: "0", contains: "No" }),
  Object.freeze({ item: "M1100", code: "05", contains: "lives alone" }),
  Object.freeze({ item: "M1100", code: "10", contains: "No Assistance Available" }),
]);

/**
 * Destinations M2420 must NEVER name. The legacy set used codes 2/3/4 for
 * hospital, rehab and nursing home; under OASIS-E2 those are community and
 * hospice destinations, and a facility transfer is M2410.
 */
export const M2420_FORBIDDEN_DESTINATIONS = Object.freeze([
  "hospital", "rehab", "rehabilitation", "nursing home", "snf", "skilled nursing", "inpatient",
]);

/** The 18 items frozen by this cutover. */
export const EIGHTEEN_CONFLICT_ITEMS = Object.freeze([
  "M1033", "M1100", "M1306", "M1340", "M1400", "M1610", "M1620", "M1630", "M1740",
  "M1830", "M1840", "M1860", "M1870", "M2001", "M2010", "M2020", "M2401", "M2420",
]);

/** The three demoted to PennSync screening prompts. */
export const DEMOTED_TO_SCREENING = Object.freeze(["M1033", "M1610", "M1630"]);

/** The fifteen aligned to CMS. */
export const ALIGNED_TO_CMS = Object.freeze([
  "M1100", "M1306", "M1340", "M1400", "M1620", "M1740", "M1830", "M1840",
  "M1860", "M1870", "M2001", "M2010", "M2020", "M2401", "M2420",
]);
