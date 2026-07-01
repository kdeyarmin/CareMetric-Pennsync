// Note → OASIS autofill mapper.
//
// mapNoteToOASIS produces verbatim-evidenced, confidence-scored M-item
// suggestions, but nothing ever pre-filled the OASIS form — nurses re-entered
// ambulation, dyspnea, meds, pain, and wounds by hand. This turns those
// suggestions into ATTESTABLE DRAFTS for the form: each suggested value is
// validated against the item's real option set, deduped to the highest-
// confidence hit, and carried with its verbatim evidence so the nurse attests
// (accepts) it rather than it silently overwriting the chart.
//
// Pure + offline (unit-tested with `node --test`).

export const DEFAULT_MIN_CONFIDENCE = 70;

/** Normalize an OASIS item number ("M1860", "m1860", "M 1860") to a form id. */
export function normalizeItemId(itemNumber) {
  return String(itemNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Index the OASIS_SECTIONS question set by id → { label, options, values }. */
function buildItemIndex(sections) {
  const idx = {};
  for (const section of sections || []) {
    for (const q of section.questions || []) {
      idx[q.id] = { label: q.label, options: q.options || [], values: new Set((q.options || []).map((o) => o.value)) };
    }
  }
  return idx;
}

function optionLabel(question, value) {
  const opt = (question.options || []).find((o) => o.value === value);
  return opt ? opt.label : String(value);
}

/**
 * Resolve a suggestion's value to a valid numeric option for the item, or null.
 * Tries the raw numeric value first, then an option-label match.
 */
function resolveValue(suggestion, question) {
  // Primary: the raw numeric value must be one of the item's real options.
  const n = parseInt(String(suggestion.suggested_value ?? "").trim(), 10);
  if (!Number.isNaN(n) && question.values.has(n)) return n;

  // Fallback: match the descriptive suggested_value_label against option labels
  // (never the raw numeric — a bare "9" must NOT substring-match an option).
  const label = String(suggestion.suggested_value_label || "").toLowerCase().trim();
  if (label.length >= 4) {
    const stripPrefix = (s) => s.replace(/^\s*\d+\s*[—-]\s*/, "").trim();
    const opt = (question.options || []).find((o) => {
      const optLabel = String(o.label).toLowerCase();
      return optLabel.includes(label) || label.includes(stripPrefix(optLabel));
    });
    if (opt) return opt.value;
  }
  return null;
}

/**
 * Build attestable OASIS drafts from mapNoteToOASIS suggestions.
 *
 * @param {Array} suggestions  mapNoteToOASIS `oasis_suggestions`
 * @param {Array} sections     OASIS_SECTIONS
 * @param {Object} [opts] { minConfidence }
 * @returns {{ drafts: Object, applied: Array, skipped: Array }}
 */
export function buildOasisAutofill(suggestions, sections, opts = {}) {
  const minConf = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const idx = buildItemIndex(sections);
  const drafts = {};
  const skipped = [];

  for (const s of Array.isArray(suggestions) ? suggestions : []) {
    const id = normalizeItemId(s.item_number);
    const q = idx[id];
    const confidence = Number(s.confidence_score) || 0;

    if (!q) {
      skipped.push({ id, item_number: s.item_number, reason: "not_in_form" });
      continue;
    }
    const value = resolveValue(s, q);
    if (value === null) {
      skipped.push({ id, item_number: s.item_number, reason: "unresolved_value" });
      continue;
    }
    if (confidence < minConf) {
      skipped.push({ id, item_number: s.item_number, reason: "low_confidence", confidence });
      continue;
    }

    const draft = {
      id,
      value,
      confidence,
      evidence: s.supporting_text || "",
      label: q.label,
      value_label: optionLabel(q, value),
      rationale: s.clinical_rationale || "",
      discrepancy: !!s.discrepancy_flag,
      current_value: s.current_oasis_value ?? null,
      attested: false,
      source: "note_autofill",
    };
    // Keep the highest-confidence suggestion per item.
    if (!drafts[id] || confidence > drafts[id].confidence) drafts[id] = draft;
  }

  const applied = Object.values(drafts).sort((a, b) => b.confidence - a.confidence);
  return { drafts, applied, skipped };
}

/**
 * Build an `answers` patch ({ id: value }) from the drafts the nurse attested.
 * @param {Object} drafts        buildOasisAutofill().drafts
 * @param {Array<string>} [ids]  ids to apply; omit to apply all
 */
export function answersFromDrafts(drafts, ids) {
  const keys = ids || Object.keys(drafts || {});
  const patch = {};
  for (const id of keys) {
    if (drafts && drafts[id]) patch[id] = drafts[id].value;
  }
  return patch;
}
