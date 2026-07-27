import test from "node:test";
import assert from "node:assert/strict";
import { checkExtractedPatientMatch } from "./documentPatientMatch.js";

test("conflicting DOB / last name / MRN → mismatch with named conflicts", () => {
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

test("MRN conflict alone is a mismatch", () => {
  const res = checkExtractedPatientMatch(
    { last_name: "Smith", medical_record_number: "MRN-100" },
    { last_name: "Smith", medical_record_number: "MRN-200" },
  );
  assert.equal(res.verdict, "mismatch");
});

test("nothing comparable → unverifiable, never a silent match", () => {
  assert.equal(checkExtractedPatientMatch({}, { first_name: "A", last_name: "B" }).verdict, "unverifiable");
});
