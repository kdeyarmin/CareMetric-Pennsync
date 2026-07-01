import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOasisAutofill,
  answersFromDrafts,
  normalizeItemId,
  DEFAULT_MIN_CONFIDENCE,
} from "./noteToOasisAutofill.js";

// Inline fixture mirroring the shape of OASIS_SECTIONS (oasisQuestions.jsx). The
// mapper takes `sections` as a param, so the pure test stays runnable under
// `node --test` without importing the JSX module; the app passes the real
// OASIS_SECTIONS at the call site.
const OASIS_SECTIONS = [
  {
    id: "transferring",
    questions: [
      {
        id: "m1860",
        label: "M1860 — Ambulation/Locomotion",
        options: [
          { value: 0, label: "0 — Able to independently walk on all surfaces" },
          { value: 1, label: "1 — With minor difficulty on uneven surfaces" },
          { value: 2, label: "2 — Requires use of one-handed device" },
          { value: 3, label: "3 — Requires use of two-handed device or walker" },
          { value: 4, label: "4 — Able to wheel self independently in wheelchair" },
          { value: 5, label: "5 — Unable to ambulate; bedfast" },
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
          { value: 1, label: "1 — Short of breath when walking over 20 feet" },
          { value: 2, label: "2 — Short of breath with moderate exertion" },
          { value: 3, label: "3 — Short of breath with minimal exertion at rest" },
          { value: 4, label: "4 — Short of breath with minimal exertion or at rest" },
        ],
      },
    ],
  },
];

const sugg = (over) => ({
  item_number: "M1860",
  suggested_value: "3",
  confidence_score: 90,
  supporting_text: "Patient ambulates with a walker and requires assist.",
  ...over,
});

test("normalizeItemId maps assorted formats to the form id", () => {
  assert.equal(normalizeItemId("M1860"), "m1860");
  assert.equal(normalizeItemId("M 1400"), "m1400");
  assert.equal(normalizeItemId("m2020"), "m2020");
});

test("builds an attestable draft for a valid, high-confidence suggestion", () => {
  const { drafts, applied } = buildOasisAutofill([sugg()], OASIS_SECTIONS);
  assert.ok(drafts.m1860);
  assert.equal(drafts.m1860.value, 3);
  assert.equal(drafts.m1860.attested, false);
  assert.equal(drafts.m1860.source, "note_autofill");
  assert.match(drafts.m1860.evidence, /walker/);
  assert.equal(applied.length, 1);
});

test("validates the suggested value against the item's real options", () => {
  // M1400 (dyspnea) max is 4; a stray 9 must not autofill.
  const { drafts, skipped } = buildOasisAutofill(
    [sugg({ item_number: "M1400", suggested_value: "9" })],
    OASIS_SECTIONS,
  );
  assert.equal(drafts.m1400, undefined);
  assert.ok(skipped.some((s) => s.reason === "unresolved_value"));
});

test("filters out low-confidence suggestions by default", () => {
  const { drafts, skipped } = buildOasisAutofill(
    [sugg({ confidence_score: 50 })],
    OASIS_SECTIONS,
  );
  assert.equal(drafts.m1860, undefined);
  assert.ok(skipped.some((s) => s.reason === "low_confidence" && s.confidence === 50));
});

test("minConfidence is configurable", () => {
  const { drafts } = buildOasisAutofill([sugg({ confidence_score: 55 })], OASIS_SECTIONS, { minConfidence: 50 });
  assert.ok(drafts.m1860);
});

test("skips suggestions for items not present in the form", () => {
  const { skipped } = buildOasisAutofill(
    [sugg({ item_number: "M9999" })],
    OASIS_SECTIONS,
  );
  assert.ok(skipped.some((s) => s.reason === "not_in_form"));
});

test("dedups to the highest-confidence suggestion per item", () => {
  const { drafts } = buildOasisAutofill(
    [sugg({ suggested_value: "2", confidence_score: 75 }), sugg({ suggested_value: "4", confidence_score: 95 })],
    OASIS_SECTIONS,
  );
  assert.equal(drafts.m1860.value, 4);
  assert.equal(drafts.m1860.confidence, 95);
});

test("resolves a value from an option label when the numeric value is absent", () => {
  // M1400 option 3 label mentions "minimal exertion at rest"
  const { drafts } = buildOasisAutofill(
    [sugg({ item_number: "M1400", suggested_value: "", suggested_value_label: "Short of breath with minimal exertion at rest" })],
    OASIS_SECTIONS,
  );
  assert.ok(drafts.m1400);
  assert.equal(drafts.m1400.value, 3);
});

test("carries the discrepancy flag through to the draft", () => {
  const { drafts } = buildOasisAutofill(
    [sugg({ discrepancy_flag: true, current_oasis_value: "1" })],
    OASIS_SECTIONS,
  );
  assert.equal(drafts.m1860.discrepancy, true);
  assert.equal(drafts.m1860.current_value, "1");
});

test("answersFromDrafts builds an answers patch for attested ids", () => {
  const { drafts } = buildOasisAutofill(
    [sugg(), sugg({ item_number: "M1400", suggested_value: "2" })],
    OASIS_SECTIONS,
  );
  const all = answersFromDrafts(drafts);
  assert.equal(all.m1860, 3);
  assert.equal(all.m1400, 2);
  const one = answersFromDrafts(drafts, ["m1860"]);
  assert.deepEqual(one, { m1860: 3 });
});

test("DEFAULT_MIN_CONFIDENCE is the documented 70% threshold", () => {
  assert.equal(DEFAULT_MIN_CONFIDENCE, 70);
});
