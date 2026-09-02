// Note → OASIS EVIDENCE mapper.
//
// WHAT CHANGED AND WHY
// This module used to turn `mapNoteToOASIS` output into "attestable drafts":
// each carried a `value` resolved against the form's option set, and the panel
// above it could apply them one by one or in bulk at ≥85% confidence. However it
// was labelled, that is AI selecting official OASIS responses — and the resolver
// did the selecting by string-matching a model's text against option labels,
// which is a guess dressed as a code.
//
// Every final official OASIS response must be selected explicitly by a
// clinician. So the mapper no longer produces a value at all. It produces what
// AI is genuinely good for and is permitted to return: the verbatim sentence
// from the note, the item that sentence is relevant to, an explicit
// discrepancy/uncertainty flag, and a question for the clinician to answer in
// their EMR.
//
// There is deliberately no `answersFromDrafts` any more: there is no draft value
// to apply, so no code path can write one.
//
// Pure + offline (unit-tested with `node --test`).

import { stripCodeAssertions } from "./responseSchema/aiResponseSanitizer.js";

/** Normalize an OASIS item number ("M1860", "m1860", "M 1860") to a form id. */
export function normalizeItemId(itemNumber) {
  return String(itemNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Index the OASIS question set by id → { label }. */
function buildItemIndex(sections) {
  const idx = {};
  for (const section of sections || []) {
    for (const q of section.questions || []) {
      idx[q.id] = { label: q.label, description: q.description || "" };
    }
  }
  return idx;
}

/**
 * Build EVIDENCE entries from mapNoteToOASIS suggestions.
 *
 * No entry carries a code, a value, or anything a caller could apply to the
 * form. A model-produced code inside free text is stripped on the way through,
 * so an unexpected one still cannot reach the clinician as a recommendation.
 *
 * @param {Array} suggestions mapNoteToOASIS `oasis_suggestions`
 * @param {Array} sections    OASIS_SECTIONS
 * @returns {{ evidence: Array, skipped: Array }}
 */
export function buildOasisEvidence(suggestions, sections) {
  const idx = buildItemIndex(sections);
  const evidence = [];
  const skipped = [];
  const seen = new Set();

  for (const s of Array.isArray(suggestions) ? suggestions : []) {
    if (!s || typeof s !== "object") continue;
    const id = normalizeItemId(s.item_number);
    const q = idx[id];
    if (!q) {
      skipped.push({ id, item_number: s.item_number, reason: "not_in_form" });
      continue;
    }
    const quote = String(s.supporting_text || "").trim();
    if (!quote) {
      // Without a verbatim quote there is nothing for the clinician to check,
      // and an unevidenced assertion is exactly what must not be shown.
      skipped.push({ id, item_number: s.item_number, reason: "no_verbatim_evidence" });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    evidence.push({
      id,
      label: q.label,
      // Verbatim from the note. Kept as written so the clinician can find it.
      evidence: quote,
      // Free text, with any code assertion neutralised.
      note: stripCodeAssertions(s.clinical_rationale || ""),
      discrepancy: !!s.discrepancy_flag,
      question:
        "Does this support your answer for this item? Choose the official response "
        + "yourself from the wording in your EMR.",
      source: "note_evidence",
    });
  }
  return { evidence, skipped };
}

/** The notice shown wherever this evidence appears. */
export const EVIDENCE_ONLY_NOTICE =
  "PennSync does not select OASIS responses. These are sentences from the note that relate to "
  + "an item, shown so you can check them — not suggested answers.";
