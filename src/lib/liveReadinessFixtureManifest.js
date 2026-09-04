export const LIVE_READINESS_FIXTURE_SCHEMA_VERSION = 1;
export const LIVE_READINESS_FIXTURE_SET_ID = "lr01-lr02-two-agency-v1";

export const LIVE_READINESS_STAGING_TARGET = Object.freeze({
  environment: "staging",
  app_id: "6a9881683dc68a0bd54f1ef7",
  origin: "https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app/",
});

export const LIVE_READINESS_PRODUCTION_TARGETS = Object.freeze({
  app_ids: Object.freeze(["694ec16e72e01b60d22f7cbf"]),
  origins: Object.freeze([
    "https://caremetricai.base44.app/",
    "https://app.caremetricai.com/",
    "https://pennsync.com/",
  ]),
});

export const LIVE_READINESS_FIXTURE_ENTITY_FIELDS = Object.freeze({
  Agency: Object.freeze(["agency_name", "agency_code", "status"]),
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
    "activated_at",
    "version",
  ]),
  Patient: Object.freeze([
    "agency_id",
    "created_by_user_id",
    "created_by_user_email_normalized",
    "client_request_id",
    "patient_creation_key",
    "first_name",
    "last_name",
    "status",
    "is_sample",
    "is_archived",
  ]),
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

const TOP_LEVEL_KEYS = [
  "schema_version",
  "fixture_set_id",
  "mode",
  "data_policy",
  "target",
  "capabilities",
  "actors",
  "agencies",
  "patients",
  "assignments",
];
const TARGET_KEYS = ["environment", "app_id", "origin"];
const ACTOR_KEYS = ["email_env", "built_in_role", "agency", "tenant_role"];
const AGENCY_KEYS = ["status"];
const PATIENT_KEYS = ["agency", "creator", "status", "is_sample", "is_archived"];
const ASSIGNMENT_KEYS = ["patient", "actor", "status", "source"];

const CANONICAL_ACTORS = Object.freeze({
  platform_owner: Object.freeze({
    email_env: "SUPER_ADMIN_EMAIL",
    built_in_role: "admin",
    agency: null,
    tenant_role: null,
  }),
  admin_a: Object.freeze({
    email_env: "LR_ADMIN_A_EMAIL",
    built_in_role: "user",
    agency: "agency_a",
    tenant_role: "agency_admin",
  }),
  clinician_a: Object.freeze({
    email_env: "LR_CLINICIAN_A_EMAIL",
    built_in_role: "user",
    agency: "agency_a",
    tenant_role: "clinician",
  }),
  clinician_a_empty: Object.freeze({
    email_env: "LR_CLINICIAN_A_EMPTY_EMAIL",
    built_in_role: "user",
    agency: "agency_a",
    tenant_role: "clinician",
  }),
  admin_b: Object.freeze({
    email_env: "LR_ADMIN_B_EMAIL",
    built_in_role: "user",
    agency: "agency_b",
    tenant_role: "agency_admin",
  }),
});

const CANONICAL_AGENCIES = Object.freeze({
  agency_a: Object.freeze({ status: "active" }),
  agency_b: Object.freeze({ status: "active" }),
});

const CANONICAL_PATIENTS = Object.freeze({
  a1: Object.freeze({
    agency: "agency_a",
    creator: "admin_a",
    status: "active",
    is_sample: false,
    is_archived: false,
  }),
  a2: Object.freeze({
    agency: "agency_a",
    creator: "admin_a",
    status: "active",
    is_sample: false,
    is_archived: false,
  }),
  b1: Object.freeze({
    agency: "agency_b",
    creator: "admin_b",
    status: "active",
    is_sample: false,
    is_archived: false,
  }),
});

const CANONICAL_ASSIGNMENT = Object.freeze({
  patient: "a1",
  actor: "clinician_a",
  status: "active",
  source: "manual",
});

const SAFE_MANIFEST_PATH_KEYS = new Set([
  ...TOP_LEVEL_KEYS,
  ...TARGET_KEYS,
  ...ACTOR_KEYS,
  ...AGENCY_KEYS,
  ...PATIENT_KEYS,
  ...ASSIGNMENT_KEYS,
  ...Object.keys(CANONICAL_ACTORS),
  ...Object.keys(CANONICAL_AGENCIES),
  ...Object.keys(CANONICAL_PATIENTS),
]);

const SENSITIVE_MANIFEST_KEY = /(?:^|_)(?:password|passcode|token|secret|authorization|cookie|session|email|phone|address|date_of_birth|dob|ssn|medical_record_number|first_name|last_name)(?:_|$)/i;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExactKeys(errors, path, value, expectedKeys) {
  if (!isObject(value)) {
    addError(errors, path, "Must be an object.");
    return false;
  }
  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) addError(errors, `${path}.${key}`, "Required field is missing.");
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) addError(errors, path, "Contains an unsupported field.");
  }
  return true;
}

function findSensitiveKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSensitiveKeys(item, `${path}.${index}`, errors));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key !== "email_env" && SENSITIVE_MANIFEST_KEY.test(key)) {
      addError(errors, path, "Credential, direct identity, or PHI-shaped fields are forbidden in the committed fixture plan.");
    }
    const nestedPath = SAFE_MANIFEST_PATH_KEYS.has(key) ? `${path}.${key}` : path;
    findSensitiveKeys(nested, nestedPath, errors);
  }
}

function validateCanonicalMap(errors, path, value, expected, itemKeys) {
  if (!isObject(value)) {
    addError(errors, path, "Must be an object keyed by canonical alias.");
    return;
  }
  const expectedAliases = Object.keys(expected);
  const actualAliases = Object.keys(value);
  for (const alias of expectedAliases) {
    if (!Object.hasOwn(value, alias)) addError(errors, `${path}.${alias}`, "Canonical fixture alias is missing.");
  }
  for (const alias of actualAliases) {
    if (!Object.hasOwn(expected, alias)) addError(errors, path, "Contains an unexpected fixture alias.");
  }
  for (const alias of expectedAliases) {
    if (!Object.hasOwn(value, alias)) continue;
    if (!requireExactKeys(errors, `${path}.${alias}`, value[alias], itemKeys)) continue;
    for (const key of itemKeys) {
      if (!sameValue(value[alias][key], expected[alias][key])) {
        addError(errors, `${path}.${alias}.${key}`, "Value does not match the canonical two-agency fixture contract.");
      }
    }
  }
}

export function validateLiveReadinessFixtureManifest(input) {
  const errors = [];
  if (!isObject(input)) {
    addError(errors, "$", "Fixture manifest must be a JSON object.");
    return errors;
  }

  findSensitiveKeys(input, "$", errors);
  if (!requireExactKeys(errors, "$", input, TOP_LEVEL_KEYS)) return errors;

  if (input.schema_version !== LIVE_READINESS_FIXTURE_SCHEMA_VERSION) {
    addError(errors, "schema_version", "Unsupported fixture manifest schema version.");
  }
  if (input.fixture_set_id !== LIVE_READINESS_FIXTURE_SET_ID) {
    addError(errors, "fixture_set_id", "Must be the reviewed canonical two-agency fixture id.");
  }
  if (input.mode !== "plan_only_no_writes") {
    addError(errors, "mode", "The committed manifest must remain a no-write plan.");
  }
  if (input.data_policy !== "synthetic_non_phi") {
    addError(errors, "data_policy", "Only the synthetic_non_phi policy is accepted.");
  }

  if (requireExactKeys(errors, "target", input.target, TARGET_KEYS)) {
    if (LIVE_READINESS_PRODUCTION_TARGETS.app_ids.includes(input.target.app_id)) {
      addError(errors, "target.app_id", "Production application ids are forbidden.");
    } else if (input.target.app_id !== LIVE_READINESS_STAGING_TARGET.app_id) {
      addError(errors, "target.app_id", "Target must be the reviewed isolated staging application.");
    }
    if (LIVE_READINESS_PRODUCTION_TARGETS.origins.includes(input.target.origin)) {
      addError(errors, "target.origin", "Production origins are forbidden.");
    } else if (input.target.origin !== LIVE_READINESS_STAGING_TARGET.origin) {
      addError(errors, "target.origin", "Origin must be the reviewed isolated staging origin.");
    }
    if (input.target.environment !== LIVE_READINESS_STAGING_TARGET.environment) {
      addError(errors, "target.environment", "Environment must be staging.");
    }
  }

  if (!sameValue(input.capabilities, ["LR-01", "LR-02"])) {
    addError(errors, "capabilities", "Fixture plan must be scoped to LR-01 and LR-02 only.");
  }

  validateCanonicalMap(errors, "actors", input.actors, CANONICAL_ACTORS, ACTOR_KEYS);
  validateCanonicalMap(errors, "agencies", input.agencies, CANONICAL_AGENCIES, AGENCY_KEYS);
  validateCanonicalMap(errors, "patients", input.patients, CANONICAL_PATIENTS, PATIENT_KEYS);

  if (!Array.isArray(input.assignments)) {
    addError(errors, "assignments", "Must be an array containing the one canonical assignment.");
  } else if (input.assignments.length !== 1) {
    addError(errors, "assignments", "Exactly one active A1-to-Clinician-A assignment is required.");
  } else if (requireExactKeys(errors, "assignments.0", input.assignments[0], ASSIGNMENT_KEYS)) {
    for (const key of ASSIGNMENT_KEYS) {
      if (!sameValue(input.assignments[0][key], CANONICAL_ASSIGNMENT[key])) {
        addError(errors, `assignments.0.${key}`, "Value does not match the canonical assignment contract.");
      }
    }
  }

  return errors;
}

export function formatLiveReadinessFixtureErrors(errors) {
  return errors.map((error) => `${error.path}: ${error.message}`).join("; ");
}

export function createLiveReadinessFixturePlan(input) {
  const errors = validateLiveReadinessFixtureManifest(input);
  if (errors.length > 0) {
    throw new Error(`Invalid fixture manifest: ${formatLiveReadinessFixtureErrors(errors)}`);
  }
  return {
    status: "valid_fixture_plan",
    readiness_status: "blocked_until_hosted_identities_and_evidence_exist",
    fixture_set_id: input.fixture_set_id,
    target: { ...LIVE_READINESS_STAGING_TARGET },
    capabilities: ["LR-01", "LR-02"],
    counts: {
      actors: 5,
      tenant_actors: 4,
      agencies: 2,
      memberships: 4,
      patients: 3,
      care_team_assignments: 1,
    },
    expected_patient_access: {
      platform_owner: "excluded_from_tenant_assertions",
      admin_a: ["a1", "a2"],
      clinician_a: ["a1"],
      clinician_a_empty: [],
      admin_b: ["b1"],
    },
    safeguards: {
      network_access: false,
      hosted_writes: false,
      credentials_present: false,
      raw_phi_fields_present: false,
      tenant_authority_source: "AgencyMembership_and_PatientCareTeamAssignment",
      mutable_user_claims_used: false,
    },
  };
}
