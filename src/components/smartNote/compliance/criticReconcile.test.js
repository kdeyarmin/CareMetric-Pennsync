import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCritique, mergeGaps } from "./criticReconcile.js";

const required = [
  { id: "homebound", label: "Homebound", severity: "critical" },
  { id: "safety", label: "Safety", severity: "required" },
  { id: "pain", label: "Pain", severity: "required" },
];
const presence = [
  { id: "homebound", present: true },
  { id: "safety", present: true }, // keyword scan over-counted "no fall assessment done"
  { id: "pain", present: false },
];

test("demotes an over-counted present element the critic judges absent", () => {
  const critique = [{ id: "safety", documented: false }];
  const { demotedIds } = reconcileCritique(critique, { requiredElements: required, presence });
  assert.deepEqual(demotedIds, ["safety"]);
});

test("does not demote an element that was genuinely absent (already a gap)", () => {
  const critique = [{ id: "pain", documented: false }];
  const { demotedIds } = reconcileCritique(critique, { requiredElements: required, presence });
  assert.equal(demotedIds.length, 0); // pain wasn't present, so nothing to demote
});

test("drops unknown ids the model might hallucinate", () => {
  const critique = [
    { id: "made_up_topic", documented: false },
    { id: "safety", documented: false },
  ];
  const { demotedIds } = reconcileCritique(critique, { requiredElements: required, presence });
  assert.deepEqual(demotedIds, ["safety"]);
});

test("captures inadequate (vague) documented elements as nudges", () => {
  const critique = [{ id: "homebound", documented: true, adequate: false, reason: "no taxing-effort detail", suggestedQuestion: "Why is leaving taxing?" }];
  const { inadequate } = reconcileCritique(critique, { requiredElements: required, presence });
  assert.ok(inadequate.homebound);
  assert.equal(inadequate.homebound.reason, "no taxing-effort detail");
});

test("handles empty / non-array critique safely", () => {
  for (const c of [[], null, undefined, "oops"]) {
    const r = reconcileCritique(c, { requiredElements: required, presence });
    assert.deepEqual(r.demotedIds, []);
    assert.deepEqual(r.inadequate, {});
  }
});

test("mergeGaps only adds, preserving deterministic gaps", () => {
  const deterministicGaps = [{ id: "pain" }];
  const merged = mergeGaps(deterministicGaps, required, ["safety"]);
  assert.deepEqual(merged.map((g) => g.id), ["pain", "safety"]);
});

test("mergeGaps with no demotions returns the original list reference-safe", () => {
  const deterministicGaps = [{ id: "pain" }];
  assert.deepEqual(mergeGaps(deterministicGaps, required, []).map((g) => g.id), ["pain"]);
});

test("mergeGaps never duplicates an element already in the gaps", () => {
  const deterministicGaps = [{ id: "safety" }];
  const merged = mergeGaps(deterministicGaps, required, ["safety"]);
  assert.equal(merged.filter((g) => g.id === "safety").length, 1);
});
