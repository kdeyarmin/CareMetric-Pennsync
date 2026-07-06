// PPH (Potentially Preventable Hospitalization) prevention worklist engine.
//
// The app had strong per-patient rehospitalization risk prediction, but it was
// ad-hoc and not pointed at the measure that matters. This re-points that scoring
// onto the highest-weighted HHVBP measure (~26%) — Within-Stay Potentially
// Preventable Hospitalization — plus the DTC-PAC 31-day window, producing an
// AGENCY-WIDE RANKED worklist that drives front-loaded visits / MD contact / med
// review, and captures the intervention + outcome back to PatientOutcomeMetric.
//
// The per-patient risk scoring mirrors RehospitalizationPredictor.jsx (extracted
// here so it is deterministic and unit-tested with `node --test`).

import { parseLocalDate } from "../../lib/dateLocal.js";

export const DTC_PAC_WINDOW_DAYS = 31; // Discharge-to-Community post-acute window
export const PPH_MEASURE = "within_stay_pph";

const BASELINE_RISK = 15;
const RISK_CAP = 95;

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute a patient's PPH risk from OASIS/PDGM + visit adherence. Mirrors the
 * RehospitalizationPredictor factor weights.
 *
 * @param {Object} input
 * @param {Array}  [input.oasis]   patient's OASIS records (uses [0].pdgm_data)
 * @param {Array}  [input.visits]  patient's visits
 * @returns {{ score:number, level:string, factors:Array<{factor,impact}> }}
 */
export function computePphRisk({ oasis = [], visits = [] } = {}) {
  let base = BASELINE_RISK;
  const factors = [];
  const latest = oasis[0];
  const pdgm = latest?.pdgm_data;

  if (pdgm) {
    const fs = pdgm.functional_scores || {};
    if (pdgm.admission_source === "institutional") {
      base += 25;
      factors.push({ factor: "Recent hospitalization/SNF stay", impact: 25 });
    }
    const totalFunctional = toNum(fs.m1860_ambulation) + toNum(fs.m1850_transferring) + toNum(fs.m1830_bathing);
    if (totalFunctional >= 12) {
      base += 20;
      factors.push({ factor: "Severe functional impairment", impact: 20 });
    } else if (totalFunctional >= 8) {
      base += 12;
      factors.push({ factor: "Moderate functional impairment", impact: 12 });
    }
    const dx = String(pdgm.primary_diagnosis || "").toLowerCase();
    if (dx.includes("heart failure") || dx.includes("chf")) {
      base += 18;
      factors.push({ factor: "CHF/Heart Failure", impact: 18 });
    }
    if (dx.includes("copd") || dx.includes("respiratory")) {
      base += 15;
      factors.push({ factor: "COPD/Respiratory condition", impact: 15 });
    }
    if (dx.includes("diabetes") && dx.includes("complication")) {
      base += 12;
      factors.push({ factor: "Diabetes with complications", impact: 12 });
    }
    const comorbidities = pdgm.comorbidities?.length || 0;
    if (comorbidities >= 5) {
      base += 15;
      factors.push({ factor: "Multiple comorbidities (5+)", impact: 15 });
    } else if (comorbidities >= 3) {
      base += 8;
      factors.push({ factor: "Multiple comorbidities", impact: 8 });
    }
  }

  const scheduled = visits.filter((v) => v.status === "scheduled").length;
  const completed = visits.filter((v) => v.status === "completed").length;
  if (scheduled > 0 && completed < scheduled * 0.7) {
    base += 10;
    factors.push({ factor: "Low visit adherence", impact: 10 });
  }

  const score = Math.min(RISK_CAP, base);
  const level = score >= 50 ? "high" : score >= 30 ? "medium" : "low";
  return { score, level, factors: factors.sort((a, b) => b.impact - a.impact) };
}

/** Days since admission (episode age), or null when unknown. */
export function daysInEpisode(patient, asOf) {
  const start = patient?.admission_date ? parseLocalDate(patient.admission_date) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  const now = asOf ? parseLocalDate(asOf) : new Date();
  if (!now || Number.isNaN(now.getTime())) return null;
  return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

// Factor → targeted interventions. The three HHVBP-driving actions (front-loaded
// visits, MD contact, med review) are always included for high-risk patients.
const FACTOR_INTERVENTIONS = {
  "Recent hospitalization/SNF stay": ["Front-load visits in the first 2 weeks", "Medication reconciliation within 48h", "Confirm the follow-up MD appointment"],
  "Severe functional impairment": ["PT/OT evaluation", "Fall-prevention plan + front-loaded visits"],
  "Moderate functional impairment": ["PT/OT evaluation"],
  "CHF/Heart Failure": ["Daily weight monitoring; MD contact on 2+ lb overnight gain", "Diuretic/medication review", "Low-sodium diet teaching"],
  "COPD/Respiratory condition": ["Inhaler technique + COPD action plan", "O2 saturation monitoring", "MD contact for early exacerbation signs"],
  "Diabetes with complications": ["Glucose monitoring + medication review"],
  "Multiple comorbidities (5+)": ["Comprehensive medication review"],
  "Multiple comorbidities": ["Comprehensive medication review"],
  "Low visit adherence": ["Re-engage the patient and adjust the visit schedule"],
};
const CORE_HIGH_RISK = ["Front-loaded visit schedule", "MD contact / care coordination", "Medication review"];

/** Recommend interventions for a set of risk factors + level. */
export function recommendInterventions(factors = [], level = "low") {
  const out = [];
  const push = (s) => { if (!out.includes(s)) out.push(s); };
  if (level === "high") CORE_HIGH_RISK.forEach(push);
  for (const f of factors) (FACTOR_INTERVENTIONS[f.factor] || []).forEach(push);
  return out;
}

/**
 * Build the agency-wide ranked PPH-prevention worklist.
 *
 * @param {Array} items  [{ patient, oasis, visits }]
 * @param {Object} [opts] { asOf, limit }
 * @returns {Array} ranked worklist entries
 */
export function buildPphWorklist(items = [], opts = {}) {
  const asOf = opts.asOf;
  const entries = [];

  for (const item of items) {
    const patient = item.patient || item; // tolerate a bare patient
    const risk = computePphRisk({ oasis: item.oasis, visits: item.visits });
    const days = daysInEpisode(patient, asOf);
    const withinWindow = days != null && days >= 0 && days <= DTC_PAC_WINDOW_DAYS;
    const status = String(patient.status || "active").toLowerCase();
    const withinStay = status !== "discharged" && status !== "deceased";

    // Priority: risk first, with a boost while the DTC-PAC window is still open
    // (front-loading has the most leverage early in the episode).
    const priorityScore = risk.score + (withinWindow ? 15 : 0) + (withinStay ? 0 : -30);
    const priority = priorityScore >= 65 ? "urgent" : priorityScore >= 45 ? "high" : priorityScore >= 30 ? "moderate" : "watch";

    entries.push({
      patient_id: patient.id,
      patient_name: `${patient.first_name || ""} ${patient.last_name || ""}`.trim() || "Patient",
      risk_score: risk.score,
      risk_level: risk.level,
      factors: risk.factors,
      days_in_episode: days,
      within_dtc_pac_window: withinWindow,
      within_stay: withinStay,
      priority,
      priority_score: priorityScore,
      interventions: recommendInterventions(risk.factors, risk.level),
      measure: PPH_MEASURE,
    });
  }

  entries.sort((a, b) => b.priority_score - a.priority_score || b.risk_score - a.risk_score);
  return typeof opts.limit === "number" ? entries.slice(0, opts.limit) : entries;
}

/**
 * Capture the intervention + outcome back to PatientOutcomeMetric. Returns a
 * create/update payload for the entity (only fields it defines).
 *
 * @param {Object} entry  a worklist entry
 * @param {Object} outcome { rehospitalized, erVisit, interventionsPerformed, episodeStart }
 */
export function toPphOutcomeUpdate(entry, outcome = {}) {
  const { rehospitalized, erVisit, interventionsPerformed, episodeStart } = outcome;
  return {
    patient_id: entry.patient_id,
    ...(episodeStart ? { episode_start: episodeStart } : {}),
    readmission_30_day: !!rehospitalized,
    er_visit_30_day: !!erVisit,
    pph_prevention: {
      risk_score: entry.risk_score,
      risk_level: entry.risk_level,
      within_dtc_pac_window: entry.within_dtc_pac_window,
      interventions: Array.isArray(interventionsPerformed) ? interventionsPerformed : entry.interventions,
      rehospitalized: !!rehospitalized,
      measure: PPH_MEASURE,
    },
  };
}
