import test from "node:test";
import assert from "node:assert/strict";
import { faxOriginationPlan, isVerifiedOriginationRecord } from "./faxOrigination.js";
import { classifyFaxFailure } from "./faxRetry.js";

const OFFICE = "+17244650444";
const BLIND = "+17244418937";

test("only a distinct office number beside a blind line is worth verifying", () => {
  assert.deepEqual(faxOriginationPlan(OFFICE, BLIND), { from: BLIND, office: OFFICE, lookup: true });
  assert.deepEqual(faxOriginationPlan(null, BLIND), { from: BLIND, office: null, lookup: false });
  assert.deepEqual(faxOriginationPlan(BLIND, BLIND), { from: BLIND, office: null, lookup: false });
  // Legacy, pre-split configuration: the office number is the Telnyx line.
  assert.deepEqual(faxOriginationPlan(OFFICE, null), { from: OFFICE, office: null, lookup: false });
  assert.deepEqual(faxOriginationPlan(null, null), { from: null, office: null, lookup: false });
});

test("a verified-number record counts only for the exact office number with a verification time", () => {
  const record = (data) => ({ data: { phone_number: OFFICE, record_type: "verified_number", verified_at: "2020-09-14T17:03:32.965812", ...data } });
  assert.equal(isVerifiedOriginationRecord(record({}), OFFICE), true);
  assert.equal(isVerifiedOriginationRecord(record({ verified_at: undefined }), OFFICE), false);
  assert.equal(isVerifiedOriginationRecord(record({ verified_at: "" }), OFFICE), false);
  assert.equal(isVerifiedOriginationRecord(record({ verified_at: "soon" }), OFFICE), false);
  assert.equal(isVerifiedOriginationRecord(record({ phone_number: "+17244650400" }), OFFICE), false);
  assert.equal(isVerifiedOriginationRecord(record({}), null), false);
  assert.equal(isVerifiedOriginationRecord({ data: [] }, OFFICE), false);
  assert.equal(isVerifiedOriginationRecord(null, OFFICE), false);
});

test("a revoked verification surfaces as a permanent failure, never an automatic resend", () => {
  // Telnyx reports sending from a no-longer-verified office number as
  // failure_reason `unverified_origination_number`.
  assert.equal(classifyFaxFailure(null, "unverified_origination_number"), "permanent");
});
