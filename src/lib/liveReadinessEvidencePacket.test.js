import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_READINESS_EVIDENCE,
  LIVE_READINESS_REVIEWERS,
  createLiveReadinessEvidencePacket,
  summarizeLiveReadinessEvidencePackets,
} from "./liveReadinessGate.js";

const capability = { id: "LR-X", capability: "Example", priority: 1, phaseSource: "Phase X", risk: "high" };
const fullEvidenceEntries = Object.fromEntries(
  LIVE_READINESS_EVIDENCE.map((key) => [key, { value: `${key}-value`, references: [`docs/${key}.md`] }]),
);
const approvedReviewers = Object.fromEntries(LIVE_READINESS_REVIEWERS.map((reviewer) => [reviewer, "approved"]));

test("evidence packet reports missing evidence keys and reviewer decisions", () => {
  const packet = createLiveReadinessEvidencePacket(capability, { "LR-X": { owner: "ops" } });
  assert.equal(packet.reviewComplete, false);
  assert.deepEqual(packet.missingEvidence, LIVE_READINESS_EVIDENCE.filter((key) => key !== "owner"));
  assert.deepEqual(packet.missingReferences, ["owner"]);
  assert.deepEqual(packet.missingReviewerDecisions, LIVE_READINESS_REVIEWERS);
});

test("evidence packet requires references for present evidence", () => {
  const packet = createLiveReadinessEvidencePacket(capability, {
    "LR-X": { ...fullEvidenceEntries, test_evidence: { value: "passed" }, reviewers: approvedReviewers },
  });
  assert.equal(packet.reviewComplete, false);
  assert.deepEqual(packet.missingEvidence, []);
  assert.deepEqual(packet.missingReferences, ["test_evidence"]);
});

test("evidence packet is review-complete with evidence, references, and approvals", () => {
  const packet = createLiveReadinessEvidencePacket(capability, {
    "LR-X": { ...fullEvidenceEntries, reviewers: approvedReviewers },
  });
  assert.equal(packet.reviewComplete, true);
  assert.deepEqual(packet.missingEvidence, []);
  assert.deepEqual(packet.missingReferences, []);
  assert.deepEqual(packet.missingReviewerDecisions, []);
});

test("evidence packet summary counts complete, blocked, and missing-reference packets", () => {
  const matrix = [capability, { ...capability, id: "LR-Y", priority: 2 }, { ...capability, id: "LR-Z", priority: 3 }];
  const summary = summarizeLiveReadinessEvidencePackets(
    {
      "LR-X": { ...fullEvidenceEntries, reviewers: approvedReviewers },
      "LR-Y": { ...fullEvidenceEntries, rollback_plan: { value: "roll back manually" }, reviewers: approvedReviewers },
    },
    matrix,
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.reviewCompleteCount, 1);
  assert.equal(summary.blockedCount, 2);
  assert.equal(summary.missingReferenceCount, 1);
});
