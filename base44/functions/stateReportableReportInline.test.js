import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/**
 * Guard for buildReportText, the pure report-body builder inlined in
 * submitStateReportableIncident (single-file Deno deploy model). The same text
 * feeds BOTH the immediate admin email and the retained PDF copy of a
 * state-mandated report, so a regression here corrupts the official record.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  // Strip the npm imports (createClientFromRequest, jsPDF) so the module loads
  // under node:test; they are stubbed below and unused by buildReportText.
  src = src.replace(/import[^;]*from\s+'npm:[^']*';?/g, "");
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const stubs = "const createClientFromRequest = () => ({}); class jsPDF {}\n";
  const tmp = join(tmpdir(), `srpt_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${stubs}${js}\nexport { ${names.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

test("buildReportText includes the patient, event, and follow-up sections", async () => {
  const { buildReportText } = await loadInline(
    "./submitStateReportableIncident/entry.ts",
    ["buildReportText"],
  );
  const text = buildReportText({
    patient_name: "Jane Doe",
    event_date: "2026-06-19",
    event_time: "13:45",
    event_type: "Patient Neglect",
    location_of_event: "Home",
    medications: "Lisinopril 10mg daily",
    diagnosis: "CHF",
    factual_description: "Observed X.",
    followup_action: "Notified physician.",
    submitted_by_name: "Nurse RN",
    submitted_by_title: "RN",
  });
  assert.match(text, /STATE REPORTABLE EVENT REPORT/);
  assert.match(text, /Patient: Jane Doe/);
  assert.match(text, /Event Type: Patient Neglect/);
  assert.match(text, /Lisinopril 10mg daily/);
  assert.match(text, /Factual Description:\nObserved X\./);
  assert.match(text, /Description of Follow-up Action:\nNotified physician\./);
  assert.match(text, /Submitted By: Nurse RN \(RN\)/);
});

test("buildReportText falls back gracefully when optional fields are blank", async () => {
  const { buildReportText } = await loadInline(
    "./submitStateReportableIncident/entry.ts",
    ["buildReportText"],
  );
  const text = buildReportText({
    patient_id: "p_123",
    event_type: "Rape",
    event_date: "2026-06-19",
    factual_description: "Details.",
    followup_action: "Action.",
  });
  assert.match(text, /Patient: p_123/); // falls back to patient_id
  assert.match(text, /Medications \(Name & Frequency\):\nNot provided/);
  assert.match(text, /Diagnosis of Patient:\nNot provided/);
  assert.match(text, /Submitted By: Unknown/); // no title parens when absent
  assert.doesNotMatch(text, /\(undefined\)/);
});
