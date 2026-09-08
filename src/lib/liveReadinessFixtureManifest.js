export const LIVE_READINESS_FIXTURE_SCHEMA_VERSION = 2;
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
  Referral: Object.freeze([
    "agency_id",
    "patient_id",
    "patient_name",
    "status",
    "priority",
    "document_type",
    "client_request_id",
  ]),
  Visit: Object.freeze([
    "agency_id",
    "patient_id",
    "client_request_id",
    "visit_date",
    "visit_type",
    "status",
    "nurse_notes",
    "raw_transcription",
    "compliance_score",
    "compliance_issues",
    "homebound_status_verified",
    "skilled_intervention_documented",
    "documentation_source",
    "grounding_pending",
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
  "memberships",
  "patients",
  "assignments",
  "workflow_requests",
];
const TARGET_KEYS = ["environment", "app_id", "origin"];
const ACTOR_KEYS = ["email_env", "built_in_role", "agency", "tenant_role"];
const AGENCY_KEYS = [
  "creator",
  "resource",
  "action",
  "agency_name",
  "agency_code",
  "status",
];
const MEMBERSHIP_KEYS = [
  "caller",
  "broker",
  "actor",
  "agency",
  "tenant_role",
  "provision_action",
  "provision_reason",
  "activation_action",
  "activation_reason",
];
const PATIENT_KEYS = [
  "broker",
  "action",
  "agency",
  "creator",
  "client_request_id",
  "first_name",
  "last_name",
  "status",
  "is_sample",
  "is_archived",
];
const ASSIGNMENT_KEYS = [
  "caller",
  "broker",
  "patient",
  "actor",
  "action",
  "client_request_id",
  "reason",
  "status",
  "source",
];
const WORKFLOW_REQUEST_KEYS = [
  "capability",
  "probe",
  "actor",
  "agency",
  "patient",
  "broker",
  "action",
  "client_request_id",
  "input",
];

export const LIVE_READINESS_FIXTURE_ACTORS = Object.freeze({
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

const CANONICAL_ACTORS = LIVE_READINESS_FIXTURE_ACTORS;

export const LIVE_READINESS_FIXTURE_AGENCIES = Object.freeze({
  agency_a: Object.freeze({
    creator: "platform_owner",
    resource: "Agency",
    action: "create",
    agency_name: "Synthetic Readiness Agency A",
    agency_code: "LR-A",
    status: "active",
  }),
  agency_b: Object.freeze({
    creator: "platform_owner",
    resource: "Agency",
    action: "create",
    agency_name: "Synthetic Readiness Agency B",
    agency_code: "LR-B",
    status: "active",
  }),
});

const CANONICAL_AGENCIES = LIVE_READINESS_FIXTURE_AGENCIES;

const CANONICAL_MEMBERSHIPS = Object.freeze([
  Object.freeze({
    caller: "platform_owner",
    broker: "manageAgencyMembership",
    actor: "admin_a",
    agency: "agency_a",
    tenant_role: "agency_admin",
    provision_action: "provision",
    provision_reason: "Create synthetic LR fixture membership",
    activation_action: "activate",
    activation_reason: "Activate synthetic LR fixture membership",
  }),
  Object.freeze({
    caller: "platform_owner",
    broker: "manageAgencyMembership",
    actor: "clinician_a",
    agency: "agency_a",
    tenant_role: "clinician",
    provision_action: "provision",
    provision_reason: "Create synthetic LR fixture membership",
    activation_action: "activate",
    activation_reason: "Activate synthetic LR fixture membership",
  }),
  Object.freeze({
    caller: "platform_owner",
    broker: "manageAgencyMembership",
    actor: "clinician_a_empty",
    agency: "agency_a",
    tenant_role: "clinician",
    provision_action: "provision",
    provision_reason: "Create synthetic LR fixture membership",
    activation_action: "activate",
    activation_reason: "Activate synthetic LR fixture membership",
  }),
  Object.freeze({
    caller: "platform_owner",
    broker: "manageAgencyMembership",
    actor: "admin_b",
    agency: "agency_b",
    tenant_role: "agency_admin",
    provision_action: "provision",
    provision_reason: "Create synthetic LR fixture membership",
    activation_action: "activate",
    activation_reason: "Activate synthetic LR fixture membership",
  }),
]);

export const LIVE_READINESS_FIXTURE_PATIENTS = Object.freeze({
  a1: Object.freeze({
    broker: "createAuthorizedPatient",
    action: "create",
    agency: "agency_a",
    creator: "admin_a",
    client_request_id: "lr-fixture-patient-a1-v1",
    first_name: "Synthetic",
    last_name: "Agency-A-One",
    status: "active",
    is_sample: false,
    is_archived: false,
  }),
  a2: Object.freeze({
    broker: "createAuthorizedPatient",
    action: "create",
    agency: "agency_a",
    creator: "admin_a",
    client_request_id: "lr-fixture-patient-a2-v1",
    first_name: "Synthetic",
    last_name: "Agency-A-Two",
    status: "active",
    is_sample: false,
    is_archived: false,
  }),
  b1: Object.freeze({
    broker: "createAuthorizedPatient",
    action: "create",
    agency: "agency_b",
    creator: "admin_b",
    client_request_id: "lr-fixture-patient-b1-v1",
    first_name: "Synthetic",
    last_name: "Agency-B-One",
    status: "active",
    is_sample: false,
    is_archived: false,
  }),
});

const CANONICAL_PATIENTS = LIVE_READINESS_FIXTURE_PATIENTS;

export const LIVE_READINESS_FIXTURE_ASSIGNMENTS = Object.freeze([
  Object.freeze({
    caller: "admin_a",
    broker: "managePatientCareTeamAssignment",
    patient: "a1",
    actor: "clinician_a",
    action: "grant",
    client_request_id: "lr-fixture-assignment-a1-clinician-a-v1",
    reason: "Grant synthetic LR direct-care assignment",
    status: "active",
    source: "manual",
  }),
]);

const CANONICAL_ASSIGNMENT = LIVE_READINESS_FIXTURE_ASSIGNMENTS[0];

const CANONICAL_WORKFLOW_REQUESTS = Object.freeze({
  referral_a1_create: Object.freeze({
    capability: "LR-02",
    probe: "S3",
    actor: "admin_a",
    agency: "agency_a",
    patient: "a1",
    broker: "manageAuthorizedReferral",
    action: "create",
    client_request_id: "lr02-s3-referral-a1-v1",
    input: Object.freeze({
      patient_name: "Synthetic Agency A One",
      status: "new",
      priority: "normal",
      document_type: "manual",
    }),
  }),
  smart_note_a1_visit_create: Object.freeze({
    capability: "LR-02",
    probe: "S4",
    actor: "clinician_a",
    agency: "agency_a",
    patient: "a1",
    broker: "createAuthorizedVisit",
    action: "create",
    client_request_id: "lr02-s4-smart-note-a1-v1",
    input: Object.freeze({
      visit_date: "2026-09-07",
      visit_type: "skilled_nursing",
      status: "completed",
      nurse_notes: "Synthetic readiness note; no real patient information.",
      raw_transcription: "Synthetic readiness observation only.",
      compliance_score: 100,
      compliance_issues: Object.freeze([]),
      homebound_status_verified: true,
      skilled_intervention_documented: true,
      documentation_source: "smart_note",
      grounding_pending: false,
    }),
  }),
});

export const LIVE_READINESS_FIXTURE_ACTOR_ALIASES = Object.freeze(
  Object.keys(CANONICAL_ACTORS),
);
export const LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES = Object.freeze(
  LIVE_READINESS_FIXTURE_ACTOR_ALIASES.filter((alias) => alias !== "platform_owner"),
);
export const LIVE_READINESS_FIXTURE_AGENCY_ALIASES = Object.freeze(
  Object.keys(CANONICAL_AGENCIES),
);
export const LIVE_READINESS_FIXTURE_PATIENT_ALIASES = Object.freeze(
  Object.keys(CANONICAL_PATIENTS),
);
export const LIVE_READINESS_FIXTURE_TOPOLOGY = Object.freeze({
  actor_aliases: LIVE_READINESS_FIXTURE_ACTOR_ALIASES,
  tenant_actor_aliases: LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES,
  agency_aliases: LIVE_READINESS_FIXTURE_AGENCY_ALIASES,
  patient_aliases: LIVE_READINESS_FIXTURE_PATIENT_ALIASES,
  assignment_edges: Object.freeze(LIVE_READINESS_FIXTURE_ASSIGNMENTS.map((assignment) => (
    Object.freeze({ patient: assignment.patient, actor: assignment.actor })
  ))),
});

const RUNTIME_RESOLUTION_KEYS = [
  "agency_ids",
  "actor_users",
  "patient_ids",
  "provisioned_membership_versions",
];
const RESOLVED_ACTOR_KEYS = ["user_id", "email"];
const TENANT_ACTOR_ALIASES = LIVE_READINESS_FIXTURE_TENANT_ACTOR_ALIASES;

const SAFE_MANIFEST_PATH_KEYS = new Set([
  ...TOP_LEVEL_KEYS,
  ...TARGET_KEYS,
  ...ACTOR_KEYS,
  ...AGENCY_KEYS,
  ...MEMBERSHIP_KEYS,
  ...PATIENT_KEYS,
  ...ASSIGNMENT_KEYS,
  ...WORKFLOW_REQUEST_KEYS,
  "referral_a1_create",
  "smart_note_a1_visit_create",
  "patient_name",
  "priority",
  "document_type",
  "visit_date",
  "visit_type",
  "nurse_notes",
  "raw_transcription",
  "compliance_score",
  "compliance_issues",
  "homebound_status_verified",
  "skilled_intervention_documented",
  "documentation_source",
  "grounding_pending",
  ...Object.keys(CANONICAL_ACTORS),
  ...Object.keys(CANONICAL_AGENCIES),
  ...Object.keys(CANONICAL_PATIENTS),
]);

const SENSITIVE_MANIFEST_KEY = /(?:^|_)(?:password|passcode|token|secret|authorization|cookie|session|email|phone|address|date_of_birth|dob|ssn|medical_record_number|first_name|last_name)(?:_|$)/i;
const REVIEWED_SYNTHETIC_IDENTITY_KEYS = new Set(["first_name", "last_name", "patient_name"]);

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
    if (
      key !== "email_env"
      && !REVIEWED_SYNTHETIC_IDENTITY_KEYS.has(key)
      && SENSITIVE_MANIFEST_KEY.test(key)
    ) {
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

function exactRuntimeIdentifier(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 200
    && value.trim() === value
    && !value.startsWith("$")
    && ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 31 || codePoint === 127;
    });
}

function canonicalRuntimeEmail(value) {
  return typeof value === "string"
    && value === value.trim().toLowerCase()
    && value.length <= 320
    && value.includes("@")
    && !/\s/.test(value);
}

function validateRuntimeResolution(resolution) {
  if (!isObject(resolution)) return false;
  const exactTopLevel = Object.keys(resolution).length === RUNTIME_RESOLUTION_KEYS.length
    && RUNTIME_RESOLUTION_KEYS.every((key) => Object.hasOwn(resolution, key));
  if (!exactTopLevel) return false;

  const aliasMapIsExact = (value, aliases) => isObject(value)
    && Object.keys(value).length === aliases.length
    && aliases.every((alias) => Object.hasOwn(value, alias));
  const agencyAliases = Object.keys(CANONICAL_AGENCIES);
  const patientAliases = Object.keys(CANONICAL_PATIENTS);
  if (!aliasMapIsExact(resolution.agency_ids, agencyAliases)
    || !agencyAliases.every((alias) => exactRuntimeIdentifier(resolution.agency_ids[alias]))) {
    return false;
  }
  if (!aliasMapIsExact(resolution.patient_ids, patientAliases)
    || !patientAliases.every((alias) => exactRuntimeIdentifier(resolution.patient_ids[alias]))) {
    return false;
  }
  if (!aliasMapIsExact(resolution.actor_users, TENANT_ACTOR_ALIASES)) return false;
  for (const alias of TENANT_ACTOR_ALIASES) {
    const actor = resolution.actor_users[alias];
    if (
      !isObject(actor)
      || Object.keys(actor).length !== RESOLVED_ACTOR_KEYS.length
      || !RESOLVED_ACTOR_KEYS.every((key) => Object.hasOwn(actor, key))
      || !exactRuntimeIdentifier(actor.user_id)
      || !canonicalRuntimeEmail(actor.email)
    ) {
      return false;
    }
  }
  return aliasMapIsExact(resolution.provisioned_membership_versions, TENANT_ACTOR_ALIASES)
    && TENANT_ACTOR_ALIASES.every((alias) => (
      Number.isSafeInteger(resolution.provisioned_membership_versions[alias])
      && resolution.provisioned_membership_versions[alias] >= 1
    ));
}

function assembleFixtureRequests(input, resolution) {
  const agencyCreates = Object.entries(input.agencies).map(([alias, agency]) => ({
    alias: `${alias}_create`,
    caller: agency.creator,
    resource: agency.resource,
    operation: agency.action,
    body: {
      agency_name: agency.agency_name,
      agency_code: agency.agency_code,
      status: agency.status,
    },
  }));

  const membershipActions = input.memberships.flatMap((membership) => {
    const agencyId = resolution.agency_ids[membership.agency];
    const target = resolution.actor_users[membership.actor];
    const common = {
      agency_id: agencyId,
      target_user_id: target.user_id,
      target_user_email: target.email,
    };
    return [
      {
        alias: `${membership.actor}_membership_provision`,
        caller: membership.caller,
        broker: membership.broker,
        body: {
          action: membership.provision_action,
          ...common,
          reason: membership.provision_reason,
          tenant_role: membership.tenant_role,
        },
      },
      {
        alias: `${membership.actor}_membership_activate`,
        caller: membership.caller,
        broker: membership.broker,
        body: {
          action: membership.activation_action,
          ...common,
          expected_version: resolution.provisioned_membership_versions[membership.actor],
          reason: membership.activation_reason,
        },
      },
    ];
  });

  const patientCreates = Object.entries(input.patients).map(([alias, patient]) => ({
    alias: `${alias}_create`,
    caller: patient.creator,
    broker: patient.broker,
    body: {
      agency_id: resolution.agency_ids[patient.agency],
      client_request_id: patient.client_request_id,
      first_name: patient.first_name,
      last_name: patient.last_name,
      status: patient.status,
    },
    expected: {
      status: patient.status,
      is_sample: patient.is_sample,
      is_archived: patient.is_archived,
    },
  }));

  const assignmentActions = input.assignments.map((assignment) => ({
    alias: `${assignment.patient}_${assignment.actor}_assignment_grant`,
    caller: assignment.caller,
    broker: assignment.broker,
    body: {
      action: assignment.action,
      agency_id: resolution.agency_ids[input.patients[assignment.patient].agency],
      patient_id: resolution.patient_ids[assignment.patient],
      target_user_id: resolution.actor_users[assignment.actor].user_id,
      client_request_id: assignment.client_request_id,
      reason: assignment.reason,
    },
    expected: {
      status: assignment.status,
      source: assignment.source,
    },
  }));

  const workflowRequests = Object.entries(input.workflow_requests).map(([alias, request]) => {
    const common = {
      alias,
      capability: request.capability,
      probe: request.probe,
      caller: request.actor,
      broker: request.broker,
    };
    if (alias === "referral_a1_create") {
      return {
        ...common,
        body: {
          action: request.action,
          agency_id: resolution.agency_ids[request.agency],
          client_request_id: request.client_request_id,
          referral: {
            ...request.input,
            patient_id: resolution.patient_ids[request.patient],
          },
        },
      };
    }
    return {
      ...common,
      body: {
        ...request.input,
        patient_id: resolution.patient_ids[request.patient],
        agency_id: resolution.agency_ids[request.agency],
        client_request_id: request.client_request_id,
      },
    };
  });

  return {
    mode: "plan_only_no_writes",
    network_access: false,
    hosted_writes: false,
    agency_creates: agencyCreates,
    membership_actions: membershipActions,
    patient_creates: patientCreates,
    assignment_actions: assignmentActions,
    workflow_requests: workflowRequests,
  };
}

/**
 * Materialize exact broker/entity request bodies from canonical aliases and
 * externally resolved staging row identities. This is a pure assembler: it
 * performs no SDK construction, network access, auth, or writes. Callers must
 * keep the resolved user emails private and must pass no passwords or tokens.
 */
export function assembleLiveReadinessFixtureRequests(input, resolution) {
  const errors = validateLiveReadinessFixtureManifest(input);
  if (errors.length > 0) {
    throw new Error(`Invalid fixture manifest: ${formatLiveReadinessFixtureErrors(errors)}`);
  }
  if (!validateRuntimeResolution(resolution)) {
    throw new Error("Invalid fixture runtime resolution.");
  }
  return assembleFixtureRequests(input, resolution);
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
  if (!Array.isArray(input.memberships)) {
    addError(errors, "memberships", "Must be the canonical four-membership lifecycle plan.");
  } else if (!sameValue(input.memberships, CANONICAL_MEMBERSHIPS)) {
    addError(errors, "memberships", "Membership inputs do not match the canonical synthetic fixture contract.");
  } else {
    input.memberships.forEach((membership, index) => {
      requireExactKeys(errors, `memberships.${index}`, membership, MEMBERSHIP_KEYS);
    });
  }
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

  validateCanonicalMap(
    errors,
    "workflow_requests",
    input.workflow_requests,
    CANONICAL_WORKFLOW_REQUESTS,
    WORKFLOW_REQUEST_KEYS,
  );

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
    readiness_status: "blocked_until_authenticated_hosted_evidence_and_reviews_exist",
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
      workflow_requests: 2,
      planned_mutating_actions: 16,
    },
    expected_patient_access: {
      platform_owner: "excluded_from_tenant_assertions",
      admin_a: ["a1", "a2"],
      clinician_a: ["a1"],
      clinician_a_empty: [],
      admin_b: ["b1"],
    },
    request_assembly: {
      pure_assembler_available: true,
      executes_requests: false,
      runtime_resolution_required: [...RUNTIME_RESOLUTION_KEYS],
      assignment_request_expected_to_hit_source_pause: true,
    },
    safeguards: {
      network_access: false,
      hosted_writes: false,
      credentials_present: false,
      real_phi_values_present: false,
      reviewed_synthetic_identity_values_present: true,
      plan_only_inputs_are_hosted_evidence: false,
      tenant_authority_source: "AgencyMembership_and_PatientCareTeamAssignment",
      mutable_user_claims_used: false,
    },
  };
}
