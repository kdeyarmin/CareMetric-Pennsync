import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Behavioral contract for the hard-paused OASIS write broker.
 *
 * Production-source tests never bypass the pause. Dormant-path tests rewrite
 * the literal in an isolated transpiled copy and inject a complete service-role
 * store. This proves the code below the pause without introducing a deployed
 * runtime, environment, feature-flag, or administrator bypass.
 */

const V2 = "pennsync-oasis-response-v2-cms-e2";
const FLAG = "oasis_response_schema_v2_enabled";
const NOW = "2026-06-01T10:00:00.000Z";

const USER = {
  id: "u1",
  email: "rn@example.com",
  role: "user",
  is_active: true,
  disabled: false,
  is_service: false,
  is_verified: true,
  // Mutable legacy claims are deliberately wrong. They are never authority.
  agency_id: "foreign-agency",
  agency_name: "Foreign Agency",
};

const AGENCY = {
  id: "ag1",
  agency_code: "MAPLE-HH",
  status: "active",
};

const MEMBERSHIP = {
  id: "mem1",
  membership_key: "ag1:u1",
  agency_id: "ag1",
  user_id: "u1",
  user_email_normalized: "rn@example.com",
  tenant_role: "clinician",
  status: "active",
  created_by_user_id: "u-admin",
  activated_at: "2026-01-01T00:00:00.000Z",
  revoked_at: null,
  revocation_reason: null,
  last_transition_by_user_id: "u-admin",
  last_transition_by_email_normalized: "admin@example.com",
  last_transition_at: "2026-01-01T00:00:00.000Z",
  last_transition_reason: "initial activation",
  version: 3,
};

const PATIENT = {
  id: "p1",
  agency_id: "ag1",
  created_by_user_id: "u-creator",
  created_by_user_email_normalized: "creator@example.com",
  created_by: "creator@example.com",
  client_request_id: "patient-request-1",
  patient_creation_key: "ag1:u-creator:patient-request-1",
  is_sample: false,
  is_archived: false,
  status: "active",
  updated_date: "2026-05-01T00:00:00.000Z",
};

const ASSIGNMENT = {
  id: "assign1",
  assignment_key: "ag1:p1:u1",
  agency_id: "ag1",
  patient_id: "p1",
  user_id: "u1",
  user_email_normalized: "rn@example.com",
  assignee_membership_id: "mem1",
  assignee_membership_version_at_enablement: 3,
  status: "active",
  source: "manual",
  created_by_user_id: "u-admin",
  created_by_user_email_normalized: "admin@example.com",
  activated_at: "2026-01-02T00:00:00.000Z",
  suspended_at: null,
  revoked_at: null,
  revocation_reason: null,
  last_transition_by_user_id: "u-admin",
  last_transition_by_email_normalized: "admin@example.com",
  last_transition_at: "2026-01-02T00:00:00.000Z",
  last_transition_reason: "assigned to chart",
  last_transition_action: "grant",
  last_transition_request_id: "assignment-request-1",
  last_transition_request_key: "ag1:p1:u1:assignment-request-1",
  version: 2,
};

const VISIT = {
  id: "v1",
  agency_id: "ag1",
  patient_id: "p1",
  created_by_user_id: "u-creator",
  created_by_user_email_normalized: "creator@example.com",
  created_by: "creator@example.com",
  client_request_id: "visit-request-1",
  is_sample: false,
  visit_date: "2026-06-01",
  visit_type: "discharge",
  status: "completed",
  updated_date: "2026-06-01T09:00:00.000Z",
};

const SETTINGS = {
  id: "settings1",
  agency_code: "MAPLE-HH",
  [FLAG]: true,
  oasis_response_writes_disabled: false,
  updated_date: "2026-05-15T00:00:00.000Z",
};

function minimalRow(overrides = {}) {
  return {
    definition_id: "m1830_cms_e2",
    response_value: { code: "6" },
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    operation: "create_draft",
    agency_id: "ag1",
    patient_id: "p1",
    visit_id: "v1",
    visit_type: "Discharge",
    assessment_date: "2026-06-01",
    oasis_items: [minimalRow()],
    ...overrides,
  };
}

function initialState(overrides = {}) {
  return {
    agencies: [structuredClone(AGENCY)],
    memberships: [structuredClone(MEMBERSHIP)],
    patients: [structuredClone(PATIENT)],
    assignments: [structuredClone(ASSIGNMENT)],
    visits: [structuredClone(VISIT)],
    settings: [structuredClone(SETTINGS)],
    assessments: [],
    ...structuredClone(overrides),
  };
}

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => row?.[key] === value);
}

function defaultRows(entity, query, state) {
  const store = {
    Agency: state.agencies,
    AgencyMembership: state.memberships,
    Patient: state.patients,
    PatientCareTeamAssignment: state.assignments,
    Visit: state.visits,
    AgencySettings: state.settings,
    OASISAssessment: state.assessments,
  }[entity];
  return (store || []).filter((row) => matches(row, query));
}

async function loadHandler({
  exerciseDormantBroker = true,
  user = USER,
  state: stateOverrides = {},
  onAuth = null,
  onFilter = null,
  onCreate = null,
} = {}) {
  let src = await readFile(new URL("../functions/saveOasisResponses/entry.ts", import.meta.url), "utf8");
  src = src.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__soMakeClient;",
  );
  if (exerciseDormantBroker) {
    src = src.replace(
      "const OASIS_V2_WRITES_PAUSED = true;",
      "const OASIS_V2_WRITES_PAUSED = false;",
    );
  }
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `soctr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);

  const state = initialState(stateOverrides);
  const runtime = {
    clientCreations: 0,
    authCalls: 0,
    serviceCreates: [],
    serviceFilters: [],
    userEntityAccesses: 0,
  };
  const filterCounts = new Map();
  let handler;

  const serviceEntities = {};
  for (const entity of [
    "Agency",
    "AgencyMembership",
    "Patient",
    "PatientCareTeamAssignment",
    "Visit",
    "AgencySettings",
    "OASISAssessment",
  ]) {
    serviceEntities[entity] = {
      filter: async (query, sort, limit, skip, fields) => {
        const count = (filterCounts.get(entity) || 0) + 1;
        filterCounts.set(entity, count);
        runtime.serviceFilters.push({ entity, query: structuredClone(query), sort, limit, skip, fields, count });
        const overridden = onFilter?.({ entity, query, count, state, runtime });
        const rows = overridden === undefined ? defaultRows(entity, query, state) : overridden;
        return structuredClone(rows);
      },
    };
  }
  serviceEntities.OASISAssessment.create = async (record) => {
    runtime.serviceCreates.push(structuredClone(record));
    if (onCreate) {
      const result = await onCreate({ record, state, runtime });
      if (result !== undefined) return result;
    }
    const stored = {
      id: `oa${state.assessments.length + 1}`,
      ...structuredClone(record),
      created_by: "service@example.com",
      created_date: NOW,
      updated_date: NOW,
    };
    state.assessments.push(stored);
    return { id: stored.id };
  };

  globalThis.Deno = { serve: (fn) => { handler = fn; }, env: { get: () => undefined } };
  globalThis.__soMakeClient = () => {
    runtime.clientCreations += 1;
    return {
      auth: {
        me: async () => {
          runtime.authCalls += 1;
          const overridden = onAuth?.({ count: runtime.authCalls, state, runtime });
          return overridden === undefined ? user : overridden;
        },
      },
      asServiceRole: { entities: serviceEntities },
      get entities() {
        runtime.userEntityAccesses += 1;
        throw new Error("user-mode entities must never be used");
      },
    };
  };

  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return { handler, runtime, state };
}

async function request(handler, body, { method = "POST", headers = {} } = {}) {
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await handler(new Request("http://local/saveOasisResponses", init));
  const result = { status: res.status, headers: res.headers, json: await res.json() };
  assert.equal(result.headers.get("cache-control"), "no-store", "all broker responses must be non-cacheable");
  return result;
}

const reasons = (json) => (json.errors || []).map((error) => error.reason);

test("production writes are hard-paused before body parsing, client creation, auth, or data access", async () => {
  const { handler, runtime } = await loadHandler({ exerciseDormantBroker: false });
  const result = await request(handler, "{ definitely not json");
  assert.equal(result.status, 503);
  assert.equal(result.json.reason, "tenant_security_validation_pending");
  assert.equal(runtime.clientCreations, 0);
  assert.equal(runtime.authCalls, 0);
  assert.deepEqual(runtime.serviceCreates, []);
  assert.deepEqual(runtime.serviceFilters, []);
});

test("the dormant broker creates only a tenant-stamped canonical draft through service role", async () => {
  const { handler, runtime } = await loadHandler();
  const result = await request(handler, payload());
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.ok, true);
  assert.equal(result.json.operation, "create_draft");
  assert.deepEqual(Object.keys(result.json.assessment).sort(), [
    "assessment_date",
    "id",
    "instrument_version",
    "migration_status",
    "patient_id",
    "response_schema_id",
    "status",
    "visit_id",
    "visit_type",
  ]);
  assert.equal(result.json.assessment.status, "draft");
  assert.equal(result.json.scope.agency_id, "ag1");
  assert.equal(result.json.scope.membership_id, "mem1");
  assert.equal(result.json.scope.membership_version, 3);
  assert.equal(result.json.scope.chart_access_basis, "care_team_assignment");

  assert.equal(runtime.serviceCreates.length, 1);
  assert.equal(runtime.userEntityAccesses, 0);
  const record = runtime.serviceCreates[0];
  assert.equal(record.agency_id, "ag1");
  assert.equal(record.patient_id, "p1");
  assert.equal(record.visit_id, "v1");
  assert.equal(record.status, "draft");
  assert.equal(record.response_schema_id, V2);
  assert.equal(record.instrument_version, "oasis-e2");
  assert.equal(record.response_schema_source, "final-oasis-e2-all-item-04-01-2026");
  assert.equal(record.migration_status, "native_v2");
  assert.equal(record.last_written_by, "rn@example.com");
  assert.equal(record.oasis_items[0].definition_id, "m1830_cms_e2");
  assert.equal(record.oasis_items[0].item_number, "M1830");
  assert.equal(record.oasis_items[0].item_source, "cms_item");
  assert.equal(record.oasis_items[0].item_spec_version, "oasis-e2");
  assert.equal(record.oasis_items[0].response_shape, "single");
  assert.equal(record.oasis_items[0].response_origin, "clinician_selected");
  assert.equal(record.oasis_items[0].selected_by, "rn@example.com");
  assert.equal(record.oasis_items[0].selected_at, record.last_written_at);
  assert.equal(record.oasis_items[0].ai_suggested, false);

  assert.equal(runtime.authCalls, 3, "authority is established initially and rechecked before and after create");
  assert.equal(
    runtime.serviceFilters.filter(({ entity }) => entity === "OASISAssessment").length,
    2,
    "the service-role create is read back twice around the post-write authority recheck",
  );
});

test("method and request shape are exact; updates, lifecycle transitions, and client-owned fields are refused", async () => {
  const get = await loadHandler();
  const getResult = await request(get.handler, undefined, { method: "GET" });
  assert.equal(getResult.status, 405);
  assert.equal(getResult.headers.get("allow"), "POST");

  for (const operation of ["update", "submit", "approve"]) {
    const ctx = await loadHandler();
    const result = await request(ctx.handler, payload({ operation, assessment_id: "oa-existing" }));
    assert.equal(result.status, 409, operation);
    assert.equal(result.json.reason, "updates_paused", operation);
    assert.equal(ctx.runtime.clientCreations, 0, operation);
  }

  const unsupportedBodies = [
    payload({ status: "submitted" }),
    payload({ assessment_id: "oa-existing" }),
    payload({ response_schema_id: V2 }),
    payload({ oasis_items: [minimalRow({ selected_by: "other@example.com" })] }),
    payload({ oasis_items: [minimalRow({ response_origin: "clinician_selected" })] }),
  ];
  for (const body of unsupportedBodies) {
    const ctx = await loadHandler();
    const result = await request(ctx.handler, body);
    assert.ok(result.status === 400 || result.status === 422, JSON.stringify(result.json));
    assert.equal(ctx.runtime.clientCreations, 0);
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }
});

test("body size, exact identifiers, calendar dates, and item count are bounded before auth", async () => {
  const cases = [
    [payload({ agency_id: { $ne: null } }), "invalid_identifier"],
    [payload({ agency_id: "$ne" }), "invalid_identifier"],
    [payload({ patient_id: " p1" }), "invalid_identifier"],
    [payload({ visit_id: "" }), "invalid_identifier"],
    [payload({ assessment_date: "2026-02-31" }), "invalid_assessment_date"],
    [payload({ assessment_date: "06/01/2026" }), "invalid_assessment_date"],
    [payload({ assessment_date: "2025-12-31" }), "assessment_predates_oasis_e2"],
    [payload({ visit_type: " Discharge" }), "invalid_visit_type"],
    [payload({ visit_type: "Discharge " }), "invalid_visit_type"],
    [payload({ visit_type: "Death at Home" }), "invalid_visit_type"],
    [payload({ oasis_items: [] }), "invalid_oasis_items"],
    [payload({ oasis_items: Array.from({ length: 501 }, () => minimalRow()) }), "invalid_oasis_items"],
  ];
  for (const [body, reason] of cases) {
    const ctx = await loadHandler();
    const result = await request(ctx.handler, body);
    assert.equal(result.json.reason, reason, JSON.stringify(result.json));
    assert.equal(ctx.runtime.clientCreations, 0);
  }

  const oversized = await loadHandler();
  const oversizedResult = await request(
    oversized.handler,
    JSON.stringify(payload()) + " ".repeat(100_001),
  );
  assert.equal(oversizedResult.status, 413);
  assert.equal(oversizedResult.json.reason, "body_too_large");
  assert.equal(oversized.runtime.clientCreations, 0);
});

test("anonymous, inactive, disabled, service, unverified, and built-in admin identities cannot author responses", async () => {
  const users = [
    null,
    { ...USER, is_active: false },
    { ...USER, disabled: true },
    { ...USER, is_service: true },
    { ...USER, is_verified: false },
    { ...USER, role: "admin" },
    { ...USER, id: "" },
    { ...USER, email: "not-an-email" },
  ];
  for (const user of users) {
    const ctx = await loadHandler({ user });
    const result = await request(ctx.handler, payload());
    assert.ok(result.status === 401 || result.status === 403, JSON.stringify(result.json));
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }
});

test("an exact active immutable clinician membership is required; mutable User agency claims are ignored", async () => {
  const allowed = await loadHandler({
    user: { ...USER, agency_id: "other", agency_name: "Other" },
  });
  assert.equal((await request(allowed.handler, payload())).status, 200);

  const cases = [
    { memberships: [] },
    { memberships: [{ ...MEMBERSHIP, status: "suspended" }] },
    { memberships: [{ ...MEMBERSHIP, agency_id: "ag2", membership_key: "ag2:u1" }] },
    { memberships: [{ ...MEMBERSHIP, tenant_role: "manager" }] },
    { memberships: [{ ...MEMBERSHIP, tenant_role: "agency_admin" }] },
    { memberships: [{ ...MEMBERSHIP, user_email_normalized: "other@example.com" }] },
    { memberships: [{ ...MEMBERSHIP }, { ...MEMBERSHIP, id: "mem2" }] },
  ];
  for (const state of cases) {
    const ctx = await loadHandler({ state });
    const result = await request(ctx.handler, payload());
    assert.ok([403, 409].includes(result.status), JSON.stringify(result.json));
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }
});

test("the exact active Agency and its unique agency code bind all settings lookups", async () => {
  const good = await loadHandler();
  const result = await request(good.handler, payload());
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const settingsReads = good.runtime.serviceFilters.filter(({ entity }) => entity === "AgencySettings");
  assert.ok(settingsReads.length >= 3);
  for (const { query } of settingsReads) assert.deepEqual(query, { agency_code: "MAPLE-HH" });

  const cases = [
    { agencies: [] },
    { agencies: [{ ...AGENCY, status: "suspended" }] },
    { agencies: [{ ...AGENCY, agency_code: "" }] },
    { agencies: [{ ...AGENCY }, { ...AGENCY, id: "ag2" }] },
  ];
  for (const state of cases) {
    const ctx = await loadHandler({ state });
    const rejected = await request(ctx.handler, payload());
    assert.ok([403, 409].includes(rejected.status), JSON.stringify(rejected.json));
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }
});

test("the agency-scoped feature flag defaults closed and its kill switch wins", async () => {
  const cases = [
    [{ settings: [] }, 403, "feature_disabled"],
    [{ settings: [{ ...SETTINGS, [FLAG]: false }] }, 403, "feature_disabled"],
    [{ settings: [{ ...SETTINGS, [FLAG]: "true" }] }, 409, "settings_integrity_failed"],
    [{ settings: [{ ...SETTINGS, updated_date: "not-an-instant" }] }, 409, "settings_integrity_failed"],
    [{ settings: [{ ...SETTINGS }, { ...SETTINGS, id: "settings2" }] }, 409, "settings_integrity_failed"],
    [{ settings: [{ ...SETTINGS, agency_code: "OTHER" }] }, 403, "feature_disabled"],
    [{ settings: [{ ...SETTINGS, oasis_response_writes_disabled: true }] }, 423, "write_kill_switch"],
  ];
  for (const [state, status, reason] of cases) {
    const ctx = await loadHandler({ state });
    const result = await request(ctx.handler, payload());
    assert.equal(result.status, status, JSON.stringify(result.json));
    assert.equal(result.json.reason, reason, JSON.stringify(result.json));
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }
});

test("Patient tenant provenance and chart access are exact; a bound active assignment or immutable creator is required", async () => {
  const patientCases = [
    { patients: [] },
    { patients: [{ ...PATIENT, agency_id: "ag2" }] },
    { patients: [{ ...PATIENT, is_sample: true }] },
    { patients: [{ ...PATIENT, is_archived: true }] },
    { patients: [{ ...PATIENT, patient_creation_key: "forged" }] },
    { patients: [{ ...PATIENT }, { ...PATIENT, updated_date: "2026-05-02T00:00:00.000Z" }] },
  ];
  for (const state of patientCases) {
    const ctx = await loadHandler({ state });
    const result = await request(ctx.handler, payload());
    assert.ok([404, 409].includes(result.status), JSON.stringify(result.json));
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }

  const assignmentCases = [
    { assignments: [] },
    { assignments: [{ ...ASSIGNMENT, status: "revoked", revoked_at: NOW, revocation_reason: "removed", last_transition_action: "revoke" }] },
    { assignments: [{ ...ASSIGNMENT, assignee_membership_id: "mem-other" }] },
    { assignments: [{ ...ASSIGNMENT, assignee_membership_version_at_enablement: 2 }] },
    { assignments: [{ ...ASSIGNMENT, user_email_normalized: "other@example.com" }] },
    { assignments: [{ ...ASSIGNMENT }, { ...ASSIGNMENT, id: "assign2" }] },
  ];
  for (const state of assignmentCases) {
    const ctx = await loadHandler({ state });
    const result = await request(ctx.handler, payload());
    assert.ok([404, 409].includes(result.status), JSON.stringify(result.json));
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }

  const creator = await loadHandler({
    state: {
      patients: [{
        ...PATIENT,
        created_by_user_id: "u1",
        created_by_user_email_normalized: "rn@example.com",
        created_by: "rn@example.com",
        patient_creation_key: "ag1:u1:patient-request-1",
      }],
      assignments: [],
    },
  });
  const creatorResult = await request(creator.handler, payload());
  assert.equal(creatorResult.status, 200, JSON.stringify(creatorResult.json));
  assert.equal(creatorResult.json.scope.chart_access_basis, "patient_creator");
});

test("an optional Visit must be an exact non-sample same-agency row for the same Patient", async () => {
  const visitCases = [
    { visits: [] },
    { visits: [{ ...VISIT, agency_id: "ag2" }] },
    { visits: [{ ...VISIT, patient_id: "p2" }] },
    { visits: [{ ...VISIT, is_sample: true }] },
    { visits: [{ ...VISIT, created_by_user_email_normalized: "other@example.com" }] },
    { visits: [{ ...VISIT }, { ...VISIT, updated_date: NOW }] },
  ];
  for (const state of visitCases) {
    const ctx = await loadHandler({ state });
    const result = await request(ctx.handler, payload());
    assert.ok([404, 409].includes(result.status), JSON.stringify(result.json));
    assert.deepEqual(ctx.runtime.serviceCreates, []);
  }

  const withoutVisit = await loadHandler();
  const body = payload();
  delete body.visit_id;
  const result = await request(withoutVisit.handler, body);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(withoutVisit.runtime.serviceCreates[0].visit_id, null);
  assert.equal(withoutVisit.runtime.serviceFilters.some(({ entity }) => entity === "Visit"), false);
});

test("CMS definitions, applicability, codes, exclusivity, grid completeness, and row uniqueness are enforced", async () => {
  const cases = [
    [minimalRow({ definition_id: "m9999_cms_e2" }), "unknown_definition"],
    [minimalRow({ response_value: { code: "9" } }), "invalid_code"],
    [minimalRow({ definition_id: "m2420_cms_e2", response_value: { code: "1" } }), null],
    [minimalRow({ definition_id: "m1740_cms_e2", response_value: { codes: ["7", "1"] } }), "mutually_exclusive_response"],
    [minimalRow({ definition_id: "m2401_cms_e2", response_value: { rows: [{ row_id: "b", code: "1" }] } }), "missing_grid_row"],
  ];
  for (const [item, reason] of cases) {
    const ctx = await loadHandler();
    const body = payload({ oasis_items: [item] });
    if (item.definition_id === "m2401_cms_e2") body.visit_type = "Transfer";
    const result = await request(ctx.handler, body);
    if (reason === null) {
      assert.equal(result.status, 200, JSON.stringify(result.json));
    } else {
      assert.equal(result.status, 422, JSON.stringify(result.json));
      assert.ok(reasons(result.json).includes(reason), JSON.stringify(result.json));
      assert.deepEqual(ctx.runtime.serviceCreates, []);
    }
  }

  const duplicate = await loadHandler();
  const duplicateResult = await request(duplicate.handler, payload({ oasis_items: [minimalRow(), minimalRow()] }));
  assert.equal(duplicateResult.status, 422);
  assert.ok(reasons(duplicateResult.json).includes("duplicate_item_or_definition"));
  assert.deepEqual(duplicate.runtime.serviceCreates, []);
});

test("leading-zero CMS codes and screening responses survive while all metadata is server-derived", async () => {
  const ctx = await loadHandler();
  const result = await request(ctx.handler, payload({
    visit_type: "Start of Care",
    oasis_items: [
      minimalRow({ definition_id: "m1100_cms_e2", response_value: { code: "07" } }),
      minimalRow({ definition_id: "ps_hospitalization_risk_tier", response_value: { code: "high" } }),
    ],
  }));
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const [cms, screening] = ctx.runtime.serviceCreates[0].oasis_items;
  assert.equal(cms.response_value.code, "07");
  assert.equal(cms.item_number, "M1100");
  assert.equal(cms.response_shape, "matrix_choice");
  assert.equal(screening.item_number, null);
  assert.equal(screening.item_source, "pennsync_screening");
  assert.equal(screening.item_spec_version, null);
  assert.equal(screening.response_shape, "single");
});

test("authority, Patient, care-team, Visit, and feature controls are rechecked before mutation", async () => {
  const cases = [
    {
      label: "membership version",
      onFilter: ({ entity, count, state }) => entity === "AgencyMembership" && count === 2
        ? [{ ...state.memberships[0], version: 4 }]
        : undefined,
      expected: "authority_changed",
    },
    {
      label: "patient snapshot",
      onFilter: ({ entity, count, state }) => entity === "Patient" && count === 2
        ? [{ ...state.patients[0], updated_date: NOW }]
        : undefined,
      expected: "authority_changed",
    },
    {
      label: "assignment revoked",
      onFilter: ({ entity, count, state }) => entity === "PatientCareTeamAssignment" && count === 2
        ? [{
          ...state.assignments[0],
          status: "revoked",
          revoked_at: NOW,
          revocation_reason: "removed",
          last_transition_action: "revoke",
          last_transition_at: NOW,
          version: 3,
        }]
        : undefined,
      expected: "authority_changed",
    },
    {
      label: "visit snapshot",
      onFilter: ({ entity, count, state }) => entity === "Visit" && count === 2
        ? [{ ...state.visits[0], updated_date: NOW }]
        : undefined,
      expected: "authority_changed",
    },
    {
      label: "kill switch",
      onFilter: ({ entity, count, state }) => entity === "AgencySettings" && count === 2
        ? [{ ...state.settings[0], oasis_response_writes_disabled: true, updated_date: NOW }]
        : undefined,
      expected: "write_kill_switch",
    },
  ];
  for (const { label, onFilter, expected } of cases) {
    const ctx = await loadHandler({ onFilter });
    const result = await request(ctx.handler, payload());
    assert.equal(result.json.reason, expected, `${label}: ${JSON.stringify(result.json)}`);
    assert.deepEqual(ctx.runtime.serviceCreates, [], `${label}: no write may occur after drift`);
  }
});

test("post-write authority drift prevents a success response and exact readback must stay stable", async () => {
  const drift = await loadHandler({
    onFilter: ({ entity, count, state }) => entity === "AgencyMembership" && count === 3
      ? [{ ...state.memberships[0], version: 4 }]
      : undefined,
  });
  const driftResult = await request(drift.handler, payload());
  assert.equal(driftResult.status, 409, JSON.stringify(driftResult.json));
  assert.equal(driftResult.json.reason, "authority_changed");
  assert.equal(drift.runtime.serviceCreates.length, 1, "the revocation raced after service-role create");

  const changedReadback = await loadHandler({
    onFilter: ({ entity, count, state }) => {
      if (entity !== "OASISAssessment" || count !== 2) return undefined;
      return [{ ...state.assessments[0], status: "submitted" }];
    },
  });
  const changedResult = await request(changedReadback.handler, payload());
  assert.equal(changedResult.status, 409, JSON.stringify(changedResult.json));
  assert.equal(changedResult.json.reason, "write_verification_failed");
});

test("foreign, missing, duplicate, or tampered service-role readback is never reported as success", async () => {
  const variants = [
    () => [],
    ({ state }) => [{ ...state.assessments[0], agency_id: "ag2" }],
    ({ state }) => [{ ...state.assessments[0], patient_id: "p2" }],
    ({ state }) => [{ ...state.assessments[0] }, { ...state.assessments[0], id: "oa2" }],
    ({ state }) => [{ ...state.assessments[0], oasis_items: [] }],
    ({ state }) => [{ ...state.assessments[0], created_by: " Service@Example.com " }],
  ];
  for (const variant of variants) {
    const ctx = await loadHandler({
      onFilter: (context) => context.entity === "OASISAssessment" && context.count === 1
        ? variant(context)
        : undefined,
    });
    const result = await request(ctx.handler, payload());
    assert.equal(result.status, 409, JSON.stringify(result.json));
    assert.equal(result.json.reason, "write_verification_failed");
    assert.equal(result.json.assessment, undefined);
  }
});

test("provider failures are redacted and never expose predicates or PHI", async () => {
  const marker = "SECRET-PATIENT-NAME predicate agency_id=ag1";
  const filterFailure = await loadHandler({
    onFilter: ({ entity }) => {
      if (entity === "Patient") throw new Error(marker);
      return undefined;
    },
  });
  const filterResult = await request(filterFailure.handler, payload());
  assert.equal(filterResult.status, 500);
  assert.deepEqual(filterResult.json, { error: "Internal server error" });
  assert.doesNotMatch(JSON.stringify(filterResult.json), /SECRET|agency_id/);

  const createFailure = await loadHandler({
    onCreate: () => { throw new Error(marker); },
  });
  const createResult = await request(createFailure.handler, payload());
  assert.equal(createResult.status, 500);
  assert.deepEqual(createResult.json, { error: "Internal server error" });
  assert.doesNotMatch(JSON.stringify(createResult.json), /SECRET|agency_id/);
});

test("static containment keeps the hard pause first, service-role-only create, and no update path", async () => {
  const source = await readFile(new URL("../functions/saveOasisResponses/entry.ts", import.meta.url), "utf8");
  assert.match(source, /const OASIS_V2_WRITES_PAUSED = true;/);
  assert.match(source, /no cross-entity transaction/i);
  assert.match(source, /idempotency key, so a retry/i);
  assert.match(source, /Visit-policy proofs are\s+\/\/ all activation blockers/i);
  const handler = source.slice(source.indexOf("Deno.serve"));
  assert.ok(handler.indexOf("if (OASIS_V2_WRITES_PAUSED)") < handler.indexOf("parseRequest(req)"));
  assert.ok(handler.indexOf("if (OASIS_V2_WRITES_PAUSED)") < handler.indexOf("createClientFromRequest(req)"));
  assert.match(source, /const entities = base44\.asServiceRole\.entities;/);
  assert.match(source, /await entities\.OASISAssessment\.create\(record\)/);
  assert.doesNotMatch(source, /base44\.entities\.OASISAssessment/);
  assert.doesNotMatch(source, /OASISAssessment\.update\s*\(/);
  assert.doesNotMatch(source, /user\??\.agency_(?:id|name)/);
  assert.match(source, /body\.operation === 'update'/);
  assert.match(source, /'updates_paused'/);
  assert.match(source, /console\.error\('saveOasisResponses failed'\)/);
  assert.doesNotMatch(source, /detail:\s*String|console\.error\([^)]*error/);
});
