// Drift guard: the frontend DEFAULT_PDGM_RATES / DEFAULT_ICD10_CLINICAL_GROUPS
// (used by the PDGM Rate Settings editor + the merge preview) MIRROR the hardcoded
// constants in base44/functions/calculatePDGM/entry.ts (the billing engine). If
// the two diverge, the editor's "defaults" and the estimate the engine produces
// disagree — a silent billing-correctness bug. This test parses the backend
// constants and asserts they equal the frontend copy (same convention as
// twilioInlineParity / faxRetryInlineParity).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PDGM_RATES, DEFAULT_ICD10_CLINICAL_GROUPS } from "./pdgmRates.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendSrc = fs.readFileSync(
  path.resolve(here, "../../../base44/functions/calculatePDGM/entry.ts"),
  "utf8"
);

// Extract a top-level `const NAME = { ... }` object literal by brace-matching and
// evaluate it (the literals contain only numbers/strings/nested objects + comments).
function extractObject(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*`).exec(backendSrc);
  if (!m) throw new Error(`const ${name} not found in calculatePDGM/entry.ts`);
  let i = m.index + m[0].length;
  while (backendSrc[i] !== "{") i++;
  const start = i;
  let depth = 0;
  for (; i < backendSrc.length; i++) {
    if (backendSrc[i] === "{") depth++;
    else if (backendSrc[i] === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return Function(`"use strict"; return (${backendSrc.slice(start, i)});`)();
}

function extractNumber(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`).exec(backendSrc);
  if (!m) throw new Error(`const ${name} not found in calculatePDGM/entry.ts`);
  return Number(m[1]);
}

test("DEFAULT_PDGM_RATES matches the backend calculatePDGM constants (no billing drift)", () => {
  assert.equal(DEFAULT_PDGM_RATES.basePaymentRate, extractNumber("BASE_PAYMENT_RATE_2026"));
  assert.equal(DEFAULT_PDGM_RATES.laborShare, extractNumber("PDGM_LABOR_SHARE_2026"));
  assert.deepEqual(DEFAULT_PDGM_RATES.clinicalGroupWeights, extractObject("CLINICAL_GROUP_WEIGHTS"));
  assert.deepEqual(DEFAULT_PDGM_RATES.functionalThresholds, extractObject("FUNCTIONAL_THRESHOLDS"));
  assert.deepEqual(DEFAULT_PDGM_RATES.functionalMultipliers, extractObject("FUNCTIONAL_MULTIPLIERS"));
  assert.deepEqual(DEFAULT_PDGM_RATES.comorbidityMultipliers, extractObject("COMORBIDITY_MULTIPLIERS"));
});

test("DEFAULT_ICD10_CLINICAL_GROUPS matches the backend ICD10_CLINICAL_GROUPS", () => {
  assert.deepEqual(DEFAULT_ICD10_CLINICAL_GROUPS, extractObject("ICD10_CLINICAL_GROUPS"));
});
