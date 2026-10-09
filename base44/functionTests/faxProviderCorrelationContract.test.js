import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { transpileTs } from "../../tools-transpile-ts.mjs";
import {
  decodeFaxClientState,
  encodeFaxClientState,
} from "../../src/components/fax/faxProviderCorrelation.js";

/**
 * Fax provider correlation contract (Telnyx Programmable Fax).
 *
 * Grounded in Telnyx's OpenAPI spec (read 2026-10-09): fax.* webhook payloads
 * name the fax as `fax_id`, carry the `client_state` given to POST /v2/faxes,
 * and fax.failed carries `failure_reason` plus `internal_failure_reason`.
 * Runs the real handlers against a mocked fetch and an in-memory entity store;
 * never calls Telnyx.
 */

async function loadHandler(entryPath, { env = {}, client, fetchImpl }) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__faxCorrelationClient;",
  );
  const tmp = join(tmpdir(), `faxcorr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, transpileTs(src).outputText);
  let handler;
  const values = { OUTBOUND_DELIVERY_RELEASE: "enabled-v1", ...env };
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (k) => values[k] } };
  globalThis.__faxCorrelationClient = () => client;
  globalThis.fetch = fetchImpl;
  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return handler;
}

function makeFetch(routes = []) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    let body = init.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { /* keep raw */ }
    calls.push({ url: u, method: init.method || "GET", body });
    const route = routes.find((r) => r.match(u, init));
    if (!route) throw new Error(`unexpected provider call ${init.method || "GET"} ${u}`);
    const { status = 200, json = {} } = route.respond(u, init);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

function matches(row, query = {}) {
  return Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((part) => matches(row, part));
    if (key === "$and") return value.every((part) => matches(row, part));
    if (value === null) return row?.[key] == null;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Object.hasOwn(value, "$exists")) return (row?.[key] !== undefined) === value.$exists;
      return JSON.stringify(row?.[key]) === JSON.stringify(value);
    }
    return row?.[key] === value;
  });
}

function makeClient({ data = {}, user = null } = {}) {
  const reads = [];
  const writes = [];
  const entity = (name) => ({
    filter: async (query = {}, _sort, limit) => {
      reads.push({ entity: name, query });
      const rows = (data[name] || []).filter((row) => matches(row, query));
      return structuredClone(typeof limit === "number" ? rows.slice(0, limit) : rows);
    },
    list: async () => structuredClone(data[name] || []),
    create: async (row) => {
      writes.push({ entity: name, op: "create", row: structuredClone(row) });
      const now = new Date().toISOString();
      const created = { id: `${name}_${(data[name] || []).length + 1}`, created_date: now, updated_date: now, version: row.version, ...row };
      (data[name] ||= []).push(created);
      return structuredClone(created);
    },
    update: async (id, patch) => {
      writes.push({ entity: name, op: "update", id, patch: structuredClone(patch) });
      const row = (data[name] || []).find((candidate) => candidate.id === id);
      if (row) Object.assign(row, patch);
      return { id, ...patch };
    },
    updateMany: async (query = {}, patch = {}) => {
      writes.push({ entity: name, op: "updateMany", query: structuredClone(query), patch: structuredClone(patch) });
      const matched = (data[name] || []).filter((row) => matches(row, query));
      for (const row of matched) {
        Object.assign(row, patch.$set || {});
        for (const [key, amount] of Object.entries(patch.$inc || {})) row[key] = (Number(row[key]) || 0) + amount;
        row.updated_date = new Date(Date.parse(row.updated_date || new Date().toISOString()) + 1).toISOString();
      }
      return { success: true, updated: matched.length, has_more: false };
    },
  });
  const entities = new Proxy({}, { get: (_target, name) => entity(String(name)) });
  return {
    reads,
    writes,
    client: { auth: { me: async () => user }, entities, asServiceRole: { entities } },
  };
}

function rawEd25519PublicKeyB64(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32)).toString("base64");
}

function signedWebhook(privateKey, event) {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = nodeSign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString("base64");
  return new Request("https://app/functions/handleTelnyxStatusWebhook", {
    method: "POST",
    headers: { "telnyx-signature-ed25519": signature, "telnyx-timestamp": timestamp, "content-type": "application/json" },
    body: rawBody,
  });
}

const activeTelnyxSecret = (publicKey, overrides = {}) => ({
  id: "integration_1",
  provider: "telnyx",
  is_active: true,
  api_key: "KEYtest",
  public_key: publicKey,
  fax_connection_id: "fax_connection_1",
  updated_date: "2026-09-06T11:59:00.000Z",
  ...overrides,
});

// An authority row exactly as sendBatchFax / sendAuthorizedReferralFax leave it
// once Telnyx has accepted the fax.
const outboundFax = (overrides = {}) => ({
  id: "FaxLog_1",
  created_date: "2026-09-06T12:00:00.000Z",
  updated_date: "2026-09-06T12:00:01.000Z",
  agency_id: "agency_a",
  referral_id: "referral_a",
  document_id: "document_a",
  sent_by: "staff@example.com",
  sent_by_user_id: "user_a",
  sent_by_membership_id: "membership_a",
  sent_by_membership_version: 2,
  from_number: "+12155550100",
  to_number: "+13125550182",
  document_name: "Referral follow-up",
  telnyx_fax_id: "outbound_fax_1",
  provider_submission_attempt_id: "submission_attempt_1",
  provider_submission_state: "accepted",
  provider: "telnyx",
  integration_secret_id: "integration_1",
  integration_secret_updated_at: "2026-09-06T11:59:00.000Z",
  fax_connection_id: "fax_connection_1",
  sender_settings_id: "agency_settings_1",
  sender_settings_updated_at: "2026-09-06T11:58:00.000Z",
  provider_accepted_at: "2026-09-06T12:00:02.000Z",
  status: "sending",
  retry_count: 0,
  retry_generation: 0,
  final_failure_notified: false,
  delivery_confirmation_sent: false,
  ...overrides,
});

// What sendFax writes: a caller-supplied document URL and no provider
// submission attempt, i.e. no tenant/document/provider authority at all.
const legacySendFaxRow = (overrides = {}) => ({
  id: "FaxLog_legacy",
  created_date: "2026-09-06T12:00:00.000Z",
  updated_date: "2026-09-06T12:00:01.000Z",
  from_number: "+12155550100",
  to_number: "+13125550182",
  document_url: "https://base44.app/files/x.pdf",
  document_name: "Fax",
  status: "sending",
  sent_by: "owner@example.com",
  telnyx_fax_id: "legacy_fax_1",
  ...overrides,
});

const WEBHOOK = "../functions/handleTelnyxStatusWebhook/entry.ts";

async function webhookRun(state, event, fetchRoutes = []) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  state.IntegrationSecret = [activeTelnyxSecret(rawEd25519PublicKeyB64(publicKey), state.secretOverrides)];
  delete state.secretOverrides;
  const store = makeClient({ data: state });
  const provider = makeFetch(fetchRoutes);
  const handler = await loadHandler(WEBHOOK, { client: store.client, fetchImpl: provider.impl });
  const response = await handler(signedWebhook(privateKey, event));
  return { response, body: await response.json(), store, provider };
}

const faxWrites = (store) => store.writes.filter((write) => write.entity === "FaxLog");

test("a documented fax_id status event reaches the authorized row", async () => {
  const state = {
    FaxLog: [outboundFax()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active" }],
    Notification: [],
  };
  const { response, body } = await webhookRun(state, { data: { event_type: "fax.delivered", payload: {
    fax_id: "outbound_fax_1",
    direction: "outbound",
    status: "delivered",
    page_count: 2,
    client_state: encodeFaxClientState("outbound", "FaxLog_1"),
  } } });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, "delivered");
  assert.equal(state.FaxLog[0].status, "delivered");
  assert.equal(state.FaxLog[0].provider_terminal_status, "delivered");
  assert.equal(state.FaxLog[0].pages, 2);
});

test("an event naming the fax two different ways is refused before any read", async () => {
  const state = { FaxLog: [outboundFax()] };
  const { response, store } = await webhookRun(state, { data: { event_type: "fax.delivered", payload: {
    fax_id: "outbound_fax_1", id: "outbound_fax_2", status: "delivered",
  } } });
  assert.equal(response.status, 400);
  assert.equal(store.reads.filter((read) => read.entity === "FaxLog").length, 0);
  assert.equal(faxWrites(store).length, 0);
});

test("legacy sendFax rows are acknowledged without a write, by provider id or by client_state", async () => {
  const byProviderId = { FaxLog: [legacySendFaxRow()] };
  const first = await webhookRun(byProviderId, { data: { event_type: "fax.delivered", payload: {
    fax_id: "legacy_fax_1", status: "delivered", client_state: encodeFaxClientState("outbound", "FaxLog_legacy"),
  } } });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.skipped, "untracked_fax_row");
  assert.equal(byProviderId.FaxLog[0].status, "sending");
  assert.equal(faxWrites(first.store).length, 0);

  // The fast-event race: the provider id is not on the row yet.
  const beforeIdRecorded = { FaxLog: [legacySendFaxRow({ telnyx_fax_id: null, status: "queued" })] };
  const second = await webhookRun(beforeIdRecorded, { data: { event_type: "fax.queued", payload: {
    fax_id: "legacy_fax_1", status: "queued", client_state: encodeFaxClientState("outbound", "FaxLog_legacy"),
  } } });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.skipped, "untracked_fax_row");
  assert.equal(faxWrites(second.store).length, 0);
});

test("an accepted fax whose provider id is not recorded yet is redelivered, never written", async () => {
  const pending = outboundFax({
    telnyx_fax_id: null,
    provider_submission_state: "pending",
    provider_accepted_at: null,
    status: "queued",
  });
  const withState = { FaxLog: [pending] };
  const named = await webhookRun(withState, { data: { event_type: "fax.queued", payload: {
    fax_id: "outbound_fax_1", status: "queued", client_state: encodeFaxClientState("outbound", "FaxLog_1"),
  } } });
  assert.equal(named.response.status, 404, JSON.stringify(named.body));
  assert.equal(named.body.code, "FAX_PROVIDER_ID_NOT_RECORDED");
  assert.equal(faxWrites(named.store).length, 0);

  const withoutState = { FaxLog: [structuredClone(pending)] };
  const unnamed = await webhookRun(withoutState, { data: { event_type: "fax.queued", payload: {
    fax_id: "outbound_fax_1", status: "queued",
  } } });
  assert.equal(unnamed.response.status, 404);
  assert.equal(faxWrites(unnamed.store).length, 0);
});

test("a client_state that contradicts the provider identity fails closed", async () => {
  const otherId = { FaxLog: [outboundFax({ telnyx_fax_id: "outbound_fax_other" })] };
  const conflict = await webhookRun(otherId, { data: { event_type: "fax.delivered", payload: {
    fax_id: "outbound_fax_1", status: "delivered", client_state: encodeFaxClientState("outbound", "FaxLog_1"),
  } } });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, "FAX_CLIENT_STATE_CONFLICT");
  assert.equal(faxWrites(conflict.store).length, 0);

  const wrongRow = { FaxLog: [outboundFax()] };
  const misnamed = await webhookRun(wrongRow, { data: { event_type: "fax.delivered", payload: {
    fax_id: "outbound_fax_1", status: "delivered", client_state: encodeFaxClientState("outbound", "FaxLog_2"),
  } } });
  assert.equal(misnamed.response.status, 409);
  assert.equal(misnamed.body.code, "FAX_CLIENT_STATE_CONFLICT");
  assert.equal(wrongRow.FaxLog[0].status, "sending");
  assert.equal(faxWrites(misnamed.store).length, 0);
});

test("a submission the sender recorded as indeterminate is left to reconciliation", async () => {
  const state = { FaxLog: [outboundFax({
    telnyx_fax_id: null,
    provider_submission_state: "indeterminate",
    provider_accepted_at: null,
    status: "submission_unknown",
  })] };
  const { response, body, store } = await webhookRun(state, { data: { event_type: "fax.delivered", payload: {
    fax_id: "outbound_fax_1", status: "delivered", client_state: encodeFaxClientState("outbound", "FaxLog_1"),
  } } });
  assert.equal(response.status, 409);
  assert.equal(body.code, "FAX_SUBMISSION_REQUIRES_RECONCILIATION");
  assert.equal(state.FaxLog[0].status, "submission_unknown");
  assert.equal(faxWrites(store).length, 0);
});

test("office-forward events are acknowledged without reading or writing FaxLog", async () => {
  for (const status of ["queued", "sending", "delivered", "failed"]) {
    const state = { FaxLog: [] };
    const { response, body, store } = await webhookRun(state, { data: { event_type: `fax.${status}`, payload: {
      fax_id: "fwd_1", status, direction: "outbound", client_state: encodeFaxClientState("office_forward", "IncomingFax_1"),
    } } });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.skipped, "office_forward");
    assert.equal(store.reads.filter((read) => read.entity === "FaxLog").length, 0);
    assert.equal(store.writes.length, 0);
  }
});

test("fax.failed classifies the failure with internal_failure_reason", async () => {
  const base = () => ({
    FaxLog: [outboundFax()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active" }],
    FaxRetryConfig: [{ agency_id: "agency_a", max_retries: 3, retry_delay_minutes: 15 }],
    Notification: [],
  });
  // A dropped call alone is retryable; the granular cause says the number is
  // unallocated, so the documented failure is permanent and is not retried.
  const granular = base();
  const permanent = await webhookRun(granular, { data: { event_type: "fax.failed", payload: {
    fax_id: "outbound_fax_1", status: "failed",
    failure_reason: "receiver_call_dropped",
    internal_failure_reason: "fs_fax_unallocated_number",
  } } });
  assert.equal(permanent.response.status, 200, JSON.stringify(permanent.body));
  assert.equal(granular.FaxLog[0].status, "failed");
  assert.equal(granular.FaxLog[0].retry_count, 0);
  assert.equal(granular.FaxLog[0].next_retry_at, null);
  assert.equal(granular.FaxLog[0].failure_reason, "receiver_call_dropped");

  const coarse = base();
  const transient = await webhookRun(coarse, { data: { event_type: "fax.failed", payload: {
    fax_id: "outbound_fax_1", status: "failed", failure_reason: "receiver_call_dropped",
  } } });
  assert.equal(transient.response.status, 200, JSON.stringify(transient.body));
  assert.equal(coarse.FaxLog[0].retry_count, 1);
  assert.ok(Number.isFinite(Date.parse(coarse.FaxLog[0].next_retry_at)));
});

const faxBinding = () => ({
  id: "fax_binding_1",
  binding_key: "telnyx:integration_1:+12155550190",
  provider: "telnyx",
  integration_secret_id: "integration_1",
  destination_e164: "+12155550190",
  provider_number_id: "telnyx_fax_number_1",
  phone_number_id: "fax_phone_number_1",
  agency_id: "agency_a",
  fax_connection_id: "fax_connection_1",
  sms_inbound_enabled: false,
  sms_outbound_enabled: false,
  voice_inbound_enabled: false,
  fax_inbound_enabled: true,
  status: "active",
  source: "manual",
  created_by_user_id: "user_owner",
  created_by_user_email_normalized: "owner@example.com",
  created_at: "2026-01-01T00:00:01.000Z",
  activated_at: "2026-01-01T00:00:01.000Z",
  last_transition_by_user_id: "user_owner",
  last_transition_by_email_normalized: "owner@example.com",
  last_transition_at: "2026-01-01T00:00:01.000Z",
  last_transition_reason: "Reviewed initial binding",
  last_transition_action: "bind",
  last_transition_request_id: "request_1",
  last_transition_request_key: "telnyx:integration_1:+12155550190:request_1",
  version: 1,
});

test("a documented fax_id inbound fax is forwarded with an office_forward client_state", async () => {
  const state = {
    TelecomDestinationBinding: [faxBinding()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    AgencySettings: [{ agency_id: "agency_a", agency_code: "AGENCY-A", office_fax_number_e164: "+17244650444" }],
    IncomingFax: [],
  };
  const { response, body, provider } = await webhookRun(state, { data: { event_type: "fax.received", payload: {
    fax_id: "faxin_1", direction: "inbound", media_url: "https://media.telnyx.com/f1.pdf",
    from: "+13125550182", to: "+12155550190",
  } } }, [
    { match: (u, init) => u === "https://api.telnyx.com/v2/faxes" && init.method === "POST",
      respond: () => ({ status: 202, json: { data: { id: "fwd_1", status: "queued" } } }) },
  ]);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.forwarded_to_office, true);
  assert.equal(body.forward_fax_id, "fwd_1");
  assert.equal(state.IncomingFax.length, 1);
  assert.equal(state.IncomingFax[0].telnyx_fax_id, "faxin_1");
  const forward = provider.calls.find((call) => call.url === "https://api.telnyx.com/v2/faxes");
  assert.deepEqual(decodeFaxClientState(forward.body.client_state), {
    kind: "office_forward",
    id: state.IncomingFax[0].id,
  });
  assert.equal(forward.body.to, "+17244650444");
});

// ---------------------------- senders ----------------------------

async function sendFaxRun(requestUrl) {
  const store = makeClient({
    user: { email: "n@x.com", role: "admin", full_name: "Nora" },
    data: {
      IntegrationSecret: [{ provider: "telnyx", is_active: true, api_key: "KEYtest", fax_connection_id: "FC1" }],
      AgencySettings: [{ office_fax_number_e164: "+12155550190" }],
      FaxLog: [],
    },
  });
  const provider = makeFetch([
    { match: (u) => u === "https://api.telnyx.com/v2/faxes", respond: () => ({ status: 202, json: { data: { id: "fax_1", status: "queued" } } }) },
  ]);
  const handler = await loadHandler("../functions/sendFax/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "n@x.com" }, client: store.client, fetchImpl: provider.impl,
  });
  const response = await handler(new Request(requestUrl, {
    method: "POST",
    body: JSON.stringify({ file_url: "https://base44.app/files/x.pdf", to_number: "+12155550144" }),
  }));
  return { response, store, call: provider.calls.find((c) => c.url === "https://api.telnyx.com/v2/faxes") };
}

test("sendFax names its FaxLog in client_state and derives webhook_url only from its own path", async () => {
  const own = await sendFaxRun("https://app.example/api/apps/a1/functions/sendFax");
  assert.equal(own.response.status, 200);
  const created = own.store.writes.find((w) => w.entity === "FaxLog" && w.op === "create");
  assert.ok(created);
  assert.deepEqual(decodeFaxClientState(own.call.body.client_state), { kind: "outbound", id: "FaxLog_1" });
  assert.equal(own.call.body.webhook_url, "https://app.example/api/apps/a1/functions/handleTelnyxStatusWebhook");

  // A request that did not demonstrably arrive at sendFax derives nothing, and
  // Telnyx falls back to the Fax Application's webhook_event_url.
  for (const url of ["https://app.example/", "https://app.example/functions/other", "http://localhost/functions/sendFax"]) {
    const { call } = await sendFaxRun(url);
    assert.ok(call, url);
    assert.equal(Object.hasOwn(call.body, "webhook_url"), false, url);
    assert.ok(decodeFaxClientState(call.body.client_state), url);
  }
});

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const tmp = join(tmpdir(), `faxcorr_inline_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${transpileTs(src).outputText}\nexport { ${names.join(", ")} };\n`);
  globalThis.Deno = { serve() {}, env: { get: () => undefined } };
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

test("the three fax senders normalize a destination identically, null when unnormalizable", async () => {
  const copies = await Promise.all(["sendFax", "sendBatchFax", "sendAuthorizedReferralFax"].map(
    async (name) => [name, (await loadInline(`../functions/${name}/entry.ts`, ["normalizeFaxDest"])).normalizeFaxDest],
  ));
  const inputs = ["+12155550144", "(215) 555-0144", "12155550144", "215.555.0144", "+49 89 123456",
    "555-0144 ext 2", "555-0144", "+0123456789", "+1234", "fax me", "1 (800) FAX-MACH"];
  for (const input of inputs) {
    const answers = copies.map(([name, normalize]) => [name, normalize(input)]);
    for (const [name, answer] of answers) {
      assert.equal(answer, answers[0][1], `${name} disagrees with sendFax on ${JSON.stringify(input)}`);
    }
  }
  // sendFax used to hand the raw string on ("555-0144 ext 2") instead of null.
  for (const [name, normalize] of copies) {
    for (const garbage of ["555-0144 ext 2", "fax me", "+1234"]) {
      assert.equal(normalize(garbage), null, `${name}(${garbage})`);
    }
  }
});

test("every outbound fax sender names its FaxLog in client_state between the create and the POST", async () => {
  for (const [name, idExpression] of [
    ["sendFax", "faxLog.id"],
    ["sendBatchFax", "faxLogId"],
    ["sendAuthorizedReferralFax", "faxLogId"],
  ]) {
    const source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), "utf8");
    const handlerSource = source.slice(source.indexOf("<<<END SHARED HELPER: faxProviderCorrelation>>>"));
    const encode = handlerSource.indexOf(`encodeFaxClientState('outbound', ${idExpression})`);
    const create = handlerSource.indexOf("FaxLog.create(");
    const post = handlerSource.indexOf("fetch('https://api.telnyx.com/v2/faxes'");
    assert.ok(encode > -1, `${name}: encodes its FaxLog id`);
    assert.ok(create > -1 && create < encode, `${name}: the FaxLog exists before its client_state`);
    assert.ok(post > encode, `${name}: client_state is built before the provider POST`);
    assert.match(handlerSource, /\.client_state = clientState/, `${name}: client_state reaches the payload`);
    assert.match(handlerSource, new RegExp(`faxStatusWebhookUrl\\(req\\.url, '${name}'\\)`), `${name}: webhook_url derives from its own name`);
    // The old derivation stripped "the last path segment" of whatever arrived.
    assert.doesNotMatch(handlerSource, /replace\(\/\\\/\[\^\/\]\+\$\/, ''\)/, `${name}: no blind path-segment strip`);
  }
});

// ---------------------------- retired poller ----------------------------

test("syncFaxStatuses is retired: it authorizes first, then refuses without reading, writing or calling Telnyx", async () => {
  const source = await readFile(new URL("../functions/syncFaxStatuses/entry.ts", import.meta.url), "utf8");
  for (const effect of [/\bfetch\(/, /\.update\(/, /\.updateMany\(/, /\.create\(/, /\.filter\(/, /\.Notification\b/]) {
    assert.doesNotMatch(source, effect, `retired poller still contains ${effect}`);
  }
  for (const [user, env, headers, status] of [
    [{ id: "admin_1", role: "admin", email: "a@x.com" }, {}, {}, 410],
    [null, { INTERNAL_FN_SECRET: "s3cret" }, { "x-internal-secret": "s3cret" }, 410],
    [null, { INTERNAL_FN_SECRET: "s3cret" }, {}, 401],
    [{ id: "user_1", role: "user", email: "u@x.com" }, { INTERNAL_FN_SECRET: "s3cret" }, {}, 403],
  ]) {
    const store = makeClient({ user, data: { FaxLog: [outboundFax({ status: "sending" })] } });
    const provider = makeFetch([]);
    const handler = await loadHandler("../functions/syncFaxStatuses/entry.ts", {
      env, client: store.client, fetchImpl: provider.impl,
    });
    const response = await handler(new Request("https://app/functions/syncFaxStatuses", { method: "POST", headers }));
    assert.equal(response.status, status);
    if (status === 410) {
      const body = await response.json();
      assert.equal(body.code, "FAX_STATUS_SYNC_RETIRED");
      assert.equal(body.superseded_by, "pollFaxStatuses");
    }
    assert.equal(store.reads.length, 0);
    assert.equal(store.writes.length, 0);
    assert.equal(provider.calls.length, 0);
  }
});
