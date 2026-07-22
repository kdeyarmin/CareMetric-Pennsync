import {
  LIVE_CAPABILITY_MATRIX,
  createLiveReadinessEvidencePacket,
} from "./liveReadinessGate.js";

export const LIVE_RELEASE_METADATA = Object.freeze([
  "release_id",
  "environment",
  "requested_rollout_date",
  "release_owner",
  "rollback_owner",
  "monitoring_owner",
]);

function missingReleaseMetadata(release = {}) {
  return LIVE_RELEASE_METADATA.filter((key) => !release[key]);
}

function referenceCount(packet) {
  return Object.values(packet.evidence).reduce((total, entry) => total + entry.references.length, 0);
}

export function createLiveReadinessReleaseLedger(release = {}, evidence = {}, matrix = LIVE_CAPABILITY_MATRIX) {
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
    capability_id: packet.capabilityId,
    capability: packet.capability,
    priority: packet.priority,
    risk: packet.risk,
    review_complete: packet.reviewComplete,
    missing_evidence_count: packet.missingEvidence.length,
    missing_reference_count: packet.missingReferences.length,
    missing_reviewer_count: packet.missingReviewerDecisions.length,
    evidence_reference_count: referenceCount(packet),
  }));
}
