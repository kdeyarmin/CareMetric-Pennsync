import test from "node:test";
import assert from "node:assert/strict";
import { glossaryLabel, validateTerminologyGlossary } from "./terminologyGlossary.js";

test("terminology glossary labels canonical workflow statuses", () => {
  assert.equal(glossaryLabel("awaiting_info"), "Awaiting information");
  assert.equal(glossaryLabel("retry_exhausted"), "Retry exhausted");
  assert.equal(glossaryLabel("custom_status"), "custom_status");
});

test("terminology glossary validates fields and duplicate labels", () => {
  assert.equal(validateTerminologyGlossary().valid, true);
  const result = validateTerminologyGlossary({ a: { label: "Same", domain: "x", definition: "one" }, b: { label: "Same" } });
  assert.deepEqual(result.errors, ["b:missing_field", "b:duplicate_label"]);
});
