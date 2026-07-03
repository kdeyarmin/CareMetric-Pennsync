// Revenue-impact estimates for referral follow-up items — ADMIN-ONLY module.
//
// ── Visibility policy (deliberate) ────────────────────────────────────────────
// Everything this module produces is money. Per agency policy, revenue figures
// are shown ONLY to admin-level users (isAdminView) and NEVER to nurses:
//   - callers must gate rendering on isAdminView(user);
//   - output is NEVER persisted to the Referral entity (assigned nurses can
//     read their referral rows) — compute on demand in admin UI only;
//   - nothing from this module goes on the provider form or into any
//     nurse-facing surface (OASIS flow, SmartNote, patient chart).
// The follow-up engine itself stays money-free so nurse-visible surfaces can
// use it safely; this module layers the dollars on top for admins.
//
// ── Estimation policy ─────────────────────────────────────────────────────────
// Same rule as everything PDGM in this repo: no invented numbers. Estimates
// are derived ONLY from the agency's own loaded rate tables (PDGMRateConfig
// merged over the documented defaults) and are labeled estimates. National
// unadjusted amounts — the wage-index adjustment applied by calculatePDGM is
// intentionally not replicated here to avoid a second competing methodology.
//
// Pure + offline (unit-tested with `node --test`).

import { DEFAULT_PDGM_RATES, mergePdgmRates } from "../pdgm/pdgmRates.js";

const round = (n) => Math.round(n);

/**
 * Estimate the revenue consequence of each follow-up item.
 *
 * @param {object} plan  buildFollowUpPlan() result ({ items, coding })
 * @param {object} [opts] { rates } — saved PDGMRateConfig.rates (merged over defaults)
 * @returns {{
 *   isEstimate: true,
 *   perItem: Object<string, {type:'at_risk'|'upside', low:number, high:number, note:string}>,
 *   totalAtRisk: number, totalUpsideLow: number, totalUpsideHigh: number,
 * }} perItem is keyed by item.id; items with no defensible estimate are omitted.
 */
export function estimateFollowUpRevenueImpact(plan, opts = {}) {
  const rates = mergePdgmRates(opts.rates, opts.defaults || DEFAULT_PDGM_RATES);
  const base = rates.basePaymentRate;
  const coding = plan?.coding;
  const bucket = coding?.scenario?.bucket || "community_early";
  const perItem = {};

  // Weighted period value when we know the primary's clinical group; base rate
  // alone when we don't (weight unknown ≠ zero).
  const groupKey = coding?.primary?.clinicalGroupKey || null;
  const groupWeight = groupKey ? rates.clinicalGroupWeights?.[groupKey]?.[bucket] : null;
  const periodValue = typeof groupWeight === "number" ? base * groupWeight : base;

  // Condition-of-payment gaps put the whole 30-day period at risk.
  const AT_RISK_RULES = new Set([
    "f2f_missing",
    "f2f_invalid",
    "orders_missing",
    "homebound_undocumented",
    "certifier_missing",
    "insurance_missing",
    "no_icd_codes",
    "no_acceptable_primary",
    "frequency_missing", // visit-level denials; period value is the ceiling
  ]);

  const comorb = rates.comorbidityMultipliers?.[bucket];
  const funcMult = rates.functionalMultipliers?.[bucket];

  for (const item of plan?.items || []) {
    if (AT_RISK_RULES.has(item.id)) {
      perItem[item.id] = {
        type: "at_risk",
        low: round(periodValue),
        high: round(periodValue),
        note:
          item.id === "frequency_missing"
            ? "Up to the full 30-day period exposed to visit-level denials (estimate, national unadjusted)."
            : "Full 30-day period payment at risk until resolved (estimate, national unadjusted).",
      };
      continue;
    }

    if ((item.id === "uncoded_diagnoses" || item.id === "comorbidities_uncaptured") && comorb) {
      const low = periodValue * (comorb.low - comorb.none);
      const high = periodValue * (comorb.high - comorb.none);
      if (high > 0) {
        perItem[item.id] = {
          type: "upside",
          low: round(low),
          high: round(high),
          note: "Potential comorbidity adjustment if the coded conditions qualify (estimate).",
        };
      }
      continue;
    }

    if (item.id === "functional_detail_missing" && funcMult) {
      const span = periodValue * (funcMult.high - funcMult.low);
      if (span > 0) {
        perItem[item.id] = {
          type: "upside",
          low: 0,
          high: round(span),
          note: "Functional-level spread (low→high) if documentation supports the real burden (estimate).",
        };
      }
      continue;
    }

    if (item.id === "institutional_dates_missing" && groupKey) {
      const weights = rates.clinicalGroupWeights?.[groupKey];
      const instW = weights?.institutional_early;
      const commW = weights?.community_early;
      if (typeof instW === "number" && typeof commW === "number" && instW > commW) {
        const delta = base * (instW - commW);
        perItem[item.id] = {
          type: "upside",
          low: round(delta),
          high: round(delta),
          note: "Institutional vs community admission-source weight difference for this clinical group (estimate).",
        };
      }
      continue;
    }
    // unspecified_primary, medications_missing, AI additions: no defensible
    // dollar figure — omitted rather than guessed.
  }

  let totalAtRisk = 0;
  let totalUpsideLow = 0;
  let totalUpsideHigh = 0;
  for (const v of Object.values(perItem)) {
    if (v.type === "at_risk") {
      // Overlapping exposure: several gaps put the SAME period at risk, so the
      // total is the max, not the sum.
      totalAtRisk = Math.max(totalAtRisk, v.high);
    } else {
      totalUpsideLow += v.low;
      totalUpsideHigh += v.high;
    }
  }

  return { isEstimate: true, perItem, totalAtRisk, totalUpsideLow, totalUpsideHigh };
}

/** Compact "$1,234" formatting for admin badges. */
export function fmtUsd(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
