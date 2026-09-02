// thresholds — the tunable numbers behind PennSync's documentation judgements,
// in one place, with their provenance stated.
//
// WHY THESE ARE NOT CONSTANTS BURIED IN THE ENGINES
// "Three of seven supporting factors means the homebound statement is strong"
// and "0.72 Jaccard similarity means high" are DEFAULTS, not regulatory
// standards. They were chosen so that a legitimately-updated note on a stable
// patient does not trip them (see the negative cases in noteSimilarity.test.js
// and documentationStrength.test.js) — but they have never been checked against
// this agency's real denials or real notes.
//
// Leaving them as literals in the engines made that indistinguishable from a
// settled rule. Here each carries:
//
//   value        — what the engine uses
//   calibrated   — false until someone tunes it on real agency data
//   basis        — where the number actually came from
//   rationale    — why moving it in each direction hurts
//
// `describeCalibration()` lets a screen say "this band is an uncalibrated
// default" instead of presenting it as an authority. `calibrationHarness.js`
// turns the agency's own corpus into the evidence needed to set them.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).

/**
 * @typedef {{
 *   value: number, calibrated: boolean, basis: string, rationale: string,
 *   min?: number, max?: number,
 * }} Threshold
 */

/** @type {Readonly<Record<string, Threshold>>} */
export const DEFAULT_THRESHOLDS = Object.freeze({
  // ── Documentation strength ───────────────────────────────────────────────
  homebound_strong_factors: {
    value: 3,
    calibrated: false,
    basis: "PennSync default. Not derived from agency denial data.",
    rationale:
      "A medical reason plus two concrete supports (device / human assistance / exertional "
      + "symptom / taxing effort) is roughly what a reviewer needs to see BOTH confinement and "
      + "taxing effort. Lower it and a bare assertion with one detail reads as strong; raise it "
      + "and well-documented notes are flagged, which trains nurses to ignore the flag.",
    min: 1,
    max: 7,
  },
  homebound_partial_factors: {
    value: 1,
    calibrated: false,
    basis: "PennSync default.",
    rationale: "Any single supporting fact lifts a note above a bare assertion.",
    min: 1,
    max: 7,
  },
  skilled_need_strong_factors: {
    value: 3,
    calibrated: false,
    basis: "PennSync default. Not derived from agency denial data.",
    rationale:
      "Assessment performed, judgment applied, and one of intervention / monitoring / teaching. "
      + "Fewer reads as a visit summary rather than a skilled service.",
    min: 1,
    max: 5,
  },
  skilled_need_partial_factors: {
    value: 1,
    calibrated: false,
    basis: "PennSync default.",
    rationale: "One described skilled element is more than a bare 'skilled visit completed'.",
    min: 1,
    max: 5,
  },
  teaching_strong_factors: {
    value: 4,
    calibrated: false,
    basis: "PennSync default.",
    rationale:
      "Topic, learner, method and confirmed understanding are the four a reviewer looks for; "
      + "the remaining-need factor is a bonus rather than a requirement.",
    min: 1,
    max: 6,
  },
  teaching_partial_factors: {
    value: 2,
    calibrated: false,
    basis: "PennSync default.",
    rationale: "Naming a topic and a learner is the floor for education that reads as real.",
    min: 1,
    max: 6,
  },

  // ── Copy-forward similarity ──────────────────────────────────────────────
  similarity_moderate: {
    value: 0.55,
    calibrated: false,
    basis:
      "PennSync default, chosen so the 'legitimately similar but genuinely updated note' case in "
      + "noteSimilarity.test.js stays below the advisory bands.",
    rationale:
      "Home-health notes on a stable patient share vocabulary by nature. Set too low and every "
      + "note is flagged; too high and a copy-forward passes unremarked.",
    min: 0,
    max: 1,
  },
  similarity_high: {
    value: 0.72,
    calibrated: false,
    basis: "PennSync default. Not calibrated against this agency's notes.",
    rationale:
      "The band at which a note starts to read as carried forward rather than re-written. This "
      + "is the number most worth tuning on a real corpus.",
    min: 0,
    max: 1,
  },
  similarity_very_high: {
    value: 0.88,
    calibrated: false,
    basis: "PennSync default. Not calibrated against this agency's notes.",
    rationale: "Near-verbatim. Above this, most of the sentences are literally the same.",
    min: 0,
    max: 1,
  },
  similarity_min_repeated_words: {
    value: 8,
    calibrated: false,
    basis: "PennSync default.",
    rationale:
      "Short shared lines ('Vitals stable.') are normal documentation, not copy-forward. Lower "
      + "it and the repeated-sentence list fills with noise.",
    min: 3,
    max: 30,
  },
  similarity_identical_vitals_min_readings: {
    value: 3,
    calibrated: false,
    basis: "PennSync default.",
    rationale:
      "One or two matching readings are unremarkable — a stable patient really can be 98.6 twice. "
      + "A whole matching SET is the pattern worth confirming.",
    min: 2,
    max: 6,
  },
});

let overrides = {};

/**
 * Apply agency-specific values (e.g. from AgencySettings).
 *
 * Unknown keys and out-of-range values are REJECTED rather than applied, and the
 * rejections are returned: a silently-ignored override would leave an admin
 * believing they had tuned a threshold that never moved. An accepted override
 * marks the threshold `calibrated: true` only when the caller says the value
 * came from real data — setting a number by hand is not calibration.
 *
 * @param {Record<string, number|{ value: number, calibrated?: boolean, basis?: string }>} values
 * @returns {{ applied: string[], rejected: Array<{ key: string, reason: string }> }}
 */
export function setThresholdOverrides(values) {
  const applied = [];
  const rejected = [];
  const next = {};
  for (const [key, raw] of Object.entries(values || {})) {
    const base = DEFAULT_THRESHOLDS[key];
    if (!base) {
      rejected.push({ key, reason: "Unknown threshold." });
      continue;
    }
    const entry = typeof raw === "object" && raw !== null ? raw : { value: raw };
    const value = Number(entry.value);
    if (!Number.isFinite(value)) {
      rejected.push({ key, reason: "Value is not a number." });
      continue;
    }
    if (base.min != null && value < base.min) {
      rejected.push({ key, reason: `Below the minimum of ${base.min}.` });
      continue;
    }
    if (base.max != null && value > base.max) {
      rejected.push({ key, reason: `Above the maximum of ${base.max}.` });
      continue;
    }
    next[key] = {
      ...base,
      value,
      calibrated: !!entry.calibrated,
      basis: entry.basis || "Agency override.",
    };
    applied.push(key);
  }
  overrides = next;
  return { applied, rejected };
}

/** Drop every override and return to the shipped defaults. */
export function clearThresholdOverrides() {
  overrides = {};
}

/** The full threshold record (default, or the agency's override). */
export function getThreshold(key) {
  return overrides[key] || DEFAULT_THRESHOLDS[key] || null;
}

/** Just the number — what the engines call. */
export function thresholdValue(key) {
  const t = getThreshold(key);
  return t ? t.value : null;
}

/**
 * Calibration state for a status surface.
 *
 * `statement` is the sentence a screen shows so a band is never presented as an
 * authority when it is an untuned default.
 */
export function describeCalibration() {
  const keys = Object.keys(DEFAULT_THRESHOLDS);
  const uncalibrated = keys.filter((k) => !getThreshold(k).calibrated);
  return {
    total: keys.length,
    calibrated: keys.length - uncalibrated.length,
    uncalibrated: uncalibrated.length,
    complete: uncalibrated.length === 0,
    keys: uncalibrated,
    statement: uncalibrated.length === 0
      ? "Every documentation threshold has been calibrated on agency data."
      : `${uncalibrated.length} of ${keys.length} documentation thresholds are uncalibrated `
        + "PennSync defaults, not standards. Review them against your own denials and notes.",
  };
}
