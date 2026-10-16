import test from "node:test";
import assert from "node:assert/strict";
import { checkExtractedPatientMatch } from "./documentPatientMatch.js";

test("conflicting DOB / last name → mismatch with named conflicts", () => {
  const res = checkExtractedPatientMatch(
    { first_name: "John", last_name: "Smith", date_of_birth: "1950-04-15" },
    { first_name: "Mary", last_name: "Jones", date_of_birth: "1948-01-02" },
  );
  assert.equal(res.verdict, "mismatch");
  assert.ok(res.conflicts.length >= 2);
});

test("same person across formats and accents → match", () => {
  const res = checkExtractedPatientMatch(
    { first_name: "José", last_name: "García", date_of_birth: "04/15/1950" },
    { first_name: "Jose", last_name: "Garcia", date_of_birth: "1950-04-15" },
  );
  assert.equal(res.verdict, "match");
  assert.deepEqual(res.conflicts, []);
});

test("hyphenated married name and nickname initial are tolerated", () => {
  assert.equal(
    checkExtractedPatientMatch(
      { first_name: "Bob", last_name: "Smith" },
      { first_name: "Bobby", last_name: "Smith-Jones" },
    ).verdict,
    "match",
  );
});

test("a document MRN is never compared, so it can never conflict (D233)", () => {
  // The document's "MRN-100" is the sending facility's record number and the
  // chart's "MRN-200" is PennSync's own (MatrixCare-assigned): different
  // systems, so the difference is not an identity conflict.
  const res = checkExtractedPatientMatch(
    { last_name: "Smith", medical_record_number: "MRN-100", mrn: "MRN-100" },
    { last_name: "Smith", medical_record_number: "MRN-200" },
  );
  assert.equal(res.verdict, "match");
  assert.deepEqual(res.conflicts, []);
  assert.ok(!res.compared.includes("MRN"));
});

test("a hostile payload whose MRN differs cannot block a name+DOB match (D233)", () => {
  const res = checkExtractedPatientMatch(
    { first_name: "Robert", last_name: "Grove", date_of_birth: "1936-06-23", medical_record_number: "13383" },
    { first_name: "Robert", last_name: "Grove", date_of_birth: "1936-06-23", medical_record_number: "MC-4471" },
  );
  assert.equal(res.verdict, "match");
  assert.deepEqual(res.conflicts, []);
});

test("nothing comparable → unverifiable, never a silent match", () => {
  assert.equal(checkExtractedPatientMatch({}, { first_name: "A", last_name: "B" }).verdict, "unverifiable");
});
