import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

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
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/g, "");
  const present = names.filter((n) => new RegExp(`(function|const)\\s+${n}\\b`).test(src));
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const tmp = join(tmpdir(), `ceinline_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${present.join(", ")} };\n`);
  try {
    return { mod: await import(pathToFileURL(tmp).href), present };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const ENTRY = "./generateLearningTranscriptPDF/entry.ts";
const NAMES = ["creditYear", "round1"];

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
