import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Behavioral contract tests for the protected OASIS write path.
 *
 * `OASISAssessment` is reachable directly, so this function is the only thing
 * standing between a client and an arbitrary `oasis_items[]`. These tests run
 * the REAL handler against an injected client and assert what it refuses — a
 * validator that is only exercised through the UI is not a validator.
 */

const V2 = "pennsync-oasis-response-v2-cms-e2";
const V1 = "pennsync-oasis-response-v1-legacy";
const FLAG = "oasis_response_schema_v2_enabled";

function row(overrides = {}) {
  return {
    definition_id: "m1830_cms_e2",
    item_number: "M1830",
    item_name: "Bathing",
    item_source: "cms_item",
    item_spec_version: "oasis-e2",
    response_schema_id: V2,
    response_shape: "single",
    response_value: { code: "6" },
    response_origin: "clinician_selected",
    selected_by: "rn@example.com",
    selected_at: "2026-06-01T10:00:00.000Z",
    ai_suggested: false,
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    patient_id: "p1",
    visit_type: "Discharge",
    assessment_date: "2026-06-01",
    oasis_items: [row()],
    ...overrides,
  };
}

const AGENCY = "Maple Home Health";
const OTHER_AGENCY = "Birch Home Health";
const DEFAULT_USER = { id: "u1", email: "rn@example.com", agency_id: "ag1", agency_name: AGENCY, is_active: true };

/** An AgencySettings row as the entity actually defines it: flat boolean fields. */
function settingsRow(agencyName, fields = {}) {
  return { id: `set_${agencyName}`, agency_code: agencyName, office_name: agencyName, created_date: "2026-01-01", ...fields };
}

/**
 * A multi-tenant AgencySettings store with the two read shapes the shared
 * `resolveAgencySettings` helper uses. Newest first, so a newest-row-wins bug
 * has a wrong row available to pick.
 */
function agencySettingsStore(rows) {
  const newestFirst = [...rows].sort((a, b) => String(b.created_date || "").localeCompare(String(a.created_date || "")));
  return {
    list: async (_sort, limit) => newestFirst.slice(0, limit ?? newestFirst.length),
    filter: async (where, _sort, limit) => {
      const [[field, value]] = Object.entries(where);
      return newestFirst.filter((r) => r[field] === value).slice(0, limit ?? newestFirst.length);
    },
  };
}

async function loadHandler({ settings = { [FLAG]: true }, settingsRows = null, user = DEFAULT_USER } = {}) {
  // The store is a LIST of tenant rows, and the handler must find the caller's
  // own. A single-row store cannot tell a correctly-scoped read from a
  // newest-row-wins one, which is how the cross-tenant defect survived the
  // first round of these tests. `settings` is the shorthand for "one row,
  // belonging to the caller's agency".
  const rows = settingsRows || (settings ? [settingsRow(user?.agency_name || AGENCY, settings)] : []);
  let src = await readFile(new URL("../functions/saveOasisResponses/entry.ts", import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = globalThis.__soMakeClient;");
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `soctr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);

  const written = [];
  let handler;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: () => undefined } };
  globalThis.__soMakeClient = () => ({
    // `user` may legitimately be null (anonymous), so no ?? fallback here —
    // that would make the anonymous case untestable.
    auth: { me: async () => user },
    // The rollout flag lives on AgencySettings: Agency has no feature object
    // and its read RLS is admin-only, so a clinician could never resolve it.
    // Resolution goes through the shared agency-scoped helper, which reads via
    // asServiceRole — so the harness must provide one, backed by the same store.
    asServiceRole: { entities: { AgencySettings: agencySettingsStore(rows) } },
    entities: {
      AgencySettings: agencySettingsStore(rows),
      OASISAssessment: {
        create: async (rec) => { written.push({ op: "create", rec }); return { id: "new1", ...rec }; },
        update: async (id, rec) => { written.push({ op: "update", id, rec }); return { id, ...rec }; },
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

async function post(handler, body) {
  const res = await handler(new Request("http://local/saveOasisResponses", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}

const reasonOf = (json) => (json.errors || []).map((e) => e.reason);

// ── the happy path ──────────────────────────────────────────────────────────

test("a valid v2 write is accepted and the server stamps provenance", async () => {
  const { handler, written } = await loadHandler();
  const { status, json } = await post(handler, payload());
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.ok, true);
  assert.equal(written.length, 1);
  const rec = written[0].rec;
  assert.equal(rec.response_schema_id, V2);
  assert.equal(rec.instrument_version, "oasis-e2");
  assert.equal(rec.migration_status, "native_v2");
  assert.equal(rec.response_schema_source, "final-oasis-e2-all-item-04-01-2026");
  assert.equal(rec.oasis_items[0].response_value.code, "6");
  // The server sets these itself rather than trusting the client.
  assert.equal(rec.oasis_items[0].response_origin, "clinician_selected");
  assert.equal(rec.oasis_items[0].ai_suggested, false);
  assert.equal(rec.last_written_by, "rn@example.com");
});

// ── the flag and the kill switch ────────────────────────────────────────────

test("the feature flag gates the write and defaults closed", async () => {
  for (const settings of [null, {}, { [FLAG]: false }, { [FLAG]: "true" }]) {
    const { handler, written } = await loadHandler({ settings });
    const { status, json } = await post(handler, payload());
    assert.equal(status, 403, JSON.stringify(json));
    assert.equal(json.reason, "feature_disabled");
    assert.equal(written.length, 0, "nothing may be written while the flag is off");
  }
});

test("the kill switch stops writes without a deploy", async () => {
  const { handler, written } = await loadHandler({
    settings: { [FLAG]: true, oasis_response_writes_disabled: true },
  });
  const { status, json } = await post(handler, payload());
  assert.equal(status, 423);
  assert.equal(json.reason, "write_kill_switch");
  assert.equal(written.length, 0);
});

// ── the flags belong to ONE agency ──────────────────────────────────────────
//
// AgencySettings read RLS is open, so a `list('-created_date', 1)` returns
// whichever tenant saved last, not the caller's. That is a rollout flag and an
// incident kill switch answerable by a stranger. Both directions are tested
// because only one of them fails safe.

test("another agency's enabled flag does not enable this agency", async () => {
  const { handler, written } = await loadHandler({
    settingsRows: [
      // Newest row wins a global read, and it belongs to somebody else.
      settingsRow(OTHER_AGENCY, { [FLAG]: true, created_date: "2026-08-01" }),
      settingsRow(AGENCY, { [FLAG]: false, created_date: "2026-01-01" }),
    ],
  });
  const { status, json } = await post(handler, payload());
  assert.equal(status, 403, JSON.stringify(json));
  assert.equal(json.reason, "feature_disabled");
  assert.equal(written.length, 0, "a tenant not approved for v2 must not be enabled by another tenant's row");
});

test("this agency's kill switch stops this agency, even under a newer foreign row", async () => {
  // The direction that fails OPEN: an agency containing an incident flips its
  // own switch, and a global newest-row read answers with somebody else's
  // `false`. The write would proceed during the incident the switch exists for.
  const { handler, written } = await loadHandler({
    settingsRows: [
      settingsRow(OTHER_AGENCY, { [FLAG]: true, oasis_response_writes_disabled: false, created_date: "2026-08-01" }),
      settingsRow(AGENCY, { [FLAG]: true, oasis_response_writes_disabled: true, created_date: "2026-01-01" }),
    ],
  });
  const { status, json } = await post(handler, payload());
  assert.equal(status, 423, JSON.stringify(json));
  assert.equal(json.reason, "write_kill_switch");
  assert.equal(written.length, 0);
});

test("an agency with no settings row of its own is not enabled by anyone else's", async () => {
  const { handler, written } = await loadHandler({
    settingsRows: [settingsRow(OTHER_AGENCY, { [FLAG]: true, created_date: "2026-08-01" })],
  });
  const { status, json } = await post(handler, payload());
  assert.equal(status, 403, JSON.stringify(json));
  assert.equal(json.reason, "feature_disabled");
  assert.equal(written.length, 0);
});

test("a caller with no agency_name is not enabled by a multi-tenant store", async () => {
  // No agency hint and more than one tenant row: the helper cannot tell which
  // is the caller's, so it resolves nothing and the write is refused.
  const { handler, written } = await loadHandler({
    user: { ...DEFAULT_USER, agency_name: "" },
    settingsRows: [
      settingsRow(AGENCY, { [FLAG]: true, created_date: "2026-08-01" }),
      settingsRow(OTHER_AGENCY, { [FLAG]: true, created_date: "2026-01-01" }),
    ],
  });
  const { status, json } = await post(handler, payload());
  assert.equal(status, 403, JSON.stringify(json));
  assert.equal(json.reason, "feature_disabled");
  assert.equal(written.length, 0);
});

test("the caller's own row is found by office_name when agency_code does not match", async () => {
  const row = settingsRow(AGENCY, { [FLAG]: true });
  delete row.agency_code;
  const { handler, written } = await loadHandler({ settingsRows: [row] });
  const { status, json } = await post(handler, payload());
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(written.length, 1);
});

// ── stale clients ───────────────────────────────────────────────────────────

test("a stale client writing the obsolete v1 schema is rejected with an actionable message", async () => {
  const { handler, written } = await loadHandler();
  const { status, json } = await post(handler, payload({
    oasis_items: [row({ response_schema_id: V1 })],
  }));
  assert.equal(status, 409);
  assert.equal(json.reason, "stale_client");
  assert.match(json.error, /older version of PennSync/i);
  assert.match(json.error, /Refresh/i);
  assert.ok(reasonOf(json).includes("obsolete_response_schema"));
  assert.equal(written.length, 0);
});

test("an assessment-level obsolete schema is rejected before any row is read", async () => {
  const { handler, written } = await loadHandler();
  const { status, json } = await post(handler, payload({ response_schema_id: V1 }));
  assert.equal(status, 409);
  assert.equal(json.reason, "stale_client");
  assert.equal(written.length, 0);
});

// ── everything the validator must refuse ────────────────────────────────────

test("the validator rejects each disallowed write, and writes nothing", async () => {
  const cases = [
    ["missing response schema", payload({ oasis_items: [row({ response_schema_id: undefined })] }), "missing_response_schema"],
    ["unknown response schema", payload({ oasis_items: [row({ response_schema_id: "pennsync-oasis-response-v9" })] }), "unknown_response_schema"],
    ["unknown definition", payload({ oasis_items: [row({ definition_id: "m9999_cms_e2" })] }), "unknown_definition"],
    ["invalid code", payload({ oasis_items: [row({ response_value: { code: "9" } })] }), "invalid_code"],
    ["numeric code", payload({ oasis_items: [row({ response_value: { code: 6 } })] }), "invalid_code"],
    ["invalid response shape", payload({ oasis_items: [row({ response_value: { codes: ["6"] } })] }), "invalid_response_shape"],
    ["declared shape mismatch", payload({ oasis_items: [row({ response_shape: "grid" })] }), "invalid_response_shape"],
    ["item at an inapplicable timepoint", payload({
      visit_type: "Start of Care",
      oasis_items: [row({ definition_id: "m2420_cms_e2", item_number: "M2420", response_value: { code: "1" } })],
    }), "item_not_applicable_at_timepoint"],
    ["screening item wearing an M-number", payload({
      oasis_items: [row({ definition_id: "ps_hospitalization_risk_tier", item_number: "M1033", item_source: "pennsync_screening", response_value: { code: "high" } })],
    }), "screening_item_wearing_m_number"],
    ["official response with no clinician selection", payload({ oasis_items: [row({ response_origin: "system" })] }), "response_not_clinician_selected"],
    ["AI-originated official response", payload({ oasis_items: [row({ ai_suggested: true })] }), "ai_originated_response"],
    ["missing selection timestamp", payload({ oasis_items: [row({ selected_at: "nonsense" })] }), "missing_selection_timestamp"],
    ["mixed schema metadata", payload({ oasis_items: [row({ item_spec_version: "oasis-e1" })] }), "inconsistent_instrument_version"],
    ["inconsistent item source", payload({ oasis_items: [row({ item_source: "pennsync_screening" })] }), "inconsistent_item_source"],
    ["item number mismatch", payload({ oasis_items: [row({ item_number: "M1860" })] }), "item_number_mismatch"],
    ["missing assessment date", payload({ assessment_date: undefined }), "missing_assessment_date"],
    ["invalid assessment date", payload({ assessment_date: "not-a-date" }), "invalid_assessment_date"],
    ["assessment before OASIS-E2", payload({ assessment_date: "2025-06-01" }), "assessment_predates_oasis_e2"],
    ["unresolved timepoint", payload({ visit_type: "Routine Visit" }), "unresolved_timepoint"],
  ];

  for (const [name, body, expected] of cases) {
    const { handler, written } = await loadHandler();
    const { status, json } = await post(handler, body);
    assert.ok(status === 422 || status === 409, `${name}: expected a rejection, got ${status}`);
    assert.ok(reasonOf(json).includes(expected), `${name}: expected "${expected}", got ${JSON.stringify(reasonOf(json))}`);
    assert.equal(written.length, 0, `${name}: nothing may be written on a rejection`);
  }
});

test("the validator still requires a selector, even though the handler injects one", async () => {
  // The injection is convenience; this is the guarantee. If the handler's
  // injection were ever removed, the validator must still refuse a row with no
  // selecting clinician rather than storing an unattributed official response.
  const src = await readFile(new URL("../functions/saveOasisResponses/entry.ts", import.meta.url), "utf8");
  assert.ok(
    /missing_selecting_clinician/.test(src),
    "the shared validator must keep its selector presence check",
  );
});

test("a mutually exclusive M1740 combination is refused server-side", async () => {
  const { handler, written } = await loadHandler();
  const { json } = await post(handler, payload({
    oasis_items: [row({ definition_id: "m1740_cms_e2", item_number: "M1740", response_shape: "multi_select", response_value: { codes: ["7", "1"] } })],
  }));
  assert.ok(reasonOf(json).includes("mutually_exclusive_response"));
  assert.equal(written.length, 0);
});

test("an M2401 grid missing a required row is refused server-side", async () => {
  const { handler, written } = await loadHandler();
  const { json } = await post(handler, payload({
    oasis_items: [row({ definition_id: "m2401_cms_e2", item_number: "M2401", response_shape: "grid", response_value: { rows: [{ row_id: "b", code: "1" }] } })],
  }));
  assert.ok(reasonOf(json).includes("missing_grid_row"));
  assert.equal(written.length, 0);
});

test("M1620's UK is refused at DC and accepted at SOC, per CMS", async () => {
  const uk = row({ definition_id: "m1620_cms_e2", item_number: "M1620", response_value: { code: "UK" } });
  const dc = await loadHandler();
  assert.ok(reasonOf((await post(dc.handler, payload({ oasis_items: [uk] }))).json).includes("invalid_code"));
  const soc = await loadHandler();
  const res = await post(soc.handler, payload({
    visit_type: "Start of Care",
    oasis_items: [uk],
  }));
  assert.equal(res.status, 200, JSON.stringify(res.json));
});

test("one bad row rejects the whole write — no partial assessment is persisted", async () => {
  const { handler, written } = await loadHandler();
  const { status, json } = await post(handler, payload({
    oasis_items: [row(), row({ definition_id: "m2420_cms_e2", item_number: "M2420", response_value: { code: "9" } })],
  }));
  assert.equal(status, 422);
  assert.equal(json.errors.length, 1);
  assert.equal(json.errors[0].index, 1, "the failing row is identified by index");
  assert.equal(written.length, 0);
});

test("leading zeros survive the server round-trip", async () => {
  const { handler, written } = await loadHandler();
  const { status } = await post(handler, payload({
    visit_type: "Start of Care",
    oasis_items: [row({ definition_id: "m1100_cms_e2", item_number: "M1100", response_shape: "matrix_choice", response_value: { code: "07" } })],
  }));
  assert.equal(status, 200);
  assert.equal(written[0].rec.oasis_items[0].response_value.code, "07");
});

test("auth is required and a deactivated account is refused", async () => {
  const anon = await loadHandler({ user: null });
  assert.equal((await post(anon.handler, payload())).status, 401);
  const off = await loadHandler({ user: { id: "u1", email: "x@y.com", agency_id: "ag1", is_active: false } });
  assert.equal((await post(off.handler, payload())).status, 403);
  assert.equal(off.written.length, 0);
});

test("only POST is accepted", async () => {
  const { handler } = await loadHandler();
  const res = await handler(new Request("http://local/saveOasisResponses", { method: "GET" }));
  assert.equal(res.status, 405);
});

// ── the selector is the authenticated user, never a client-supplied string ──

test("a response is stamped with the AUTHENTICATED user, not the submitted selected_by", async () => {
  const { handler, written } = await loadHandler();
  // The client omits selected_by entirely; the server supplies it.
  const { status } = await post(handler, payload({ oasis_items: [row({ selected_by: undefined })] }));
  assert.equal(status, 200);
  assert.equal(written[0].rec.oasis_items[0].selected_by, "rn@example.com");
});

test("claiming another clinician selected the response is REFUSED, not rewritten", async () => {
  // Without this, any authenticated caller could record a response as having
  // been chosen by a colleague — the exact attestation provenance this path
  // exists to establish.
  const { handler, written } = await loadHandler();
  const { status, json } = await post(handler, payload({
    oasis_items: [row({ selected_by: "someone.else@example.com" })],
  }));
  assert.equal(status, 403);
  assert.equal(json.reason, "selector_mismatch");
  assert.equal(json.errors[0].index, 0);
  assert.equal(written.length, 0, "nothing may be written on an impersonated selection");
});

test("the selector comparison ignores case and surrounding whitespace", async () => {
  const { handler, written } = await loadHandler();
  const { status } = await post(handler, payload({
    oasis_items: [row({ selected_by: "  RN@Example.COM  " })],
  }));
  assert.equal(status, 200, "the same person in different casing is not an impostor");
  assert.equal(written[0].rec.oasis_items[0].selected_by, "rn@example.com", "stored canonically");
});

test("an authenticated user with no email cannot record a selection", async () => {
  const { handler, written } = await loadHandler({
    user: { id: "u1", agency_id: "ag1", is_active: true },
  });
  const { status, json } = await post(handler, payload());
  assert.equal(status, 403);
  assert.equal(json.reason, "no_selector_identity");
  assert.equal(written.length, 0);
});
