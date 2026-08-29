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
  assert.equal(
    deriveHippsCode({
      episodeTiming: "late", admissionSource: "institutional",
      clinicalGroup: "MMTA_Wounds", functionalLevel: "medium", comorbidityLevel: "high",
    }).hipps,
    "4FB31"
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
  assert.match(brief.emailBody, /PAYER CONTRACT ESTIMATE/);
  // SN 3w2,2w2,1w5 = 15 visits × $160 = $2400.
  assert.match(brief.emailBody, /\$2400\.00/);
  assert.match(brief.emailBody, /planned 15 vs typically approved 10 — OVER/);
  assert.match(brief.emailBody, /PDGM estimate unavailable/);
});

test("an unconfigured payer points the manager at the import page", () => {
  const brief = buildClinicalManagerBrief({
    referralData: { demographics: { insurance_primary: "Mystery Plan LLC" } },
    pdgm: null,
    payers: [],
  });
  assert.match(brief.emailBody, /No payer rate row configured for this payer — import the payer table in Admin → PDGM Rate Settings/);
});
