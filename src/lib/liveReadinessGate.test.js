import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_READINESS_EVIDENCE,
  evaluateLiveCapabilityReadiness,
  evaluateLiveReadinessMatrix,
  recommendedLiveImplementationOrder,
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
