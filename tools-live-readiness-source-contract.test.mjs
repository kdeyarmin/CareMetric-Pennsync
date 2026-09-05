import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIVE_READINESS_SOURCE_ARTIFACT_PATHS,
  createLiveReadinessSourceContract,
  formatLiveReadinessSourceContractErrors,
} from "./tools-live-readiness-source-contract.mjs";

function readArtifact(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("source contract deterministically binds the canonical fixture, schemas, brokers, and tests", () => {
  const first = createLiveReadinessSourceContract();
  const second = createLiveReadinessSourceContract();

  assert.equal(first.status, "valid_source_authority_contract");
  assert.match(first.source_authority_contract_sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.source_authority_contract_sha256, second.source_authority_contract_sha256);
  assert.equal(first.artifact_count, LIVE_READINESS_SOURCE_ARTIFACT_PATHS.length);
  assert.equal(first.checks.network_access, false);
  assert.equal(first.checks.hosted_writes, false);
  assert.equal(first.checks.authenticated_hosted_probes_executed, false);
  assert.equal(first.checks.care_team_assignment_mutations_paused, true);
  assert.equal(first.checks.referral_direct_mutation_path_present, true);
  assert.equal(first.checks.visit_create_uses_legacy_assignment, true);
  assert.ok(first.source_limitations.includes("authenticated_lr01_lr02_probe_artifacts_not_observed"));
  assert.deepEqual(first.errors, []);
  assert.deepEqual(
    LIVE_READINESS_SOURCE_ARTIFACT_PATHS,
    [...new Set(LIVE_READINESS_SOURCE_ARTIFACT_PATHS)].sort(),
  );
});

test("source contract digest changes when any pinned artifact bytes change", () => {
  const baseline = createLiveReadinessSourceContract();
  const changedPath = "base44/functionTests/patientReadAuthorizationContract.test.js";
  const changed = createLiveReadinessSourceContract({
    readArtifact: (path) => `${readArtifact(path)}${path === changedPath ? "\n" : ""}`,
  });

  assert.equal(changed.status, "valid_source_authority_contract");
  assert.notEqual(
    changed.source_authority_contract_sha256,
    baseline.source_authority_contract_sha256,
  );
});

test("source contract rejects weakened server-owned authority RLS", () => {
  const changedPath = "base44/entities/AgencyMembership.jsonc";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      if (path !== changedPath) return source;
      const schema = JSON.parse(source);
      schema.rls.read = true;
      return JSON.stringify(schema);
    },
  });

  assert.equal(weakened.status, "invalid_source_authority_contract");
  assert.equal(weakened.source_authority_contract_sha256, null);
  assert.ok(weakened.errors.some((error) => (
    error.path === "entities.AgencyMembership.rls.read"
  )));
});

test("source contract rejects removal of the dormant assignment mutation gate without echoing source", () => {
  const changedPath = "base44/functions/managePatientCareTeamAssignment/entry.ts";
  const weakened = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      const source = readArtifact(path);
      return path === changedPath
        ? source.replace(
          "CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false",
          "CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = true",
        )
        : source;
    },
  });

  assert.equal(weakened.status, "invalid_source_authority_contract");
  const formatted = formatLiveReadinessSourceContractErrors(weakened.errors);
  assert.match(formatted, /reviewed-broker source marker is absent/);
  assert.equal(formatted.includes("MUTATIONS_ENABLED = true"), false);
});

test("source contract handles unreadable or malformed pinned artifacts without leaking contents", () => {
  const unreadable = createLiveReadinessSourceContract({
    readArtifact: (path) => {
      if (path.endsWith("Agency.jsonc")) throw new Error("private path detail");
      return readArtifact(path);
    },
  });
  assert.equal(unreadable.status, "invalid_source_authority_contract");
  assert.equal(
    formatLiveReadinessSourceContractErrors(unreadable.errors).includes("private path detail"),
    false,
  );

  const malformed = createLiveReadinessSourceContract({
    readArtifact: (path) => path.endsWith("live-readiness-fixture-manifest.template.json")
      ? "{\"password\":\"never-print\",}"
      : readArtifact(path),
  });
  assert.equal(malformed.status, "invalid_source_authority_contract");
  assert.equal(
    formatLiveReadinessSourceContractErrors(malformed.errors).includes("never-print"),
    false,
  );
});
