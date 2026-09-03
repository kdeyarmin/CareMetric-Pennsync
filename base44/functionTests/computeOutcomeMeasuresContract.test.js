import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
  agencies = [
    { id: AGENCY_A, admin_user_ids: ["u1"], admin_email: "admin@agency-a.test" },
    { id: AGENCY_B, admin_user_ids: ["u2"], admin_email: "admin@agency-b.test" },
  ],
  user = { id: "u1", role: "admin", account_type: "agency_admin", agency_id: AGENCY_A, is_active: true },
  internalSecret = "scheduler-secret",
  ignoreFilters = false,
  filterFailures = [],
  updateFailures = [],
} = {}) {
  let src = await readFile(new URL("../functions/computeOutcomeMeasures/entry.ts", import.meta.url), "utf8");
  src = src.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__omMakeClient;",
  );
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `omctr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);

  const written = { metrics: [], metricCreates: [], metricUpdates: [], kpis: [], kpiCreates: [], kpiUpdates: [] };
  const queries = [];
  const matching = (rows, q) => {
    if (ignoreFilters) return rows;
    return rows.filter((row) => Object.entries(q || {}).every(([key, value]) => row?.[key] === value));
  };
  const queried = (entity, rows, q, sort, limit, skip = 0) => {
    queries.push({ entity, q: { ...(q || {}) }, sort, limit, skip });
    if (filterFailures.includes(entity)) throw new Error(`${entity} filter failed`);
    const scoped = matching(rows, q);
    return Number.isFinite(limit) ? scoped.slice(skip, skip + limit) : scoped;
  };
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
          filter: async (q, sort, limit, skip) => queried("PatientOutcomeMetric", outcomeMetrics, q, sort, limit, skip),
          create: async (payload) => {
            written.metrics.push(payload);
            written.metricCreates.push(payload);
            return { id: `m${written.metrics.length}` };
          },
          update: async (id, payload) => {
            if (updateFailures.includes("PatientOutcomeMetric")) throw new Error("metric update failed");
            written.metrics.push(payload);
            written.metricUpdates.push({ id, payload });
            return { id };
          },
        },
        AgencyKPI: {
          filter: async (q, sort, limit, skip) => queried("AgencyKPI", agencyKpis, q, sort, limit, skip),
          create: async (payload) => {
            written.kpis.push(payload);
            written.kpiCreates.push(payload);
            return { id: `k${written.kpis.length}` };
          },
          update: async (id, payload) => {
            if (updateFailures.includes("AgencyKPI")) throw new Error("KPI update failed");
            written.kpis.push(payload);
            written.kpiUpdates.push({ id, payload });
            return { id };
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
  return { handler, written, queries };
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

test("a failed metric lookup returns 500 and never falls through to create", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcCodes: { M1860: "1" } }),
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    filterFailures: ["PatientOutcomeMetric"],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.deepEqual(written.metricCreates, []);
  assert.deepEqual(written.kpis, []);
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

test("a failed retirement update returns 500 instead of reporting a false retirement", async () => {
  const legacy = pair({
    startSchema: V1,
    dcSchema: V1,
    startRowsRaw: [legacyRow("M1860", "3")],
    dcRowsRaw: [legacyRow("M1860", "1")],
  });
  const { handler, written } = await loadHandler({
    assessments: legacy,
    patients: [{ id: "p1", agency_id: AGENCY_A }],
    outcomeMetrics: [{
      id: "stale",
      agency_id: AGENCY_A,
      patient_id: "p1",
      episode_start: "2026-05-01",
      episode_end: "2026-06-01",
      outcome_measure_source: "oasis_change_score",
    }],
    updateFailures: ["PatientOutcomeMetric"],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 500);
  assert.equal(json.success, false);
  assert.deepEqual(written.metricUpdates, []);
});

test("missing patient, date, and start-assessment skips are reported explicitly", async () => {
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
  assert.equal(json.skipped_missing_episode_date, 2);
  assert.equal(json.skipped_missing_discharge_date, 1);
  assert.equal(json.skipped_missing_start_date, 1);
  assert.equal(json.skipped_missing_start_assessment, 1);
  assert.equal(json.skip_reasons.length, 4);
  assert.ok(json.skip_reasons.some((skip) =>
    skip.reasons.includes("missing_start_assessment_date")));
  assert.deepEqual(written.metrics, []);
  assert.deepEqual(written.kpiCreates, []);
});

test("invalid discharge and start dates are reported instead of silently dropped", async () => {
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
  assert.equal(json.skipped_invalid_discharge_date, 1);
  assert.equal(json.skipped_invalid_start_date, 1);
  assert.ok(json.skip_reasons.some((skip) =>
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
  assert.deepEqual(dischargeQueries.map(({ limit, skip }) => ({ limit, skip })), [
    { limit: 500, skip: 0 },
    { limit: 500, skip: 500 },
  ]);
  assert.deepEqual(written.metrics, []);
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

test("retirement can update only a stale metric carrying the requested agency_id", async () => {
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
  assert.equal(json.patient_outcome_metrics_retired, 1);
  assert.deepEqual(written.metricUpdates.map((u) => u.id), ["metric-a"]);
  assert.equal(written.metricUpdates[0].payload.agency_id, AGENCY_A);
  assert.equal(written.metricUpdates[0].payload.outcome_measure_source, "retired_unverified_schema");
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
  assert.deepEqual(written.metricUpdates.map((u) => u.id), ["ambiguous-metric"]);
  assert.equal(
    written.metricUpdates[0].payload.outcome_measure_source,
    "retired_ambiguous_duplicate_discharge",
  );
  for (const measure of json.measures) assert.equal(measure.denominator, 0);
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

test("a no-denominator rerun retires only the matching agency's stale KPI", async () => {
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
  assert.equal(json.agency_kpis_retired, 1);
  assert.deepEqual(written.kpiUpdates.map((u) => u.id), ["kpi-a"]);
  assert.equal(written.kpiUpdates[0].payload.agency_id, AGENCY_A);
  assert.equal(written.kpiUpdates[0].payload.is_current, false);
  assert.equal(written.kpiUpdates[0].payload.retired_reason, "no_current_eligible_episodes");
});

test("a zero-discharge run retires current KPIs only in the explicit stable period", async () => {
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
  assert.equal(json.agency_kpis_retired, 1);
  assert.deepEqual(written.kpiUpdates.map((update) => update.id), ["target-period"]);
});

test("a positive rerun keeps one current KPI and retires same-period duplicates", async () => {
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
  assert.equal(json.agency_kpis_retired, 1);
  const updated = written.kpiUpdates.find((update) => update.id === "newest");
  const retired = written.kpiUpdates.find((update) => update.id === "duplicate");
  assert.equal(updated.payload.is_current, true);
  assert.equal(retired.payload.is_current, false);
  assert.equal(retired.payload.retired_reason, "duplicate_agency_period_kpi");
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

test("a retired KPI remains audit history and gets a fresh current successor", async () => {
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
  assert.ok(successor, "a fresh current KPI succeeds retired history");
  assert.equal(successor.is_current, true);
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
    assert.equal(k.is_current, true);
    assert.deepEqual(k.input_response_schema_ids, [V2]);
    assert.equal(k.calculation_version, FE_VERSION);
  }

  const tenantEntities = new Set(["OASISAssessment", "Patient", "PatientOutcomeMetric", "AgencyKPI"]);
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
