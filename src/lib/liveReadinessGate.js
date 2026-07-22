export const LIVE_READINESS_EVIDENCE = Object.freeze([
  "owner",
  "product_approval",
  "security_approval",
  "hosted_environment",
  "credentials_or_sandbox",
  "test_evidence",
  "rollback_plan",
  "monitoring_plan",
]);

export const LIVE_CAPABILITY_MATRIX = Object.freeze([
  { id: "LR-01", capability: "Hosted tenant/RLS verification", priority: 1, phaseSource: "Phase 0", risk: "critical" },
  { id: "LR-02", capability: "Seeded authenticated staging E2E", priority: 2, phaseSource: "Phase 0", risk: "critical" },
  { id: "LR-03", capability: "Patient portal live access", priority: 3, phaseSource: "Phase 4", risk: "high" },
  { id: "LR-04", capability: "SSO and enterprise audit export", priority: 4, phaseSource: "Phase 5", risk: "high" },
  { id: "LR-05", capability: "EHR/FHIR-lite sandbox integration", priority: 5, phaseSource: "Phase 3", risk: "high" },
  { id: "LR-06", capability: "Billing denial feedback import", priority: 6, phaseSource: "Phase 3", risk: "medium" },
  { id: "LR-07", capability: "AI provenance and clinical governance dashboard", priority: 7, phaseSource: "Phase 3/4", risk: "high" },
  { id: "LR-08", capability: "Provider communications sandbox verification", priority: 8, phaseSource: "Phase 0/1", risk: "medium" },
  { id: "LR-09", capability: "Legacy page cleanup", priority: 9, phaseSource: "Phase 5", risk: "low" },
]);

function evidenceFor(capabilityId, evidence = {}) {
  return evidence[capabilityId] || {};
}

export function evaluateLiveCapabilityReadiness(capability, evidence = {}) {
  const capabilityEvidence = evidenceFor(capability.id, evidence);
  const missing = LIVE_READINESS_EVIDENCE.filter((key) => !capabilityEvidence[key]);
  return {
    ...capability,
    ready: missing.length === 0,
    missing,
    status: missing.length === 0 ? "ready_for_live_validation" : "blocked",
  };
}

export function evaluateLiveReadinessMatrix(evidence = {}, matrix = LIVE_CAPABILITY_MATRIX) {
  const capabilities = matrix.map((capability) => evaluateLiveCapabilityReadiness(capability, evidence));
  return {
    ready: capabilities.every((capability) => capability.ready),
    readyCount: capabilities.filter((capability) => capability.ready).length,
    blockedCount: capabilities.filter((capability) => !capability.ready).length,
    capabilities,
  };
}

export function recommendedLiveImplementationOrder(evidence = {}, matrix = LIVE_CAPABILITY_MATRIX) {
  return evaluateLiveReadinessMatrix(evidence, matrix).capabilities
    .slice()
    .sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return a.priority - b.priority;
    });
}


export const LIVE_READINESS_REVIEWERS = Object.freeze([
  "product",
  "security",
  "qa",
  "release",
]);

function normalizeEvidenceEntry(value) {
  if (!value) {
    return { present: false, value: null, references: [], missingReferences: false };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const references = Array.isArray(value.references) ? value.references.filter(Boolean) : [];
    const hasValue = Boolean(value.value || value.summary || references.length);
    return {
      present: hasValue,
      value: value.value || value.summary || null,
      references,
      missingReferences: hasValue && references.length === 0,
    };
  }
  return { present: true, value, references: [], missingReferences: true };
}

function reviewerDecisionsFor(evidence = {}) {
  const reviewers = evidence.reviewers || {};
  return Object.fromEntries(
    LIVE_READINESS_REVIEWERS.map((reviewer) => [reviewer, reviewers[reviewer] || "missing"]),
  );
}

export function createLiveReadinessEvidencePacket(capability, evidence = {}) {
  const capabilityEvidence = evidenceFor(capability.id, evidence);
  const evidenceEntries = Object.fromEntries(
    LIVE_READINESS_EVIDENCE.map((key) => [key, normalizeEvidenceEntry(capabilityEvidence[key])]),
  );
  const missingEvidence = Object.entries(evidenceEntries)
    .filter(([, entry]) => !entry.present)
    .map(([key]) => key);
  const missingReferences = Object.entries(evidenceEntries)
    .filter(([, entry]) => entry.missingReferences)
    .map(([key]) => key);
  const reviewerDecisions = reviewerDecisionsFor(capabilityEvidence);
  const missingReviewerDecisions = Object.entries(reviewerDecisions)
    .filter(([, decision]) => decision !== "approved")
    .map(([reviewer]) => reviewer);

  return {
    capabilityId: capability.id,
    capability: capability.capability,
    priority: capability.priority,
    risk: capability.risk,
    evidence: evidenceEntries,
    missingEvidence,
    missingReferences,
    reviewerDecisions,
    missingReviewerDecisions,
    reviewComplete: missingEvidence.length === 0 && missingReferences.length === 0 && missingReviewerDecisions.length === 0,
  };
}

export function summarizeLiveReadinessEvidencePackets(evidence = {}, matrix = LIVE_CAPABILITY_MATRIX) {
  const packets = matrix.map((capability) => createLiveReadinessEvidencePacket(capability, evidence));
  return {
    total: packets.length,
    reviewCompleteCount: packets.filter((packet) => packet.reviewComplete).length,
    blockedCount: packets.filter((packet) => !packet.reviewComplete).length,
    missingReferenceCount: packets.filter((packet) => packet.missingReferences.length > 0).length,
    packets,
  };
}
