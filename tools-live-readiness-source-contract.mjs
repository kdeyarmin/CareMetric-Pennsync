#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import JSON5 from "json5";
import {
  LIVE_READINESS_FIXTURE_ACTORS,
  LIVE_READINESS_FIXTURE_AGENCIES,
  LIVE_READINESS_FIXTURE_ASSIGNMENTS,
  LIVE_READINESS_FIXTURE_ENTITY_FIELDS,
  LIVE_READINESS_FIXTURE_PATIENTS,
  LIVE_READINESS_FIXTURE_SET_ID,
  LIVE_READINESS_STAGING_TARGET,
  validateLiveReadinessFixtureManifest,
} from "./src/lib/liveReadinessFixtureManifest.js";

export const LIVE_READINESS_SOURCE_CONTRACT_VERSION = 3;

const CANONICAL_FIXTURE_PATH =
  "docs/audits/live-readiness-fixture-manifest.template.json";

const ENTITY_PATHS = Object.freeze({
  Agency: "base44/entities/Agency.jsonc",
  AgencyMembership: "base44/entities/AgencyMembership.jsonc",
  Patient: "base44/entities/Patient.jsonc",
  PatientCareTeamAssignment: "base44/entities/PatientCareTeamAssignment.jsonc",
  Referral: "base44/entities/Referral.jsonc",
  IncomingFax: "base44/entities/IncomingFax.jsonc",
  TelecomDestinationBinding: "base44/entities/TelecomDestinationBinding.jsonc",
  StagingReadinessFixture: "base44/entities/StagingReadinessFixture.jsonc",
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
  "base44/functions/preflightStagingReadinessFixture/entry.ts": Object.freeze([
    "Deno.serve",
    "STAGING_READINESS_PREFLIGHT_RELEASE",
    "Base44-App-Id",
    "X-Data-Env",
    "APP_PUBLIC_URL",
    "createPinnedSdkRequest",
    "entities.AgencyMembership",
    "StagingReadinessFixture.filter",
    "data_mutations_performed: false",
  ]),
  "base44/functions/createAuthorizedVisit/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "Visit.create",
    "PatientCareTeamAssignment.filter",
  ]),
  "base44/functions/manageAuthorizedReferral/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "Referral.create",
    "Referral.updateMany",
    "archive_reason: 'Removed from Referral Intake'",
  ]),
  "base44/functions/extractReferralDataForSmartNote/entry.ts": Object.freeze([
    "Deno.serve",
    "functions.invoke('manageAuthorizedReferral'",
    "validateAuthorizedReferralResult",
    "Cache-Control': 'no-store'",
  ]),
  "base44/functions/checkStaleFollowUpRequests/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "Referral.updateMany",
    "dedupe_key",
    "agency_id",
  ]),
  "base44/functions/processInboundFaxes/entry.ts": Object.freeze([
    "Deno.serve",
    "TelecomDestinationBinding.filter",
    "IncomingFax.updateMany",
    "suggested_routing: 'admin'",
    "dedupe_key",
  ]),
  "base44/functions/getAuthorizedInboundReferralFax/entry.ts": Object.freeze([
    "Deno.serve",
    "functions.invoke('manageAuthorizedReferral'",
    "IncomingFax.filter",
    "Cache-Control': 'no-store'",
  ]),
  "base44/functions/handleTelnyxStatusWebhook/entry.ts": Object.freeze([
    "resolveActiveTelnyxFaxBinding",
    "TelecomDestinationBinding.filter",
    "ingress_binding_id",
    "fax_inbound_enabled",
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
  "base44/functionTests/referralAuthorizationContract.test.js",
  "base44/functionTests/referralPrivilegedPathContainmentContract.test.js",
  "base44/functionTests/inboundReferralFaxAuthorizationContract.test.js",
  "base44/functionTests/inboundReferralFaxDocumentAuthorizationContract.test.js",
  "base44/functionTests/trainingIntegrityAuthorizationContract.test.js",
  "base44/functionTests/stagingReadinessFixturePreflightContract.test.js",
]);

const REFERRAL_BROWSER_PATHS = Object.freeze([
  "src/components/clinical/OASISQuickUpdate.jsx",
  "src/components/dashboard/OverdueFollowUpsWidget.jsx",
  "src/components/documents/ReferralDocumentViewer.jsx",
  "src/components/hub-tabs/ReferralAdmissionNote.jsx",
  "src/components/referral/DocumentToTriageMapper.jsx",
  "src/components/referral/PendingReferralsWidget.jsx",
  "src/components/referral/ScannedResponseUpload.jsx",
  "src/components/reports/FollowUpAnalytics.jsx",
  "src/components/reports/ReferralVolumeReport.jsx",
  "src/pages/ReferralFollowUp.jsx",
  "src/pages/ReferralIntake.jsx",
  "src/pages/ReferralTriage.jsx",
]);

const SOURCE_RELEASE_GATE_PATHS = Object.freeze([
  "base44/entities/Referral.jsonc",
  "base44/entities/IncomingFax.jsonc",
  "base44/entities/TelecomDestinationBinding.jsonc",
  "src/functions/manageAuthorizedReferral.js",
  "src/functions/getAuthorizedInboundReferralFax.js",
  "base44/workflows/Process Inbound Referral Faxes.jsonc",
  ...REFERRAL_BROWSER_PATHS,
]);

const READINESS_TOOL_PATHS = Object.freeze([
  "src/lib/liveReadinessFixtureManifest.js",
  "src/lib/liveReadinessGate.js",
  "src/lib/liveReadinessInputValidation.js",
  "src/lib/tenantArchitecture.js",
  "src/lib/tenantArchitecture.contract.js",
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
  Referral: Object.freeze([
    "agency_id",
    "created_by_user_id",
    "created_by_user_email_normalized",
    "client_request_id",
    "referral_creation_key",
    "version",
  ]),
  IncomingFax: Object.freeze([
    "agency_id",
    "ingress_binding_id",
    "ingress_binding_key",
    "ingress_binding_version",
    "integration_secret_id",
    "received_to_number",
    "telnyx_fax_id",
    "document_url",
    "version",
  ]),
  TelecomDestinationBinding: Object.freeze([
    "binding_key",
    "provider",
    "integration_secret_id",
    "destination_e164",
    "agency_id",
    "fax_inbound_enabled",
    "status",
    "version",
  ]),
  StagingReadinessFixture: Object.freeze([
    "fixture_set_id",
    "environment",
    "app_id",
    "origin",
    "status",
    "actor_user_ids",
    "agency_ids",
    "patient_ids",
    "assignment_ids",
    "created_by_user_id",
    "created_at",
    "expires_at",
    "last_transition_at",
    "version",
  ]),
});

const SOURCE_LIMITATIONS = Object.freeze([
  "hosted_deployment_identity_and_resource_parity_not_observed",
  "hosted_fixture_rows_and_actor_sessions_not_observed",
  "authenticated_lr01_lr02_probe_artifacts_not_observed",
  "human_reviewer_approvals_not_observed",
  "base44_atomic_assignment_uniqueness_not_available_or_proved",
  "base44_atomic_patient_and_visit_creation_uniqueness_not_available_or_proved",
  "base44_atomic_referral_creation_uniqueness_not_available_or_proved",
  "staging_preflight_does_not_prove_login_credentials_or_later_writes",
  "staging_preflight_cannot_prove_agency_key_collision_absence_without_a_canonical_key",
  "staging_preflight_does_not_inspect_legacy_email_or_profile_links",
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

function parseJsoncArtifact(text, path, errors) {
  try {
    return JSON5.parse(text);
  } catch {
    addError(errors, path, "Required source artifact must contain valid JSONC.");
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
  for (const field of LIVE_READINESS_FIXTURE_ENTITY_FIELDS[entityName] || []) {
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

function requirePropertyShape(errors, schema, entityName, field, expected) {
  const property = schema?.properties?.[field];
  for (const [key, value] of Object.entries(expected)) {
    if (property?.[key] !== value) {
      addError(
        errors,
        `entities.${entityName}.properties.${field}`,
        "Fixture registry field shape does not match the source authority contract.",
      );
      return;
    }
  }
}

function requireExactStringMap(errors, schema, entityName, field, expectedKeys) {
  const property = schema?.properties?.[field];
  const actualKeys = isObject(property?.properties)
    ? Object.keys(property.properties).sort()
    : [];
  const requiredKeys = Array.isArray(property?.required)
    ? [...property.required].sort()
    : [];
  const wantedKeys = [...expectedKeys].sort();
  const exactKeys = JSON.stringify(actualKeys) === JSON.stringify(wantedKeys)
    && JSON.stringify(requiredKeys) === JSON.stringify(wantedKeys);
  const stringValues = actualKeys.every((key) => property.properties[key]?.type === "string");
  if (
    property?.type !== "object"
    || property?.additionalProperties !== false
    || !exactKeys
    || !stringValues
  ) {
    addError(
      errors,
      `entities.${entityName}.properties.${field}`,
      "Fixture registry identity map must contain only the exact canonical string aliases.",
    );
  }
}

function validateEntitySchemas(artifacts, errors) {
  const schemas = {};
  for (const [entityName, path] of Object.entries(ENTITY_PATHS)) {
    const schema = parseJsoncArtifact(artifacts[path], `entities.${entityName}`, errors);
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
  if (schemas.Referral) {
    requireEnumValue(errors, schemas.Referral, "Referral", "status", "new");
    requireEnumValue(errors, schemas.Referral, "Referral", "status", "soc_completed");
    requireClientWritesDenied(
      errors,
      schemas.Referral,
      "Referral",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.IncomingFax) {
    requireEnumValue(errors, schemas.IncomingFax, "IncomingFax", "processing_status", "pending");
    requireEnumValue(errors, schemas.IncomingFax, "IncomingFax", "status", "routed");
    requireClientWritesDenied(
      errors,
      schemas.IncomingFax,
      "IncomingFax",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.TelecomDestinationBinding) {
    requireEnumValue(
      errors,
      schemas.TelecomDestinationBinding,
      "TelecomDestinationBinding",
      "status",
      "active",
    );
    requireClientWritesDenied(
      errors,
      schemas.TelecomDestinationBinding,
      "TelecomDestinationBinding",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.StagingReadinessFixture) {
    requireEnumValue(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      "environment",
      "staging",
    );
    requireEnumValue(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      "status",
      "preflight",
    );
    for (const field of [
      "fixture_set_id",
      "environment",
      "app_id",
      "origin",
      "status",
      "created_by_user_id",
      "created_at",
      "expires_at",
      "last_transition_at",
    ]) {
      requirePropertyShape(
        errors,
        schemas.StagingReadinessFixture,
        "StagingReadinessFixture",
        field,
        { type: "string" },
      );
    }
    for (const field of ["origin"]) {
      requirePropertyShape(
        errors,
        schemas.StagingReadinessFixture,
        "StagingReadinessFixture",
        field,
        { format: "uri" },
      );
    }
    for (const field of ["created_at", "expires_at", "last_transition_at"]) {
      requirePropertyShape(
        errors,
        schemas.StagingReadinessFixture,
        "StagingReadinessFixture",
        field,
        { format: "date-time" },
      );
    }
    requireExactStringMap(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      "actor_user_ids",
      Object.keys(LIVE_READINESS_FIXTURE_ACTORS).filter((key) => key !== "platform_owner"),
    );
    requireExactStringMap(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      "agency_ids",
      Object.keys(LIVE_READINESS_FIXTURE_AGENCIES),
    );
    requireExactStringMap(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      "patient_ids",
      Object.keys(LIVE_READINESS_FIXTURE_PATIENTS),
    );
    requirePropertyShape(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      "assignment_ids",
      {
        type: "array",
        minItems: LIVE_READINESS_FIXTURE_ASSIGNMENTS.length,
        maxItems: LIVE_READINESS_FIXTURE_ASSIGNMENTS.length,
      },
    );
    requirePropertyShape(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      "version",
      { type: "integer", minimum: 1, default: 1 },
    );
    if (schemas.StagingReadinessFixture.properties?.assignment_ids?.items?.type !== "string") {
      addError(
        errors,
        "entities.StagingReadinessFixture.properties.assignment_ids",
        "Fixture registry assignment ids must be strings.",
      );
    }
    requireClientWritesDenied(
      errors,
      schemas.StagingReadinessFixture,
      "StagingReadinessFixture",
      ["create", "read", "update", "delete"],
    );
  }
}

const PREFLIGHT_MUTATION_CALL = /\.(?:create|update|delete|deleteMany|bulkCreate|updateMany|bulkUpdate|importEntities|updateMe|inviteUser|register|verifyOtp|resendOtp|resetPasswordRequest|resetPassword|changePassword)\s*\(/;
const REVIEWED_PREFLIGHT_BASE44_FRAGMENTS = Object.freeze([
  Object.freeze({
    source: "import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';",
    count: 1,
  }),
  Object.freeze({
    source: `const STAGING_ORIGIN = '${LIVE_READINESS_STAGING_TARGET.origin}';`,
    count: 1,
  }),
  Object.freeze({
    source: "// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>",
    count: 1,
  }),
  Object.freeze({
    source: "const base44 = createClientFromRequest(createPinnedSdkRequest(req));",
    count: 1,
  }),
  Object.freeze({ source: "base44.auth.me()", count: 2 }),
  Object.freeze({ source: "const entities = base44.asServiceRole.entities;", count: 1 }),
]);
const REVIEWED_PREFLIGHT_ENTITY_FRAGMENTS = Object.freeze([
  Object.freeze({ source: "entities: Record<string, any>", count: 3 }),
  Object.freeze({ source: "await entities.User.filter(", count: 2 }),
  Object.freeze({ source: "await entities.StagingReadinessFixture.filter(", count: 1 }),
  Object.freeze({ source: "entities.AgencyMembership,", count: 2 }),
  Object.freeze({ source: "entities.Patient,", count: 1 }),
  Object.freeze({ source: "entities.PatientCareTeamAssignment,", count: 1 }),
  Object.freeze({ source: "loadExactActor(entities, binding)", count: 1 }),
  Object.freeze({ source: "loadFixtureRegistry(entities)", count: 1 }),
  Object.freeze({ source: "const entities = base44.asServiceRole.entities;", count: 1 }),
  Object.freeze({
    source: "inspectPreflight(entities, input, String(owner.id))",
    count: 2,
  }),
]);
const REVIEWED_PREFLIGHT_HANDLER_FRAGMENTS = Object.freeze([
  Object.freeze({ source: "handler: Record<string, any>,", count: 1 }),
  Object.freeze({ source: "await handler.filter(", count: 1 }),
]);
const REVIEWED_PREFLIGHT_DENO_FRAGMENTS = Object.freeze([
  Object.freeze({
    source: "Deno.env.get('STAGING_READINESS_PREFLIGHT_RELEASE')",
    count: 1,
  }),
  Object.freeze({ source: "Deno.env.get('APP_PUBLIC_URL')", count: 1 }),
  Object.freeze({ source: "Deno.env.get('SUPER_ADMIN_EMAIL')", count: 1 }),
  Object.freeze({ source: "Deno.serve(", count: 1 }),
]);

function exactFragmentCount(source, fragment) {
  return source.split(fragment).length - 1;
}

function sourceUsesOnlyReviewedIdentifier(source, identifier, fragments) {
  if (!fragments.every(({ source: fragment, count }) => (
    exactFragmentCount(source, fragment) === count
  ))) {
    return false;
  }
  let remainder = source;
  for (const { source: fragment } of fragments) {
    remainder = remainder.split(fragment).join("");
  }
  return !(new RegExp(`\\b${identifier}\\b`)).test(remainder);
}

function preflightUsesOnlyReviewedCapabilities(source) {
  return sourceUsesOnlyReviewedIdentifier(
    source,
    "base44",
    REVIEWED_PREFLIGHT_BASE44_FRAGMENTS,
  )
    && sourceUsesOnlyReviewedIdentifier(
      source,
      "entities",
      REVIEWED_PREFLIGHT_ENTITY_FRAGMENTS,
    )
    && sourceUsesOnlyReviewedIdentifier(
      source,
      "handler",
      REVIEWED_PREFLIGHT_HANDLER_FRAGMENTS,
    )
    && sourceUsesOnlyReviewedIdentifier(
      source,
      "Deno",
      REVIEWED_PREFLIGHT_DENO_FRAGMENTS,
    )
    && (source.match(/\bcreateClientFromRequest\b/g) || []).length === 2;
}

function stagingPreflightIsReadOnlyAndTargetBound(source) {
  const actorKeys = Object.keys(LIVE_READINESS_FIXTURE_ACTORS)
    .filter((key) => key !== "platform_owner")
    .map((key) => `'${key}'`)
    .join(", ");
  return typeof source === "string"
    && source.includes(`const FIXTURE_SET_ID = '${LIVE_READINESS_FIXTURE_SET_ID}';`)
    && source.includes(`const STAGING_APP_ID = '${LIVE_READINESS_STAGING_TARGET.app_id}';`)
    && source.includes(`const STAGING_ORIGIN = '${LIVE_READINESS_STAGING_TARGET.origin}';`)
    && source.includes(`const ACTOR_KEYS = [${actorKeys}] as const;`)
    && source.includes("STAGING_READINESS_PREFLIGHT_RELEASE")
    && source.includes("createPinnedSdkRequest")
    && source.includes("X-Data-Env")
    && source.includes("StagingReadinessFixture.filter")
    && source.includes("data_mutations_performed: false")
    && preflightUsesOnlyReviewedCapabilities(source)
    && !PREFLIGHT_MUTATION_CALL.test(source)
    && !/\bfetch\s*\(|\bWebSocket\b|\bEventSource\b|\bXMLHttpRequest\b|\bimport\s*\(|\bDeno\.(?:connect|connectTls|open|writeFile|writeTextFile|remove|rename)\b/.test(source);
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
  const preflightPath = "base44/functions/preflightStagingReadinessFixture/entry.ts";
  if (!stagingPreflightIsReadOnlyAndTargetBound(artifacts[preflightPath])) {
    addError(
      errors,
      preflightPath,
      "Staging readiness preflight must remain read-only and canonically target-bound.",
    );
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
  const stagingPreflightSource = artifacts[
    "base44/functions/preflightStagingReadinessFixture/entry.ts"
  ] || "";
  const stagingReadinessPreflightPresent =
    stagingPreflightIsReadOnlyAndTargetBound(stagingPreflightSource);
  const referralSchemaSource = artifacts["base44/entities/Referral.jsonc"] || "";
  const visitCreateSource = artifacts["base44/functions/createAuthorizedVisit/entry.ts"] || "";
  const referralDirectOperationPathPresent =
    referralSchemaSource.includes("\"create\": true")
    || referralSchemaSource.includes("\"update\": true")
    || REFERRAL_BROWSER_PATHS.some((path) => (
      /\b(?:base44\.)?entities\.Referral\.(?:list|filter|get|create|update|delete|bulkCreate|updateMany)\b/
        .test(artifacts[path] || "")
    ));
  const referralBrokerSource = artifacts[
    "base44/functions/manageAuthorizedReferral/entry.ts"
  ] || "";
  const referralImmutableTenantBrokerPresent =
    referralSchemaSource.includes("\"read\": false")
    && referralSchemaSource.includes("\"create\": false")
    && referralSchemaSource.includes("\"update\": false")
    && referralSchemaSource.includes("\"delete\": false")
    && referralBrokerSource.includes("Referral.updateMany")
    && referralBrokerSource.includes("AgencyMembership.filter");
  const inboundFaxWorkerSource = artifacts[
    "base44/functions/processInboundFaxes/entry.ts"
  ] || "";
  const inboundFaxWebhookSource = artifacts[
    "base44/functions/handleTelnyxStatusWebhook/entry.ts"
  ] || "";
  const inboundFaxReadSource = artifacts[
    "base44/functions/getAuthorizedInboundReferralFax/entry.ts"
  ] || "";
  const referralInboundFaxPathsSecured =
    inboundFaxWorkerSource.includes("IncomingFax.updateMany")
    && !inboundFaxWorkerSource.includes("Referral.updateMany")
    && inboundFaxWorkerSource.includes("suggested_routing: 'admin'")
    && inboundFaxWorkerSource.includes("TelecomDestinationBinding.filter")
    && inboundFaxWorkerSource.includes("WORKFLOW_RELEASE_PROCESS_INBOUND_FAXES")
    && inboundFaxWebhookSource.includes("resolveActiveTelnyxFaxBinding")
    && inboundFaxWebhookSource.includes("ingress_binding_id")
    && inboundFaxReadSource.includes("functions.invoke('manageAuthorizedReferral'")
    && inboundFaxReadSource.includes("IncomingFax.filter");
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
      staging_readiness_read_only_preflight_present: stagingReadinessPreflightPresent,
      referral_direct_mutation_path_present: referralDirectOperationPathPresent,
      referral_immutable_tenant_broker_present: referralImmutableTenantBrokerPresent,
      referral_inbound_fax_paths_secured: referralInboundFaxPathsSecured,
      visit_create_uses_legacy_assignment: visitCreateUsesLegacyAssignment,
      network_access: false,
      hosted_writes: false,
      authenticated_hosted_probes_executed: false,
    },
    source_limitations: sourceLimitations,
    errors,
  };
}
