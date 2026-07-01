// Face-to-Face (F2F) encounter validator — 42 CFR 424.22.
//
// A missing or non-compliant F2F is a top auto-reject denial cause the app
// catches nowhere today (F2F only appears in help text). This validates the F2F
// encounter extracted from the UPLOADED REFERRAL document. It is deliberately
// scoped to referral intake — F2F is NOT part of the nurse's Smart Note or the
// patient chart (see the task spec / FaceToFaceEncounter entity comment).
//
// Three deterministic checks:
//   1. Eligible certifying practitioner (physician or allowed NPP).
//   2. Timing window — within 90 days BEFORE or 30 days AFTER the start of care.
//   3. Substantive linkage to the primary (home-health-qualifying) diagnosis.
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

const STOPWORDS = new Set([
  "the", "and", "with", "without", "for", "due", "chronic", "acute", "unspecified",
  "disease", "disorder", "history", "of", "type", "left", "right", "other", "care",
  "status", "post", "stage", "primary", "secondary", "encounter", "patient",
]);

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse the first recognizable credential token out of a free-text string. */
export function parseCredential(str) {
  const tokens = String(str || "")
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter(Boolean);
  for (const t of tokens) {
    if (ELIGIBLE_CREDENTIALS.includes(t)) return { credential: t.toUpperCase(), eligible: true };
  }
  for (const t of tokens) {
    if (INELIGIBLE_CREDENTIALS.includes(t)) return { credential: t.toUpperCase(), eligible: false };
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
  const credSource = encounter.practitioner_credential || encounter.practitioner_type || encounter.practitioner_name || "";
  const { credential, eligible } = parseCredential(credSource);
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
    linked = dxTokens.some((t) => reasonText.includes(t));
    reasons.push(
      linked
        ? "Encounter substantively links to the primary diagnosis."
        : "Encounter does not reference the primary diagnosis (weak medical-necessity linkage).",
    );
  }
  checks.linkage = { linked, diagnosis_tokens: dxTokens };

  // ── Overall status ──
  const hardFail = eligible === false || withinWindow === false || linked === false;
  const anyUnknown = eligible === null || withinWindow === null || linked === null;
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
