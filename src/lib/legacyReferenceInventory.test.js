import test from "node:test";
import assert from "node:assert/strict";
import { buildLegacyReferenceInventory, summarizeLegacyReferenceInventory } from "./legacyReferenceInventory.js";

test("legacy inventory marks references removable only when a replacement exists", () => {
  const inventory = buildLegacyReferenceInventory([
    { file: "src/pages/ClinicalChart.jsx", replacement: "PatientDetails", removable: true },
    { file: "src/pages/MyLearning.jsx", removable: true },
  ]);
  assert.equal(inventory[0].removable, true);
  assert.equal(inventory[1].removable, false);
});

test("legacy inventory summary separates removable items from retained parity references", () => {
  const summary = summarizeLegacyReferenceInventory([
    { file: "a", replacement: "b", removable: true },
    { file: "c", removable: false },
  ]);
  assert.deepEqual(summary, { total: 2, removable: 1, retainedForParity: 1, missingReplacement: ["c"] });
});
