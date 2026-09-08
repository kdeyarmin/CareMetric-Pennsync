import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSON5 from "json5";
import {
  LIVE_READINESS_FIXTURE_ACTOR_ALIASES,
  LIVE_READINESS_FIXTURE_AGENCY_ALIASES,
  LIVE_READINESS_FIXTURE_ENTITY_FIELDS,
  LIVE_READINESS_FIXTURE_PATIENT_ALIASES,
  LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES,
  LIVE_READINESS_FIXTURE_TOPOLOGY,
  assembleLiveReadinessFixtureRequests,
  createLiveReadinessFixturePlan,
  formatLiveReadinessFixtureErrors,
  validateLiveReadinessFixtureManifest,
} from "./liveReadinessFixtureManifest.js";

const templateUrl = new URL("../../docs/audits/live-readiness-fixture-manifest.template.json", import.meta.url);
const gitignoreUrl = new URL("../../.gitignore", import.meta.url);

function template() {
  return JSON.parse(readFileSync(templateUrl, "utf8"));
}

function runtimeResolution() {
  return {
    agency_ids: {
      agency_a: "agency-id-a",
      agency_b: "agency-id-b",
    },
    actor_users: {
      admin_a: { user_id: "user-admin-a", email: "admin-a@readiness.invalid" },
      clinician_a: { user_id: "user-clinician-a", email: "clinician-a@readiness.invalid" },
      clinician_a_empty: {
        user_id: "user-clinician-a-empty",
        email: "clinician-a-empty@readiness.invalid",
      },
      admin_b: { user_id: "user-admin-b", email: "admin-b@readiness.invalid" },
    },
    patient_ids: {
      a1: "patient-id-a1",
      a2: "patient-id-a2",
      b1: "patient-id-b1",
    },
    provisioned_membership_versions: {
      admin_a: 7,
      clinician_a: 1,
      clinician_a_empty: 1,
      admin_b: 1,
    },
  };
}

test("canonical readiness aliases and topology are deeply frozen", () => {
  assert.deepEqual(LIVE_READINESS_FIXTURE_ACTOR_ALIASES, [
    "platform_owner", "admin_a", "clinician_a", "clinician_a_empty", "admin_b",
  ]);
  assert.deepEqual(LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES, [
    "admin_a", "clinician_a", "clinician_a_empty", "admin_b",
  ]);
  assert.deepEqual(LIVE_READINESS_FIXTURE_AGENCY_ALIASES, ["agency_a", "agency_b"]);
  assert.deepEqual(LIVE_READINESS_FIXTURE_PATIENT_ALIASES, ["a1", "a2", "b1"]);
  assert.deepEqual(LIVE_READINESS_FIXTURE_TOPOLOGY.assignment_edges, [
    { patient: "a1", actor: "clinician_a" },
  ]);
  for (const value of [
    LIVE_READINESS_FIXTURE_ACTOR_ALIASES,
    LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES,
    LIVE_READINESS_FIXTURE_AGENCY_ALIASES,
    LIVE_READINESS_FIXTURE_PATIENT_ALIASES,
    LIVE_READINESS_FIXTURE_TOPOLOGY,
    ...Object.values(LIVE_READINESS_FIXTURE_TOPOLOGY),
  ]) assert.equal(Object.isFrozen(value), true);
});

test("canonical two-agency fixture template is a local no-write plan", () => {
  const input = template();
  assert.deepEqual(validateLiveReadinessFixtureManifest(input), []);

  const plan = createLiveReadinessFixturePlan(input);
  assert.equal(plan.status, "valid_fixture_plan");
  assert.equal(
    plan.readiness_status,
    "blocked_until_authenticated_hosted_evidence_and_reviews_exist",
  );
  assert.deepEqual(plan.counts, {
    actors: 5,
    tenant_actors: 4,
    agencies: 2,
    memberships: 4,
    patients: 3,
    care_team_assignments: 1,
    workflow_requests: 2,
    planned_mutating_actions: 16,
  });
  assert.deepEqual(plan.expected_patient_access, {
    platform_owner: "excluded_from_tenant_assertions",
    admin_a: ["a1", "a2"],
    clinician_a: ["a1"],
    clinician_a_empty: [],
    admin_b: ["b1"],
  });
  assert.equal(plan.safeguards.network_access, false);
  assert.equal(plan.safeguards.hosted_writes, false);
  assert.equal(plan.safeguards.credentials_present, false);
  assert.equal(plan.safeguards.real_phi_values_present, false);
  assert.equal(plan.safeguards.reviewed_synthetic_identity_values_present, true);
  assert.equal(plan.safeguards.plan_only_inputs_are_hosted_evidence, false);
  assert.equal(input.agencies.agency_a.agency_name, "Synthetic Readiness Agency A");
  assert.equal(input.patients.a1.client_request_id, "lr-fixture-patient-a1-v1");
  assert.equal(input.workflow_requests.referral_a1_create.probe, "S3");
  assert.equal(input.workflow_requests.smart_note_a1_visit_create.probe, "S4");
});

test("private readiness evidence remains outside version control", () => {
  const gitignore = readFileSync(gitignoreUrl, "utf8");
  assert.match(gitignore, /^\/tmp\/$/m);
});

test("production and unreviewed targets are rejected", () => {
  const productionId = template();
  productionId.target.app_id = "694ec16e72e01b60d22f7cbf";
  let errors = validateLiveReadinessFixtureManifest(productionId);
  assert.ok(errors.some((error) => error.path === "target.app_id" && /Production/.test(error.message)));

  const productionOrigin = template();
  productionOrigin.target.origin = "https://caremetricai.base44.app/";
  errors = validateLiveReadinessFixtureManifest(productionOrigin);
  assert.ok(errors.some((error) => error.path === "target.origin" && /Production/.test(error.message)));

  const otherStaging = template();
  otherStaging.target.app_id = "some-other-app";
  errors = validateLiveReadinessFixtureManifest(otherStaging);
  assert.ok(errors.some((error) => error.path === "target.app_id" && /reviewed isolated staging/.test(error.message)));
});

test("authority topology cannot be weakened or padded with extra rows", () => {
  const renamedFixture = template();
  renamedFixture.fixture_set_id = "lr01-lr02-unreviewed-v2";
  assert.ok(validateLiveReadinessFixtureManifest(renamedFixture).some((error) => error.path === "fixture_set_id"));

  const tenantAdmin = template();
  tenantAdmin.actors.admin_a.built_in_role = "admin";
  assert.ok(validateLiveReadinessFixtureManifest(tenantAdmin).some((error) => error.path === "actors.admin_a.built_in_role"));

  const ownerMembership = template();
  ownerMembership.actors.platform_owner.agency = "agency_a";
  ownerMembership.actors.platform_owner.tenant_role = "agency_admin";
  assert.ok(validateLiveReadinessFixtureManifest(ownerMembership).some((error) => error.path === "actors.platform_owner.agency"));

  const emptyAssigned = template();
  emptyAssigned.assignments.push({
    patient: "a2",
    actor: "clinician_a_empty",
    status: "active",
    source: "manual",
  });
  assert.ok(validateLiveReadinessFixtureManifest(emptyAssigned).some((error) => error.path === "assignments"));

  const wrongCreator = template();
  wrongCreator.patients.a1.creator = "clinician_a";
  assert.ok(validateLiveReadinessFixtureManifest(wrongCreator).some((error) => error.path === "patients.a1.creator"));
});

test("synthetic seed and S3/S4 request inputs are exact and remain plan-only", () => {
  const changedPatient = template();
  changedPatient.patients.a1.first_name = "Real-looking replacement";
  assert.ok(validateLiveReadinessFixtureManifest(changedPatient).some((error) => (
    error.path === "patients.a1.first_name"
  )));

  const changedReferral = template();
  changedReferral.workflow_requests.referral_a1_create.input.patient_name = "Replacement";
  assert.ok(validateLiveReadinessFixtureManifest(changedReferral).some((error) => (
    error.path === "workflow_requests.referral_a1_create.input"
  )));

  const changedVisit = template();
  changedVisit.workflow_requests.smart_note_a1_visit_create.input.nurse_notes = "Replacement";
  assert.ok(validateLiveReadinessFixtureManifest(changedVisit).some((error) => (
    error.path === "workflow_requests.smart_note_a1_visit_create.input"
  )));

  const executable = template();
  executable.mode = "execute";
  assert.ok(validateLiveReadinessFixtureManifest(executable).some((error) => (
    error.path === "mode"
  )));
});

test("pure request assembler materializes exact broker bodies without executing them", () => {
  const assembled = assembleLiveReadinessFixtureRequests(template(), runtimeResolution());
  assert.equal(assembled.mode, "plan_only_no_writes");
  assert.equal(assembled.network_access, false);
  assert.equal(assembled.hosted_writes, false);
  assert.deepEqual(Object.keys(assembled), [
    "mode",
    "network_access",
    "hosted_writes",
    "agency_creates",
    "membership_actions",
    "patient_creates",
    "assignment_actions",
    "workflow_requests",
  ]);

  assert.deepEqual(assembled.agency_creates, [
    {
      alias: "agency_a_create",
      caller: "platform_owner",
      resource: "Agency",
      operation: "create",
      body: {
        agency_name: "Synthetic Readiness Agency A",
        agency_code: "LR-A",
        status: "active",
      },
    },
    {
      alias: "agency_b_create",
      caller: "platform_owner",
      resource: "Agency",
      operation: "create",
      body: {
        agency_name: "Synthetic Readiness Agency B",
        agency_code: "LR-B",
        status: "active",
      },
    },
  ]);

  const expectedMemberships = [
    ["admin_a", "agency-id-a", "user-admin-a", "admin-a@readiness.invalid", "agency_admin", 7],
    ["clinician_a", "agency-id-a", "user-clinician-a", "clinician-a@readiness.invalid", "clinician", 1],
    [
      "clinician_a_empty",
      "agency-id-a",
      "user-clinician-a-empty",
      "clinician-a-empty@readiness.invalid",
      "clinician",
      1,
    ],
    ["admin_b", "agency-id-b", "user-admin-b", "admin-b@readiness.invalid", "agency_admin", 1],
  ];
  assert.deepEqual(assembled.membership_actions, expectedMemberships.flatMap(([
    actor,
    agencyId,
    userId,
    email,
    tenantRole,
    version,
  ]) => [
    {
      alias: `${actor}_membership_provision`,
      caller: "platform_owner",
      broker: "manageAgencyMembership",
      body: {
        action: "provision",
        agency_id: agencyId,
        target_user_id: userId,
        target_user_email: email,
        reason: "Create synthetic LR fixture membership",
        tenant_role: tenantRole,
      },
    },
    {
      alias: `${actor}_membership_activate`,
      caller: "platform_owner",
      broker: "manageAgencyMembership",
      body: {
        action: "activate",
        agency_id: agencyId,
        target_user_id: userId,
        target_user_email: email,
        expected_version: version,
        reason: "Activate synthetic LR fixture membership",
      },
    },
  ]));

  const expectedPatients = [
    ["a1", "admin_a", "agency-id-a", "lr-fixture-patient-a1-v1", "Agency-A-One"],
    ["a2", "admin_a", "agency-id-a", "lr-fixture-patient-a2-v1", "Agency-A-Two"],
    ["b1", "admin_b", "agency-id-b", "lr-fixture-patient-b1-v1", "Agency-B-One"],
  ];
  assert.deepEqual(assembled.patient_creates, expectedPatients.map(([
    alias,
    caller,
    agencyId,
    clientRequestId,
    lastName,
  ]) => ({
    alias: `${alias}_create`,
    caller,
    broker: "createAuthorizedPatient",
    body: {
      agency_id: agencyId,
      client_request_id: clientRequestId,
      first_name: "Synthetic",
      last_name: lastName,
      status: "active",
    },
    expected: {
      status: "active",
      is_sample: false,
      is_archived: false,
    },
  })));

  assert.deepEqual(assembled.assignment_actions, [{
    alias: "a1_clinician_a_assignment_grant",
    caller: "admin_a",
    broker: "managePatientCareTeamAssignment",
    body: {
      action: "grant",
      agency_id: "agency-id-a",
      patient_id: "patient-id-a1",
      target_user_id: "user-clinician-a",
      client_request_id: "lr-fixture-assignment-a1-clinician-a-v1",
      reason: "Grant synthetic LR direct-care assignment",
    },
    expected: {
      status: "active",
      source: "manual",
    },
  }]);

  assert.deepEqual(assembled.workflow_requests, [
    {
      alias: "referral_a1_create",
      capability: "LR-02",
      probe: "S3",
      caller: "admin_a",
      broker: "manageAuthorizedReferral",
      body: {
        action: "create",
        agency_id: "agency-id-a",
        client_request_id: "lr02-s3-referral-a1-v1",
        referral: {
          patient_name: "Synthetic Agency A One",
          status: "new",
          priority: "normal",
          document_type: "manual",
          patient_id: "patient-id-a1",
        },
      },
    },
    {
      alias: "smart_note_a1_visit_create",
      capability: "LR-02",
      probe: "S4",
      caller: "clinician_a",
      broker: "createAuthorizedVisit",
      body: {
        visit_date: "2026-09-07",
        visit_type: "skilled_nursing",
        status: "completed",
        nurse_notes: "Synthetic readiness note; no real patient information.",
        raw_transcription: "Synthetic readiness observation only.",
        compliance_score: 100,
        compliance_issues: [],
        homebound_status_verified: true,
        skilled_intervention_documented: true,
        documentation_source: "smart_note",
        grounding_pending: false,
        patient_id: "patient-id-a1",
        agency_id: "agency-id-a",
        client_request_id: "lr02-s4-smart-note-a1-v1",
      },
    },
  ]);
  assert.equal(JSON.stringify(assembled).includes("password"), false);
  assert.equal(JSON.stringify(assembled).includes("access_token"), false);
});

test("request assembler rejects incomplete runtime resolution without echoing it", () => {
  const resolution = runtimeResolution();
  resolution.actor_users.admin_a.email = "private-value-without-an-at-sign";
  assert.throws(
    () => assembleLiveReadinessFixtureRequests(template(), resolution),
    (error) => error.message === "Invalid fixture runtime resolution."
      && !error.message.includes("private-value"),
  );
});

test("manifest rejects direct credentials and PHI-shaped seed payloads without echoing values", () => {
  const input = template();
  input.actors.admin_a.password = "never-print-this-value";
  input.patients.a1.date_of_birth = "1900-01-01";
  const errors = validateLiveReadinessFixtureManifest(input);
  assert.ok(errors.some((error) => error.path === "$.actors.admin_a"));
  assert.ok(errors.some((error) => error.path === "$.patients.a1"));
  assert.equal(formatLiveReadinessFixtureErrors(errors).includes("never-print-this-value"), false);
  assert.equal(formatLiveReadinessFixtureErrors(errors).includes("1900-01-01"), false);
});

test("manifest never echoes an unsupported alias or field name", () => {
  const input = template();
  const untrustedAlias = "patient-jane-doe-secret";
  input.actors[untrustedAlias] = { password: "never-print" };
  const errors = validateLiveReadinessFixtureManifest(input);
  const formatted = formatLiveReadinessFixtureErrors(errors);
  assert.equal(formatted.includes(untrustedAlias), false);
  assert.equal(formatted.includes("password"), false);
  assert.ok(errors.some((error) => error.path === "actors" || error.path === "$.actors"));
});

test("canonical plan fields remain declared by the Base44 entity schemas", () => {
  for (const [entityName, fields] of Object.entries(LIVE_READINESS_FIXTURE_ENTITY_FIELDS)) {
    const schemaUrl = new URL(`../../base44/entities/${entityName}.jsonc`, import.meta.url);
    const schema = JSON5.parse(readFileSync(schemaUrl, "utf8"));
    for (const field of fields) {
      assert.ok(schema.properties[field], `${entityName}.${field} must remain declared`);
    }
  }
});
