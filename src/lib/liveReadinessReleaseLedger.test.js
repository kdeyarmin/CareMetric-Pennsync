import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_READINESS_EVIDENCE,
  LIVE_READINESS_REVIEWERS,
} from "./liveReadinessGate.js";
import {
  LIVE_RELEASE_METADATA,
  createLiveReadinessReleaseLedger,
  ledgerRowsForExport,
} from "./liveReadinessReleaseLedger.js";

const matrix = [{ id: "LR-X", capability: "Example", priority: 1, phaseSource: "Phase X", risk: "high" }];
const completeRelease = Object.fromEntries(LIVE_RELEASE_METADATA.map((key) => [key, `${key}-value`]));
const completeEvidence = {
  "LR-X": {
    ...Object.fromEntries(LIVE_READINESS_EVIDENCE.map((key) => [key, { value: `${key}-sensitive-detail`, references: [`evidence/${key}.md`] }])),
    reviewers: Object.fromEntries(LIVE_READINESS_REVIEWERS.map((reviewer) => [reviewer, "approved"])),
  },
};

test("release ledger blocks readiness when release metadata is missing", () => {
  const ledger = createLiveReadinessReleaseLedger({ release_id: "release-1" }, completeEvidence, matrix);
  assert.equal(ledger.releaseComplete, false);
  assert.deepEqual(ledger.missingMetadata, LIVE_RELEASE_METADATA.filter((key) => key !== "release_id"));
  assert.deepEqual(ledger.blockedCapabilityIds, []);
});

test("release ledger blocks readiness when any capability packet is incomplete", () => {
  const ledger = createLiveReadinessReleaseLedger(completeRelease, { "LR-X": { owner: "ops" } }, matrix);
  assert.equal(ledger.releaseComplete, false);
  assert.deepEqual(ledger.missingMetadata, []);
  assert.deepEqual(ledger.blockedCapabilityIds, ["LR-X"]);
});

test("release ledger is complete only with metadata and complete evidence packets", () => {
  const ledger = createLiveReadinessReleaseLedger(completeRelease, completeEvidence, matrix);
  assert.equal(ledger.releaseComplete, true);
  assert.equal(ledger.reviewCompleteCount, 1);
  assert.equal(ledger.totalReferenceCount, LIVE_READINESS_EVIDENCE.length);
});

test("ledger export rows omit raw evidence values and expose counts only", () => {
  const ledger = createLiveReadinessReleaseLedger(completeRelease, completeEvidence, matrix);
  const [row] = ledgerRowsForExport(ledger);
  assert.deepEqual(Object.keys(row), [
    "release_id",
    "environment",
    "capability_id",
    "capability",
    "priority",
    "risk",
    "review_complete",
    "missing_evidence_count",
    "missing_reference_count",
    "missing_reviewer_count",
    "evidence_reference_count",
  ]);
  assert.equal(JSON.stringify(row).includes("sensitive-detail"), false);
});
