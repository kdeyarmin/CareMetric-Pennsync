import {
  LIVE_CAPABILITY_MATRIX,
  createLiveReadinessEvidencePacket,
} from "./liveReadinessGate.js";

export const LIVE_RELEASE_METADATA = Object.freeze([
  "release_id",
  "environment",
  "fixture_set_id",
  "staging_app_id",
  "staging_origin",
  "staging_backend_origin",
  "candidate_source_commit_sha",
  "candidate_source_tree_sha",
  "source_authority_contract_sha256",
  "hosted_runtime_commit_sha",
  "hosted_runtime_tree_sha",
  "hosted_deployment_id",
  "candidate_deployable_manifest_sha256",
  "hosted_resource_manifest_sha256",
  "requested_rollout_date",
  "release_owner",
  "rollback_owner",
  "monitoring_owner",
]);

function missingReleaseMetadata(release = {}) {
  return LIVE_RELEASE_METADATA.filter((key) => !release[key]);
}

function referenceCount(packet) {
  return Object.values(packet.evidence).reduce((total, entry) => (
    total
    + entry.references.length
    + Object.values(entry.probes || {}).reduce(
      (probeTotal, probe) => probeTotal + probe.references.length,
      0,
    )
  ), 0);
}

export function createLiveReadinessReleaseLedger(release = {}, evidence = {}, matrix = LIVE_CAPABILITY_MATRIX) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new TypeError("Live-readiness release matrix must be a non-empty array.");
  }
  const packets = matrix.map((capability) => createLiveReadinessEvidencePacket(capability, evidence));
  const missingMetadata = missingReleaseMetadata(release);
  const blockedCapabilityIds = packets.filter((packet) => !packet.reviewComplete).map((packet) => packet.capabilityId);

  return {
    release: Object.fromEntries(LIVE_RELEASE_METADATA.map((key) => [key, release[key] || null])),
    missingMetadata,
    totalCapabilities: packets.length,
    reviewCompleteCount: packets.filter((packet) => packet.reviewComplete).length,
    blockedCapabilityIds,
    totalReferenceCount: packets.reduce((total, packet) => total + referenceCount(packet), 0),
    releaseComplete: missingMetadata.length === 0 && blockedCapabilityIds.length === 0,
    packets,
  };
}

export function ledgerRowsForExport(ledger) {
  return ledger.packets.map((packet) => ({
    release_id: ledger.release.release_id,
    environment: ledger.release.environment,
    candidate_source_commit_sha: ledger.release.candidate_source_commit_sha,
    candidate_source_tree_sha: ledger.release.candidate_source_tree_sha,
    source_authority_contract_sha256:
      ledger.release.source_authority_contract_sha256,
    hosted_runtime_commit_sha: ledger.release.hosted_runtime_commit_sha,
    hosted_runtime_tree_sha: ledger.release.hosted_runtime_tree_sha,
    hosted_deployment_id: ledger.release.hosted_deployment_id,
    candidate_deployable_manifest_sha256: ledger.release.candidate_deployable_manifest_sha256,
    hosted_resource_manifest_sha256: ledger.release.hosted_resource_manifest_sha256,
    staging_app_id: ledger.release.staging_app_id,
    staging_backend_origin: ledger.release.staging_backend_origin,
    capability_id: packet.capabilityId,
    capability: packet.capability,
    priority: packet.priority,
    risk: packet.risk,
    review_complete: packet.reviewComplete,
    missing_evidence_count: packet.missingEvidence.length,
    missing_reference_count: packet.missingReferences.length,
    missing_reviewer_count: packet.missingReviewerDecisions.length,
    missing_required_probe_count: packet.missingRequiredProbeIds.length,
    non_passing_probe_count: packet.nonPassingProbeIds.length,
    incomplete_probe_attestation_count:
      packet.incompleteSuppliedProbeIds.length,
    completed_probe_count: packet.completedProbeIds.length,
    evidence_reference_count: referenceCount(packet),
  }));
}
