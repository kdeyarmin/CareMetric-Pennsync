import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_READINESS_EVIDENCE, LIVE_READINESS_REVIEWERS } from "./src/lib/liveReadinessGate.js";
import { LIVE_RELEASE_METADATA } from "./src/lib/liveReadinessReleaseLedger.js";
import { buildLiveReadinessReportFromJson, runLiveReadinessReportCli } from "./tools-live-readiness-report.mjs";

const matrix = [{ id: "LR-X", capability: "Example", priority: 1, phaseSource: "Phase X", risk: "high" }];
const release = Object.fromEntries(LIVE_RELEASE_METADATA.map((key) => [key, `${key}-value`]));
const reviewers = Object.fromEntries(LIVE_READINESS_REVIEWERS.map((reviewer) => [reviewer, "approved"]));
const evidenceEntries = Object.fromEntries(
  LIVE_READINESS_EVIDENCE.map((key) => [key, { value: `${key}-secret`, references: [`evidence/${key}.md`] }]),
);

function completeInput() {
  return JSON.stringify({ release, matrix, evidence: { "LR-X": { ...evidenceEntries, reviewers } } });
}

test("buildLiveReadinessReportFromJson emits a passing PHI-minimized report", () => {
  const report = buildLiveReadinessReportFromJson(completeInput());
  assert.equal(report.status, "pass");
  assert.equal(JSON.stringify(report).includes("secret"), false);
});

test("CLI returns 0 and writes JSON for passing readiness", () => {
  const writes = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tools-live-readiness-report.mjs", "evidence.json"],
    readFile: () => completeInput(),
    write: (message) => writes.push(message),
    error: () => {},
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(writes[0]).status, "pass");
});

test("CLI returns 1 for a valid but blocked readiness report", () => {
  const code = runLiveReadinessReportCli({
    argv: ["node", "tools-live-readiness-report.mjs", "evidence.json"],
    readFile: () => JSON.stringify({ release, matrix, evidence: { "LR-X": { owner: "ops" } } }),
    write: () => {},
    error: () => {},
  });
  assert.equal(code, 1);
});

test("CLI returns 2 for missing input or invalid JSON", () => {
  assert.equal(runLiveReadinessReportCli({ argv: ["node", "tool"], write: () => {}, error: () => {} }), 2);
  assert.equal(runLiveReadinessReportCli({ argv: ["node", "tool", "bad.json"], readFile: () => "{", write: () => {}, error: () => {} }), 2);
});


test("CLI returns 2 for invalid readiness input shape", () => {
  const errors = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "invalid-shape.json"],
    readFile: () => JSON.stringify({ evidence: { "LR-X": { owner: { value: "secret", references: "bad" } } } }),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.equal(errors[0].includes("evidence.LR-X.owner.references"), true);
  assert.equal(errors[0].includes("secret"), false);
});
