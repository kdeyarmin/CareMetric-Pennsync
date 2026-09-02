// calibrationHarness — turn an agency's own notes and denial outcomes into the
// evidence needed to set PennSync's documentation thresholds.
//
// WHY THIS EXISTS
// thresholds.js ships defaults and says plainly that they are defaults. Saying
// so is necessary but not sufficient: an agency told "this number is uncalibrated"
// still has no way to calibrate it. This module closes that loop.
//
// WHAT IT DOES AND DOES NOT CLAIM
//  - It reports how a corpus DISTRIBUTES at each candidate threshold, and — when
//    outcomes are supplied — how the flag lines up with what actually happened.
//  - It does NOT pick a threshold. Choosing a flag rate is a clinical and
//    operational judgement about how much nurse attention a false flag costs,
//    and PennSync is not entitled to make it. The output is evidence for a human.
//  - `recommend()` names the candidate that best separates the labelled outcomes
//    and states its confidence honestly, including refusing to recommend when
//    the corpus is too small or too one-sided to support one.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).
import { analyzeHomebound, analyzeSkilledNeed, analyzeTeaching } from "./documentationStrength.js";
import { DEFAULT_THRESHOLDS } from "./thresholds.js";

/** Below this many labelled notes, any recommendation is noise. */
const MIN_LABELLED_SAMPLE = 30;
/** A corpus where almost everything shares one outcome cannot separate anything. */
const MIN_MINORITY_SHARE = 0.1;

/**
 * How many supporting factors each note in the corpus actually carries, for one
 * element. This is the raw material a threshold is chosen against.
 *
 * @param {Array<{ text: string, outcome?: "denied"|"paid"|"unknown" }>} corpus
 * @param {"homebound"|"skilled_need"|"teaching"} element
 * @returns {Array<{ factors: number, outcome: string, present: boolean }>}
 */
export function scoreCorpus(corpus, element) {
  const analyze = {
    homebound: analyzeHomebound,
    skilled_need: analyzeSkilledNeed,
    teaching: analyzeTeaching,
  }[element];
  if (!analyze) return [];
  return (Array.isArray(corpus) ? corpus : [])
    .filter((n) => n && typeof n.text === "string")
    .map((n) => {
      const finding = analyze(n.text);
      return {
        factors: finding.found.length,
        present: finding.level !== "absent",
        outcome: n.outcome === "denied" || n.outcome === "paid" ? n.outcome : "unknown",
      };
    });
}

/**
 * Evaluate every candidate threshold against the corpus.
 *
 * For each candidate, `flagged` is how many notes would be graded below strong
 * (i.e. would show a review prompt). When outcomes are labelled, the confusion
 * counts are reported so a human can see the trade directly: `caught` is a
 * denied note PennSync would have flagged, `missed` a denied note it would have
 * passed, `falseAlarm` a paid note it would have flagged.
 *
 * @param {Array<{ text: string, outcome?: string }>} corpus
 * @param {"homebound"|"skilled_need"|"teaching"} element
 * @param {number[]} [candidates]
 */
export function evaluateThresholds(corpus, element, candidates) {
  const scored = scoreCorpus(corpus, element);
  const key = `${element}_strong_factors`;
  const base = DEFAULT_THRESHOLDS[key];
  const range = Array.isArray(candidates) && candidates.length
    ? [...candidates].sort((a, b) => a - b)
    : Array.from({ length: (base?.max ?? 5) - (base?.min ?? 1) + 1 }, (_, i) => (base?.min ?? 1) + i);

  const present = scored.filter((s) => s.present);
  const labelled = present.filter((s) => s.outcome !== "unknown");

  return {
    element,
    thresholdKey: key,
    currentDefault: base?.value ?? null,
    sampleSize: scored.length,
    presentCount: present.length,
    labelledCount: labelled.length,
    // Distribution of factor counts — the shape a human should look at first.
    distribution: range.reduce((acc, n) => {
      acc[n] = present.filter((s) => s.factors === n).length;
      return acc;
    }, { 0: present.filter((s) => s.factors === 0).length }),
    candidates: range.map((threshold) => {
      const flagged = present.filter((s) => s.factors < threshold);
      const caught = labelled.filter((s) => s.factors < threshold && s.outcome === "denied").length;
      const missed = labelled.filter((s) => s.factors >= threshold && s.outcome === "denied").length;
      const falseAlarm = labelled.filter((s) => s.factors < threshold && s.outcome === "paid").length;
      const cleared = labelled.filter((s) => s.factors >= threshold && s.outcome === "paid").length;
      return {
        threshold,
        flagged: flagged.length,
        flagRate: present.length ? Number((flagged.length / present.length).toFixed(3)) : 0,
        caught,
        missed,
        falseAlarm,
        cleared,
      };
    }),
  };
}

/**
 * Name the candidate that best separates the labelled outcomes — or decline.
 *
 * Declining is a real answer here. A recommendation drawn from 12 notes, or from
 * a corpus where everything was paid, would carry the authority of a number
 * without the evidence for one, and someone would ship it.
 *
 * @param {ReturnType<typeof evaluateThresholds>} evaluation
 */
export function recommendThreshold(evaluation) {
  const decline = (reason) => ({
    recommended: null,
    confident: false,
    reason,
    statement: `PennSync cannot recommend a threshold from this corpus: ${reason} `
      + "Keep the current default and review it with a larger labelled sample.",
  });

  if (!evaluation || !evaluation.candidates?.length) return decline("no candidates were evaluated.");
  if (evaluation.labelledCount < MIN_LABELLED_SAMPLE) {
    return decline(
      `only ${evaluation.labelledCount} notes carry a known outcome (at least ${MIN_LABELLED_SAMPLE} are needed).`,
    );
  }
  const denied = evaluation.candidates[0].caught + evaluation.candidates[0].missed;
  const paid = evaluation.candidates[0].falseAlarm + evaluation.candidates[0].cleared;
  const minorityShare = Math.min(denied, paid) / Math.max(1, denied + paid);
  if (minorityShare < MIN_MINORITY_SHARE) {
    return decline(
      `the outcomes are too one-sided (${denied} denied vs ${paid} paid) to separate a threshold.`,
    );
  }

  // Youden's J: (sensitivity + specificity − 1). Balances catching denials
  // against flagging notes that were paid, without weighting either by a cost
  // PennSync has no basis to assume.
  const best = evaluation.candidates
    .map((c) => {
      const sensitivity = denied ? c.caught / denied : 0;
      const specificity = paid ? c.cleared / paid : 0;
      return { ...c, sensitivity, specificity, j: Number((sensitivity + specificity - 1).toFixed(4)) };
    })
    .sort((a, b) => b.j - a.j || a.flagged - b.flagged)[0];

  return {
    recommended: best.threshold,
    confident: true,
    reason: "",
    sensitivity: Number(best.sensitivity.toFixed(3)),
    specificity: Number(best.specificity.toFixed(3)),
    flagRate: best.flagRate,
    statement: `On ${evaluation.labelledCount} labelled notes, a threshold of ${best.threshold} `
      + `flags ${Math.round(best.flagRate * 100)}% of notes, catching ${best.caught} of ${denied} `
      + `denials and clearing ${best.cleared} of ${paid} paid notes. This is evidence for a human `
      + "decision, not a setting PennSync should apply on its own.",
  };
}
