function packetReferenceCount(packet) {
  return Object.values(packet.evidence)
    .reduce((total, entry) => (
      total
      + entry.references.length
      + Object.values(entry.probes || {}).reduce(
        (probeTotal, probe) => probeTotal + probe.references.length,
        0,
      )
    ), 0);
}

export function createLiveReadinessCiReport(ledger, { evidencePacketSha256 = null } = {}) {
  if (
    !ledger
    || !Array.isArray(ledger.packets)
    || ledger.packets.length === 0
    || ledger.totalCapabilities !== ledger.packets.length
  ) {
    throw new TypeError("Live-readiness CI report requires a non-empty reconciled ledger.");
  }
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
    missingRequiredProbes: Object.fromEntries(
      ledger.packets
        .filter((packet) => packet.missingRequiredProbeIds.length > 0)
        .map((packet) => [packet.capabilityId, packet.missingRequiredProbeIds]),
    ),
  };
  const status = ledger.releaseComplete ? "pass" : "fail";
  const evaluatedCapabilityIds = ledger.packets.map((packet) => packet.capabilityId);
  return {
    status,
    releaseId: ledger.release.release_id,
    environment: ledger.release.environment,
    fixtureSetId: ledger.release.fixture_set_id,
    stagingAppId: ledger.release.staging_app_id,
    stagingOrigin: ledger.release.staging_origin,
    stagingBackendOrigin: ledger.release.staging_backend_origin,
    candidateSourceCommitSha: ledger.release.candidate_source_commit_sha,
    candidateSourceTreeSha: ledger.release.candidate_source_tree_sha,
    hostedRuntimeCommitSha: ledger.release.hosted_runtime_commit_sha,
    hostedRuntimeTreeSha: ledger.release.hosted_runtime_tree_sha,
    hostedDeploymentId: ledger.release.hosted_deployment_id,
    candidateDeployableManifestSha256: ledger.release.candidate_deployable_manifest_sha256,
    hostedResourceManifestSha256: ledger.release.hosted_resource_manifest_sha256,
    evidencePacketSha256,
    evaluatedCapabilityIds,
    totalCapabilities: ledger.totalCapabilities,
    reviewCompleteCount: ledger.reviewCompleteCount,
    totalReferenceCount: ledger.totalReferenceCount,
    referenceCountsByCapability: Object.fromEntries(
      ledger.packets.map((packet) => [packet.capabilityId, packetReferenceCount(packet)]),
    ),
    probeCountsByCapability: Object.fromEntries(
      ledger.packets.map((packet) => [packet.capabilityId, {
        required: packet.requiredProbeIds.length,
        completed: packet.completedProbeIds.length,
      }]),
    ),
    blockers,
    messages: buildMessages(status, blockers, evaluatedCapabilityIds),
  };
}

function buildMessages(status, blockers, evaluatedCapabilityIds) {
  if (status === "pass") {
    return [`Evaluated readiness packet is structurally complete for ${evaluatedCapabilityIds.join(", ")}.`];
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
  if (Object.keys(blockers.missingRequiredProbes).length > 0) {
    messages.push(`Capabilities missing required probe artifacts: ${Object.entries(blockers.missingRequiredProbes)
      .map(([capabilityId, probeIds]) => `${capabilityId} (${probeIds.join(", ")})`)
      .join("; ")}.`);
  }
  return messages;
}
