import test from "node:test";
import assert from "node:assert/strict";
import * as autofill from "./noteToOasisAutofill.js";
import { buildOasisEvidence, normalizeItemId, EVIDENCE_ONLY_NOTICE } from "./noteToOasisAutofill.js";

// Inline fixture mirroring the shape of OASIS_SECTIONS (oasisQuestions.jsx). The
// mapper takes `sections` as a param, so the pure test stays runnable under
// `node --test` without importing the JSX module.
const OASIS_SECTIONS = [
  {
    id: "transferring",
    questions: [
      {
        id: "m1860",
        label: "M1860 — Ambulation/Locomotion",
        options: [
          { value: 0, label: "0 — Able to independently walk on all surfaces" },
          { value: 3, label: "3 — Requires use of two-handed device or walker" },
        ],
      },
    ],
  },
  {
    id: "respiratory",
    questions: [
      {
        id: "m1400",
        label: "M1400 — Respiratory Status: Dyspnea",
        options: [
          { value: 0, label: "0 — Not short of breath" },
          { value: 2, label: "2 — Short of breath with moderate exertion" },
        ],
      },
    ],
  },
];

test("normalizeItemId strips punctuation and case", () => {
  assert.equal(normalizeItemId("M1860"), "m1860");
  assert.equal(normalizeItemId("M 1860"), "m1860");
  assert.equal(normalizeItemId(null), "");
});

// ── the mapper no longer selects a response ────────────────────────────────

test("no exported function can produce an OASIS value to apply", () => {
  // This module used to export `buildOasisAutofill` (drafts carrying a resolved
  // `value`) and `answersFromDrafts` (a patch of those values for the form).
  // Both are gone: AI must not select a final official OASIS response, and the
  // surest way to guarantee that is for no value to exist to apply.
  assert.equal(autofill.buildOasisAutofill, undefined);
  assert.equal(autofill.answersFromDrafts, undefined);
  assert.equal(autofill.DEFAULT_MIN_CONFIDENCE, undefined);
});

test("evidence entries carry a verbatim quote and a question, never a value", () => {
  const { evidence } = buildOasisEvidence(
    [{
      item_number: "M1860",
      suggested_value: 3,
      suggested_value_label: "3 — Requires use of two-handed device or walker",
      supporting_text: "Patient ambulates 15 feet with a rolling walker.",
      clinical_rationale: "Walker use documented.",
      confidence_score: 95,
    }],
    OASIS_SECTIONS,
  );
  assert.equal(evidence.length, 1);
  const e = evidence[0];
  assert.equal(e.id, "m1860");
  assert.equal(e.evidence, "Patient ambulates 15 feet with a rolling walker.");
  assert.ok(e.question.length > 0);
  // Nothing on the entry is a code or a value.
  assert.equal(e.value, undefined);
  assert.equal(e.value_label, undefined);
  assert.equal(e.suggested_value, undefined);
  assert.ok(!Object.keys(e).includes("code"));
});

test("a model-produced code inside free text is neutralised", () => {
  const { evidence } = buildOasisEvidence(
    [{
      item_number: "M1400",
      supporting_text: "Short of breath climbing the stairs.",
      clinical_rationale: "Based on this, enter code 2 for M1400.",
    }],
    OASIS_SECTIONS,
  );
  assert.equal(evidence.length, 1);
  assert.ok(!/code 2/i.test(evidence[0].note), `code survived: ${evidence[0].note}`);
  assert.match(evidence[0].note, /select this response in your EMR/);
});

test("a suggestion with no verbatim evidence is skipped, not shown", () => {
  // An unevidenced assertion is exactly what must not reach the clinician.
  const { evidence, skipped } = buildOasisEvidence(
    [{ item_number: "M1860", clinical_rationale: "Probably a 3." }],
    OASIS_SECTIONS,
  );
  assert.equal(evidence.length, 0);
  assert.equal(skipped[0].reason, "no_verbatim_evidence");
});

test("an item that is not on this form is skipped", () => {
  const { evidence, skipped } = buildOasisEvidence(
    [{ item_number: "M9999", supporting_text: "Something." }],
    OASIS_SECTIONS,
  );
  assert.equal(evidence.length, 0);
  assert.equal(skipped[0].reason, "not_in_form");
});

test("only the first entry per item is kept", () => {
  const { evidence } = buildOasisEvidence(
    [
      { item_number: "M1860", supporting_text: "Uses a walker." },
      { item_number: "M1860", supporting_text: "Ambulates with assistance." },
    ],
    OASIS_SECTIONS,
  );
  assert.equal(evidence.length, 1);
});

test("junk input is safe", () => {
  assert.deepEqual(buildOasisEvidence(null, OASIS_SECTIONS).evidence, []);
  assert.deepEqual(buildOasisEvidence([], null).evidence, []);
  assert.deepEqual(buildOasisEvidence([null, {}], OASIS_SECTIONS).evidence, []);
});

test("the evidence-only notice states PennSync does not select responses", () => {
  assert.match(EVIDENCE_ONLY_NOTICE, /does not select OASIS responses/);
});
