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

// Words that flip an option's clinical meaning. A fragment match across a
// negation boundary drafts the OPPOSITE answer — "short of breath" is a
// substring of "Patient is not short of breath" — so both sides must agree
// on polarity before any label match counts.
const NEGATION_TOKENS = new Set(["no", "not", "never", "none", "without", "denies", "denied", "unable"]);

const tokenize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
const hasNegation = (toks) => toks.some((t) => NEGATION_TOKENS.has(t));

/**
 * Whole-token label match: exact token-sequence equality, or a multi-token
 * contiguous run inside the longer side. Single-token needles ("no", "yes")
 * only match by full equality — substring/fragment matching is how "…noted"
 * used to match the "No" option.
 */
function labelTokensMatch(a, b) {
  if (!a.length || !b.length) return false;
  if (hasNegation(a) !== hasNegation(b)) return false;
  const [needle, hay] = a.length <= b.length ? [a, b] : [b, a];
  if (needle.length === hay.length) return needle.every((t, i) => t === hay[i]);
  if (needle.length === 1) return false;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((t, j) => t === hay[i + j])) return true;
  }
  return false;
}

/**
 * Resolve a suggestion's value to a valid numeric option for the item, or null.
 * Tries the raw numeric value first, then a whole-token option-label match.
 */
function resolveValue(suggestion, question) {
  // Primary: the raw numeric value must be one of the item's real options.
  const raw = String(suggestion.suggested_value ?? "").trim();
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n) && question.values.has(n)) return n;

  // Fallback: match the descriptive label (or a non-numeric suggested_value
  // like "yes") against option labels on whole-token boundaries with matching
  // negation polarity. Plain substring matching drafted opposite values:
  // "Unhealed pressure injury noted" contains "no" → M1306 = 0. A bare
  // numeric ("9") still never matches an option by label.
  const stripPrefix = (s) => String(s).replace(/^\s*\d+\s*[—–-]\s*/, "");
  const candidates = [suggestion.suggested_value_label, /\d/.test(raw) ? "" : raw]
    .map(tokenize)
    .filter((toks) => toks.length > 0);
  for (const cand of candidates) {
    const matches = (question.options || []).filter((o) => labelTokensMatch(cand, tokenize(stripPrefix(o.label))));
    if (matches.length === 1) return matches[0].value;
    if (matches.length > 1) {
      // Ambiguous fragment ("short of breath" appears in several severity
      // levels) — only an exact whole-label match may resolve it; otherwise
      // skip rather than draft an arbitrary level.
      const exact = matches.filter((o) => {
        const ot = tokenize(stripPrefix(o.label));
        return ot.length === cand.length && ot.every((t, i) => t === cand[i]);
      });
      if (exact.length === 1) return exact[0].value;
    }
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
 * Build an `answers` patch ({ id: value }) from OASIS autofill drafts.
 *
 * This is a pure patch-builder: it does NOT itself enforce attestation. Every
 * draft starts with `attested: false`, and the ATTESTATION GATE is the caller's
 * responsibility — the nurse attests specific items in the UI and the caller
 * passes exactly those ids. Omitting `ids` applies every draft and must only be
 * used where the whole set has already been attested (e.g. an "accept all"
 * action or a test fixture); never wire an automated/bulk caller to the
 * no-`ids` form, or it would silently overwrite the chart with unattested AI
 * suggestions.
 *
 * @param {Object} drafts        buildOasisAutofill().drafts
 * @param {Array<string>} [ids]  attested ids to apply; omit only for a fully-attested set
 */
export function answersFromDrafts(drafts, ids) {
  const keys = ids || Object.keys(drafts || {});
  const patch = {};
  for (const id of keys) {
    if (drafts && drafts[id]) patch[id] = drafts[id].value;
  }
  return patch;
}
