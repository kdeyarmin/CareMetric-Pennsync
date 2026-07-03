import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFaxNumber,
  extractSignals,
  scoreSignals,
  bestFaxBackMatch,
  FORM_MARKER,
} from "./followUpFaxMatcher.js";

const CANDIDATES = [
  { id: "ref1", patientName: "Mary Test", patientDob: "1941-02-03", providerName: "Dr. Adams", sentToNumber: "+15551230001" },
  { id: "ref2", patientName: "John Sample", patientDob: "1950-06-15", providerName: "Dr. Baker", sentToNumber: "+15551230002" },
];

test("normalizeFaxNumber keeps the last 10 digits", () => {
  assert.equal(normalizeFaxNumber("+1 (555) 123-0001"), "5551230001");
  assert.equal(normalizeFaxNumber("5551230001"), "5551230001");
  assert.equal(normalizeFaxNumber(""), "");
});

test("signals: form marker, name, dob, sender number all detected", () => {
  const signals = extractSignals(
    {
      ocrText: `Home Health Referral — Additional Information Request\nRe: Mary Test, DOB 02/03/1941 ...`,
      senderNumber: "15551230001",
    },
    CANDIDATES[0]
  );
  assert.equal(signals.form_marker, true);
  assert.equal(signals.patient_name, true);
  assert.equal(signals.patient_dob, true);
  assert.equal(signals.sender_number, true);
  assert.equal(scoreSignals(signals), 4);
});

test("confident auto-match requires patient name plus corroboration", () => {
  const confident = bestFaxBackMatch(
    { ocrText: `${FORM_MARKER} for Mary Test`, senderNumber: "0000000000" },
    CANDIDATES
  );
  assert.equal(confident.candidate.id, "ref1");
  assert.equal(confident.confident, true);

  // Name alone (no corroborating signal): a suggestion, never an auto-attach.
  const nameOnly = bestFaxBackMatch(
    { ocrText: "cover sheet regarding Mary Test", senderNumber: "0000000000" },
    CANDIDATES
  );
  assert.equal(nameOnly.candidate.id, "ref1");
  assert.equal(nameOnly.confident, false);
});

test("form marker alone (no identifying signal) matches nothing", () => {
  const result = bestFaxBackMatch(
    { ocrText: `random fax mentioning ${FORM_MARKER} only`, senderNumber: "0000000000" },
    CANDIDATES
  );
  assert.equal(result, null);
});

test("sender number + marker without a readable name is identifying but not confident", () => {
  const result = bestFaxBackMatch(
    { ocrText: `${FORM_MARKER} — [illegible handwriting]`, senderNumber: "+15551230002" },
    CANDIDATES
  );
  assert.equal(result.candidate.id, "ref2");
  assert.equal(result.signals.sender_number, true);
  assert.equal(result.confident, false); // no patient-name confirmation
});

test("a tie between two referrals is demoted to non-confident", () => {
  const twins = [
    { id: "a", patientName: "Pat Doe", sentToNumber: "1" },
    { id: "b", patientName: "Pat Doe", sentToNumber: "2" },
  ];
  const result = bestFaxBackMatch(
    { ocrText: `${FORM_MARKER} Pat Doe`, senderNumber: "0000000000" },
    twins
  );
  assert.equal(result.confident, false);
  assert.equal(result.tied, true);
});

test("single-word patient names never count as a name match", () => {
  const result = bestFaxBackMatch(
    { ocrText: `${FORM_MARKER} Mary`, senderNumber: "0000000000" },
    [{ id: "x", patientName: "Mary", sentToNumber: "9" }]
  );
  assert.equal(result, null);
});

test("dob matches common renderings", () => {
  const withSlashes = extractSignals(
    { ocrText: "dob: 2/3/1941", senderNumber: "" },
    CANDIDATES[0]
  );
  assert.equal(withSlashes.patient_dob, true);
  const iso = extractSignals(
    { ocrText: "dob 1941-02-03", senderNumber: "" },
    CANDIDATES[0]
  );
  assert.equal(iso.patient_dob, true);
});
