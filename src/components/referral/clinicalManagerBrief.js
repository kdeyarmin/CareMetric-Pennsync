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
import { patientInitials, oasisItemLabel } from "./admissionBriefEmail.js";
import { matchPayerRow, estimatePayerEpisode } from "../pdgm/payerRates.js";
import { reconcileScenario } from "../pdgm/caseMixReconciliation.js";

// HIPPS position 1: timing × admission source.
const HIPPS_TIMING_SOURCE = {
  "early|community": "1",
  "early|institutional": "2",
  "late|community": "3",
  "late|institutional": "4",
};

// HIPPS position 2: clinical-group letter, keyed by the app's pdgmRates group
// keys. MMTA_Medication_Management has no CMS counterpart (see
// caseMixReconciliation.RATES_KEY_TO_CMS_GROUP); MMTA_Skin_Non_Surgical maps to
// the Wound group like the reconciliation module does.
const HIPPS_GROUP_LETTER = {
  MMTA_Other: "A",
  MMTA_Behavioral_Health: "B",
  MMTA_Complex_Nursing: "C",
  MMTA_Musculoskeletal: "D",
  MMTA_Neuro_Rehab: "E",
  MMTA_Wounds: "F",
  MMTA_Skin_Non_Surgical: "F",
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
  const comorbidities = [
    ...dxCoding.secondaries.map((d) => codeLabel(d)),
    ...(Array.isArray(ex?.diagnoses?.secondary_diagnoses) ? ex.diagnoses.secondary_diagnoses : []),
  ].filter(Boolean);

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
const clean = (v) => {
  const s = String(v ?? "").trim();
  return /^not documented( in referral)?\.?$/i.test(s) ? "" : s;
};

/**
 * Everything the clinical manager needs to clarify to protect or increase the
 * reimbursement — deterministic, assembled from the coding result, the PDGM
 * validation discrepancies, eligibility gaps, and the AI's missing-info list.
 */
export function collectRevenueClarifications({ coding, pdgm, eligibility, f2f, analysis }) {
  const items = [];
  for (const w of coding?.warnings || []) items.push({ area: "Coding", detail: w });
  for (const u of coding?.uncoded || []) {
    items.push({ area: "Coding", detail: `"${u.description}" is documented without an ICD-10 code — coder assignment could add a comorbidity adjustment or a better principal.` });
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
 * @param {Array}  [params.payers]     PayerRateConfig.payers (imported payer table)
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
  payers = [],
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

  // ── HIPPS: derived from the grouping variables; official table preferred ──
  const derived = original ? deriveHippsCode(original) : { hipps: null, reason: "PDGM calculation unavailable." };
  let officialRecon = null;
  if (original && storedWeightTable) {
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

  // ── payer estimate ──
  const payerMatch = matchPayerRow(plan.payer.evidence, plan.payer.payer, payers);
  const isPdgmPriced =
    plan.payer.payer === "medicare_ffs" || payerMatch.row?.payment_model === "pdgm";
  const payerEstimate = isPdgmPriced ? null : estimatePayerEpisode(payerMatch.row, plan);

  const clarifications = collectRevenueClarifications({ coding, pdgm, eligibility, f2f, analysis });

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
  }
  visitLines.push(...plan.strategy);

  const oasisEntries = Object.entries(ex.oasis_assessment || {})
    .filter(([key]) => /^m\d{4}/i.test(key))
    .map(([key, value]) => {
      const v = typeof value === "string" ? clean(value) : Array.isArray(value) ? value.join("; ") : value && typeof value === "object" ? JSON.stringify(value) : "";
      return v ? [oasisItemLabel(key), v] : null;
    })
    .filter(Boolean);

  const rateBasisNote = pdgm?.rateBasis?.isOfficial
    ? "Rates: agency's official CMS numbers (marked official in PDGM Rate Settings)."
    : "DRAFT ESTIMATE — based on approximate case-mix weights, not confirmed official CMS rates. Load official numbers in Admin → PDGM Rate Settings.";

  const pdgmLines = original
    ? [
        `Clinical group: ${original.clinicalGroup} · ${original.admissionSource}/${original.episodeTiming}`,
        `Functional level: ${original.functionalLevel} (${original.functionalPoints} pts, from the draft OASIS below) · Comorbidity: ${original.comorbidityLevel}`,
        `HIPPS: ${hipps.code || "unavailable"}${hipps.code ? ` (${hipps.source})` : hipps.reason ? ` — ${hipps.reason}` : ""}`,
        hipps.mismatch ? `NOTE: derived HIPPS ${hipps.derived} disagrees with the official table's ${hipps.official} — verify grouping inputs.` : "",
        hipps.lupaThreshold != null ? `Official LUPA threshold for this group: ${hipps.lupaThreshold} visits (informational).` : "",
        `Case-mix weight: ${original.caseMixWeight} · Base payment: ${money(original.basePayment)}${original.wageIndex !== 1 ? ` · wage index ${original.wageIndex}` : ""}`,
        `Draft 30-day period reimbursement: ${money(original.totalPayment)} (two-period 60-day episode if both bill: ≈ ${money(original.totalPayment * 2)} before late-period reweighting)`,
        rateBasisNote,
      ].filter(Boolean)
    : ["PDGM estimate unavailable (calculation did not run)."];

  const payerLines = [];
  if (isPdgmPriced) {
    payerLines.push("Medicare FFS / PDGM-model payer — the PDGM estimate above is the reimbursement figure.");
  } else if (payerEstimate) {
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
  }

  const docLines = [
    sourceFileUrl && `Source referral document: ${sourceFileUrl}`,
    packetUrl && `Admission packet PDF: ${packetUrl}`,
  ].filter(Boolean);

  // ── assemble email body ──
  const sections = [
    ["PATIENT SUMMARY", summaryLines],
    ["BEST CODING FOR MAXIMUM REIMBURSEMENT", codingLines],
    ["CLARIFY TO PROTECT/INCREASE REIMBURSEMENT", clarificationLines],
    [`SUGGESTED VISIT FREQUENCY — ${plan.payer.label.toUpperCase()}`, visitLines],
    ["DRAFT OASIS RESPONSES (AI pre-fill — verify at SOC)", oasisEntries.length ? oasisEntries.map(([k, v]) => `${k}: ${v}`) : ["No OASIS items pre-filled from this referral."]],
    ["PDGM GROUPING, HIPPS & DRAFT REIMBURSEMENT", pdgmLines],
    ...(payerLines.length ? [["PAYER CONTRACT ESTIMATE", payerLines]] : []),
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
    payerEstimate,
    coding,
    plan,
  };
}
