import test from "node:test";
import assert from "node:assert/strict";
import { detectPresence, computeGaps, computeCriticalGaps, computeCarryForward } from "./presenceDetection.js";
import { getRequiredElements } from "./requiredElements.js";

const reqs = getRequiredElements("home_health", "routine_visit");

test("detects a documented homebound statement with evidence", () => {
  const draft = "Patient is homebound, unable to leave without considerable and taxing effort. Wound care provided to right heel.";
  const results = detectPresence(draft, reqs);
  const homebound = results.find((r) => r.id === "homebound");
  assert.equal(homebound.present, true);
  assert.match(homebound.evidence, /taxing effort/i);
});

test("flags homebound as missing when absent", () => {
  const draft = "Reviewed medications. BP 132/80. Patient denies pain.";
  const results = detectPresence(draft, reqs);
  const homebound = results.find((r) => r.id === "homebound");
  assert.equal(homebound.present, false);
  assert.equal(homebound.evidence, null);
});

test("computeGaps returns only the missing elements", () => {
  const draft = "Patient homebound, requires taxing effort to leave. Skilled wound care performed.";
  const results = detectPresence(draft, reqs);
  const gapIds = computeGaps(results, reqs).map((e) => e.id);
  assert.ok(!gapIds.includes("homebound"));
  assert.ok(!gapIds.includes("skilled_need"));
  assert.ok(gapIds.includes("vitals")); // not documented in this draft
});

test("computeCriticalGaps surfaces only unanswered critical elements", () => {
  const draft = "Reviewed medications and taught the patient about diet.";
  const results = detectPresence(draft, reqs);
  const criticalGaps = computeCriticalGaps(results, reqs).map((e) => e.id);
  assert.deepEqual(criticalGaps.sort(), ["homebound", "skilled_need"]);
});

test("a fully documented draft has no critical gaps", () => {
  const draft =
    "Patient remains homebound, leaving home requires a considerable and taxing effort. " +
    "Skilled nursing assessment and wound care performed to the right heel.";
  const results = detectPresence(draft, reqs);
  assert.equal(computeCriticalGaps(results, reqs).length, 0);
});

test("carry-forward pre-fills stable elements from a prior note, never visit-specific ones", () => {
  const draft = "Skilled wound care performed."; // homebound + vitals are gaps
  const gaps = computeGaps(detectPresence(draft, reqs), reqs);
  const priorNote =
    "Patient is homebound, unable to leave without considerable and taxing effort. " +
    "BP 150/88, pain 4/10 this visit.";
  const prefill = computeCarryForward(priorNote, gaps);
  // homebound (stable) is carried with its prior evidence sentence...
  assert.ok(prefill.homebound);
  assert.match(prefill.homebound, /taxing effort/i);
  // ...but visit-specific findings (vitals, pain) are NOT carried forward.
  assert.equal(prefill.vitals, undefined);
  assert.equal(prefill.pain, undefined);
});

test("carry-forward returns nothing without a prior note", () => {
  const gaps = computeGaps(detectPresence("", reqs), reqs);
  assert.deepEqual(computeCarryForward("", gaps), {});
});

test("evidence is a clean single line for bullet drafts", () => {
  const draft = "BP 148/90, HR 82\nhomebound: unable to leave without taxing effort\nskilled wound care performed";
  const results = detectPresence(draft, reqs);
  const homebound = results.find((r) => r.id === "homebound");
  assert.equal(homebound.present, true);
  assert.ok(!homebound.evidence.includes("\n"), "evidence should not span multiple lines");
  assert.match(homebound.evidence, /taxing effort/i);
});
