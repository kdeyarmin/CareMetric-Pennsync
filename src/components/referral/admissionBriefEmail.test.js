import test from "node:test";
import assert from "node:assert/strict";
import { buildAdmissionBriefEmail, patientInitials, oasisItemLabel, auditGgDraft } from "./admissionBriefEmail.js";

const richReferral = {
  demographics: {
    full_name: "Jane Q. Doe",
    date_of_birth: "1948-03-02",
    address: "12 Elm St, Scranton PA",
    phone: "570-555-0100",
    emergency_contact: "John Doe",
    emergency_relationship: "spouse",
    emergency_phone: "570-555-0101",
    insurance_primary: "Medicare",
    referring_physician: "Dr. Alice Wong, MD",
  },
  admission_details: {
    referral_reason: "CHF exacerbation, homebound due to dyspnea",
    admission_source: "Hospital discharge",
    admission_date: "2026-09-02",
  },
  diagnoses: {
    primary_diagnosis: "Congestive heart failure (I50.9)",
    primary_icd10: "I50.9",
    secondary_diagnoses: ["Type 2 diabetes E11.9"],
    allergies: "Penicillin — hives",
  },
  medications: [
    { name: "Furosemide", dosage: "40 mg", frequency: "daily", route: "PO" },
    { name: "Metformin", dosage: "500 mg", frequency: "BID", route: "PO" },
  ],
  functional_status: { fall_risk: "High — 2 falls last month", ambulation: "Walker, SBA" },
  skilled_needs: {
    services_ordered: ["SN 3w2, 2w2, 1w5", "PT eval and treat"],
    frequency_duration: "SN 3w2, 2w2, 1w5",
    specific_interventions: ["Daily weights teaching", "Med reconciliation"],
    dme_supplies: ["Walker"],
    goals_of_care: "Prevent rehospitalization",
  },
  orders_treatments: { physician_orders: ["Skilled nursing for CHF management"], diet: "2g Na" },
  safety_concerns: { environmental_hazards: "Loose rugs in hallway", high_risk_conditions: ["O2 in home"] },
  wound_details: [{ wound_type: "Pressure ulcer", stage: "Stage 2", location: "sacrum" }],
  oasis_assessment: {
    m1021_primary_diagnosis: "I50.9 CHF",
    m1800_grooming: "1 - With use of assistive device",
    m1860_ambulation: "2 - Walker with supervision",
    m2010_high_risk_drugs: ["Furosemide"],
    items_needing_verification: ["M1860 — confirm device use"],
  },
  admission_note_template: "SAMPLE-NOTE: 78yo female admitted for CHF management…",
  face_to_face: {
    encounter_date: "2026-08-20",
    practitioner_name: "Dr. Alice Wong, MD",
    clinical_reason: "Congestive heart failure exacerbation follow-up",
  },
  estimated_start_date: "2026-09-02",
};

const analysis = {
  patient_summary: {
    narrative: "78-year-old with CHF exacerbation discharged home, needs diuretic titration teaching.",
    key_conditions: ["CHF", "T2DM"],
    functional_snapshot: "Ambulates with walker, SBA.",
    support_and_home: "Lives with spouse who assists.",
  },
  risk_flags: [
    { risk_type: "Fall risk", severity: "High", description: "Two recent falls" },
    { risk_type: "Language", severity: "Low", description: "None" },
  ],
  missing_information: {
    critical_missing: [{ field_name: "Insurance policy number", how_to_obtain: "Call the hospital case manager" }],
  },
  visit_estimates: { nursing_visits_first_30_days: 5, pt_visits: 4, suggested_frequency: "SN 2w2, 1w6" },
};

test("subject carries initials, never the full patient name", () => {
  const { subject } = buildAdmissionBriefEmail({ referralData: richReferral });
  assert.match(subject, /J\.D\./);
  assert.ok(!subject.includes("Jane"));
  assert.ok(!subject.includes("Doe"));
});

test("patientInitials handles Last, First and empty names", () => {
  assert.equal(patientInitials("Doe, Jane"), "D.J.");
  assert.equal(patientInitials("Cher"), "C.");
  assert.equal(patientInitials(""), "patient");
});

test("body carries every briefing section for a rich referral", () => {
  const { body } = buildAdmissionBriefEmail({
    referralData: richReferral,
    analysis,
    sourceFileUrl: "https://files.example/referral.pdf",
    packetUrl: "https://files.example/packet.pdf",
    nurseName: "Nurse Kelly, RN",
    senderName: "Dana Intake",
  });

  assert.match(body, /PROTECTED HEALTH INFORMATION/);
  assert.match(body, /ADMISSION BRIEFING — Jane Q\. Doe/);
  assert.match(body, /To: Nurse Kelly, RN/);
  assert.match(body, /Payer: Medicare \(traditional FFS — PDGM\)/);
  // Snapshot from the AI summary.
  assert.match(body, /78-year-old with CHF exacerbation/);
  // Alerts: allergies + high-severity risk first + wounds + hazards + high-risk meds.
  assert.match(body, /Allergies: Penicillin — hives/);
  assert.ok(body.indexOf("[High] Fall risk") < body.indexOf("[Low] Language"));
  assert.match(body, /Wounds \(1\): Pressure ulcer Stage 2 sacrum/);
  assert.match(body, /High-risk medications: Furosemide/);
  // Diagnoses sequenced with the harvested code.
  assert.match(body, /M1021 Primary: I50\.9/);
  assert.match(body, /M1023: E11\.9/);
  // Orders verbatim.
  assert.match(body, /Ordered frequency\/duration: SN 3w2, 2w2, 1w5/);
  assert.match(body, /DME\/Supplies: Walker/);
  // Medications.
  assert.match(body, /MEDICATIONS \(2\)/);
  assert.match(body, /Furosemide · 40 mg · daily · PO/);
  // Visit plan uses the ORDERED frequencies (not the AI estimate) + LUPA guidance.
  assert.match(body, /Ordered frequencies \(authoritative/);
  assert.match(body, /Skilled Nursing: 3\/wk × 2 wks → 2\/wk × 2 wks → 1\/wk × 5 wks/);
  assert.match(body, /Period 1 ≈ 10 visits; Period 2 ≈ 4 visits/);
  assert.match(body, /LUPA/);
  assert.ok(!body.includes("SN 2w2, 1w6"), "AI estimate must not display when frequencies are ordered");
  // Medicare snapshot present with statuses.
  assert.match(body, /MEDICARE COVERAGE SNAPSHOT/);
  assert.match(body, /\[OK\] Face-to-Face encounter/);
  // OASIS draft with humanized labels + verification flags.
  assert.match(body, /M1800 Grooming: 1 - With use of assistive device/);
  assert.match(body, /Items flagged for verification: M1860 — confirm device use/);
  // First-visit prep checklist (deterministic from orders/meds/risks).
  assert.match(body, /FIRST-VISIT PREP CHECKLIST/);
  assert.match(body, /Wound care supplies/);
  assert.match(body, /Loop diuretic — daily weights/);
  assert.match(body, /homebound narrative with BOTH elements/);
  // Documented-but-uncoded conditions to confirm (pressure ulcer is in the
  // wound record but not coded; CHF/diabetes ARE coded so they don't appear).
  assert.match(body, /CONFIRM & REPORT AT SOC/);
  assert.match(body, /Pressure ulcer: suggested by wound_details/);
  assert.ok(!/CONFIRM & REPORT AT SOC[\s\S]*Heart failure:/.test(body));
  // Sample note + missing items + document links.
  assert.match(body, /SAMPLE-NOTE: 78yo female/);
  assert.match(body, /Missing \(critical\): Insurance policy number — Call the hospital case manager/);
  assert.match(body, /Source referral document: https:\/\/files\.example\/referral\.pdf/);
  assert.match(body, /Admission packet PDF: https:\/\/files\.example\/packet\.pdf/);
  // Financial-visibility rule: no dollar figures, no case-mix weights.
  assert.ok(!/\$\d/.test(body));
  assert.ok(!/case-mix weight/i.test(body));
});

test("AI visit estimates appear (labeled) only when nothing is ordered", () => {
  const noOrders = {
    ...richReferral,
    skilled_needs: {},
    orders_treatments: {},
  };
  const { body } = buildAdmissionBriefEmail({ referralData: noOrders, analysis });
  assert.match(body, /AI planning estimate — confirm with the physician and at SOC/);
  assert.match(body, /Suggested frequency: SN 2w2, 1w6/);
  assert.match(body, /Nursing: ~5 visits days 1–30/);
});

test("a sparse referral still builds a coherent brief with fallbacks", () => {
  const { subject, body } = buildAdmissionBriefEmail({ referralData: { diagnosis: "COPD" } });
  assert.match(subject, /Admission briefing: patient/);
  assert.match(body, /ADMISSION BRIEFING — the patient/);
  assert.match(body, /Payer not identified/);
  assert.match(body, /Referral documents are available in PennSync/);
  // The Medicare snapshot surfaces what's missing rather than crashing.
  assert.match(body, /\[GAP\] Face-to-Face encounter/);
});

test("medication list is capped with an overflow marker", () => {
  const meds = Array.from({ length: 20 }, (_, i) => ({ name: `Drug${i + 1}`, dosage: "1 mg" }));
  const { body } = buildAdmissionBriefEmail({ referralData: { ...richReferral, medications: meds } });
  assert.match(body, /MEDICATIONS \(20\)/);
  assert.match(body, /Drug15/);
  assert.ok(!body.includes("Drug16 ·"));
  assert.match(body, /\(\+5 more — see the attached referral\)/);
});

test("Medicare Advantage payer swaps LUPA guidance for authorization-first notes", () => {
  const ma = {
    ...richReferral,
    demographics: { ...richReferral.demographics, insurance_primary: "Humana Medicare Advantage" },
  };
  const { body } = buildAdmissionBriefEmail({ referralData: ma });
  assert.match(body, /prior authorization and the approved visit counts BEFORE the SOC visit/i);
  assert.ok(!/Period \d.*LUPA/i.test(body));
});

test("oasisItemLabel humanizes OASIS keys", () => {
  assert.equal(oasisItemLabel("m1800_grooming"), "M1800 Grooming");
  assert.equal(oasisItemLabel("m2020_management_oral_meds"), "M2020 Management Oral Meds");
});

test("the admissionNote parameter overrides the extraction's template", () => {
  const { body } = buildAdmissionBriefEmail({ referralData: richReferral, admissionNote: "OVERRIDE-NOTE text" });
  assert.match(body, /OVERRIDE-NOTE text/);
  assert.ok(!body.includes("SAMPLE-NOTE"));
});

// ── deterministic GG draft audit (anti-hallucination guard) ──

test("auditGgDraft flags out-of-scale codes and codes drafted without a basis", () => {
  const issues = auditGgDraft({
    gg0130_self_care: {
      a_eating: "04 - supervision documented in PT note", // valid, has basis
      b_oral_hygiene: "99 - not a real GG code",          // out of scale
      c_toileting_hygiene: "03",                          // valid code, no basis
    },
    gg0170_mobility: {
      d_sit_to_stand: "not attempted",                    // prose, not a code — would display as-is
    },
  });
  // ("unknown"/"N/A"/"Not documented" are stripped by clean() and never display,
  // so they need no VERIFY line — only displayed values are audited.)
  assert.equal(issues.length, 3);
  assert.match(issues[0], /GG0130 Self Care — B\. oral hygiene/);
  assert.match(issues[0], /not on the GG scale \(01–06, 07, 09, 10, 88\)/);
  assert.match(issues[1], /GG0130 Self Care — C\. toileting hygiene/);
  assert.match(issues[1], /without a quoted basis/);
  assert.match(issues[2], /GG0170 Mobility — D\. sit to stand/);
  assert.match(issues[2], /not on the GG scale/);
});

test("auditGgDraft accepts the full documented scale (incl. single-digit and not-attempted codes) and empty input", () => {
  assert.deepEqual(
    auditGgDraft({
      gg0130_self_care: { a_eating: "6 - independent per referral", e_shower_bathe_self: "88 - unsafe per MD note" },
      gg0170_mobility: { i_walk_10_feet: "07 - refused per therapy note" },
    }),
    []
  );
  assert.deepEqual(auditGgDraft({}), []);
  assert.deepEqual(auditGgDraft(null), []);
  assert.deepEqual(auditGgDraft({ gg0130_self_care: "not an object" }), []);
});

test("an invalid GG draft surfaces as a VERIFY line in the briefing email", () => {
  const { body } = buildAdmissionBriefEmail({
    referralData: {
      ...richReferral,
      oasis_assessment: { gg0130_self_care: { a_eating: "42 - fabricated code" } },
    },
  });
  assert.match(body, /VERIFY: GG0130 Self Care — A\. eating: "42 - fabricated code" is not on the GG scale/);
});
