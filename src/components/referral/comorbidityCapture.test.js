import test from "node:test";
import assert from "node:assert/strict";
import { collectComorbidityCapture } from "./comorbidityCapture.js";

const byKey = (r, key) => r.opportunities.find((o) => o.key === key);

test("medication signals surface conditions that are documented but never coded", () => {
  const r = collectComorbidityCapture({
    diagnoses: { primary_diagnosis: "Fracture of femur S72.001A", secondary_diagnoses: [] },
    medications: [
      { name: "Metformin", dosage: "500 mg" },
      { name: "Furosemide", dosage: "40 mg" },
      { name: "Donepezil", dosage: "10 mg" },
    ],
  });
  assert.ok(byKey(r, "diabetes"), "metformin → diabetes query");
  assert.ok(byKey(r, "heart_failure"), "furosemide → heart failure query");
  assert.ok(byKey(r, "dementia"), "donepezil → dementia query");
  // High-value opportunities sort first.
  assert.equal(r.opportunities[0].value, "high");
  assert.equal(r.highValueCount, 2);
  assert.equal(r.mediumValueCount, 1);
});

test("a condition already CODED in the referral is never re-queried", () => {
  const r = collectComorbidityCapture({
    diagnoses: {
      primary_diagnosis: "CHF I50.9",
      primary_icd10: "I50.9",
      secondary_diagnoses: ["E11.9 Type 2 diabetes"],
    },
    medications: [{ name: "Furosemide" }, { name: "Insulin glargine (Lantus)" }],
  });
  assert.equal(byKey(r, "heart_failure"), undefined);
  assert.equal(byKey(r, "diabetes"), undefined);
});

test("a condition NAMED in the diagnosis text (even uncoded) is treated as captured", () => {
  const r = collectComorbidityCapture({
    diagnoses: { primary_diagnosis: "Congestive heart failure", secondary_diagnoses: ["Type 2 diabetes mellitus"] },
    medications: [{ name: "Furosemide" }, { name: "Metformin" }],
  });
  assert.equal(byKey(r, "heart_failure"), undefined);
  assert.equal(byKey(r, "diabetes"), undefined);
});

test("prose signals count only when unnegated in their clause", () => {
  const r = collectComorbidityCapture({
    admission_details: { referral_reason: "Weakness after fall. Denies COPD; no dialysis. On home oxygen at 2L for chronic bronchitis." },
    diagnoses: { primary_diagnosis: "Muscle weakness M62.81" },
  });
  // "home oxygen ... chronic bronchitis" is a real unnegated respiratory signal.
  assert.ok(byKey(r, "copd_respiratory"));
  // "no dialysis" must NOT produce a renal query.
  assert.equal(byKey(r, "ckd_renal"), undefined);
});

test("a documented pressure ulcer in wound_details without L89 raises the wound query", () => {
  const r = collectComorbidityCapture({
    diagnoses: { primary_diagnosis: "Diabetes E11.9" },
    wound_details: [{ wound_type: "Pressure ulcer", stage: "Stage 3", location: "sacrum" }],
  });
  const w = byKey(r, "pressure_ulcer");
  assert.ok(w);
  assert.equal(w.value, "high");
  assert.equal(w.evidence[0].source, "wound_details");

  const coded = collectComorbidityCapture({
    diagnoses: { primary_diagnosis: "Pressure ulcer of sacral region L89.153" },
    wound_details: [{ wound_type: "Pressure ulcer", stage: "Stage 3" }],
  });
  assert.equal(byKey(coded, "pressure_ulcer"), undefined);
});

test("anticoagulant without a coded indication asks for the indication", () => {
  const r = collectComorbidityCapture({
    diagnoses: { primary_diagnosis: "CVA I63.9" },
    medications: [{ name: "Eliquis", dosage: "5 mg BID" }],
  });
  const a = byKey(r, "afib_anticoagulation");
  assert.ok(a);
  assert.match(a.suggestion, /indication/);
});

test("past-medical-history entries are scanned as prose", () => {
  const r = collectComorbidityCapture({
    diagnoses: { primary_diagnosis: "Hip fracture S72.001A" },
    // Full-extraction PMH shape: objects with condition/current_status.
    ...{ diagnoses: { primary_diagnosis: "Hip fracture S72.001A", past_medical_history: [{ condition: "Parkinson's disease", current_status: "stable" }] } },
  });
  assert.ok(byKey(r, "parkinsons"));
});

test("empty or unwrapped input yields no opportunities without crashing", () => {
  assert.deepEqual(collectComorbidityCapture(null).opportunities, []);
  assert.deepEqual(collectComorbidityCapture({}).opportunities, []);
  const wrapped = collectComorbidityCapture({ extracted_data: { medications: [{ name: "Metformin" }], diagnoses: {} } });
  assert.ok(wrapped.opportunities.some((o) => o.key === "diabetes"));
});

test("evidence lists are capped at 3 entries per opportunity", () => {
  const r = collectComorbidityCapture({
    diagnoses: { primary_diagnosis: "Weakness M62.81" },
    medications: [
      { name: "Insulin lispro (Humalog)" },
      { name: "Insulin glargine (Lantus)" },
      { name: "Metformin" },
      { name: "Glipizide" },
    ],
    admission_details: { referral_reason: "Blood sugars running high, sliding scale in place" },
  });
  assert.equal(byKey(r, "diabetes").evidence.length, 3);
});
