import test from "node:test";
import assert from "node:assert/strict";
import { annotateProvenance } from "./provenance.js";

test("a sentence whose values trace to the input is supported", () => {
  const ann = annotateProvenance("BP was 148/90 today.", "vitals BP 148/90, HR 82");
  assert.equal(ann.length, 1);
  assert.equal(ann[0].status, "supported");
  assert.ok(ann[0].tokens.some((t) => t.value === "148/90" && t.supported));
});

test("a sentence with a value not in the input is unsupported", () => {
  const ann = annotateProvenance("O2 saturation was 91%.", "BP 148/90");
  assert.equal(ann[0].status, "unsupported");
  assert.ok(ann[0].tokens.some((t) => t.value === "91%" && !t.supported));
});

test("a sentence with no hard values is narrative", () => {
  const ann = annotateProvenance("The patient tolerated the visit well.", "anything");
  assert.equal(ann[0].status, "narrative");
  assert.deepEqual(ann[0].tokens, []);
});

test("flags a medication not present in the input", () => {
  const ann = annotateProvenance("Administered warfarin.", "took metformin this morning");
  const med = ann[0].tokens.find((t) => t.type === "medication");
  assert.ok(med);
  assert.equal(med.supported, false);
});

test("a medication present in the input is supported", () => {
  const ann = annotateProvenance("Reviewed metformin with the patient.", "metformin 500 mg daily");
  const med = ann[0].tokens.find((t) => t.type === "medication");
  assert.ok(med);
  assert.equal(med.supported, true);
});

test("empty note yields no annotations", () => {
  assert.deepEqual(annotateProvenance("", "x"), []);
});
