// Identity cross-check between a document's AI-extracted patient and the chart
// an operator is about to write extracted clinical data onto.
//
// "Update Existing Patient" used to write primary diagnosis, allergies, meds,
// and vitals onto whatever chart was selected with NO comparison against the
// document's own patient identity — a mis-click (or an extraction naming a
// different person) silently overwrote another patient's verified chart.
//
// Pure + offline (unit-tested with `node --test`). Reuses the dedupe engine's
// canonical name/DOB normalizers so both features agree on identity.
//
// MRN is deliberately NOT compared (D233): an MRN printed on a referral
// document is the sending facility's record number, while the chart's MRN is
// PennSync's own, assigned by MatrixCare. The two numbers belong to different
// systems, so their difference is not an identity conflict and their equality
// would prove nothing — matching rests on name and DOB alone.

import { normalizeName, parseDob } from "../patient/patientDuplicateUtils.js";

/**
 * Compare the extracted patient identity to the target chart.
 *
 * Deliberately conservative in BOTH directions:
 *  - a hard conflict on DOB or last name → "mismatch" (block/confirm);
 *  - nothing comparable on either side → "unverifiable" (warn);
 *  - otherwise → "match".
 *
 * @param {{first_name?, last_name?, date_of_birth?}} extracted
 * @param {{first_name?, last_name?, date_of_birth?}} chart
 * @returns {{ verdict: "match"|"mismatch"|"unverifiable", conflicts: string[], compared: string[] }}
 */
export function checkExtractedPatientMatch(extracted = {}, chart = {}) {
  const conflicts = [];
  const compared = [];

  const exLast = normalizeName(extracted.last_name);
  const chLast = normalizeName(chart.last_name);
  if (exLast && chLast) {
    compared.push("last name");
    // Allow hyphenated/married-name containment ("Smith" vs "Smith-Jones").
    if (exLast !== chLast && !exLast.includes(chLast) && !chLast.includes(exLast)) {
      conflicts.push(`last name ("${extracted.last_name}" vs chart "${chart.last_name}")`);
    }
  }

  const exFirst = normalizeName(extracted.first_name);
  const chFirst = normalizeName(chart.first_name);
  if (exFirst && chFirst) {
    compared.push("first name");
    // First names get initial-level tolerance (nicknames, "Bob" vs "Robert"
    // share nothing — but flagging every nickname would drown real conflicts,
    // so only a differing INITIAL counts as a conflict).
    if (exFirst[0] !== chFirst[0]) {
      conflicts.push(`first name ("${extracted.first_name}" vs chart "${chart.first_name}")`);
    }
  }

  const exDob = parseDob(extracted.date_of_birth);
  const chDob = parseDob(chart.date_of_birth);
  if (exDob && chDob) {
    compared.push("date of birth");
    if (exDob.year !== chDob.year || exDob.month !== chDob.month || exDob.day !== chDob.day) {
      conflicts.push(`date of birth ("${extracted.date_of_birth}" vs chart "${chart.date_of_birth}")`);
    }
  }

  if (conflicts.length > 0) return { verdict: "mismatch", conflicts, compared };
  if (compared.length === 0) return { verdict: "unverifiable", conflicts, compared };
  return { verdict: "match", conflicts, compared };
}
