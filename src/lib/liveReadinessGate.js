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

function requireNonEmptyCapabilityMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new TypeError("Live-readiness capability matrix must be a non-empty array.");
  }
  return matrix;
}

function evidenceFor(capabilityId, evidence = {}) {
  return evidence[capabilityId] || {};
}

function hasPlanningEvidence(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return [value.value, value.summary]
    .some((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
}

export function evaluateLiveCapabilityReadiness(capability, evidence = {}) {
  const capabilityEvidence = evidenceFor(capability.id, evidence);
  // This is a planning signal, not the release gate. Still reject empty or
  // reference-only objects so a matrix cannot look ready from truthiness alone.
  const missing = LIVE_READINESS_EVIDENCE.filter(
    (key) => !hasPlanningEvidence(capabilityEvidence[key]),
  );
  return {
    ...capability,
    ready: missing.length === 0,
    missing,
    status: missing.length === 0 ? "ready_for_live_validation" : "blocked",
  };
}

export function evaluateLiveReadinessMatrix(evidence = {}, matrix = LIVE_CAPABILITY_MATRIX) {
  const capabilities = requireNonEmptyCapabilityMatrix(matrix)
    .map((capability) => evaluateLiveCapabilityReadiness(capability, evidence));
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

export const LIVE_READINESS_PROBES = Object.freeze({
  "LR-01": Object.freeze({
    required: Object.freeze(["V1", "V2", "V3", "V4", "V5", "V6", "T1", "T2", "T3", "T4"]),
    optional: Object.freeze([]),
  }),
  "LR-02": Object.freeze({
    required: Object.freeze(["S1", "S2", "S3", "S4"]),
    optional: Object.freeze(["S5", "S6", "S7", "S8", "S9"]),
  }),
});

export const LIVE_READINESS_PROBE_EXECUTION_CONTEXT = "authenticated_hosted";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_CAPTURED_AT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalCapturedAt(value) {
  if (typeof value !== "string" || !CANONICAL_CAPTURED_AT_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function probePlanFor(capabilityId) {
  return LIVE_READINESS_PROBES[capabilityId] || { required: [], optional: [] };
}

function normalizedProbeEvidence(value, capabilityId) {
  const plan = probePlanFor(capabilityId);
  const supplied = value && typeof value === "object" && !Array.isArray(value)
    ? value.probes
    : null;
  const probes = Object.fromEntries(
    [...plan.required, ...plan.optional].flatMap((probeId) => {
      const raw = supplied && typeof supplied === "object" && !Array.isArray(supplied)
        ? supplied[probeId]
        : null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const references = Array.isArray(raw.references)
        ? raw.references.filter((reference) => (
          typeof reference === "string" && reference.trim().length > 0
        ))
        : [];
      const executionContext = raw.execution_context === LIVE_READINESS_PROBE_EXECUTION_CONTEXT
        ? raw.execution_context
        : null;
      const result = ["pass", "fail", "blocked"].includes(raw.result)
        ? raw.result
        : null;
      const capturedAt = isCanonicalCapturedAt(raw.captured_at)
        ? raw.captured_at
        : null;
      const artifactSha256 = typeof raw.artifact_sha256 === "string"
        && SHA256_PATTERN.test(raw.artifact_sha256)
        ? raw.artifact_sha256
        : null;
      const complete = references.length > 0
        && executionContext !== null
        && result === "pass"
        && capturedAt !== null
        && artifactSha256 !== null;
      return [[probeId, {
        references,
        executionContext,
        result,
        capturedAt,
        artifactSha256,
        complete,
      }]];
    }),
  );
  const completedProbeIds = Object.entries(probes)
    .filter(([, entry]) => entry.complete)
    .map(([probeId]) => probeId);
  const nonPassingProbeIds = Object.entries(probes)
    .filter(([, entry]) => entry.result === "fail" || entry.result === "blocked")
    .map(([probeId]) => probeId);
  const incompleteSuppliedProbeIds = Object.entries(probes)
    .filter(([, entry]) => !entry.complete)
    .map(([probeId]) => probeId);
  return {
    probes,
    requiredProbeIds: [...plan.required],
    completedProbeIds,
    nonPassingProbeIds,
    incompleteSuppliedProbeIds,
    missingRequiredProbeIds: plan.required.filter((probeId) => (
      !probes[probeId] || !probes[probeId].complete
    )),
  };
}

function normalizeEvidenceEntry(value, capabilityId, evidenceKey) {
  const probeEvidence = evidenceKey === "test_evidence"
    ? normalizedProbeEvidence(value, capabilityId)
    : {
      probes: {},
      requiredProbeIds: [],
      completedProbeIds: [],
      nonPassingProbeIds: [],
      incompleteSuppliedProbeIds: [],
      missingRequiredProbeIds: [],
    };
  if (!value) {
    return {
      present: false,
      value: null,
      references: [],
      missingReferences: false,
      ...probeEvidence,
    };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const references = Array.isArray(value.references)
      ? value.references.filter((reference) => (
        typeof reference === "string" && reference.trim().length > 0
      ))
      : [];
    // A citation alone does not state what reviewers attested. Require a
    // filled value or summary; references remain an independent requirement.
    const normalizedValue = [value.value, value.summary].find((candidate) => (
      typeof candidate === "string" && candidate.trim().length > 0
    )) || null;
    return {
      present: normalizedValue !== null,
      value: normalizedValue,
      references,
      missingReferences: normalizedValue !== null && references.length === 0,
      ...probeEvidence,
    };
  }
  const primitiveValue = typeof value === "string" && value.trim().length > 0
    ? value
    : null;
  return {
    present: primitiveValue !== null,
    value: primitiveValue,
    references: [],
    missingReferences: primitiveValue !== null,
    ...probeEvidence,
  };
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
    LIVE_READINESS_EVIDENCE.map((key) => [
      key,
      normalizeEvidenceEntry(capabilityEvidence[key], capability.id, key),
    ]),
  );
  const missingEvidence = Object.entries(evidenceEntries)
    .filter(([, entry]) => !entry.present)
    .map(([key]) => key);
  const missingReferences = Object.entries(evidenceEntries)
    .filter(([, entry]) => entry.missingReferences)
    .map(([key]) => key);
  const requiredProbeIds = evidenceEntries.test_evidence.requiredProbeIds;
  const completedProbeIds = evidenceEntries.test_evidence.completedProbeIds;
  const missingRequiredProbeIds = evidenceEntries.test_evidence.missingRequiredProbeIds;
  const nonPassingProbeIds = evidenceEntries.test_evidence.nonPassingProbeIds;
  const incompleteSuppliedProbeIds = evidenceEntries.test_evidence.incompleteSuppliedProbeIds;
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
    requiredProbeIds,
    completedProbeIds,
    missingRequiredProbeIds,
    nonPassingProbeIds,
    incompleteSuppliedProbeIds,
    reviewerDecisions,
    missingReviewerDecisions,
    reviewComplete: missingEvidence.length === 0
      && missingReferences.length === 0
      && missingRequiredProbeIds.length === 0
      && nonPassingProbeIds.length === 0
      && incompleteSuppliedProbeIds.length === 0
      && missingReviewerDecisions.length === 0,
  };
}

export function summarizeLiveReadinessEvidencePackets(evidence = {}, matrix = LIVE_CAPABILITY_MATRIX) {
  const packets = requireNonEmptyCapabilityMatrix(matrix)
    .map((capability) => createLiveReadinessEvidencePacket(capability, evidence));
  return {
    total: packets.length,
    reviewCompleteCount: packets.filter((packet) => packet.reviewComplete).length,
    blockedCount: packets.filter((packet) => !packet.reviewComplete).length,
    missingReferenceCount: packets.filter((packet) => packet.missingReferences.length > 0).length,
    packets,
  };
}
