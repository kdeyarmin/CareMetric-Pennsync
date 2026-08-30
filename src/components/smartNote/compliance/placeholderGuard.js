// Deterministic unfilled-placeholder guard. Pure + offline.
//
// WHY THIS EXISTS
// The note templates (NoteTemplateSelector) and several quick phrases seed the
// draft with fill-in-the-blank scaffolding:
//
//   "• Homebound status: patient unable to leave home without considerable
//      effort due to [diagnosis]"
//   "• Vital signs: BP _/_, HR _, O2 _% on RA"
//
// Left unfilled, that scaffolding was indistinguishable from real documentation
// to every downstream check, and all three of them PASSED it:
//
//   - presenceDetection matched "homebound"/"unable to leave", so the element
//     scanned as DOCUMENTED and the nurse was never asked the question;
//   - computeCoverageScore therefore counted it toward a 100% coverage meter;
//   - the denial guardrail saw HB_CAUSAL ("due to") + HB_EFFORT ("considerable
//     effort") in the same sentence and reported the homebound narrative as a
//     PASS with 0% denial risk.
//
// So an untouched template scored as a fully compliant note, and the constrained
// scribe then re-voiced "[diagnosis]" straight into the text the nurse copies
// into the EMR. The value-guard could not catch it either: it verifies numbers
// and medications, and "[diagnosis]" is neither.
//
// This module makes an unfilled placeholder a first-class, deterministic defect:
// it never counts as evidence (presenceDetection), and it blocks generation and
// final verification (ConstrainedNoteReviewer) until it is filled in or removed.

// NOTE ON REGEX STATE: these patterns are declared WITHOUT /g and a fresh global
// copy is built per scan. A module-level /g regex carries a mutable `lastIndex`,
// and `String.prototype.matchAll` seeds its internal matcher FROM that lastIndex
// — so a preceding `.test()` (which advances it) made a later `findPlaceholders`
// on the same module start mid-string and silently miss earlier placeholders.
// That is exactly the interleaving `scanDraft` produces: detectPresence calls
// hasPlaceholder per segment, then describePlaceholders runs over the whole
// draft. Keeping the shared patterns stateless removes the class of bug.
const globalCopy = (re) => new RegExp(re.source, "g");

// Bracketed placeholders: "[diagnosis]", "[low/medium/high]", "[topic]".
// Bounded and newline-free so a stray "[" can't swallow the rest of the note.
const BRACKET_PLACEHOLDER = /\[[^\]\n]{0,80}\]/;

// Blank-line placeholders: a run of underscores that is NOT part of an
// identifier — "BP _/_", "HR _", "location: _", "____".
// The leading boundary is CONSUMED rather than expressed as a lookbehind:
// lookbehind is a parse-time SyntaxError in Safari < 16.4, which would kill this
// whole module on import (same constraint documented in factExtraction.js).
const BLANK_PLACEHOLDER = /(?:^|[^A-Za-z0-9_])(_+)(?![A-Za-z0-9_])/;

/**
 * Every unfilled placeholder in `text`, in document order.
 * @param {string} text
 * @returns {{ type: "bracket"|"blank", value: string, index: number }[]}
 */
export function findPlaceholders(text) {
  const src = String(text || "");
  if (!src) return [];
  /** @type {{ type: "bracket"|"blank", value: string, index: number }[]} */
  const out = [];

  for (const m of src.matchAll(globalCopy(BRACKET_PLACEHOLDER))) {
    out.push({ type: "bracket", value: m[0], index: m.index ?? 0 });
  }
  for (const m of src.matchAll(globalCopy(BLANK_PLACEHOLDER))) {
    // Group 1 is the underscore run; the match may include the consumed
    // boundary character, so offset the index onto the run itself.
    const run = m[1];
    out.push({ type: "blank", value: run, index: (m.index ?? 0) + m[0].length - run.length });
  }

  return out.sort((a, b) => a.index - b.index);
}

/** Does `text` contain any unfilled placeholder? */
export function hasPlaceholder(text) {
  const src = String(text || "");
  if (!src) return false;
  // Both patterns are non-global, so .test() is stateless and safe to interleave
  // with findPlaceholders (see the regex-state note above).
  return BRACKET_PLACEHOLDER.test(src) || BLANK_PLACEHOLDER.test(src);
}

/**
 * The lines that still carry a placeholder, with the placeholders they carry —
 * what the reviewer shows the nurse so they know exactly what to finish.
 * Deduped by line, capped so a wholly-untouched template can't flood the panel.
 * @param {string} text
 * @param {number} [limit=6]
 * @returns {{ line: string, placeholders: string[] }[]}
 */
export function describePlaceholders(text, limit = 6) {
  const src = String(text || "");
  if (!src) return [];
  const out = [];
  const seen = new Set();
  for (const rawLine of src.split(/\n+/)) {
    const line = rawLine.replace(/^[\s•\-*–·]+/, "").trim();
    if (!line || seen.has(line)) continue;
    const found = findPlaceholders(line);
    if (!found.length) continue;
    seen.add(line);
    // Distinct placeholder tokens, in order of appearance.
    const placeholders = [];
    for (const p of found) {
      if (!placeholders.includes(p.value)) placeholders.push(p.value);
    }
    out.push({ line, placeholders });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Count of unfilled placeholders — used for the "N blanks left" affordance.
 * @param {string} text
 */
export function countPlaceholders(text) {
  return findPlaceholders(text).length;
}
