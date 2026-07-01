// Quick-phrase expansion engine for the note editor.
//
// The app's advertised documentation-speed feature (expandClinicalPhrase + the
// phrase library) had no trigger in any note textarea. This is the pure,
// testable core that powers an inline /-slash menu and .dot-token (e.g.
// ".diabeticedu"): given the textarea text + caret, it detects an active
// trigger, filters the phrase library, and computes the text + caret after
// inserting the expansion. It is dependency-free (unit-tested with `node --test`)
// and carries no fabricated clinical facts — the inserted text is a generic,
// compliant phrasing the nurse edits, and it still flows through the existing
// ConstrainedNoteReviewer / grounding pass downstream, so anti-fabrication holds.

export const TRIGGER = { SLASH: "slash", DOT: "dot" };

// A small, safe, offline default phrase set. Each expansion is a generic
// compliant phrasing (with [bracketed] cues where a specific fact is required)
// — never a fabricated assessment finding. Agencies can extend via
// ClinicalLibraryTemplate (pass merged phrases into detect/filter).
export const DEFAULT_QUICK_PHRASES = [
  {
    token: "diabeticedu",
    phrase: "diabetic education",
    category: "education",
    expanded_text:
      "Provided diabetic self-management education including blood glucose monitoring, medication adherence, foot care, and diet; patient/caregiver verbalized understanding via teach-back.",
  },
  {
    token: "woundcare",
    phrase: "wound care provided",
    category: "wound_care",
    expanded_text:
      "Performed skilled wound care using sterile technique per physician orders; assessed the wound bed, measured dimensions, and applied the ordered dressing. Wound appearance: [describe].",
  },
  {
    token: "fallrisk",
    phrase: "fall risk assessment",
    category: "safety",
    expanded_text:
      "Completed a home-safety and fall-risk assessment; reviewed environmental hazards and reinforced fall-prevention strategies with patient/caregiver. Findings: [describe].",
  },
  {
    token: "teachback",
    phrase: "teach-back confirmed",
    category: "education",
    expanded_text:
      "Confirmed patient/caregiver understanding of the instructions provided via teach-back / return demonstration.",
  },
  {
    token: "homebound",
    phrase: "homebound status",
    category: "assessment",
    expanded_text:
      "Patient remains homebound; leaving the home requires a considerable and taxing effort due to [medical reason], requiring [assistance/assistive device].",
  },
  {
    token: "medrec",
    phrase: "medication reconciliation",
    category: "medication",
    expanded_text:
      "Completed medication reconciliation; reviewed the current medication list against physician orders and addressed any discrepancies.",
  },
  {
    token: "chfassess",
    phrase: "CHF assessment",
    category: "assessment",
    expanded_text:
      "Skilled cardiopulmonary assessment: auscultated lung and heart sounds, assessed for edema and dyspnea, and reviewed daily weights and sodium intake for CHF management. Findings: [describe].",
  },
];

const TOKEN_BODY = /[a-z0-9]/i;

/**
 * Detect an active quick-phrase trigger ending at the caret.
 *
 * A trigger is a "/" (slash menu) or "." (dot token) that (a) sits at a token
 * boundary — preceded by whitespace or the start of the field — and (b) is
 * followed by a contiguous alphanumeric token being typed. Dot tokens require at
 * least one letter after the dot so ordinary sentence periods / decimals never
 * open the menu.
 *
 * @param {string} text
 * @param {number} caret  caret index (selectionStart)
 * @returns {(null|{type:string, trigger:string, token:string, query:string, start:number, end:number})}
 */
export function detectTrigger(text, caret) {
  const s = String(text ?? "");
  const pos = Math.max(0, Math.min(Number(caret) || 0, s.length));

  // Walk back over the contiguous token body immediately before the caret.
  let i = pos - 1;
  while (i >= 0 && TOKEN_BODY.test(s[i])) i--;
  if (i < 0) return null;

  const trigger = s[i];
  if (trigger !== "/" && trigger !== ".") return null;

  // Must be at a token boundary (start-of-field or preceded by whitespace).
  const prev = i > 0 ? s[i - 1] : "";
  if (prev && !/\s/.test(prev)) return null;

  const query = s.slice(i + 1, pos);
  const type = trigger === "/" ? TRIGGER.SLASH : TRIGGER.DOT;

  // A bare "." (no letters yet) is a period, not a dot token.
  if (type === TRIGGER.DOT && !/^[a-z]/i.test(query)) return null;
  // The query must be a clean token (the while-loop guarantees this, but keep
  // the contract explicit).
  if (query && !/^[a-z0-9]*$/i.test(query)) return null;

  return { type, trigger, token: s.slice(i, pos), query: query.toLowerCase(), start: i, end: pos };
}

/**
 * Filter phrases matching an active trigger's query. Ranks exact token match,
 * then token prefix, then phrase substring. An empty query returns all (a
 * just-opened slash menu).
 *
 * @param {Array} phrases  [{ token, phrase, expanded_text, category }]
 * @param {string} query   lowercased
 * @param {number} [limit=8]
 * @returns {Array}
 */
export function filterPhrases(phrases, query, limit = 8) {
  const list = Array.isArray(phrases) ? phrases : [];
  const q = String(query || "").toLowerCase().trim();
  if (!q) return list.slice(0, limit);

  const scored = [];
  for (const p of list) {
    const token = String(p.token || "").toLowerCase();
    const phrase = String(p.phrase || "").toLowerCase();
    let score = null;
    if (token === q) score = 0;
    else if (token.startsWith(q)) score = 1;
    else if (phrase.startsWith(q)) score = 2;
    else if (token.includes(q) || phrase.includes(q)) score = 3;
    if (score !== null) scored.push({ p, score });
  }
  scored.sort((a, b) => a.score - b.score || String(a.p.token).localeCompare(String(b.p.token)));
  return scored.slice(0, limit).map((s) => s.p);
}

/**
 * Replace the trigger token [start,end) with the expansion, returning the new
 * text and the caret position after the inserted text. A trailing space is
 * added when the insertion isn't already followed by whitespace, so the nurse
 * keeps typing cleanly.
 *
 * @param {string} text
 * @param {{start:number,end:number}} range
 * @param {string} expandedText
 * @returns {{text:string, caret:number}}
 */
export function applyExpansion(text, range, expandedText) {
  const s = String(text ?? "");
  const start = Math.max(0, Math.min(range?.start ?? 0, s.length));
  const end = Math.max(start, Math.min(range?.end ?? start, s.length));
  let insert = String(expandedText ?? "");
  const after = s.slice(end);
  if (insert && !/\s$/.test(insert) && after && !/^\s/.test(after)) insert += " ";
  const next = s.slice(0, start) + insert + after;
  return { text: next, caret: start + insert.length };
}

/**
 * Resolve the expansion text for a selected phrase. Prefers an explicit
 * expanded_text; falls back to the human phrase label.
 */
export function expansionTextFor(phrase) {
  if (!phrase) return "";
  return phrase.expanded_text || phrase.phrase || phrase.token || "";
}
