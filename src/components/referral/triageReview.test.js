import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalysisPdfContent,
  buildCodingReview,
  buildOrderFormModel,
  buildReviewBundle,
  formPdfContent,
  normalizeComplianceChecklist,
  packetLabel,
  sanitizeForDisplay,
} from "./triageReview.js";

/**
 * D234 pins for the referral triage review layer: the PDGM coding review
 * (justification, specificity, conflicts, candidates, documentation needs),
 * the Medicare compliance checklist, the missing-items packet with its
 * generated forms, the patient-name packet labels, and the hostile-payload
 * rule — a document MRN or an SSN-shaped string never reaches the PDF data
 * model. Fixtures are synthetic and shaped like the live Grove test packet.
 */
const ANALYSIS = {
  patient_name: "Grove, Robert E.",
  date_of_birth: "06/23/1936",
  patient_address: "PO Box 62, Mineral Point, PA 15942",
  patient_phone: "(814) 322-4273",
  referral_source: "Heritage Ridge Senior Living at Johnstown",
  referring_physician: "Dr. Craig Fockler",
  referring_physician_contact: "(814) 266-5650",
  certifying_provider: "Dr. Craig Fockler",
  payer_name: "Highmark SecurityBlue (Medicare Advantage HMO-POS)",
  face_to_face_date: "",
  face_to_face_practitioner: "",
  face_to_face_practitioner_type: "",
  start_of_care_date: "",
  primary_diagnosis: "Cellulitis of groin",
  secondary_diagnoses: ["Urinary tract infection", "Hypertension"],
  key_risk_factors: ["MRSA colonization", "Dementia with agitation"],
  clinical_summary: "SNF resident with groin cellulitis, suprapubic catheter, recurrent UTI.",
  preliminary_care_plan: {
    skilled_nursing_frequency: "3x weekly",
    initial_focus_areas: ["Wound assessment", "Catheter care"],
    medications_to_reconcile: "Celecoxib held (allergy)",
    equipment_needed: ["Catheter supplies"],
    safety_concerns: ["Two-person assist"],
    discharge_readiness: "Discharged to home with wife as caregiver",
  },
  admission_notes: "Front-load nursing visits.",
  data_gaps: ["No signed referral order in the packet"],
  diagnosis_coding_review: {
    documented_primary: "L03.314 cellulitis of groin",
    ordering_assessment:
      "The documented primary L03.314 is affirmed: the cellulitis is the reason for the skilled nursing plan of care.",
    codes: [
      {
        code: "L03.314", description: "Cellulitis of groin", position: 1,
        pdgm_role: "primary_clinical_grouping",
        justification: "The infection under active treatment that the nursing visits address.",
        documentation_support: "SNF notes (p. 4) document groin cellulitis on IV antibiotics.",
        specificity_flag: null, suggested_more_specific: null, conflict: null,
      },
      {
        code: "N39.0", description: "Urinary tract infection, site not specified", position: 2,
        pdgm_role: "comorbidity_adjustment",
        justification: "Recurrent UTI under treatment alongside the primary infection.",
        documentation_support: "Urine culture (p. 19) grew Enterobacter.",
        specificity_flag: "Site not specified: the packet does not state whether the infection is catheter-associated or its site.",
        suggested_more_specific: null, conflict: null,
      },
      {
        code: "I71.30", description: "Abdominal aortic aneurysm, ruptured", position: 3,
        pdgm_role: "comorbidity_adjustment",
        justification: "Coded on the problem list.",
        documentation_support: "Problem list (p. 2).",
        specificity_flag: null, suggested_more_specific: null,
        conflict: "The code states a RUPTURED aneurysm; the vascular note (p. 31) describes an unrepaired 7.1 cm aneurysm under surveillance. Clarification required before use.",
      },
    ],
    candidates: [
      {
        condition: "Protein-calorie malnutrition",
        candidate_code: "E44.0",
        evidence: "Dietitian note (p. 44) documents a 10 lb loss and a malnutrition assessment, but the coded list carries only E46 unspecified.",
        pdgm_relevance: "Malnutrition supports comorbidity adjustment when its severity is documented.",
        documentation_required: "The provider's documented severity (mild/moderate/severe) for the malnutrition diagnosis.",
      },
    ],
    documentation_needs: [
      {
        item: "Culture documentation identifying the UTI site/organism",
        for_code: "N39.0",
        detail: "Obtain the final urine culture report so the UTI can be coded to the documented site and organism.",
      },
    ],
  },
  medicare_compliance: {
    homebound_status: { status: "satisfied", evidence: "SNF discharge note (p. 52): two-person assist, leaves home only for medical care." },
    skilled_need: { status: "satisfied", evidence: "Daily catheter care and wound assessment ordered (p. 12)." },
    face_to_face_documented: { status: "missing", evidence: "No face-to-face encounter note appears in the packet." },
    face_to_face_timing: { status: "missing", evidence: "No encounter date is documented, so timing cannot be verified." },
    certifying_provider: { status: "satisfied", evidence: "Attending Dr. Craig Fockler (MD) identified throughout the packet." },
    referral_order: { status: "missing", evidence: "No signed home health order appears in the packet." },
    plan_of_care_elements: { status: "conflicting", evidence: "Frequencies are stated for nursing (p. 12) but no therapy evaluation order appears although PT is recommended (p. 58)." },
    diagnoses_valid: { status: "conflicting", evidence: "I71.30 conflicts with the clinical text — see the coding review." },
  },
};

test("packet rows are labeled by the patient's name once analysis exists (part E)", () => {
  assert.equal(packetLabel({ status: "ready", patient_name: "Grove, Robert E." }), "Grove, Robert E.");
  assert.equal(
    packetLabel({ status: "ready", analysis: { patient_name: "Grove, Robert E." } }),
    "Grove, Robert E.",
  );
  assert.equal(packetLabel({ status: "processing", patient_name: null }), "Analyzing packet…");
  assert.equal(packetLabel({ status: "queued" }), "Analyzing packet…");
  assert.equal(packetLabel({ status: "failed" }), "Analysis failed");
  assert.equal(packetLabel({ status: "ready", patient_name: "Not provided" }), "Referral packet");
  assert.equal(packetLabel({ status: "ready" }), "Referral packet");
});

test("the coding review carries justification, specificity, conflicts, candidates and documentation needs (part B)", () => {
  const review = buildCodingReview(ANALYSIS);
  assert.equal(review.available, true);
  assert.equal(review.source, "ai_review");
  assert.match(review.ordering_assessment, /affirmed/);
  const primary = review.codes[0];
  assert.equal(primary.code, "L03.314");
  assert.equal(primary.pdgm_role, "primary_clinical_grouping");
  assert.match(primary.justification, /infection under active treatment/);
  assert.match(primary.documentation_support, /p\. 4/);
  const uti = review.codes.find((c) => c.code === "N39.0");
  assert.match(uti.specificity_flag, /Site not specified/);
  assert.equal(uti.suggested_more_specific, null, "no specificity is suggested the packet does not document");
  const aaa = review.codes.find((c) => c.code === "I71.30");
  assert.match(aaa.conflict, /RUPTURED/);
  // The model's malnutrition candidate, plus the deterministic coder queue:
  // "Hypertension" is documented in secondary_diagnoses without a code
  // anywhere, so it is surfaced for a coder — never assigned one here.
  assert.equal(review.candidates.length, 2);
  assert.match(review.candidates[0].documentation_required, /severity/);
  assert.equal(review.candidates[1].condition, "Hypertension");
  assert.equal(review.candidates[1].candidate_code, "");
  assert.equal(review.documentation_needs[0].for_code, "N39.0");
});

test("the deterministic screen flags an unacceptable primary even when the model passed it", () => {
  const analysis = {
    ...ANALYSIS,
    diagnosis_coding_review: {
      ...ANALYSIS.diagnosis_coding_review,
      codes: [
        {
          code: "I10", description: "Essential hypertension", position: 1,
          pdgm_role: "primary_clinical_grouping",
          justification: "Model justification.",
          documentation_support: "Problem list.",
          specificity_flag: null, suggested_more_specific: null, conflict: null,
        },
      ],
    },
  };
  const review = buildCodingReview(analysis);
  assert.match(review.codes[0].deterministic_flag, /unacceptable-principal-diagnosis/);
});

test("without an AI review the deterministic layer stands in, and uncoded diagnoses become coder-queue candidates", () => {
  const review = buildCodingReview({
    primary_diagnosis: "I50.9 Heart failure",
    secondary_diagnoses: ["Dementia"],
  });
  assert.equal(review.source, "deterministic");
  assert.equal(review.available, true);
  assert.equal(review.codes[0].code, "I50.9");
  assert.equal(review.codes[0].pdgm_role, "primary_clinical_grouping");
  const candidate = review.candidates.find((c) => /Dementia/.test(c.condition));
  assert.ok(candidate, "the uncoded dementia is surfaced for a coder");
  assert.match(candidate.documentation_required, /certified coder/);
  assert.equal(candidate.candidate_code, "", "no code is invented for it");
});

test("the compliance checklist always carries all eight elements (part D)", () => {
  const checklist = normalizeComplianceChecklist(ANALYSIS);
  assert.equal(checklist.length, 8);
  assert.equal(checklist.find((e) => e.key === "referral_order").status, "missing");
  assert.equal(checklist.find((e) => e.key === "homebound_status").status, "satisfied");
  // A legacy analysis with no checklist at all still renders eight rows.
  const legacy = normalizeComplianceChecklist({ patient_name: "Legacy" });
  assert.equal(legacy.length, 8);
  assert.ok(legacy.every((e) => e.status === "missing"));
});

test("the missing-order case produces a populated, UNSIGNED order form model (part D)", () => {
  const bundle = buildReviewBundle(ANALYSIS);
  assert.ok(bundle.forms.order, "a missing referral order generates the order form");
  assert.ok(bundle.forms.f2f, "a missing face-to-face generates the F2F form");
  assert.ok(bundle.forms.cover, "non-generatable gaps generate a request cover");
  const order = bundle.forms.order;
  assert.equal(order.patient.name, "Grove, Robert E.");
  assert.equal(order.diagnoses[0].code, "L03.314");
  assert.equal(order.diagnoses[0].role, "Primary");
  assert.equal(order.disciplines[0].frequency, "3x weekly");
  assert.equal(order.certification_statements.length, 5);
  assert.ok(order.certification_statements.some((s) => /confined to the home/.test(s)));
  assert.ok(order.certification_statements.some((s) => /face-to-face encounter/.test(s)));
  assert.equal(order.signature.signed, false, "the generated order is unsigned");
  assert.match(order.generated_note, /UNSIGNED/);
  // The packet aggregates compliance gaps + data gaps + coding needs.
  const labels = bundle.missingPacket.items.map((i) => i.label).join(" | ");
  assert.match(labels, /Home health order/);
  assert.match(labels, /Face-to-face encounter documentation/);
  assert.match(labels, /Culture documentation identifying the UTI/);
  assert.match(labels, /No signed referral order in the packet/);
  assert.match(labels, /Documentation required before E44\.0/);
});

test("a complete referral produces an empty packet and no forms", () => {
  const satisfied = Object.fromEntries(
    Object.keys(ANALYSIS.medicare_compliance).map((k) => [k, { status: "satisfied", evidence: "Documented." }]),
  );
  const bundle = buildReviewBundle({
    ...ANALYSIS,
    // Diagnoses carry their codes in the text here, so the deterministic
    // harvester finds nothing uncoded left to queue.
    primary_diagnosis: "L03.314 Cellulitis of groin",
    secondary_diagnoses: ["N39.0 Urinary tract infection", "I10 Hypertension"],
    medicare_compliance: satisfied,
    data_gaps: [],
    diagnosis_coding_review: {
      ...ANALYSIS.diagnosis_coding_review,
      candidates: [],
      documentation_needs: [],
    },
  });
  assert.equal(bundle.missingPacket.total, 0);
  assert.deepEqual(bundle.forms, { order: null, f2f: null, cover: null });
});

test("hostile payloads never reach the review bundle or the PDF data model (D233 + part F)", () => {
  const hostile = {
    ...ANALYSIS,
    medical_record_number: "13383",
    clinical_summary: "Packet lists MRN 13383 and SSN 123-45-6789 for the patient.",
    admission_notes: "Call the facility about MRN: 13383.",
    diagnosis_coding_review: {
      ...ANALYSIS.diagnosis_coding_review,
      codes: ANALYSIS.diagnosis_coding_review.codes.map((c) => ({ ...c, mrn: "13383" })),
    },
  };
  const bundle = buildReviewBundle(hostile);
  const bundleJson = JSON.stringify(bundle);
  assert.equal(bundleJson.includes("13383"), false, "the document MRN reaches no review output");
  assert.equal(bundleJson.includes("123-45-6789"), false, "the SSN reaches no review output");
  const pdfJson = JSON.stringify(buildAnalysisPdfContent(hostile, bundle));
  assert.equal(pdfJson.includes("13383"), false, "the document MRN reaches no PDF content");
  assert.equal(pdfJson.includes("123-45-6789"), false, "the SSN reaches no PDF content");
  const orderJson = JSON.stringify(formPdfContent(bundle.forms.order));
  assert.equal(orderJson.includes("13383"), false, "the document MRN reaches no generated form");
  assert.match(orderJson, /Certifying provider signature: ____/);
});

test("the analysis PDF content includes the review, the checklist and the missing items (part C)", () => {
  const bundle = buildReviewBundle(ANALYSIS);
  const content = buildAnalysisPdfContent(ANALYSIS, bundle);
  const flat = JSON.stringify(content);
  assert.match(flat, /Diagnosis Coding Review \(PDGM\)/);
  assert.match(flat, /infection under active treatment/);
  assert.match(flat, /Additional Candidate Codes/);
  assert.match(flat, /Medicare Compliance Checklist/);
  assert.match(flat, /Missing Items/);
  assert.match(flat, /Home health order from the certifying provider/);
  // No urgency anywhere in the printed analysis (part A).
  assert.equal(/urgency/i.test(flat), false);
});

test("sanitizeForDisplay drops MRN keys and masks identifiers in prose", () => {
  const out = sanitizeForDisplay({
    mrn: "13383",
    nested: { medical_record_number: "13383", note: "MRN 13383, SSN 123-45-6789" },
    list: ["MRN: 998877"],
  });
  assert.deepEqual(Object.keys(out).sort(), ["list", "nested"]);
  assert.deepEqual(Object.keys(out.nested), ["note"]);
  assert.match(out.nested.note, /MRN \[not recorded\]/);
  assert.match(out.nested.note, /\[redacted\]/);
  assert.deepEqual(out.list, ["MRN [not recorded]"]);
});

test("buildOrderFormModel orders diagnoses by the review's positions", () => {
  const review = buildCodingReview(ANALYSIS);
  const order = buildOrderFormModel(ANALYSIS, review);
  assert.deepEqual(order.diagnoses.map((d) => d.code), ["L03.314", "N39.0", "I71.30"]);
});
