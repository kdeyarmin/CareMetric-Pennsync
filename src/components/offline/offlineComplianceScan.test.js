import test from "node:test";
import assert from "node:assert/strict";
import { scanOfflineNote, visitTypeKey } from "./offlineComplianceScan.js";

test("visitTypeKey maps offline discipline labels to a compliance key", () => {
  assert.equal(visitTypeKey("Skilled Nursing"), "routine_visit");
  assert.equal(visitTypeKey("Physical Therapy"), "routine_visit");
  assert.equal(visitTypeKey("Anything Else"), "routine_visit");
});

test("a sparse note flags the critical required-element gaps (homebound, skilled need)", () => {
  const res = scanOfflineNote({ noteText: "Patient seen. Vitals stable." });
  const gapIds = res.critical_gaps.map((g) => g.id);
  assert.ok(gapIds.includes("homebound"));
  assert.ok(gapIds.includes("skilled_need"));
  assert.equal(res.has_blocking_issues, true);
  assert.ok(res.coverage < 100);
});

test("a substantive note raises coverage and clears the critical gaps", () => {
  const noteText = [
    "Patient is homebound due to severe exertional dyspnea; requires a rolling walker and one-person assist to leave home, a considerable and taxing effort.",
    "Skilled observation and assessment of an unstable CHF patient with lung auscultation and edema check; performed skilled wound care.",
    "Vitals: BP 138/82, HR 88. Patient tolerated the interventions well and reported reduced pain.",
    "Educated patient on low-sodium diet and daily weights; patient verbalized understanding via teach-back.",
    "Care delivered per plan of care; progressing toward the healing goal. Home-safety check completed, no falls since last visit.",
    "Patient denies new complaints. Medication list reviewed.",
  ].join(" ");
  const res = scanOfflineNote({ noteText });
  assert.equal(res.critical_gaps.length, 0);
  assert.equal(res.has_blocking_issues, false);
  assert.ok(res.coverage > 60);
});

test("grounding is always pending for an offline scan (LLM can't run offline)", () => {
  assert.equal(scanOfflineNote({ noteText: "x" }).grounding_pending, true);
});

test("chart cross-check runs only when a patient is supplied", () => {
  const noPatient = scanOfflineNote({ noteText: "Skilled wound care; homebound due to CVA needing assist." });
  assert.deepEqual(noPatient.chart_conflicts, []);
  const withPatient = scanOfflineNote({
    noteText: "Skilled wound care; homebound due to CVA needing assist.",
    patient: { first_name: "Jane", last_name: "Doe", allergies: "NKDA" },
  });
  assert.ok(Array.isArray(withPatient.chart_conflicts));
});

test("presence results are returned for downstream gap questions", () => {
  const res = scanOfflineNote({ noteText: "Patient seen." });
  assert.ok(Array.isArray(res.presence) && res.presence.length > 0);
  assert.ok(res.presence.every((p) => "id" in p && "present" in p));
});

test("a note stating the critical elements were NOT documented blocks", () => {
  // Regression: the engine's own fallback wording used to satisfy the
  // detector, so this note queued with has_blocking_issues: false.
  const res = scanOfflineNote({
    noteText: "Homebound status was not documented this visit. Skilled need was not documented this visit.",
  });
  const gapIds = res.critical_gaps.map((g) => g.id);
  assert.ok(gapIds.includes("homebound"));
  assert.ok(gapIds.includes("skilled_need"));
  assert.equal(res.has_blocking_issues, true);
});

test("aide and social-work notes are not held to skilled-nursing eligibility elements", () => {
  const res = scanOfflineNote({
    noteText: "Bathed patient, changed linens, and prepared a light meal. Patient comfortable.",
    visitType: visitTypeKey("Home Health Aide"),
    disciplineLabel: "Home Health Aide",
  });
  const gapIds = res.critical_gaps.map((g) => g.id);
  assert.ok(!gapIds.includes("homebound"));
  assert.ok(!gapIds.includes("skilled_need"));
  // A skilled-nursing note keeps them.
  const sn = scanOfflineNote({
    noteText: "Bathed patient, changed linens.",
    visitType: visitTypeKey("Skilled Nursing"),
    disciplineLabel: "Skilled Nursing",
  });
  assert.ok(sn.critical_gaps.map((g) => g.id).includes("homebound"));
});
