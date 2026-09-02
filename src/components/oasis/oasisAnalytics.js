// Pure aggregation helpers for the OASIS analytics dashboard.
//
// Extracted from the OASISAnalyzer page (which was a ~3k-line mega-component)
// so the data-shaping logic is reusable and unit-testable in isolation, with
// the page left to do only rendering. Behaviour is intentionally identical to
// the previous inline useMemo blocks.

// Relative import (not the "@/" alias) so this pure module stays loadable by
// the node --test runner, which doesn't resolve Vite aliases.
import { computeAge } from "../../lib/age.js";
import { formatLocalDate } from "../../lib/dateLocal.js";

import { RESPONSE_SCHEMA_V2_CMS_E2 } from "./responseSchema/registry.js";
export { computeAge };
/** @param {any[]} uploads */
export function aggregateDemographics(uploads = []) {
  const genderCount = { Male: 0, Female: 0, Unknown: 0 };
  const ageRanges = { "0-64": 0, "65-74": 0, "75-84": 0, "85+": 0, Unknown: 0 };

  uploads.forEach((upload) => {
    const gender = (upload.pdgm_data?.patient_info?.gender || "Unknown").toLowerCase();
    // Check female FIRST: "female" contains an "m", so testing includes("m")
    // before "f" miscounts every female as male — a latent bug in the original
    // inline version this was extracted from, surfaced by the unit tests.
    if (gender.includes("f")) genderCount.Female++;
    else if (gender.includes("m")) genderCount.Male++;
    else genderCount.Unknown++;

    const dob = upload.pdgm_data?.patient_info?.dob;
    const age = computeAge(dob);
    // An unparseable dob yields NaN; every `age < N` test is false, so without
    // this guard it would silently fall through to "85+" instead of "Unknown".
    if (!Number.isFinite(age)) ageRanges.Unknown++;
    else if (age < 65) ageRanges["0-64"]++;
    else if (age < 75) ageRanges["65-74"]++;
    else if (age < 85) ageRanges["75-84"]++;
    else ageRanges["85+"]++;
  });

  return {
    gender: Object.entries(genderCount).map(([name, value]) => ({ name, value })),
    age: Object.entries(ageRanges).map(([name, value]) => ({ name, value })),
  };
}

/** Top primary diagnoses by frequency. @param {any[]} uploads */
export function aggregateTopDiagnoses(uploads = [], limit = 10) {
  const diagnosisCount = {};
  uploads.forEach((upload) => {
    const primaryDx = upload.pdgm_data?.primary_diagnosis || upload.pdgm_data?.primary_diagnosis_description;
    if (primaryDx && primaryDx !== "Unknown" && primaryDx !== "Not found") {
      const dxKey = primaryDx.substring(0, 50); // Truncate for display
      diagnosisCount[dxKey] = (diagnosisCount[dxKey] || 0) + 1;
    }
  });
  return Object.entries(diagnosisCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Functional scores over time (most recent `limit`).
 *
 * NOT a CMS-labeled measure. These uploads carry AI-extracted values from an
 * OASIS document the agency completed in its EMR, so they are evidence of what
 * the document said — never an official response, and never CMS-scorable.
 *
 * Two things changed. A missing score used to become `0` via `|| 0`, which on
 * every OASIS functional scale reads as MAXIMUM INDEPENDENCE — so an
 * incompletely extracted upload plotted as a fully independent patient. It is
 * now `null`, which charts as a gap. And uploads whose derived values came from
 * a legacy or unknown response schema are excluded with a visible count rather
 * than mixed into the same series.
 *
 * @param {any[]} uploads
 * @returns {{ points: any[], excluded: number, excluded_reason: string }}
 */
export function aggregateFunctionalScores(uploads = [], limit = 20) {
  const usable = [];
  let excluded = 0;
  for (const u of uploads) {
    if (!u.assessment_date || !u.pdgm_data?.functional_scores) continue;
    // A derived value with no response schema means whatever PennSync's old
    // option list meant; it cannot share an axis with a v2 value. ABSENT counts
    // as unknown — per `OASISUpload.response_schema_id`, "absent means
    // legacy/unknown" — so the check is an equality against v2, not a
    // "present and different" test. Before cutover that empties this chart,
    // which is the honest state: the excluded count and reason say why.
    if (u.response_schema_id !== RESPONSE_SCHEMA_V2_CMS_E2) { excluded += 1; continue; }
    usable.push(u);
  }
  const num = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  };
  const points = usable
    .sort((a, b) => new Date(a.assessment_date) - new Date(b.assessment_date))
    .slice(-limit)
    .map((upload) => ({
      // formatLocalDate avoids the UTC-midnight day-shift for bare ISO dates
      // (the pitfall computeAge documents above).
      date: formatLocalDate(upload.assessment_date),
      ambulation: num(upload.pdgm_data?.functional_scores?.m1860_ambulation),
      transferring: num(upload.pdgm_data?.functional_scores?.m1850_transferring),
      bathing: num(upload.pdgm_data?.functional_scores?.m1830_bathing),
      patient: upload.patient_name?.substring(0, 15) || "Unknown",
    }));
  return {
    points,
    excluded,
    excluded_reason: excluded
      ? `${excluded} upload(s) excluded: derived values use a response set PennSync cannot verify.`
      : "",
  };
}

/** PDGM payment trends (most recent `limit` with a payment). @param {any[]} uploads */
export function aggregatePaymentTrends(uploads = [], limit = 15) {
  return uploads
    .filter((u) => u.assessment_date && u.estimated_payment)
    .sort((a, b) => new Date(a.assessment_date) - new Date(b.assessment_date))
    .slice(-limit)
    .map((upload) => ({
      date: formatLocalDate(upload.assessment_date),
      payment: upload.estimated_payment,
      patient: upload.patient_name?.substring(0, 15) || "Unknown",
    }));
}

/** Headline summary statistics. @param {any[]} uploads */
export function computeSummaryStats(uploads = []) {
  const totalAssessments = uploads.length;
  const avgScore = uploads.reduce((sum, u) => sum + (u.scores?.overall || 0), 0) / totalAssessments || 0;
  const paid = uploads.filter((u) => u.estimated_payment);
  const avgPayment = paid.reduce((sum, u) => sum + u.estimated_payment, 0) / paid.length || 0;
  const totalRevenue = uploads.reduce((sum, u) => sum + (u.estimated_payment || 0), 0);
  return { totalAssessments, avgScore, avgPayment, totalRevenue };
}
