// Documentation-impact reimbursement math.
//
// Computes the PDGM 30-day period payment for a set of case-mix variables using
// the SAME formula as the canonical backend `calculatePDGM`
// (base44/functions/calculatePDGM/entry.ts) and the FE rate mirror in
// `pdgmRates.js` — so a "before vs after documentation" comparison shows the same
// dollars the rest of the app would, only the delta moving.
//
//   caseMixWeight = clinicalWeight × functionalMultiplier × comorbidityMultiplier
//   adjustedBase  = basePaymentRate × (laborShare × wageIndex + (1 − laborShare))
//   payment       = adjustedBase × caseMixWeight
//
// This is for the ADMIN-ONLY documentation-impact / ROI view, NOT billing. It never
// fabricates: an unknown clinical group / level returns an incomplete result.

import { DEFAULT_PDGM_RATES } from "./pdgmRates.js";

const round = (n, dp = 2) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Case-mix variables shared by a period; documentation typically moves
 *  functionalLevel and comorbidityLevel (and sometimes clinicalGroup). */
export function computePeriodReimbursement(
  { clinicalGroup, admissionSource = "community", timing = "early", functionalLevel, comorbidityLevel },
  rates = DEFAULT_PDGM_RATES,
  wageIndex = 1.0,
) {
  const sourceTimingKey = `${admissionSource}_${timing}`; // e.g. "community_early"
  const groupWeights = rates?.clinicalGroupWeights?.[clinicalGroup];
  const clinicalWeight = groupWeights?.[sourceTimingKey];
  const functionalMultiplier = rates?.functionalMultipliers?.[sourceTimingKey]?.[functionalLevel];
  const comorbidityMultiplier = rates?.comorbidityMultipliers?.[sourceTimingKey]?.[comorbidityLevel];

  if (![clinicalWeight, functionalMultiplier, comorbidityMultiplier].every((n) => Number.isFinite(n))) {
    return null; // unknown combination — reported as incomplete, never guessed
  }

  const caseMixWeight = clinicalWeight * functionalMultiplier * comorbidityMultiplier;
  const base = Number.isFinite(rates?.basePaymentRate) ? rates.basePaymentRate : DEFAULT_PDGM_RATES.basePaymentRate;
  // Fall back to the canonical CY2026 labor share (≈0.7676), not 1.0 — a 1.0
  // fallback would silently apply the full wage index and overstate the payment
  // when a caller passes rates without a laborShare.
  const laborShare = Math.min(1, Math.max(0, Number.isFinite(rates?.laborShare) ? rates.laborShare : DEFAULT_PDGM_RATES.laborShare));
  const wi = Number.isFinite(wageIndex) ? wageIndex : 1.0;
  const adjustedBase = round(base * (laborShare * wi + (1 - laborShare)));
  const payment = round(adjustedBase * caseMixWeight);

  return {
    clinicalWeight: round(clinicalWeight, 4),
    functionalMultiplier: round(functionalMultiplier, 4),
    comorbidityMultiplier: round(comorbidityMultiplier, 4),
    caseMixWeight: round(caseMixWeight, 4),
    adjustedBase,
    payment,
  };
}

/**
 * Before/after documentation impact. `before` and `after` are case-mix variable
 * sets (same shape as computePeriodReimbursement). Returns the two period results
 * plus the dollar/weight delta. `complete` is false when either side can't be
 * computed (so the UI shows "incomplete", not a fabricated number).
 */
export function computeImpact(before, after, rates = DEFAULT_PDGM_RATES, wageIndex = 1.0) {
  const b = computePeriodReimbursement(before, rates, wageIndex);
  const a = computePeriodReimbursement(after, rates, wageIndex);
  if (!b || !a) return { before: b, after: a, complete: false };

  const paymentDelta = round(a.payment - b.payment);
  const weightDelta = round(a.caseMixWeight - b.caseMixWeight, 4);
  const paymentPct = b.payment ? round((paymentDelta / b.payment) * 100, 1) : null;
  return { before: b, after: a, paymentDelta, weightDelta, paymentPct, complete: true };
}

const GROUP_KEYS = Object.keys(DEFAULT_PDGM_RATES.clinicalGroupWeights);
const gnorm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const GROUP_BY_NORM = new Map(GROUP_KEYS.map((k) => [gnorm(k), k]));
// Display-name / abbreviation aliases for a record's clinical group → pdgmRates key.
const GROUP_ALIASES = {
  mmtacardiacandcirculatory: "MMTA_Cardiac_Circulatory",
  cardiacandcirculatory: "MMTA_Cardiac_Circulatory",
  cardiac: "MMTA_Cardiac_Circulatory",
  mmtarespiratory: "MMTA_Respiratory",
  respiratory: "MMTA_Respiratory",
  mmtaendocrine: "MMTA_Endocrine",
  endocrine: "MMTA_Endocrine",
  mmtagastrointestinaltractandgenitourinarysystem: "MMTA_GI_GU",
  mmtagigu: "MMTA_GI_GU",
  gigu: "MMTA_GI_GU",
  mmtainfectiousdiseaseneoplasmsandbloodformingdiseases: "MMTA_Infectious_Disease",
  infectiousdisease: "MMTA_Infectious_Disease",
  mmtasurgicalaftercare: "MMTA_Surgical_Aftercare",
  surgicalaftercare: "MMTA_Surgical_Aftercare",
  mmtaother: "MMTA_Other",
  neurorehabilitation: "MMTA_Neuro_Rehab",
  neurorehab: "MMTA_Neuro_Rehab",
  wound: "MMTA_Wounds",
  wounds: "MMTA_Wounds",
  complexnursinginterventions: "MMTA_Complex_Nursing",
  complexnursing: "MMTA_Complex_Nursing",
  behavioralhealth: "MMTA_Behavioral_Health",
  medicationmanagement: "MMTA_Medication_Management",
  musculoskeletalrehabilitation: "MMTA_Musculoskeletal",
  musculoskeletal: "MMTA_Musculoskeletal",
};

/**
 * Best-effort map a stored OASIS `pdgm_data` object to the scenario variables this
 * module computes on. Only fields that map cleanly are returned (so the caller can
 * pre-fill a "before" scenario and leave the rest for the user to confirm). Never
 * guesses a value it can't recognize. Pure.
 */
export function normalizePdgmDataToScenario(pdgmData) {
  if (!pdgmData || typeof pdgmData !== "object") return {};
  const out = {};

  const rawGroup = pdgmData.clinical_group ?? pdgmData.clinical_grouping;
  if (rawGroup != null) {
    const key = GROUP_BY_NORM.get(gnorm(rawGroup)) || GROUP_ALIASES[gnorm(rawGroup)];
    if (key) out.clinicalGroup = key;
  }

  const src = String(pdgmData.admission_source || "").toLowerCase();
  if (src.startsWith("inst")) out.admissionSource = "institutional";
  else if (src.startsWith("comm")) out.admissionSource = "community";

  const tim = String(pdgmData.episode_timing || pdgmData.timing || "").toLowerCase();
  if (tim.startsWith("early")) out.timing = "early";
  else if (tim.startsWith("late")) out.timing = "late";

  const fn = String(pdgmData.functional_level ?? pdgmData.functional_impairment_level ?? "").toLowerCase();
  if (fn.startsWith("low")) out.functionalLevel = "low";
  else if (fn.startsWith("med")) out.functionalLevel = "medium";
  else if (fn.startsWith("high")) out.functionalLevel = "high";

  const co = String(pdgmData.comorbidity_adjustment ?? pdgmData.comorbidity_level ?? "").toLowerCase();
  if (co.startsWith("high")) out.comorbidityLevel = "high";
  else if (co.startsWith("low")) out.comorbidityLevel = "low";
  else if (co.startsWith("no")) out.comorbidityLevel = "none";

  return out;
}
