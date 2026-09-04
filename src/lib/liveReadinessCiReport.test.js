import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_READINESS_EVIDENCE,
  LIVE_READINESS_REVIEWERS,
} from "./liveReadinessGate.js";
import {
  LIVE_RELEASE_METADATA,
  createLiveReadinessReleaseLedger,
} from "./liveReadinessReleaseLedger.js";
import { createLiveReadinessCiReport } from "./liveReadinessCiReport.js";

const matrix = [{ id: "LR-X", capability: "Example", priority: 1, phaseSource: "Phase X", risk: "high" }];
const completeRelease = Object.fromEntries(LIVE_RELEASE_METADATA.map((key) => [key, `${key}-value`]));
const approvedReviewers = Object.fromEntries(LIVE_READINESS_REVIEWERS.map((reviewer) => [reviewer, "approved"]));
const completeEvidenceEntries = Object.fromEntries(
  LIVE_READINESS_EVIDENCE.map((key) => [key, { value: `${key}-private`, references: [`evidence/${key}.md`] }]),
);

test("CI report passes only for a release-complete ledger", () => {
  const ledger = createLiveReadinessReleaseLedger(
    completeRelease,
    { "LR-X": { ...completeEvidenceEntries, reviewers: approvedReviewers } },
    matrix,
  );
  const report = createLiveReadinessCiReport(ledger);
  assert.equal(report.status, "pass");
  assert.deepEqual(report.messages, ["Evaluated readiness packet is structurally complete for LR-X."]);
  assert.deepEqual(report.evaluatedCapabilityIds, ["LR-X"]);
  assert.equal(report.totalReferenceCount, LIVE_READINESS_EVIDENCE.length);
  assert.deepEqual(report.referenceCountsByCapability, { "LR-X": LIVE_READINESS_EVIDENCE.length });
  assert.deepEqual(report.probeCountsByCapability, { "LR-X": { required: 0, completed: 0 } });
  assert.deepEqual(report.blockers.missingRequiredProbes, {});
});

test("CI report fails and classifies missing release metadata", () => {
  const ledger = createLiveReadinessReleaseLedger(
    { release_id: "release-1" },
    { "LR-X": { ...completeEvidenceEntries, reviewers: approvedReviewers } },
    matrix,
  );
  const report = createLiveReadinessCiReport(ledger);
  assert.equal(report.status, "fail");
  assert.deepEqual(report.blockers.metadata, LIVE_RELEASE_METADATA.filter((key) => key !== "release_id"));
});

test("CI report classifies capability, reference, and reviewer blockers", () => {
  const ledger = createLiveReadinessReleaseLedger(
    completeRelease,
    { "LR-X": { ...completeEvidenceEntries, test_evidence: { value: "passed" } } },
    matrix,
  );
  const report = createLiveReadinessCiReport(ledger);
  assert.equal(report.status, "fail");
  assert.deepEqual(report.blockers.capabilities, ["LR-X"]);
  assert.deepEqual(report.blockers.missingReferences, ["LR-X"]);
  assert.deepEqual(report.blockers.missingReviewers, ["LR-X"]);
});

test("CI report messages omit raw evidence values", () => {
  const ledger = createLiveReadinessReleaseLedger(completeRelease, { "LR-X": { owner: "owner-private" } }, matrix);
  const report = createLiveReadinessCiReport(ledger);
  assert.equal(JSON.stringify(report).includes("owner-private"), false);
  assert.equal(report.messages.some((message) => message.includes("LR-X")), true);
});

test("CI report rejects an empty or unreconciled forged ledger", () => {
  assert.throws(
    () => createLiveReadinessCiReport({
      releaseComplete: true,
      packets: [],
      totalCapabilities: 0,
    }),
    /non-empty reconciled ledger/,
  );
  assert.throws(
    () => createLiveReadinessCiReport({
      releaseComplete: true,
      packets: [{}],
      totalCapabilities: 2,
    }),
    /non-empty reconciled ledger/,
  );
});
