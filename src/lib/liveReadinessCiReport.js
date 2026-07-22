export function createLiveReadinessCiReport(ledger) {
  const missingReferenceCapabilityIds = ledger.packets
    .filter((packet) => packet.missingReferences.length > 0)
    .map((packet) => packet.capabilityId);
  const missingReviewerCapabilityIds = ledger.packets
    .filter((packet) => packet.missingReviewerDecisions.length > 0)
    .map((packet) => packet.capabilityId);
  const blockers = {
    metadata: ledger.missingMetadata,
    capabilities: ledger.blockedCapabilityIds,
    missingReferences: missingReferenceCapabilityIds,
    missingReviewers: missingReviewerCapabilityIds,
  };
  const status = ledger.releaseComplete ? "pass" : "fail";
  return {
    status,
    releaseId: ledger.release.release_id,
    environment: ledger.release.environment,
    totalCapabilities: ledger.totalCapabilities,
    reviewCompleteCount: ledger.reviewCompleteCount,
    blockers,
    messages: buildMessages(status, blockers),
  };
}

function buildMessages(status, blockers) {
  if (status === "pass") {
    return ["Live-readiness release ledger is complete."];
  }
  const messages = [];
  if (blockers.metadata.length > 0) {
    messages.push(`Missing release metadata: ${blockers.metadata.join(", ")}.`);
  }
  if (blockers.capabilities.length > 0) {
    messages.push(`Blocked capabilities: ${blockers.capabilities.join(", ")}.`);
  }
  if (blockers.missingReferences.length > 0) {
    messages.push(`Capabilities with evidence lacking references: ${blockers.missingReferences.join(", ")}.`);
  }
  if (blockers.missingReviewers.length > 0) {
    messages.push(`Capabilities missing reviewer approval: ${blockers.missingReviewers.join(", ")}.`);
  }
  return messages;
}
