// Deterministic detection of whether each required element is present in the
// nurse's draft. Pure + offline. For every element we return whether it was
// found and, if so, a clean single-line evidence sentence (for provenance and
// for the homebound_justification chart field).
import { splitSentences } from "./factExtraction.js";
import { hasPlaceholder } from "./placeholderGuard.js";

// Negation guard for `negationSensitive` elements (homebound, skilled need):
// a NEGATED mention is not evidence — "Patient is not homebound", "No wound
// care performed", and the engine's own "…was not documented this visit"
// fallback lines used to satisfy the detector, so a note explicitly stating
// the element was missing scanned as compliant (a false PASS on the two
// eligibility gates that hard-block). Scoped by flag so clinically valid
// negative findings on other elements ("denies pain") keep counting.
const NOT_DOCUMENTED = /\bnot\s+(?:documented|assessed|addressed|performed|provided|completed|done)\b/i;
// Up to 4 words between the negation and the hit, so a coordinated phrase
// ("No wound care or skilled service…") is still seen as negated. Clause
// boundaries (; , :) reset the window.
const NEGATED_PREFIX = /\b(?:not|no|never|denies|without|declined?s?|refused?s?|no longer|unable to)\s+(?:\w+\s+){0,4}$/i;

// Post-term negation. Looking only BEHIND the hit missed the two commonest ways
// a nurse records an element as ABSENT, and both then counted as evidence that
// it was PRESENT — a false PASS on a gate that hard-blocks:
//
//   label form  "Homebound: no."        "Skilled need — none"
//   verb form   "Wound care declined by patient."   "Teaching refused."
//
// The label form requires the negation to BE the whole answer (followed by
// punctuation or end of segment), so "Wound care: no complications noted" —
// which documents that care WAS given — is not mistaken for a denial.
const NEGATED_LABEL_SUFFIX =
  /^\s*[:\-–—]+\s*(?:no|none|negative|nil|n\/?a|denied|declined|refused)\s*(?:[.;,]|$)/i;
// The verb form allows a couple of intervening words ("wound care was declined")
// but is bounded to the current clause by the caller, so an affirmative clause
// followed by an unrelated negative ("wound care performed, no complications")
// does not trip it.
const NEGATED_VERB_SUFFIX =
  /^\s+(?:\w+\s+){0,2}(?:declines?|declined|refuses?|refused|defers?|deferred|withheld|not\s+(?:done|performed|provided|completed|indicated|applicable))\b/i;

// A whole segment that is nothing but a denied answer — "Homebound: no",
// "Skilled need — none". Tested independently of WHERE the term matched,
// because the keyword fallback can match a shorter stem ("skilled") whose tail
// (" need — none") no longer looks like the answer. Requires the negative to be
// the last thing in the segment, so "Wound care: no complications noted" — which
// documents that care WAS delivered — is untouched.
const STANDALONE_DENIAL =
  /[:\-–—]+\s*(?:no|none|negative|nil|n\/?a|denied|declined|refused)\s*$/i;

function isNegatedHit(segment, re) {
  if (NOT_DOCUMENTED.test(segment)) return true;
  if (STANDALONE_DENIAL.test(segment)) return true;
  const m = re.exec(segment);
  if (!m) return false;
  const boundary = Math.max(
    segment.lastIndexOf(";", m.index),
    segment.lastIndexOf(",", m.index),
    segment.lastIndexOf(":", m.index),
  );
  if (NEGATED_PREFIX.test(segment.slice(boundary + 1, m.index))) return true;

  const tail = segment.slice(m.index + m[0].length);
  if (NEGATED_LABEL_SUFFIX.test(tail)) return true;
  const clauseEnd = tail.search(/[;,]/);
  return NEGATED_VERB_SUFFIX.test(clauseEnd === -1 ? tail : tail.slice(0, clauseEnd));
}

/**
 * @param {string} draftText normalized rough draft
 * @param {Array} requiredElements from getRequiredElements()
 * @returns {{ id, label, severity, present: boolean, evidence: string|null }[]}
 */
export function detectPresence(draftText, requiredElements) {
  // Newline/bullet/sentence-aware segments, trimmed — so a bullet draft (few
  // periods) yields clean one-line evidence rather than a multi-line chunk.
  // An UNFILLED template line is not documentation. A seeded-but-untouched
  // "Homebound status: unable to leave home ... due to [diagnosis]" matched the
  // homebound pattern, so the element scanned as documented, the nurse was never
  // asked the question, and the blank rode into the note. Segments still holding
  // a placeholder are dropped from BOTH the evidence search and the keyword
  // fallback's haystack, so they can never satisfy a required element.
  // (ConstrainedNoteReviewer separately blocks generation until they are filled,
  // so this only suppresses the false pass — it never hides real documentation.)
  const segments = splitSentences(draftText || "").filter((s) => !hasPlaceholder(s));
  const searchText = segments.join(" ");
  return requiredElements.map((elem) => {
    let evidence = null;
    const accepts = (s, re) => re.test(s) && !(elem.negationSensitive && isNegatedHit(s, re));

    // 1) strongest signal: an element-specific regex pattern (case-insensitive,
    //    no /g flag, so .test() is stateless across segments)
    if (elem.pattern) {
      const seg = segments.find((s) => accepts(s, elem.pattern));
      if (seg) evidence = `${seg}.`;
    }

    // 2) fallback: any keyword appears in a segment — anchored at a LEADING
    //    word boundary, not raw substrings. Short keywords ("hr", "temp", "bp")
    //    matched inside unrelated words ("attemPTed", "q2HR"), falsely marking
    //    an element documented so the nurse was never asked about it. Only the
    //    leading edge is anchored: many keywords are deliberate stems
    //    ("educat", "reconcil", "allerg") that must keep matching suffixes.
    if (!evidence && Array.isArray(elem.keywords) && elem.keywords.length) {
      const kwRegex = (k) =>
        new RegExp(`\\b${String(k).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      for (const k of elem.keywords) {
        if (!k || !kwRegex(k).test(searchText)) continue;
        const re = kwRegex(k);
        const seg = segments.find((s) => accepts(s, re));
        if (seg) {
          evidence = `${seg}.`;
          break;
        }
        if (!elem.negationSensitive) {
          // Keyword present but no clean segment — keep the legacy keyword
          // fallback for ordinary elements; negation-sensitive ones require
          // an un-negated segment and move on to the next keyword.
          evidence = k;
          break;
        }
      }
    }

    return {
      id: elem.id,
      label: elem.label,
      severity: elem.severity,
      present: evidence !== null,
      evidence,
    };
  });
}

/**
 * Elements that are missing from the draft (need a question / fallback line).
 * @returns {Array} the subset of requiredElements whose presence was not found
 */
export function computeGaps(presenceResults, requiredElements) {
  const missingIds = new Set(presenceResults.filter((r) => !r.present).map((r) => r.id));
  return requiredElements.filter((e) => missingIds.has(e.id));
}

/** Convenience: critical elements that are still missing (these HARD-BLOCK). */
export function computeCriticalGaps(presenceResults, requiredElements) {
  return computeGaps(presenceResults, requiredElements).filter((e) => e.severity === "critical");
}

/**
 * For the carry-forward-safe gaps, pull the evidence sentence from a prior note
 * so it can PRE-FILL the nurse's answer (to confirm/edit). Only elements flagged
 * `carryForward` are eligible — visit-specific findings are never carried.
 * @param {string} priorNote the patient's most recent saved note
 * @param {Array} gaps missing required elements (from computeGaps)
 * @returns {Record<string,string>} map of elementId -> suggested answer text
 */
export function computeCarryForward(priorNote, gaps) {
  if (!priorNote) return {};
  const eligible = gaps.filter((e) => e.carryForward);
  if (!eligible.length) return {};
  const priorPresence = detectPresence(priorNote, eligible);
  /** @type {Record<string,string>} */
  const out = {};
  for (const r of priorPresence) {
    if (r.present && r.evidence) out[r.id] = r.evidence;
  }
  return out;
}
