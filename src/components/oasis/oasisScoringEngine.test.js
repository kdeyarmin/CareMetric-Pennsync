import test from "node:test";
import assert from "node:assert/strict";
import {
  SCORED_QUESTION_IDS,
  SEVERITY_ORDER,
  computeCareScope,
  evaluateOASIS,
  isPennSyncFormAnswers,
} from "./oasisScoringEngine.js";

test("a high-severity trigger produces a high-severity suggestion", () => {
  const results = evaluateOASIS({ m1910: 2 }); // fall risk high
  const fall = results.find((r) => r.domain === "Fall Prevention");
  assert.ok(fall);
  assert.equal(fall.severity, "high");
  assert.ok(Array.isArray(fall.interventionIds) && fall.interventionIds.length > 0);
});

test("no matching answers → no suggestions", () => {
  assert.deepEqual(evaluateOASIS({}), []);
  assert.deepEqual(evaluateOASIS({ m1910: 0, m1860: 0 }), []);
});

test("bedfast ambulation (m1860=6) still triggers fall prevention", () => {
  // M1860 runs 0–6; 6 = "Bedfast, unable to ambulate or be up in a chair". The
  // trigger list stopped at 5 (chairfast), so the most impaired patients — the
  // highest transfer-fall risk — silently produced no suggestion.
  for (const amb of [2, 3, 4, 5, 6]) {
    const results = evaluateOASIS({ m1860: amb });
    const fall = results.find((r) => r.domain === "Fall Prevention");
    assert.ok(fall, `m1860=${amb} should trigger Fall Prevention`);
    assert.equal(fall.severity, "high");
  }
});

test("m1020 primary diagnosis routes to the correct domain (1=Diabetes, 2=CHF)", () => {
  // 1 = Diabetes Mellitus → Diabetes Management
  const dm = evaluateOASIS({ m1020: 1 });
  assert.ok(dm.some((r) => r.domain === "Diabetes Management"));
  assert.ok(!dm.some((r) => r.domain === "Cardiovascular Monitoring"));
  // 2 = Heart Failure / CHF → Cardiovascular, NOT Diabetes (was the bug)
  const chf = evaluateOASIS({ m1020: 2 });
  assert.ok(chf.some((r) => r.domain === "Cardiovascular Monitoring"));
  assert.ok(!chf.some((r) => r.domain === "Diabetes Management"));
});

test("inability to take oral meds (m2020=3) does NOT flag diabetes care", () => {
  // M2020=3 is medication-adherence, not a diabetes signal. A non-diabetic patient
  // unable to self-administer oral meds must route to Medication Management only.
  const results = evaluateOASIS({ m2020: 3 });
  assert.ok(!results.some((r) => r.domain === "Diabetes Management"));
  assert.ok(results.some((r) => r.domain === "Medication Management"));
});

test("severe dyspnea (m1400=4) yields exactly one high-severity domain (Cardiovascular)", () => {
  // Regression: m1400 in [3,4] must not double-trigger high suggestions from
  // both Cardiovascular and Respiratory. Severe dyspnea routes to Cardiovascular.
  const results = evaluateOASIS({ m1400: 4 });
  const highDomains = results.filter((r) => r.severity === "high").map((r) => r.domain);
  assert.deepEqual(highDomains, ["Cardiovascular Monitoring"]);
  assert.ok(!results.some((r) => r.domain === "Respiratory Management"));
});

test("mild–moderate dyspnea (m1400=2) still routes to Respiratory Management", () => {
  const results = evaluateOASIS({ m1400: 2 });
  const resp = results.find((r) => r.domain === "Respiratory Management");
  assert.ok(resp);
  assert.equal(resp.severity, "high");
  // ...and does NOT trigger the Cardiovascular dyspnea rule.
  assert.ok(!results.some((r) => r.domain === "Cardiovascular Monitoring"));
});

test("string answers are coerced (parseInt), not ignored", () => {
  const results = evaluateOASIS({ m1910: "2" });
  assert.ok(results.some((r) => r.domain === "Fall Prevention" && r.severity === "high"));
});

test("undefined / null / empty answers are skipped", () => {
  assert.deepEqual(evaluateOASIS({ m1910: undefined, m1860: null, m1900: "" }), []);
});

test("highest severity within a domain wins", () => {
  // m1900 is medium for Fall Prevention; m1910 is high — high should win
  const results = evaluateOASIS({ m1900: 1, m1910: 1 });
  const fall = results.find((r) => r.domain === "Fall Prevention");
  assert.equal(fall.severity, "high");
});

test("results are sorted by severity (high → medium → low)", () => {
  // m1800 (low: Patient Education) + m1910 (high: Fall Prevention)
  const results = evaluateOASIS({ m1800: 1, m1910: 2 });
  const order = results.map((r) => SEVERITY_ORDER[r.severity]);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] >= order[i - 1], "suggestions must be ordered by severity");
  }
});

test("reason reflects the answer values", () => {
  const high = evaluateOASIS({ m1910: 2 }).find((r) => r.domain === "Fall Prevention");
  assert.match(high.reason, /high fall risk/i);
  const moderate = evaluateOASIS({ m1900: 1 }).find((r) => r.domain === "Fall Prevention");
  assert.match(moderate.reason, /moderate/i);
});

// ── computeCareScope ──

test("prognosis (m0069 = 1) → hospice", () => {
  assert.equal(computeCareScope({ m0069: 1 }), "hospice");
  assert.equal(computeCareScope({ m0069: "1" }), "hospice"); // string-coerced
});

test("high ADL deficit (sum >= 6) → both", () => {
  assert.equal(computeCareScope({ m1800: 2, m1810: 2, m1820: 2 }), "both");
});

test("string ADL answers are summed numerically, not concatenated", () => {
  // Regression guard: "3" + "2" + "1" must be 6 (→ "both"), not "321".
  assert.equal(computeCareScope({ m1800: "3", m1810: "2", m1820: "1" }), "both");
});

test("low deficit, non-hospice → home_health", () => {
  assert.equal(computeCareScope({ m1800: 1, m1810: 1 }), "home_health");
  assert.equal(computeCareScope({}), "home_health");
});

test('M1900 "Unknown" (4) does not trigger a fall-prevention suggestion', () => {
  // 4 is "Unknown" prior functioning, not an impairment level.
  assert.equal(evaluateOASIS({ m1900: 4 }).find((r) => r.domain === "Fall Prevention"), undefined);
});

test('completed high-risk drug education (m2010 = 1) is not a medication gap', () => {
  assert.equal(evaluateOASIS({ m2010: 1 }).find((r) => r.domain === "Medication Management"), undefined);
  assert.ok(evaluateOASIS({ m2010: 2 }).find((r) => r.domain === "Medication Management"));
});

// ── The ids this engine reads are PennSync's, not CMS item numbers ──────────

test("the engine refuses CMS-shaped data rather than returning a confident empty", () => {
  // An empty result reads as "no concerns found". On data this engine cannot
  // interpret the truth is "these answers could not be read" — a different
  // answer, and the dangerous one to get wrong.
  const cmsShaped = { j1800: 1, d0150: 2, gg0100: 3, m1021: "I50.9" };
  assert.equal(isPennSyncFormAnswers(cmsShaped), false);
  assert.throws(
    () => evaluateOASIS(cmsShaped, { strict: true }),
    /match none of PennSync's form question ids/,
  );
  // Non-strict stays backward compatible for the existing caller.
  assert.deepEqual(evaluateOASIS(cmsShaped), []);
});

test("PennSync form answers are recognised", () => {
  assert.equal(isPennSyncFormAnswers({ m1860: 3 }), true);
  assert.equal(isPennSyncFormAnswers({}), false);
  assert.equal(isPennSyncFormAnswers(null), false);
});

test("every scored id is a known PennSync form question, not an invented one", async () => {
  // Guards against a rule keying off an id no form question supplies, which
  // would be a trigger that can never fire.
  const { ITEM_VERIFICATION } = await import("./specs/verification.js");
  for (const id of SCORED_QUESTION_IDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(ITEM_VERIFICATION, id),
      `${id} is scored but is not in the item registry`,
    );
  }
});

test("ids this engine reads that are NOT current CMS items are known and documented", async () => {
  // Pins the source-check result so a future edit cannot quietly reintroduce a
  // CMS claim for one of these.
  const { classifyItem } = await import("./specs/verification.js");
  const notCurrentCms = SCORED_QUESTION_IDS.filter(
    (id) => !["verified", "abbreviated"].includes(classifyItem(id).level),
  );
  assert.deepEqual(
    notCurrentCms.sort(),
    ["m1020", "m1030", "m1350", "m1730", "m1900", "m1910"],
    "the set of non-CMS ids this engine reads changed — re-check specs/verification.js",
  );
});
