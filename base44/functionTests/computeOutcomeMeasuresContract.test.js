import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { transpileTs } from "../../tools-transpile-ts.mjs";
import {
  IMPROVEMENT_MEASURES as FE_MEASURES,
  OUTCOME_CALCULATION_VERSION as FE_VERSION,
} from "../../src/components/oasis/outcomeMeasureEngine.js";
import { CMS_GOLDEN_CODES, M2420_FORBIDDEN_DESTINATIONS } from "../../src/components/oasis/responseSchema/cmsGoldenFixtures.js";

/**
 * Behavioral contract tests for the quality-measure cron (computeOutcomeMeasures).
 *
 * Same harness convention as calculatePDGMContract.test.js: transpile the entry,
 * capture its Deno.serve handler, and run it against an injected Base44 client —
 * so the assertions run against the REAL handler and the REAL writes, not a copy
 * of the logic.
 *
 * The function carries an INLINED copy of the outcome core (it runs on Deno and
 * cannot import the frontend module). The parity test at the bottom is what
 * stops the two drifting: a rule fixed in one and not the other is exactly how
 * a legacy code would keep scoring on the backend after the UI stopped showing
 * it.
 */

const V2 = "pennsync-oasis-response-v2-cms-e2";
const V1 = "pennsync-oasis-response-v1-legacy";
const AGENCY_A = "agency-a";
const AGENCY_B = "agency-b";

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
      value[key] === undefined ? [] : [[key, canonicalJson(value[key])]]
    )));
  }
  return value;
}

function canonicalSha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex");
}

function v2Row(itemNumber, definitionId, code) {
  return {
    definition_id: definitionId,
    item_number: itemNumber,
    item_source: "cms_item",
    item_spec_version: "oasis-e2",
    response_schema_id: V2,
    response_shape: "single",
    response_value: { code },
    response_origin: "clinician_selected",
    selected_by: "rn@example.com",
    selected_at: "2026-05-01T12:00:00.000Z",
    ai_suggested: false,
  };
}

function legacyRow(itemNumber, response) {
  return { item_number: itemNumber, item_source: "cms_item", response_schema_id: V1, response };
}

/** A v2 assessment. `schema: null` produces an UNVERSIONED (pre-cutover) row. */
function assessment({ id, patientId = "p1", visitType, date, rows, schema = V2, agencyId = AGENCY_A }) {
  return {
    id,
    agency_id: agencyId,
    patient_id: patientId,
    visit_type: visitType,
    assessment_date: date,
    ...(schema ? { response_schema_id: schema, instrument_version: "oasis-e2" } : {}),
    oasis_items: rows,
  };
}

async function loadHandler({
  assessments = [],
  patients = [],
  outcomeMetrics = [],
  agencyKpis = [],
  outcomeRuns = [],
  agencies = [
    { id: AGENCY_A, admin_user_ids: ["u1"], admin_email: "admin@agency-a.test" },
    { id: AGENCY_B, admin_user_ids: ["u2"], admin_email: "admin@agency-b.test" },
  ],
  user = { id: "u1", role: "admin", account_type: "agency_admin", agency_id: AGENCY_A, is_active: true },
  internalSecret = "scheduler-secret",
  ignoreFilters = false,
  filterFailures = [],
  createFailures = [],
  unpersistedCreates = [],
  noOpRunUpdateStatuses = [],
  zeroRunUpdateStatuses = [],
  hasMoreRunUpdateStatuses = [],
  unsuccessfulRunUpdateStatuses = [],
  doubleUpdatedRunUpdateStatuses = [],
  ignoreRunVersionIncrementStatuses = [],
  applyThenThrowRunUpdateStatuses = [],
  mutateCreatedRun = null,
  mutateBeforeRunUpdateMany = null,
  onRunUpdateMany = null,
  updateFailures = [],
  onQuery = null,
  outcomeComputationEnabled = true,
} = {}) {
  let src = await readFile(new URL("../functions/computeOutcomeMeasures/entry.ts", import.meta.url), "utf8");
  src = src.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__omMakeClient;",
  );
  src = src.replace(
    'const OUTCOME_COMPUTATION_ENABLED = false;',
    `const OUTCOME_COMPUTATION_ENABLED = ${outcomeComputationEnabled};`,
  );
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `omctr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);

  const written = {
    metrics: [], metricCreates: [], metricUpdates: [],
    kpis: [], kpiCreates: [], kpiUpdates: [],
    runs: [], runCreates: [], runUpdates: [],
    events: [],
  };
  const runRows = outcomeRuns.map((row) => ({ ...row }));
  const metricRows = outcomeMetrics.map((row) => ({ ...row }));
  const kpiRows = agencyKpis.map((row) => ({ ...row }));
  const queries = [];
  const sameStoredValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const matchesQueryField = (row, key, value) => {
    const rowValue = row?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.$exists !== undefined && (rowValue !== undefined) !== value.$exists) return false;
      if (value.$eq !== undefined && !sameStoredValue(rowValue, value.$eq)) return false;
      if (value.$ne !== undefined && sameStoredValue(rowValue, value.$ne)) return false;
      if (value.$gte !== undefined && String(rowValue) < String(value.$gte)) return false;
      if (value.$lte !== undefined && String(rowValue) > String(value.$lte)) return false;
      return true;
    }
    return sameStoredValue(rowValue, value);
  };
  const matching = (rows, q) => {
    if (ignoreFilters) return rows;
    return rows.filter((row) => Object.entries(q || {}).every(
      ([key, value]) => matchesQueryField(row, key, value),
    ));
  };
  const queried = (entity, rows, q, sort, limit, skip = 0) => {
    queries.push({ entity, q: { ...(q || {}) }, sort, limit, skip });
    onQuery?.({ entity, rows, q, sort, limit, skip, queries });
    if (filterFailures.includes(entity)) throw new Error(`${entity} filter failed`);
    const scoped = matching(rows, q);
    return Number.isFinite(limit) ? scoped.slice(skip, skip + limit) : scoped;
  };
  const pendingApplyThenThrowStatuses = new Set(applyThenThrowRunUpdateStatuses);
  let handler;
  globalThis.Deno = {
    serve: (h) => { handler = h; },
    env: { get: (key) => key === "INTERNAL_FN_SECRET" ? internalSecret : undefined },
  };
  globalThis.__omMakeClient = () => ({
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        Agency: { filter: async (q, sort, limit, skip) => queried("Agency", agencies, q, sort, limit, skip) },
        OASISAssessment: {
          filter: async (q, sort, limit, skip) => queried("OASISAssessment", assessments, q, sort, limit, skip),
        },
        Patient: { filter: async (q, sort, limit, skip) => queried("Patient", patients, q, sort, limit, skip) },
        PatientOutcomeMetric: {
          filter: async (q, sort, limit, skip) => queried("PatientOutcomeMetric", metricRows, q, sort, limit, skip),
          create: async (payload) => {
            if (createFailures.includes("PatientOutcomeMetric")) throw new Error("metric create failed");
            written.events.push("metric:create");
            written.metrics.push(payload);
            written.metricCreates.push(payload);
            const row = { id: `m${metricRows.length + 1}`, ...payload };
            if (!unpersistedCreates.includes("PatientOutcomeMetric")) metricRows.push(row);
            return row;
          },
          update: async (id, payload) => {
            if (updateFailures.includes("PatientOutcomeMetric")) throw new Error("metric update failed");
            written.metrics.push(payload);
            written.metricUpdates.push({ id, payload });
            return { id };
          },
        },
        AgencyKPI: {
          filter: async (q, sort, limit, skip) => queried("AgencyKPI", kpiRows, q, sort, limit, skip),
          create: async (payload) => {
            if (createFailures.includes("AgencyKPI")) throw new Error("KPI create failed");
            written.events.push("kpi:create");
            written.kpis.push(payload);
            written.kpiCreates.push(payload);
            const row = { id: `k${kpiRows.length + 1}`, ...payload };
            if (!unpersistedCreates.includes("AgencyKPI")) kpiRows.push(row);
            return row;
          },
          update: async (id, payload) => {
            if (updateFailures.includes("AgencyKPI")) throw new Error("KPI update failed");
            written.kpis.push(payload);
            written.kpiUpdates.push({ id, payload });
            return { id };
          },
        },
        OutcomeComputationRun: {
          filter: async (q, sort, limit, skip) => queried("OutcomeComputationRun", runRows, q, sort, limit, skip),
          create: async (payload) => {
            if (createFailures.includes("OutcomeComputationRun")) throw new Error("run create failed");
            written.events.push("run:create");
            const row = { id: `r${runRows.length + 1}`, ...payload, ...(mutateCreatedRun || {}) };
            runRows.push(row);
            written.runs.push(payload);
            written.runCreates.push(payload);
            return row;
          },
          updateMany: async (query, operations) => {
            if (updateFailures.includes("OutcomeComputationRun")) throw new Error("run update failed");
            const payload = { ...(operations.$set || {}) };
            const status = payload.status || "metadata";
            mutateBeforeRunUpdateMany?.({ runRows, query, operations, status });
            const indexes = runRows
              .map((row, index) => ({ row, index }))
              .filter(({ row }) => Object.entries(query || {}).every(
                ([key, value]) => matchesQueryField(row, key, value),
              ))
              .map(({ index }) => index);
            written.events.push(`run:update:${payload.status || "metadata"}`);
            written.runs.push(payload);
            written.runUpdates.push({
              id: typeof query.id === "string" ? query.id : null,
              payload,
              query: structuredClone(query),
              operations: structuredClone(operations),
            });
            if (!noOpRunUpdateStatuses.includes(status)) {
              for (const index of indexes) {
                const increments = Object.fromEntries(Object.entries(
                  ignoreRunVersionIncrementStatuses.includes(status) ? {} : (operations.$inc || {}),
                ).map(
                  ([field, amount]) => [field, runRows[index][field] + amount],
                ));
                runRows[index] = {
                  ...runRows[index],
                  ...payload,
                  ...increments,
                };
              }
            }
            onRunUpdateMany?.({
              runRows,
              query,
              operations,
              status,
              matchedIndexes: [...indexes],
            });
            if (pendingApplyThenThrowStatuses.delete(status)) {
              throw new Error("run update response lost after apply");
            }
            return {
              success: !unsuccessfulRunUpdateStatuses.includes(status),
              updated: zeroRunUpdateStatuses.includes(status)
                ? 0
                : doubleUpdatedRunUpdateStatuses.includes(status) ? 2 : indexes.length,
              has_more: hasMoreRunUpdateStatuses.includes(status),
            };
          },
        },
      },
    },
  });
  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return {
    handler,
    written,
    queries,
    stored: { runRows, metricRows, kpiRows },
  };
}

async function run(
  handler,
  body = { agency_id: AGENCY_A },
  headers = { "x-internal-secret": "scheduler-secret" },
) {
  const payload = {
    period_start: "2026-06-01",
    period_end: "2026-06-01",
    period_type: "daily",
    idempotency_key: "outcome-test-run-0001",
    ...body,
  };
  const res = await handler(new Request("http://local/computeOutcomeMeasures", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  }));
  return { status: res.status, json: await res.json() };
}

/** SOC + DC pair for one patient, with the given per-item codes. */
function pair({ startCodes, dcCodes, startSchema = V2, dcSchema = V2, startRowsRaw, dcRowsRaw, agencyId = AGENCY_A, patientId = "p1" }) {
  const DEF = { M1860: "m1860_cms_e2", M1830: "m1830_cms_e2", M1400: "m1400_cms_e2", M2020: "m2020_cms_e2", M2420: "m2420_cms_e2" };
  const mk = (codes) => Object.entries(codes).map(([item, code]) => v2Row(item, DEF[item], code));
  return [
    assessment({ id: `soc-${agencyId}-${patientId}`, patientId, agencyId, visitType: "Start of Care", date: "2026-05-01", rows: startRowsRaw || mk(startCodes), schema: startSchema }),
    assessment({ id: `dc-${agencyId}-${patientId}`, patientId, agencyId, visitType: "Discharge", date: "2026-06-01", rows: dcRowsRaw || mk(dcCodes), schema: dcSchema }),
  ];
}

test("outcome computation is hard-paused before SDK access for every request shape", async () => {
  const fixture = await loadHandler({ outcomeComputationEnabled: false });
  const requests = [
    new Request("http://local/computeOutcomeMeasures", { method: "POST" }),
    new Request("http://local/computeOutcomeMeasures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    }),
    new Request("http://local/computeOutcomeMeasures", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "scheduler-secret",
      },
      body: JSON.stringify({
        agency_id: AGENCY_A,
        period_start: "2026-06-01",
        period_end: "2026-06-01",
        period_type: "daily",
        idempotency_key: "outcome-paused-run-0001",
      }),
    }),
  ];

  for (const request of requests) {
    const response = await fixture.handler(request);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Outcome computation is paused pending hosted atomicity and tenant validation",
    });
  }
  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.written.events, []);
  assert.deepEqual(fixture.written.metricCreates, []);
  assert.deepEqual(fixture.written.kpiCreates, []);
  assert.deepEqual(fixture.written.runCreates, []);
  assert.deepEqual(fixture.written.runUpdates, []);
});

test("outcome run and derived-row schemas make the server-only publication gate explicit", async () => {
  const loadSchema = async (name) => JSON.parse(await readFile(
    new URL(`../entities/${name}.jsonc`, import.meta.url),
    "utf8",
  ));
  const [runSchema, metricSchema, kpiSchema] = await Promise.all([
    loadSchema("OutcomeComputationRun"),
    loadSchema("PatientOutcomeMetric"),
    loadSchema("AgencyKPI"),
  ]);
  for (const schema of [runSchema, metricSchema, kpiSchema]) {
    assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
  }
  assert.deepEqual(runSchema.properties.status.enum, ["building", "published", "failed", "superseded"]);
  assert.equal(runSchema.properties.transition_version.type, "integer");
  assert.equal(runSchema.properties.transition_version.minimum, 1);
  assert.equal(runSchema.properties.result_summary_hash.type, "string");
  assert.equal(runSchema.properties.lease_expires_at.type, "string");
  assert.equal(runSchema.properties.lease_expires_at.format, "date-time");
  assert.ok(runSchema.required.includes("run_key"));
  assert.ok(runSchema.required.includes("window_key"));
  assert.ok(runSchema.required.includes("attempt_id"));
  assert.ok(runSchema.required.includes("transition_version"));
  assert.ok(runSchema.required.includes("lease_expires_at"));
  assert.equal(metricSchema.properties.outcome_computation_run_id.type, "string");
  assert.equal(metricSchema.properties.optional_fields_present.type, "array");
  assert.equal(metricSchema.properties.row_content_hash.type, "string");
  assert.equal(kpiSchema.properties.outcome_computation_run_id.type, "string");
  assert.equal(kpiSchema.properties.row_content_hash.type, "string");
});

test("outcome run transitions pin SDK 0.8.46 and use exact full-preimage updateMany", async () => {
  const [source, runSchema] = await Promise.all([
    readFile(new URL("../functions/computeOutcomeMeasures/entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../entities/OutcomeComputationRun.jsonc", import.meta.url), "utf8")
      .then(JSON.parse),
  ]);
  assert.match(source, /npm:@base44\/sdk@0\.8\.46/);
  assert.doesNotMatch(source, /OutcomeComputationRun\.update\s*\(/);

  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const result = await run(fixture.handler);
  assert.equal(result.status, 200);
  const publication = fixture.written.runUpdates.find(({ payload }) => payload.status === "published");
  assert.ok(publication);
  assert.deepEqual(
    Object.keys(publication.query).sort(),
    ["id", ...Object.keys(runSchema.properties)].sort(),
  );
  assert.equal(publication.query.id, result.json.outcome_computation_run_id);
  assert.equal(publication.query.agency_id, AGENCY_A);
  assert.equal(publication.query.status, "building");
  assert.equal(publication.query.transition_version, 1);
  assert.equal(
    Date.parse(publication.query.lease_expires_at) - Date.parse(publication.query.started_at),
    60 * 60 * 1000,
  );
  assert.deepEqual(publication.query.published_at, { $exists: false });
  assert.deepEqual(publication.query.failure_stage, { $exists: false });
  assert.deepEqual(publication.operations.$inc, { transition_version: 1 });
  assert.equal(publication.operations.$set.status, "published");
  const stored = fixture.stored.runRows.find((row) => row.id === publication.id);
  assert.equal(stored.status, "published");
  assert.equal(stored.transition_version, 2);
});

test("corrupt or identity-changed create preimages never reach derived writes", async () => {
  const cases = [
    { name: "terminal status", mutation: { status: "failed" } },
    { name: "wrong version", mutation: { transition_version: 2 } },
    { name: "changed agency", mutation: { agency_id: AGENCY_B } },
    { name: "terminal metadata", mutation: { failed_at: "2026-06-01T00:00:00.000Z" } },
  ];
  for (const scenario of cases) {
    const fixture = await loadHandler({
      assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
      patients: [{ id: "p1", agency_id: AGENCY_A }],
      mutateCreatedRun: scenario.mutation,
    });
    const result = await run(fixture.handler);
    assert.equal(result.status, 500, scenario.name);
    assert.equal(fixture.written.metricCreates.length, 0, scenario.name);
    assert.equal(fixture.written.kpiCreates.length, 0, scenario.name);
    assert.equal(fixture.written.runUpdates.length, 0, scenario.name);
  }
});

test("derived outcome cohorts remain append-only in the computation function", async () => {
  const source = await readFile(
    new URL("../functions/computeOutcomeMeasures/entry.ts", import.meta.url),
    "utf8",
  );
  for (const entity of ["PatientOutcomeMetric", "AgencyKPI"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`entities\\.${entity}\\.(?:update|updateMany|delete|deleteMany|bulkUpdate)\\s*\\(`),
      entity,
    );
  }
});

// ── tenant scope and authorization ──────────────────────────────────────────

test("agency_id is mandatory and a missing scope performs no service-role read or write", async () => {
  const { handler, written, queries } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
  });
  const { status, json } = await run(handler, {});
  assert.equal(status, 400);
  assert.match(json.error, /agency_id is required/i);
  assert.deepEqual(queries, []);
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpis, []);
});

test("a browser admin session cannot invoke service-role outcome computation", async () => {
  const { handler, written, queries } = await loadHandler();
  const { status, json } = await run(handler, { agency_id: AGENCY_B }, {});
  assert.equal(status, 401);
  assert.match(json.error, /internal scheduler secret required/i);
  assert.deepEqual(queries, []);
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpis, []);
});

test("the internal scheduler secret may run one explicit agency scope", async () => {
  const { handler, written } = await loadHandler({
    user: null,
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { status, json } = await run(
    handler,
    { agency_id: AGENCY_A },
    { "x-internal-secret": "scheduler-secret" },
  );
  assert.equal(status, 200);
  assert.equal(json.agency_id, AGENCY_A);
  assert.equal(written.metricCreates.length, 1);
});

test("a mutable account_type=super_admin claim cannot replace the internal secret", async () => {
  const { handler, written, queries } = await loadHandler({
    user: { id: "platform-1", role: "admin", account_type: "super_admin", is_active: true },
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const scoped = await run(handler, { agency_id: AGENCY_A }, {});
  assert.equal(scoped.status, 401);
  assert.equal(written.metricCreates.length, 0);
  assert.deepEqual(queries, []);

  const unscoped = await run(handler, {});
  assert.equal(unscoped.status, 400);
});

test("self-asserted mutable account_type and agency_id claims cannot elevate a normal user", async () => {
  const { handler, written, queries } = await loadHandler({
    user: {
      id: "attacker",
      email: "attacker@example.test",
      role: "user",
      account_type: "super_admin",
      agency_id: AGENCY_A,
      is_active: true,
    },
  });
  const { status } = await run(handler, { agency_id: AGENCY_A }, {});
  assert.equal(status, 401);
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpis, []);
  assert.deepEqual(queries, [], "self-promoted claims must be denied before any service-role query");
});

test("an explicit stable period is mandatory before any service-role query", async () => {
  const { handler, written, queries } = await loadHandler();
  const { status, json } = await run(handler, {
    agency_id: AGENCY_A,
    period_start: null,
    period_end: null,
  });
  assert.equal(status, 400);
  assert.match(json.error, /period_start and period_end/i);
  assert.deepEqual(queries, []);
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpis, []);
});

test("an explicit supported period_type is mandatory before any service-role query", async () => {
  const { handler, written, queries } = await loadHandler();
  const { status, json } = await run(handler, { agency_id: AGENCY_A, period_type: "rolling" });
  assert.equal(status, 400);
  assert.match(json.error, /period_type is required/i);
  assert.deepEqual(queries, []);
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpis, []);
});

test("a stable idempotency key is mandatory before any service-role query", async () => {
  const { handler, written, queries } = await loadHandler();
  const { status, json } = await run(handler, {
    agency_id: AGENCY_A,
    idempotency_key: null,
  });
  assert.equal(status, 400);
  assert.match(json.error, /idempotency_key is required/i);
  assert.deepEqual(queries, []);
  assert.deepEqual(written.runCreates, []);
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpis, []);
});

test("an invalid benchmark is rejected before any service-role query", async () => {
  const { handler, written, queries } = await loadHandler();
  const { status, json } = await run(handler, {
    agency_id: AGENCY_A,
    benchmark: 101,
  });
  assert.equal(status, 400);
  assert.match(json.error, /finite percentage from 0 through 100/i);
  assert.deepEqual(queries, []);
  assert.deepEqual(written.runCreates, []);
});

test("an explicitly labelled custom stable window is preserved honestly", async () => {
  const { handler } = await loadHandler();
  const { status, json } = await run(handler, {
    agency_id: AGENCY_A,
    period_start: "2026-05-12",
    period_end: "2026-06-01",
    period_type: "custom",
  });
  assert.equal(status, 200);
  assert.equal(json.period_type, "custom");
});

test("a published idempotency key replays the saved summary without creating another generation", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const first = await run(handler);
  assert.equal(first.status, 200);
  assert.equal(first.json.idempotent_replay, false);
  assert.match(first.json.generation_fingerprint, /^[a-f0-9]{64}$/);
  const firstKpiCount = written.kpiCreates.length;

  const replay = await run(handler);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.idempotent_replay, true);
  assert.equal(replay.json.outcome_computation_run_id, first.json.outcome_computation_run_id);
  assert.equal(replay.json.generation_fingerprint, first.json.generation_fingerprint);
  assert.equal(written.runCreates.length, 1);
  assert.match(written.runCreates[0].run_key, /^[a-f0-9]{64}$/);
  assert.ok(!Object.hasOwn(written.runCreates[0], "idempotency_key"));
  assert.equal(written.metricCreates.length, 1);
  assert.equal(written.kpiCreates.length, firstKpiCount);
  assert.ok(!Object.hasOwn(replay.json, "skip_reasons"), "the persisted replay summary stays non-PHI");
});

test("replay rejects an extra same-attempt row carrying the wrong generation fingerprint", async () => {
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const first = await run(fixture.handler);
  assert.equal(first.status, 200);
  const valid = fixture.stored.metricRows.find((row) =>
    row.outcome_computation_run_id === first.json.outcome_computation_run_id);
  assert.ok(valid);
  fixture.stored.metricRows.push({
    ...valid,
    id: "malformed-extra-metric",
    generation_fingerprint: "0".repeat(64),
  });

  const replay = await run(fixture.handler);
  assert.equal(replay.status, 409);
  assert.equal(replay.json.success, false);
  assert.match(replay.json.error, /mismatched fingerprint/i);
  assert.equal(fixture.written.runCreates.length, 1);
});

test("published replay rejects diagnosis, measure, and KPI mutations that retain provenance tags", async () => {
  const cases = [
    {
      collection: "metricRows",
      mutate: (row) => { row.primary_diagnosis = "E11.9"; },
    },
    {
      collection: "metricRows",
      mutate: (row) => { row.measure_results[0].discharge_value = "01"; },
    },
    {
      collection: "kpiRows",
      mutate: (row) => { row.metric_value = 25; },
    },
  ];

  for (const { collection, mutate } of cases) {
    const fixture = await loadHandler({
      assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
      patients: [{
        id: "p1",
        agency_id: AGENCY_A,
        primary_diagnosis: "I10",
      }],
    });
    const first = await run(fixture.handler);
    assert.equal(first.status, 200, collection);
    const row = fixture.stored[collection].find((candidate) =>
      candidate.outcome_computation_run_id === first.json.outcome_computation_run_id);
    assert.ok(row, collection);
    const copiedFingerprint = row.generation_fingerprint;
    const copiedRowHash = row.row_content_hash;
    assert.match(copiedFingerprint, /^[a-f0-9]{64}$/, collection);
    assert.match(copiedRowHash, /^[a-f0-9]{64}$/, collection);

    mutate(row);
    assert.equal(row.generation_fingerprint, copiedFingerprint, collection);
    assert.equal(row.row_content_hash, copiedRowHash, collection);
    const replay = await run(fixture.handler);
    assert.equal(replay.status, 409, collection);
    assert.equal(replay.json.success, false, collection);
    assert.match(replay.json.error, /mutated row content/i, collection);
  }
});

test("published replay rejects version drift and failed-terminal metadata", async () => {
  const cases = [
    { name: "version three", mutate: (row) => { row.transition_version = 3; } },
    {
      name: "failed metadata",
      mutate: (row) => {
        row.failed_at = "2026-06-02T00:00:00.000Z";
        row.failure_stage = "post_publish_corruption";
      },
    },
  ];
  for (const scenario of cases) {
    const fixture = await loadHandler({
      assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
      patients: [{ id: "p1", agency_id: AGENCY_A }],
    });
    const first = await run(fixture.handler);
    assert.equal(first.status, 200, scenario.name);
    const stored = fixture.stored.runRows.find(
      (row) => row.id === first.json.outcome_computation_run_id,
    );
    scenario.mutate(stored);
    const replay = await run(fixture.handler);
    assert.equal(replay.status, 409, scenario.name);
    assert.equal(replay.json.success, false, scenario.name);
    assert.match(replay.json.error, /not replayable/i, scenario.name);
  }
});

test("published replay rejects missing or changed immutable lease evidence", async () => {
  const cases = [
    {
      name: "missing lease",
      mutate: (row) => { delete row.lease_expires_at; },
    },
    {
      name: "changed duration",
      mutate: (row) => { row.lease_expires_at = row.started_at; },
    },
  ];
  for (const scenario of cases) {
    const fixture = await loadHandler({
      assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
      patients: [{ id: "p1", agency_id: AGENCY_A }],
    });
    const first = await run(fixture.handler);
    assert.equal(first.status, 200, scenario.name);
    const stored = fixture.stored.runRows.find(
      (row) => row.id === first.json.outcome_computation_run_id,
    );
    scenario.mutate(stored);

    const replay = await run(fixture.handler);
    assert.equal(replay.status, 409, scenario.name);
    assert.equal(replay.json.success, false, scenario.name);
    assert.match(replay.json.error, /not replayable/i, scenario.name);
    assert.equal(fixture.written.runCreates.length, 1, scenario.name);
  }
});

test("published replay binds the canonical summary hash and reconciles stored counts", async () => {
  const cases = [
    {
      name: "summary content without hash update",
      mutate: (row) => { row.result_summary.discharge_rows_returned += 1; },
      expected: /summary hash/i,
    },
    {
      name: "count with recomputed hash",
      mutate: (row) => {
        row.result_summary.patient_outcome_metrics_written += 1;
        row.result_summary_hash = canonicalSha256(row.result_summary);
      },
      expected: /metadata is incomplete or inconsistent/i,
    },
  ];
  for (const scenario of cases) {
    const fixture = await loadHandler({
      assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
      patients: [{ id: "p1", agency_id: AGENCY_A }],
    });
    const first = await run(fixture.handler);
    assert.equal(first.status, 200, scenario.name);
    const stored = fixture.stored.runRows.find(
      (row) => row.id === first.json.outcome_computation_run_id,
    );
    assert.equal(stored.result_summary_hash, canonicalSha256(stored.result_summary));
    scenario.mutate(stored);
    const replay = await run(fixture.handler);
    assert.equal(replay.status, 409, scenario.name);
    assert.match(replay.json.error, scenario.expected, scenario.name);
  }
});

test("replay rejects a second published run for the same window under another key", async () => {
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const first = await run(fixture.handler);
  assert.equal(first.status, 200);
  const original = fixture.stored.runRows.find((row) => row.id === first.json.outcome_computation_run_id);
  assert.ok(original);
  fixture.stored.runRows.push({
    ...original,
    id: "conflicting-published-window-run",
    run_key: "f".repeat(64),
    attempt_id: "conflicting-attempt",
  });

  const replay = await run(fixture.handler);
  assert.equal(replay.status, 409);
  assert.equal(replay.json.success, false);
  assert.match(replay.json.error, /multiple or conflicting published runs/i);
});

test("a second idempotency key cannot ambiguously publish the same logical window", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const first = await run(handler, { agency_id: AGENCY_A, benchmark: 80 });
  const second = await run(handler, { agency_id: AGENCY_A, benchmark: 90 });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(first.json.idempotent_replay, false);
  assert.match(second.json.error, /atomic supersession is not available/i);
  assert.equal(written.runCreates.length, 1);
  assert.equal(written.runCreates[0].benchmark_value, 80);
});

test("the final claim rejects multiple competing window publications instead of choosing one", async () => {
  let windowQueryCount = 0;
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    onQuery: ({ entity, rows, q }) => {
      if (entity !== "OutcomeComputationRun" || !q?.window_key) return;
      windowQueryCount += 1;
      if (windowQueryCount !== 2) return;
      const building = rows.find((row) => row.status === "building" && row.window_key === q.window_key);
      assert.ok(building);
      rows.push(
        { ...building, id: "competing-published-a", status: "published" },
        { ...building, id: "competing-published-b", status: "published" },
      );
    },
  });
  const { status, json } = await run(handler);
  assert.equal(status, 409);
  assert.equal(json.success, false);
  assert.match(json.error, /multiple published runs exist for this reporting window/i);
  assert.ok(written.runUpdates.some(({ payload }) => payload.status === "superseded"));
  assert.ok(!written.runUpdates.some(({ payload }) => payload.status === "published"));
});

test("full-preimage CAS cannot overwrite a concurrent terminal run transition", async () => {
  let injected = false;
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    mutateBeforeRunUpdateMany: ({ runRows, query, status }) => {
      if (injected || status !== "published") return;
      injected = true;
      const index = runRows.findIndex((row) => row.id === query.id);
      assert.notEqual(index, -1);
      runRows[index] = {
        ...runRows[index],
        status: "superseded",
        transition_version: 2,
        failure_stage: "concurrent_terminal_transition",
      };
    },
  });
  const result = await run(fixture.handler);
  assert.equal(result.status, 500);
  assert.equal(injected, true);
  assert.equal(fixture.stored.runRows[0].status, "superseded");
  assert.equal(fixture.stored.runRows[0].transition_version, 2);
  assert.equal(fixture.stored.runRows[0].failure_stage, "concurrent_terminal_transition");
});

test("conditional run transitions reject zero updates, partial batches, and unsuccessful results", async () => {
  const cases = [
    {
      name: "zero update",
      options: { zeroRunUpdateStatuses: ["published"], noOpRunUpdateStatuses: ["published"] },
      committed: false,
    },
    {
      name: "has_more",
      options: { hasMoreRunUpdateStatuses: ["published"] },
      committed: true,
    },
    {
      name: "success false",
      options: { unsuccessfulRunUpdateStatuses: ["published"] },
      committed: true,
    },
    {
      name: "updated two",
      options: { doubleUpdatedRunUpdateStatuses: ["published"] },
      committed: true,
    },
  ];
  for (const scenario of cases) {
    const fixture = await loadHandler({
      assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
      patients: [{ id: "p1", agency_id: AGENCY_A }],
      ...scenario.options,
    });
    const first = await run(fixture.handler);
    assert.equal(first.status, 500, scenario.name);
    assert.equal(
      fixture.stored.runRows[0].status,
      scenario.committed ? "published" : "building",
      scenario.name,
    );
    if (scenario.committed) {
      const replay = await run(fixture.handler);
      assert.equal(replay.status, 200, scenario.name);
      assert.equal(replay.json.idempotent_replay, true, scenario.name);
    }
  }
});

test("publication readback rejects a set applied without its version increment", async () => {
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    ignoreRunVersionIncrementStatuses: ["published"],
  });
  const first = await run(fixture.handler);
  assert.equal(first.status, 500);
  assert.equal(fixture.stored.runRows[0].status, "published");
  assert.equal(fixture.stored.runRows[0].transition_version, 1);
  const attempted = fixture.written.runUpdates.find(({ payload }) => payload.status === "published");
  assert.deepEqual(attempted.operations.$inc, { transition_version: 1 });
  const replay = await run(fixture.handler);
  assert.equal(replay.status, 409);
  assert.match(replay.json.error, /not replayable/i);
});

test("an optional terminal field appearing before CAS prevents publication", async () => {
  let injected = false;
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    mutateBeforeRunUpdateMany: ({ runRows, query, status }) => {
      if (injected || status !== "published") return;
      const row = runRows.find((candidate) => candidate.id === query.id);
      row.failed_at = "2026-06-02T00:00:00.000Z";
      injected = true;
    },
  });
  const result = await run(fixture.handler);
  assert.equal(result.status, 500);
  assert.equal(injected, true);
  assert.equal(fixture.stored.runRows[0].status, "building");
  assert.equal(fixture.stored.runRows[0].transition_version, 1);
  assert.equal(fixture.stored.runRows[0].failed_at, "2026-06-02T00:00:00.000Z");
});

test("a lost publication response is recovered only by validated idempotent replay", async () => {
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    applyThenThrowRunUpdateStatuses: ["published"],
  });
  const first = await run(fixture.handler);
  assert.equal(first.status, 500);
  assert.equal(fixture.stored.runRows[0].status, "published");
  assert.equal(fixture.stored.runRows[0].transition_version, 2);
  assert.equal(
    fixture.written.runUpdates.filter(({ payload }) => payload.status === "failed").length,
    0,
  );

  const replay = await run(fixture.handler);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.idempotent_replay, true);
  assert.equal(fixture.written.runCreates.length, 1);
});

test("an expired building lease is failed by full-preimage CAS before a separate retry", async () => {
  const noOpStatuses = ["published"];
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    noOpRunUpdateStatuses: noOpStatuses,
  });

  // Simulate a process whose publication transition never became durable and
  // whose catch block intentionally left the ambiguous building row alone.
  const interrupted = await run(fixture.handler);
  assert.equal(interrupted.status, 500);
  assert.equal(fixture.stored.runRows.length, 1);
  assert.equal(fixture.stored.runRows[0].status, "building");
  noOpStatuses.length = 0;

  fixture.stored.runRows[0].started_at = "2026-06-01T00:00:00.000Z";
  fixture.stored.runRows[0].lease_expires_at = "2026-06-01T01:00:00.000Z";
  const createsBeforeRecovery = {
    runs: fixture.written.runCreates.length,
    metrics: fixture.written.metricCreates.length,
    kpis: fixture.written.kpiCreates.length,
  };
  const recovered = await run(fixture.handler);

  assert.equal(recovered.status, 409);
  assert.equal(recovered.json.success, false);
  assert.equal(recovered.json.expired_runs_reconciled, 1);
  assert.equal(recovered.json.expired_runs_remaining, 0);
  assert.equal(recovered.json.retry_with_same_key, true);
  assert.deepEqual({
    runs: fixture.written.runCreates.length,
    metrics: fixture.written.metricCreates.length,
    kpis: fixture.written.kpiCreates.length,
  }, createsBeforeRecovery, "reconciliation is terminal-only and never creates or promotes data");
  assert.equal(fixture.stored.runRows[0].status, "failed");
  assert.equal(fixture.stored.runRows[0].transition_version, 2);
  assert.equal(fixture.stored.runRows[0].failure_stage, "expired_run_lease_reconciled");
  assert.match(fixture.stored.runRows[0].failed_at, /^\d{4}-\d{2}-\d{2}T/);

  const replacement = await run(fixture.handler);
  assert.equal(replacement.status, 200);
  assert.equal(replacement.json.idempotent_replay, false);
  assert.equal(fixture.written.runCreates.length, 2);
  assert.equal(fixture.stored.runRows.filter((row) => row.status === "failed").length, 1);
  assert.equal(fixture.stored.runRows.filter((row) => row.status === "published").length, 1);
});

test("an unexpired building lease remains live and is never reclaimed", async () => {
  const noOpStatuses = ["published"];
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    noOpRunUpdateStatuses: noOpStatuses,
  });
  const interrupted = await run(fixture.handler);
  assert.equal(interrupted.status, 500);
  noOpStatuses.length = 0;
  const terminalUpdatesBeforeRetry = fixture.written.runUpdates.length;

  const retry = await run(fixture.handler);
  assert.equal(retry.status, 409);
  assert.match(retry.json.error, /unpublished attempt already holds/i);
  assert.equal(fixture.stored.runRows[0].status, "building");
  assert.equal(fixture.stored.runRows[0].transition_version, 1);
  assert.equal(fixture.written.runUpdates.length, terminalUpdatesBeforeRetry);
  assert.equal(fixture.written.runCreates.length, 1);
});

test("expired-run reconciliation is capped and requires another request for the remainder", async () => {
  const noOpStatuses = ["published"];
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    noOpRunUpdateStatuses: noOpStatuses,
  });
  const interrupted = await run(fixture.handler);
  assert.equal(interrupted.status, 500);
  noOpStatuses.length = 0;

  const original = fixture.stored.runRows[0];
  original.started_at = "2026-06-01T00:00:00.000Z";
  original.lease_expires_at = "2026-06-01T01:00:00.000Z";
  for (let index = 0; index < 10; index += 1) {
    fixture.stored.runRows.push({
      ...original,
      id: `expired-run-${String(index).padStart(2, "0")}`,
      run_key: String(index + 1).padStart(64, "0"),
      attempt_id: `expired-attempt-${index}`,
    });
  }

  const firstRecovery = await run(fixture.handler);
  assert.equal(firstRecovery.status, 409);
  assert.equal(firstRecovery.json.expired_runs_reconciled, 10);
  assert.equal(firstRecovery.json.expired_runs_remaining, 1);
  assert.equal(fixture.stored.runRows.filter((row) => row.status === "failed").length, 10);
  assert.equal(fixture.stored.runRows.filter((row) => row.status === "building").length, 1);

  const secondRecovery = await run(fixture.handler);
  assert.equal(secondRecovery.status, 409);
  assert.equal(secondRecovery.json.expired_runs_reconciled, 1);
  assert.equal(secondRecovery.json.expired_runs_remaining, 0);
  assert.equal(fixture.stored.runRows.filter((row) => row.status === "failed").length, 11);
  assert.equal(fixture.written.runCreates.length, 1, "recovery requests do not create replacements");
});

test("expired-run recovery loses safely to a concurrent terminal transition", async () => {
  const noOpStatuses = ["published"];
  let injected = false;
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    noOpRunUpdateStatuses: noOpStatuses,
    mutateBeforeRunUpdateMany: ({ runRows, query, operations, status }) => {
      if (injected || status !== "failed" ||
          operations.$set?.failure_stage !== "expired_run_lease_reconciled") return;
      const index = runRows.findIndex((row) => row.id === query.id);
      assert.notEqual(index, -1);
      runRows[index] = {
        ...runRows[index],
        status: "superseded",
        transition_version: 2,
        failure_stage: "concurrent_operator_reconciliation",
      };
      injected = true;
    },
  });
  const interrupted = await run(fixture.handler);
  assert.equal(interrupted.status, 500);
  noOpStatuses.length = 0;
  fixture.stored.runRows[0].started_at = "2026-06-01T00:00:00.000Z";
  fixture.stored.runRows[0].lease_expires_at = "2026-06-01T01:00:00.000Z";

  const recovery = await run(fixture.handler);
  assert.equal(recovery.status, 500);
  assert.equal(recovery.json.success, false);
  assert.equal(injected, true);
  assert.equal(fixture.stored.runRows[0].status, "superseded");
  assert.equal(fixture.stored.runRows[0].transition_version, 2);
  assert.equal(fixture.stored.runRows[0].failure_stage, "concurrent_operator_reconciliation");
  assert.equal(fixture.written.runCreates.length, 1);
});

test("a building run without exact lease evidence fails closed for operator review", async () => {
  const noOpStatuses = ["published"];
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    noOpRunUpdateStatuses: noOpStatuses,
  });
  const interrupted = await run(fixture.handler);
  assert.equal(interrupted.status, 500);
  noOpStatuses.length = 0;
  delete fixture.stored.runRows[0].lease_expires_at;
  const updatesBeforeRetry = fixture.written.runUpdates.length;

  const retry = await run(fixture.handler);
  assert.equal(retry.status, 409);
  assert.equal(retry.json.requires_operator_review, true);
  assert.match(retry.json.error, /recovery-lease evidence/i);
  assert.equal(fixture.stored.runRows[0].status, "building");
  assert.equal(fixture.written.runUpdates.length, updatesBeforeRetry);
  assert.equal(fixture.written.runCreates.length, 1);
});

test("post-publication window readback reports a newly visible competing publication", async () => {
  let inserted = false;
  const fixture = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    onRunUpdateMany: ({ runRows, query, status }) => {
      if (inserted || status !== "published") return;
      const published = runRows.find((row) => row.id === query.id);
      assert.ok(published);
      runRows.push({
        ...published,
        id: "late-competing-publication",
        run_key: "f".repeat(64),
        attempt_id: "late-competing-attempt",
      });
      inserted = true;
    },
  });
  const result = await run(fixture.handler);
  assert.equal(result.status, 409);
  assert.equal(result.json.success, false);
  assert.equal(result.json.requires_operator_review, true);
  assert.match(result.json.error, /publication conflict/i);
  assert.equal(fixture.stored.runRows.filter((row) => row.status === "published").length, 2);
});

test("distinct run rows remain outside the scope of per-record full-preimage CAS", async () => {
  const source = await readFile(
    new URL("../functions/computeOutcomeMeasures/entry.ts", import.meta.url),
    "utf8",
  );
  const sameWindow = "shared-window-key";
  const contenders = [
    { id: "run-a", window_key: sameWindow, status: "building", transition_version: 1 },
    { id: "run-b", window_key: sameWindow, status: "building", transition_version: 1 },
  ];
  const ownPreimageMatches = (row, preimage) => Object.entries(preimage).every(
    ([field, value]) => row[field] === value,
  );
  assert.equal(ownPreimageMatches(contenders[0], contenders[0]), true);
  assert.equal(ownPreimageMatches(contenders[1], contenders[1]), true);
  assert.notEqual(contenders[0].id, contenders[1].id);
  assert.equal(contenders[0].window_key, contenders[1].window_key);
  assert.match(source, /cannot close the[\s\S]*final phantom window/);
  assert.match(source, /datastore uniqueness or a proved[\s\S]*single-record lease/);
});

test("append-only output cannot inherit optional values from an older metric", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    outcomeMetrics: [{
      id: "old-generation",
      agency_id: AGENCY_A,
      patient_id: "p1",
      episode_start: "2026-05-01",
      episode_end: "2026-06-01",
      primary_diagnosis: "stale diagnosis",
      discharge_disposition: "hospital",
      internal_gg_18_item_raw_sum: 72,
    }],
  });
  const { status } = await run(handler);
  assert.equal(status, 200);
  assert.deepEqual(written.metricUpdates, []);
  assert.equal(written.metricCreates.length, 1);
  const fresh = written.metricCreates[0];
  assert.deepEqual(fresh.optional_fields_present, []);
  assert.ok(!Object.hasOwn(fresh, "primary_diagnosis"));
  assert.ok(!Object.hasOwn(fresh, "discharge_disposition"));
  assert.ok(!Object.hasOwn(fresh, "internal_gg_18_item_raw_sum"));
});

test("staged-row readback blocks publication when a create response was not durably visible", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    unpersistedCreates: ["PatientOutcomeMetric"],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.equal(written.metricCreates.length, 1, "the mocked API still returned a create result");
  assert.equal(written.runUpdates.at(-1).payload.status, "failed");
  assert.equal(written.runUpdates.at(-1).payload.failure_stage, "reconcile_staged_generation");
  assert.ok(!written.runUpdates.some(({ payload }) => payload.status === "published"));
});

test("staged readback rejects diagnosis, measure, and KPI tampering under a copied generation fingerprint", async () => {
  const cases = [
    {
      entity: "PatientOutcomeMetric",
      mutate: (row) => { row.primary_diagnosis = "E11.9"; },
    },
    {
      entity: "PatientOutcomeMetric",
      mutate: (row) => { row.measure_results[0].discharge_value = "01"; },
    },
    {
      entity: "AgencyKPI",
      mutate: (row) => { row.metric_value = 25; },
    },
  ];

  for (const { entity, mutate } of cases) {
    let tampered = false;
    let copiedFingerprint = null;
    const fixture = await loadHandler({
      assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
      patients: [{
        id: "p1",
        agency_id: AGENCY_A,
        primary_diagnosis: "I10",
      }],
      onQuery: ({ entity: queriedEntity, rows, q }) => {
        if (tampered || queriedEntity !== entity || !q?.outcome_computation_run_id) return;
        const row = rows.find((candidate) =>
          candidate.outcome_computation_run_id === q.outcome_computation_run_id);
        assert.ok(row);
        assert.match(row.row_content_hash, /^[a-f0-9]{64}$/);
        copiedFingerprint = row.generation_fingerprint;
        mutate(row);
        assert.equal(row.generation_fingerprint, copiedFingerprint);
        tampered = true;
      },
    });
    const { status, json } = await run(fixture.handler);
    assert.equal(status, 500, entity);
    assert.equal(json.success, false, entity);
    assert.equal(tampered, true, entity);
    assert.match(copiedFingerprint, /^[a-f0-9]{64}$/, entity);
    assert.equal(fixture.written.runUpdates.at(-1).payload.status, "failed", entity);
    assert.equal(
      fixture.written.runUpdates.at(-1).payload.failure_stage,
      "reconcile_staged_generation",
      entity,
    );
    assert.ok(
      !fixture.written.runUpdates.some(({ payload }) => payload.status === "published"),
      entity,
    );
  }
});

test("generation fingerprints are deterministic when service rows arrive in a different order", async () => {
  const p1 = pair({
    startCodes: { M1860: "3" },
    dcCodes: { M1860: "1" },
    patientId: "p1",
  });
  const p2 = pair({
    startCodes: { M1860: "5" },
    dcCodes: { M1860: "2" },
    patientId: "p2",
  });
  const options = {
    patients: [
      { id: "p1", agency_id: AGENCY_A },
      { id: "p2", agency_id: AGENCY_A },
    ],
  };
  const first = await loadHandler({ ...options, assessments: [...p1, ...p2] });
  const second = await loadHandler({ ...options, assessments: [...p2, ...p1] });
  const firstResult = await run(first.handler);
  const secondResult = await run(second.handler);
  assert.equal(firstResult.status, 200);
  assert.equal(secondResult.status, 200);
  assert.equal(firstResult.json.generation_fingerprint, secondResult.json.generation_fingerprint);
});

test("an ambiguous publication response never returns false success", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    updateFailures: ["OutcomeComputationRun"],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.equal(written.metricCreates.length, 1);
  assert.ok(written.kpiCreates.length > 0);
  assert.ok(!written.runUpdates.some(({ payload }) => payload.status === "published"));
});

test("a nonthrowing no-op publication update is caught by run readback", async () => {
  const { handler, written, stored } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    noOpRunUpdateStatuses: ["published"],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.equal(written.runUpdates.at(-1).payload.status, "published", "the update was attempted");
  assert.equal(stored.runRows[0].status, "building", "the mocked datastore did not apply it");
});

test("a failed metric stage marks the run failed and never publishes a partial generation", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    createFailures: ["PatientOutcomeMetric"],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.deepEqual(written.metricCreates, []);
  assert.deepEqual(written.kpis, []);
  assert.equal(written.runUpdates.at(-1).payload.status, "failed");
  assert.equal(written.runUpdates.at(-1).payload.failure_stage, "stage_patient_outcome_metrics");
  assert.ok(!written.runUpdates.some(({ payload }) => payload.status === "published"));
});

test("a failed patient lookup cannot be treated as a non-deceased patient", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A, status: "deceased" }],
    filterFailures: ["Patient"],
  });
  const { status } = await run(handler);
  assert.equal(status, 500);
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpis, []);
});

test("a failed KPI stage leaves metric rows unpublished and marks the run failed", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    createFailures: ["AgencyKPI"],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.equal(written.metricCreates.length, 1, "the completed metric stage remains audit debris");
  assert.deepEqual(written.kpiCreates, []);
  assert.deepEqual(written.metricUpdates, []);
  assert.equal(written.runUpdates.at(-1).payload.status, "failed");
  assert.equal(written.runUpdates.at(-1).payload.failure_stage, "stage_agency_kpis");
  assert.ok(!written.runUpdates.some(({ payload }) => payload.status === "published"));
});

test("in-period missing patient and start-assessment skips are reported explicitly", async () => {
  const missingPatient = assessment({
    id: "dc-no-patient",
    patientId: "",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const missingDate = assessment({
    id: "dc-no-date",
    patientId: "p-date",
    visitType: "Discharge",
    date: null,
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const noStart = assessment({
    id: "dc-no-start",
    patientId: "p-no-start",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const undatedStart = assessment({
    id: "soc-no-date",
    patientId: "p-undated-start",
    visitType: "Start of Care",
    date: null,
    rows: [v2Row("M1860", "m1860_cms_e2", "3")],
  });
  const dischargeAfterUndatedStart = assessment({
    id: "dc-after-undated-start",
    patientId: "p-undated-start",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const { handler, written } = await loadHandler({
    assessments: [
      missingPatient,
      missingDate,
      noStart,
      undatedStart,
      dischargeAfterUndatedStart,
    ],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.skipped_missing_patient_id, 1);
  assert.equal(json.skipped_missing_episode_date, 1);
  assert.equal(json.skipped_missing_discharge_date, 0);
  assert.equal(json.skipped_missing_start_date, 1);
  assert.equal(json.skipped_missing_start_assessment, 1);
  assert.equal(json.skip_reasons.length, 3);
  assert.equal(json.unscoped_discharge_date_quality_not_scanned, true);
  assert.ok(json.skip_reasons.some((skip) =>
    skip.reasons.includes("missing_start_assessment_date")));
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpiCreates, []);
});

test("invalid in-scope start dates are reported while invalid discharge dates stay outside the provider range", async () => {
  const invalidDischarge = assessment({
    id: "dc-invalid-date",
    patientId: "p-invalid-dc",
    visitType: "Discharge",
    date: "not-a-date",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const invalidStart = assessment({
    id: "soc-invalid-date",
    patientId: "p-invalid-start",
    visitType: "Start of Care",
    date: "still-not-a-date",
    rows: [v2Row("M1860", "m1860_cms_e2", "3")],
  });
  const discharge = assessment({
    id: "dc-after-invalid-start",
    patientId: "p-invalid-start",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const { handler, written } = await loadHandler({
    assessments: [invalidDischarge, invalidStart, discharge],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.skipped_invalid_discharge_date, 0);
  assert.equal(json.skipped_invalid_start_date, 1);
  assert.equal(json.unscoped_discharge_date_quality_not_scanned, true);
  assert.ok(!json.skip_reasons.some((skip) =>
    skip.reasons.includes("invalid_discharge_assessment_date")));
  assert.ok(json.skip_reasons.some((skip) =>
    skip.reasons.includes("invalid_start_assessment_date")));
  assert.deepEqual(written.metrics, []);
});

test("KPI excluded_episode_count includes every in-period episode skip once", async () => {
  const valid = pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } });
  const noPatient = assessment({
    id: "dc-no-patient-for-count",
    patientId: "",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const noStart = assessment({
    id: "dc-no-start-for-count",
    patientId: "p-no-start-count",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const { handler, written } = await loadHandler({
    assessments: [...valid, noPatient, noStart],
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.excluded_episode_count, 2);
  assert.ok(written.kpiCreates.length > 0);
  assert.ok(written.kpiCreates.every((kpi) => kpi.excluded_episode_count === 2));
});

test("discharge reads paginate beyond the first 500 rows", async () => {
  const assessments = Array.from({ length: 501 }, (_, index) => assessment({
    id: `dc-${index}`,
    patientId: "",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  }));
  const { handler, written, queries } = await loadHandler({ assessments });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.discharge_rows_returned, 501);
  assert.equal(json.skipped_missing_patient_id, 501);
  assert.equal(json.discharge_query_may_be_truncated, false);
  const dischargeQueries = queries.filter(({ entity, q }) =>
    entity === "OASISAssessment" && q.visit_type === "Discharge");
  assert.deepEqual(dischargeQueries[0].q.assessment_date, {
    $gte: "2026-06-01",
    $lte: "2026-06-01T23:59:59.999",
  });
  assert.deepEqual(dischargeQueries.map(({ limit, skip }) => ({ limit, skip })), [
    { limit: 500, skip: 0 },
    { limit: 500, skip: 500 },
  ]);
  assert.deepEqual(written.metrics, []);
});

test("more than 50,000 lifetime discharges do not block a small provider-scoped period", async () => {
  const historical = Array.from({ length: 50_001 }, (_, index) => ({
    id: `historical-dc-${index}`,
    agency_id: AGENCY_A,
    patient_id: "",
    visit_type: "Discharge",
    assessment_date: "2026-05-31",
    oasis_items: [],
  }));
  const current = assessment({
    id: "current-period-dc",
    patientId: "",
    visitType: "Discharge",
    date: "2026-06-01T18:30:00.000Z",
    rows: [],
  });
  const { handler, queries } = await loadHandler({ assessments: [...historical, current] });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.discharge_provider_period_scoped, true);
  assert.equal(json.discharge_rows_returned, 1);
  assert.equal(json.discharges_in_period, 1);
  const dischargeQueries = queries.filter(({ entity, q }) =>
    entity === "OASISAssessment" && q.visit_type === "Discharge");
  assert.equal(dischargeQueries.length, 1, "the out-of-period lifetime rows never consume paging capacity");
});

test("patient history pagination can find a start assessment beyond row 500", async () => {
  const dc = assessment({
    id: "dc-paged-prior",
    patientId: "p-paged",
    visitType: "Discharge",
    date: "2026-06-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "1")],
  });
  const intervening = Array.from({ length: 500 }, (_, index) => assessment({
    id: `followup-${index}`,
    patientId: "p-paged",
    visitType: "Follow Up",
    date: "2026-05-15",
    rows: [],
  }));
  const soc = assessment({
    id: "soc-paged-prior",
    patientId: "p-paged",
    visitType: "Start of Care",
    date: "2026-05-01",
    rows: [v2Row("M1860", "m1860_cms_e2", "3")],
  });
  const { handler, written, queries } = await loadHandler({
    assessments: [dc, ...intervening, soc],
    patients: [{ id: "p-paged", agency_id: AGENCY_A }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.patient_outcome_metrics_written, 1);
  assert.equal(written.metricCreates.length, 1);
  const priorQueries = queries.filter(({ entity, q }) =>
    entity === "OASISAssessment" && q.patient_id === "p-paged");
  assert.deepEqual(priorQueries.map(({ limit, skip }) => ({ limit, skip })), [
    { limit: 500, skip: 0 },
    { limit: 500, skip: 500 },
  ]);
});

test("cross-tenant rows leaked by a service response are rejected in memory", async () => {
  const assessments = [
    ...pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" }, agencyId: AGENCY_A, patientId: "pa" }),
    ...pair({ startCodes: { M1860: "6" }, dcCodes: { M1860: "5" }, agencyId: AGENCY_B, patientId: "pb" }),
  ];
  const { handler, written } = await loadHandler({
    assessments,
    patients: [
      { id: "pa", agency_id: AGENCY_A },
      { id: "pb", agency_id: AGENCY_B },
    ],
    outcomeMetrics: [{
      id: "foreign-existing-metric",
      agency_id: AGENCY_B,
      patient_id: "pa",
      episode_start: "2026-05-01",
      episode_end: "2026-06-01",
    }],
    agencyKpis: [{
      id: "foreign-existing-kpi",
      agency_id: AGENCY_B,
      metric_name: "Improvement in Ambulation/Locomotion",
      metric_category: "quality",
      period_start: "2026-06-01",
      period_end: "2026-06-01",
    }],
    ignoreFilters: true,
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.discharges_evaluated, 1);
  assert.equal(written.metricCreates.length, 1);
  assert.equal(written.metricCreates[0].agency_id, AGENCY_A);
  assert.equal(written.metricCreates[0].patient_id, "pa");
  assert.deepEqual(written.metricUpdates, [], "a foreign metric must never become an upsert target");
  assert.deepEqual(written.kpiUpdates, [], "a foreign KPI must never become an upsert target");
  assert.ok(written.kpiCreates.every((row) => row.agency_id === AGENCY_A));
});

test("an excluded generation supersedes stale metrics without mutating any historical row", async () => {
  const legacy = pair({
    startSchema: V1,
    dcSchema: V1,
    startRowsRaw: [legacyRow("M1860", "3")],
    dcRowsRaw: [legacyRow("M1860", "1")],
  });
  const sharedWindow = {
    patient_id: "p1",
    episode_start: "2026-05-01",
    episode_end: "2026-06-01",
    outcome_measure_source: "oasis_change_score",
  };
  const { handler, written } = await loadHandler({
    assessments: legacy,
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    outcomeMetrics: [
      { id: "metric-a", agency_id: AGENCY_A, ...sharedWindow },
      { id: "metric-b", agency_id: AGENCY_B, ...sharedWindow },
      { id: "metric-unscoped", ...sharedWindow },
    ],
    ignoreFilters: true,
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.patient_outcome_metrics_retired, 0);
  assert.deepEqual(written.metricUpdates, []);
  assert.deepEqual(written.metricCreates, []);
  assert.equal(json.publication_status, "published");
  assert.equal(written.runUpdates.at(-1).payload.patient_outcome_metric_count, 0);
});

test("duplicate discharge rows are excluded as one ambiguous episode and never double-counted", async () => {
  const [soc, dc] = pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } });
  const duplicateDc = { ...dc, id: `${dc.id}-duplicate` };
  const { handler, written } = await loadHandler({
    assessments: [soc, dc, duplicateDc],
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    outcomeMetrics: [{
      id: "ambiguous-metric",
      agency_id: AGENCY_A,
      patient_id: "p1",
      episode_start: "2026-05-01",
      episode_end: "2026-06-01",
      outcome_measure_source: "oasis_change_score",
    }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.discharges_evaluated, 0);
  assert.equal(json.skipped_duplicate_episode_rows, 2);
  assert.equal(json.patient_outcome_metrics_written, 0);
  assert.deepEqual(written.metricCreates, []);
  assert.deepEqual(written.metricUpdates, [], "the prior generation remains immutable audit history");
  assert.equal(written.runUpdates.at(-1).payload.patient_outcome_metric_count, 0);
  for (const measure of json.measures) assert.equal(measure.denominator, 0);
});

test("duplicate latest SOC or ROC rows exclude the episode instead of choosing by array order", async () => {
  const [soc, dc] = pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } });
  const duplicateLatestStart = {
    ...soc,
    id: "roc-same-latest-date",
    visit_type: "Resumption of Care",
    oasis_items: [v2Row("M1860", "m1860_cms_e2", "6")],
  };
  const { handler, written } = await loadHandler({
    assessments: [soc, duplicateLatestStart, dc],
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.skipped_ambiguous_start_assessment, 1);
  assert.equal(json.excluded_episode_count, 1);
  assert.equal(json.patient_outcome_metrics_written, 0);
  assert.ok(json.skip_reasons[0].reasons.includes("ambiguous_latest_start_assessment"));
  assert.deepEqual(written.metricCreates, []);
  assert.deepEqual(written.kpiCreates, []);
});

test("conflicting duplicate response rows exclude the episode without array-order scoring", async () => {
  const duplicateStartRows = [
    v2Row("M1860", "m1860_cms_e2", "3"),
    v2Row("m-1860", "m1860_cms_e2", "2"),
  ];
  const { handler, written } = await loadHandler({
    assessments: pair({
      startRowsRaw: duplicateStartRows,
      dcCodes: { M1860: "1" },
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.patient_outcome_metrics_written, 0);
  assert.equal(json.skipped_not_proxy_scorable, 1);
  assert.ok(json.skip_reasons[0].reasons.includes("start_duplicate_item_response"));
  assert.deepEqual(written.metricCreates, []);
  assert.deepEqual(written.kpiCreates, []);
  for (const measure of json.measures) assert.equal(measure.denominator, 0);
});

test("a duplicated definition id under different items excludes the episode", async () => {
  const duplicateDefinitionRows = [
    v2Row("M1860", "m1860_cms_e2", "3"),
    v2Row("M1830", "m1860_cms_e2", "2"),
  ];
  const { handler, written } = await loadHandler({
    assessments: pair({
      startRowsRaw: duplicateDefinitionRows,
      dcCodes: { M1860: "1" },
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.patient_outcome_metrics_written, 0);
  assert.ok(json.skip_reasons[0].reasons.includes("start_duplicate_definition_response"));
  assert.deepEqual(written.metricCreates, []);
  assert.deepEqual(written.kpiCreates, []);
  for (const measure of json.measures) assert.equal(measure.denominator, 0);
});

test("a mismatched item definition fails provenance validation", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startRowsRaw: [v2Row("M1860", "m1830_cms_e2", "3")],
      dcCodes: { M1860: "1" },
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.patient_outcome_metrics_written, 0);
  assert.ok(json.skip_reasons[0].reasons.includes("start_unverified_item_provenance"));
  assert.deepEqual(written.metrics, []);
});

test("a no-denominator run publishes an empty KPI generation without mutating stale rows", async () => {
  const legacy = pair({
    startSchema: V1,
    dcSchema: V1,
    startRowsRaw: [legacyRow("M1860", "3")],
    dcRowsRaw: [legacyRow("M1860", "1")],
  });
  const kpiWindow = {
    metric_name: "Improvement in Ambulation/Locomotion",
    metric_category: "quality",
    period_start: "2026-06-01",
    period_end: "2026-06-01",
    metric_value: 88,
  };
  const { handler, written } = await loadHandler({
    assessments: legacy,
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    agencyKpis: [
      { id: "kpi-a", agency_id: AGENCY_A, is_current: true, ...kpiWindow },
      { id: "kpi-b", agency_id: AGENCY_B, is_current: true, ...kpiWindow },
      { id: "kpi-unscoped", is_current: true, ...kpiWindow },
    ],
    ignoreFilters: true,
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.agency_kpis_written, 0);
  assert.equal(json.agency_kpis_retired, 0);
  assert.deepEqual(written.kpiUpdates, []);
  assert.equal(written.runUpdates.at(-1).payload.agency_kpi_count, 0);
  assert.equal(written.runUpdates.at(-1).payload.status, "published");
});

test("a zero-discharge run publishes an empty stable window and preserves KPI audit history", async () => {
  const currentWindow = {
    metric_name: "Improvement in Ambulation/Locomotion",
    metric_category: "quality",
    metric_value: 91,
    is_current: true,
  };
  const { handler, written } = await loadHandler({
    agencyKpis: [
      {
        id: "target-period",
        agency_id: AGENCY_A,
        period_start: "2026-06-01",
        period_end: "2026-06-01",
        ...currentWindow,
      },
      {
        id: "historical-period",
        agency_id: AGENCY_A,
        period_start: "2026-05-01",
        period_end: "2026-05-31",
        ...currentWindow,
      },
      {
        id: "foreign-period",
        agency_id: AGENCY_B,
        period_start: "2026-06-01",
        period_end: "2026-06-01",
        ...currentWindow,
      },
    ],
    ignoreFilters: true,
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.discharges_evaluated, 0);
  assert.equal(json.agency_kpis_retired, 0);
  assert.deepEqual(written.kpiUpdates, []);
  assert.equal(written.runUpdates.at(-1).payload.agency_kpi_count, 0);
});

test("a positive run appends one gated KPI generation without rewriting same-period duplicates", async () => {
  const row = {
    agency_id: AGENCY_A,
    metric_name: "Improvement in Ambulation/Locomotion",
    metric_category: "quality",
    period_start: "2026-06-01",
    period_end: "2026-06-01",
    metric_value: 10,
    is_current: true,
  };
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    agencyKpis: [{ id: "newest", ...row }, { id: "duplicate", ...row }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.agency_kpis_retired, 0);
  assert.deepEqual(written.kpiUpdates, []);
  const staged = written.kpiCreates.find((kpi) => kpi.metric_name === row.metric_name);
  assert.ok(staged);
  assert.equal(staged.is_current, false);
  assert.equal(staged.outcome_computation_run_id, json.outcome_computation_run_id);
});

test("a retired metric remains audit history and is never merge-reactivated", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    outcomeMetrics: [{
      id: "retired-metric",
      agency_id: AGENCY_A,
      patient_id: "p1",
      episode_start: "2026-05-01",
      episode_end: "2026-06-01",
      outcome_measure_source: "retired_unverified_schema",
      retired_reason: "legacy_response_schema",
      retired_at: "2026-06-02T00:00:00.000Z",
    }],
  });
  const { status } = await run(handler);
  assert.equal(status, 200);
  assert.equal(written.metricCreates.length, 1, "a fresh current row succeeds retired history");
  assert.ok(!Object.hasOwn(written.metricCreates[0], "retired_reason"));
  assert.ok(!Object.hasOwn(written.metricCreates[0], "retired_at"));
  assert.deepEqual(written.metricUpdates, [], "the retired row is not partially reactivated");
});

test("a retired KPI remains audit history and gets a fresh publication-gated successor", async () => {
  const row = {
    id: "retired-kpi",
    agency_id: AGENCY_A,
    metric_name: "Improvement in Ambulation/Locomotion",
    metric_category: "quality",
    period_start: "2026-06-01",
    period_end: "2026-06-01",
    metric_value: 10,
    is_current: false,
    retired_reason: "no_current_eligible_episodes",
    retired_at: "2026-06-02T00:00:00.000Z",
  };
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    agencyKpis: [row],
  });
  const { status } = await run(handler);
  assert.equal(status, 200);
  const successor = written.kpiCreates.find((kpi) => kpi.metric_name === row.metric_name);
  assert.ok(successor, "a fresh staged KPI succeeds retired history");
  assert.equal(successor.is_current, false);
  assert.equal(successor.outcome_computation_run_id, written.runUpdates.at(-1).id);
  assert.ok(!Object.hasOwn(successor, "retired_reason"));
  assert.ok(!Object.hasOwn(successor, "retired_at"));
  assert.ok(!written.kpiUpdates.some((update) => update.id === row.id));
});

// ── trusted v2 pairs write versioned outputs ────────────────────────────────

test("a trusted v2 pair writes a versioned, agency-scoped PatientOutcomeMetric and AgencyKPI", async () => {
  const { handler, written, queries } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3", M1830: "4" }, dcCodes: { M1860: "1", M1830: "2" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A, primary_diagnosis: "CHF" }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.patient_outcome_metrics_written, 1);
  assert.equal(json.internal_sample_ready, false);
  assert.ok(!Object.hasOwn(json, "star_eligible"));
  assert.ok(json.measures.every((measure) =>
    Object.hasOwn(measure, "internal_sample_ready") && !Object.hasOwn(measure, "star_eligible")));
  assert.equal(written.metrics.length, 1);

  const m = written.metrics[0];
  assert.deepEqual(m.input_response_schema_ids, [V2, V2]);
  assert.equal(m.agency_id, AGENCY_A);
  assert.deepEqual(m.source_assessment_ids, [`soc-${AGENCY_A}-p1`, `dc-${AGENCY_A}-p1`]);
  assert.deepEqual(m.instrument_versions, ["oasis-e2", "oasis-e2"]);
  assert.equal(m.calculation_version, FE_VERSION, "the metric records which rules produced it");
  assert.equal(m.outcome_measure_source, "outcome_run_staged");
  assert.equal(m.outcome_computation_run_id, json.outcome_computation_run_id);
  assert.equal(m.outcome_computation_attempt_id, json.outcome_computation_attempt_id);
  assert.deepEqual(m.optional_fields_present, ["primary_diagnosis"]);
  assert.equal(m.functional_improvement.ambulation_improved, true);
  assert.equal(m.functional_improvement.bathing_improved, true);
  const ambulationResult = m.measure_results.find((result) => result.measure === "ambulation");
  assert.equal(ambulationResult.start_value, "3");
  assert.equal(ambulationResult.discharge_value, "1");
  const unmeasuredTransfer = m.measure_results.find((result) => result.measure === "bed_transfer");
  assert.ok(!Object.hasOwn(unmeasuredTransfer, "start_value"));
  assert.ok(!Object.hasOwn(unmeasuredTransfer, "discharge_value"));
  assert.ok(!Object.hasOwn(m.functional_improvement, "transferring_improved"));

  assert.ok(written.kpis.length > 0);
  for (const k of written.kpis) {
    assert.equal(k.agency_id, AGENCY_A);
    assert.equal(k.is_current, false, "a row-level flag must not publish a partial run");
    assert.equal(k.outcome_computation_run_id, json.outcome_computation_run_id);
    assert.equal(k.outcome_computation_attempt_id, json.outcome_computation_attempt_id);
    assert.deepEqual(k.input_response_schema_ids, [V2]);
    assert.equal(k.calculation_version, FE_VERSION);
  }

  assert.equal(written.runUpdates.at(-1).payload.status, "published");
  assert.equal(written.runUpdates.at(-1).payload.patient_outcome_metric_count, 1);
  assert.equal(written.runUpdates.at(-1).payload.agency_kpi_count, written.kpis.length);
  const publishIndex = written.events.lastIndexOf("run:update:published");
  assert.ok(publishIndex > written.events.lastIndexOf("metric:create"));
  assert.ok(publishIndex > written.events.lastIndexOf("kpi:create"));

  const tenantEntities = new Set([
    "OASISAssessment", "Patient", "PatientOutcomeMetric", "AgencyKPI", "OutcomeComputationRun",
  ]);
  for (const { entity, q } of queries.filter((query) => tenantEntities.has(query.entity))) {
    assert.equal(q.agency_id, AGENCY_A, `${entity} query was not tenant-scoped`);
  }
});

test("the GG context value is persisted only under the explicit non-CMS 18-item raw-sum field", async () => {
  const ggItems = [
    "GG0130A", "GG0130B", "GG0130C", "GG0130E", "GG0130F", "GG0130G", "GG0130H",
    "GG0170A", "GG0170B", "GG0170C", "GG0170D", "GG0170E", "GG0170F",
    "GG0170I", "GG0170J", "GG0170K", "GG0170L", "GG0170M",
  ];
  const dischargeRows = [
    v2Row("M1860", "m1860_cms_e2", "1"),
    ...ggItems.map((item) => ({ item_number: item, response_value: { code: "4" } })),
  ];
  const { handler, written } = await loadHandler({
    assessments: pair({
      startCodes: { M1860: "3" },
      dcRowsRaw: dischargeRows,
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { status } = await run(handler);
  assert.equal(status, 200);
  assert.equal(written.metricCreates[0].internal_gg_18_item_raw_sum, 72);
  assert.ok(!Object.hasOwn(written.metricCreates[0], "gg_discharge_function_score"));
});

// ── legacy / mixed / unversioned pairs write nothing ────────────────────────

test("a legacy pair writes no internal proxy metric or KPI, and says why", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startSchema: V1, dcSchema: V1,
      startRowsRaw: [legacyRow("M1860", "3")], dcRowsRaw: [legacyRow("M1860", "1")],
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 0, "a legacy pair must write NO metric");
  assert.equal(written.kpis.length, 0, "a legacy pair must produce NO KPI");
  assert.equal(json.patient_outcome_metrics_written, 0);
  assert.equal(json.skipped_not_proxy_scorable, 1);
  assert.ok(json.skip_reasons[0].reasons.includes("start_schema_not_v2"));
});

test("a MIXED-schema pair is excluded with a visible reason and zero denominator", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startSchema: V1, startRowsRaw: [legacyRow("M1830", "6")],
      dcCodes: { M1830: "2" },
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 0);
  assert.equal(written.kpis.length, 0);
  assert.equal(json.skipped_not_proxy_scorable, 1);
  const reasons = json.skip_reasons[0].reasons;
  assert.ok(reasons.includes("start_schema_not_v2"));
  assert.ok(reasons.includes("mixed_schema_episode"), `expected mixed_schema_episode, got ${reasons.join(",")}`);
  for (const m of json.measures) assert.equal(m.denominator, 0, `${m.key} must contribute zero denominator`);
});

test("an UNVERSIONED pair is excluded — the registry cannot rescue it", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startSchema: null, dcSchema: null,
      startRowsRaw: [{ item_number: "M1860", response: "3" }],
      dcRowsRaw: [{ item_number: "M1860", response: "1" }],
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 0);
  assert.equal(json.skipped_not_proxy_scorable, 1);
  assert.ok(json.skip_reasons[0].reasons.includes("start_schema_not_v2"));
});

test("an AI-originated row is not scorable even under the v2 schema", async () => {
  const aiRow = { ...v2Row("M1860", "m1860_cms_e2", "1"), response_origin: "ai_suggested", ai_suggested: true };
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcRowsRaw: [aiRow] }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  await run(handler);
  // The episode is not excluded at schema level, but the AI row yields no code,
  // so the measure has no data and no metric is written.
  assert.equal(written.metrics.length, 0);
});

// ── M1830 code 6 under v2 ───────────────────────────────────────────────────

test("v2 M1830 code 6 is a valid, ratable total-dependence level", async () => {
  assert.ok(CMS_GOLDEN_CODES.M1830.includes("6"));
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1830: "6" }, dcCodes: { M1830: "3" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 1, "a v2 6→3 episode must be scored, not excluded");
  assert.equal(written.metrics[0].functional_improvement.bathing_improved, true);
  const bathing = json.measures.find((m) => m.key === "bathing");
  assert.equal(bathing.denominator, 1);
  assert.equal(bathing.numerator, 1);
});

test("legacy M1830 code 6 stays excluded", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startSchema: V1, startRowsRaw: [legacyRow("M1830", "6")],
      dcSchema: V1, dcRowsRaw: [legacyRow("M1830", "3")],
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 0);
  assert.equal(json.measures.find((m) => m.key === "bathing").denominator, 0);
});

// ── M2420 does not imply a facility transfer ────────────────────────────────

test("M2420 never yields a hospital, rehab or SNF disposition", async () => {
  for (const code of CMS_GOLDEN_CODES.M2420) {
    const { handler, written } = await loadHandler({
      assessments: pair({
        startCodes: { M1860: "3" },
        dcRowsRaw: [v2Row("M1860", "m1860_cms_e2", "1"), v2Row("M2420", "m2420_cms_e2", code)],
      }),
      patients: [{ id: "p1", agency_id: AGENCY_A }],
    });
    await run(handler);
    const disposition = String(written.metrics[0]?.discharge_disposition || "");
    for (const banned of M2420_FORBIDDEN_DESTINATIONS) {
      assert.ok(
        !disposition.toLowerCase().includes(banned),
        `M2420 code ${code} produced disposition "${disposition}", which names "${banned}"`,
      );
    }
  }
});

test("M2420 code 2 is a community disposition, not a hospital transfer", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startCodes: { M1860: "3" },
      dcRowsRaw: [v2Row("M1860", "m1860_cms_e2", "1"), v2Row("M2420", "m2420_cms_e2", "2")],
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  await run(handler);
  assert.equal(written.metrics[0].discharge_disposition, "remained_community_with_hha");
});

test("M2420 code 3 is a non-institutional hospice, not a facility", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startCodes: { M1860: "3" },
      dcRowsRaw: [v2Row("M1860", "m1860_cms_e2", "1"), v2Row("M2420", "m2420_cms_e2", "3")],
    }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
  });
  await run(handler);
  assert.equal(written.metrics[0].discharge_disposition, "non_institutional_hospice");
});

// ── frontend / backend parity ───────────────────────────────────────────────

test("the inlined backend core matches the frontend engine measure-for-measure", async () => {
  const src = await readFile(new URL("../functions/computeOutcomeMeasures/entry.ts", import.meta.url), "utf8");
  // The backend keeps its own copy (Deno cannot import the frontend module), so
  // the risk is drift. Every measure's identity, definition, ordinal order and
  // exclusions must match, or a rule fixed in one place silently persists in
  // the other.
  for (const m of FE_MEASURES) {
    const re = new RegExp(`key: '${m.key}'[^}]*}`);
    const found = src.match(re);
    assert.ok(found, `backend is missing measure "${m.key}"`);
    const block = found[0];
    assert.ok(block.includes(`item: '${m.item}'`), `${m.key}: item drift`);
    assert.ok(
      block.includes(m.definitionId ? `definitionId: '${m.definitionId}'` : "definitionId: null"),
      `${m.key}: definitionId drift`,
    );
    const ordinals = m.ordinalCodes.map((c) => `'${c}'`).join(", ");
    assert.ok(block.includes(`ordinalCodes: [${ordinals}]`), `${m.key}: ordinal order drift`);
    const exStart = m.excludeStartCodes.map((c) => `'${c}'`).join(", ");
    assert.ok(block.includes(`excludeStartCodes: [${exStart}]`), `${m.key}: excludeStart drift`);
    const exEither = m.excludeEitherCodes.map((c) => `'${c}'`).join(", ");
    assert.ok(block.includes(`excludeEitherCodes: [${exEither}]`), `${m.key}: excludeEither drift`);
    assert.ok(block.includes(`metricField: '${m.metricField}'`), `${m.key}: metricField drift`);
  }
  assert.ok(src.includes(`OUTCOME_CALCULATION_VERSION = '${FE_VERSION}'`), "calculation version drift");
  // And the backend must not have reverted to numeric coercion of codes.
  assert.ok(!/toNum\(\s*startAns\[/.test(src), "backend still coerces a start code to a number");
  assert.ok(!/toNum\(\s*dcAns\['m2420'\]\s*\)/.test(src), "backend still coerces the M2420 code to a number");
});
