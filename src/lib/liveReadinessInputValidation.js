import {
  LIVE_CAPABILITY_MATRIX,
  LIVE_READINESS_EVIDENCE,
  LIVE_READINESS_PROBES,
  LIVE_READINESS_REVIEWERS,
} from "./liveReadinessGate.js";
import { LIVE_RELEASE_METADATA } from "./liveReadinessReleaseLedger.js";
import {
  LIVE_READINESS_FIXTURE_SET_ID,
  LIVE_READINESS_STAGING_TARGET,
} from "./liveReadinessFixtureManifest.js";

const OBJECT_TYPE = "object";
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TRUSTED_BASE44_HOST_SUFFIXES = Object.freeze([
  "base44.com",
  "base44.app",
  "base44.io",
  "base44.dev",
]);

const CRITICAL_READINESS_IDS = Object.freeze(["LR-01", "LR-02"]);
const CRITICAL_READINESS_MATRIX = Object.freeze(CRITICAL_READINESS_IDS.map((id) => {
  const capability = LIVE_CAPABILITY_MATRIX.find((candidate) => candidate.id === id);
  if (!capability) throw new Error(`Canonical readiness matrix is missing ${id}.`);
  return capability;
}));

function isObject(value) {
  return Boolean(value) && typeof value === OBJECT_TYPE && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

const READINESS_PLACEHOLDER_PATTERNS = Object.freeze([
  /\bFILL_ME\b/i,
  /\bYYYY-MM-DD\b/,
  /^https:\/\/example\.com\/ticket-or-doc\/?$/i,
]);

const TOP_LEVEL_KEYS = new Set(["release", "evidence", "matrix"]);
const SAFE_READINESS_PATH_KEYS = new Set([
  ...TOP_LEVEL_KEYS,
  ...LIVE_RELEASE_METADATA,
  ...LIVE_CAPABILITY_MATRIX.map(({ id }) => id),
  ...LIVE_READINESS_EVIDENCE,
  ...LIVE_READINESS_REVIEWERS,
  "reviewers",
  "value",
  "summary",
  "references",
  "probes",
  "id",
  "capability",
  "priority",
  "phaseSource",
  "risk",
  ...Object.values(LIVE_READINESS_PROBES).flatMap(({ required, optional }) => [
    ...required,
    ...optional,
  ]),
]);

function containsPlaceholder(value) {
  return typeof value === "string"
    && READINESS_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function findPlaceholderValues(value, path, errors) {
  if (typeof value === "string") {
    if (containsPlaceholder(value)) {
      addError(errors, path, "Placeholder value must be replaced with real, reviewed evidence.");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findPlaceholderValues(item, `${path}.${index}`, errors));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = SAFE_READINESS_PATH_KEYS.has(key)
      ? (path === "$" ? key : `${path}.${key}`)
      : path;
    findPlaceholderValues(nested, nestedPath, errors);
  }
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isReleaseId(value) {
  if (typeof value !== "string") return false;
  const match = /^rc-(\d{4}-\d{2}-\d{2})(?:-[a-z0-9][a-z0-9.-]{0,39})?$/.exec(value);
  return Boolean(match) && isIsoCalendarDate(match[1]);
}

function isGitSha(value) {
  return typeof value === "string" && GIT_SHA_PATTERN.test(value);
}

function isDeploymentId(value) {
  return typeof value === "string" && DEPLOYMENT_ID_PATTERN.test(value);
}

function canonicalTrustedBase44BackendOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const trustedHost = TRUSTED_BASE44_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
    return (
      parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && trustedHost
    ) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function isExactCapabilityRow(actual, expected) {
  if (!isObject(actual)) return false;
  const expectedKeys = Object.keys(expected);
  return (
    Object.keys(actual).length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(actual, key) && actual[key] === expected[key])
  );
}

function validateProbeEvidence(capabilityId, entry, entryPath, errors) {
  const plan = LIVE_READINESS_PROBES[capabilityId];
  if (!plan) return;
  if (!isObject(entry.probes)) {
    addError(errors, `${entryPath}.probes`, "Test evidence must map every required probe id to artifact references.");
    return;
  }
  const allowedProbeIds = new Set([...plan.required, ...plan.optional]);
  if (Object.keys(entry.probes).some((probeId) => !allowedProbeIds.has(probeId))) {
    addError(errors, `${entryPath}.probes`, "Test evidence contains an unsupported probe id.");
  }
  for (const probeId of plan.required) {
    if (!Object.hasOwn(entry.probes, probeId)) {
      addError(errors, `${entryPath}.probes.${probeId}`, "Required probe artifact references are missing.");
    }
  }
  for (const [probeId, probe] of Object.entries(entry.probes)) {
    if (!allowedProbeIds.has(probeId)) continue;
    const probePath = `${entryPath}.probes.${probeId}`;
    if (!isObject(probe) || Object.keys(probe).some((key) => key !== "references")) {
      addError(errors, probePath, "Probe evidence must contain only an artifact references array.");
      continue;
    }
    if (!Array.isArray(probe.references) || probe.references.length === 0) {
      addError(errors, `${probePath}.references`, "Probe evidence requires at least one artifact reference.");
      continue;
    }
    probe.references.forEach((reference, index) => {
      if (!isNonBlankString(reference)) {
        addError(errors, `${probePath}.references.${index}`, "Probe artifact references must be non-blank strings.");
      }
    });
  }
}

export function validateLiveReadinessInput(
  input,
  {
    expectedSourceCommit,
    expectedSourceTree,
    expectedBackendOrigin,
    expectedHostedRuntimeCommit,
    expectedHostedRuntimeTree,
    expectedHostedDeploymentId,
    expectedCandidateDeployableManifestSha256,
    expectedHostedResourceManifestSha256,
  } = {},
) {
  const errors = [];
  if (!isObject(input)) {
    addError(errors, "$", "Input must be a JSON object.");
    return errors;
  }

  findPlaceholderValues(input, "$", errors);

  if (Object.keys(input).some((key) => !TOP_LEVEL_KEYS.has(key))) {
    addError(errors, "$", "Input contains an unsupported top-level field.");
  }

  if (input.release !== undefined && !isObject(input.release)) {
    addError(errors, "release", "Release must be an object when provided.");
  } else if (isObject(input.release)) {
    for (const [key, value] of Object.entries(input.release)) {
      if (!LIVE_RELEASE_METADATA.includes(key)) {
        addError(errors, "release", "Release contains an unsupported metadata field.");
        continue;
      }
      if (!isNonBlankString(value)) {
        addError(errors, `release.${key}`, "Release metadata values must be non-blank strings.");
      }
    }
    if (
      isNonBlankString(input.release.environment)
      && !containsPlaceholder(input.release.environment)
      && input.release.environment !== "staging"
    ) {
      addError(errors, "release.environment", "Live-readiness evidence must target the isolated staging environment.");
    }
    if (
      input.release.fixture_set_id !== undefined
      && input.release.fixture_set_id !== LIVE_READINESS_FIXTURE_SET_ID
    ) {
      addError(errors, "release.fixture_set_id", "Release must reference the reviewed canonical fixture set.");
    }
    if (
      input.release.staging_app_id !== undefined
      && input.release.staging_app_id !== LIVE_READINESS_STAGING_TARGET.app_id
    ) {
      addError(errors, "release.staging_app_id", "Release must reference the reviewed isolated staging app.");
    }
    if (
      input.release.staging_origin !== undefined
      && input.release.staging_origin !== LIVE_READINESS_STAGING_TARGET.origin
    ) {
      addError(errors, "release.staging_origin", "Release must reference the reviewed isolated staging origin.");
    }
    const inputBackendOrigin = canonicalTrustedBase44BackendOrigin(
      input.release.staging_backend_origin,
    );
    if (
      input.release.staging_backend_origin !== undefined
      && !containsPlaceholder(input.release.staging_backend_origin)
      && (
        !inputBackendOrigin
        || input.release.staging_backend_origin !== inputBackendOrigin
      )
    ) {
      addError(errors, "release.staging_backend_origin", "Staging backend origin must be one canonical HTTPS Base44 origin without a trailing slash.");
    }
    if (inputBackendOrigin && input.release.staging_backend_origin === inputBackendOrigin) {
      const configuredBackendOrigin = canonicalTrustedBase44BackendOrigin(expectedBackendOrigin);
      if (!configuredBackendOrigin) {
        addError(errors, "release.staging_backend_origin", "Exact configured staging backend origin is required for target binding.");
      } else if (inputBackendOrigin !== configuredBackendOrigin) {
        addError(errors, "release.staging_backend_origin", "Staging backend origin must exactly match the configured probe target.");
      }
    }
    for (const key of [
      "candidate_source_commit_sha",
      "candidate_source_tree_sha",
      "hosted_runtime_commit_sha",
      "hosted_runtime_tree_sha",
    ]) {
      if (
        input.release[key] !== undefined
        && !containsPlaceholder(input.release[key])
        && !isGitSha(input.release[key])
      ) {
        addError(errors, `release.${key}`, "Revision must be a lowercase 40-character Git SHA.");
      }
    }
    if (
      isGitSha(input.release.candidate_source_commit_sha)
      && expectedSourceCommit !== undefined
      && input.release.candidate_source_commit_sha !== expectedSourceCommit
    ) {
      addError(errors, "release.candidate_source_commit_sha", "Candidate source revision must match the clean checked-out Git commit.");
    }
    if (
      isGitSha(input.release.candidate_source_tree_sha)
      && expectedSourceTree !== undefined
      && input.release.candidate_source_tree_sha !== expectedSourceTree
    ) {
      addError(errors, "release.candidate_source_tree_sha", "Candidate source tree must match the clean checked-out Git tree.");
    }
    for (const [key, expected] of [
      ["hosted_runtime_commit_sha", expectedHostedRuntimeCommit],
      ["hosted_runtime_tree_sha", expectedHostedRuntimeTree],
    ]) {
      if (isGitSha(input.release[key])) {
        if (!isGitSha(expected)) {
          addError(errors, `release.${key}`, "Exact configured hosted runtime identity is required for target binding.");
        } else if (input.release[key] !== expected) {
          addError(errors, `release.${key}`, "Hosted runtime identity must exactly match the configured deployment receipt.");
        }
      }
    }
    if (
      input.release.hosted_deployment_id !== undefined
      && !containsPlaceholder(input.release.hosted_deployment_id)
      && !isDeploymentId(input.release.hosted_deployment_id)
    ) {
      addError(errors, "release.hosted_deployment_id", "Hosted deployment id must be a bounded stable identifier.");
    }
    if (isDeploymentId(input.release.hosted_deployment_id)) {
      if (!isDeploymentId(expectedHostedDeploymentId)) {
        addError(errors, "release.hosted_deployment_id", "Exact configured hosted deployment id is required for target binding.");
      } else if (input.release.hosted_deployment_id !== expectedHostedDeploymentId) {
        addError(errors, "release.hosted_deployment_id", "Hosted deployment id must exactly match the configured deployment receipt.");
      }
    }
    for (const key of [
      "candidate_deployable_manifest_sha256",
      "hosted_resource_manifest_sha256",
    ]) {
      if (
        input.release[key] !== undefined
        && !containsPlaceholder(input.release[key])
        && !SHA256_PATTERN.test(input.release[key])
      ) {
        addError(errors, `release.${key}`, "Externally reviewed deployable-resource inventory attestation digest must be a lowercase SHA-256 value.");
      }
    }
    if (
      SHA256_PATTERN.test(input.release.candidate_deployable_manifest_sha256)
      && SHA256_PATTERN.test(input.release.hosted_resource_manifest_sha256)
      && input.release.candidate_deployable_manifest_sha256
        !== input.release.hosted_resource_manifest_sha256
    ) {
      addError(errors, "release.hosted_resource_manifest_sha256", "Hosted resource-inventory attestation must exactly match the candidate attestation.");
    }
    if (SHA256_PATTERN.test(input.release.candidate_deployable_manifest_sha256)) {
      if (!SHA256_PATTERN.test(expectedCandidateDeployableManifestSha256)) {
        addError(errors, "release.candidate_deployable_manifest_sha256", "Exact externally reviewed candidate resource-inventory attestation digest is required for source binding.");
      } else if (
        input.release.candidate_deployable_manifest_sha256
        !== expectedCandidateDeployableManifestSha256
      ) {
        addError(errors, "release.candidate_deployable_manifest_sha256", "Candidate resource-inventory attestation must match the independently reviewed source artifact inventory.");
      }
    }
    if (SHA256_PATTERN.test(input.release.hosted_resource_manifest_sha256)) {
      if (!SHA256_PATTERN.test(expectedHostedResourceManifestSha256)) {
        addError(errors, "release.hosted_resource_manifest_sha256", "Exact configured hosted resource-inventory attestation digest is required for target binding.");
      } else if (input.release.hosted_resource_manifest_sha256 !== expectedHostedResourceManifestSha256) {
        addError(errors, "release.hosted_resource_manifest_sha256", "Hosted resource-inventory attestation digest must exactly match the independently reviewed hosted inventory artifact.");
      }
    }
    if (
      isNonBlankString(input.release.release_id)
      && !containsPlaceholder(input.release.release_id)
      && !isReleaseId(input.release.release_id)
    ) {
      addError(errors, "release.release_id", "Release id must be a bounded rc-YYYY-MM-DD identifier.");
    }
    if (
      isNonBlankString(input.release.requested_rollout_date)
      && !containsPlaceholder(input.release.requested_rollout_date)
      && !isIsoCalendarDate(input.release.requested_rollout_date)
    ) {
      addError(errors, "release.requested_rollout_date", "Requested rollout date must be a real YYYY-MM-DD calendar date.");
    }
  }
  if (input.evidence !== undefined && !isObject(input.evidence)) {
    addError(errors, "evidence", "Evidence must be an object keyed by capability id when provided.");
  }
  if (!Object.hasOwn(input, "matrix")) {
    addError(errors, "matrix", "Matrix is required and must be the exact canonical LR-01/LR-02 critical-readiness matrix.");
  } else if (!Array.isArray(input.matrix)) {
    addError(errors, "matrix", "Matrix must be an array when provided.");
  }

  if (isObject(input.evidence)) {
    const allowedEvidenceIds = new Set(CRITICAL_READINESS_MATRIX.map(({ id }) => id));
    for (const [capabilityId, capabilityEvidence] of Object.entries(input.evidence)) {
      if (!allowedEvidenceIds.has(capabilityId)) {
        addError(errors, "evidence", "Evidence contains an id outside the canonical readiness matrix.");
        continue;
      }
      if (!isObject(capabilityEvidence)) {
        addError(errors, `evidence.${capabilityId}`, "Capability evidence must be an object.");
        continue;
      }
      if (capabilityEvidence.reviewers !== undefined && !isObject(capabilityEvidence.reviewers)) {
        addError(errors, `evidence.${capabilityId}.reviewers`, "Reviewers must be an object keyed by reviewer role.");
      } else if (isObject(capabilityEvidence.reviewers)) {
        for (const [reviewer, decision] of Object.entries(capabilityEvidence.reviewers)) {
          if (!LIVE_READINESS_REVIEWERS.includes(reviewer)) {
            addError(errors, `evidence.${capabilityId}.reviewers`, "Reviewers contain an unsupported role.");
          } else if (!["approved", "pending", "rejected"].includes(decision)) {
            addError(errors, `evidence.${capabilityId}.reviewers.${reviewer}`, "Reviewer decision is invalid.");
          }
        }
      }
      for (const [key, entry] of Object.entries(capabilityEvidence)) {
        if (key === "reviewers") continue;
        const entryPath = `evidence.${capabilityId}.${key}`;
        if (!LIVE_READINESS_EVIDENCE.includes(key)) {
          addError(errors, `evidence.${capabilityId}`, "Capability evidence contains an unsupported category.");
          continue;
        }
        if (!isObject(entry)) {
          addError(errors, entryPath, "Evidence category must be an object with a summary or value and references.");
          continue;
        }
        const allowedEntryKeys = key === "test_evidence"
          ? ["value", "summary", "references", "probes"]
          : ["value", "summary", "references"];
        if (Object.keys(entry).some((entryKey) => !allowedEntryKeys.includes(entryKey))) {
          addError(errors, entryPath, "Evidence category contains an unsupported field.");
        }
        for (const textKey of ["value", "summary"]) {
          if (entry[textKey] !== undefined && !isNonBlankString(entry[textKey])) {
            addError(errors, `${entryPath}.${textKey}`, "Evidence text must be a non-blank string.");
          }
        }
        if (entry.references !== undefined && !Array.isArray(entry.references)) {
          addError(errors, `${entryPath}.references`, "Evidence references must be an array when provided.");
        } else if (Array.isArray(entry.references)) {
          entry.references.forEach((reference, index) => {
            if (!isNonBlankString(reference)) {
              addError(errors, `${entryPath}.references.${index}`, "Evidence references must be non-blank strings.");
            }
          });
        }
        if (key === "test_evidence") {
          validateProbeEvidence(capabilityId, entry, entryPath, errors);
        }
      }
    }
  }

  if (Array.isArray(input.matrix)) {
    input.matrix.forEach((capability, index) => {
      if (!isObject(capability)) {
        addError(errors, `matrix.${index}`, "Capability matrix row must be an object.");
        return;
      }
      for (const field of ["id", "capability", "priority", "risk"]) {
        if (!capability[field]) {
          addError(errors, `matrix.${index}.${field}`, "Capability matrix row is missing a required field.");
        }
      }
    });

    if (
      input.matrix.length !== CRITICAL_READINESS_MATRIX.length
      || input.matrix.some((capability, index) => (
        !isExactCapabilityRow(capability, CRITICAL_READINESS_MATRIX[index])
      ))
    ) {
      addError(
        errors,
        "matrix",
        "Provided matrix must be the exact canonical LR-01/LR-02 critical-readiness matrix.",
      );
    }
  }

  return errors;
}

export function formatLiveReadinessInputErrors(errors) {
  return errors.map((error) => `${error.path}: ${error.message}`).join("; ");
}
