import test from "node:test";
import assert from "node:assert/strict";
import { assessMedicareEligibility, CRITERION_STATUS } from "./medicareEligibility.js";
import { validateFaceToFace } from "./faceToFaceValidator.js";

const byKey = (result, key) => result.criteria.find((c) => c.key === key);

const solidReferral = {
  demographics: {
    insurance_primary: "Medicare",
    referring_physician: "Dr. Alice Wong, MD",
  },
  admission_details: { referral_reason: "CHF exacerbation, homebound due to dyspnea, taxing effort to leave home" },
  skilled_needs: {
    services_ordered: ["SN 3w2, 2w2, 1w5", "PT 2w4"],
    frequency_duration: "SN 3w2, 2w2, 1w5",
  },
  orders_treatments: { physician_orders: ["Skilled nursing for CHF management", "PT eval and treat"] },
};

const validF2F = validateFaceToFace({
  encounter: {
    encounter_date: "2026-08-20",
    practitioner_name: "Dr. Alice Wong, MD",
    clinical_reason: "Congestive heart failure exacerbation follow-up",
  },
  socDate: "2026-08-25",
  primaryDiagnosis: "Congestive heart failure",
});

test("a complete Medicare referral is supported across all criteria", () => {
  const r = assessMedicareEligibility(solidReferral, validF2F);
  assert.equal(r.applicable, true);
  assert.equal(r.overall, "supported");
  assert.deepEqual(r.missingForAdmission, []);
  for (const c of r.criteria) assert.equal(c.status, CRITERION_STATUS.MET, c.key);
});

test("missing F2F is a hard gap with an admission action item", () => {
  const r = assessMedicareEligibility(solidReferral, null);
  assert.equal(byKey(r, "face_to_face").status, CRITERION_STATUS.NOT_MET);
  assert.equal(r.overall, "gaps");
  assert.ok(r.missingForAdmission.some((m) => m.includes("Face-to-Face")));
});

test("an invalid F2F is a hard gap; a needs_review F2F is review-only", () => {
  const invalid = { status: "invalid", reasons: ["Ineligible practitioner type (RN)."] };
  const rInvalid = assessMedicareEligibility(solidReferral, invalid);
  assert.equal(byKey(rInvalid, "face_to_face").status, CRITERION_STATUS.NOT_MET);

  const review = { status: "needs_review", reasons: ["Practitioner credential could not be determined — needs review."] };
  const rReview = assessMedicareEligibility(solidReferral, review);
  assert.equal(byKey(rReview, "face_to_face").status, CRITERION_STATUS.NEEDS_REVIEW);
  assert.equal(rReview.overall, "needs_review");
});

test("no qualifying skilled service is a hard gap", () => {
  const r = assessMedicareEligibility(
    { demographics: { insurance_primary: "Medicare" }, skilled_needs: { services_ordered: ["companion care"] } },
    validF2F
  );
  assert.equal(byKey(r, "skilled_service").status, CRITERION_STATUS.NOT_MET);
  assert.ok(r.missingForAdmission.some((m) => m.includes("skilled service")));
});

test("OT-only referrals flag the initial-eligibility nuance", () => {
  const r = assessMedicareEligibility(
    {
      demographics: { insurance_primary: "Medicare" },
      skilled_needs: { services_ordered: ["Occupational therapy eval and treat"] },
    },
    validF2F
  );
  const c = byKey(r, "skilled_service");
  assert.equal(c.status, CRITERION_STATUS.NEEDS_REVIEW);
  assert.match(c.detail, /OT alone/);
});

test("homebound support in functional status counts; absence routes to SOC confirmation", () => {
  const supported = assessMedicareEligibility(
    { ...solidReferral, admission_details: {}, functional_status: { ambulation: "wheelchair-bound, max assist to ambulate" } },
    validF2F
  );
  assert.equal(byKey(supported, "homebound").status, CRITERION_STATUS.MET);

  const absent = assessMedicareEligibility(
    { ...solidReferral, admission_details: { referral_reason: "CHF exacerbation" } },
    validF2F
  );
  assert.equal(byKey(absent, "homebound").status, CRITERION_STATUS.NEEDS_REVIEW);
  assert.ok(absent.missingForAdmission.some((m) => m.includes("Homebound")));
});

test("missing orders or physician routes the certification criterion to review", () => {
  const r = assessMedicareEligibility(
    { demographics: { insurance_primary: "Medicare" }, skilled_needs: { services_ordered: ["SN 2w4"] } },
    validF2F
  );
  const c = byKey(r, "orders");
  assert.equal(c.status, CRITERION_STATUS.NEEDS_REVIEW);
  assert.match(c.detail, /practitioner/);
});

test("open-ended daily nursing trips the intermittent-care bound", () => {
  const r = assessMedicareEligibility(
    { ...solidReferral, skilled_needs: { services_ordered: ["SN daily"], frequency_duration: "SN daily" } },
    validF2F
  );
  const c = byKey(r, "intermittent");
  assert.equal(c.status, CRITERION_STATUS.NEEDS_REVIEW);
  assert.match(c.detail, /no end date/);
});

test("daily nursing beyond 21 days trips the bound; bounded daily passes", () => {
  const long = assessMedicareEligibility(
    { ...solidReferral, skilled_needs: { frequency_duration: "SN daily x 5 weeks", services_ordered: [] } },
    validF2F
  );
  assert.equal(byKey(long, "intermittent").status, CRITERION_STATUS.NEEDS_REVIEW);

  const bounded = assessMedicareEligibility(
    { ...solidReferral, skilled_needs: { frequency_duration: "SN daily x 14 days", services_ordered: [] } },
    validF2F
  );
  assert.equal(byKey(bounded, "intermittent").status, CRITERION_STATUS.MET);
});

test("non-Medicare payers are marked not applicable but still assessed", () => {
  const r = assessMedicareEligibility(
    { ...solidReferral, demographics: { ...solidReferral.demographics, insurance_primary: "Highmark BCBS" } },
    validF2F
  );
  assert.equal(r.applicable, false);
  assert.equal(r.criteria.length, 5);
});

test("Medicare Advantage applies the criteria (applicable)", () => {
  const r = assessMedicareEligibility(
    { ...solidReferral, demographics: { ...solidReferral.demographics, insurance_primary: "Humana Medicare Advantage" } },
    validF2F
  );
  assert.equal(r.applicable, true);
});

test("handles the Referral entity extracted_data wrapper and empty input", () => {
  const wrapped = assessMedicareEligibility({ extracted_data: solidReferral }, validF2F);
  assert.equal(wrapped.overall, "supported");

  const empty = assessMedicareEligibility({}, null);
  assert.equal(empty.overall, "gaps");
  assert.ok(empty.missingForAdmission.length >= 2);
});
