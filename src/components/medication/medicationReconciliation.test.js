import test from "node:test";
import assert from "node:assert/strict";
import {
  describeKnowledgeSource,
  normalizeMedication,
  reconcileMedications,
  setMedicationKnowledgeAdapter,
  summarizeMedicationChanges,
} from "./medicationReconciliation.js";

const find = (result, type) => result.findings.find((f) => f.type === type);
const has = (result, type) => result.findings.some((f) => f.type === type);

// ── Honesty about the knowledge source ─────────────────────────────────────

test("the built-in list is reported as unlicensed, with a caveat", () => {
  setMedicationKnowledgeAdapter(null);
  const source = describeKnowledgeSource();
  assert.equal(source.licensed, false);
  assert.match(source.caveat, /not a licensed drug database/i);
  assert.match(source.caveat, /Confirm every finding against the EMR/i);
});

test("an installed licensed adapter drops the caveat and is named", () => {
  setMedicationKnowledgeAdapter({ id: "rxnorm", label: "RxNorm", licensed: true });
  const source = describeKnowledgeSource();
  assert.equal(source.id, "rxnorm");
  assert.equal(source.licensed, true);
  assert.equal(source.caveat, "");
  setMedicationKnowledgeAdapter(null);
});

test("every reconciliation result carries the knowledge source", () => {
  setMedicationKnowledgeAdapter(null);
  const result = reconcileMedications({ chartMedications: [{ name: "Furosemide", dosage: "40 mg" }] });
  assert.equal(result.knowledgeSource.licensed, false);
  assert.ok(result.knowledgeSource.caveat);
});

// ── Normalisation ──────────────────────────────────────────────────────────

test("a free-text order is split into name, strength, route and frequency", () => {
  const med = normalizeMedication("Metoprolol Tartrate 25 mg PO BID");
  assert.equal(med.name.toLowerCase(), "metoprolol tartrate");
  assert.equal(med.strengthValue, 25);
  assert.equal(med.strengthUnit, "mg");
  assert.equal(med.route, "oral");
  assert.equal(med.frequency, "twice daily");
  assert.equal(med.dosesPerDay, 2);
});

test("a structured chart row normalises to the same key as its free-text form", () => {
  const row = normalizeMedication({ name: "Metoprolol Tartrate", dosage: "25 mg", frequency: "BID" });
  const text = normalizeMedication("metoprolol tartrate 25 mg bid");
  assert.equal(row.key, text.key);
  assert.equal(row.strengthValue, text.strengthValue);
});

test("dose forms are stripped so tablet/ER variants share one key", () => {
  assert.equal(
    normalizeMedication("Metformin ER 500 mg tablet").key,
    normalizeMedication("Metformin 500 mg").key,
  );
});

test("a longer route token is not shadowed by a shorter one", () => {
  assert.equal(normalizeMedication("Enoxaparin 40 mg subcutaneous daily").route, "subcutaneous");
});

test("an unrecognised token stays in the name rather than collapsing two drugs", () => {
  const a = normalizeMedication("Insulin glargine 20 units nightly");
  const b = normalizeMedication("Insulin lispro 6 units TID");
  assert.notEqual(a.key, b.key, "two different insulins must not share a key");
});

test("normalisation never throws on empty or junk input", () => {
  assert.equal(normalizeMedication("").key, "");
  assert.equal(normalizeMedication(null).key, "");
  assert.equal(normalizeMedication({}).key, "");
});

// ── Discrepancies ──────────────────────────────────────────────────────────

test("every finding carries the advisory wording, never an instruction", () => {
  const result = reconcileMedications({
    chartMedications: [],
    noteMedications: ["Amoxicillin 500 mg TID"],
  });
  for (const f of result.findings) {
    assert.match(f.advisory, /Potential medication discrepancy/i);
    assert.match(f.advisory, /confirm with patient\/provider/i);
    assert.ok(!/start |stop |increase the dose|give /i.test(f.title), `${f.id} must not instruct`);
  }
});

test("a medication in the note but not on the list is flagged", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Furosemide", dosage: "40 mg" }],
    noteMedications: ["Amoxicillin 500 mg TID"],
  });
  const f = find(result, "not_on_list");
  assert.match(f.title, /Amoxicillin/i);
  assert.equal(f.severity, "high");
});

test("a medication reported stopped in the note is flagged against the list", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Lisinopril", dosage: "10 mg" }],
    noteText: "Patient states she stopped lisinopril last week due to a cough.",
  });
  const f = find(result, "reported_stopped");
  assert.match(f.title, /Lisinopril/i);
  assert.match(f.evidence, /stopped lisinopril/i);
});

test("a stop phrase about a DIFFERENT drug does not flag this one", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Lisinopril", dosage: "10 mg" }],
    noteText: "Patient stopped taking her ibuprofen. Lisinopril taken as prescribed.",
  });
  assert.equal(has(result, "reported_stopped"), false, "the stop must be in the same sentence");
});

test("a changed dose is reported with both values", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Furosemide", dosage: "40 mg", frequency: "daily" }],
    noteMedications: [{ name: "Furosemide", dosage: "80 mg", frequency: "daily" }],
  });
  const f = find(result, "dose_change");
  assert.equal(f.from, "40 mg");
  assert.equal(f.to, "80 mg");
});

test("a dose in different units is NOT reported as a change", () => {
  // 1 g and 1000 mg are the same dose; reporting that as a change would be a
  // false alert, and false alerts train nurses to dismiss real ones.
  const result = reconcileMedications({
    chartMedications: [{ name: "Acetaminophen", dosage: "1 g" }],
    noteMedications: [{ name: "Acetaminophen", dosage: "1000 mg" }],
  });
  assert.equal(has(result, "dose_change"), false);
});

test("a changed frequency at the same dose is reported as a frequency change", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Metoprolol", dosage: "25 mg", frequency: "daily" }],
    noteMedications: [{ name: "Metoprolol", dosage: "25 mg", frequency: "BID" }],
  });
  const f = find(result, "frequency_change");
  assert.equal(f.from, "daily");
  assert.equal(f.to, "twice daily");
  assert.equal(f.severity, "medium");
});

test("the same drug listed twice is flagged as duplicate therapy", () => {
  const result = reconcileMedications({
    chartMedications: [
      { name: "Metoprolol Tartrate", dosage: "25 mg" },
      { name: "Metoprolol Tartrate ER", dosage: "50 mg" },
    ],
  });
  const f = find(result, "duplicate_therapy");
  assert.match(f.title, /appears more than once/i);
});

test("an allergy conflict is critical and quotes the documented allergy", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Amoxicillin", dosage: "500 mg" }],
    allergies: "Amoxicillin — hives",
  });
  const f = find(result, "allergy_conflict");
  assert.equal(f.severity, "critical");
  assert.match(f.detail, /Amoxicillin — hives/);
});

test("NKDA is not treated as an allergy to match against", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Amoxicillin", dosage: "500 mg" }],
    allergies: "NKDA",
  });
  assert.equal(has(result, "allergy_conflict"), false);
});

test("an allergy conflict is reported once even when the drug is on both sides", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Amoxicillin", dosage: "500 mg" }],
    noteMedications: ["Amoxicillin 500 mg TID"],
    allergies: "amoxicillin",
  });
  assert.equal(result.findings.filter((f) => f.type === "allergy_conflict").length, 1);
});

test("counts match the findings and a clean reconciliation is empty", () => {
  const clean = reconcileMedications({
    chartMedications: [{ name: "Furosemide", dosage: "40 mg", frequency: "daily" }],
    noteMedications: [{ name: "Furosemide", dosage: "40 mg", frequency: "daily" }],
  });
  assert.deepEqual(clean.findings, []);
  assert.equal(clean.counts.total, 0);

  const messy = reconcileMedications({
    chartMedications: [{ name: "Amoxicillin", dosage: "500 mg" }],
    noteMedications: ["Warfarin 5 mg daily"],
    allergies: "amoxicillin",
  });
  assert.equal(
    messy.counts.total,
    messy.counts.critical + messy.counts.high + messy.counts.medium,
  );
});

test("reconciliation is deterministic for the same inputs", () => {
  const args = {
    chartMedications: [{ name: "Furosemide", dosage: "40 mg" }],
    noteMedications: ["Furosemide 80 mg daily"],
  };
  assert.deepEqual(reconcileMedications(args), reconcileMedications(args));
});

test("reconciliation never throws on junk input", () => {
  assert.doesNotThrow(() => reconcileMedications());
  assert.doesNotThrow(() => reconcileMedications({ chartMedications: [null], noteMedications: [undefined] }));
});

// ── Change summary ─────────────────────────────────────────────────────────

test("the change summary is framed as items to verify, not a completed reconciliation", () => {
  const result = reconcileMedications({
    chartMedications: [{ name: "Lisinopril", dosage: "10 mg" }],
    noteMedications: ["Amoxicillin 500 mg TID"],
  });
  const summary = summarizeMedicationChanges(result.changes);
  assert.match(summary.text, /items to verify against the EMR profile/i);
  assert.ok(!/reconciled|verified|confirmed/i.test(summary.text.replace(/to verify/i, "")));
  assert.equal(summary.count, summary.lines.length);
});

test("an empty change list produces no text rather than a misleading 'none'", () => {
  const summary = summarizeMedicationChanges([]);
  assert.equal(summary.text, "");
  assert.equal(summary.count, 0);
  assert.deepEqual(summarizeMedicationChanges(null).lines, []);
});
