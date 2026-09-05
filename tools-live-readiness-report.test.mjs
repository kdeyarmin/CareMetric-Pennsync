import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_CAPABILITY_MATRIX,
  LIVE_READINESS_EVIDENCE,
  LIVE_READINESS_PROBES,
  LIVE_READINESS_REVIEWERS,
} from "./src/lib/liveReadinessGate.js";
import { LIVE_RELEASE_METADATA } from "./src/lib/liveReadinessReleaseLedger.js";
import {
  buildLiveReadinessReportFromJson as buildReport,
  resolveCheckoutIdentity,
  runLiveReadinessReportCli as runReportCli,
} from "./tools-live-readiness-report.mjs";

const matrix = LIVE_CAPABILITY_MATRIX.slice(0, 2);
const sourceCommitSha = "a".repeat(40);
const sourceTreeSha = "b".repeat(40);
const checkoutIdentity = Object.freeze({ commit: sourceCommitSha, tree: sourceTreeSha });
const stagingBackendOrigin = "https://api.base44.com";
const release = Object.fromEntries(LIVE_RELEASE_METADATA.map((key) => {
  if (key === "environment") return [key, "staging"];
  if (key === "release_id") return [key, "rc-2026-09-04-test"];
  if (key === "fixture_set_id") return [key, "lr01-lr02-two-agency-v1"];
  if (key === "staging_app_id") return [key, "6a9881683dc68a0bd54f1ef7"];
  if (key === "staging_origin") return [key, "https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/"];
  if (key === "staging_backend_origin") return [key, stagingBackendOrigin];
  if (key === "candidate_source_commit_sha") return [key, sourceCommitSha];
  if (key === "candidate_source_tree_sha") return [key, sourceTreeSha];
  if (key === "source_authority_contract_sha256") return [key, "f".repeat(64)];
  if (key === "hosted_runtime_commit_sha") return [key, "c".repeat(40)];
  if (key === "hosted_runtime_tree_sha") return [key, "d".repeat(40)];
  if (key === "hosted_deployment_id") return [key, "base44-deploy-test-001"];
  if (key === "candidate_deployable_manifest_sha256") return [key, "e".repeat(64)];
  if (key === "hosted_resource_manifest_sha256") return [key, "e".repeat(64)];
  if (key === "requested_rollout_date") return [key, "2026-09-05"];
  return [key, `${key}-value`];
}));

function buildLiveReadinessReportFromJson(raw) {
  return buildReport(raw, {
    expectedSourceCommit: checkoutIdentity.commit,
    expectedSourceTree: checkoutIdentity.tree,
    expectedSourceAuthorityContractSha256:
      release.source_authority_contract_sha256,
    expectedBackendOrigin: stagingBackendOrigin,
    expectedHostedRuntimeCommit: release.hosted_runtime_commit_sha,
    expectedHostedRuntimeTree: release.hosted_runtime_tree_sha,
    expectedHostedDeploymentId: release.hosted_deployment_id,
    expectedCandidateDeployableManifestSha256:
      release.candidate_deployable_manifest_sha256,
    expectedHostedResourceManifestSha256: release.hosted_resource_manifest_sha256,
  });
}

function runLiveReadinessReportCli(options) {
  return runReportCli({
    ...options,
    resolveCheckout: () => checkoutIdentity,
    expectedBackendOrigin: stagingBackendOrigin,
    expectedHostedRuntimeCommit: release.hosted_runtime_commit_sha,
    expectedHostedRuntimeTree: release.hosted_runtime_tree_sha,
    expectedHostedDeploymentId: release.hosted_deployment_id,
    expectedCandidateDeployableManifestSha256:
      release.candidate_deployable_manifest_sha256,
    expectedHostedResourceManifestSha256: release.hosted_resource_manifest_sha256,
    expectedSourceAuthorityContractSha256:
      release.source_authority_contract_sha256,
  });
}
const reviewers = Object.fromEntries(LIVE_READINESS_REVIEWERS.map((reviewer) => [reviewer, "approved"]));
const evidenceEntries = Object.fromEntries(
  LIVE_READINESS_EVIDENCE.map((key) => [key, { value: `${key}-secret`, references: [`evidence/${key}.md`] }]),
);

function completeCapabilityEvidence(capabilityId) {
  const requiredProbes = LIVE_READINESS_PROBES[capabilityId]?.required || [];
  return {
    ...evidenceEntries,
    test_evidence: {
      ...evidenceEntries.test_evidence,
      probes: Object.fromEntries(requiredProbes.map((probeId) => [probeId, {
        execution_context: "authenticated_hosted",
        result: "pass",
        captured_at: "2026-09-05T00:00:00.000Z",
        artifact_sha256: "1".repeat(64),
        references: [`evidence/${capabilityId}/${probeId}.json`],
      }])),
    },
    reviewers,
  };
}

function completeInput() {
  return JSON.stringify({
    release,
    matrix,
    evidence: Object.fromEntries(matrix.map(({ id }) => [id, completeCapabilityEvidence(id)])),
  });
}

test("buildLiveReadinessReportFromJson emits a passing PHI-minimized report", () => {
  const report = buildLiveReadinessReportFromJson(completeInput());
  assert.equal(report.status, "pass");
  assert.equal(report.fixtureSetId, release.fixture_set_id);
  assert.equal(report.stagingAppId, release.staging_app_id);
  assert.equal(report.stagingOrigin, release.staging_origin);
  assert.equal(report.stagingBackendOrigin, release.staging_backend_origin);
  assert.equal(report.candidateSourceCommitSha, sourceCommitSha);
  assert.equal(report.candidateSourceTreeSha, sourceTreeSha);
  assert.equal(
    report.sourceAuthorityContractSha256,
    release.source_authority_contract_sha256,
  );
  assert.equal(report.hostedRuntimeCommitSha, release.hosted_runtime_commit_sha);
  assert.equal(report.hostedRuntimeTreeSha, release.hosted_runtime_tree_sha);
  assert.equal(report.hostedDeploymentId, release.hosted_deployment_id);
  assert.equal(
    report.candidateDeployableManifestSha256,
    release.candidate_deployable_manifest_sha256,
  );
  assert.equal(report.hostedResourceManifestSha256, release.hosted_resource_manifest_sha256);
  assert.match(report.evidencePacketSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(report.evaluatedCapabilityIds, ["LR-01", "LR-02"]);
  const requiredProbeCount = Object.values(LIVE_READINESS_PROBES)
    .reduce((total, plan) => total + plan.required.length, 0);
  assert.equal(report.totalReferenceCount, (LIVE_READINESS_EVIDENCE.length * 2) + requiredProbeCount);
  assert.deepEqual(report.probeCountsByCapability, {
    "LR-01": { required: 10, completed: 10 },
    "LR-02": { required: 4, completed: 4 },
  });
  assert.equal(report.assurance.source_authority_contract_bound, true);
  assert.equal(report.assurance.authenticated_hosted_probe_attestations_required, true);
  assert.equal(report.assurance.cited_artifact_bytes_fetched_or_verified, false);
  assert.equal(JSON.stringify(report).includes("secret"), false);
});

test("report digest binds the output to the exact private evidence packet bytes", () => {
  const first = completeInput();
  const changed = JSON.parse(first);
  changed.evidence["LR-01"].owner.value = "different-owner-attestation";
  const second = JSON.stringify(changed);
  assert.notEqual(
    buildLiveReadinessReportFromJson(first).evidencePacketSha256,
    buildLiveReadinessReportFromJson(second).evidencePacketSha256,
  );
});

test("CLI returns 0 and writes JSON for passing readiness", () => {
  const writes = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tools-live-readiness-report.mjs", "evidence.json"],
    readFile: () => completeInput(),
    write: (message) => writes.push(message),
    error: () => {},
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(writes[0]).status, "pass");
});

test("CLI accepts the documented pnpm argument separator", () => {
  const writes = [];
  const reads = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tools-live-readiness-report.mjs", "--", "evidence.json"],
    readFile: (path) => {
      reads.push(path);
      return completeInput();
    },
    write: (message) => writes.push(message),
    error: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(reads, ["evidence.json"]);
  assert.equal(JSON.parse(writes[0]).status, "pass");
});

test("CLI returns 1 for a valid but blocked readiness report", () => {
  const code = runLiveReadinessReportCli({
    argv: ["node", "tools-live-readiness-report.mjs", "evidence.json"],
    readFile: () => JSON.stringify({
      release,
      matrix,
      evidence: { "LR-01": { owner: { summary: "operations owner", references: ["evidence/owner.md"] } } },
    }),
    write: () => {},
    error: () => {},
  });
  assert.equal(code, 1);
});

test("CLI returns 1 and names a retained hosted probe that did not pass", () => {
  const writes = [];
  const input = JSON.parse(completeInput());
  input.evidence["LR-01"].test_evidence.probes.V4.result = "fail";
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "evidence.json"],
    readFile: () => JSON.stringify(input),
    write: (message) => writes.push(message),
    error: () => {},
  });
  assert.equal(code, 1);
  const report = JSON.parse(writes[0]);
  assert.deepEqual(report.blockers.nonPassingProbes, { "LR-01": ["V4"] });
  assert.deepEqual(report.blockers.missingRequiredProbes, { "LR-01": ["V4"] });
});

test("CLI returns 2 for missing input or invalid JSON", () => {
  assert.equal(runLiveReadinessReportCli({ argv: ["node", "tool"], write: () => {}, error: () => {} }), 2);
  assert.equal(runLiveReadinessReportCli({ argv: ["node", "tool", "bad.json"], readFile: () => "{", write: () => {}, error: () => {} }), 2);
  assert.equal(runLiveReadinessReportCli({ argv: ["node", "tool", "one.json", "two.json"], write: () => {}, error: () => {} }), 2);
});

test("CLI does not echo malformed evidence contents", () => {
  const errors = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "bad.json"],
    readFile: () => '{"token":"never-print-this-token",}',
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /valid JSON/);
  assert.equal(errors[0].includes("never-print-this-token"), false);
});

test("CLI rejects placeholder-filled evidence as invalid", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.evidence["LR-01"].owner.value = "FILL_ME: never-print-this-owner";
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "placeholder.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /evidence\.LR-01\.owner\.value/);
  assert.equal(errors[0].includes("never-print-this-owner"), false);
});

test("CLI rejects matrix bypasses instead of emitting a vacuous pass", () => {
  for (const matrixOverride of [undefined, [], [matrix[0]], [{ ...matrix[0], id: "LR-X" }, matrix[1]]]) {
    const errors = [];
    const input = JSON.parse(completeInput());
    if (matrixOverride === undefined) delete input.matrix;
    else input.matrix = matrixOverride;
    const code = runLiveReadinessReportCli({
      argv: ["node", "tool", "bypass.json"],
      readFile: () => JSON.stringify(input),
      write: () => {},
      error: (message) => errors.push(message),
    });
    assert.equal(code, 2);
    assert.match(errors[0], /exact canonical LR-01\/LR-02/);
  }
});

test("CLI rejects non-staging release metadata and out-of-matrix evidence", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.release.environment = "production";
  input.evidence["LR-X"] = input.evidence["LR-01"];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "unsafe-target.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /release\.environment/);
  assert.match(errors[0], /Evidence contains an id/);
});

test("CLI rejects malformed hosted revision identity and a noncanonical backend origin", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.release.hosted_runtime_commit_sha = "not-a-runtime-commit";
  input.release.staging_backend_origin = "https://api.base44.com/path";
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "drift.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /lowercase 40-character Git SHA/);
  assert.match(errors[0], /canonical HTTPS Base44 origin/);
});

test("CLI binds every hosted identity to the configured deployment receipt", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.release.hosted_runtime_commit_sha = "1".repeat(40);
  input.release.hosted_runtime_tree_sha = "2".repeat(40);
  input.release.hosted_deployment_id = "different-deployment";
  input.release.candidate_deployable_manifest_sha256 = "3".repeat(64);
  input.release.hosted_resource_manifest_sha256 = "3".repeat(64);
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "wrong-deployment.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /runtime identity must exactly match/);
  assert.match(errors[0], /deployment id must exactly match/);
  assert.match(errors[0], /Candidate resource-inventory attestation must match/);
  assert.match(errors[0], /attestation digest must exactly match/);
});

test("CLI cannot pass without independently configured hosted identity", () => {
  const errors = [];
  const code = runReportCli({
    argv: ["node", "tool", "unbound.json"],
    readFile: () => completeInput(),
    write: () => {},
    error: (message) => errors.push(message),
    resolveCheckout: () => checkoutIdentity,
    env: {},
    expectedBackendOrigin: stagingBackendOrigin,
    expectedSourceAuthorityContractSha256:
      release.source_authority_contract_sha256,
  });
  assert.equal(code, 2);
  assert.match(errors[0], /configured hosted runtime identity/);
  assert.match(errors[0], /configured hosted deployment id/);
  assert.match(errors[0], /externally reviewed candidate resource-inventory attestation digest/);
  assert.match(errors[0], /configured hosted resource-inventory attestation digest/);
});

test("CLI uses an injected environment for deployment identity bindings", () => {
  const writes = [];
  const code = runReportCli({
    argv: ["node", "tool", "injected-env.json"],
    readFile: () => completeInput(),
    write: (message) => writes.push(message),
    error: () => {},
    resolveCheckout: () => checkoutIdentity,
    expectedSourceAuthorityContractSha256:
      release.source_authority_contract_sha256,
    env: {
      READINESS_STAGING_BACKEND_ORIGIN: stagingBackendOrigin,
      READINESS_HOSTED_RUNTIME_COMMIT_SHA: release.hosted_runtime_commit_sha,
      READINESS_HOSTED_RUNTIME_TREE_SHA: release.hosted_runtime_tree_sha,
      READINESS_HOSTED_DEPLOYMENT_ID: release.hosted_deployment_id,
      READINESS_CANDIDATE_DEPLOYABLE_MANIFEST_SHA256:
        release.candidate_deployable_manifest_sha256,
      READINESS_HOSTED_RESOURCE_MANIFEST_SHA256:
        release.hosted_resource_manifest_sha256,
    },
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(writes[0]).status, "pass");
});

test("an explicitly empty CLI environment cannot fall back to ambient bindings", () => {
  const ambientBindings = {
    READINESS_STAGING_BACKEND_ORIGIN: stagingBackendOrigin,
    READINESS_HOSTED_RUNTIME_COMMIT_SHA: release.hosted_runtime_commit_sha,
    READINESS_HOSTED_RUNTIME_TREE_SHA: release.hosted_runtime_tree_sha,
    READINESS_HOSTED_DEPLOYMENT_ID: release.hosted_deployment_id,
    READINESS_CANDIDATE_DEPLOYABLE_MANIFEST_SHA256:
      release.candidate_deployable_manifest_sha256,
    READINESS_HOSTED_RESOURCE_MANIFEST_SHA256:
      release.hosted_resource_manifest_sha256,
  };
  const previousBindings = Object.fromEntries(
    Object.keys(ambientBindings).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, ambientBindings);

  try {
    const errors = [];
    const code = runReportCli({
      argv: ["node", "tool", "empty-env.json"],
      readFile: () => completeInput(),
      write: () => {},
      error: (message) => errors.push(message),
      resolveCheckout: () => checkoutIdentity,
      expectedSourceAuthorityContractSha256:
        release.source_authority_contract_sha256,
      env: {},
    });
    assert.equal(code, 2);
    assert.match(errors[0], /configured staging backend origin/);
    assert.match(errors[0], /configured hosted runtime identity/);
    assert.match(errors[0], /configured hosted deployment id/);
  } finally {
    for (const [key, value] of Object.entries(previousBindings)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("CLI rejects candidate and hosted deployable-manifest divergence", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.release.hosted_resource_manifest_sha256 = "4".repeat(64);
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "manifest-drift.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /exactly match the candidate attestation/);
});

test("CLI rejects another tenant's otherwise trusted Base44 backend origin", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.release.staging_backend_origin = "https://wrong-tenant.base44.app";
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "wrong-backend.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /exactly match the configured probe target/);
});

test("CLI rejects a packet for a source commit other than the checked-out revision", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.release.candidate_source_commit_sha = "f".repeat(40);
  input.release.candidate_source_tree_sha = "0".repeat(40);
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "stale-source.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /match the clean checked-out Git commit/);
  assert.match(errors[0], /match the clean checked-out Git tree/);
});

test("CLI rejects a packet bound to a different source authority contract", () => {
  const errors = [];
  const input = JSON.parse(completeInput());
  input.release.source_authority_contract_sha256 = "0".repeat(64);
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "stale-source-contract.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /current readiness source check/);
});

test("CLI fails closed when the local source authority contract cannot be resolved", () => {
  const errors = [];
  const code = runReportCli({
    argv: ["node", "tool", "invalid-source-contract.json"],
    readFile: () => completeInput(),
    write: () => {},
    error: (message) => errors.push(message),
    resolveCheckout: () => checkoutIdentity,
    resolveSourceAuthorityContract: () => {
      throw new Error("Checked-out readiness source authority contract is invalid.");
    },
    env: {
      READINESS_STAGING_BACKEND_ORIGIN: stagingBackendOrigin,
      READINESS_HOSTED_RUNTIME_COMMIT_SHA: release.hosted_runtime_commit_sha,
      READINESS_HOSTED_RUNTIME_TREE_SHA: release.hosted_runtime_tree_sha,
      READINESS_HOSTED_DEPLOYMENT_ID: release.hosted_deployment_id,
      READINESS_CANDIDATE_DEPLOYABLE_MANIFEST_SHA256:
        release.candidate_deployable_manifest_sha256,
      READINESS_HOSTED_RESOURCE_MANIFEST_SHA256:
        release.hosted_resource_manifest_sha256,
    },
  });
  assert.equal(code, 2);
  assert.match(errors[0], /source authority contract is invalid/);
});

test("checkout identity rejects a dirty tree without echoing changed paths", () => {
  const fakeExec = (_command, args) => {
    if (args[0] === "status") return " M private-patient-path.json\n";
    if (args[1] === "HEAD^{tree}") return `${sourceTreeSha}\n`;
    return `${sourceCommitSha}\n`;
  };
  assert.throws(
    () => resolveCheckoutIdentity({ execFile: fakeExec }),
    (error) => error.message === "Readiness reports require a clean Git checkout."
      && !error.message.includes("patient"),
  );
});

test("CLI cannot pass with reference-only or unknown evidence categories", () => {
  const refsOnly = JSON.parse(completeInput());
  for (const capability of Object.values(refsOnly.evidence)) {
    for (const key of LIVE_READINESS_EVIDENCE) capability[key] = { references: [`evidence/${key}.md`] };
  }
  assert.throws(
    () => buildLiveReadinessReportFromJson(JSON.stringify(refsOnly)),
    /test_evidence\.probes/,
  );

  const errors = [];
  const unknown = JSON.parse(completeInput());
  unknown.evidence["LR-01"].invented_category = {
    summary: "must not count",
    references: ["evidence/invented.md"],
  };
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "unknown-category.json"],
    readFile: () => JSON.stringify(unknown),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /unsupported category/);
});

test("CLI cannot pass a summary and unrelated link without per-probe artifacts", () => {
  const input = JSON.parse(completeInput());
  input.evidence["LR-01"].test_evidence = {
    summary: "done",
    references: ["evidence/unrelated.md"],
  };
  const errors = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "missing-probes.json"],
    readFile: () => JSON.stringify(input),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /test_evidence\.probes/);
});

test("CLI does not echo an unreadable evidence path", () => {
  const errors = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "patient-name-evidence.json"],
    readFile: () => { throw new Error("ENOENT: patient-name-evidence.json"); },
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /could not be read/);
  assert.equal(errors[0].includes("patient-name"), false);
});

test("CLI returns 2 for invalid readiness input shape", () => {
  const errors = [];
  const code = runLiveReadinessReportCli({
    argv: ["node", "tool", "invalid-shape.json"],
    readFile: () => JSON.stringify({ evidence: { "LR-01": { owner: { value: "secret", references: "bad" } } } }),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.equal(errors[0].includes("evidence.LR-01.owner.references"), true);
  assert.equal(errors[0].includes("secret"), false);
});
