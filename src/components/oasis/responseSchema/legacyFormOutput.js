// Bridge: classify the CURRENT in-memory form state for output.
//
// The entry form still renders the legacy question bank (`oasisQuestions.jsx`)
// while v2 controls are behind the agency flag, so its answers live in a plain
// `{ [questionId]: value }` map with no schema attached. Those answers are
// legacy by definition: they were picked from PennSync's own option lists.
//
// This module decides what may leave the app from that state. It is the same
// fail-closed rule as `outputPolicy.js` applied to unsaved form state, so print,
// copy and PDF cannot disagree with what the saved-row path would allow.
//
// Pure functions. No React, no SDK.

import { classifyItem } from "../specs/verification.js";
import { V1_LEGACY_WARNING, v1Definition } from "./v1Legacy.js";
import { COMPANION_DISCLAIMER } from "./outputPolicy.js";

/**
 * Classify one legacy form answer.
 *
 * A code may print only when the item is a genuine CMS item whose PennSync
 * response set REPRODUCES the CMS one (`matches`). `abbreviated` is refused too:
 * looser wording means a borderline patient can be coded differently on the two
 * forms, which is precisely what a transcription guide must not encourage.
 *
 * @param {{id: string, label: string, options?: Array}} question
 * @param {unknown} value The raw stored form value.
 */
export function classifyLegacyAnswer(question, value) {
  const c = classifyItem(question.id);
  const answered = value !== undefined && value !== null && value !== "";
  const label = optionLabel(question, value);

  const isCms = c.level === "verified" || c.level === "abbreviated";
  if (isCms && c.responseSet === "matches") {
    return {
      disposition: "cms_reference",
      itemLabel: question.label,
      display: answered ? label : "— Not answered —",
      reason: "",
      warning: "",
    };
  }

  if (c.level === "pennsync_screening" || c.level === "not_a_cms_item" || c.level === "retired") {
    return {
      disposition: "internal_screening",
      // Never an M-number on a screening line.
      itemLabel: stripItemNumber(question.label),
      display: answered ? label : "— Not answered —",
      reason: "",
      warning: "",
    };
  }

  // A real CMS item whose response set conflicts with, or is looser than, CMS.
  const frozen = v1Definition(question.id);
  return {
    disposition: "quarantined",
    itemLabel: question.label,
    display: "",
    reason: c.responseSet === "abbreviated"
      ? "PennSync's answer choices for this item are worded more loosely than the CMS response set."
      : "PennSync's answer choices for this item do not match the CMS response set — at least one code means something different on the official assessment.",
    warning: frozen ? V1_LEGACY_WARNING : "",
    answeredAs: answered ? label : "",
  };
}

/** Drop a leading "M1234 — " so a screening prompt cannot show an item number. */
export function stripItemNumber(label) {
  return String(label || "").replace(/^\s*M\d{4}\s*[—-]\s*/, "").trim();
}

function optionLabel(question, value) {
  const opts = Array.isArray(question?.options) ? question.options : [];
  // Compare as STRINGS. The legacy bank stores numbers; coercing the other way
  // is how "01" became 1.
  const hit = opts.find((o) => String(o.value) === String(value));
  return hit ? hit.label : String(value ?? "");
}

/**
 * Build the whole output payload from legacy form state.
 *
 * @param {Array<{title: string, questions: Array}>} sections
 * @param {Record<string, unknown>} answers
 * @param {(q: object, answers: object) => boolean} isAnswered
 */
export function buildLegacyFormOutput(sections, answers, isAnswered) {
  const cms = [];
  const screening = [];
  const quarantined = [];
  for (const section of sections || []) {
    for (const q of section.questions || []) {
      if (!isAnswered(q, answers)) continue;
      const c = classifyLegacyAnswer(q, answers[q.id]);
      if (c.disposition === "cms_reference") cms.push({ ...c, section: section.title });
      else if (c.disposition === "internal_screening") screening.push({ ...c, section: section.title });
      else quarantined.push({ ...c, section: section.title });
    }
  }
  return {
    disclaimer: COMPANION_DISCLAIMER,
    cms,
    screening,
    quarantined,
    counts: { cms: cms.length, screening: screening.length, quarantined: quarantined.length },
  };
}
