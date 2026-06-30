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
  const laborShare = Math.min(1, Math.max(0, Number.isFinite(rates?.laborShare) ? rates.laborShare : 1));
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
