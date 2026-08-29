import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveHippsCode,
  buildPdgmRequestFromReferral,
  collectRevenueClarifications,
  buildClinicalManagerBrief,
} from "./clinicalManagerBrief.js";

// ── HIPPS derivation ──

test("derives the HIPPS code positionally from the five grouping variables", () => {
  assert.equal(
    deriveHippsCode({
      episodeTiming: "early", admissionSource: "institutional",
      clinicalGroup: "MMTA_Cardiac_Circulatory", functionalLevel: "high", comorbidityLevel: "low",
    }).hipps,
    "2HC21"
  );
  assert.equal(
    deriveHippsCode({
      episodeTiming: "early", admissionSource: "community",
      clinicalGroup: "MMTA_Other", functionalLevel: "low", comorbidityLevel: "none",
    }).hipps,
    "1AA11"
  );
  // Verified against the official CMS CY2026 file: late/institutional Wound,
  // medium functional, interaction comorbidity is HIPPS 4CB31 (weight 1.7520).
  assert.equal(
    deriveHippsCode({
      episodeTiming: "late", admissionSource: "institutional",
      clinicalGroup: "MMTA_Wounds", functionalLevel: "medium", comorbidityLevel: "high",
    }).hipps,
    "4CB31"
  );
});

test("groups without a CMS counterpart or incomplete variables never fabricate a HIPPS", () => {
  const medMgmt = deriveHippsCode({
    episodeTiming: "early", admissionSource: "community",
    clinicalGroup: "MMTA_Medication_Management", functionalLevel: "low", comorbidityLevel: "none",
  });
  assert.equal(medMgmt.hipps, null);
  assert.match(medMgmt.reason, /no CMS clinical-group counterpart/);

  const incomplete = deriveHippsCode({ episodeTiming: "early", admissionSource: "community" });
  assert.equal(incomplete.hipps, null);
  assert.match(incomplete.reason, /Incomplete grouping variables/);
});

// ── PDGM request construction ──

const referral = {
  demographics: { full_name: "Jane Q. Doe", insurance_primary: "Medicare" },
  admission_details: { admission_source: "Hospital discharge", admission_date: "2026-09-02" },
  diagnoses: {
    primary_diagnosis: "Congestive heart failure",
    primary_icd10: "I50.9",
    secondary_diagnoses: ["Type 2 diabetes E11.9"],
  },
  skilled_needs: { frequency_duration: "SN 3w2, 2w2, 1w5" },
  oasis_assessment: {
    m1800_grooming: "1 - With use of assistive device",
    m1830_bathing: "3 - Intermittent assistance",
    m1860_ambulation: "2 - Walker with supervision",
    m1021_primary_diagnosis: "I50.9 CHF",
  },
};

test("buildPdgmRequestFromReferral grounds the request in the harvested coding and draft OASIS", () => {
  const req = buildPdgmRequestFromReferral(referral);
  assert.equal(req.primary_diagnosis_code, "I50.9");
  assert.match(req.primary_diagnosis, /I50\.9/);
  assert.equal(req.admission_source, "institutional");
  assert.equal(req.episode_timing, "early");
  assert.equal(req.functional_scores.m1860_ambulation, "2 - Walker with supervision");
  assert.ok(req.comorbidities.some((c) => c.includes("E11.9")));
  assert.equal(req.soc_date, "2026-09-02");
});

test("comorbidities are CODED secondaries only, deduped — never the raw text twice, never uncoded prose", () => {
  // calculatePDGM counts each entry independently, so the same condition
  // passed as codeLabel AND as raw secondary text would double-count and
  // could inflate the comorbidity level (low → high).
  const req = buildPdgmRequestFromReferral(referral);
  const diabetesEntries = req.comorbidities.filter((c) => /E11\.9|diabetes/i.test(c));
  assert.equal(diabetesEntries.length, 1, "one condition must appear exactly once");
  // An uncoded documented condition stays out of the payment inputs (it is
  // flagged as a coder query in the clarifications instead).
  const withUncoded = {
    ...referral,
    diagnoses: { ...referral.diagnoses, secondary_diagnoses: ["Type 2 diabetes E11.9", "congestive heart failure, uncoded"] },
  };
  const req2 = buildPdgmRequestFromReferral(withUncoded);
  assert.ok(!req2.comorbidities.some((c) => /uncoded/i.test(c)), "uncoded prose must not reach the payment estimate");
});

// ── clarifications ──

test("collectRevenueClarifications aggregates coding, PDGM, F2F, and eligibility gaps without duplicates", () => {
  const items = collectRevenueClarifications({
    coding: {
      warnings: ["W1"],
      uncoded: [{ description: "Right hip pain" }],
    },
    pdgm: {
      original: { comorbidityLevel: "none" },
      dataValidation: {
        discrepancies: [
          { message: "M1000 suggests institutional", evidence: "M1000: 02", revenueImpact: "Institutional pays more" },
        ],
      },
    },
    eligibility: { missingForAdmission: ["Face-to-Face encounter note from the certifying practitioner"] },
    f2f: null,
    analysis: { missing_information: { critical_missing: [{ field_name: "Insurance ID", how_to_obtain: "Call hospital" }] } },
  });
  const details = items.map((i) => i.detail).join("\n");
  assert.match(details, /W1/);
  assert.match(details, /Right hip pain/);
  assert.match(details, /M1000 suggests institutional \(M1000: 02\) — Institutional pays more/);
  assert.match(details, /No comorbidity adjustment/);
  assert.match(details, /No Face-to-Face encounter documented/);
  assert.match(details, /Insurance ID — Call hospital/);
  // No duplicate lines.
  assert.equal(new Set(items.map((i) => `${i.area}|${i.detail}`)).size, items.length);
});

// ── full brief ──

const pdgmResponse = {
  rateBasis: { isOfficial: false, isEstimate: true, basePayment: 2038.22 },
  original: {
    clinicalGroup: "MMTA_Cardiac_Circulatory",
    admissionSource: "institutional",
    episodeTiming: "early",
    functionalLevel: "high",
    functionalPoints: 6,
    comorbidityLevel: "low",
    caseMixWeight: 1.4823,
    basePayment: 2038.22,
    wageIndex: 1,
    totalPayment: 3021.24,
  },
  dataValidation: { discrepancies: [] },
};

test("buildClinicalManagerBrief assembles every requested section with HIPPS and the draft rate", () => {
  const brief = buildClinicalManagerBrief({
    referralData: referral,
    analysis: { patient_summary: { narrative: "78yo with CHF exacerbation." } },
    pdgm: pdgmResponse,
    preparedBy: "Dana Intake",
    sourceFileUrl: "https://files.example/referral.pdf",
  });

  // Subject: initials only.
  assert.match(brief.subject, /J\.D\./);
  assert.ok(!brief.subject.includes("Jane"));

  const body = brief.emailBody;
  assert.match(body, /PATIENT SUMMARY/);
  assert.match(body, /78yo with CHF exacerbation/);
  assert.match(body, /BEST CODING FOR MAXIMUM REIMBURSEMENT/);
  assert.match(body, /M1021 Primary: I50\.9/);
  assert.match(body, /case-mix weight/);
  assert.match(body, /CLARIFY TO PROTECT\/INCREASE REIMBURSEMENT/);
  assert.match(body, /SUGGESTED VISIT FREQUENCY — MEDICARE/);
  assert.match(body, /3\/wk × 2 wks/);
  assert.match(body, /DRAFT OASIS RESPONSES/);
  assert.match(body, /M1860 Ambulation/);
  assert.match(body, /PDGM GROUPING, HIPPS & DRAFT REIMBURSEMENT/);
  // Derived HIPPS: early+institutional=2, Cardiac=H, high=C, low comorbidity=2.
  assert.match(body, /HIPPS: 2HC21 \(derived from grouping variables\)/);
  assert.match(body, /\$3021\.24/);
  assert.match(body, /DRAFT ESTIMATE — based on approximate case-mix weights/);
  assert.match(body, /Source referral document/);

  // PDF content mirrors the sections; OASIS renders as a table.
  const headings = brief.pdfContent.filter((c) => c.type === "heading").map((c) => c.text);
  assert.ok(headings.includes("PDGM GROUPING, HIPPS & DRAFT REIMBURSEMENT"));
  const oasisTable = brief.pdfContent.find((c) => c.type === "table");
  assert.ok(oasisTable.rows.some(([label]) => label === "M1860 Ambulation"));
  assert.equal(brief.hipps.code, "2HC21");
});

test("the official CMS table's HIPPS is preferred and a mismatch is flagged", () => {
  const stored = {
    rows: {
      // caseMixKey: timing|admissionSource|CMS group name|functional|comorbidity
      "early|institutional|MMTA - Cardiac and Circulatory|high|low": { weight: 1.5, hipps: "2HC29", lupaThreshold: 5 },
    },
  };
  const brief = buildClinicalManagerBrief({ referralData: referral, pdgm: pdgmResponse, storedWeightTable: stored });
  assert.equal(brief.hipps.official, "2HC29");
  assert.equal(brief.hipps.code, "2HC29");
  assert.equal(brief.hipps.mismatch, true);
  assert.match(brief.emailBody, /official CMS case-mix table/);
  assert.match(brief.emailBody, /disagrees with the official table/);
  assert.match(brief.emailBody, /Official LUPA threshold for this group: 5 visits/);
});

test("a contract payer gets the imported-table estimate and auth comparison instead of PDGM", () => {
  const maReferral = {
    ...referral,
    demographics: { ...referral.demographics, insurance_primary: "Aetna Medicare Advantage" },
  };
  const payers = [
    {
      payer_name: "Aetna Medicare Advantage",
      payer_type: "medicare_advantage",
      payment_model: "per_visit",
      per_visit_rates: { SN: 160 },
      approved_visits: { SN: 10 },
      match_terms: ["aetna"],
    },
  ];
  const brief = buildClinicalManagerBrief({ referralData: maReferral, pdgm: null, payers });
  // Non-PDGM payer: the revenue section comes from the payer table, and the
  // PDGM/HIPPS section is absent entirely.
  assert.match(brief.emailBody, /REVENUE ESTIMATE — AETNA MEDICARE ADVANTAGE/);
  assert.ok(!brief.emailBody.includes("PDGM GROUPING, HIPPS"));
  assert.equal(brief.isPdgmPriced, false);
  assert.equal(brief.hipps.code, null);
  assert.match(brief.hipps.reason, /Non-Medicare payer/);
  // SN 3w2,2w2,1w5 = 15 visits × $160 = $2400.
  assert.match(brief.emailBody, /\$2400\.00/);
  assert.match(brief.emailBody, /planned 15 vs typically approved 10 — OVER/);
});

test("a LUPA-risk period quantifies the revenue at risk against the known period payment", () => {
  // SN 3w2, 2w2, 1w5 → period 2 lands at 4 visits (inside the 2–6 LUPA band).
  const brief = buildClinicalManagerBrief({ referralData: referral, pdgm: pdgmResponse });
  assert.match(
    brief.emailBody,
    /Revenue at risk: a LUPA in period 2 forfeits the full \$3021\.24 period payment/
  );
  assert.match(brief.emailBody, /One added medically necessary visit may clear the threshold/);
});

test("documented-but-uncoded comorbidity signals land in the clarification list", () => {
  const withSignals = {
    ...referral,
    diagnoses: { primary_diagnosis: "Hip fracture", primary_icd10: "S72.001A", secondary_diagnoses: [] },
    medications: [{ name: "Metformin", dosage: "500 mg" }],
  };
  const brief = buildClinicalManagerBrief({ referralData: withSignals, pdgm: null });
  assert.match(brief.emailBody, /\[Comorbidity capture\] Diabetes \(medium-value signal\)/);
  assert.match(brief.emailBody, /medications: "Metformin 500 mg"|medications: "Metformin"/);
});

test("a matched CBSA wage index renders its provenance line", () => {
  const brief = buildClinicalManagerBrief({
    referralData: referral,
    pdgm: pdgmResponse,
    wageIndexMatch: { wage_index: 0.8412, cbsa: "42540", label: "Scranton PA", matchedBy: "zip" },
  });
  assert.match(brief.emailBody, /Wage index 0\.8412 applied for Scranton PA \(matched by zip from the patient's address\)/);
});

test("visit costs produce the episode margin in the PDGM section", () => {
  // SN 3w2,2w2,1w5 = 15 visits; revenue ≈ 3021.24 × 2 = 6042.48.
  const brief = buildClinicalManagerBrief({
    referralData: referral,
    pdgm: pdgmResponse,
    visitCosts: { SN: 95 },
  });
  assert.match(brief.emailBody, /Estimated episode visit cost: \$1425\.00 \(SN 15 × \$95\.00\)/);
  assert.match(brief.emailBody, /Estimated episode margin: \$4617\.48 \(76\.4%\) — revenue \$6042\.48 − visit cost \$1425\.00/);
});

test("contract payers get the margin against the contract revenue; no costs degrades to a note", () => {
  const maReferral = {
    ...referral,
    demographics: { ...referral.demographics, insurance_primary: "Aetna Medicare Advantage" },
  };
  const payers = [
    { payer_name: "Aetna MA", payer_type: "medicare_advantage", payment_model: "per_visit", per_visit_rates: { SN: 160 }, approved_visits: {}, match_terms: ["aetna"] },
  ];
  const withCosts = buildClinicalManagerBrief({ referralData: maReferral, pdgm: null, payers, visitCosts: { SN: 95 } });
  // Revenue $2400 (15 × $160) − cost $1425 = $975.
  assert.match(withCosts.emailBody, /Estimated episode margin: \$975\.00/);

  const noCosts = buildClinicalManagerBrief({ referralData: maReferral, pdgm: null, payers, visitCosts: {} });
  assert.match(noCosts.emailBody, /No per-visit costs entered/);
});

test("GG draft items render with humanized labels in the OASIS table", () => {
  const withGg = {
    ...referral,
    oasis_assessment: {
      ...referral.oasis_assessment,
      gg0170_mobility: { d_sit_to_stand: "03 - needs partial assist", i_walk_10_feet: "04 - supervision" },
    },
  };
  const brief = buildClinicalManagerBrief({ referralData: withGg, pdgm: pdgmResponse });
  assert.match(brief.emailBody, /GG0170 Mobility: D\. sit to stand: 03 - needs partial assist · I\. walk 10 feet: 04 - supervision/);
  const oasisTable = brief.pdfContent.find((c) => c.type === "table");
  assert.ok(oasisTable.rows.some(([label]) => label === "GG0170 Mobility"));
});

test("a 30-day episodic contract's margin revenue is scaled to the 60-day plan", () => {
  const maReferral = {
    ...referral,
    demographics: { ...referral.demographics, insurance_primary: "Aetna Medicare Advantage" },
  };
  const payers = [
    { payer_name: "Aetna MA", payer_type: "medicare_advantage", payment_model: "episodic", episode_rate: 1500, episode_length_days: 30, per_visit_rates: {}, approved_visits: {}, match_terms: ["aetna"] },
  ];
  const brief = buildClinicalManagerBrief({ referralData: maReferral, pdgm: null, payers, visitCosts: { SN: 95 } });
  // The reimbursement estimate itself stays the contracted 30-day rate…
  assert.match(brief.emailBody, /Estimated episode reimbursement \(Aetna MA\): \$1500\.00/);
  // …but the margin covers the 60-day costed plan: revenue 1500×2 − cost 15×95.
  assert.match(brief.emailBody, /Estimated episode margin: \$1575\.00 .*— revenue \$3000\.00 − visit cost \$1425\.00/);
  assert.match(brief.emailBody, /scales the contracted 30-day episodic rate ×2 to cover the 60-day visit plan/);
});

test("an out-of-scale GG draft code is flagged VERIFY in the email body and the PDF", () => {
  const withBadGg = {
    ...referral,
    oasis_assessment: {
      ...referral.oasis_assessment,
      gg0130_self_care: { a_eating: "77 - not a GG code" },
    },
  };
  const brief = buildClinicalManagerBrief({ referralData: withBadGg, pdgm: pdgmResponse });
  assert.match(brief.emailBody, /VERIFY: GG0130 Self Care — A\. eating: "77 - not a GG code" is not on the GG scale/);
  const tableIdx = brief.pdfContent.findIndex((c) => c.type === "table");
  assert.ok(tableIdx >= 0);
  assert.match(brief.pdfContent[tableIdx + 1].text, /VERIFY: GG0130 Self Care/);
});

test("an unconfigured payer points the manager at the import page", () => {
  const brief = buildClinicalManagerBrief({
    referralData: { demographics: { insurance_primary: "Mystery Plan LLC" } },
    pdgm: null,
    payers: [],
  });
  assert.match(brief.emailBody, /No payer rate row configured for this payer — import the payer table in Admin → PDGM Rate Settings/);
});
