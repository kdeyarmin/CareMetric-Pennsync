#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import JSON5 from "json5";
import {
  LIVE_READINESS_FIXTURE_ACTORS,
  LIVE_READINESS_FIXTURE_AGENCY_ALIASES,
  LIVE_READINESS_FIXTURE_AGENCIES,
  LIVE_READINESS_FIXTURE_ASSIGNMENTS,
  LIVE_READINESS_FIXTURE_ENTITY_FIELDS,
  LIVE_READINESS_FIXTURE_PATIENT_ALIASES,
  LIVE_READINESS_FIXTURE_PATIENTS,
  LIVE_READINESS_FIXTURE_SET_ID,
  LIVE_READINESS_STAGING_TARGET,
  LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES,
  LIVE_READINESS_FIXTURE_TOPOLOGY,
  validateLiveReadinessFixtureManifest,
} from "./src/lib/liveReadinessFixtureManifest.js";
import {
  INHERITED_CONTENT_SCOPE,
  PHYSICIAN_AGENCY_OVERLAY_FIELDS,
  PHYSICIAN_MASTER_FIELDS,
  READINESS_FIXTURE_ACTORS,
  READINESS_FIXTURE_AGENCY_ALIASES,
  READINESS_FIXTURE_ASSIGNMENTS,
  READINESS_FIXTURE_PATIENT_ALIASES,
  READINESS_FIXTURE_PATIENTS,
  READINESS_FIXTURE_TARGET,
  READINESS_FIXTURE_TENANT_ACTOR_ALIASES,
  READINESS_FIXTURE_TOPOLOGY,
  SCOPED_CONTENT_ROOTS,
} from "./src/lib/tenantArchitecture.js";

export const LIVE_READINESS_SOURCE_CONTRACT_VERSION = 4;

const CANONICAL_FIXTURE_PATH =
  "docs/audits/live-readiness-fixture-manifest.template.json";

const ENTITY_PATHS = Object.freeze({
  Agency: "base44/entities/Agency.jsonc",
  AgencyMembership: "base44/entities/AgencyMembership.jsonc",
  ContentScopeBinding: "base44/entities/ContentScopeBinding.jsonc",
  CustomValidationRule: "base44/entities/CustomValidationRule.jsonc",
  EducationMaterial: "base44/entities/EducationMaterial.jsonc",
  LearningPlan: "base44/entities/LearningPlan.jsonc",
  LearningPlanCourse: "base44/entities/LearningPlanCourse.jsonc",
  LibraryDocument: "base44/entities/LibraryDocument.jsonc",
  Patient: "base44/entities/Patient.jsonc",
  PatientCareTeamAssignment: "base44/entities/PatientCareTeamAssignment.jsonc",
  PDFTemplate: "base44/entities/PDFTemplate.jsonc",
  Physician: "base44/entities/Physician.jsonc",
  PhysicianAgencyProfile: "base44/entities/PhysicianAgencyProfile.jsonc",
  Referral: "base44/entities/Referral.jsonc",
  IncomingFax: "base44/entities/IncomingFax.jsonc",
  TelecomDestinationBinding: "base44/entities/TelecomDestinationBinding.jsonc",
  StagingReadinessFixture: "base44/entities/StagingReadinessFixture.jsonc",
  Visit: "base44/entities/Visit.jsonc",
  OASISAssessment: "base44/entities/OASISAssessment.jsonc",
  Document: "base44/entities/Document.jsonc",
  DocumentTenantBinding: "base44/entities/DocumentTenantBinding.jsonc",
  TrainingCompletion: "base44/entities/TrainingCompletion.jsonc",
  TrainingAttempt: "base44/entities/TrainingAttempt.jsonc",
  TrainingCertificate: "base44/entities/TrainingCertificate.jsonc",
  TrainingAssignment: "base44/entities/TrainingAssignment.jsonc",
  TrainingCourse: "base44/entities/TrainingCourse.jsonc",
  TrainingModule: "base44/entities/TrainingModule.jsonc",
});

const CONTENT_SCOPE_ROOT_ENTITY_NAMES = Object.freeze([
  "CustomValidationRule",
  "EducationMaterial",
  "LearningPlan",
  "LibraryDocument",
  "PDFTemplate",
  "TrainingCourse",
]);

const CONTENT_SCOPE_CHILDREN = Object.freeze({
  LearningPlanCourse: Object.freeze({ parentEntity: "LearningPlan", parentField: "plan_id" }),
  TrainingModule: Object.freeze({ parentEntity: "TrainingCourse", parentField: "course_id" }),
});

const CONTENT_SCOPE_ENTITY_NAMES = Object.freeze([
  "ContentScopeBinding",
  ...CONTENT_SCOPE_ROOT_ENTITY_NAMES,
  ...Object.keys(CONTENT_SCOPE_CHILDREN),
]);

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
    "VISIT_TYPES",
  ]),
  "base44/functions/manageAuthorizedReferral/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "Referral.create",
    "Referral.updateMany",
    "archive_reason: 'Removed from Referral Intake'",
    "REFERRAL_PRIORITIES",
    "DOCUMENT_TYPES",
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
  "base44/functions/updateAuthorizedVisit/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
    "Visit.updateMany",
    "Cache-Control': 'no-store'",
  ]),
  "base44/functions/readAuthorizedOASISAssessments/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
    "OASISAssessment.filter",
  ]),
  "base44/functions/createAuthorizedDocument/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
    "UploadPrivateFile",
    "Document.create",
    "DocumentTenantBinding.create",
  ]),
  "base44/functions/getAuthorizedDocument/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
    "DocumentTenantBinding.filter",
    "Document.filter",
    "Cache-Control': 'no-store'",
  ]),
  "base44/functions/listAuthorizedDocuments/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientCareTeamAssignment.filter",
    "DocumentTenantBinding.filter",
    "Document.filter",
  ]),
  "base44/functions/appendPatientNoteHistory/entry.ts": Object.freeze([
    "Deno.serve",
    "AgencyMembership.filter",
    "PatientNoteHistoryEntry.create",
  ]),
  "base44/functions/gradeTrainingAttempt/entry.ts": Object.freeze([
    "Deno.serve",
    "TrainingAttempt.create",
    "functions.invoke('issueCertificate'",
  ]),
  "base44/functions/issueCertificate/entry.ts": Object.freeze([
    "Deno.serve",
    "INTERNAL_FN_SECRET",
    "TrainingAttempt",
    "TrainingCertificate.create",
  ]),
});

const CLINICAL_CHILD_BROKER_PATHS = Object.freeze([
  "base44/functions/getAuthorizedVisit/entry.ts",
  "base44/functions/listAuthorizedVisits/entry.ts",
  "base44/functions/readAuthorizedOASISAssessments/entry.ts",
  "base44/functions/getAuthorizedDocument/entry.ts",
  "base44/functions/listAuthorizedDocuments/entry.ts",
]);

const TRAINING_FORGE_GUARD_PATHS = Object.freeze([
  "base44/functions/gradeTrainingAttempt/entry.ts",
  "base44/functions/issueCertificate/entry.ts",
]);

const AUTH_SOURCE_MARKERS = Object.freeze({
  "base44/auth/config.jsonc": Object.freeze([
    "\"enableUsernamePassword\": true",
  ]),
  "src/api/base44Client.js": Object.freeze([
    "createClient",
    "rawBase44.auth.me()",
  ]),
  "src/components/auth/SignInScreen.jsx": Object.freeze([
    "/auth/login",
    "base44.auth.setToken",
    "Incorrect email or password",
  ]),
  "src/lib/AuthContext.jsx": Object.freeze([
    "tenantAuthorityClient.me",
    "base44.auth.logout",
    "base44.auth.redirectToLogin",
  ]),
});

const SMART_NOTE_SOURCE_MARKERS = Object.freeze({
  "src/pages/SmartNoteAssistant.jsx": Object.freeze([
    "persistVisitNote",
    "setSaved(true)",
  ]),
  "src/components/smartNote/persistVisitNote.js": Object.freeze([
    "createAuthorizedVisit",
    "functions.invoke('appendPatientNoteHistory'",
    "ComplianceAudit.create",
    "documentation_source: source",
  ]),
  "src/functions/createAuthorizedVisit.js": Object.freeze([
    "functions.invoke('createAuthorizedVisit'",
  ]),
  "src/functions/updateAuthorizedVisit.js": Object.freeze([
    "functions.invoke('updateAuthorizedVisit'",
  ]),
});

const FIXTURE_ASSEMBLY_SOURCE_MARKERS = Object.freeze({
  "src/lib/liveReadinessFixtureManifest.js": Object.freeze([
    "assembleLiveReadinessFixtureRequests",
    "expected_version",
    "referral:",
    "patient_id:",
    "mode: \"plan_only_no_writes\"",
    "network_access: false",
    "hosted_writes: false",
  ]),
});

const TENANT_ARCHITECTURE_SOURCE_MARKERS = Object.freeze({
  "src/lib/liveReadinessFixtureManifest.js": Object.freeze([
    "export const LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES = Object.freeze(",
    "export const LIVE_READINESS_FIXTURE_AGENCY_ALIASES = Object.freeze(",
    "export const LIVE_READINESS_FIXTURE_PATIENT_ALIASES = Object.freeze(",
    "export const LIVE_READINESS_FIXTURE_TOPOLOGY = Object.freeze({",
    "assignment_edges: Object.freeze(LIVE_READINESS_FIXTURE_ASSIGNMENTS.map",
  ]),
  "src/lib/tenantArchitecture.js": Object.freeze([
    "const TENANT_ACTOR_KEYS = READINESS_FIXTURE_TENANT_ACTOR_ALIASES;",
    "export const READINESS_FIXTURE_ASSIGNMENTS = Object.freeze(",
    "export const READINESS_FIXTURE_TOPOLOGY = Object.freeze({",
    "agency: actor.agency,",
    "tenantRole: actor.tenant_role,",
    "agency: patient.agency,",
    "creator: patient.creator,",
    "status: patient.status,",
    "isSample: patient.is_sample,",
    "isArchived: patient.is_archived,",
    "patient: assignment.patient,",
    "actor: assignment.actor,",
    "status: assignment.status,",
    "source: assignment.source,",
    "tenantActorAliases: READINESS_FIXTURE_TENANT_ACTOR_ALIASES,",
    "agencyAliases: READINESS_FIXTURE_AGENCY_ALIASES,",
    "patientAliases: READINESS_FIXTURE_PATIENT_ALIASES,",
    "assignmentEdges: LIVE_READINESS_FIXTURE_TOPOLOGY.assignment_edges,",
    "LearningPlanCourse: Object.freeze({ parentEntity: 'LearningPlan', parentField: 'plan_id' })",
    "TrainingModule: Object.freeze({ parentEntity: 'TrainingCourse', parentField: 'course_id' })",
  ]),
  "src/lib/tenantArchitecture.contract.js": Object.freeze([
    "canonical manifest aliases and architecture projections have exact frozen parity",
    "learning-plan courses and training modules inherit only from exact verified parents",
  ]),
});

const CONTRACT_TEST_PATHS = Object.freeze([
  "base44/schemaContract.test.js",
  "base44/functionTests/agencyMembershipLifecycleContract.test.js",
  "base44/functionTests/immutableTenantAuthorizationContract.test.js",
  "base44/functionTests/patientCreationAuthorizationContract.test.js",
  "base44/functionTests/patientReadAuthorizationContract.test.js",
  "base44/functionTests/patientCareTeamAssignmentContract.test.js",
  "base44/functionTests/visitCreationAuthorizationContract.test.js",
  "base44/functionTests/visitReadAuthorizationContract.test.js",
  "base44/functionTests/visitMutationAuthorizationContract.test.js",
  "base44/functionTests/oasisReadAuthorizationContract.test.js",
  "base44/functionTests/documentReadAuthorizationContract.test.js",
  "base44/functionTests/documentCreationAuthorizationContract.test.js",
  "base44/functionTests/referralAuthorizationContract.test.js",
  "base44/functionTests/referralPrivilegedPathContainmentContract.test.js",
  "base44/functionTests/inboundReferralFaxAuthorizationContract.test.js",
  "base44/functionTests/inboundReferralFaxDocumentAuthorizationContract.test.js",
  "base44/functionTests/trainingIntegrityAuthorizationContract.test.js",
  "base44/functionTests/stagingReadinessFixturePreflightContract.test.js",
  "base44/functionTests/gradeTrainingAttemptScore.test.js",
  "src/components/smartNote/persistVisitNote.spec.js",
  "src/components/auth/SignInScreen.spec.jsx",
  "src/lib/liveReadinessFixtureManifest.test.js",
  "src/lib/tenantArchitecture.contract.js",
  "tools-live-readiness-source-contract.test.mjs",
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

const CLINICAL_CHILD_ENTITY_NAMES = Object.freeze([
  "Visit",
  "OASISAssessment",
  "Document",
  "DocumentTenantBinding",
]);

const TRAINING_FORGE_GUARD_ENTITY_NAMES = Object.freeze([
  "TrainingCompletion",
  "TrainingAttempt",
  "TrainingCertificate",
  "TrainingAssignment",
  "TrainingCourse",
]);

const MANDATORY_PROBE_SOURCE_PATHS = Object.freeze([...new Set([
  ...CONTENT_SCOPE_ENTITY_NAMES.map((name) => ENTITY_PATHS[name]),
  ENTITY_PATHS.Physician,
  ENTITY_PATHS.PhysicianAgencyProfile,
  ENTITY_PATHS.StagingReadinessFixture,
  ...CLINICAL_CHILD_ENTITY_NAMES.map((name) => ENTITY_PATHS[name]),
  ...TRAINING_FORGE_GUARD_ENTITY_NAMES.map((name) => ENTITY_PATHS[name]),
  ...CLINICAL_CHILD_BROKER_PATHS,
  ...TRAINING_FORGE_GUARD_PATHS,
  ...Object.keys(AUTH_SOURCE_MARKERS),
  ...Object.keys(SMART_NOTE_SOURCE_MARKERS),
  ...Object.keys(FIXTURE_ASSEMBLY_SOURCE_MARKERS),
])].sort());

const SOURCE_ARTIFACT_GROUPS = Object.freeze([
  Object.freeze([CANONICAL_FIXTURE_PATH]),
  Object.freeze(Object.values(ENTITY_PATHS)),
  Object.freeze(Object.keys(BROKER_MARKERS)),
  Object.freeze(Object.keys(AUTH_SOURCE_MARKERS)),
  Object.freeze(Object.keys(SMART_NOTE_SOURCE_MARKERS)),
  Object.freeze(Object.keys(FIXTURE_ASSEMBLY_SOURCE_MARKERS)),
  Object.freeze(Object.keys(TENANT_ARCHITECTURE_SOURCE_MARKERS)),
  SOURCE_RELEASE_GATE_PATHS,
  CONTRACT_TEST_PATHS,
  READINESS_TOOL_PATHS,
]);

// v4 is the true set union of the independently evolved readiness and tenant-
// architecture artifact families. A path appearing in more than one family is
// hashed once, while no family may be silently dropped during reconciliation.
export const LIVE_READINESS_SOURCE_ARTIFACT_PATHS = Object.freeze([
  ...new Set(SOURCE_ARTIFACT_GROUPS.flat()),
].sort());

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
  ContentScopeBinding: Object.freeze([
    "binding_key",
    "entity_name",
    "resource_id",
    "scope_type",
    "status",
    "created_by_user_id",
    "created_by_user_email_normalized",
    "last_transition_by_user_id",
    "last_transition_at",
    "last_transition_reason",
    "version",
  ]),
  CustomValidationRule: Object.freeze([
    "rule_name", "entity_type", "field_name", "validation_type",
  ]),
  EducationMaterial: Object.freeze(["title", "category", "content"]),
  LearningPlan: Object.freeze(["name", "business_line_scope", "year"]),
  LearningPlanCourse: Object.freeze(["plan_id", "course_id"]),
  LibraryDocument: Object.freeze(["title", "category", "file_url"]),
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
  PDFTemplate: Object.freeze(["template_name", "template_category", "template_file_url"]),
  Physician: Object.freeze(["full_name", "fax_number"]),
  PhysicianAgencyProfile: Object.freeze([
    "profile_key",
    "agency_id",
    "physician_id",
    "status",
    "created_by_user_id",
    "last_transition_by_user_id",
    "last_transition_at",
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
  Visit: Object.freeze(["patient_id", "visit_date", "visit_type"]),
  OASISAssessment: Object.freeze(["patient_id", "visit_type"]),
  Document: Object.freeze(["title", "category"]),
  DocumentTenantBinding: Object.freeze([
    "binding_key",
    "document_id",
    "agency_id",
    "created_by_user_id",
    "created_by_user_email_normalized",
    "membership_id",
    "membership_version",
    "document_created_by_email_normalized",
    "storage_mode",
    "file_uri",
    "file_name",
    "file_type",
    "file_size",
    "content_sha256",
    "client_request_id",
    "purpose",
    "version",
    "created_at",
    "last_verified_at",
  ]),
  TrainingCompletion: Object.freeze(["nurse_email", "training_module_id", "status"]),
  TrainingAttempt: Object.freeze(["course_id", "user_id", "started_at"]),
  TrainingCertificate: Object.freeze(["user_id", "course_id", "issued_at", "certificate_id"]),
  TrainingAssignment: Object.freeze(["course_id", "assigned_by"]),
  TrainingCourse: Object.freeze(["title", "category", "status"]),
  TrainingModule: Object.freeze(["title", "category", "module_type"]),
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
  "staging_preflight_agency_code_checks_are_bounded_point_in_time_and_do_not_reserve",
  "staging_preflight_does_not_inspect_legacy_email_or_profile_links",
  "staging_fixture_registry_does_not_record_referral_or_visit_teardown_ids",
  "content_scope_crud_and_legacy_classification_require_human_approval",
  "content_scope_binding_runtime_enforcement_not_implemented",
  "training_course_published_read_is_incompatible_with_agency_scoped_content",
  "training_module_generic_content_and_content_json_are_not_sanitized_learner_projections",
  "hosted_nested_field_rls_effectiveness_for_training_answers_not_observed",
  "auxiliary_tenant_aggregate_brokers_for_compliance_audit_note_conversion_and_training_assignment_not_available",
  "incident_and_user_browser_post_filtering_is_an_interim_boundary",
  "source_marker_and_regex_scanners_are_not_formal_interprocedural_containment_proofs",
]);

function defaultReadArtifact(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const RUNTIME_IMPORTED_SEMANTIC_ARTIFACT_PATHS = Object.freeze([
  "src/lib/liveReadinessFixtureManifest.js",
  "src/lib/tenantArchitecture.js",
]);

// The exact semantic comparisons below use values evaluated from these two
// modules at import time. Bind custom artifact readers to those same bytes so
// injected source cannot be hashed while stale imported values are validated.
const RUNTIME_IMPORTED_SEMANTIC_ARTIFACT_SNAPSHOTS = Object.freeze(
  Object.fromEntries(RUNTIME_IMPORTED_SEMANTIC_ARTIFACT_PATHS.map((path) => (
    [path, defaultReadArtifact(path)]
  ))),
);

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
    REQUIRED_SCHEMA_FIELDS[entityName] || [],
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

function requireBrokerSetValue(errors, artifacts, path, setName, expectedValue) {
  const source = artifacts[path] || "";
  const declaration = source.match(new RegExp(
    `const\\s+${setName}\\s*=\\s*new\\s+Set\\s*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)\\s*;`,
  ));
  const escapedValue = expectedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!declaration || !new RegExp(`(?:'${escapedValue}'|"${escapedValue}")`).test(declaration[1])) {
    addError(
      errors,
      `${path}.${setName}`,
      "Reviewed broker enum does not allow the canonical fixture value.",
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
    if (canonicalJson(property?.[key]) !== canonicalJson(value)) {
      addError(
        errors,
        `entities.${entityName}.properties.${field}`,
        "Fixture registry field shape does not match the source authority contract.",
      );
      return;
    }
  }
}

function requireExactPropertyContracts(errors, schema, entityName, expectedContracts) {
  const actualPropertyNames = isObject(schema?.properties)
    ? Object.keys(schema.properties).sort()
    : schema?.properties;
  const expectedPropertyNames = Object.keys(expectedContracts).sort();
  requireExactValue(
    errors,
    `entities.${entityName}.properties`,
    actualPropertyNames,
    expectedPropertyNames,
    "Schema properties must exactly match the reviewed architecture contract.",
  );
  requireExactValue(
    errors,
    `entities.${entityName}.additionalProperties`,
    schema?.additionalProperties,
    undefined,
    "Unreviewed additionalProperties semantics are not permitted.",
  );
  for (const [field, expected] of Object.entries(expectedContracts)) {
    const property = schema?.properties?.[field];
    const semanticProperty = isObject(property)
      ? Object.fromEntries(Object.entries(property).filter(([key]) => key !== "description"))
      : property;
    requireExactValue(
      errors,
      `entities.${entityName}.properties.${field}`,
      semanticProperty,
      expected,
      "Schema field semantics must exactly match the reviewed architecture contract.",
    );
  }
}

function requireNonAdminWritesDenied(errors, schema, entityName, operations) {
  for (const operation of operations) {
    const rule = schema?.rls?.[operation];
    if (rule !== false && rule?.user_condition?.role !== "admin") {
      addError(
        errors,
        `entities.${entityName}.rls.${operation}`,
        "Source authority contract requires this operation to deny non-admin direct writes.",
      );
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

function requireExactValue(errors, path, actual, expected, message) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    addError(errors, path, message);
  }
}

function requireExactRequiredFields(errors, schema, entityName, expectedFields) {
  requireExactValue(
    errors,
    `entities.${entityName}.required`,
    Array.isArray(schema?.required) ? [...schema.required].sort() : schema?.required,
    [...expectedFields].sort(),
    "Schema required fields must exactly match the reviewed architecture contract.",
  );
}

function requireFailClosedEntity(errors, schema, entityName) {
  for (const operation of ["create", "read", "update", "delete"]) {
    if (schema?.rls?.[operation] !== false) {
      addError(
        errors,
        `entities.${entityName}.rls.${operation}`,
        "Architecture authority/provenance entities must remain fail-closed.",
      );
    }
  }
}

function requireFieldReadWriteDenied(errors, entityName, fieldPath, property) {
  requireExactValue(
    errors,
    `entities.${entityName}.properties.${fieldPath}.rls`,
    property?.rls,
    { read: false, write: false },
    "Answer-bearing field must have exact field-level read/write denial.",
  );
}

function isDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value).every((child) => isDeepFrozen(child, seen));
}

function validateTenantArchitectureSemantics(schemas, errors) {
  requireExactValue(
    errors,
    "tenant_architecture.scoped_content_roots",
    SCOPED_CONTENT_ROOTS,
    CONTENT_SCOPE_ROOT_ENTITY_NAMES,
    "Hybrid content roots must exactly match the reviewed source direction.",
  );
  requireExactValue(
    errors,
    "tenant_architecture.inherited_content_scope",
    INHERITED_CONTENT_SCOPE,
    CONTENT_SCOPE_CHILDREN,
    "Content children must inherit only from their exact reviewed parent field.",
  );
  requireExactValue(
    errors,
    "tenant_architecture.readiness_target",
    READINESS_FIXTURE_TARGET,
    {
      environment: LIVE_READINESS_STAGING_TARGET.environment,
      appId: LIVE_READINESS_STAGING_TARGET.app_id,
      origin: LIVE_READINESS_STAGING_TARGET.origin,
      fixtureSetId: LIVE_READINESS_FIXTURE_SET_ID,
    },
    "Tenant architecture target must derive from the canonical fixture target.",
  );

  const expectedActors = Object.fromEntries(
    LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES.map((alias) => [alias, {
      agency: LIVE_READINESS_FIXTURE_ACTORS[alias].agency,
      tenantRole: LIVE_READINESS_FIXTURE_ACTORS[alias].tenant_role,
    }]),
  );
  const expectedPatients = Object.fromEntries(
    LIVE_READINESS_FIXTURE_PATIENT_ALIASES.map((alias) => [alias, {
      agency: LIVE_READINESS_FIXTURE_PATIENTS[alias].agency,
      creator: LIVE_READINESS_FIXTURE_PATIENTS[alias].creator,
      status: LIVE_READINESS_FIXTURE_PATIENTS[alias].status,
      isSample: LIVE_READINESS_FIXTURE_PATIENTS[alias].is_sample,
      isArchived: LIVE_READINESS_FIXTURE_PATIENTS[alias].is_archived,
    }]),
  );
  const expectedAssignments = LIVE_READINESS_FIXTURE_ASSIGNMENTS.map((assignment) => ({
    patient: assignment.patient,
    actor: assignment.actor,
    status: assignment.status,
    source: assignment.source,
  }));
  for (const [path, actual, expected, message] of [
    [
      "tenant_architecture.readiness_actor_aliases",
      READINESS_FIXTURE_TENANT_ACTOR_ALIASES,
      LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES,
      "Tenant actor aliases must have exact canonical fixture parity.",
    ],
    [
      "tenant_architecture.readiness_agency_aliases",
      READINESS_FIXTURE_AGENCY_ALIASES,
      LIVE_READINESS_FIXTURE_AGENCY_ALIASES,
      "Agency aliases must have exact canonical fixture parity.",
    ],
    [
      "tenant_architecture.readiness_patient_aliases",
      READINESS_FIXTURE_PATIENT_ALIASES,
      LIVE_READINESS_FIXTURE_PATIENT_ALIASES,
      "Patient aliases must have exact canonical fixture parity.",
    ],
    [
      "tenant_architecture.readiness_actors",
      READINESS_FIXTURE_ACTORS,
      expectedActors,
      "Actor authority projections must derive exactly from the canonical fixture.",
    ],
    [
      "tenant_architecture.readiness_patients",
      READINESS_FIXTURE_PATIENTS,
      expectedPatients,
      "Patient authority projections must derive exactly from the canonical fixture.",
    ],
    [
      "tenant_architecture.readiness_assignments",
      READINESS_FIXTURE_ASSIGNMENTS,
      expectedAssignments,
      "Assignment projections must derive exactly from the canonical fixture.",
    ],
    [
      "tenant_architecture.readiness_topology",
      READINESS_FIXTURE_TOPOLOGY,
      {
        tenantActorAliases: LIVE_READINESS_FIXTURE_TOPOLOGY.tenant_actor_aliases,
        agencyAliases: LIVE_READINESS_FIXTURE_TOPOLOGY.agency_aliases,
        patientAliases: LIVE_READINESS_FIXTURE_TOPOLOGY.patient_aliases,
        assignmentEdges: LIVE_READINESS_FIXTURE_TOPOLOGY.assignment_edges,
      },
      "Readiness topology must have exact canonical manifest parity.",
    ],
  ]) {
    requireExactValue(errors, path, actual, expected, message);
  }

  for (const [name, value] of Object.entries({
    fixture_topology: LIVE_READINESS_FIXTURE_TOPOLOGY,
    readiness_topology: READINESS_FIXTURE_TOPOLOGY,
    readiness_actors: READINESS_FIXTURE_ACTORS,
    readiness_patients: READINESS_FIXTURE_PATIENTS,
    readiness_assignments: READINESS_FIXTURE_ASSIGNMENTS,
  })) {
    if (!isDeepFrozen(value)) {
      addError(
        errors,
        `tenant_architecture.${name}`,
        "Canonical readiness topology and projections must be deeply frozen.",
      );
    }
  }

  const scopeBinding = schemas.ContentScopeBinding;
  if (scopeBinding) {
    requireExactRequiredFields(
      errors,
      scopeBinding,
      "ContentScopeBinding",
      REQUIRED_SCHEMA_FIELDS.ContentScopeBinding,
    );
    requireExactValue(
      errors,
      "entities.ContentScopeBinding.properties.entity_name.enum",
      scopeBinding.properties?.entity_name?.enum,
      CONTENT_SCOPE_ROOT_ENTITY_NAMES,
      "Content binding entity allowlist must exactly match the reviewed scope roots.",
    );
    requireExactValue(
      errors,
      "entities.ContentScopeBinding.properties.scope_type.enum",
      scopeBinding.properties?.scope_type?.enum,
      ["global", "agency"],
      "Content binding must support only global or one-agency scope.",
    );
    const scopeBindingPropertyContracts = {
      binding_key: { type: "string" },
      entity_name: { type: "string", enum: CONTENT_SCOPE_ROOT_ENTITY_NAMES },
      resource_id: { type: "string" },
      scope_type: { type: "string", enum: ["global", "agency"] },
      agency_id: { type: "string" },
      status: {
        type: "string",
        enum: ["active", "quarantined", "retired"],
        default: "quarantined",
      },
      created_by_user_id: { type: "string" },
      created_by_user_email_normalized: { type: "string", format: "email" },
      last_transition_by_user_id: { type: "string" },
      last_transition_at: { type: "string", format: "date-time" },
      last_transition_reason: { type: "string" },
      version: { type: "integer", minimum: 1, default: 1 },
    };
    requireExactPropertyContracts(
      errors,
      scopeBinding,
      "ContentScopeBinding",
      scopeBindingPropertyContracts,
    );
    if (scopeBinding.required?.includes("agency_id")) {
      addError(
        errors,
        "entities.ContentScopeBinding.properties.agency_id",
        "Agency id must be an optional string used only for agency-scoped bindings.",
      );
    }
    requireFailClosedEntity(errors, scopeBinding, "ContentScopeBinding");
  }

  for (const [childName, inheritance] of Object.entries(CONTENT_SCOPE_CHILDREN)) {
    if (schemas[childName]?.properties?.[inheritance.parentField]?.type !== "string") {
      addError(
        errors,
        `entities.${childName}.properties.${inheritance.parentField}`,
        "Inherited content scope requires the exact string parent id field.",
      );
    }
  }

  const physician = schemas.Physician;
  const physicianProfile = schemas.PhysicianAgencyProfile;
  if (physician && physicianProfile) {
    for (const field of PHYSICIAN_MASTER_FIELDS) {
      if (!isObject(physician.properties?.[field])) {
        addError(errors, `entities.Physician.properties.${field}`, "Physician master field is absent.");
      }
    }
    for (const field of PHYSICIAN_AGENCY_OVERLAY_FIELDS) {
      if (!isObject(physicianProfile.properties?.[field])) {
        addError(
          errors,
          `entities.PhysicianAgencyProfile.properties.${field}`,
          "Physician agency overlay field is absent.",
        );
      }
    }
    if (physicianProfile.properties?.is_active !== undefined) {
      addError(
        errors,
        "entities.PhysicianAgencyProfile.properties.is_active",
        "Legacy is_active must be translated to service-owned overlay status, not persisted.",
      );
    }
    requireExactRequiredFields(
      errors,
      physicianProfile,
      "PhysicianAgencyProfile",
      REQUIRED_SCHEMA_FIELDS.PhysicianAgencyProfile,
    );
    const physicianProfilePropertyContracts = {
      profile_key: { type: "string" },
      agency_id: { type: "string" },
      physician_id: { type: "string" },
      status: {
        type: "string",
        enum: ["active", "inactive", "quarantined"],
        default: "quarantined",
      },
      accepts_home_health: { type: "boolean" },
      accepts_hospice: { type: "boolean" },
      preferred_contact_method: {
        type: "string",
        enum: ["fax", "phone", "email", "portal"],
      },
      office_hours: { type: "string" },
      notes: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      last_referral_date: { type: "string", format: "date" },
      referral_count: { type: "integer", minimum: 0, default: 0 },
      created_by_user_id: { type: "string" },
      last_transition_by_user_id: { type: "string" },
      last_transition_at: { type: "string", format: "date-time" },
      version: { type: "integer", minimum: 1, default: 1 },
    };
    requireExactPropertyContracts(
      errors,
      physicianProfile,
      "PhysicianAgencyProfile",
      physicianProfilePropertyContracts,
    );
    requireFailClosedEntity(errors, physicianProfile, "PhysicianAgencyProfile");
  }

  const trainingModuleAnswer = schemas.TrainingModule?.properties?.content?.properties
    ?.quiz_questions?.items?.properties?.correct_answer;
  requireFieldReadWriteDenied(
    errors,
    "TrainingModule",
    "content.quiz_questions[].correct_answer",
    trainingModuleAnswer,
  );
  for (const field of ["pre_assessment_json", "brain_sparks_json"]) {
    requireFieldReadWriteDenied(
      errors,
      "TrainingCourse",
      field,
      schemas.TrainingCourse?.properties?.[field],
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
    requireClientWritesDenied(
      errors,
      schemas.Patient,
      "Patient",
      ["create", "read", "update", "delete"],
    );
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
    requireEnumValue(errors, schemas.Referral, "Referral", "priority", "normal");
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
  if (schemas.Visit) {
    requireEnumValue(errors, schemas.Visit, "Visit", "status", "completed");
    requireEnumValue(errors, schemas.Visit, "Visit", "visit_type", "skilled_nursing");
    requireEnumValue(errors, schemas.Visit, "Visit", "documentation_source", "smart_note");
    requireClientWritesDenied(
      errors,
      schemas.Visit,
      "Visit",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.OASISAssessment) {
    requireEnumValue(errors, schemas.OASISAssessment, "OASISAssessment", "status", "in_progress");
    requireClientWritesDenied(
      errors,
      schemas.OASISAssessment,
      "OASISAssessment",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.Document) {
    requireEnumValue(errors, schemas.Document, "Document", "category", "other");
    requireClientWritesDenied(
      errors,
      schemas.Document,
      "Document",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.DocumentTenantBinding) {
    requireEnumValue(
      errors,
      schemas.DocumentTenantBinding,
      "DocumentTenantBinding",
      "purpose",
      "patient_document",
    );
    requireEnumValue(
      errors,
      schemas.DocumentTenantBinding,
      "DocumentTenantBinding",
      "storage_mode",
      "private",
    );
    requireClientWritesDenied(
      errors,
      schemas.DocumentTenantBinding,
      "DocumentTenantBinding",
      ["create", "read", "update", "delete"],
    );
  }
  if (schemas.TrainingCompletion) {
    requireEnumValue(errors, schemas.TrainingCompletion, "TrainingCompletion", "status", "completed");
    requireClientWritesDenied(
      errors,
      schemas.TrainingCompletion,
      "TrainingCompletion",
      ["create", "update", "delete"],
    );
  }
  for (const entityName of [
    "TrainingAttempt",
    "TrainingCertificate",
    "TrainingAssignment",
    "TrainingCourse",
  ]) {
    if (schemas[entityName]) {
      requireNonAdminWritesDenied(
        errors,
        schemas[entityName],
        entityName,
        ["create", "update", "delete"],
      );
    }
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
  validateTenantArchitectureSemantics(schemas, errors);
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
  Object.freeze({ source: "base44.auth.me()", count: 3 }),
  Object.freeze({ source: "const entities = base44.asServiceRole.entities;", count: 1 }),
]);
const REVIEWED_PREFLIGHT_ENTITY_FRAGMENTS = Object.freeze([
  Object.freeze({ source: "entities: Record<string, any>", count: 4 }),
  Object.freeze({ source: "await entities.User.filter(", count: 2 }),
  Object.freeze({ source: "await entities.Agency.filter(", count: 1 }),
  Object.freeze({ source: "await entities.StagingReadinessFixture.filter(", count: 1 }),
  Object.freeze({ source: "entities.AgencyMembership,", count: 2 }),
  Object.freeze({ source: "entities.Patient,", count: 1 }),
  Object.freeze({ source: "entities.PatientCareTeamAssignment,", count: 1 }),
  Object.freeze({ source: "loadExactActor(entities, binding)", count: 1 }),
  Object.freeze({ source: "loadFixtureRegistry(entities)", count: 1 }),
  Object.freeze({ source: "entities,\n      AGENCY_CODES[agencyKey]", count: 1 }),
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
  if (typeof source !== "string") return false;
  const actorKeys = LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES
    .map((key) => `'${key}'`)
    .join(", ");
  const agencyKeys = LIVE_READINESS_FIXTURE_AGENCY_ALIASES
    .map((key) => `'${key}'`)
    .join(", ");
  const agencyCodesPresent = LIVE_READINESS_FIXTURE_AGENCY_ALIASES.every((key) => (
    source.includes(`${key}: '${LIVE_READINESS_FIXTURE_AGENCIES[key].agency_code}'`)
  ));
  const finalInspectionIndex = source.indexOf("const finalSnapshot = await inspectPreflight");
  const terminalAuthIndex = source.indexOf("const terminalCaller = await base44.auth.me()");
  const terminalTargetIndex = source.indexOf("requireRuntimeTarget(req);", terminalAuthIndex);
  const terminalOwnerIndex = source.indexOf("loadProtectedOwner(terminalCaller, owner);");
  const disclosureIndex = source.indexOf("return jsonResponse(publicResult(finalSnapshot));");
  const terminalAuthorityOrdered = finalInspectionIndex >= 0
    && finalInspectionIndex < terminalAuthIndex
    && terminalAuthIndex < terminalTargetIndex
    && terminalTargetIndex < terminalOwnerIndex
    && terminalOwnerIndex < disclosureIndex;
  return source.includes(`const FIXTURE_SET_ID = '${LIVE_READINESS_FIXTURE_SET_ID}';`)
    && source.includes(`const STAGING_APP_ID = '${LIVE_READINESS_STAGING_TARGET.app_id}';`)
    && source.includes(`const STAGING_ORIGIN = '${LIVE_READINESS_STAGING_TARGET.origin}';`)
    && source.includes(`const ACTOR_KEYS = [${actorKeys}] as const;`)
    && source.includes(`const AGENCY_KEYS = [${agencyKeys}] as const;`)
    && agencyCodesPresent
    && source.includes("STAGING_READINESS_PREFLIGHT_RELEASE")
    && source.includes("createPinnedSdkRequest")
    && source.includes("X-Data-Env")
    && source.includes("StagingReadinessFixture.filter")
    && source.includes("Agency.filter")
    && source.includes("point_in_time_read_only_preflight_passed")
    && source.includes("point_in_time_clear")
    && source.includes("data_mutations_performed: false")
    && terminalAuthorityOrdered
    && preflightUsesOnlyReviewedCapabilities(source)
    && !PREFLIGHT_MUTATION_CALL.test(source)
    && !/\bfetch\s*\(|\bWebSocket\b|\bEventSource\b|\bXMLHttpRequest\b|\bimport\s*\(|\bDeno\.(?:connect|connectTls|open|writeFile|writeTextFile|remove|rename)\b/.test(source);
}

function validateCanonicalBrokerEnums(artifacts, errors) {
  requireBrokerSetValue(
    errors,
    artifacts,
    "base44/functions/manageAuthorizedReferral/entry.ts",
    "REFERRAL_PRIORITIES",
    "normal",
  );
  requireBrokerSetValue(
    errors,
    artifacts,
    "base44/functions/manageAuthorizedReferral/entry.ts",
    "DOCUMENT_TYPES",
    "manual",
  );
  requireBrokerSetValue(
    errors,
    artifacts,
    "base44/functions/createAuthorizedVisit/entry.ts",
    "VISIT_TYPES",
    "skilled_nursing",
  );
}

function validateMarkerMap(artifacts, errors, markerMap, message) {
  for (const [path, markers] of Object.entries(markerMap)) {
    const source = artifacts[path];
    for (const marker of markers) {
      if (!source.includes(marker)) {
        addError(errors, path, message);
      }
    }
  }
}

function validateAuthConfiguration(artifacts, errors) {
  const path = "base44/auth/config.jsonc";
  const config = parseJsoncArtifact(artifacts[path], "auth.config", errors);
  if (config && config.enableUsernamePassword !== true) {
    addError(
      errors,
      "auth.config.enableUsernamePassword",
      "Mandatory LR-02 login probes require username/password auth to remain enabled in source.",
    );
  }
}

function validateSourceMarkers(artifacts, errors) {
  validateMarkerMap(
    artifacts,
    errors,
    BROKER_MARKERS,
    "Required reviewed-broker source marker is absent.",
  );
  validateMarkerMap(
    artifacts,
    errors,
    AUTH_SOURCE_MARKERS,
    "Required authentication source marker is absent.",
  );
  validateMarkerMap(
    artifacts,
    errors,
    SMART_NOTE_SOURCE_MARKERS,
    "Required Smart Note persistence source marker is absent.",
  );
  validateMarkerMap(
    artifacts,
    errors,
    FIXTURE_ASSEMBLY_SOURCE_MARKERS,
    "Required plan-only fixture request assembler source marker is absent.",
  );
  validateMarkerMap(
    artifacts,
    errors,
    TENANT_ARCHITECTURE_SOURCE_MARKERS,
    "Required tenant-architecture source marker is absent.",
  );
  for (const path of CONTRACT_TEST_PATHS) {
    const source = artifacts[path];
    const testFrameworkPresent = source.includes("node:test") || source.includes("vitest");
    const assertionPresent = source.includes("assert") || source.includes("expect");
    if (!testFrameworkPresent || !assertionPresent) {
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

function parseJsoncForCheck(value) {
  try {
    return JSON5.parse(value);
  } catch {
    return null;
  }
}

function operationDeniesNonAdmin(rule) {
  return rule === false || rule?.user_condition?.role === "admin";
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

  for (const path of RUNTIME_IMPORTED_SEMANTIC_ARTIFACT_PATHS) {
    if (artifacts[path] !== RUNTIME_IMPORTED_SEMANTIC_ARTIFACT_SNAPSHOTS[path]) {
      addError(
        errors,
        `runtime_import_artifact_parity.${path}`,
        "Runtime-imported semantic source must match the exact validated artifact bytes.",
      );
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
    validateCanonicalBrokerEnums(artifacts, errors);
    validateAuthConfiguration(artifacts, errors);
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
  const schemasForChecks = Object.fromEntries(
    Object.entries(ENTITY_PATHS).map(([name, path]) => [
      name,
      parseJsoncForCheck(artifacts[path] || ""),
    ]),
  );
  const clinicalPhiEntityNames = [
    "Patient",
    "PatientCareTeamAssignment",
    "Referral",
    "IncomingFax",
    ...CLINICAL_CHILD_ENTITY_NAMES,
  ];
  const clinicalPhiDirectReadsDenied = clinicalPhiEntityNames
    .every((name) => schemasForChecks[name]?.rls?.read === false);
  const clinicalPhiDirectWritesDenied = clinicalPhiEntityNames.every((name) => (
    ["create", "update", "delete"]
      .every((operation) => schemasForChecks[name]?.rls?.[operation] === false)
  ));
  const trainingCompletionDirectWritesLocked = ["create", "update", "delete"]
    .every((operation) => schemasForChecks.TrainingCompletion?.rls?.[operation] === false);
  const trainingEvidenceNonAdminWritesDenied = [
    "TrainingAttempt",
    "TrainingCertificate",
    "TrainingAssignment",
    "TrainingCourse",
  ].every((name) => ["create", "update", "delete"].every(
    (operation) => operationDeniesNonAdmin(schemasForChecks[name]?.rls?.[operation]),
  ));
  const architectureAuthorityEntitiesFailClosed = [
    "ContentScopeBinding",
    "PhysicianAgencyProfile",
    "StagingReadinessFixture",
  ].every((name) => ["create", "read", "update", "delete"].every(
    (operation) => schemasForChecks[name]?.rls?.[operation] === false,
  ));
  const contentScopeSchemaShapeExact = !errors.some((error) => (
    error.path === "entities.ContentScopeBinding.required"
    || error.path === "entities.ContentScopeBinding.properties"
    || error.path === "entities.ContentScopeBinding.additionalProperties"
    || error.path.startsWith("entities.ContentScopeBinding.properties.")
  ));
  const contentScopeSemanticsExact = contentScopeSchemaShapeExact
    && canonicalJson(schemasForChecks.ContentScopeBinding?.properties?.entity_name?.enum)
      === canonicalJson(CONTENT_SCOPE_ROOT_ENTITY_NAMES)
    && canonicalJson(schemasForChecks.ContentScopeBinding?.properties?.scope_type?.enum)
      === canonicalJson(["global", "agency"])
    && canonicalJson(SCOPED_CONTENT_ROOTS) === canonicalJson(CONTENT_SCOPE_ROOT_ENTITY_NAMES)
    && canonicalJson(INHERITED_CONTENT_SCOPE) === canonicalJson(CONTENT_SCOPE_CHILDREN);
  const trainingAnswerFieldsDenied =
    canonicalJson(
      schemasForChecks.TrainingModule?.properties?.content?.properties
        ?.quiz_questions?.items?.properties?.correct_answer?.rls,
    ) === canonicalJson({ read: false, write: false })
    && ["pre_assessment_json", "brain_sparks_json"].every((field) => (
      canonicalJson(schemasForChecks.TrainingCourse?.properties?.[field]?.rls)
        === canonicalJson({ read: false, write: false })
    ));
  const runtimeImportArtifactParity = RUNTIME_IMPORTED_SEMANTIC_ARTIFACT_PATHS
    .every((path) => (
      typeof artifacts[path] === "string"
      && artifacts[path] === RUNTIME_IMPORTED_SEMANTIC_ARTIFACT_SNAPSHOTS[path]
    ));
  const readinessTopologyParity = !hasErrorFor("tenant_architecture.")
    && runtimeImportArtifactParity;
  const tenantArchitectureSourceMarkers = !Object.keys(TENANT_ARCHITECTURE_SOURCE_MARKERS)
    .some((path) => hasErrorFor(path));
  const sourceArtifactUnionComplete = SOURCE_ARTIFACT_GROUPS.every((group) => (
    group.every((path) => LIVE_READINESS_SOURCE_ARTIFACT_PATHS.includes(path))
  ));
  const sourceLimitations = [
    ...SOURCE_LIMITATIONS,
    ...(assignmentMutationsPaused
      ? ["canonical_assignment_cannot_be_provisioned_while_assignment_mutations_are_paused"]
      : []),
    ...(visitCreateUsesLegacyAssignment
      ? ["lr02_s4_visit_create_contract_retains_legacy_patient_assignment_fields"]
      : []),
    ...(!trainingCompletionDirectWritesLocked
      ? ["lr01_v5_training_completion_direct_mutations_not_locked"]
      : []),
    ...(!trainingEvidenceNonAdminWritesDenied
      ? ["lr01_v5_training_evidence_non_admin_mutations_not_denied"]
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
      clinical_child_schema_semantics: !CLINICAL_CHILD_ENTITY_NAMES
        .some((name) => hasErrorFor(`entities.${name}`)),
      training_forge_guard_schema_semantics: !TRAINING_FORGE_GUARD_ENTITY_NAMES
        .some((name) => hasErrorFor(`entities.${name}`)),
      reviewed_broker_source_markers: !Object.keys(BROKER_MARKERS)
        .some((path) => hasErrorFor(path)),
      clinical_child_broker_source_markers: !CLINICAL_CHILD_BROKER_PATHS
        .some((path) => hasErrorFor(path)),
      training_forge_guard_source_markers: !TRAINING_FORGE_GUARD_PATHS
        .some((path) => hasErrorFor(path)),
      authentication_source_semantics: !hasErrorFor("auth.config")
        && !Object.keys(AUTH_SOURCE_MARKERS).some((path) => hasErrorFor(path)),
      smart_note_persistence_source_markers: !Object.keys(SMART_NOTE_SOURCE_MARKERS)
        .some((path) => hasErrorFor(path)),
      fixture_request_assembler_source_markers: !Object.keys(FIXTURE_ASSEMBLY_SOURCE_MARKERS)
        .some((path) => hasErrorFor(path)),
      tenant_architecture_source_markers: tenantArchitectureSourceMarkers,
      runtime_import_artifact_parity: runtimeImportArtifactParity,
      readiness_topology_parity: readinessTopologyParity,
      source_artifact_union_complete: sourceArtifactUnionComplete,
      local_contract_test_sources: !CONTRACT_TEST_PATHS
        .some((path) => hasErrorFor(path)),
      mandatory_probe_source_artifacts_recorded: MANDATORY_PROBE_SOURCE_PATHS
        .every((path) => typeof artifacts[path] === "string"),
      content_schema_artifacts_recorded: CONTENT_SCOPE_ENTITY_NAMES
        .every((name) => typeof artifacts[ENTITY_PATHS[name]] === "string"),
      architecture_schema_artifacts_recorded: [
        "ContentScopeBinding", "Physician", "PhysicianAgencyProfile", "StagingReadinessFixture",
      ].every((name) => typeof artifacts[ENTITY_PATHS[name]] === "string"),
      source_release_gates_recorded: SOURCE_RELEASE_GATE_PATHS
        .every((path) => typeof artifacts[path] === "string"),
      care_team_assignment_mutations_paused: assignmentMutationsPaused,
      staging_readiness_read_only_preflight_present: stagingReadinessPreflightPresent,
      referral_direct_mutation_path_present: referralDirectOperationPathPresent,
      referral_immutable_tenant_broker_present: referralImmutableTenantBrokerPresent,
      referral_inbound_fax_paths_secured: referralInboundFaxPathsSecured,
      visit_create_uses_legacy_assignment: visitCreateUsesLegacyAssignment,
      clinical_phi_direct_reads_denied: clinicalPhiDirectReadsDenied,
      clinical_phi_direct_writes_denied: clinicalPhiDirectWritesDenied,
      training_completion_direct_writes_locked: trainingCompletionDirectWritesLocked,
      training_evidence_non_admin_writes_denied: trainingEvidenceNonAdminWritesDenied,
      architecture_authority_entities_fail_closed: architectureAuthorityEntitiesFailClosed,
      content_scope_semantics_exact: contentScopeSemanticsExact,
      content_scope_runtime_enforcement_present: false,
      training_answer_fields_denied: trainingAnswerFieldsDenied,
      sanitized_training_learner_projection_present: false,
      network_access: false,
      hosted_writes: false,
      authenticated_hosted_probes_executed: false,
    },
    source_limitations: sourceLimitations,
    errors,
  };
}
