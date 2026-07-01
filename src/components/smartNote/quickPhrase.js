// Pure, framework-free logic for the inline quick-phrase expansion trigger in the
// SmartNote editor. Kept free of React and the Base44 SDK so it can be unit-tested
// (node --test) and shared by the editor wrapper + phrase menu.
//
// Two trigger forms are recognized at the caret, mirroring the roadmap spec
// ("a `/`-slash menu and a dot-token pattern, e.g. `.diabeticedu`"):
//   - slash form:  ".../wound care"   opens the picker; query may contain spaces
//   - dot  form:  "....woundcare"      contiguous shorthand; query is one token
//
// Only the token immediately preceding the caret, on the caret's own line, counts,
// and the trigger character must start a word (be at line start or follow
// whitespace). This keeps clinical text like "BP 120/80", "95% O2", "e.g." and
// "Mr." from ever spuriously opening the menu.

function clampCaret(caret, len) {
  const n = Number.isFinite(caret) ? Math.floor(caret) : len;
  if (n < 0) return 0;
  if (n > len) return len;
  return n;
}

/**
 * Detect an in-progress quick-phrase token ending at the caret.
 * @returns {null | { trigger: '/'|'.', query: string, start: number, end: number }}
 *   `start` is the index of the trigger char, `end` is the caret position — the
 *   half-open range [start, end) is the token text to replace on expansion.
 */
export function detectPhraseTrigger(text, caret) {
  if (typeof text !== 'string') return null;
  const pos = clampCaret(caret, text.length);
  // Restrict scanning to the caret's own line so a trigger never spans newlines.
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const seg = text.slice(lineStart, pos);

  // Dot form first: contiguous token that must start with a letter (so "3.5" and
  // "Mr." never match). The dot must be at line start or follow whitespace.
  let m = seg.match(/(?:^|\s)\.([A-Za-z][\w-]*)$/);
  if (m) {
    const query = m[1];
    return { trigger: '.', query, start: pos - query.length - 1, end: pos };
  }

  // Slash form: query may contain spaces (multi-word phrases like "wound care").
  // The slash must be at line start or follow whitespace, and the query may not
  // contain another slash — so "and/or" and "120/80" are inert.
  m = seg.match(/(?:^|\s)\/([^/]*)$/);
  if (m) {
    const query = m[1];
    return { trigger: '/', query, start: pos - query.length - 1, end: pos };
  }

  return null;
}

/** Lowercase + trim, tolerant of nullish input. */
export function normalizePhraseText(s) {
  return String(s == null ? '' : s).toLowerCase().trim();
}

/**
 * Whether a template is usable by this nurse in this charting context.
 * - patient-bound phrases (patient_id set) appear ONLY when charting that patient
 * - otherwise: the nurse's own phrases + agency-wide phrases
 * Inactive templates are never visible.
 * @param {any} t
 * @param {{ email?: string, patientId?: string }} [ctx]
 */
export function isPhraseVisible(t, { email, patientId } = {}) {
  if (!t || t.is_active === false) return false;
  if (t.patient_id) return String(t.patient_id) === String(patientId || '');
  return t.is_agency_wide === true || (!!t.created_by && t.created_by === email);
}

// Score a template against the typed query. Higher = better; -Infinity = no match.
// An empty query matches everything (score 0) so the picker can list top phrases.
function phraseMatchScore(t, q) {
  if (!q) return 0;
  const p = normalizePhraseText(t.phrase);
  if (!p) return -Infinity;
  if (p === q) return 100;
  if (p.startsWith(q)) return 80;
  if (p.split(/\s+/).some((w) => w.startsWith(q))) return 60;
  // Space-insensitive match powers the dot-token shorthand (".diabeticedu" →
  // "diabetic education").
  const pc = p.replace(/\s+/g, '');
  const qc = q.replace(/\s+/g, '');
  if (qc && pc.startsWith(qc)) return 55;
  if (p.includes(q)) return 40;
  if (qc && pc.includes(qc)) return 30;
  return -Infinity;
}

/**
 * Rank the visible templates for the current query/context. Sorted by match
 * strength, then usage_count (popular phrases first), then phrase name for a
 * stable order. Returns at most `limit` templates.
 * @param {any[]} templates
 * @param {{ query?: string, patientId?: string, email?: string, limit?: number }} [opts]
 */
export function rankPhrases(templates, { query = '', patientId, email, limit = 8 } = {}) {
  const q = normalizePhraseText(query);
  const visible = (Array.isArray(templates) ? templates : []).filter((t) =>
    isPhraseVisible(t, { email, patientId }),
  );
  return visible
    .map((t) => ({ t, score: phraseMatchScore(t, q) }))
    .filter((x) => x.score > -Infinity)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.t.usage_count || 0) - (a.t.usage_count || 0) ||
        normalizePhraseText(a.t.phrase).localeCompare(normalizePhraseText(b.t.phrase)),
    )
    .slice(0, Math.max(0, limit))
    .map((x) => x.t);
}

/**
 * Replace the trigger token [range.start, range.end) with the expanded text.
 * @returns {{ text: string, caret: number }} new textarea value + caret position
 *   (placed at the end of the inserted text).
 */
export function applyExpansion(text, range, expandedText) {
  const src = typeof text === 'string' ? text : '';
  const s = clampCaret(range && range.start, src.length);
  const e = clampCaret(range && range.end, src.length);
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  const before = src.slice(0, lo);
  const after = src.slice(hi);
  let insert = String(expandedText == null ? '' : expandedText);
  // Keep a word boundary: if the expansion runs straight into following non-space
  // text (token expanded mid-line), add one separating space so words don't glue.
  if (insert && after && !/\s$/.test(insert) && !/^\s/.test(after)) insert += ' ';
  const newText = before + insert + after;
  return { text: newText, caret: (before + insert).length };
}

/**
 * Whether a template needs a selected patient to expand (patient-bound orders or
 * a patient-specific AI template). Lets the UI prompt for a patient up front
 * instead of round-tripping to a backend error.
 */
export function phraseNeedsPatient(t) {
  if (!t) return false;
  return !!t.patient_id || t.template_type === 'patient_specific' || t.requires_patient_data === true;
}
