import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFaxNumber,
  extractSignals,
  scoreSignals,
  bestFaxBackMatch,
  applyFaxAnswersToItems,
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

// ── Regression: whole-word matching + OCR dates (2026-07 review) ────────────

test("substring name fragments do not auto-match the wrong patient", () => {
  const fax = { ocrText: "ADDITIONAL INFORMATION REQUEST\nPatient: Robert Johnson\nSmithfield Family Clinic", senderNumber: "" };
  const signals = extractSignals(fax, { patientName: "John Smith" });
  assert.equal(signals.patient_name, false, "'john'⊂'johnson' + 'smith'⊂'smithfield' must not match");
  const match = bestFaxBackMatch(fax, [{ patientName: "John Smith", referral: { id: "r1" } }]);
  assert.ok(!match || !match.confident, "form marker + fragment name must not auto-attach");
});

test("OCR-spaced date separators still match the DOB", () => {
  const fax = { ocrText: "patient jane doe dob 01 / 05 / 1950 additional information request", senderNumber: "" };
  const signals = extractSignals(fax, { patientName: "Jane Doe", patientDob: "1950-01-05" });
  assert.equal(signals.patient_dob, true);
});

// ── fax answer ingestion ──

test("applyFaxAnswersToItems marks only open, clearly-answered items", () => {
  const items = [
    { id: "f2f_missing", item_status: "open", title: "F2F" },
    { id: "orders_missing", item_status: "answered", response: { text: "portal answer" } },
    { id: "homebound_undocumented", item_status: "resolved" },
    { id: "frequency_missing" }, // no status = open
  ];
  const { items: out, answeredCount } = applyFaxAnswersToItems(
    items,
    [
      { id: "f2f_missing", answered: true, response_text: "Encounter note attached, seen 8/20" },
      { id: "orders_missing", answered: true, response_text: "must NOT overwrite portal answer" },
      { id: "homebound_undocumented", answered: true, response_text: "must NOT reopen resolved" },
      { id: "frequency_missing", answered: true, response_text: "  " }, // blank → unanswered
      { id: "unknown_item", answered: true, response_text: "ignored" },
    ],
    "2026-08-29T21:00:00.000Z"
  );
  assert.equal(answeredCount, 1);
  assert.equal(out[0].item_status, "answered");
  assert.deepEqual(out[0].response, { text: "Encounter note attached, seen 8/20", source: "fax" });
  assert.equal(out[0].answered_at, "2026-08-29T21:00:00.000Z");
  // Portal answer and resolved state untouched; blank answer stays open.
  assert.equal(out[1].response.text, "portal answer");
  assert.equal(out[2].item_status, "resolved");
  assert.equal(out[3].item_status, undefined);
});

test("applyFaxAnswersToItems ignores answered:false and caps response length", () => {
  const long = "x".repeat(5000);
  const { items: out, answeredCount } = applyFaxAnswersToItems(
    [{ id: "a", item_status: "open" }, { id: "b", item_status: "open" }],
    [
      { id: "a", answered: false, response_text: "provider left it blank" },
      { id: "b", answered: true, response_text: long },
    ]
  );
  assert.equal(answeredCount, 1);
  assert.equal(out[0].item_status, "open");
  assert.equal(out[1].response.text.length, 4000);
});

test("applyFaxAnswersToItems handles empty inputs", () => {
  assert.deepEqual(applyFaxAnswersToItems([], []), { items: [], answeredCount: 0 });
  assert.equal(applyFaxAnswersToItems(null, null).answeredCount, 0);
});

test("applyFaxAnswersToItems stamps the given source (scan path)", () => {
  const { items: out } = applyFaxAnswersToItems(
    [{ id: "a", item_status: "open" }],
    [{ id: "a", answered: true, response_text: "from the scanner" }],
    undefined,
    "scan"
  );
  assert.deepEqual(out[0].response, { text: "from the scanner", source: "scan" });
});
