// Face-to-Face (F2F) encounter validator — 42 CFR 424.22.
//
// A missing or non-compliant F2F is a top auto-reject denial cause the app
// catches nowhere today (F2F only appears in help text). This validates the F2F
// encounter extracted from the UPLOADED REFERRAL document. It is deliberately
// scoped to referral intake — F2F is NOT part of the nurse's Smart Note or the
// patient chart (see the task spec / FaceToFaceEncounter entity comment).
//
// Four deterministic checks:
//   1. Eligible certifying practitioner (physician or allowed NPP).
//   2. Timing window — within 90 days BEFORE or 30 days AFTER the start of care.
//   3. Substantive linkage to the primary (home-health-qualifying) diagnosis.
//   4. Signature — an F2F note the extractor saw as UNSIGNED routes to
//      needs_review (an unsigned note fails medical review); when signature
//      presence wasn't determinable the result is untouched and an
//      informational verify-it reason is appended (older extractions predate
//      the field, and "unknown" must not flip every historical valid result).
//
// Pure + offline (unit-tested with `node --test`).

// CMS-eligible practitioner types for the F2F encounter / certification support.
const ELIGIBLE_CREDENTIALS = [
  "md", "do", "physician", "np", "aprn", "arnp", "cnp", "cns", "pa", "pa-c", "cnm",
];
// Explicitly NON-eligible (would invalidate the encounter).
const INELIGIBLE_CREDENTIALS = ["rn", "lpn", "lvn", "pt", "pta", "ot", "cota", "slp", "msw", "lcsw", "sw", "aide", "cna"];

export const F2F_WINDOW_BEFORE_DAYS = 90;
export const F2F_WINDOW_AFTER_DAYS = 30;

import { parseLocalDate } from "../../lib/dateLocal.js";

const STOPWORDS = new Set([
  "the", "and", "with", "without", "for", "due", "chronic", "acute", "unspecified",
  "disease", "disorder", "history", "of", "type", "left", "right", "other", "care",
  "status", "post", "stage", "primary", "secondary", "encounter", "patient",
]);

function toDate(v) {
  // Date-only F2F encounter / certification dates must stay on the local
  // calendar — UTC midnight shifted the 30-day CMS window by a day in US zones.
  return parseLocalDate(v);
}

// Spelled-out practitioner types → canonical credential (checked before
// tokenizing, so "Nurse Practitioner" doesn't land unknown).
const SPELLED_CREDENTIALS = [
  [/nurse\s+practitioner/i, "NP", true],
  [/physician\s+assistant/i, "PA", true],
  [/clinical\s+nurse\s+specialist/i, "CNS", true],
  [/certified\s+nurse[- ]midwife/i, "CNM", true],
  [/physical\s+therap/i, "PT", false],
  [/occupational\s+therap/i, "OT", false],
  [/registered\s+nurse/i, "RN", false],
];

/**
 * Parse the first recognizable credential token out of a free-text string.
 * `fromName: true` (parsing a practitioner NAME, not a credential field)
 * applies a strict rule: a token only counts as a credential when it was
 * written UPPERCASE/dotted ("MD", "D.O.") or follows a comma — otherwise the
 * surname "Do" (or "Pa") reads as an eligible DO and an unverified
 * practitioner false-PASSES the 42 CFR 424.22 check.
 */
export function parseCredential(str, { fromName = false } = {}) {
  const raw = String(str || "");
  for (const [re, cred, ok] of SPELLED_CREDENTIALS) {
    if (re.test(raw)) return { credential: cred, eligible: ok };
  }
  // Strip periods so "M.D." / "D.O." / "PA-C." tokenize as md/do/pa-c — the
  // single most common physician signature format previously parsed as m + d.
  const undotted = raw.replace(/\.(?=[a-z-]|\s|$)/gi, "");
  // Keep each token's real offset: indexOf(t) finds the FIRST substring
  // occurrence anywhere, so "Papadopoulos, Pa" located "Pa" at offset 0 and the
  // post-comma test failed, dropping a genuine credential to unknown.
  const tokenMatches = [...undotted.matchAll(/[A-Za-z-]+/g)];
  const rawTokens = tokenMatches.map((m) => m[0]);
  const credentialLike = (i) => {
    if (!fromName) return true;
    const t = rawTokens[i];
    if (t === t.toUpperCase()) return true; // written as an all-caps credential
    // ...or it follows a comma in the original ("Smith, Md")
    const idx = tokenMatches[i].index;
    return idx > 0 && /,\s*$/.test(undotted.slice(0, idx));
  };
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i].toLowerCase();
    if (ELIGIBLE_CREDENTIALS.includes(t) && credentialLike(i)) return { credential: t.toUpperCase(), eligible: true };
  }
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i].toLowerCase();
    if (INELIGIBLE_CREDENTIALS.includes(t) && credentialLike(i)) return { credential: t.toUpperCase(), eligible: false };
  }
  return { credential: null, eligible: null }; // unknown
}

/** Significant (non-stopword, length >= 4) tokens of a diagnosis string. */
function significantTokens(str) {
  return String(str || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/**
 * Validate a Face-to-Face encounter.
 *
 * @param {Object} input
 * @param {Object} input.encounter  { encounter_date, practitioner_name, practitioner_type|credential, clinical_reason, documented_conditions }
 * @param {(string|Date)} input.socDate  start-of-care / estimated start date
 * @param {string} input.primaryDiagnosis
 * @returns {{
 *   valid: boolean, status: 'valid'|'invalid'|'needs_review',
 *   reasons: string[], checks: object, days_from_soc: (number|null),
 * }}
 */
export function validateFaceToFace({ encounter = {}, socDate, primaryDiagnosis } = {}) {
  const reasons = [];
  const checks = {};

  // ── 1. Eligible practitioner ──
  // The NAME fallback parses strictly (see parseCredential): a surname that
  // happens to spell a credential ("Nguyen Do") must not validate the encounter.
  const credField = encounter.practitioner_credential || encounter.practitioner_type || "";
  const { credential, eligible } = credField
    ? parseCredential(credField)
    : parseCredential(encounter.practitioner_name || "", { fromName: true });
  checks.practitioner = { credential, eligible };
  if (eligible === true) {
    reasons.push(`Eligible certifying practitioner (${credential}).`);
  } else if (eligible === false) {
    reasons.push(`Ineligible practitioner type (${credential}) — F2F must be by a physician or allowed NPP.`);
  } else {
    reasons.push("Practitioner credential could not be determined — needs review.");
  }

  // ── 2. Timing window ──
  const encDate = toDate(encounter.encounter_date);
  const soc = toDate(socDate);
  let daysFromSoc = null;
  let withinWindow = null;
  if (!encDate) {
    reasons.push("No encounter date documented.");
  } else if (!soc) {
    reasons.push("No start-of-care date to measure the F2F window against — needs review.");
  } else {
    // Negative = encounter BEFORE soc.
    daysFromSoc = Math.round((encDate.getTime() - soc.getTime()) / (1000 * 60 * 60 * 24));
    withinWindow = daysFromSoc >= -F2F_WINDOW_BEFORE_DAYS && daysFromSoc <= F2F_WINDOW_AFTER_DAYS;
    if (withinWindow) {
      reasons.push(
        daysFromSoc <= 0
          ? `Encounter ${Math.abs(daysFromSoc)} day(s) before SOC — within the 90-day window.`
          : `Encounter ${daysFromSoc} day(s) after SOC — within the 30-day window.`,
      );
    } else {
      reasons.push(
        daysFromSoc < -F2F_WINDOW_BEFORE_DAYS
          ? `Encounter ${Math.abs(daysFromSoc)} days before SOC exceeds the 90-day window.`
          : `Encounter ${daysFromSoc} days after SOC exceeds the 30-day window.`,
      );
    }
  }
  checks.window = { days_from_soc: daysFromSoc, within_window: withinWindow };

  // ── 3. Diagnosis linkage ──
  const reasonText = [
    encounter.clinical_reason,
    ...(Array.isArray(encounter.documented_conditions) ? encounter.documented_conditions : []),
  ].join(" ").toLowerCase();
  const dxTokens = significantTokens(primaryDiagnosis);
  let linked = null;
  if (!primaryDiagnosis) {
    reasons.push("No primary diagnosis supplied to check linkage — needs review.");
  } else if (!reasonText.trim()) {
    linked = false;
    reasons.push("Encounter documents no clinical reason to link to the primary diagnosis.");
  } else if (dxTokens.length === 0) {
    // The diagnosis has no significant (>= 4 char) tokens — e.g. an abbreviation
    // like "CHF". A literal match still counts as linked; otherwise we can't
    // deterministically assess linkage, so route to needs_review rather than
    // hard-failing a potentially-compliant encounter.
    const literal = String(primaryDiagnosis).toLowerCase().trim();
    if (literal && reasonText.includes(literal)) {
      linked = true;
      reasons.push("Encounter substantively links to the primary diagnosis.");
    } else {
      linked = null;
      reasons.push("Primary diagnosis is an abbreviation/short code — diagnosis linkage needs manual review.");
    }
  } else {
    // Word-level matching in BOTH directions:
    //  - a shared 7-char prefix links word forms ("hypertension" ↔
    //    "hypertensive"), so a compliant encounter isn't hard-failed;
    //  - a GENERIC token alone ("failure", "infection") does NOT link, so
    //    "congestive heart failure" can't validate against "acute renal
    //    failure" — require a specific token, two matches, or the acronym.
    const GENERIC_DX_TOKENS = new Set([
      "failure", "syndrome", "infection", "injury", "pain", "weakness",
      "deficiency", "condition", "exacerbation", "problems",
    ]);
    const reasonWords = reasonText.split(/[^a-z0-9]+/).filter(Boolean);
    const wordMatches = (t) =>
      reasonWords.some((w) =>
        w === t ||
        (t.length >= 7 && w.startsWith(t.slice(0, 7))) ||
        (w.length >= 7 && t.startsWith(w.slice(0, 7))),
      );
    const matches = dxTokens.filter(wordMatches);
    const specificMatches = matches.filter((t) => !GENERIC_DX_TOKENS.has(t));
    // Standard clinical acronym of the diagnosis ("congestive heart failure" →
    // "chf"), so an encounter documented with the abbreviation still links.
    const dxWords = String(primaryDiagnosis).toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !["the", "and", "with", "due", "for"].includes(w));
    const acronym = dxWords.map((w) => w[0]).join("");
    const acronymHit = acronym.length >= 2 && reasonWords.includes(acronym);
    linked = specificMatches.length >= 1 || matches.length >= 2 || acronymHit;
    reasons.push(
      linked
        ? "Encounter substantively links to the primary diagnosis."
        : "Encounter does not reference the primary diagnosis (weak medical-necessity linkage).",
    );
  }
  checks.linkage = { linked, diagnosis_tokens: dxTokens };

  // ── 4. Signature ──
  // true = signed; false = extractor saw an UNSIGNED note (needs_review — get
  // it signed before billing); undefined/null = not determinable (informational
  // only, so legacy extractions without the field keep their status).
  const sig = encounter.practitioner_signature_present;
  const signature = sig === true ? true : sig === false ? false : null;
  if (signature === true) {
    reasons.push(`Practitioner signature documented${encounter.signed_date ? ` (signed ${encounter.signed_date})` : ""}.`);
  } else if (signature === false) {
    reasons.push("The F2F note appears UNSIGNED — obtain the practitioner's signature and date before billing (an unsigned note fails medical review).");
  } else {
    reasons.push("Signature presence not determinable from the extraction — verify the F2F note is signed and dated.");
  }
  checks.signature = { present: signature };

  // ── Overall status ──
  const hardFail = eligible === false || withinWindow === false || linked === false;
  const anyUnknown = eligible === null || withinWindow === null || linked === null || signature === false;
  let status;
  if (hardFail) status = "invalid";
  else if (anyUnknown) status = "needs_review";
  else status = "valid";

  return {
    valid: status === "valid",
    status,
    reasons,
    checks,
    days_from_soc: daysFromSoc,
  };
}

/**
 * Map a Referral record (with extracted_data) onto validateFaceToFace input.
 * Pure — used by the referral analyzer so the UI wiring is a tested transform.
 * Returns null when the referral carries no F2F block at all.
 * @param {Object} referral  Referral entity record
 */
export function referralToF2FInput(referral) {
  if (!referral) return null;
  // Accept BOTH shapes: a Referral entity (extraction nested under
  // extracted_data) AND the raw extraction object passed straight from
  // ReferralPDFSummarizer (face_to_face / diagnoses / admission_details at the
  // top level). Fall back to the referral itself as the extraction root.
  const ex = referral.extracted_data || referral;
  const f2f = ex.face_to_face || {};
  const hasAny = f2f.encounter_date || f2f.practitioner_name || f2f.practitioner_type || f2f.clinical_reason;
  if (!hasAny) return null;
  const primaryDiagnosis =
    referral.diagnosis || ex?.diagnoses?.primary_diagnosis || ex?.diagnoses?.primary_icd10 || "";
  return {
    encounter: {
      encounter_date: f2f.encounter_date,
      practitioner_name: f2f.practitioner_name,
      practitioner_type: f2f.practitioner_type,
      clinical_reason: f2f.clinical_reason,
      documented_conditions: f2f.documented_conditions,
      practitioner_signature_present: f2f.practitioner_signature_present,
      signed_date: f2f.signed_date,
    },
    socDate: referral.estimated_start_date || ex?.admission_details?.admission_date,
    primaryDiagnosis,
  };
}

/**
 * Build a FaceToFaceEncounter entity create payload from an encounter + its
 * validation result. Only maps onto fields the entity defines.
 */
export function toFaceToFaceEncounter({ referralId, patientId, encounter = {}, socDate, primaryDiagnosis }, validation) {
  return {
    ...(referralId ? { referral_id: referralId } : {}),
    ...(patientId ? { patient_id: patientId } : {}),
    ...(encounter.encounter_date ? { encounter_date: encounter.encounter_date } : {}),
    ...(encounter.practitioner_name ? { practitioner_name: encounter.practitioner_name } : {}),
    ...(validation.checks.practitioner.credential ? { practitioner_credential: validation.checks.practitioner.credential } : {}),
    ...(validation.checks.practitioner.eligible != null ? { eligible_practitioner: validation.checks.practitioner.eligible } : {}),
    ...(encounter.clinical_reason ? { clinical_reason: encounter.clinical_reason } : {}),
    ...(Array.isArray(encounter.documented_conditions) ? { documented_conditions: encounter.documented_conditions } : {}),
    ...(primaryDiagnosis ? { primary_diagnosis: primaryDiagnosis } : {}),
    ...(socDate ? { soc_date: socDate } : {}),
    ...(validation.days_from_soc != null ? { days_from_soc: validation.days_from_soc } : {}),
    ...(validation.checks.window.within_window != null ? { within_window: validation.checks.window.within_window } : {}),
    ...(validation.checks.linkage.linked != null ? { diagnosis_linked: validation.checks.linkage.linked } : {}),
    validation_status: validation.status,
    validation_reasons: validation.reasons,
    source: "referral_document",
  };
}
