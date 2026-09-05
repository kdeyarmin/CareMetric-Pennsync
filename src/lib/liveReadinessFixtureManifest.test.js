import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import JSON5 from "json5";
import {
  LIVE_READINESS_FIXTURE_ENTITY_FIELDS,
  createLiveReadinessFixturePlan,
  formatLiveReadinessFixtureErrors,
  validateLiveReadinessFixtureManifest,
} from "./liveReadinessFixtureManifest.js";

const templateUrl = new URL("../../docs/audits/live-readiness-fixture-manifest.template.json", import.meta.url);
const gitignoreUrl = new URL("../../.gitignore", import.meta.url);

function template() {
  return JSON.parse(readFileSync(templateUrl, "utf8"));
}

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
