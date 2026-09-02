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
function assessment({ id, patientId = "p1", visitType, date, rows, schema = V2 }) {
  return {
    id,
    patient_id: patientId,
    visit_type: visitType,
    assessment_date: date,
    ...(schema ? { response_schema_id: schema, instrument_version: "oasis-e2" } : {}),
    oasis_items: rows,
  };
}

async function loadHandler({ assessments = [], patients = [] } = {}) {
  let src = await readFile(new URL("../functions/computeOutcomeMeasures/entry.ts", import.meta.url), "utf8");
  src = src.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__omMakeClient;",
  );
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `omctr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);

  const written = { metrics: [], kpis: [] };
  let handler;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: () => undefined } };
  globalThis.__omMakeClient = () => ({
    auth: { me: async () => ({ id: "u1", role: "admin", account_type: "agency_admin", is_active: true }) },
    asServiceRole: {
      entities: {
        OASISAssessment: {
          filter: async (q) => {
            if (q.visit_type === "Discharge") return assessments.filter((a) => a.visit_type === "Discharge");
            if (q.patient_id) return assessments.filter((a) => a.patient_id === q.patient_id);
            return assessments;
          },
        },
        Patient: { filter: async ({ id }) => patients.filter((p) => p.id === id) },
        PatientOutcomeMetric: {
          filter: async () => [],
          create: async (payload) => { written.metrics.push(payload); return { id: `m${written.metrics.length}` }; },
          update: async (_id, payload) => { written.metrics.push(payload); return { id: _id }; },
        },
        AgencyKPI: {
          filter: async () => [],
          create: async (payload) => { written.kpis.push(payload); return { id: `k${written.kpis.length}` }; },
          update: async (_id, payload) => { written.kpis.push(payload); return { id: _id }; },
        },
      },
    },
  });
  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return { handler, written };
}

async function run(handler, body = {}) {
  const res = await handler(new Request("http://local/computeOutcomeMeasures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}

/** SOC + DC pair for one patient, with the given per-item codes. */
function pair({ startCodes, dcCodes, startSchema = V2, dcSchema = V2, startRowsRaw, dcRowsRaw }) {
  const DEF = { M1860: "m1860_cms_e2", M1830: "m1830_cms_e2", M1400: "m1400_cms_e2", M2020: "m2020_cms_e2", M2420: "m2420_cms_e2" };
  const mk = (codes) => Object.entries(codes).map(([item, code]) => v2Row(item, DEF[item], code));
  return [
    assessment({ id: "soc1", visitType: "Start of Care", date: "2026-05-01", rows: startRowsRaw || mk(startCodes), schema: startSchema }),
    assessment({ id: "dc1", visitType: "Discharge", date: "2026-06-01", rows: dcRowsRaw || mk(dcCodes), schema: dcSchema }),
  ];
}

// ── trusted v2 pairs write versioned outputs ────────────────────────────────

test("a trusted v2 pair writes a versioned PatientOutcomeMetric and AgencyKPI", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3", M1830: "4" }, dcCodes: { M1860: "1", M1830: "2" } }),
    patients: [{ id: "p1", primary_diagnosis: "CHF" }],
  });
  const { status, json } = await run(handler);
  assert.equal(status, 200);
  assert.equal(json.patient_outcome_metrics_written, 1);
  assert.equal(written.metrics.length, 1);

  const m = written.metrics[0];
  assert.deepEqual(m.input_response_schema_ids, [V2, V2]);
  assert.deepEqual(m.source_assessment_ids, ["soc1", "dc1"]);
  assert.deepEqual(m.instrument_versions, ["oasis-e2", "oasis-e2"]);
  assert.equal(m.calculation_version, FE_VERSION, "the metric records which rules produced it");
  assert.equal(m.functional_improvement.ambulation_improved, true);
  assert.equal(m.functional_improvement.bathing_improved, true);

  assert.ok(written.kpis.length > 0);
  for (const k of written.kpis) {
    assert.deepEqual(k.input_response_schema_ids, [V2]);
    assert.equal(k.calculation_version, FE_VERSION);
  }
});

// ── legacy / mixed / unversioned pairs write nothing ────────────────────────

test("a legacy pair writes no CMS metric and no KPI, and says why", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startSchema: V1, dcSchema: V1,
      startRowsRaw: [legacyRow("M1860", "3")], dcRowsRaw: [legacyRow("M1860", "1")],
    }),
    patients: [{ id: "p1" }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 0, "a legacy pair must write NO metric");
  assert.equal(written.kpis.length, 0, "a legacy pair must produce NO KPI");
  assert.equal(json.patient_outcome_metrics_written, 0);
  assert.equal(json.skipped_not_cms_scorable, 1);
  assert.ok(json.skip_reasons[0].reasons.includes("start_schema_not_v2"));
});

test("a MIXED-schema pair is excluded with a visible reason and zero denominator", async () => {
  const { handler, written } = await loadHandler({
    assessments: pair({
      startSchema: V1, startRowsRaw: [legacyRow("M1830", "6")],
      dcCodes: { M1830: "2" },
    }),
    patients: [{ id: "p1" }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 0);
  assert.equal(written.kpis.length, 0);
  assert.equal(json.skipped_not_cms_scorable, 1);
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
    patients: [{ id: "p1" }],
  });
  const { json } = await run(handler);
  assert.equal(written.metrics.length, 0);
  assert.equal(json.skipped_not_cms_scorable, 1);
  assert.ok(json.skip_reasons[0].reasons.includes("start_schema_not_v2"));
});

test("an AI-originated row is not scorable even under the v2 schema", async () => {
  const aiRow = { ...v2Row("M1860", "m1860_cms_e2", "1"), response_origin: "ai_suggested", ai_suggested: true };
  const { handler, written } = await loadHandler({
    assessments: pair({ startCodes: { M1860: "3" }, dcRowsRaw: [aiRow] }),
    patients: [{ id: "p1" }],
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
    patients: [{ id: "p1" }],
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
    patients: [{ id: "p1" }],
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
      patients: [{ id: "p1" }],
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
    patients: [{ id: "p1" }],
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
    patients: [{ id: "p1" }],
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
