// Medicare home-health eligibility snapshot from the uploaded referral.
//
// Deterministic presence-level checks over the extracted referral data for the
// coverage criteria a Medicare (or Medicare Advantage) admission must satisfy:
//
//   1. Qualifying skilled service ordered — intermittent skilled nursing, PT,
//      or SLP (OT alone does not ESTABLISH initial eligibility; it can continue
//      it) — SSA §1861(m), 42 CFR 409.42(c).
//   2. Homebound support documented — 42 CFR 409.42(a); the referral rarely
//      carries the full narrative, so absence is "confirm at SOC", not a fail.
//   3. Face-to-Face encounter — 42 CFR 424.22(a)(1)(v); consumed from the
//      deterministic faceToFaceValidator result, never re-derived here.
//   4. Physician/allowed-practitioner orders & certification source —
//      42 CFR 409.43, 424.22.
//   5. "Intermittent" nursing bound — daily SN beyond 21 days needs a finite,
//      predictable endpoint (SSA §1861(m)); checked against the parsed ordered
//      frequencies.
//
// This is a referral-time TRIAGE snapshot for intake staff — the authoritative
// eligibility determination happens at SOC with the OASIS comprehensive
// assessment. Pure + offline (unit-tested with `node --test`); no React, no
// `@/` imports so the colocated Node test resolves without Vite.

import { classifyPayer, collectOrderedFrequencies } from "./visitPlanEstimator.js";

export const CRITERION_STATUS = {
  MET: "met",
  NEEDS_REVIEW: "needs_review",
  NOT_MET: "not_met",
};

const SN_SERVICE = /\b(?:sn|s\/n|rn|lpn|lvn|skilled\s+nursing|nursing|nurse|wound\s+care|medication\s+management|med\s+(?:management|teaching)|injection|infusion|\biv\b|catheter|foley|ostomy|trach|picc)\b/i;
const PT_SERVICE = /\b(?:pt|physical\s+therap\w*|gait\s+training)\b/i;
const ST_SERVICE = /\b(?:slp|speech(?:[-\s](?:therap\w*|language\s+patholog\w*|patholog\w*))|\bst\b(?!\.)|swallow(?:ing)?\s+(?:therap|eval)\w*|dysphagia\s+(?:therap|treatment)\w*)/i;
const OT_SERVICE = /\b(?:ot|occupational\s+therap\w*)\b/i;

const HOMEBOUND_SUPPORT =
  /\bhomebound\b|confined\s+to\s+(?:the\s+)?(?:home|house|residence)|unable\s+to\s+leave\s+(?:the\s+)?home|taxing\s+effort|considerable\s+(?:and\s+taxing\s+)?effort|bed\s*bound|bedfast|chair\s*fast|wheelchair[\s-]*(?:bound|dependent)|non[\s-]*ambulatory|max(?:imal)?\s+assist\w*\s+(?:for|with|to)\s+ambulat\w*|requires\s+assist\w*\s+(?:of\s+\w+\s+)?to\s+leave/i;

/** Collect the text fields a criterion scan may read (never the whole doc). */
function fieldText(ex, paths) {
  const out = [];
  for (const path of paths) {
    let cur = ex;
    for (const key of path.split(".")) {
      if (cur == null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = cur[key];
    }
    if (cur == null) continue;
    if (Array.isArray(cur)) out.push(...cur.map((v) => String(v ?? "")));
    else if (typeof cur === "object") out.push(...Object.values(cur).map((v) => (typeof v === "string" ? v : "")));
    else out.push(String(cur));
  }
  return out.join(" \n ");
}

/**
 * Assess the Medicare home-health coverage criteria supported by a referral.
 *
 * @param {object} referralData extracted referral data (full extraction,
 *   quick-scan, or Referral entity shape)
 * @param {object|null} f2fValidation result of validateFaceToFace() for this
 *   referral, or null when the referral documents no F2F encounter at all
 * @returns {{
 *   applicable: boolean, payer: object,
 *   criteria: Array<{key:string, label:string, status:string, detail:string, citation:string}>,
 *   overall: 'supported'|'needs_review'|'gaps',
 *   missingForAdmission: string[],
 * }}
 */
export function assessMedicareEligibility(referralData, f2fValidation = null) {
  const ex = referralData?.extracted_data || referralData || {};
  const payer = classifyPayer(referralData);
  // Medicare Advantage applies the same coverage criteria as FFS; for other
  // payers the snapshot still renders as reference, flagged not-applicable.
  const applicable = payer.payer === "medicare_ffs" || payer.payer === "medicare_advantage";
  const criteria = [];
  const missingForAdmission = [];

  // ── 1. Qualifying skilled service ──
  const serviceText = fieldText(ex, [
    "skilled_needs.services_ordered",
    "skilled_needs.specific_interventions",
    "skilled_needs.frequency_duration",
    "orders_treatments.physician_orders",
    "orders_treatments.treatments",
    "referral_reason",
    "admission_details.referral_reason",
    "skilled_nursing_needs",
    "therapy_requirements",
  ]);
  const hasSN = SN_SERVICE.test(serviceText);
  const hasPT = PT_SERVICE.test(serviceText);
  const hasST = ST_SERVICE.test(serviceText);
  const hasOT = OT_SERVICE.test(serviceText);
  if (hasSN || hasPT || hasST) {
    const named = [hasSN && "skilled nursing", hasPT && "PT", hasST && "SLP"].filter(Boolean).join(", ");
    criteria.push({
      key: "skilled_service",
      label: "Qualifying skilled service ordered",
      status: CRITERION_STATUS.MET,
      detail: `Referral documents a qualifying service (${named}).`,
      citation: "42 CFR 409.42(c)",
    });
  } else if (hasOT) {
    criteria.push({
      key: "skilled_service",
      label: "Qualifying skilled service ordered",
      status: CRITERION_STATUS.NEEDS_REVIEW,
      detail:
        "Only occupational therapy is documented — OT alone does not establish initial home-health eligibility (it can continue an episode). Confirm whether SN, PT, or SLP is also needed.",
      citation: "42 CFR 409.42(c)",
    });
    missingForAdmission.push("A qualifying skilled service (SN, PT, or SLP) — OT alone cannot open the episode");
  } else {
    criteria.push({
      key: "skilled_service",
      label: "Qualifying skilled service ordered",
      status: CRITERION_STATUS.NOT_MET,
      detail: "No skilled nursing, PT, or SLP service is documented in the referral orders.",
      citation: "42 CFR 409.42(c)",
    });
    missingForAdmission.push("Ordered skilled service (SN, PT, or SLP) from the referring provider");
  }

  // ── 2. Homebound support ──
  const homeboundText = fieldText(ex, [
    "functional_status",
    "referral_reason",
    "admission_details.referral_reason",
    "oasis_relevant_notes",
    "clinical_info.vital_signs",
    "safety_concerns.high_risk_conditions",
    "medical_history",
  ]);
  if (HOMEBOUND_SUPPORT.test(homeboundText)) {
    criteria.push({
      key: "homebound",
      label: "Homebound status supported",
      status: CRITERION_STATUS.MET,
      detail:
        "Referral text supports homebound status — confirm and document the full narrative (medical reason + taxing effort) at SOC.",
      citation: "42 CFR 409.42(a)",
    });
  } else {
    criteria.push({
      key: "homebound",
      label: "Homebound status supported",
      status: CRITERION_STATUS.NEEDS_REVIEW,
      detail:
        "The referral does not document homebound support. Homebound status must be established and documented at the SOC assessment (medical reason leaving home is contraindicated or requires taxing effort).",
      citation: "42 CFR 409.42(a)",
    });
    missingForAdmission.push("Homebound justification (confirm and document at SOC)");
  }

  // ── 3. Face-to-Face encounter ──
  if (!f2fValidation) {
    criteria.push({
      key: "face_to_face",
      label: "Face-to-Face encounter",
      status: CRITERION_STATUS.NOT_MET,
      detail:
        "No F2F encounter is documented in this referral. A physician/allowed-NPP encounter within 90 days before or 30 days after SOC, related to the primary reason for home health, is a condition of payment.",
      citation: "42 CFR 424.22(a)(1)(v)",
    });
    missingForAdmission.push("Face-to-Face encounter note from the certifying practitioner");
  } else if (f2fValidation.status === "valid") {
    criteria.push({
      key: "face_to_face",
      label: "Face-to-Face encounter",
      status: CRITERION_STATUS.MET,
      detail: "A compliant F2F encounter is documented (see the F2F validation above).",
      citation: "42 CFR 424.22(a)(1)(v)",
    });
  } else if (f2fValidation.status === "invalid") {
    criteria.push({
      key: "face_to_face",
      label: "Face-to-Face encounter",
      status: CRITERION_STATUS.NOT_MET,
      detail: `The documented F2F fails validation: ${f2fValidation.reasons.join(" ")}`,
      citation: "42 CFR 424.22(a)(1)(v)",
    });
    missingForAdmission.push("A compliant Face-to-Face encounter (current one fails validation)");
  } else {
    criteria.push({
      key: "face_to_face",
      label: "Face-to-Face encounter",
      status: CRITERION_STATUS.NEEDS_REVIEW,
      detail: `The documented F2F needs review: ${f2fValidation.reasons.join(" ")}`,
      citation: "42 CFR 424.22(a)(1)(v)",
    });
  }

  // ── 4. Practitioner orders / certification source ──
  const ordersPresent =
    (Array.isArray(ex?.orders_treatments?.physician_orders) && ex.orders_treatments.physician_orders.length > 0) ||
    (Array.isArray(ex?.skilled_needs?.services_ordered) && ex.skilled_needs.services_ordered.length > 0);
  const physicianNamed = Boolean(
    String(ex?.demographics?.referring_physician ?? referralData?.referring_physician ?? "").trim()
  );
  if (ordersPresent && physicianNamed) {
    criteria.push({
      key: "orders",
      label: "Practitioner orders & certification source",
      status: CRITERION_STATUS.MET,
      detail: "Orders and a referring practitioner are documented — obtain the signed plan of care (CMS-485) before billing.",
      citation: "42 CFR 409.43, 424.22",
    });
  } else {
    const gaps = [
      !ordersPresent && "home-health orders",
      !physicianNamed && "the referring/certifying practitioner",
    ].filter(Boolean).join(" and ");
    criteria.push({
      key: "orders",
      label: "Practitioner orders & certification source",
      status: CRITERION_STATUS.NEEDS_REVIEW,
      detail: `The referral does not clearly document ${gaps}. Certification requires a physician/allowed-NPP order and signature.`,
      citation: "42 CFR 409.43, 424.22",
    });
    missingForAdmission.push(
      !ordersPresent && !physicianNamed
        ? "Home-health orders and the certifying practitioner's identity"
        : !ordersPresent
        ? "Home-health orders from the certifying practitioner"
        : "The referring/certifying practitioner's identity"
    );
  }

  // ── 5. Intermittent-care bound on daily nursing ──
  const { orders } = collectOrderedFrequencies(referralData);
  const dailySn = orders.filter((o) => o.discipline === "SN" && o.perWeek === 7);
  const openEndedDaily = dailySn.some((o) => o.weeks == null);
  const dailyDays = dailySn.reduce((sum, o) => sum + (o.weeks ? o.weeks * 7 : 0), 0);
  if (openEndedDaily || dailyDays > 21) {
    criteria.push({
      key: "intermittent",
      label: "Nursing is intermittent",
      status: CRITERION_STATUS.NEEDS_REVIEW,
      detail: openEndedDaily
        ? "Daily skilled nursing is ordered with no end date — Medicare covers daily SN only for a finite and predictable period (generally ≤ 21 days, or with a documented endpoint). Obtain a finite duration or endpoint from the physician."
        : `Daily skilled nursing is ordered for ~${Math.round(dailyDays)} days — beyond 21 days Medicare requires a documented finite, predictable endpoint.`,
      citation: "SSA §1861(m); Medicare Benefit Policy Manual Ch. 7 §40.1.3",
    });
    missingForAdmission.push("A finite, predictable endpoint for the daily skilled-nursing order");
  } else {
    criteria.push({
      key: "intermittent",
      label: "Nursing is intermittent",
      status: CRITERION_STATUS.MET,
      detail:
        dailySn.length > 0
          ? "Daily nursing is bounded within the intermittent-care limit."
          : "Ordered/expected nursing is intermittent (less than daily, or no nursing frequency ordered yet).",
      citation: "SSA §1861(m)",
    });
  }

  const statuses = criteria.map((c) => c.status);
  const overall = statuses.includes(CRITERION_STATUS.NOT_MET)
    ? "gaps"
    : statuses.includes(CRITERION_STATUS.NEEDS_REVIEW)
    ? "needs_review"
    : "supported";

  return { applicable, payer, criteria, overall, missingForAdmission };
}
