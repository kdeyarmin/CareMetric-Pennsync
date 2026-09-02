import test from "node:test";
import assert from "node:assert/strict";
import {
  RESOLUTIONS,
  resolveFinding,
  reviewCrossDocumentConsistency,
} from "./crossDocumentConsistency.js";

const get = (r, id) => r.findings.find((f) => f.id === id);
const has = (r, id) => r.findings.some((f) => f.id === id);

// ── Contract ───────────────────────────────────────────────────────────────

test("every finding shows both sources, evidence, a severity and an action", () => {
  const r = reviewCrossDocumentConsistency({
    patient: { functional_status: { fall_risk: "high" }, wounds: [{ location: "sacrum" }] },
    noteText: "Vitals stable.",
  });
  assert.ok(r.findings.length >= 2);
  for (const f of r.findings) {
    assert.equal(f.advisory, true, `${f.id} must be advisory`);
    assert.ok(f.sourceA?.record && f.sourceA?.detail, `${f.id} needs source A`);
    assert.ok(f.sourceB?.record && f.sourceB?.detail, `${f.id} needs source B`);
    assert.ok(Array.isArray(f.evidence), `${f.id} needs an evidence array`);
    assert.ok(["critical", "high", "medium"].includes(f.severity), `${f.id} needs a severity`);
    assert.ok(f.action, `${f.id} needs a suggested review action`);
    assert.equal(f.resolution, null, "a fresh finding is unresolved");
  }
});

test("no finding asserts an OASIS response is wrong — it points at the EMR", () => {
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: { m1860: 5 } },
    noteText: "Patient ambulates independently around the home.",
  });
  const f = get(r, "function_conflict");
  assert.match(f.action, /correct the official assessment in your EMR/i);
  assert.ok(!/is wrong|is incorrect/i.test(f.title));
});

test("nothing conflicting produces no findings, and the checks run are listed", () => {
  const r = reviewCrossDocumentConsistency({
    noteText: "Reviewed fall precautions and removed clutter from the hallway.",
    patient: { functional_status: { fall_risk: "high" } },
  });
  assert.deepEqual(r.findings, []);
  assert.ok(r.checked.length >= 6, "the checks that ran are reported even when clean");
});

// ── Individual checks ──────────────────────────────────────────────────────

test("high fall risk with no prevention intervention is flagged", () => {
  const r = reviewCrossDocumentConsistency({
    patient: { functional_status: { fall_risk: "high" } },
    noteText: "Assessed the patient. Vitals stable.",
  });
  assert.ok(has(r, "fall_risk_no_intervention"));
});

test("a fall intervention in the CARE PLAN satisfies the check, not only the note", () => {
  const r = reviewCrossDocumentConsistency({
    patient: { functional_status: { fall_risk: "high" } },
    noteText: "Assessed the patient. Vitals stable.",
    carePlans: [{ problem: "Fall risk", goal: "No falls", interventions: ["Fall precautions reviewed each visit"], status: "active" }],
  });
  assert.equal(has(r, "fall_risk_no_intervention"), false);
});

test("a bedfast OASIS response against an independent narrative is flagged with the sentence", () => {
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: { m1860: 5 } },
    noteText: "BP 132/78. Patient ambulates independently to the bathroom.",
  });
  const f = get(r, "function_conflict");
  assert.match(f.sourceA.detail, /bedfast or chairfast/i);
  assert.match(f.evidence[0], /ambulates independently/i);
});

test("OASIS responses are read from the ARRAY shape they are actually persisted in", () => {
  // OASISAssessment.oasis_items is an array of { item_number, response } — see
  // the entity schema and SmartOASISAssessment's save path. Treating it as an
  // object map made every lookup return null on a real saved assessment, so the
  // OASIS checks silently did nothing while the panel reported no findings.
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: [{ item_number: "M1860", response: "5" }] },
    noteText: "Patient ambulates independently around the home.",
  });
  assert.equal(has(r, "function_conflict"), true, "the array shape must be understood");
  assert.match(get(r, "function_conflict").sourceA.detail, /Response 5/);
});

test("a medication deficit is detected from the persisted array shape too", () => {
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: [{ item_number: "M2020", response: "3" }] },
    noteText: "Assessed the patient. Vitals stable.",
  });
  assert.equal(has(r, "med_deficit_no_intervention"), true);
});

test("a fall-risk OASIS response is read from the array shape", () => {
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: [{ item_number: "M1910", response: "1" }] },
    noteText: "Assessed the patient. Vitals stable.",
  });
  assert.equal(has(r, "fall_risk_no_intervention"), true);
});

test("a non-numeric or absent response does not fabricate a finding", () => {
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: [{ item_number: "M1860", response: "" }, { item_number: "M2020" }] },
    noteText: "Patient ambulates independently around the home.",
  });
  assert.equal(has(r, "function_conflict"), false);
  assert.equal(has(r, "med_deficit_no_intervention"), false);
});

test("OASIS values are read whether stored nested or flat", () => {
  const nested = reviewCrossDocumentConsistency({
    oasis: { oasis_items: { m1860: 5 } },
    noteText: "Patient ambulates independently.",
  });
  const flat = reviewCrossDocumentConsistency({
    oasis: { m1860: 5 },
    noteText: "Patient ambulates independently.",
  });
  assert.equal(has(nested, "function_conflict"), true);
  assert.equal(has(flat, "function_conflict"), true);
});

test("a medication-management deficit with no related intervention is flagged", () => {
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: { m2020: 3 } },
    noteText: "Assessed the patient. Vitals stable.",
  });
  assert.ok(has(r, "med_deficit_no_intervention"));

  const withIntervention = reviewCrossDocumentConsistency({
    oasis: { oasis_items: { m2020: 3 } },
    noteText: "Filled the pillbox and reviewed the medication schedule with the daughter.",
  });
  assert.equal(has(withIntervention, "med_deficit_no_intervention"), false);
});

test("an independent medication response is not treated as a deficit", () => {
  const r = reviewCrossDocumentConsistency({
    oasis: { oasis_items: { m2020: 0 } },
    noteText: "Assessed the patient.",
  });
  assert.equal(has(r, "med_deficit_no_intervention"), false);
});

test("a charted wound with no wound documentation is flagged", () => {
  const r = reviewCrossDocumentConsistency({
    patient: { wounds: [{ location: "right heel" }] },
    noteText: "Vitals stable. Reviewed the diet.",
  });
  assert.match(get(r, "wound_not_documented").sourceA.detail, /right heel/);

  const documented = reviewCrossDocumentConsistency({
    patient: { wounds: [{ location: "right heel" }] },
    noteText: "Dressing change performed to the right heel wound.",
  });
  assert.equal(has(documented, "wound_not_documented"), false);
});

test("a documented decline with no plan change or open follow-up is flagged", () => {
  const r = reviewCrossDocumentConsistency({
    noteText: "The sacral wound has worsened since the last visit with increased drainage.",
  });
  const f = get(r, "decline_no_plan_change");
  assert.match(f.evidence[0], /worsened/i);
});

test("an open, relevant follow-up task means the decline was acted on", () => {
  const r = reviewCrossDocumentConsistency({
    noteText: "The sacral wound has worsened since the last visit.",
    openTasks: [{ id: "t1", title: "Notify provider", status: "pending" }],
  });
  assert.equal(has(r, "decline_no_plan_change"), false);
});

test("an unrelated or cancelled task does NOT silence a documented decline", () => {
  // Suppressing on any task merely "not completed" let a supply errand — or a
  // cancelled task — hide a clinical deterioration.
  const unrelated = reviewCrossDocumentConsistency({
    noteText: "The sacral wound has worsened since the last visit.",
    openTasks: [{ id: "t1", title: "Reorder gauze supplies", status: "pending", type: "other" }],
  });
  assert.equal(has(unrelated, "decline_no_plan_change"), true);

  const cancelled = reviewCrossDocumentConsistency({
    noteText: "The sacral wound has worsened since the last visit.",
    openTasks: [{ id: "t1", title: "Notify provider", status: "cancelled" }],
  });
  assert.equal(has(cancelled, "decline_no_plan_change"), true);
});

test("a plan change in the note also satisfies the decline check", () => {
  const r = reviewCrossDocumentConsistency({
    noteText: "The wound has worsened. New order received to increase the visit frequency.",
  });
  assert.equal(has(r, "decline_no_plan_change"), false);
});

test("discharge documentation with active goals is flagged", () => {
  const r = reviewCrossDocumentConsistency({
    noteText: "Discharged from home health today; all goals have been met.",
    carePlans: [{ problem: "Wound", goal: "Healed", status: "active" }],
  });
  const f = get(r, "discharge_with_active_goals");
  assert.equal(f.severity, "medium");
  assert.match(f.sourceB.detail, /1 goal still active/);
});

test("discontinued care plans are not counted as active goals", () => {
  const r = reviewCrossDocumentConsistency({
    noteText: "Discharged from home health today.",
    carePlans: [{ problem: "Wound", goal: "Healed", status: "discontinued" }],
  });
  assert.equal(has(r, "discharge_with_active_goals"), false);
});

test("findings are ordered most severe first", () => {
  const r = reviewCrossDocumentConsistency({
    patient: { functional_status: { fall_risk: "high" } },
    noteText: "Discharged from home health today.",
    carePlans: [{ problem: "Wound", goal: "Healed", status: "active" }],
  });
  const severities = r.findings.map((f) => f.severity);
  assert.ok(severities.indexOf("high") < severities.indexOf("medium"));
});

// ── Resolution ─────────────────────────────────────────────────────────────

test("a reviewer decision is recorded on the finding, never applied to the records", () => {
  const [f] = reviewCrossDocumentConsistency({
    patient: { functional_status: { fall_risk: "high" } },
    noteText: "Vitals stable.",
  }).findings;
  const out = resolveFinding(f, "acknowledged", { actorEmail: "qa@example.com", at: "2026-08-31T12:00:00.000Z" });
  assert.equal(out.ok, true);
  assert.equal(out.finding.resolution.status, "acknowledged");
  assert.equal(out.finding.resolution.by, "qa@example.com");
  assert.equal(out.finding.title, f.title, "the finding itself is unchanged");
});

test("'not applicable' requires a reason so a real finding cannot vanish quietly", () => {
  const [f] = reviewCrossDocumentConsistency({
    patient: { functional_status: { fall_risk: "high" } },
    noteText: "Vitals stable.",
  }).findings;
  const blank = resolveFinding(f, "not_applicable", { actorEmail: "qa@example.com" });
  assert.equal(blank.ok, false);
  assert.match(blank.reason, /requires a reason/i);

  const given = resolveFinding(f, "not_applicable", { actorEmail: "qa@example.com", reason: "Patient is bedbound; no ambulation risk." });
  assert.equal(given.ok, true);
  assert.equal(given.finding.resolution.reason, "Patient is bedbound; no ambulation risk.");
});

test("an unknown resolution is rejected", () => {
  const out = resolveFinding({ id: "x" }, "ignored_forever");
  assert.equal(out.ok, false);
  assert.match(out.reason, /Unknown resolution/);
});

test("the documented resolution set is exactly what the UI may offer", () => {
  assert.deepEqual(RESOLUTIONS, ["acknowledged", "resolved", "task_created", "not_applicable"]);
});

// ── Robustness ─────────────────────────────────────────────────────────────

test("junk input never throws", () => {
  assert.doesNotThrow(() => reviewCrossDocumentConsistency());
  assert.doesNotThrow(() => reviewCrossDocumentConsistency({ oasis: {}, carePlans: [null], openTasks: [undefined] }));
});

test("review is deterministic for the same inputs", () => {
  const args = { patient: { functional_status: { fall_risk: "high" } }, noteText: "Vitals stable." };
  assert.deepEqual(reviewCrossDocumentConsistency(args), reviewCrossDocumentConsistency(args));
});
