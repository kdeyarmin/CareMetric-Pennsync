import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_READINESS_EVIDENCE,
  LIVE_CAPABILITY_MATRIX,
  LIVE_READINESS_PROBES,
  LIVE_READINESS_REVIEWERS,
  createLiveReadinessEvidencePacket,
  evaluateLiveCapabilityReadiness,
  evaluateLiveReadinessMatrix,
  recommendedLiveImplementationOrder,
  summarizeLiveReadinessEvidencePackets,
} from "./liveReadinessGate.js";

const capability = { id: "LR-X", capability: "Example", priority: 1, phaseSource: "Phase X", risk: "high" };
const fullEvidence = Object.fromEntries(LIVE_READINESS_EVIDENCE.map((key) => [key, `${key}-value`]));

test("live capability readiness is blocked until every required evidence field exists", () => {
  const result = evaluateLiveCapabilityReadiness(capability, { "LR-X": { owner: "qa" } });
  assert.equal(result.ready, false);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missing, LIVE_READINESS_EVIDENCE.filter((key) => key !== "owner"));
});

test("live capability readiness succeeds only with approvals, environment, tests, rollback, and monitoring", () => {
  const result = evaluateLiveCapabilityReadiness(capability, { "LR-X": fullEvidence });
  assert.equal(result.ready, true);
  assert.equal(result.status, "ready_for_live_validation");
  assert.deepEqual(result.missing, []);
});

test("matrix summarizes ready and blocked capabilities", () => {
  const matrix = [capability, { ...capability, id: "LR-Y", priority: 2 }];
  const result = evaluateLiveReadinessMatrix({ "LR-X": fullEvidence }, matrix);
  assert.equal(result.ready, false);
  assert.equal(result.readyCount, 1);
  assert.equal(result.blockedCount, 1);
});

test("recommended order puts ready capabilities first then priority order", () => {
  const matrix = [
    { ...capability, id: "LR-3", priority: 3 },
    { ...capability, id: "LR-1", priority: 1 },
    { ...capability, id: "LR-2", priority: 2 },
  ];
  const ordered = recommendedLiveImplementationOrder({ "LR-3": fullEvidence }, matrix);
  assert.deepEqual(ordered.map((item) => item.id), ["LR-3", "LR-1", "LR-2"]);
});

test("matrix helpers reject an empty scope instead of passing vacuously", () => {
  assert.throws(() => evaluateLiveReadinessMatrix({}, []), /non-empty array/);
  assert.throws(() => recommendedLiveImplementationOrder({}, []), /non-empty array/);
  assert.throws(() => summarizeLiveReadinessEvidencePackets({}, []), /non-empty array/);
});

test("planning readiness rejects empty and reference-only evidence objects", () => {
  const emptyObjects = Object.fromEntries(LIVE_READINESS_EVIDENCE.map((key) => [key, {}]));
  const referenceOnly = Object.fromEntries(
    LIVE_READINESS_EVIDENCE.map((key) => [key, { references: [`evidence/${key}.md`] }]),
  );
  assert.equal(evaluateLiveCapabilityReadiness(capability, { "LR-X": emptyObjects }).ready, false);
  assert.equal(evaluateLiveCapabilityReadiness(capability, { "LR-X": referenceOnly }).ready, false);
});

test("release evidence cannot complete LR-01 without every required probe artifact", () => {
  const capabilityEvidence = {
    ...Object.fromEntries(LIVE_READINESS_EVIDENCE.map((key) => [key, {
      summary: `${key} complete`,
      references: [`evidence/${key}.md`],
    }])),
    reviewers: Object.fromEntries(
      LIVE_READINESS_REVIEWERS.map((reviewer) => [reviewer, "approved"]),
    ),
  };
  let packet = createLiveReadinessEvidencePacket(
    LIVE_CAPABILITY_MATRIX[0],
    { "LR-01": capabilityEvidence },
  );
  assert.equal(packet.reviewComplete, false);
  assert.deepEqual(packet.missingRequiredProbeIds, LIVE_READINESS_PROBES["LR-01"].required);

  capabilityEvidence.test_evidence.probes = Object.fromEntries(
    LIVE_READINESS_PROBES["LR-01"].required.map((probeId) => [probeId, {
      references: [`evidence/LR-01/${probeId}.json`],
    }]),
  );
  packet = createLiveReadinessEvidencePacket(
    LIVE_CAPABILITY_MATRIX[0],
    { "LR-01": capabilityEvidence },
  );
  assert.equal(packet.reviewComplete, true);
  assert.deepEqual(packet.completedProbeIds, LIVE_READINESS_PROBES["LR-01"].required);
});
