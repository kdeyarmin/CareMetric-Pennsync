// Deterministic detection of whether each required element is present in the
// nurse's draft. Pure + offline. For every element we return whether it was
// found and, if so, a clean single-line evidence sentence (for provenance and
// for the homebound_justification chart field).
import { splitSentences } from "./factExtraction.js";

/**
 * @param {string} draftText normalized rough draft
 * @param {Array} requiredElements from getRequiredElements()
 * @returns {{ id, label, severity, present: boolean, evidence: string|null }[]}
 */
export function detectPresence(draftText, requiredElements) {
  // Newline/bullet/sentence-aware segments, trimmed — so a bullet draft (few
  // periods) yields clean one-line evidence rather than a multi-line chunk.
  const segments = splitSentences(draftText || "");
  return requiredElements.map((elem) => {
    let evidence = null;

    // 1) strongest signal: an element-specific regex pattern (case-insensitive,
    //    no /g flag, so .test() is stateless across segments)
    if (elem.pattern) {
      const seg = segments.find((s) => elem.pattern.test(s));
      if (seg) evidence = `${seg}.`;
    }

    // 2) fallback: any keyword appears in a segment
    if (!evidence && Array.isArray(elem.keywords) && elem.keywords.length) {
      const lower = (draftText || "").toLowerCase();
      const matchedKeyword = elem.keywords.find((k) => lower.includes(k.toLowerCase()));
      if (matchedKeyword) {
        const seg = segments.find((s) => s.toLowerCase().includes(matchedKeyword.toLowerCase()));
        evidence = seg ? `${seg}.` : matchedKeyword;
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
