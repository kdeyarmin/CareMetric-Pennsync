// Documentation-gap detection: where the record and the coded OASIS response
// appear to describe different patients.
//
// WHAT TRIGGERS A FINDING, AND WHY IT MATTERS
// The trigger is EVIDENCE — a sentence in the documentation that does not fit
// the recorded response. It is never payment. That distinction is the whole
// design: a rule that fires because a different answer would pay more is asking
// a clinician to change a federal assessment for a financial reason, and if the
// clinician is not told that is the reason, they are attesting to something
// they were not shown.
//
// The structural guarantee is SYMMETRY. Every item with a rule that fires when
// the documentation suggests MORE dependence also has one that fires when it
// suggests LESS. A rule set that only ever fires in the direction that pays
// better is a revenue rule wearing a clinical label, whatever its comments say,
// and `documentationGaps.test.js` fails the build if that ever becomes true.
//
// This module has no concept of money. There are no dollar figures, no case-mix
// weights, and no payment fields anywhere in what it returns — not hidden from
// clinicians by a role check, absent. The admin revenue view is built by
// joining these findings to CLOSED-episode data elsewhere
// (`documentationGapAnalytics.js`), and that join deliberately cannot run on an
// open assessment.
//
// Pure functions. No React, no SDK — unit-testable offline.

import { RESPONSE_SCHEMA_V2_CMS_E2 } from "./responseSchema/registry.js";

/** Which direction the documentation points, relative to the recorded code. */
export const GAP_DIRECTIONS = Object.freeze(["suggests_more_dependence", "suggests_less_dependence"]);

/**
 * Rules, one per item, each with BOTH directions.
 *
 * `codes` lists the recorded responses that would CONTRADICT the matched
 * documentation, per response schema — because the same code means different
 * things under the legacy and CMS-aligned sets. Codes are compared as strings.
 *
 * Patterns are deliberately narrow. A noisy gap panel gets ignored, and an
 * ignored panel is worse than none: it trains clinicians to dismiss the one
 * finding that mattered.
 */
export const GAP_RULES = Object.freeze([
  Object.freeze({
    item: "m1860",
    label: "M1860 — Ambulation/Locomotion",
    // Admin-only correlation key. Carries no payment value itself.
    dimension: "functional",
    suggests_more_dependence: Object.freeze({
      pattern: /\b(?:bedfast|chairfast|two[- ]person assist|unable to ambulate|unable to walk|wheelchair[- ]bound|maximum assist(?:ance)? (?:to|with) (?:walk|ambulat))/i,
      codes: Object.freeze({ v1: Object.freeze(["0", "1", "2"]), v2: Object.freeze(["0", "1"]) }),
    }),
    suggests_less_dependence: Object.freeze({
      pattern: /\b(?:ambulates? independently|walks? without assistance|independent (?:with )?ambulation|ambulates? without (?:an? )?(?:device|assist))/i,
      codes: Object.freeze({ v1: Object.freeze(["5", "6"]), v2: Object.freeze(["4", "5", "6"]) }),
    }),
  }),
  Object.freeze({
    item: "m1830",
    label: "M1830 — Bathing",
    dimension: "functional",
    suggests_more_dependence: Object.freeze({
      pattern: /\b(?:bed bath|bathed by (?:the )?(?:aide|caregiver|staff)|total(?:ly)? (?:assist|dependent) (?:with|for) (?:bath|hygiene)|unable to bathe)/i,
      codes: Object.freeze({ v1: Object.freeze(["0", "1"]), v2: Object.freeze(["0", "1"]) }),
    }),
    suggests_less_dependence: Object.freeze({
      pattern: /\b(?:bathes? (?:self )?independently|showers? independently|independent (?:with )?(?:bathing|shower))/i,
      codes: Object.freeze({ v1: Object.freeze(["4", "5", "6"]), v2: Object.freeze(["4", "5", "6"]) }),
    }),
  }),
  Object.freeze({
    item: "m2020",
    label: "M2020 — Management of Oral Medications",
    dimension: "clinical",
    suggests_more_dependence: Object.freeze({
      pattern: /\b(?:caregiver (?:administers|gives|manages) (?:all )?(?:the )?med|medications? (?:are )?administered by|unable to (?:self[- ])?manage medication|pre[- ]?pour(?:ed)?|pill ?box filled by)/i,
      codes: Object.freeze({ v1: Object.freeze(["0"]), v2: Object.freeze(["0"]) }),
    }),
    suggests_less_dependence: Object.freeze({
      pattern: /\b(?:manages? (?:own )?medications? independently|independent with medication|self[- ]administers? (?:all )?medications?)/i,
      codes: Object.freeze({ v1: Object.freeze(["2", "3"]), v2: Object.freeze(["3"]) }),
    }),
  }),
  Object.freeze({
    item: "m1400",
    label: "M1400 — Short of Breath",
    dimension: "clinical",
    suggests_more_dependence: Object.freeze({
      pattern: /\b(?:short(?:ness)? of breath at rest|dyspnea at rest|SOB at rest|oxygen (?:continuously|at all times)|breathless(?:ness)? (?:at|when) rest)/i,
      codes: Object.freeze({ v1: Object.freeze(["0", "1"]), v2: Object.freeze(["0", "1"]) }),
    }),
    suggests_less_dependence: Object.freeze({
      pattern: /\b(?:no (?:shortness of breath|dyspnea|SOB)|denies (?:shortness of breath|dyspnea|SOB)|breathing (?:is )?unlabored)/i,
      codes: Object.freeze({ v1: Object.freeze(["3", "4"]), v2: Object.freeze(["3", "4"]) }),
    }),
  }),
  Object.freeze({
    item: "m1840",
    label: "M1840 — Toilet Transferring",
    dimension: "functional",
    suggests_more_dependence: Object.freeze({
      pattern: /\b(?:bedside commode|bedpan|urinal|unable to (?:get to|reach) the (?:toilet|bathroom)|total(?:ly)? dependent (?:in|for) toileting)/i,
      codes: Object.freeze({ v1: Object.freeze(["0"]), v2: Object.freeze(["0"]) }),
    }),
    suggests_less_dependence: Object.freeze({
      pattern: /\b(?:toilets? independently|independent (?:with )?toileting|ambulates? to the (?:toilet|bathroom) (?:independently|without assist))/i,
      codes: Object.freeze({ v1: Object.freeze(["3", "4"]), v2: Object.freeze(["3", "4"]) }),
    }),
  }),
  Object.freeze({
    item: "m1870",
    label: "M1870 — Feeding or Eating",
    dimension: "clinical",
    suggests_more_dependence: Object.freeze({
      pattern: /\b(?:g[- ]?tube|gastrostomy|nasogastric|NG tube|tube feed(?:ing|s)?|PEG tube|fed by (?:the )?(?:caregiver|staff))/i,
      codes: Object.freeze({ v1: Object.freeze(["0", "1"]), v2: Object.freeze(["0", "1"]) }),
    }),
    suggests_less_dependence: Object.freeze({
      pattern: /\b(?:feeds? (?:self|him|her)self independently|independent (?:with )?(?:feeding|eating)|eats? independently)/i,
      codes: Object.freeze({ v1: Object.freeze(["2", "3"]), v2: Object.freeze(["2", "3", "4", "5"]) }),
    }),
  }),
]);

/**
 * Read saved OASIS answers WITH their response schema.
 *
 * Mirrors `crossDocumentConsistency.js`: this module raises questions rather
 * than emitting codes, so it reads both schemas — gating it on v2 would switch
 * the check off for every assessment recorded before the cutover, which is the
 * opposite of safer. Each rule states, per schema, which codes contradict.
 *
 * @returns {Object<string, {code: string, schema: "v1"|"v2"}>}
 */
export function answersWithSchema(oasis) {
  const out = {};
  if (!oasis) return out;
  const items = oasis.oasis_items || oasis.items || oasis;
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (!it || it.item_number == null) continue;
    const key = String(it.item_number).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (it.response_schema_id === RESPONSE_SCHEMA_V2_CMS_E2) {
      const code = it.response_value?.code;
      if (typeof code === "string") out[key] = { code, schema: "v2" };
    } else {
      const raw = it.response;
      if (raw !== undefined && raw !== null && raw !== "") out[key] = { code: String(raw), schema: "v1" };
    }
  }
  return out;
}

/** The sentence(s) a pattern matched, so the finding can quote the record. */
function sentencesMatching(text, pattern) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && pattern.test(s))
    .slice(0, 3);
}

/**
 * Find documentation gaps for one assessment.
 *
 * @param {object} args
 * @param {string} args.documentation Visit note / care plan text.
 * @param {object} args.oasis         The saved assessment (or its items).
 * @returns {Array<object>} findings, each carrying its evidence and direction.
 */
export function findDocumentationGaps({ documentation = "", oasis = null } = {}) {
  const answers = answersWithSchema(oasis);
  const text = String(documentation || "");
  if (!text.trim()) return [];

  const gaps = [];
  for (const rule of GAP_RULES) {
    const answer = answers[rule.item];
    if (!answer) continue;
    for (const direction of GAP_DIRECTIONS) {
      const spec = rule[direction];
      if (!spec) continue;
      const contradicting = spec.codes[answer.schema];
      if (!Array.isArray(contradicting) || !contradicting.includes(answer.code)) continue;
      const evidence = sentencesMatching(text, spec.pattern);
      // No quote, no finding. An unevidenced nudge is the thing to avoid.
      if (evidence.length === 0) continue;
      gaps.push(Object.freeze({
        id: `${rule.item}_${direction}`,
        item: rule.item,
        label: rule.label,
        dimension: rule.dimension,
        direction,
        recorded_code: answer.code,
        recorded_schema: answer.schema,
        evidence,
        // The whole reason, stated. There is no second, unstated one.
        reason:
          "The documentation and the recorded response appear to describe different things.",
        question:
          "Re-read the wording of this item in your EMR and confirm which reflects the "
          + "patient. If the documentation is right, correct the documentation or the "
          + "response there; if the response is right, no change is needed.",
        // Always: PennSync surfaces, a clinician decides.
        advisory: true,
      }));
      break; // one finding per item — the strongest signal, not a pile
    }
  }
  return gaps;
}

/**
 * The clinician-facing projection.
 *
 * Built by ALLOW-LIST, not by deleting fields: a future key added to a finding
 * cannot leak into a nurse's view by being forgotten here, because it is simply
 * never copied. `dimension` is dropped too — it is an admin correlation key and
 * a clinician has no use for it.
 */
export function toClinicianView(gaps) {
  return (Array.isArray(gaps) ? gaps : []).map((g) => ({
    id: g.id,
    item: g.item,
    label: g.label,
    direction: g.direction,
    recorded_code: g.recorded_code,
    evidence: g.evidence,
    reason: g.reason,
    question: g.question,
    advisory: true,
  }));
}

/** What the clinician panel says about itself. */
export const CLINICIAN_GAP_NOTICE =
  "These are places where a visit note and a recorded OASIS response appear to describe "
  + "different things. PennSync does not select OASIS responses and does not know which is "
  + "right — re-read the item in your EMR and decide.";
