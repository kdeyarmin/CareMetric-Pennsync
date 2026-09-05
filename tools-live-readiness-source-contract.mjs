#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LIVE_READINESS_FIXTURE_ENTITY_FIELDS,
  LIVE_READINESS_FIXTURE_SET_ID,
  validateLiveReadinessFixtureManifest,
} from "./src/lib/liveReadinessFixtureManifest.js";

export const LIVE_READINESS_SOURCE_CONTRACT_VERSION = 1;

const CANONICAL_FIXTURE_PATH =
  "docs/audits/live-readiness-fixture-manifest.template.json";

const ENTITY_PATHS = Object.freeze({
  Agency: "base44/entities/Agency.jsonc",
  AgencyMembership: "base44/entities/AgencyMembership.jsonc",
  Patient: "base44/entities/Patient.jsonc",
  PatientCareTeamAssignment: "base44/entities/PatientCareTeamAssignment.jsonc",
});

const BROKER_MARKERS = Object.freeze({
  "base44/functions/manageAgencyMembership/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.create",
    "AgencyMembership.filter",
    "isProtectedPlatformOwner",
  ]),
  "base44/functions/getMyTenantContext/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "No active tenant membership",
    "membership_version",
  ]),
  "base44/functions/createAuthorizedPatient/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "Patient.create",
    "patient_creation_key",
  ]),
  "base44/functions/listAuthorizedPatients/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
    "PURPOSE_FIELDS",
  ]),
  "base44/functions/getAuthorizedPatient/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
    "PURPOSE_FIELDS",
  ]),
  "base44/functions/managePatientCareTeamAssignment/entry.ts": Object.freeze([
    "Deno.serve",
    "CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false",
    "PatientCareTeamAssignment.create",
    "care_team_assignment_mutations_paused",
  ]),
  "base44/functions/createAuthorizedVisit/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "Visit.create",
  ]),
  "base44/functions/getAuthorizedVisit/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
  ]),
  "base44/functions/listAuthorizedVisits/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
  ]),
});

const CONTRACT_TEST_PATHS = Object.freeze([
  "base44/functionTests/agencyMembershipLifecycleContract.test.js",
  "base44/functionTests/immutableTenantAuthorizationContract.test.js",
  "base44/functionTests/patientCreationAuthorizationContract.test.js",
  "base44/functionTests/patientReadAuthorizationContract.test.js",
  "base44/functionTests/patientCareTeamAssignmentContract.test.js",
  "base44/functionTests/visitCreationAuthorizationContract.test.js",
  "base44/functionTests/visitReadAuthorizationContract.test.js",
  "base44/functionTests/trainingIntegrityAuthorizationContract.test.js",
]);

const SOURCE_RELEASE_GATE_PATHS = Object.freeze([
  "base44/entities/Referral.jsonc",
  "src/pages/ReferralIntake.jsx",
]);

const READINESS_TOOL_PATHS = Object.freeze([
  "src/lib/liveReadinessFixtureManifest.js",
  "src/lib/liveReadinessGate.js",
  "src/lib/liveReadinessInputValidation.js",
  "src/lib/liveReadinessReleaseLedger.js",
  "src/lib/liveReadinessCiReport.js",
  "tools-live-readiness-source-contract.mjs",
  "tools-live-readiness-fixture-validate.mjs",
  "tools-live-readiness-report.mjs",
]);

export const LIVE_READINESS_SOURCE_ARTIFACT_PATHS = Object.freeze([...new Set([
  CANONICAL_FIXTURE_PATH,
  ...Object.values(ENTITY_PATHS),
  ...Object.keys(BROKER_MARKERS),
  ...SOURCE_RELEASE_GATE_PATHS,
  ...CONTRACT_TEST_PATHS,
  ...READINESS_TOOL_PATHS,
])].sort());

const REQUIRED_SCHEMA_FIELDS = Object.freeze({
  Agency: Object.freeze(["agency_name", "agency_code"]),
  AgencyMembership: Object.freeze([
    "membership_key",
    "agency_id",
    "user_id",
    "user_email_normalized",
    "tenant_role",
    "status",
    "created_by_user_id",
    "last_transition_by_user_id",
    "last_transition_by_email_normalized",
    "last_transition_at",
    "last_transition_reason",
    "version",
  ]),
  Patient: Object.freeze(["first_name", "last_name"]),
  PatientCareTeamAssignment: Object.freeze([
    "assignment_key",
    "agency_id",
    "patient_id",
    "user_id",
    "user_email_normalized",
    "assignee_membership_id",
    "assignee_membership_version_at_enablement",
    "status",
    "source",
    "created_by_user_id",
    "created_by_user_email_normalized",
    "activated_at",
    "last_transition_by_user_id",
    "last_transition_by_email_normalized",
    "last_transition_at",
    "last_transition_reason",
    "last_transition_action",
    "last_transition_request_id",
    "last_transition_request_key",
    "version",
  ]),
});

const SOURCE_LIMITATIONS = Object.freeze([
  "hosted_deployment_identity_and_resource_parity_not_observed",
  "hosted_fixture_rows_and_actor_sessions_not_observed",
  "authenticated_lr01_lr02_probe_artifacts_not_observed",
  "human_reviewer_approvals_not_observed",
  "base44_atomic_assignment_uniqueness_not_available_or_proved",
  "lr02_s3_referral_path_not_covered_by_a_reviewed_immutable_tenant_broker_contract",
]);

function defaultReadArtifact(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function parseJsonArtifact(text, path, errors) {
  try {
    return JSON.parse(text);
  } catch {
    addError(errors, path, "Required source artifact must contain valid JSON.");
    return null;
  }
}

function requireFields(errors, path, actual, expected) {
  if (!Array.isArray(actual)) {
    addError(errors, path, "Required-field declaration must be an array.");
    return;
  }
  for (const field of expected) {
    if (!actual.includes(field)) {
      addError(errors, path, "Required authority field is not schema-required.");
    }
  }
}

function requireProperties(errors, entityName, schema) {
  if (!isObject(schema) || schema.name !== entityName || schema.type !== "object") {
    addError(errors, `entities.${entityName}`, "Entity name/type does not match the readiness source contract.");
    return;
  }
  if (!isObject(schema.properties)) {
    addError(errors, `entities.${entityName}.properties`, "Entity properties must be an object.");
    return;
  }
  for (const field of LIVE_READINESS_FIXTURE_ENTITY_FIELDS[entityName]) {
    if (!isObject(schema.properties[field])) {
      addError(errors, `entities.${entityName}.properties`, "Fixture authority field is not declared.");
    }
  }
  requireFields(
    errors,
    `entities.${entityName}.required`,
    schema.required,
    REQUIRED_SCHEMA_FIELDS[entityName],
  );
}

function requireEnumValue(errors, schema, entityName, field, expectedValue) {
  const values = schema?.properties?.[field]?.enum;
  if (!Array.isArray(values) || !values.includes(expectedValue)) {
    addError(
      errors,
      `entities.${entityName}.properties.${field}`,
      "Schema enum does not allow the canonical fixture value.",
    );
  }
}

function requireClientWritesDenied(errors, schema, entityName, operations) {
  for (const operation of operations) {
    if (schema?.rls?.[operation] !== false) {
      addError(
        errors,
        `entities.${entityName}.rls.${operation}`,
        "Source authority contract requires this direct client operation to be denied.",
      );
    }
  }
}

function validateEntitySchemas(artifacts, errors) {
  const schemas = {};
  for (const [entityName, path] of Object.entries(ENTITY_PATHS)) {
    const schema = parseJsonArtifact(artifacts[path], `entities.${entityName}`, errors);
    if (!schema) continue;
    schemas[entityName] = schema;
    requireProperties(errors, entityName, schema);
  }

  if (schemas.Agency) {
    requireEnumValue(errors, schemas.Agency, "Agency", "status", "active");
    if (schemas.Agency.rls?.create?.user_condition?.role !== "admin") {
      addError(errors, "entities.Agency.rls.create", "Agency creation must remain platform-admin-only.");
    }
  }
  if (schemas.AgencyMembership) {
    requireEnumValue(errors, schemas.AgencyMembership, "AgencyMembership", "tenant_role", "agency_admin");
    requireEnumValue(errors, schemas.AgencyMembership, "AgencyMembership", "tenant_role", "clinician");
    requireEnumValue(errors, schemas.AgencyMembership, "AgencyMembership", "status", "active");
    requireClientWritesDenied(
      errors,
      schemas.AgencyMembership,
      "AgencyMembership",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.Patient) {
    requireEnumValue(errors, schemas.Patient, "Patient", "status", "active");
    for (const field of ["is_sample", "is_archived"]) {
      if (schemas.Patient.properties?.[field]?.type !== "boolean"
        || schemas.Patient.properties[field].default !== false) {
        addError(
          errors,
          `entities.Patient.properties.${field}`,
          "Canonical patient safety flag must be a false-defaulting boolean.",
        );
      }
    }
    requireClientWritesDenied(errors, schemas.Patient, "Patient", ["create", "update", "delete"]);
  }
  if (schemas.PatientCareTeamAssignment) {
    requireEnumValue(
      errors,
      schemas.PatientCareTeamAssignment,
      "PatientCareTeamAssignment",
      "status",
      "active",
    );
    requireEnumValue(
      errors,
      schemas.PatientCareTeamAssignment,
      "PatientCareTeamAssignment",
      "source",
      "manual",
    );
    requireClientWritesDenied(
      errors,
      schemas.PatientCareTeamAssignment,
      "PatientCareTeamAssignment",
      ["create", "read", "update", "delete"],
    );
  }
}

function validateSourceMarkers(artifacts, errors) {
  for (const [path, markers] of Object.entries(BROKER_MARKERS)) {
    const source = artifacts[path];
    for (const marker of markers) {
      if (!source.includes(marker)) {
        addError(errors, path, "Required reviewed-broker source marker is absent.");
      }
    }
  }
  for (const path of CONTRACT_TEST_PATHS) {
    const source = artifacts[path];
    if (!source.includes("node:test") || !source.includes("assert")) {
      addError(errors, path, "Required local authority contract test source is absent or malformed.");
    }
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function formatLiveReadinessSourceContractErrors(errors) {
  return errors.map((error) => `${error.path}: ${error.message}`).join("; ");
}

export function createLiveReadinessSourceContract({
  readArtifact = defaultReadArtifact,
} = {}) {
  const errors = [];
  const artifacts = {};
  let canonicalFixture = null;
  for (const path of LIVE_READINESS_SOURCE_ARTIFACT_PATHS) {
    try {
      const value = readArtifact(path);
      if (typeof value !== "string") {
        addError(errors, path, "Required source artifact must be readable text.");
      } else {
        artifacts[path] = value;
      }
    } catch {
      addError(errors, path, "Required source artifact could not be read.");
    }
  }

  if (Object.keys(artifacts).length === LIVE_READINESS_SOURCE_ARTIFACT_PATHS.length) {
    canonicalFixture = parseJsonArtifact(
      artifacts[CANONICAL_FIXTURE_PATH],
      "fixture_manifest",
      errors,
    );
    if (canonicalFixture) {
      for (const error of validateLiveReadinessFixtureManifest(canonicalFixture)) {
        addError(errors, `fixture_manifest.${error.path}`, error.message);
      }
    }
    validateEntitySchemas(artifacts, errors);
    validateSourceMarkers(artifacts, errors);
  }

  const artifactSha256 = Object.fromEntries(
    LIVE_READINESS_SOURCE_ARTIFACT_PATHS
      .filter((path) => typeof artifacts[path] === "string")
      .map((path) => [path, sha256(artifacts[path])]),
  );
  const contractPayload = {
    schema_version: LIVE_READINESS_SOURCE_CONTRACT_VERSION,
    fixture_set_id: LIVE_READINESS_FIXTURE_SET_ID,
    fixture_manifest_sha256: canonicalFixture
      ? sha256(canonicalJson(canonicalFixture))
      : null,
    artifact_sha256: artifactSha256,
  };
  const valid = errors.length === 0;
  const hasErrorFor = (prefix) => errors.some((error) => error.path.startsWith(prefix));
  const assignmentSource = artifacts[
    "base44/functions/managePatientCareTeamAssignment/entry.ts"
  ] || "";
  const assignmentMutationsPaused =
    assignmentSource.includes("CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false")
    && assignmentSource.includes("!CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED");
  const referralSchemaSource = artifacts["base44/entities/Referral.jsonc"] || "";
  const referralIntakeSource = artifacts["src/pages/ReferralIntake.jsx"] || "";
  const visitCreateSource = artifacts["base44/functions/createAuthorizedVisit/entry.ts"] || "";
  const referralDirectMutationPathPresent =
    referralSchemaSource.includes("\"create\": true")
    && referralSchemaSource.includes("\"update\": true")
    && referralIntakeSource.includes("base44.entities.Referral.create");
  const visitCreateUsesLegacyAssignment =
    visitCreateSource.includes("patient.assigned_nurses")
    && !visitCreateSource.includes("PatientCareTeamAssignment.filter");
  const sourceLimitations = [
    ...SOURCE_LIMITATIONS,
    ...(assignmentMutationsPaused
      ? ["canonical_assignment_cannot_be_provisioned_while_assignment_mutations_are_paused"]
      : []),
    ...(visitCreateUsesLegacyAssignment
      ? ["lr02_s4_visit_create_contract_retains_legacy_patient_assignment_fields"]
      : []),
  ];

  return {
    status: valid ? "valid_source_authority_contract" : "invalid_source_authority_contract",
    readiness_status: "blocked_until_authenticated_hosted_evidence_and_reviews_exist",
    schema_version: LIVE_READINESS_SOURCE_CONTRACT_VERSION,
    fixture_set_id: LIVE_READINESS_FIXTURE_SET_ID,
    source_authority_contract_sha256: valid
      ? sha256(canonicalJson(contractPayload))
      : null,
    artifact_count: Object.keys(artifactSha256).length,
    checks: {
      canonical_fixture: !hasErrorFor("fixture_manifest"),
      authority_schema_semantics: !hasErrorFor("entities."),
      reviewed_broker_source_markers: !Object.keys(BROKER_MARKERS)
        .some((path) => hasErrorFor(path)),
      local_contract_test_sources: !CONTRACT_TEST_PATHS
        .some((path) => hasErrorFor(path)),
      source_release_gates_recorded: SOURCE_RELEASE_GATE_PATHS
        .every((path) => typeof artifacts[path] === "string"),
      care_team_assignment_mutations_paused: assignmentMutationsPaused,
      referral_direct_mutation_path_present: referralDirectMutationPathPresent,
      visit_create_uses_legacy_assignment: visitCreateUsesLegacyAssignment,
      network_access: false,
      hosted_writes: false,
      authenticated_hosted_probes_executed: false,
    },
    source_limitations: sourceLimitations,
    errors,
  };
}
