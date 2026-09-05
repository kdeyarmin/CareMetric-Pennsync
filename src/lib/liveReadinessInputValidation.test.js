import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatLiveReadinessInputErrors, validateLiveReadinessInput } from "./liveReadinessInputValidation.js";
import { LIVE_CAPABILITY_MATRIX } from "./liveReadinessGate.js";
import { LIVE_RELEASE_METADATA } from "./liveReadinessReleaseLedger.js";

const evidenceTemplateUrls = [
  new URL("../../docs/audits/live-readiness-evidence.template.json", import.meta.url),
  new URL("../../docs/audits/live-readiness-evidence.draft.json", import.meta.url),
];

const validInput = {
  release: { release_id: "rc-2026-09-04", environment: "staging", requested_rollout_date: "2026-09-05" },
  matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
  evidence: { "LR-01": { owner: { value: "owner", references: ["docs/owner.md"] }, reviewers: { product: "approved" } } },
};

function hostedProbe(probeId, overrides = {}) {
  return {
    execution_context: "authenticated_hosted",
    result: "pass",
    captured_at: "2026-09-05T00:00:00.000Z",
    artifact_sha256: "a".repeat(64),
    references: [`evidence/${probeId}.json`],
    ...overrides,
  };
}

test("valid readiness input returns no validation errors", () => {
  assert.deepEqual(validateLiveReadinessInput(validInput), []);
});

test("committed evidence templates use ledger release keys and LR-01/LR-02 scope", () => {
  for (const templateUrl of evidenceTemplateUrls) {
    const input = JSON.parse(readFileSync(templateUrl, "utf8"));
    assert.deepEqual(Object.keys(input.release), LIVE_RELEASE_METADATA);
    assert.deepEqual(input.matrix.map(({ id }) => id), ["LR-01", "LR-02"]);
    assert.deepEqual(Object.keys(input.evidence), ["LR-01", "LR-02"]);
    assert.deepEqual(input.evidence["LR-01"].test_evidence.references, []);
    assert.deepEqual(input.evidence["LR-02"].test_evidence.references, []);
    assert.deepEqual(Object.keys(input.evidence["LR-01"].test_evidence.probes), [
      "V1", "V2", "V3", "V4", "V5", "V6", "T1", "T2", "T3", "T4",
    ]);
    assert.deepEqual(Object.keys(input.evidence["LR-02"].test_evidence.probes), [
      "S1", "S2", "S3", "S4",
    ]);
    assert.deepEqual(Object.keys(input.evidence["LR-01"].test_evidence.probes.V1), [
      "execution_context", "result", "captured_at", "artifact_sha256", "references",
    ]);
    assert.equal(
      input.evidence["LR-01"].test_evidence.probes.V1.execution_context,
      "authenticated_hosted",
    );
    assert.match(input.evidence["LR-02"].test_evidence.summary, /S1(?:–|-)S4/);
    assert.ok(validateLiveReadinessInput(input).some((error) => error.path === "release.release_id"));
  }
});

test("validator rejects non-object top-level input and malformed containers", () => {
  assert.deepEqual(validateLiveReadinessInput(null), [{ path: "$", message: "Input must be a JSON object." }]);
  const errors = validateLiveReadinessInput({ release: [], evidence: [], matrix: {} });
  assert.deepEqual(errors.map((error) => error.path), ["release", "evidence", "matrix"]);
});

test("validator reports evidence entry and reviewer shape errors without raw values", () => {
  const errors = validateLiveReadinessInput({
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    evidence: { "LR-01": { owner: { value: "secret", references: "not-array" }, reviewers: [] } },
  });
  assert.deepEqual(errors.map((error) => error.path), ["evidence.LR-01.reviewers", "evidence.LR-01.owner.references"]);
  assert.equal(formatLiveReadinessInputErrors(errors).includes("secret"), false);
});

test("validator requires a bounded artifact-reference map for every mandatory probe", () => {
  const input = {
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    evidence: {
      "LR-01": {
        test_evidence: {
          summary: "all probes passed",
          references: ["evidence/lr01/index.json"],
          probes: Object.fromEntries(
            ["V1", "V2", "V3", "V4", "V5", "V6", "T1", "T2", "T3"]
              .map((probeId) => [probeId, hostedProbe(probeId)]),
          ),
        },
      },
      "LR-02": {
        test_evidence: {
          summary: "required smoke passed",
          references: ["evidence/lr02/index.json"],
          probes: {
            S1: hostedProbe("S1"),
            S2: hostedProbe("S2"),
            S3: hostedProbe("S3"),
            S4: hostedProbe("S4", { references: [] }),
            S5: hostedProbe("S5"),
            S10: hostedProbe("S10"),
          },
        },
      },
    },
  };
  const errors = validateLiveReadinessInput(input);
  assert.ok(errors.some((error) => error.path === "evidence.LR-01.test_evidence.probes.T4"));
  assert.ok(errors.some((error) => error.path === "evidence.LR-02.test_evidence.probes"));
  assert.ok(errors.some((error) => error.path === "evidence.LR-02.test_evidence.probes.S4.references"));
  assert.equal(formatLiveReadinessInputErrors(errors).includes("S10"), false);
});

test("validator requires complete authenticated hosted probe attestations", () => {
  const errors = validateLiveReadinessInput({
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    evidence: {
      "LR-01": {
        test_evidence: {
          summary: "captured",
          references: ["evidence/index.json"],
          probes: Object.fromEntries(
            ["V1", "V2", "V3", "V4", "V5", "V6", "T1", "T2", "T3", "T4"]
              .map((probeId) => [probeId, hostedProbe(probeId)]),
          ),
        },
      },
      "LR-02": {
        test_evidence: {
          summary: "captured",
          references: ["evidence/index.json"],
          probes: {
            S1: { references: ["evidence/S1.json"] },
            S2: hostedProbe("S2", { execution_context: "local_mock" }),
            S3: hostedProbe("S3", { captured_at: "2026-09-05" }),
            S4: hostedProbe("S4", { artifact_sha256: "not-a-digest" }),
          },
        },
      },
    },
  });
  assert.ok(errors.some((error) => (
    error.path === "evidence.LR-02.test_evidence.probes.S1.execution_context"
  )));
  assert.ok(errors.some((error) => (
    error.path === "evidence.LR-02.test_evidence.probes.S1.result"
  )));
  assert.ok(errors.some((error) => (
    error.path === "evidence.LR-02.test_evidence.probes.S2.execution_context"
  )));
  assert.ok(errors.some((error) => (
    error.path === "evidence.LR-02.test_evidence.probes.S3.captured_at"
  )));
  assert.ok(errors.some((error) => (
    error.path === "evidence.LR-02.test_evidence.probes.S4.artifact_sha256"
  )));
  assert.equal(formatLiveReadinessInputErrors(errors).includes("local_mock"), false);
});

test("validator bounds and canonicalizes retained artifact references", () => {
  const errors = validateLiveReadinessInput({
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    evidence: {
      "LR-01": {
        owner: {
          summary: "owner",
          references: [" evidence/owner.json ", "same", "same"],
        },
      },
    },
  });
  assert.ok(errors.some((error) => error.path === "evidence.LR-01.owner.references.0"));
  assert.ok(errors.some((error) => error.path === "evidence.LR-01.owner.references"));
});

test("validator reports invalid matrix rows and missing fields", () => {
  const errors = validateLiveReadinessInput({ matrix: [null, { id: "LR-X" }] });
  assert.deepEqual(errors.map((error) => error.path), ["matrix.0", "matrix.1.capability", "matrix.1.priority", "matrix.1.risk", "matrix"]);
});

test("validator rejects empty, truncated, duplicated, invented, and tampered matrices", () => {
  const critical = LIVE_CAPABILITY_MATRIX.slice(0, 2);
  for (const matrix of [
    [],
    [critical[0]],
    [critical[0], critical[0]],
    [{ ...critical[0], id: "LR-X" }, critical[1]],
    [{ ...critical[0], risk: "low" }, critical[1]],
    [...critical].reverse(),
  ]) {
    assert.ok(validateLiveReadinessInput({ matrix }).some((error) => error.path === "matrix"));
  }
});

test("validator rejects an omitted matrix instead of falling back to broader capabilities", () => {
  const errors = validateLiveReadinessInput({ release: validInput.release, evidence: validInput.evidence });
  assert.deepEqual(errors, [{
    path: "matrix",
    message: "Matrix is required and must be the exact canonical LR-01/LR-02 critical-readiness matrix.",
  }]);
});

test("validator rejects blank metadata, evidence, and non-string references", () => {
  const errors = validateLiveReadinessInput({
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    release: { release_id: "  " },
    evidence: {
      "LR-01": {
        owner: { summary: " ", references: [" ", { path: "do-not-print" }] },
      },
    },
  });
  assert.deepEqual(errors.map((error) => error.path), [
    "release.release_id",
    "evidence.LR-01.owner.summary",
    "evidence.LR-01.owner.references.0",
    "evidence.LR-01.owner.references.1",
  ]);
  assert.equal(formatLiveReadinessInputErrors(errors).includes("do-not-print"), false);
});

test("validator rejects template placeholders without echoing their values", () => {
  const errors = validateLiveReadinessInput({
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    release: {
      release_id: "FILL_ME: rc-YYYY-MM-DD",
      requested_rollout_date: "YYYY-MM-DD",
    },
    evidence: {
      "LR-01": {
        owner: {
          summary: "FILL_ME: never-print-placeholder-detail",
          references: ["https://example.com/ticket-or-doc"],
        },
      },
    },
  });
  assert.deepEqual(errors.map((error) => error.path), [
    "release.release_id",
    "release.requested_rollout_date",
    "evidence.LR-01.owner.summary",
    "evidence.LR-01.owner.references.0",
  ]);
  const formatted = formatLiveReadinessInputErrors(errors);
  assert.equal(formatted.includes("never-print-placeholder-detail"), false);
  assert.equal(formatted.includes("example.com"), false);
});

test("validator binds evidence to canonical ids and staging", () => {
  const errors = validateLiveReadinessInput({
    release: { environment: "production" },
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    evidence: { "LR-X": { owner: "irrelevant" } },
  });
  assert.deepEqual(errors.map((error) => error.path), ["release.environment", "evidence"]);
});

test("validator binds a release to the exact reviewed fixture target", () => {
  const errors = validateLiveReadinessInput({
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    release: {
      fixture_set_id: "lr01-lr02-unreviewed-v2",
      staging_app_id: "another-app",
      staging_origin: "https://caremetricai.base44.app/",
    },
  });
  assert.deepEqual(errors.map((error) => error.path), [
    "release.fixture_set_id",
    "release.staging_app_id",
    "release.staging_origin",
  ]);
});

test("validator binds the packet to one checked-out and hosted source revision", () => {
  const expectedSourceCommit = "a".repeat(40);
  const expectedSourceTree = "d".repeat(40);
  const errors = validateLiveReadinessInput({
    release: {
      candidate_source_commit_sha: "b".repeat(40),
      candidate_source_tree_sha: "c".repeat(40),
      hosted_runtime_commit_sha: "e".repeat(40),
      hosted_runtime_tree_sha: "f".repeat(40),
      hosted_deployment_id: "bad deployment id",
      hosted_resource_manifest_sha256: "not-a-manifest-digest",
      staging_backend_origin: "https://api.base44.com/path",
    },
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
  }, {
    expectedSourceCommit,
    expectedSourceTree,
    expectedHostedRuntimeCommit: "e".repeat(40),
    expectedHostedRuntimeTree: "f".repeat(40),
  });
  assert.deepEqual(errors.map((error) => error.path), [
    "release.staging_backend_origin",
    "release.candidate_source_commit_sha",
    "release.candidate_source_tree_sha",
    "release.hosted_deployment_id",
    "release.hosted_resource_manifest_sha256",
  ]);
});

test("validator binds the packet to the locally computed source authority contract", () => {
  const expected = "a".repeat(64);
  assert.deepEqual(validateLiveReadinessInput({
    release: { source_authority_contract_sha256: expected },
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
  }, {
    expectedSourceAuthorityContractSha256: expected,
  }), []);

  const errors = validateLiveReadinessInput({
    release: { source_authority_contract_sha256: "b".repeat(64) },
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
  }, {
    expectedSourceAuthorityContractSha256: expected,
  });
  assert.deepEqual(errors.map((error) => error.path), [
    "release.source_authority_contract_sha256",
  ]);
});

test("validator rejects malformed revision fields without echoing them", () => {
  const errors = validateLiveReadinessInput({
    release: {
      candidate_source_commit_sha: "not-a-commit",
      candidate_source_tree_sha: "ALSO-NOT-A-TREE",
      hosted_runtime_commit_sha: "not-a-runtime-commit",
      hosted_runtime_tree_sha: "not-a-runtime-tree",
    },
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
  });
  assert.deepEqual(errors.map((error) => error.path), [
    "release.candidate_source_commit_sha",
    "release.candidate_source_tree_sha",
    "release.hosted_runtime_commit_sha",
    "release.hosted_runtime_tree_sha",
  ]);
  assert.equal(formatLiveReadinessInputErrors(errors).includes("not-a-commit"), false);
});

test("validator never echoes an untrusted capability key", () => {
  const untrustedKey = "patient-jane-doe-secret";
  const errors = validateLiveReadinessInput({
    matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    evidence: {
      [untrustedKey]: {
        owner: { summary: "FILL_ME: private", references: "invalid" },
      },
    },
  });
  const formatted = formatLiveReadinessInputErrors(errors);
  assert.equal(formatted.includes(untrustedKey), false);
  assert.ok(errors.some((error) => error.path === "evidence"));
});

test("validator rejects malformed or impossible release dates", () => {
  for (const release of [
    { release_id: "release-1" },
    { release_id: "rc-2026-02-30" },
    { release_id: `rc-2026-09-04-${"x".repeat(41)}` },
    { requested_rollout_date: "2026-02-30" },
    { requested_rollout_date: "09/05/2026" },
  ]) {
    assert.ok(validateLiveReadinessInput({
      release,
      matrix: LIVE_CAPABILITY_MATRIX.slice(0, 2),
    }).some((error) => error.path.startsWith("release.")));
  }
});
