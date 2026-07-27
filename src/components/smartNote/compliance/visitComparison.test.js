import test from "node:test";
import assert from "node:assert/strict";
import { compareVisits, buildTrendSummary, extractPain, detectSustainedTrends } from "./visitComparison.js";

test("extractPain pulls the first N/10 rating", () => {
  assert.equal(extractPain("pain 6/10 at the wound site"), 6);
  assert.equal(extractPain("pain 0/10, comfortable"), 0);
  assert.equal(extractPain("no pain reported"), null);
  assert.equal(extractPain(""), null);
});

test("no comparison without both notes", () => {
  assert.deepEqual(compareVisits("BP 130/80", ""), []);
  assert.deepEqual(compareVisits("", "BP 130/80"), []);
});

test("surfaces a meaningful blood-pressure change", () => {
  const out = compareVisits("BP 132/84, HR 76", "BP 150/92, HR 78");
  const bp = out.find((c) => c.key === "bp");
  assert.ok(bp, "expected a blood pressure row");
  assert.equal(bp.prevStr, "150/92");
  assert.equal(bp.nextStr, "132/84");
  assert.equal(bp.direction, "down");
  // HR changed by only 2 — below minDelta, so it must not be reported.
  assert.equal(out.find((c) => c.key === "hr"), undefined);
});

test("a diastolic-only BP change is not rendered as 'same'", () => {
  // 120/70 -> 120/82: systolic unchanged, diastolic +12 (clears the 8 mmHg
  // threshold). Direction/delta must reflect the diastolic move, not systolic.
  const out = compareVisits("BP 120/82", "BP 120/70");
  const bp = out.find((c) => c.key === "bp");
  assert.ok(bp, "expected a blood pressure row");
  assert.equal(bp.direction, "up");
  assert.equal(bp.delta, 12);
});

test("ignores changes below the minimum delta (measurement noise)", () => {
  // O2 96 -> 95 is a 1-point drop, below the 2-point threshold.
  const out = compareVisits("O2 95%", "O2 96%");
  assert.deepEqual(out, []);
});

test("flags a concerning oxygen drop", () => {
  const out = compareVisits("O2 90% on RA", "O2 96% on RA");
  const o2 = out.find((c) => c.key === "o2");
  assert.ok(o2);
  assert.equal(o2.direction, "down");
  assert.equal(o2.concern, true); // fell >=2 and is now <92
});

test("flags a concerning weight gain (possible fluid)", () => {
  const out = compareVisits("weight 188 lbs", "weight 182 lbs");
  const wt = out.find((c) => c.key === "weight");
  assert.ok(wt);
  assert.equal(wt.direction, "up");
  assert.equal(wt.concern, true); // +6 lbs
});

test("reports a pain change with the /10 suffix preserved", () => {
  const out = compareVisits("pain 6/10", "pain 3/10");
  const pain = out.find((c) => c.key === "pain");
  assert.ok(pain);
  assert.equal(pain.prevStr, "3/10");
  assert.equal(pain.nextStr, "6/10");
  assert.equal(pain.concern, true); // rose by >=2
});

test("normalizes a kg weight to lbs so a unit switch isn't a bogus change", () => {
  // 80 kg == 176.4 lb; the prior visit recorded 176 lb. Same patient, ~0.4 lb
  // apart — below the 3 lb threshold, so it must NOT be reported as a change.
  assert.deepEqual(compareVisits("weight 80 kg", "weight 176 lbs"), []);
});

test("detects a real change between two kg weights (normalized to lbs)", () => {
  // 80 kg -> 85 kg == 176.4 -> 187.4 lb, a real +11 lb gain.
  const out = compareVisits("weight 85 kg", "weight 80 kg");
  const wt = out.find((c) => c.key === "weight");
  assert.ok(wt, "expected a weight row");
  assert.equal(wt.direction, "up");
});

test("buildTrendSummary is factual, plain-text, and value-grounded", () => {
  const out = compareVisits("BP 132/84, O2 90%, pain 6/10", "BP 150/92, O2 96%, pain 3/10");
  const summary = buildTrendSummary(out);
  assert.match(summary, /^Compared to the prior documented visit, /);
  assert.match(summary, /blood pressure 150\/92 to 132\/84 mmHg/);
  assert.match(summary, /oxygen saturation 96% to 90%/);
  assert.match(summary, /pain 3\/10 to 6\/10/);
  // Plain text only — no arrows that might render oddly in an EMR.
  assert.ok(!summary.includes("→"));
});

test("buildTrendSummary is empty when nothing changed", () => {
  assert.equal(buildTrendSummary([]), "");
  assert.equal(buildTrendSummary(compareVisits("BP 130/80", "BP 130/80")), "");
});

test("detectSustainedTrends needs at least three visits", () => {
  assert.deepEqual(detectSustainedTrends(["weight 180 lbs", "weight 188 lbs"]), []);
});

test("detects a sustained weight climb across visits (oldest -> newest)", () => {
  const trends = detectSustainedTrends(["weight 180 lbs", "weight 184 lbs", "weight 188 lbs"]);
  const wt = trends.find((t) => t.key === "weight");
  assert.ok(wt, "expected a weight trend");
  assert.equal(wt.direction, "up");
  assert.deepEqual(wt.values, [180, 184, 188]);
  assert.equal(wt.display, "180 → 184 → 188 lbs");
});

test("detects a sustained oxygen decline", () => {
  const trends = detectSustainedTrends(["O2 97%", "O2 95%", "O2 92%"]);
  const o2 = trends.find((t) => t.key === "o2");
  assert.ok(o2);
  assert.equal(o2.direction, "down");
  assert.equal(o2.display, "97% → 95% → 92%");
});

test("non-monotonic values are not a trend", () => {
  const trends = detectSustainedTrends(["weight 180 lbs", "weight 190 lbs", "weight 182 lbs"]);
  assert.equal(trends.find((t) => t.key === "weight"), undefined);
});

test("a small but monotonic drift below the total threshold is not a trend", () => {
  // 180 -> 181 -> 182 is monotonic but only +2 lbs total (< 4 lb threshold).
  const trends = detectSustainedTrends(["weight 180 lbs", "weight 181 lbs", "weight 182 lbs"]);
  assert.equal(trends.find((t) => t.key === "weight"), undefined);
});

test("a break in the most recent run stops the trend", () => {
  // Newest note has no weight, so the consecutive-from-newest run is too short.
  const trends = detectSustainedTrends(["weight 180 lbs", "weight 184 lbs", "BP 130/80"]);
  assert.equal(trends.find((t) => t.key === "weight"), undefined);
});

// ── Regression: pain extraction must not capture calendar dates ──────────────
test("extractPain ignores month/day dates and requires pain context", () => {
  // A recert/scheduling date written as month/day (day = 10) must NOT read as pain.
  assert.equal(extractPain("Recert due 3/10. Patient stable."), null);
  assert.equal(extractPain("Follow-up 9/10 at clinic."), null);
  // Real documented pain still parses, in either order.
  assert.equal(extractPain("pain 8/10 at incision"), 8);
  assert.equal(extractPain("pain rating of 7/10"), 7);
  assert.equal(extractPain("reports 6/10 pain"), 6);
});

test("a colon-labeled kg weight is converted, so a unit switch isn't a phantom trend", () => {
  // "Weight: 80 kg" (~176 lbs) vs a prior "Weight: 176 lbs" is effectively no
  // change — it must not surface as a ~96 lb weight loss.
  const out = compareVisits("Weight: 80 kg.", "Weight: 176 lbs.");
  assert.equal(out.find((c) => c.key === "weight"), undefined);
});

// ── Regression: weight unit + loss handling (2026-07 review) ────────────────

test("a captured lbs weight is not converted by a kg figure elsewhere in the note", () => {
  const out = compareVisits("Weight 176 lbs per bath scale; family reports wt 80 kg on their scale.", "Weight 176 lbs.");
  const w = out.find((r) => r.key === "weight");
  assert.equal(w, undefined, "same 176 lbs both visits — no phantom doubling row");
});

test("a significant weight LOSS is flagged as a concern", () => {
  const out = compareVisits("Weight 160 lbs today.", "Weight 176 lbs.");
  const w = out.find((r) => r.key === "weight");
  assert.ok(w, "a 16 lb change must surface");
  assert.equal(w.concern, true, "a 16 lb loss is clinically concerning");
});
