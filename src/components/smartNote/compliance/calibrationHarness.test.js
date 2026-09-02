import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateThresholds,
  recommendThreshold,
  scoreCorpus,
} from "./calibrationHarness.js";

// A weak homebound line (0 supporting factors) and a strong one (several).
const WEAK = "Patient is homebound.";
const STRONG =
  "Patient is homebound due to severe exertional dyspnea; requires a rolling walker and the "
  + "assistance of one person, and rests after only a few steps. She leaves the home only for "
  + "medical appointments.";

/** Build a corpus where weak notes were denied and strong notes were paid. */
function corpus(weakDenied, strongPaid, extra = []) {
  return [
    ...Array.from({ length: weakDenied }, () => ({ text: WEAK, outcome: "denied" })),
    ...Array.from({ length: strongPaid }, () => ({ text: STRONG, outcome: "paid" })),
    ...extra,
  ];
}

test("scoreCorpus reports the factor count and outcome per note", () => {
  const scored = scoreCorpus([{ text: WEAK, outcome: "denied" }, { text: STRONG, outcome: "paid" }], "homebound");
  assert.equal(scored.length, 2);
  assert.equal(scored[0].factors, 0);
  assert.equal(scored[0].outcome, "denied");
  assert.ok(scored[1].factors >= 3);
  assert.equal(scored[1].outcome, "paid");
});

test("an unlabelled note is recorded as unknown, never assumed", () => {
  const [only] = scoreCorpus([{ text: WEAK }], "homebound");
  assert.equal(only.outcome, "unknown");
  const [bogus] = scoreCorpus([{ text: WEAK, outcome: "probably fine" }], "homebound");
  assert.equal(bogus.outcome, "unknown", "an unrecognised label is not silently trusted");
});

test("an unknown element yields nothing rather than throwing", () => {
  assert.deepEqual(scoreCorpus([{ text: WEAK }], "not_an_element"), []);
  assert.deepEqual(scoreCorpus(null, "homebound"), []);
});

test("evaluateThresholds reports the distribution and the current default", () => {
  const evaluation = evaluateThresholds(corpus(20, 20), "homebound");
  assert.equal(evaluation.thresholdKey, "homebound_strong_factors");
  assert.equal(evaluation.currentDefault, 3);
  assert.equal(evaluation.sampleSize, 40);
  assert.equal(evaluation.labelledCount, 40);
  assert.equal(evaluation.distribution[0], 20, "the weak notes cluster at zero factors");
});

test("each candidate reports the trade a human has to make", () => {
  const evaluation = evaluateThresholds(corpus(20, 20), "homebound");
  for (const c of evaluation.candidates) {
    assert.ok(Number.isFinite(c.threshold));
    assert.ok(Number.isFinite(c.flagRate));
    assert.equal(c.caught + c.missed + c.falseAlarm + c.cleared, 40, "every labelled note is accounted for");
  }
});

test("a corpus that separates cleanly produces a confident recommendation", () => {
  const evaluation = evaluateThresholds(corpus(25, 25), "homebound");
  const rec = recommendThreshold(evaluation);
  assert.equal(rec.confident, true);
  assert.ok(rec.recommended >= 1);
  assert.equal(rec.sensitivity, 1, "every denied note is caught");
  assert.equal(rec.specificity, 1, "every paid note is cleared");
});

test("the recommendation is framed as evidence, not as a setting to apply", () => {
  const rec = recommendThreshold(evaluateThresholds(corpus(25, 25), "homebound"));
  assert.match(rec.statement, /evidence for a human decision, not a setting PennSync should apply/i);
  assert.match(rec.statement, /labelled notes/);
});

test("too small a labelled sample declines rather than guessing", () => {
  const rec = recommendThreshold(evaluateThresholds(corpus(5, 5), "homebound"));
  assert.equal(rec.confident, false);
  assert.equal(rec.recommended, null);
  assert.match(rec.reason, /only 10 notes carry a known outcome/i);
  assert.match(rec.statement, /Keep the current default/i);
});

test("a one-sided corpus declines — everything paid cannot separate anything", () => {
  const rec = recommendThreshold(evaluateThresholds(corpus(1, 60), "homebound"));
  assert.equal(rec.confident, false);
  assert.match(rec.reason, /too one-sided/i);
  assert.match(rec.reason, /1 denied vs 60 paid/);
});

test("unlabelled notes count toward the distribution but not toward a recommendation", () => {
  const unlabelled = Array.from({ length: 100 }, () => ({ text: WEAK }));
  const evaluation = evaluateThresholds([...corpus(5, 5), ...unlabelled], "homebound");
  assert.equal(evaluation.sampleSize, 110);
  assert.equal(evaluation.labelledCount, 10);
  assert.equal(recommendThreshold(evaluation).confident, false, "volume without labels proves nothing");
});

test("an empty or malformed evaluation declines safely", () => {
  assert.equal(recommendThreshold(null).confident, false);
  assert.equal(recommendThreshold({}).confident, false);
  assert.match(recommendThreshold({}).reason, /no candidates/i);
});

test("evaluation is deterministic for the same corpus", () => {
  const c = corpus(12, 12);
  assert.deepEqual(evaluateThresholds(c, "homebound"), evaluateThresholds(c, "homebound"));
});

test("skilled need and teaching are calibratable on the same harness", () => {
  for (const element of ["skilled_need", "teaching"]) {
    const evaluation = evaluateThresholds(corpus(15, 15), element);
    assert.equal(evaluation.thresholdKey, `${element}_strong_factors`);
    assert.ok(evaluation.candidates.length > 0);
  }
});
