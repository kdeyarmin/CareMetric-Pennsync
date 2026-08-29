// Deterministic OASIS pre-checks for the Comprehensive OASIS Review.
//
// Rule-checkable problems — out-of-range scores, missing PDGM-required items,
// hard internal contradictions, malformed diagnosis codes — should never wait
// on (or be left to) a billed LLM call: these checks are instant, free,
// reproducible, and can't hallucinate. The reviewer renders them immediately
// (they track every in-place data correction live, unlike the AI review) and
// hands the results to the LLM as authoritative context so the model neither
// contradicts nor re-reports them.
//
// Pure — no React, no SDK. Ranges come from the app's canonical OASIS-E scale
// map (oasisScales.OASIS_ITEM_MAX). Severity values match the review UI's
// critical/high/medium/low scale.

import { OASIS_ITEM_MAX } from "./oasisScales.js";
import { parseLocalDate } from "../../lib/dateLocal.js";

/** pdgmData.functional_scores keys → OASIS M-item code + label. */
export const FUNCTIONAL_SCORE_FIELDS = {
  m1800_grooming: { item: "M1800", label: "Grooming" },
  m1810_dress_upper: { item: "M1810", label: "Dress upper body" },
  m1820_dress_lower: { item: "M1820", label: "Dress lower body" },
  m1830_bathing: { item: "M1830", label: "Bathing" },
  m1840_toilet_transfer: { item: "M1840", label: "Toilet transferring" },
  m1850_transferring: { item: "M1850", label: "Transferring" },
  m1860_ambulation: { item: "M1860", label: "Ambulation/locomotion" },
};

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN; // NaN = present but not numeric
};

// ICD-10-CM: letter (no U) + 2 alphanumerics, then up to 4 more after an
// optional dot. Extractions carry both dotted ("I50.9") and undotted ("I509")
// forms, so the dot is optional.
const ICD10_RE = /^[A-TV-Z][0-9][0-9A-Z](?:\.?[0-9A-Z]{1,4})?$/i;

/**
 * Run every deterministic check against a pdgmData extraction.
 *
 * @param {Object} pdgmData  The analyzer's extracted PDGM data
 * @param {Object} [opts]
 * @param {Date}   [opts.today]  Injectable "now" for date checks (tests)
 * @returns {{
 *   findings: Array<{check: string, severity: string, m_items: string[], message: string, current_value?: string}>,
 *   passed: number, failed: number, total: number,
 * }}
 */
export function runOasisDeterministicChecks(pdgmData, { today = new Date() } = {}) {
  const findings = [];
  let total = 0;
  const fail = (finding) => findings.push(finding);

  const scores = pdgmData?.functional_scores || {};

  // ── Functional scores: presence + valid range per item ──
  for (const [field, { item, label }] of Object.entries(FUNCTIONAL_SCORE_FIELDS)) {
    total += 1;
    const max = OASIS_ITEM_MAX[item.toLowerCase()];
    const value = num(scores[field]);
    if (value === null) {
      fail({
        check: `${field}-missing`,
        severity: "medium",
        m_items: [item],
        message: `${item} (${label}) is not documented — required for the PDGM functional impairment level.`,
      });
    } else if (Number.isNaN(value) || !Number.isInteger(value) || value < 0 || value > max) {
      fail({
        check: `${field}-range`,
        severity: "high",
        m_items: [item],
        message: `${item} (${label}) value "${scores[field]}" is outside the valid range 0–${max}.`,
        current_value: String(scores[field]),
      });
    }
  }

  // ── Hard contradictions between functional items ──
  const transferring = num(scores.m1850_transferring);
  const ambulation = num(scores.m1860_ambulation);
  const validPair =
    Number.isInteger(transferring) && transferring >= 0 && transferring <= OASIS_ITEM_MAX.m1850 &&
    Number.isInteger(ambulation) && ambulation >= 0 && ambulation <= OASIS_ITEM_MAX.m1860;
  total += 1;
  if (validPair && transferring >= 4 && ambulation <= 1) {
    fail({
      check: "bedfast-vs-ambulation",
      severity: "high",
      m_items: ["M1850", "M1860"],
      message: `M1850 documents the patient as bedfast (${transferring}) while M1860 documents independent or near-independent ambulation (${ambulation}) — these cannot both be true.`,
    });
  } else if (validPair && ambulation === 6 && transferring <= 1) {
    fail({
      check: "bedfast-vs-transferring",
      severity: "high",
      m_items: ["M1850", "M1860"],
      message: `M1860 documents the patient as bedfast and unable to ambulate (6) while M1850 documents independent or minimally assisted transfers (${transferring}) — these cannot both be true.`,
    });
  }

  // ── Dyspnea (M1400) range when present ──
  total += 1;
  const dyspnea = num(pdgmData?.clinical_items?.dyspnea);
  if (dyspnea !== null && (Number.isNaN(dyspnea) || !Number.isInteger(dyspnea) || dyspnea < 0 || dyspnea > 4)) {
    fail({
      check: "m1400-range",
      severity: "high",
      m_items: ["M1400"],
      message: `M1400 (Dyspnea) value "${pdgmData.clinical_items.dyspnea}" is outside the valid range 0–4.`,
      current_value: String(pdgmData.clinical_items.dyspnea),
    });
  }

  // ── Assessment date: documented and not in the future ──
  total += 1;
  const assessmentDateRaw = pdgmData?.patient_info?.assessment_date;
  const assessmentDate = parseLocalDate(assessmentDateRaw);
  if (!assessmentDate) {
    fail({
      check: "assessment-date-missing",
      severity: "medium",
      m_items: ["M0090"],
      message: assessmentDateRaw
        ? `Assessment date "${assessmentDateRaw}" is not a recognizable date.`
        : "Assessment date (M0090) is not documented.",
    });
  } else if (assessmentDate.getTime() > today.getTime()) {
    fail({
      check: "assessment-date-future",
      severity: "high",
      m_items: ["M0090"],
      message: `Assessment date ${assessmentDateRaw} is in the future.`,
      current_value: String(assessmentDateRaw),
    });
  }

  // ── Assessment type documented ──
  total += 1;
  if (!pdgmData?.patient_info?.assessment_type) {
    fail({
      check: "assessment-type-missing",
      severity: "medium",
      m_items: ["M0100"],
      message: "Assessment type (M0100 reason for assessment) is not documented.",
    });
  }

  // ── Primary diagnosis code: documented and ICD-10-shaped ──
  total += 1;
  const dxCode = String(pdgmData?.primary_diagnosis_code || "").trim();
  if (!dxCode) {
    fail({
      check: "primary-dx-missing",
      severity: "high",
      m_items: ["M1021"],
      message: "No primary diagnosis code (M1021) is documented — the claim cannot group under PDGM without one.",
    });
  } else if (!ICD10_RE.test(dxCode)) {
    fail({
      check: "primary-dx-format",
      severity: "high",
      m_items: ["M1021"],
      message: `Primary diagnosis code "${dxCode}" is not a valid ICD-10-CM code format.`,
      current_value: dxCode,
    });
  }

  // ── Episode timing value recognizable when present ──
  total += 1;
  const timingRaw = pdgmData?.episode_timing ?? pdgmData?.m0110_episode_timing;
  if (timingRaw !== null && timingRaw !== undefined && timingRaw !== "") {
    const timing = String(timingRaw).trim().toLowerCase();
    const known = ["early", "late", "1", "2", "unknown", "uk", "na", "n/a"];
    if (!known.includes(timing)) {
      fail({
        check: "episode-timing-value",
        severity: "low",
        m_items: ["M0110"],
        message: `Episode timing (M0110) value "${timingRaw}" is not a recognized value (early/late).`,
        current_value: String(timingRaw),
      });
    }
  }

  return { findings, passed: total - findings.length, failed: findings.length, total };
}

/**
 * Render the check results as an authoritative prompt block for the review LLM,
 * so the model neither contradicts the deterministic results nor wastes
 * findings re-reporting them.
 */
export function deterministicChecksPromptBlock(result) {
  if (!result) return "";
  const header =
    "DETERMINISTIC PRE-CHECKS (system-validated, authoritative — do NOT contradict these, and do NOT re-report them as new findings; they are already surfaced to the user):";
  if (result.failed === 0) {
    return `${header}\nAll ${result.total} deterministic checks passed (item ranges, required PDGM items, internal consistency, diagnosis code format, assessment dates).`;
  }
  const lines = result.findings.map(
    (f) => `- FAIL [${f.severity}] ${f.m_items.join("/")}: ${f.message}`
  );
  return `${header}\n${lines.join("\n")}\n(${result.passed} of ${result.total} checks passed.)`;
}
