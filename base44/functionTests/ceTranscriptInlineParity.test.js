import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

import * as ceTranscript from "../../src/components/learning/ceTranscript.js";

/**
 * Drift guard for the credit-year helpers mirrored into
 * generateLearningTranscriptPDF. The printed transcript must group completions
 * into exactly the same credit years the in-app transcript shows, so the inline
 * copies are asserted to behave identically to the unit-tested source in
 * src/components/learning/ceTranscript.js. Mirrors
 * trainingVideosInlineParity.test.js.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  // Strip the npm imports (createClientFromRequest, jsPDF) and stub them: the
  // helpers under test are pure and never touch either.
  src = src.replace(/import[^;]*from\s+'npm:[^']*';?/g, "");
  src = `const createClientFromRequest = () => ({}); class jsPDF {}\n${src}`;
  const present = names.filter((n) => new RegExp(`(function|const)\\s+${n}\\b`).test(src));
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `ceinline_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${present.join(", ")} };\n`);
  try {
    return { mod: await import(pathToFileURL(tmp).href), present };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const ENTRY = "../functions/generateLearningTranscriptPDF/entry.ts";
const NAMES = ["creditYear", "round1", "dedupeCreditRecords", "groupByCreditYear"];

const CERTIFICATES = [
  { completion_date: "2026-03-04", issued_at: "2027-01-01" },
  { completion_date: "2025-12-31T23:30:00Z" },
  { issued_at: "2024-07-09T10:00:00Z" },
  { completion_date: "July 9, 2023" },
  { completion_date: "not a date" },
  { completion_date: "" },
  {},
  null,
  undefined,
];

test("inline credit-year helpers match ceTranscript.js", async () => {
  const { mod, present } = await loadInline(ENTRY, NAMES);
  assert.deepEqual(present, NAMES, "expected all helpers inline in generateLearningTranscriptPDF");

  for (const certificate of CERTIFICATES) {
    assert.equal(
      mod.creditYear(certificate),
      ceTranscript.creditYear(certificate),
      `creditYear drift for ${JSON.stringify(certificate)}`
    );
  }

  for (const value of [0, 1, 1.25, 1.24, 2.5, 11.96, -3.14]) {
    // round1 is not exported from ceTranscript.js (it is an internal helper), so
    // parity is asserted against its observable behavior through the transcript.
    assert.equal(mod.round1(value), Math.round(value * 10) / 10);
  }

  // The rounding the two sides apply to the same hour totals must agree.
  const hours = [0.5, 1, 1.5, 0.25, 0.75];
  const inlineTotal = mod.round1(hours.reduce((sum, h) => sum + h, 0));
  const uiTotal = ceTranscript.buildCeTranscript(
    hours.map((h, i) => ({
      id: `c${i}`,
      assignment_id: `a${i}`,
      course_id: `course-${i}`,
      hours: h,
      completion_date: "2026-02-01",
    })),
    { now: new Date("2026-06-01T00:00:00Z") }
  ).totalCeHours;
  assert.equal(inlineTotal, uiTotal);
});

// A mixed record set covering every rule the credit ledger applies:
//   1 — credited.
//   2 — a retake of assignment a1, so it must NOT be credited twice.
//   3 — a second course, credited.
//   4 — a separate assignment for course c-falls later the same year (how a
//       quarterly-recurring in-service arrives): credited on its own.
//   5 — a prior credit year.
//   6 — revoked, never credited.
//   7 — no completion or issue date, so it can't be placed in a credit year.
const MIXED = [
  { id: '1', assignment_id: 'a1', course_id: 'c-hipaa', hours: 1, completion_date: '2026-02-01' },
  { id: '2', assignment_id: 'a1', course_id: 'c-hipaa', hours: 1, completion_date: '2026-04-01' },
  { id: '3', assignment_id: 'a2', course_id: 'c-falls', hours: 0.5, completion_date: '2026-06-01' },
  { id: '4', assignment_id: 'a3', course_id: 'c-falls', hours: 0.5, completion_date: '2026-08-01' },
  { id: '5', assignment_id: 'a4', course_id: 'c-oasis', hours: 1.5, completion_date: '2025-05-01' },
  { id: '6', assignment_id: 'a9', course_id: 'c-hipaa', hours: 1, completion_date: '2026-03-01', revoked: true },
  { id: '7', assignment_id: 'a8', course_id: 'c-hipaa', hours: 1 },
];

test("inline dedupe keeps the same credit records as the in-app transcript", async () => {
  const { mod } = await loadInline(ENTRY, NAMES);

  const inlineIds = mod.dedupeCreditRecords(MIXED).map((record) => record.certificate.id);
  const uiIds = ceTranscript.dedupeCreditRecords(MIXED).map((record) => record.certificate.id);

  assert.deepEqual(inlineIds, uiIds);
  assert.deepEqual(inlineIds, ['1', '3', '4', '5']);
});

test("a legacy row without an assignment id can't double-credit its course", async () => {
  const { mod } = await loadInline(ENTRY, NAMES);
  const legacy = [
    { id: 'x', course_id: 'c-hipaa', hours: 1, completion_date: '2026-02-01' },
    { id: 'y', course_id: 'c-hipaa', hours: 1, completion_date: '2026-09-01' },
    // A later credit year is a genuine renewal and counts again.
    { id: 'z', course_id: 'c-hipaa', hours: 1, completion_date: '2027-02-01' },
  ];

  const inlineIds = mod.dedupeCreditRecords(legacy).map((record) => record.certificate.id);
  assert.deepEqual(inlineIds, ceTranscript.dedupeCreditRecords(legacy).map((r) => r.certificate.id));
  assert.deepEqual(inlineIds, ['x', 'z']);
});

test("printed credit-year subtotals match the in-app transcript exactly", async () => {
  const { mod } = await loadInline(ENTRY, NAMES);

  const printed = mod.groupByCreditYear(MIXED);
  const onScreen = ceTranscript.buildCeTranscript(MIXED, { now: new Date('2026-09-01T00:00:00Z') });

  // Same years, in the same newest-first order.
  assert.deepEqual(
    printed.yearTotals.map((entry) => entry.year),
    onScreen.years.map((entry) => entry.year)
  );
  // Same CE hours credited per year, and the same grand total on the header.
  assert.deepEqual(
    printed.yearTotals.map((entry) => entry.hours),
    onScreen.years.map((entry) => entry.ceHours)
  );
  assert.equal(printed.grandTotalHours, onScreen.totalCeHours);
  // Every row the PDF prints is a credited record, and the counts agree.
  assert.deepEqual(
    printed.yearTotals.map((entry) => entry.courseCount),
    onScreen.years.map((entry) => entry.courseCount)
  );
  assert.deepEqual(
    printed.yearGroups.map(([year, rows]) => [year, rows.length]),
    [[2026, 3], [2025, 1]]
  );
});
