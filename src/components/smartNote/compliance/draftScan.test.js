import test from "node:test";
import assert from "node:assert/strict";
import { scanDraft, MIN_DRAFT_LENGTH } from "./draftScan.js";

test("returns null for a draft that is too short to scan", () => {
  assert.equal(scanDraft({ roughNote: "" }), null);
  assert.equal(scanDraft({ roughNote: "too short" }), null);
  assert.equal(scanDraft({}), null);
  assert.equal(scanDraft({ roughNote: "x".repeat(MIN_DRAFT_LENGTH - 1) }), null);
});

test("reports the critical gaps of an unhelpful draft", () => {
  const scan = scanDraft({ roughNote: "Saw the client today and things seemed to be going fine overall." });
  assert.ok(scan);
  assert.deepEqual(scan.criticalGaps.map((e) => e.id).sort(), ["homebound", "skilled_need"]);
  assert.equal(scan.draftScore, 0);
});

test("a documented draft closes its critical gaps and scores above zero", () => {
  const scan = scanDraft({
    roughNote:
      "Patient is homebound due to severe dyspnea and needs a walker with one-person assist. "
      + "Skilled wound care with a sterile dressing change to the sacral ulcer.",
  });
  assert.deepEqual(scan.criticalGaps, []);
  assert.ok(scan.draftScore > 0);
});

test("structured form vitals count toward coverage without being retyped", () => {
  const roughNote = "Patient is homebound due to dyspnea, needs a walker. Skilled wound care performed.";
  const without = scanDraft({ roughNote });
  const withVitals = scanDraft({
    roughNote,
    vitals: { blood_pressure_systolic: 148, blood_pressure_diastolic: 90, heart_rate: 82 },
  });
  assert.ok(without.gaps.some((g) => g.id === "vitals"), "vitals is a gap when nothing was captured");
  assert.ok(!withVitals.gaps.some((g) => g.id === "vitals"), "form vitals close the vitals gap");
  assert.ok(withVitals.draftScore > without.draftScore);
  assert.match(withVitals.vitalsSentence, /BP 148\/90 mmHg/);
});

test("surfaces unfilled template placeholders", () => {
  const scan = scanDraft({
    roughNote: "• Homebound status: unable to leave home due to [diagnosis]\n• Pain level: _/10",
  });
  assert.equal(scan.placeholders.length, 2);
  // ...and they do not count as documentation.
  assert.ok(scan.criticalGaps.some((e) => e.id === "homebound"));
});

test("hospice uses the hospice element set", () => {
  const scan = scanDraft({
    roughNote: "Visited the patient at home today and reviewed how the week has been going.",
    serviceLine: "hospice",
  });
  assert.deepEqual(scan.criticalGaps.map((e) => e.id), ["comfort_skilled_need"]);
});

test("an agency rule can raise severity and is reported for the audit stamp", () => {
  const rules = [{
    rule_name: "Safety sweep", category: "safety_assessment", severity: "critical",
    is_active: true, cop_reference: "42 CFR 484.75", keywords: ["fall"],
  }];
  const scan = scanDraft({
    roughNote: "Saw the client today and things seemed to be going fine overall.",
    complianceRules: rules,
  });
  assert.ok(scan.criticalGaps.some((e) => e.id === "safety"), "the rule promotes safety to critical");
  assert.equal(scan.appliedRules.length, 1);
  assert.equal(scan.appliedRules[0].rule_name, "Safety sweep");
});

test("placeholderCount is the true total, independent of the display cap", () => {
  // 10 lines x 3 blanks = 30 blanks, well past describePlaceholders' cap of 6
  // rows. Counting the display rows reported "6", which is both the wrong unit
  // (lines, not blanks) and saturated at the cap.
  const draft = Array.from({ length: 10 }, (_, i) => `Line ${i}: BP _/_, HR _`).join("\n");
  const scan = scanDraft({ roughNote: draft });
  assert.equal(scan.placeholders.length, 6, "display list stays capped");
  assert.equal(scan.placeholderCount, 30, "count is the true, uncapped total");
});

test("placeholderCount counts blanks, not lines", () => {
  const scan = scanDraft({ roughNote: "Homebound status: unable to leave home due to [diagnosis] with BP _/_" });
  assert.equal(scan.placeholders.length, 1, "one affected line");
  assert.equal(scan.placeholderCount, 3, "[diagnosis] plus the two BP blanks");
});

test("placeholderCount is 0 for a draft with no blanks", () => {
  const scan = scanDraft({
    roughNote: "Patient is homebound due to dyspnea and needs a walker. Skilled wound care performed.",
  });
  assert.equal(scan.placeholderCount, 0);
  assert.deepEqual(scan.placeholders, []);
});
