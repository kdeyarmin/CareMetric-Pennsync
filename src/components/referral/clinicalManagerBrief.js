// Clinical-manager referral brief — reimbursement-focused PDF/email content.
//
// Built AFTER the referral analyzer runs, for the CLINICAL MANAGER (financial
// visibility required — callers must keep this behind FinancialGate /
// canViewFinancials; the dollar figures come from the server-gated
// calculatePDGM endpoint and the agency's own imported payer table).
//
// Sections: patient summary → best coding for maximum reimbursement (with
// case-mix weights) → items to clarify to protect/increase reimbursement →
// payer-optimized visit frequency → draft OASIS responses → PDGM grouping with
// HIPPS code and the draft reimbursement estimate (or the contract-payer
// estimate from the imported payer table for non-PDGM payers).
//
// ── HIPPS derivation ─────────────────────────────────────────────────────────
// The five grouping variables come from the canonical calculatePDGM result.
// The HIPPS code is assembled from the FIXED positional structure of the CMS
// HH PDGM HIPPS code (position 1 timing/source, 2 clinical group letter,
// 3 functional level, 4 comorbidity, 5 placeholder "1") — structural spec,
// stable since CY2020, same class of public reference as the 12 clinical
// groups and the 2–6 LUPA threshold range already used in this repo. When the
// admin has uploaded the official CMS case-mix table, its HIPPS for the same
// combination is preferred (via caseMixReconciliation) and any mismatch with
// the derived code is flagged rather than hidden. Groups with no CMS
// counterpart (e.g. Medication Management) return null, never a guess.
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK.

import { buildVisitPlan, formatOrder, DISCIPLINE_NAMES } from "./visitPlanEstimator.js";
import { generateDiagnosisCodes, codeLabel, resolveScenario } from "./diagnosisCodeGenerator.js";
import { assessMedicareEligibility } from "./medicareEligibility.js";
import { referralToF2FInput, validateFaceToFace } from "./faceToFaceValidator.js";
import { patientInitials, oasisItemLabel, formatOasisValue, auditGgDraft } from "./admissionBriefEmail.js";
import { collectComorbidityCapture } from "./comorbidityCapture.js";
import { matchPayerRow, estimatePayerEpisode, estimateEpisodeMargin, plannedVisitsByDiscipline } from "../pdgm/payerRates.js";
import { reconcileScenario } from "../pdgm/caseMixReconciliation.js";

// HIPPS position 1: timing × admission source.
const HIPPS_TIMING_SOURCE = {
  "early|community": "1",
  "early|institutional": "2",
  "late|community": "3",
  "late|institutional": "4",
};

// HIPPS position 2: clinical-group letter, keyed by the app's pdgmRates group
// keys. Letters verified against ALL 432 rows of the official CMS CY2026
// case-mix weights file (see hhCaseMixWeightsCy2026.js: A=MMTA Other,
// B=Neuro Rehab, C=Wound, D=Complex Nursing, E=MS Rehab, F=Behavioral
// Health, G–L=the remaining MMTA subgroups). MMTA_Medication_Management has
// no CMS counterpart (see caseMixReconciliation.RATES_KEY_TO_CMS_GROUP);
// MMTA_Skin_Non_Surgical maps to the Wound group like the reconciliation
// module does.
const HIPPS_GROUP_LETTER = {
  MMTA_Other: "A",
  MMTA_Neuro_Rehab: "B",
  MMTA_Wounds: "C",
  MMTA_Skin_Non_Surgical: "C",
  MMTA_Complex_Nursing: "D",
  MMTA_Musculoskeletal: "E",
  MMTA_Behavioral_Health: "F",
  MMTA_Surgical_Aftercare: "G",
  MMTA_Cardiac_Circulatory: "H",
  MMTA_Endocrine: "I",
  MMTA_GI_GU: "J",
  MMTA_Infectious_Disease: "K",
  MMTA_Respiratory: "L",
};

const HIPPS_FUNCTIONAL = { low: "A", medium: "B", high: "C" };
const HIPPS_COMORBIDITY = { none: "1", low: "2", high: "3" };

/**
 * Derive the PDGM HIPPS code from the five grouping variables (calculatePDGM
 * result fields). Returns { hipps: string|null, reason: string|null }.
 */
export function deriveHippsCode({ episodeTiming, admissionSource, clinicalGroup, functionalLevel, comorbidityLevel } = {}) {
  const p1 = HIPPS_TIMING_SOURCE[`${episodeTiming}|${admissionSource}`];
  const p2 = HIPPS_GROUP_LETTER[clinicalGroup];
  const p3 = HIPPS_FUNCTIONAL[functionalLevel];
  const p4 = HIPPS_COMORBIDITY[comorbidityLevel];
  if (!p2 && clinicalGroup === "MMTA_Medication_Management") {
    return { hipps: null, reason: "Medication Management has no CMS clinical-group counterpart — no HIPPS can be derived." };
  }
  if (!p1 || !p2 || !p3 || !p4) {
    const missing = [
      !p1 && "timing/admission source",
      !p2 && "clinical group",
      !p3 && "functional level",
      !p4 && "comorbidity level",
    ].filter(Boolean).join(", ");
    return { hipps: null, reason: `Incomplete grouping variables (${missing}).` };
  }
  return { hipps: `${p1}${p2}${p3}${p4}1`, reason: null };
}

/**
 * Build the calculatePDGM request payload from the extracted referral + the
 * deterministic coding result. Functional scores are the DRAFT OASIS responses
 * from the extraction (calculatePDGM parses the leading digit of each), so the
 * estimate is grounded in the same draft OASIS the brief displays.
 */
export function buildPdgmRequestFromReferral(referralData, coding = null) {
  const ex = referralData?.extracted_data || referralData || {};
  const dxCoding = coding || generateDiagnosisCodes(ex);
  const scenario = resolveScenario(ex);
  const oasis = ex.oasis_assessment || {};
  const functional = {};
  for (const key of [
    "m1800_grooming", "m1810_dress_upper", "m1820_dress_lower", "m1830_bathing",
    "m1840_toilet_transfer", "m1850_transferring", "m1860_ambulation",
  ]) {
    if (oasis[key] != null && String(oasis[key]).trim() !== "") functional[key] = String(oasis[key]);
  }
  // Comorbidities: CODED secondaries only, deduped by code. calculatePDGM
  // counts every list entry independently (substring term matching), so
  // passing the same condition twice — once as codeLabel and once as the raw
  // secondary text — could double-count it and inflate the comorbidity level
  // (low → high) and the payment estimate. Documented-but-uncoded conditions
  // stay OUT of the payment inputs; they surface in the clarifications
  // section as coder queries instead.
  const seenCodes = new Set();
  const comorbidities = [];
  for (const d of dxCoding.secondaries) {
    const code = String(d.displayCode || "").toUpperCase();
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    comorbidities.push(codeLabel(d));
  }

  return {
    primary_diagnosis:
      (dxCoding.primary ? codeLabel(dxCoding.primary) : "") || ex?.diagnoses?.primary_diagnosis || "",
    ...(dxCoding.primary ? { primary_diagnosis_code: dxCoding.primary.displayCode } : {}),
    comorbidities,
    admission_source: scenario.admissionSource,
    episode_timing: "early",
    functional_scores: functional,
    ...(ex?.admission_details?.admission_date ? { soc_date: ex.admission_details.admission_date } : {}),
  };
}

const money = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "—");

/**
 * True when this referral's payer is priced by the PDGM engine (Medicare FFS,
 * or a configured payer row whose payment_model is "pdgm"). Every other payer
 * is priced from the imported payer table and gets no HIPPS/PDGM figures —
 * callers use this to skip the calculatePDGM call entirely for those payers.
 */
export function isPdgmPricedPayer(referralData, payers = []) {
  const plan = buildVisitPlan(referralData || {});
  const match = matchPayerRow(plan.payer.evidence, plan.payer.payer, payers);
  return plan.payer.payer === "medicare_ffs" || match.row?.payment_model === "pdgm";
}
const clean = (v) => {
  const s = String(v ?? "").trim();
  return /^not documented( in referral)?\.?$/i.test(s) ? "" : s;
};

/**
 * Everything the clinical manager needs to clarify to protect or increase the
 * reimbursement — deterministic, assembled from the coding result, the PDGM
 * validation discrepancies, eligibility gaps, and the AI's missing-info list.
 */
export function collectRevenueClarifications({ coding, pdgm, eligibility, f2f, analysis, comorbidityCapture = null }) {
  const items = [];
  for (const w of coding?.warnings || []) items.push({ area: "Coding", detail: w });
  for (const u of coding?.uncoded || []) {
    items.push({ area: "Coding", detail: `"${u.description}" is documented without an ICD-10 code — coder assignment could add a comorbidity adjustment or a better principal.` });
  }
  for (const o of comorbidityCapture?.opportunities || []) {
    items.push({
      area: "Comorbidity capture",
      detail: `${o.label} (${o.value}-value signal) — ${o.suggestion} Evidence: ${o.evidence.map((e) => `${e.source}: "${e.text}"`).join("; ")}`,
    });
  }
  for (const d of pdgm?.dataValidation?.discrepancies || []) {
    items.push({
      area: "PDGM inputs",
      detail: `${d.message}${d.evidence ? ` (${d.evidence})` : ""}${d.revenueImpact ? ` — ${d.revenueImpact}` : ""}`,
    });
  }
  if (pdgm?.original?.comorbidityLevel === "none") {
    items.push({ area: "Comorbidities", detail: "No comorbidity adjustment is currently supported — confirm all active secondary diagnoses are documented and coded (a low/high adjustment raises the case-mix weight)." });
  }
  if (f2f && f2f.status !== "valid") {
    items.push({ area: "Condition of payment", detail: `Face-to-Face: ${f2f.reasons.join(" ")}` });
  } else if (!f2f) {
    items.push({ area: "Condition of payment", detail: "No Face-to-Face encounter documented — obtain it before billing (42 CFR 424.22)." });
  }
  for (const m of eligibility?.missingForAdmission || []) {
    items.push({ area: "Eligibility", detail: m });
  }
  for (const m of analysis?.missing_information?.critical_missing || []) {
    items.push({ area: "Referral gaps", detail: `${m.field_name}${m.how_to_obtain ? ` — ${m.how_to_obtain}` : ""}` });
  }
  // De-dupe identical lines that arrive from multiple sources.
  const seen = new Set();
  return items.filter((i) => {
    const k = `${i.area}|${i.detail}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Build the clinical-manager brief: email subject/body + the exportToPDF
 * content array. Pure — the caller supplies the calculatePDGM response
 * (`pdgm`, may be null when the call failed) and the stored payer table.
 *
 * @param {object} params
 * @param {object} params.referralData  extracted referral
 * @param {object} [params.analysis]   ReferralAnalyzer AI result
 * @param {object} [params.pdgm]       calculatePDGM response ({ original, rateBasis, dataValidation, … })
 * @param {object} [params.storedWeightTable] PDGMRateConfig.case_mix_weight_table (official CMS table)
 * @param {object} [params.wageIndexMatch] matchWageIndex() result for the patient's address, or null
 * @param {Array}  [params.payers]     PayerRateConfig.payers (imported payer table)
 * @param {object} [params.visitCosts] PayerRateConfig.visit_costs (per-discipline cost per visit)
 * @param {string} [params.preparedBy]
 * @param {string} [params.sourceFileUrl]
 * @param {string} [params.packetUrl]
 * @returns {{ subject, emailBody, pdfTitle, pdfSubtitle, pdfContent, hipps, payerEstimate }}
 */
export function buildClinicalManagerBrief({
  referralData,
  analysis = null,
  pdgm = null,
  storedWeightTable = null,
  wageIndexMatch = null,
  payers = [],
  visitCosts = null,
  preparedBy = "",
  sourceFileUrl = "",
  packetUrl = "",
} = {}) {
  const ex = referralData?.extracted_data || referralData || {};
  const demo = ex.demographics || {};
  const coding = generateDiagnosisCodes(ex);
  const plan = buildVisitPlan(referralData || {}, analysis?.visit_estimates);
  const f2fInput = referralToF2FInput(referralData);
  const f2f = f2fInput ? validateFaceToFace(f2fInput) : null;
  const eligibility = assessMedicareEligibility(referralData || {}, f2f);
  const original = pdgm?.original || null;

  // ── payer pricing mode ──
  // The analyzer works for ALL payers: Medicare FFS (and any payer whose
  // configured payment model is "pdgm") is priced by calculatePDGM and gets a
  // HIPPS code; every other payer is priced from the imported payer
  // reimbursement table and gets NO HIPPS/PDGM figures.
  const payerMatch = matchPayerRow(plan.payer.evidence, plan.payer.payer, payers);
  const isPdgmPriced =
    plan.payer.payer === "medicare_ffs" || payerMatch.row?.payment_model === "pdgm";
  const payerEstimate = isPdgmPriced ? null : estimatePayerEpisode(payerMatch.row, plan);

  // ── HIPPS: PDGM-priced payers only; official table preferred over derivation ──
  const derived = !isPdgmPriced
    ? { hipps: null, reason: "Non-Medicare payer — PDGM/HIPPS does not apply; revenue comes from the payer contract table." }
    : original
    ? deriveHippsCode(original)
    : { hipps: null, reason: "PDGM calculation unavailable." };
  let officialRecon = null;
  if (isPdgmPriced && original && storedWeightTable) {
    officialRecon = reconcileScenario(
      {
        clinicalGroup: original.clinicalGroup,
        admissionSource: original.admissionSource,
        timing: original.episodeTiming,
        functionalLevel: original.functionalLevel,
        comorbidityLevel: original.comorbidityLevel,
      },
      storedWeightTable
    );
  }
  const officialHipps = officialRecon?.available ? officialRecon.hipps : null;
  const hipps = {
    code: officialHipps || derived.hipps,
    source: officialHipps ? "official CMS case-mix table" : derived.hipps ? "derived from grouping variables" : null,
    derived: derived.hipps,
    official: officialHipps,
    mismatch: Boolean(officialHipps && derived.hipps && officialHipps !== derived.hipps),
    reason: derived.reason,
    lupaThreshold: officialRecon?.available ? officialRecon.lupaThreshold : null,
  };

  const comorbidityCapture = collectComorbidityCapture(referralData);
  const clarifications = collectRevenueClarifications({ coding, pdgm, eligibility, f2f, analysis, comorbidityCapture });

  const fullName = clean(demo.full_name) || "the patient";
  const subject = `Referral revenue brief: ${patientInitials(demo.full_name)} — coding, visit plan & reimbursement estimate`;

  // ── section content (shared by the email body and the PDF) ──
  const summaryLines = [
    clean(analysis?.patient_summary?.narrative) ||
      [clean(ex?.diagnoses?.primary_diagnosis) && `Referred for ${clean(ex.diagnoses.primary_diagnosis)}.`, clean(ex?.admission_details?.referral_reason)].filter(Boolean).join(" "),
    `Payer: ${plan.payer.label}${plan.payer.evidence ? ` ("${plan.payer.evidence}")` : ""}`,
    clean(demo.date_of_birth) && `DOB: ${clean(demo.date_of_birth)}`,
    clean(ex?.admission_details?.admission_source) && `Admission source: ${clean(ex.admission_details.admission_source)}`,
    clean(demo.referring_physician) && `Referring provider: ${clean(demo.referring_physician)}`,
  ].filter(Boolean);

  const codingLines = [
    ...coding.sequenced.map((d) => {
      const weight = d.caseMixWeight !== null ? ` — case-mix weight ${d.caseMixWeight.toFixed(4)} (${plan.payer.payer === "medicare_ffs" ? coding.scenario.bucket.replace("_", "/") : "reference"})` : "";
      return `${d.role === "primary" ? "M1021 Primary" : `M1023 #${d.position - (coding.primary ? 1 : 0)}`}: ${codeLabel(d)} [${d.clinicalGroup}]${weight}`;
    }),
    coding.sequenced.length === 0 ? "No ICD-10 codes documented in the referral — codes are never auto-generated; obtain coded diagnoses before billing." : "",
    coding.primary
      ? `Principal selected for the highest documented case-mix weight (codes only ever harvested from the referral, never invented).`
      : "",
  ].filter(Boolean);

  const clarificationLines = clarifications.length
    ? clarifications.map((c) => `[${c.area}] ${c.detail}`)
    : ["Nothing outstanding — coding inputs, F2F, and eligibility items are all supported by the referral."];

  const visitLines = [];
  if (plan.hasOrderedFrequencies) {
    const byDiscipline = plan.orders.reduce((acc, o) => {
      (acc[o.discipline] ||= []).push(o);
      return acc;
    }, {});
    for (const [d, orders] of Object.entries(byDiscipline)) {
      visitLines.push(`${DISCIPLINE_NAMES[d] || d}: ${orders.map(formatOrder).join(" → ")} (ordered — authoritative)`);
    }
    if (plan.periods) {
      visitLines.push(`30-day periods: Period 1 ≈ ${plan.periods.period1} visits, Period 2 ≈ ${plan.periods.period2} visits${plan.periods.complete ? "" : " (open-ended orders — floor)"}`);
    }
  } else if (plan.aiEstimates?.suggestedFrequency) {
    visitLines.push(`Suggested (AI planning estimate — no frequencies ordered): ${plan.aiEstimates.suggestedFrequency}`);
    if (plan.aiEstimates.rationale) visitLines.push(`Rationale: ${plan.aiEstimates.rationale}`);
  } else {
    visitLines.push("No frequencies ordered and no estimate available — obtain orders from the referring physician.");
  }
  for (const l of plan.lupa || []) {
    visitLines.push(`Period ${l.period}${l.estimate ? " (estimate)" : ""}: ${l.message}`);
    // Revenue at risk: a LUPA replaces the FULL period payment with per-visit
    // payments. The full-period figure is known (calculatePDGM); the per-visit
    // rates are not configured, so the delta is framed against the known amount.
    if (l.band !== "clears_all" && original?.totalPayment) {
      visitLines.push(
        `  → Revenue at risk: a LUPA in period ${l.period} forfeits the full ${money(original.totalPayment)} period payment (replaced by per-visit payments). ${
          l.band === "below_all"
            ? "Add medically necessary visits to reach the threshold, or plan the discharge before the period opens."
            : "One added medically necessary visit may clear the threshold — verify against the HIPPS-specific value after coding."
        }`
      );
    }
  }
  visitLines.push(...plan.strategy);

  const oasisEntries = Object.entries(ex.oasis_assessment || {})
    .filter(([key]) => /^(?:m|gg)\d{4}/i.test(key))
    .map(([key, value]) => {
      const v = formatOasisValue(value);
      return v ? [oasisItemLabel(key), v] : null;
    })
    .filter(Boolean);
  // Deterministic GG draft audit — an out-of-scale or basis-free AI code is
  // flagged inline rather than presented as a clean pre-fill.
  const ggIssues = auditGgDraft(ex.oasis_assessment || {});

  const rateBasisNote = pdgm?.rateBasis?.isOfficial
    ? "Rates: agency's official CMS numbers (marked official in PDGM Rate Settings)."
    : "DRAFT ESTIMATE — based on approximate case-mix weights, not confirmed official CMS rates. Load official numbers in Admin → PDGM Rate Settings.";

  // ── episode margin: revenue − the agency's own per-visit costs ──
  // The costed side always covers the estimator's 60-day visit plan, so the
  // revenue side must cover the same horizon: an episodic contract shorter
  // than 60 days is scaled up (with a note), mirroring the PDGM path's
  // two-period revenue — never one 30-day payment against 60 days of costs.
  let marginRevenue = null;
  let marginHorizonNote = null;
  if (isPdgmPriced) {
    marginRevenue = original ? Math.round(original.totalPayment * 2 * 100) / 100 : null;
  } else if (payerEstimate?.estimable) {
    marginRevenue = payerEstimate.amount;
    if (payerEstimate.model === "episodic") {
      const days = Number(payerMatch.row?.episode_length_days);
      if (Number.isFinite(days) && days > 0 && days < 60) {
        const periods = 60 / days;
        marginRevenue = Math.round(payerEstimate.amount * periods * 100) / 100;
        marginHorizonNote = `Margin revenue scales the contracted ${days}-day episodic rate ×${Number.isInteger(periods) ? periods : periods.toFixed(1)} to cover the 60-day visit plan being costed.`;
      } else if (!Number.isFinite(days) || days <= 0) {
        marginHorizonNote = "Episode length not configured for this payer — margin assumes the episodic rate covers the full 60-day visit plan.";
      }
    }
  }
  const margin = visitCosts
    ? estimateEpisodeMargin({ revenue: marginRevenue, plannedVisits: plannedVisitsByDiscipline(plan), visitCosts })
    : null;
  const marginLines = !margin
    ? []
    : margin.estimable
    ? [
        `Estimated episode visit cost: ${money(margin.totalCost)} (${margin.byDiscipline
          .filter((b) => b.subtotal != null)
          .map((b) => `${b.discipline} ${b.visits} × ${money(b.costPerVisit)}`)
          .join("; ")})`,
        margin.margin !== null
          ? `Estimated episode margin: ${money(margin.margin)}${margin.marginPct !== null ? ` (${margin.marginPct}%)` : ""} — revenue ${money(marginRevenue)} − visit cost ${money(margin.totalCost)}${isPdgmPriced ? " (revenue ≈ two 30-day periods before late-period reweighting)" : ""}`
          : "",
        marginHorizonNote || "",
        ...margin.notes,
      ].filter(Boolean)
    : margin.notes;

  const pdgmLines = original
    ? [
        `Clinical group: ${original.clinicalGroup} · ${original.admissionSource}/${original.episodeTiming}`,
        `Functional level: ${original.functionalLevel} (${original.functionalPoints} pts, from the draft OASIS below) · Comorbidity: ${original.comorbidityLevel}`,
        `HIPPS: ${hipps.code || "unavailable"}${hipps.code ? ` (${hipps.source})` : hipps.reason ? ` — ${hipps.reason}` : ""}`,
        hipps.mismatch ? `NOTE: derived HIPPS ${hipps.derived} disagrees with the official table's ${hipps.official} — verify grouping inputs.` : "",
        hipps.lupaThreshold != null ? `Official LUPA threshold for this group: ${hipps.lupaThreshold} visits (informational).` : "",
        `Case-mix weight: ${original.caseMixWeight} · Base payment: ${money(original.basePayment)}${original.wageIndex !== 1 ? ` · wage index ${original.wageIndex}` : ""}`,
        wageIndexMatch
          ? `Wage index ${wageIndexMatch.wage_index} applied for ${wageIndexMatch.label || `CBSA ${wageIndexMatch.cbsa}`} (matched by ${wageIndexMatch.matchedBy} from the patient's address).`
          : "",
        `Draft 30-day period reimbursement: ${money(original.totalPayment)} (two-period 60-day episode if both bill: ≈ ${money(original.totalPayment * 2)} before late-period reweighting)`,
        ...marginLines,
        rateBasisNote,
      ].filter(Boolean)
    : ["PDGM estimate unavailable (calculation did not run)."];

  const payerLines = [];
  if (!isPdgmPriced && payerEstimate) {
    payerLines.push(
      payerEstimate.estimable
        ? `Estimated episode reimbursement (${payerMatch.row.payer_name}): ${money(payerEstimate.amount)} — ${payerEstimate.basis}`
        : `No reimbursement estimate available for this payer yet.`
    );
    for (const b of payerEstimate.perVisitBreakdown) {
      payerLines.push(
        b.subtotal != null
          ? `  ${b.discipline}: ${b.visits} visits × ${money(b.rate)} = ${money(b.subtotal)}`
          : `  ${b.discipline}: ${b.visits} visits × (no contracted rate) — excluded`
      );
    }
    for (const c of payerEstimate.authComparison) {
      if (c.approved != null) {
        payerLines.push(`  ${c.discipline} authorization: planned ${c.planned} vs typically approved ${c.approved}${c.over ? " — OVER, request additional auth" : ""}`);
      }
    }
    payerLines.push(...payerEstimate.notes);
    payerLines.push(...marginLines);
  }

  const docLines = [
    sourceFileUrl && `Source referral document: ${sourceFileUrl}`,
    packetUrl && `Admission packet PDF: ${packetUrl}`,
  ].filter(Boolean);

  // ── assemble email body ──
  // PDGM/HIPPS section only for PDGM-priced payers; every other payer gets its
  // revenue section from the imported payer reimbursement table instead.
  const revenueSections = isPdgmPriced
    ? [["PDGM GROUPING, HIPPS & DRAFT REIMBURSEMENT", pdgmLines]]
    : [[`REVENUE ESTIMATE — ${(payerMatch.row?.payer_name || plan.payer.label).toUpperCase()}`,
        payerLines.length ? payerLines : ["No payer rate row configured for this payer — import the payer table in Admin → PDGM Rate Settings."]]];

  const sections = [
    ["PATIENT SUMMARY", summaryLines],
    ["BEST CODING FOR MAXIMUM REIMBURSEMENT", codingLines],
    ["CLARIFY TO PROTECT/INCREASE REIMBURSEMENT", clarificationLines],
    [`SUGGESTED VISIT FREQUENCY — ${plan.payer.label.toUpperCase()}`, visitLines],
    ["DRAFT OASIS RESPONSES (AI pre-fill — verify at SOC)", [
      ...(oasisEntries.length ? oasisEntries.map(([k, v]) => `${k}: ${v}`) : ["No OASIS items pre-filled from this referral."]),
      ...ggIssues.map((i) => `VERIFY: ${i}`),
    ]],
    ...revenueSections,
    ...(docLines.length ? [["DOCUMENTS", docLines]] : []),
  ];
  const emailBody = [
    "CONFIDENTIAL — PROTECTED HEALTH INFORMATION AND FINANCIAL DATA. For agency management only.",
    "AI-assisted, draft figures — verify coding and rates before billing. Generated from the uploaded referral.",
    "",
    `REFERRAL REVENUE BRIEF — ${fullName}`,
    preparedBy ? `Prepared by: ${preparedBy} (intake)` : "",
    "",
    ...sections.map(([title, lines]) => `== ${title} ==\n${lines.join("\n")}`),
    "",
    "This brief is a planning estimate, not a billable amount or a physician order.",
  ].filter((l) => l !== null).join("\n");

  // ── assemble PDF content (exportToPDF shape) ──
  const pdfContent = [];
  for (const [title, lines] of sections) {
    pdfContent.push({ type: "heading", text: title });
    if (title.startsWith("DRAFT OASIS") && oasisEntries.length) {
      pdfContent.push({ type: "table", headers: ["OASIS item", "Draft response"], rows: oasisEntries });
      if (ggIssues.length) {
        pdfContent.push({ type: "text", text: ggIssues.map((i) => `VERIFY: ${i}`).join("\n") });
      }
    } else {
      pdfContent.push({ type: "text", text: lines.join("\n") });
    }
  }
  pdfContent.push({
    type: "text",
    text: "CONFIDENTIAL — PHI and financial data. Draft planning estimate generated by PennSync from the uploaded referral; not a billable amount or a physician order. Verify coding, OASIS responses, and rates before billing.",
  });

  return {
    subject,
    emailBody,
    pdfTitle: `Referral Revenue Brief — ${patientInitials(demo.full_name)}`,
    pdfSubtitle: `${plan.payer.label}${preparedBy ? ` · Prepared by ${preparedBy}` : ""}`,
    pdfContent,
    hipps,
    isPdgmPriced,
    payerEstimate,
    coding,
    plan,
  };
}
