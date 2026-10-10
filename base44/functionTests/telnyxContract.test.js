import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Telnyx REST / Call Control CONTRACT HARNESS.
 *
 * We can't place a real call or send a real text in CI, but we CAN run each
 * backend function's actual handler against a mocked `fetch` + a fake Base44
 * client and assert that the outgoing Telnyx request matches the documented
 * Telnyx v2 contract (verified against developers.telnyx.com):
 *   - Messages:    POST https://api.telnyx.com/v2/messages            { from, to, text }
 *   - Faxes:       POST https://api.telnyx.com/v2/faxes               { connection_id, from, to, media_url }
 *   - Calls:       POST https://api.telnyx.com/v2/calls               { connection_id, to, from }
 *   - Commands:    POST https://api.telnyx.com/v2/calls/{id}/actions/{cmd}
 *   - Number order:POST https://api.telnyx.com/v2/number_orders       { phone_numbers: [...] }
 *   - Video token: POST https://api.telnyx.com/v2/rooms/{id}/actions/generate_join_client_token
 *
 * The webhook test also exercises real Ed25519 verification with a generated
 * keypair, so the signature path is validated end-to-end.
 */

// ---- run a function's Deno.serve handler with injected globals ----
async function loadHandler(entryPath, { env = {}, makeClient, fetchImpl }) {
  env = { OUTBOUND_DELIVERY_RELEASE: 'enabled-v1', ...env };
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  // Telehealth provider access and inbound call and SMS routing were all
  // released on 2026-10-08, so the replacements below are no-ops kept for
  // symmetry (they would re-open a gate if one were ever restored).
  // Dedicated containment contracts assert those gates; this harness rewrites
  // only its temporary copy so dormant Telnyx request shapes remain regression
  // tested. Fax ingress is live only through its exact service-owned
  // destination binding.
  if (entryPath.endsWith('/createTelehealthToken/entry.ts')) {
    src = src.replace(
      'const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = true;',
      'const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = false;',
    );
  }
  if (entryPath.endsWith('/handleTelnyxStatusWebhook/entry.ts')) {
    for (const flag of [
      'INBOUND_PATIENT_SMS_ROUTING_PAUSED',
      'INBOUND_PATIENT_CALL_ROUTING_PAUSED',
    ]) {
      src = src.replace(`const ${flag} = true;`, `const ${flag} = false;`);
    }
  }
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = globalThis.__telnyxMakeClient;");
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `telnyxctr_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, js);

  let handler;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (k) => env[k] } };
  globalThis.__telnyxMakeClient = makeClient;
  // Install the mock fetch and LEAVE it installed — the handler runs after this
  // function returns, so restoring fetch here would unhook it before the call.
  globalThis.fetch = fetchImpl;
  try {
    await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return handler;
}

// Records every outbound request and returns canned responses keyed by URL match.
function makeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    let body = init.body;
    try { body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body; } catch { /* keep raw */ }
    calls.push({ url: u, method: init.method || "GET", headers: init.headers || {}, body });
    const route = routes.find((r) => r.match(u, init));
    const { status = 200, json = {} } = route ? route.respond(u, init) : {};
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

// Minimal Base44 fake. entities[Name] supports create/update/filter/list; values
// come from `data` overrides (per entity) or sane defaults.
function makeBase44({ user = { email: "n@x.com", full_name: "Nora", work_phone_number: "+12155550100", personal_cell_e164: "+12155550111" }, data = {} } = {}) {
  const entity = (name) => ({
    create: async (row) => ({ id: `${name}_1`, ...row }),
    update: async (id, patch) => ({ id, ...patch }),
    filter: async () => data[name] || [],
    list: async () => data[name] || [],
  });
  const entities = new Proxy({}, { get: (_t, name) => entity(String(name)) });
  return { auth: { me: async () => user }, entities, asServiceRole: { entities } };
}

const activeTelnyxSecret = (overrides = {}) => ({
  id: "integration_1",
  provider: "telnyx",
  is_active: true,
  api_key: "KEYtest",
  fax_connection_id: "fax_connection_1",
  updated_date: "2026-09-06T11:59:00.000Z",
  ...overrides,
});

const pollFaxStatusesReleased = {
  WORKFLOW_RELEASE_POLL_FAX_STATUSES: "enabled-v1",
};

const smsBinding = (overrides = {}) => ({
  id: "binding_1",
  binding_key: "telnyx:integration_1:+12155550100",
  provider: "telnyx",
  integration_secret_id: "integration_1",
  destination_e164: "+12155550100",
  provider_number_id: "telnyx_number_1",
  phone_number_id: "phone_number_1",
  agency_id: "agency_a",
  messaging_profile_id: "MP1",
  sms_inbound_enabled: true,
  sms_outbound_enabled: true,
  voice_inbound_enabled: false,
  fax_inbound_enabled: false,
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
  last_transition_request_key: "telnyx:integration_1:+12155550100:request_1",
  version: 1,
  ...overrides,
});

const faxBinding = (overrides = {}) => ({
  ...smsBinding({
    id: "fax_binding_1",
    binding_key: "telnyx:integration_1:+12155550190",
    destination_e164: "+12155550190",
    provider_number_id: "telnyx_fax_number_1",
    phone_number_id: "fax_phone_number_1",
    sms_inbound_enabled: false,
    sms_outbound_enabled: false,
    fax_inbound_enabled: true,
    fax_connection_id: "FC1",
    last_transition_request_key: "telnyx:integration_1:+12155550190:request_1",
  }),
  ...overrides,
});

const scopedSmsConsent = (overrides = {}) => {
  const consentStatus = overrides.consent_status || "opted_in";
  const consentSource = overrides.consent_source || "manual_opt_in";
  const capturedAt = overrides.captured_at || "2026-01-01T00:00:00Z";
  const isKeyword = consentSource === "keyword_stop" || consentSource === "keyword_start";
  return {
    consent_key: "telnyx:integration_1:MP1:agency_a:+12155550133",
    agency_id: "agency_a",
    provider: "telnyx",
    integration_secret_id: "integration_1",
    messaging_profile_id: "MP1",
    destination_binding_id: "binding_1",
    destination_binding_key: "telnyx:integration_1:+12155550100",
    destination_e164: "+12155550100",
    phone_e164: "+12155550133",
    consent_status: consentStatus,
    consent_source: consentSource,
    captured_at: capturedAt,
    ...(isKeyword ? {
      captured_by: null,
      provider_event_id: `event_${consentSource}_${capturedAt}`,
      provider_message_id: `message_${consentSource}_${capturedAt}`,
      provider_event_occurred_at: capturedAt,
    } : {
      captured_by: "owner@example.com",
    }),
    ...overrides,
  };
};

const BEARER = (h) => (h && (h.Authorization || h.authorization)) || "";

// ============================ MESSAGES ============================
test("sendSms posts the Telnyx Messages contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "msg_1", to: [{ status: "queued" }] } } }) },
  ]);
  const handler = await loadHandler("../functions/sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_MESSAGING_PROFILE_ID: "MP1", SUPER_ADMIN_EMAIL: "n@x.com" },
    makeClient: () => makeBase44({ user: {
      email: "n@x.com", role: "admin", full_name: "Nora",
      work_phone_number: "+12155550100", personal_cell_e164: "+12155550111",
    }, data: {
      IntegrationSecret: [activeTelnyxSecret({ messaging_profile_id: "MP1" })],
      TelecomDestinationBinding: [smsBinding()],
      // Contract tests are wall-clock independent: disable TCPA quiet hours so a
      // night-time CI run does not 403 a Messages-API shape assertion.
      AgencySettings: [{ tcpa_quiet_hours_enabled: false, sms_enabled: true }],
      SmsConsent: [scopedSmsConsent()],
    } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/sendSms", {
    method: "POST", body: JSON.stringify({ to_number: "2155550133", body: "hi" }),
  }));
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/messages");
  assert.ok(call, "posted to the Telnyx Messages endpoint");
  assert.equal(call.method, "POST");
  assert.match(BEARER(call.headers), /^Bearer KEYtest$/);
  assert.equal(call.body.from, "+12155550100");
  assert.equal(call.body.to, "+12155550133");
  assert.equal(call.body.text, "hi");
  assert.equal(call.body.messaging_profile_id, "MP1");
});

test("sendSms never authorizes from legacy, foreign, ambiguous, or inbound-only consent authority", async () => {
  const user = {
    email: "n@x.com", role: "admin", full_name: "Nora",
    work_phone_number: "+12155550100", personal_cell_e164: "+12155550111",
  };
  const scenarios = [
    {
      name: "legacy phone-only consent",
      data: {
        TelecomDestinationBinding: [smsBinding()],
        SmsConsent: [{
          phone_e164: "+12155550133",
          consent_status: "opted_in",
          captured_at: "2026-01-01T00:00:00Z",
        }],
      },
    },
    {
      name: "foreign tenant/profile consent",
      data: {
        TelecomDestinationBinding: [smsBinding()],
        SmsConsent: [scopedSmsConsent({
          consent_key: "telnyx:integration_1:MP_OTHER:agency_b:+12155550133",
          agency_id: "agency_b",
          messaging_profile_id: "MP_OTHER",
        })],
      },
    },
    {
      name: "equal latest timestamps",
      data: {
        TelecomDestinationBinding: [smsBinding()],
        SmsConsent: [
          scopedSmsConsent({ consent_status: "opted_in", consent_source: "keyword_start" }),
          scopedSmsConsent({ consent_status: "opted_out", consent_source: "keyword_stop" }),
        ],
      },
      expectedStatus: 503,
    },
    {
      name: "delayed older START cannot supersede newer STOP",
      data: {
        TelecomDestinationBinding: [smsBinding()],
        SmsConsent: [
          scopedSmsConsent({
            consent_status: "opted_out",
            consent_source: "keyword_stop",
            captured_at: "2026-01-01T00:00:02Z",
          }),
          scopedSmsConsent({
            consent_status: "opted_in",
            consent_source: "keyword_start",
            captured_at: "2026-01-01T00:00:01Z",
          }),
        ],
      },
      expectedStatus: 403,
    },
    {
      name: "intervening manual rows cannot hide an unlifted keyword STOP",
      data: {
        TelecomDestinationBinding: [smsBinding()],
        SmsConsent: [
          scopedSmsConsent({
            consent_status: "opted_in",
            consent_source: "manual_opt_in",
            captured_at: "2026-01-01T00:00:04Z",
          }),
          scopedSmsConsent({
            consent_status: "opted_out",
            consent_source: "manual_opt_out",
            captured_at: "2026-01-01T00:00:03Z",
          }),
          scopedSmsConsent({
            consent_status: "opted_out",
            consent_source: "keyword_stop",
            captured_at: "2026-01-01T00:00:02Z",
          }),
        ],
      },
      expectedStatus: 403,
    },
    {
      name: "keyword START without immutable provider provenance",
      data: {
        TelecomDestinationBinding: [smsBinding()],
        SmsConsent: [scopedSmsConsent({
          consent_source: "keyword_start",
          provider_event_id: undefined,
        })],
      },
      expectedStatus: 503,
    },
    {
      name: "consent missing binding provenance",
      data: {
        TelecomDestinationBinding: [smsBinding()],
        SmsConsent: [scopedSmsConsent({ destination_binding_id: undefined })],
      },
      expectedStatus: 503,
    },
    {
      name: "inbound-only binding",
      data: {
        TelecomDestinationBinding: [smsBinding({ sms_outbound_enabled: false })],
        SmsConsent: [scopedSmsConsent()],
      },
      expectedStatus: 503,
    },
  ];

  for (const scenario of scenarios) {
    const { impl, calls } = makeFetch([
      { match: (url) => url.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "unexpected" } } }) },
    ]);
    const handler = await loadHandler("../functions/sendSms/entry.ts", {
      env: { SUPER_ADMIN_EMAIL: "n@x.com" },
      makeClient: () => makeBase44({
        user,
        data: {
          IntegrationSecret: [activeTelnyxSecret({ messaging_profile_id: "MP1" })],
          AgencySettings: [{ tcpa_quiet_hours_enabled: false, sms_enabled: true }],
          ...scenario.data,
        },
      }),
      fetchImpl: impl,
    });
    const response = await handler(new Request("https://app/functions/sendSms", {
      method: "POST",
      body: JSON.stringify({ to_number: "+12155550133", body: "must not send" }),
    }));
    assert.equal(response.status, scenario.expectedStatus || 503, scenario.name);
    assert.equal(calls.filter((call) => call.url.includes("/v2/messages")).length, 0, scenario.name);
  }
});

// ============================ FAX ============================
test("sendFax posts the Telnyx Programmable Fax contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/faxes"), respond: () => ({ status: 200, json: { data: { id: "fax_1", status: "queued" } } }) },
  ]);
  const handler = await loadHandler("../functions/sendFax/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "n@x.com" },
    makeClient: () => makeBase44({ user: {
      email: "n@x.com", role: "admin", full_name: "Nora",
      work_phone_number: "+12155550100", personal_cell_e164: "+12155550111",
    }, data: {
      IntegrationSecret: [{ api_key: "KEYtest", fax_connection_id: "FC1" }],
      AgencySettings: [{ office_fax_number_e164: "+12155550190" }],
    } }),
    fetchImpl: impl,
  });
  await handler(new Request("https://app/functions/sendFax", {
    // file_url must be on an allowlisted storage host — sendFax now rejects
    // arbitrary hosts (SSRF guard) before handing media_url to Telnyx.
    method: "POST", body: JSON.stringify({ file_url: "https://base44.app/files/x.pdf", to_number: "+12155550144", document_name: "Doc" }),
  }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/faxes");
  assert.ok(call, "posted to the Telnyx Faxes endpoint");
  assert.match(BEARER(call.headers), /^Bearer KEYtest$/);
  assert.equal(call.body.connection_id, "FC1");
  assert.equal(call.body.from, "+12155550190");
  assert.equal(call.body.to, "+12155550144");
  assert.equal(call.body.media_url, "https://base44.app/files/x.pdf");
});

// ============================ VOICE (outbound) ============================
test("startMaskedCall posts the Telnyx Call Control create-call contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.endsWith("/v2/calls"), respond: () => ({ status: 200, json: { data: { call_control_id: "cc_1" } } }) },
  ]);
  const handler = await loadHandler("../functions/startMaskedCall/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_VOICE_CONNECTION_ID: "VC1", SUPER_ADMIN_EMAIL: "n@x.com" },
    // The caller id must be an active TelecomDestinationBinding of the
    // current credential (released 2026-10-08).
    makeClient: () => makeBase44({ user: {
      email: "n@x.com", role: "admin", full_name: "Nora",
      work_phone_number: "+12155550100", personal_cell_e164: "+12155550111",
    }, data: {
      IntegrationSecret: [activeTelnyxSecret({ voice_connection_id: "VC1" })],
      TelecomDestinationBinding: [smsBinding()],
    } }),
    fetchImpl: impl,
  });
  await handler(new Request("https://app/functions/startMaskedCall", {
    method: "POST", body: JSON.stringify({ to_number: "2155550155" }),
  }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/calls");
  assert.ok(call, "posted to the Telnyx Calls endpoint");
  assert.match(BEARER(call.headers), /^Bearer KEYtest$/);
  assert.equal(call.body.connection_id, "VC1");
  assert.equal(call.body.to, "+12155550111"); // ring the nurse's cell first
  assert.equal(call.body.from, "+12155550100"); // present the work number
  assert.ok(typeof call.body.client_state === "string" && call.body.client_state.length > 0, "carries client_state for the bridge");
  // The nurse's cell is screened, so the patient is never transferred into the
  // nurse's voicemail; the bridge waits for the verdict (state.amd).
  assert.equal(call.body.answering_machine_detection, "detect");
  assert.deepEqual(call.body.answering_machine_detection_config, { total_analysis_time_millis: 5000 });
  const state = JSON.parse(Buffer.from(call.body.client_state, "base64").toString("utf8"));
  assert.equal(state.t, "masked_bridge");
  assert.equal(state.amd, true);
});

// ============================ NUMBER PROVISIONING ============================
// A settled order as Telnyx's POST /v2/number_orders documents it: the order and
// each line carry status (pending|success|failure) and requirements_met, and the
// line id (phone_numbers[].id) is a number-ORDER line, not a phone number.
const numberOrder = (e164, overrides = {}, line = {}) => ({
  id: "ord_1", record_type: "number_order", status: "success", requirements_met: true,
  phone_numbers: [{ id: "order_line_1", record_type: "number_order_phone_number", phone_number: e164, status: "success", requirements_met: true, ...line }],
  ...overrides,
});
// The account's /v2/phone_numbers resource for a number (what PATCH takes).
const ownedNumber = (e164, overrides = {}) => ({
  id: "pn_resource_1", record_type: "phone_number", phone_number: e164, status: "active",
  connection_id: "VC1", messaging_profile_id: "MP1", ...overrides,
});

test("searchPurchaseTelnyxNumbers posts the Telnyx number-order contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: numberOrder("+12155550177") } }) },
    { match: (u) => u.includes("/v2/phone_numbers?"), respond: () => ({ status: 200, json: { data: [ownedNumber("+12155550177")] } }) },
  ]);
  const writes = [];
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({ writes, user: { email: "a@x.com", role: "admin" }, data: { IntegrationSecret: [{ api_key: "KEYtest" }] } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "purchase", e164: "2155550177" }),
  }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/number_orders");
  assert.ok(call, "posted to the Telnyx number_orders endpoint");
  assert.match(BEARER(call.headers), /^Bearer KEYtest$/);
  assert.deepEqual(call.body.phone_numbers, [{ phone_number: "+12155550177" }]);
  // The stored id is the /v2/phone_numbers RESOURCE id, resolved by a lookup
  // whose filter carries digits only (Telnyx: non-numerical characters return
  // no rows) — never the order-line id or the order id.
  const lookup = calls.find((c) => c.url.includes("/v2/phone_numbers?"));
  assert.equal(lookup?.url, "https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=12155550177");
  const data = await res.json();
  assert.equal(data.telnyx_number_id, "pn_resource_1");
  assert.equal(data.telnyx_order_id, "ord_1");
  assert.equal(data.order_status, "complete");
  const created = writes.find((w) => w.entity === "PhoneNumber" && w.op === "create")?.row;
  assert.equal(created?.twilio_phone_number_sid, "pn_resource_1");
  assert.equal(created?.status, "available");
});

test("a self-asserted super_admin account_type cannot purchase a Telnyx number", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: { id: "ord_denied" } } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", SUPER_ADMIN_EMAIL: "owner@x.com" },
    makeClient: () => makeBase44({
      user: { email: "attacker@x.com", role: "admin", account_type: "super_admin", agency_name: "Victim Agency" },
      data: { IntegrationSecret: [{ api_key: "KEYtest" }] },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "purchase", e164: "2155550177" }),
  }));
  assert.equal(res.status, 403);
  assert.equal(calls.some((c) => c.url.includes("/v2/number_orders")), false);
});

test("a nurse-line purchase auto-enrolls the number in the saved A2P campaign", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: numberOrder("+12155550188", { id: "ord_3" }) } }) },
    { match: (u) => u.includes("/v2/phone_numbers?"), respond: () => ({ status: 200, json: { data: [ownedNumber("+12155550188")] } }) },
    { match: (u) => u.includes("/v2/10dlc/phone_number_campaigns"), respond: () => ({ status: 200, json: { phoneNumber: "+12155550188", campaignId: "CAMP1" } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({
      user: { email: "a@x.com", role: "admin" },
      data: {
        IntegrationSecret: [{ api_key: "KEYtest", voice_connection_id: "VC1", messaging_profile_id: "MP1" }],
        AgencySettings: [{ id: "as_1", a2p_campaign_id: "CAMP1" }],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "purchase", e164: "2155550188" }),
  }));
  const data = await res.json();
  const enroll = calls.find((c) => c.url.includes("/v2/10dlc/phone_number_campaigns"));
  assert.ok(enroll, "posted the 10DLC phone-number-campaign assignment");
  assert.equal(enroll.method, "POST");
  assert.equal(enroll.body.phoneNumber, "+12155550188");
  assert.equal(enroll.body.campaignId, "CAMP1");
  assert.equal(data.campaign_assigned, true);
  assert.deepEqual(data.warnings, []);
});

test("a nurse-line purchase with NO saved campaign warns instead of enrolling", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: numberOrder("+12155550190", { id: "ord_4" }) } }) },
    { match: (u) => u.includes("/v2/phone_numbers?"), respond: () => ({ status: 200, json: { data: [ownedNumber("+12155550190")] } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({
      user: { email: "a@x.com", role: "admin" },
      data: { IntegrationSecret: [{ api_key: "KEYtest", voice_connection_id: "VC1", messaging_profile_id: "MP1" }] },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "purchase", e164: "2155550190" }),
  }));
  const data = await res.json();
  assert.equal(calls.some((c) => c.url.includes("/v2/10dlc/")), false, "no 10DLC call without a saved campaign");
  assert.equal(data.campaign_assigned, false);
  assert.ok(data.warnings.some((w) => /campaign/i.test(w)), "warns that the number is not campaign-registered");
});

// A minimal spy-able client: like makeBase44 but with stable per-entity objects
// so update/create calls can be recorded, and per-entity overrides.
function makeSpyBase44({ user = { email: "a@x.com", role: "admin", full_name: "Ada" }, data = {}, writes = [] } = {}) {
  for (const [index, row] of (data.IntegrationSecret || []).entries()) {
    Object.assign(row, { id: row.id ?? `integration_${index}`, provider: row.provider ?? 'telnyx',
      is_active: row.is_active ?? true, updated_date: row.updated_date ?? '2026-09-11T12:00:00.000Z' });
  }
  const cache = {};
  const matches = (row, query = {}) => Object.entries(query).every(([key, value]) => {
    if (value === null) return row?.[key] == null;
    if (key === '$and') return value.every((part) => matches(row, part));
    if (key === '$or') return value.some((part) => matches(row, part));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!Object.keys(value).some((key) => key.startsWith("$"))) return JSON.stringify(row?.[key]) === JSON.stringify(value);
      if (Object.hasOwn(value, "$ne") && row?.[key] === value.$ne) return false;
      if (Object.hasOwn(value, "$exists")) {
        return (row?.[key] !== undefined) === value.$exists;
      }
      if (Object.hasOwn(value, "$lte") && !(row?.[key] != null && row[key] <= value.$lte)) return false;
      if (Object.hasOwn(value, "$gte") && !(row?.[key] != null && row[key] >= value.$gte)) return false;
      if (Object.hasOwn(value, "$gt") && !(row?.[key] != null && row[key] > value.$gt)) return false;
      if (Object.hasOwn(value, "$lt") && !(row?.[key] != null && row[key] < value.$lt)) return false;
      if (Array.isArray(value.$in) && !value.$in.includes(row?.[key])) return false;
      return true;
    }
    return row?.[key] === value;
  });
  const entity = (name) => {
    if (!cache[name]) {
      cache[name] = {
        create: async (row) => {
          const now = new Date().toISOString();
          const created = { id: `${name}_1`, created_date: now, updated_date: now, ...row };
          writes.push({ entity: name, op: "create", row });
          if (!data[name]) data[name] = [];
          data[name].push(created);
          return created;
        },
        update: async (id, patch) => {
          writes.push({ entity: name, op: "update", id, patch });
          const rows = data[name] || [];
          const idx = rows.findIndex((r) => r.id === id);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
          return { id, ...patch };
        },
        updateMany: async (query = {}, patch = {}) => {
          writes.push({ entity: name, op: "updateMany", query, patch });
          const rows = data[name] || [];
          const matched = rows.filter((row) => matches(row, query));
          for (const row of matched) {
            Object.assign(row, patch.$set || {});
            for (const [key, amount] of Object.entries(patch.$inc || {})) {
              row[key] = (Number(row[key]) || 0) + Number(amount);
            }
            row.updated_date = new Date((row.updated_date ? Date.parse(row.updated_date) : Date.now()) + 1).toISOString();
          }
          return { success: true, updated: matched.length, has_more: false };
        },
        deleteMany: async (query = {}) => {
          const rows = data[name] || [];
          const matched = rows.filter((row) => matches(row, query));
          writes.push({ entity: name, op: 'deleteMany', query });
          data[name] = rows.filter((row) => !matches(row, query));
          return { success: true, deleted: matched.length };
        },
        // Support id-equality filters used by claim-before-assign / claim-before-send.
        filter: async (query = {}, sort, limit, skip = 0) => {
          let rows = data[name] || [];
          if (name === "FaxLog") {
            rows = rows.filter((row) => matches(row, query));
          } else {
            if (query && query.id != null) rows = rows.filter((row) => row.id === query.id);
            if (typeof query?.telnyx_fax_id === "string") {
              rows = rows.filter((row) => row.telnyx_fax_id === query.telnyx_fax_id);
            }
            if (typeof query?.status === "string") {
              rows = rows.filter((row) => row.status === query.status);
            } else if (Array.isArray(query?.status?.$in)) {
              rows = rows.filter((row) => query.status.$in.includes(row.status));
            }
          }
          rows = [...rows];
          if (typeof sort === "string") {
            const direction = sort.startsWith("-") ? -1 : 1;
            const field = sort.replace(/^-/, "");
            rows.sort((a, b) => direction * String(a?.[field] || "").localeCompare(String(b?.[field] || "")));
          }
          if (Number.isSafeInteger(limit)) {
            const offset = Number.isSafeInteger(skip) && skip >= 0 ? skip : 0;
            rows = rows.slice(offset, offset + limit);
          }
          return ['FaxLog', 'PhoneNumber', 'User', 'IntegrationSecret'].includes(name) ? structuredClone(rows) : rows;
        },
        list: async () => data[name] || [],
      };
    }
    return cache[name];
  };
  const entities = new Proxy({}, { get: (_t, name) => entity(String(name)) });
  return { auth: { me: async () => user }, entities, asServiceRole: { entities } };
}

test("a fax-purpose search filters fax-capable numbers (not sms/voice)", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/available_phone_numbers"), respond: () => ({ status: 200, json: { data: [{ phone_number: "+12155550166" }] } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest", fax_connection_id: "FC1" }] } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "search", purpose: "fax", area_code: "215" }),
  }));
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.url.includes("/v2/available_phone_numbers"));
  assert.ok(call, "searched Telnyx available numbers");
  const decoded = decodeURIComponent(call.url);
  assert.match(decoded, /filter\[features\]\[\]=fax/, "filters fax capability");
  assert.ok(!/filter\[features\]\[\]=sms/.test(decoded), "fax search does not require sms");
});

test("a fax-purpose purchase attaches the FAX connection and sets the blind outbound line", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: numberOrder("+12155550199", { id: "ord_2" }) } }) },
    { match: (u) => u.includes("/v2/phone_numbers?"), respond: () => ({ status: 200, json: { data: [ownedNumber("+12155550199", { connection_id: "FC1", messaging_profile_id: null })] } }) },
  ]);
  const writes = [];
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({
      writes,
      data: {
        IntegrationSecret: [{ api_key: "KEYtest", fax_connection_id: "FC1", messaging_profile_id: "MP1", voice_connection_id: "VC1" }],
        AgencySettings: [{ id: "AS1" }],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "purchase", e164: "2155550199", purpose: "fax" }),
  }));
  assert.equal(res.status, 200);
  const order = calls.find((c) => c.url === "https://api.telnyx.com/v2/number_orders");
  assert.ok(order, "posted a number order");
  assert.equal(order.body.connection_id, "FC1", "fax purchases attach the fax connection, not voice");
  assert.equal(order.body.messaging_profile_id, undefined, "fax purchases don't attach the messaging profile");
  assert.equal(writes.find((w) => w.entity === 'PhoneNumber' && w.op === 'create')?.row.status, 'reserved');
  const outboundWrite = writes.find((w) => w.entity === "AgencySettings" && w.op === "update");
  assert.equal(outboundWrite?.id, "AS1");
  assert.equal(outboundWrite?.patch.outbound_fax_number_e164, "+12155550199", "stored as the blind outbound fax line");
  assert.equal(outboundWrite?.patch.office_fax_number_e164, undefined, "the office reply-to number is untouched");
});

test("provision_fax re-points an owned number at the fax connection", async () => {
  const { impl, calls } = makeFetch([
    { match: (u, init) => u.includes("/v2/phone_numbers?"), respond: () => ({ status: 200, json: { data: [{ id: "np_7", phone_number: "+12155550188" }] } }) },
    { match: (u, init) => /\/v2\/phone_numbers\/np_7$/.test(u) && init.method === "PATCH", respond: () => ({ status: 200, json: { data: { id: "np_7" } } }) },
  ]);
  const writes = [];
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({
      writes,
      data: {
        IntegrationSecret: [{ api_key: "KEYtest", fax_connection_id: "FC1" }],
        AgencySettings: [{ id: "AS1", office_fax_number_e164: "" }],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "provision_fax", e164: "(215) 555-0188" }),
  }));
  assert.equal(res.status, 200);
  // filter[phone_number] takes digits: an encoded '+' answers "no rows", which
  // used to read as "this number isn't in your Telnyx account".
  const lookup = calls.find((c) => c.url.includes("/v2/phone_numbers?"));
  assert.equal(lookup?.url, "https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=12155550188");
  const patch = calls.find((c) => /\/v2\/phone_numbers\/np_7$/.test(c.url) && c.method === "PATCH");
  assert.ok(patch, "PATCHed the owned Telnyx number");
  assert.equal(patch.body.connection_id, "FC1", "re-pointed at the Programmable Fax connection");
  const outboundWrite = writes.find((w) => w.entity === "AgencySettings" && w.op === "update");
  assert.equal(outboundWrite?.patch.outbound_fax_number_e164, "+12155550188", "stored normalized as the blind outbound fax line");
  assert.equal(writes.find((w) => w.entity === 'PhoneNumber' && w.op === 'create')?.row.status, 'reserved');
});

// ---- number orders are asynchronous ----
// POST /v2/number_orders answers with status pending|success|failure and
// requirements_met; completion is a later event. A purchase must not treat a
// pending order as a working line.
async function purchaseWith({ e164 = "+12155550177", purpose = "voice_sms", post, reread, owned = [], agency = [{ id: "AS1", a2p_campaign_id: "CAMP1" }], secret = {} }) {
  const writes = [];
  const data = {
    IntegrationSecret: [activeTelnyxSecret({ voice_connection_id: "VC1", messaging_profile_id: "MP1", fax_connection_id: "FC1", ...secret })],
    PhoneNumber: [],
    AgencySettings: agency,
  };
  let rereads = 0;
  const { impl, calls } = makeFetch([
    { match: (u) => u === "https://api.telnyx.com/v2/number_orders", respond: () => ({ status: 200, json: { data: post } }) },
    { match: (u) => u.startsWith("https://api.telnyx.com/v2/number_orders/"), respond: () => {
      rereads += 1;
      return { status: 200, json: { data: typeof reread === "function" ? reread(rereads) : reread } };
    } },
    { match: (u) => u.includes("/v2/phone_numbers?"), respond: () => ({ status: 200, json: { data: owned } }) },
    { match: (u) => u.includes("/v2/10dlc/phone_number_campaigns"), respond: () => ({ status: 200, json: { phoneNumber: e164, campaignId: "CAMP1" } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({ writes, data }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "purchase", e164, purpose }),
  }));
  return { res, json: await res.json(), writes, data, calls, rereads: () => rereads };
}

test("a pending number order is recorded but not enrolled, and is not called active", async () => {
  const pending = numberOrder("+12155550177", { status: "pending" }, { status: "pending" });
  const out = await purchaseWith({ post: pending, reread: pending, owned: [] });
  assert.equal(out.res.status, 200);
  assert.equal(out.json.order_status, "pending");
  assert.equal(out.rereads(), 2, "a pending order is re-read a bounded number of times");
  assert.equal(out.json.telnyx_number_id, null, "no phone-number resource exists yet, and the order-line id is not stored in its place");
  const row = out.data.PhoneNumber[0];
  assert.equal(row.status, "available");
  assert.equal(row.twilio_phone_number_sid, "");
  assert.match(row.notes, /Not active at purchase \(Telnyx order ord_1: pending\)/);
  assert.equal(out.calls.some((c) => c.url.includes("/v2/10dlc/")), false, "a pending number is not enrolled in a campaign");
  assert.equal(out.json.campaign_assigned, false);
  assert.ok(out.json.warnings.some((w) => /still activating \+12155550177/.test(w)), out.json.warnings.join(" | "));
  assert.ok(out.json.warnings.some((w) => /NOT enrolled in A2P campaign CAMP1/.test(w)), out.json.warnings.join(" | "));
});

test("an order that settles on a re-read is enrolled and recorded with its phone-number id", async () => {
  const out = await purchaseWith({
    post: numberOrder("+12155550177", { status: "pending" }, { status: "pending" }),
    reread: numberOrder("+12155550177"),
    owned: [ownedNumber("+12155550177")],
  });
  assert.equal(out.rereads(), 1);
  assert.equal(out.json.order_status, "complete");
  assert.equal(out.json.telnyx_number_id, "pn_resource_1");
  assert.equal(out.json.campaign_assigned, true);
  assert.deepEqual(out.json.warnings, []);
  assert.equal(out.data.PhoneNumber[0].notes, "Purchased in-app via Telnyx numbers API");
});

test("a completed order whose number Telnyx still reports pending is not treated as active", async () => {
  const out = await purchaseWith({
    post: numberOrder("+12155550177"),
    owned: [ownedNumber("+12155550177", { status: "provision-pending" })],
  });
  assert.equal(out.json.order_status, "pending");
  assert.equal(out.json.telnyx_number_status, "provision-pending");
  assert.equal(out.json.telnyx_number_id, "pn_resource_1");
  assert.equal(out.calls.some((c) => c.url.includes("/v2/10dlc/")), false);
});

test("unmet number requirements are reported, not polled", async () => {
  const blocked = numberOrder("+12155550177", { status: "pending", requirements_met: false }, { status: "pending", requirements_met: false });
  const out = await purchaseWith({ post: blocked, reread: blocked });
  assert.equal(out.rereads(), 0, "documents, not time, settle unmet requirements");
  assert.equal(out.json.order_status, "pending");
  assert.match(out.data.PhoneNumber[0].notes, /requirements not met/);
  assert.ok(out.json.warnings.some((w) => /regulatory requirements/.test(w)), out.json.warnings.join(" | "));
});

test("a failed number order records nothing and releases the inventory reservation", async () => {
  const failed = numberOrder("+12155550177", { status: "failure" }, { status: "failure" });
  const out = await purchaseWith({ post: failed });
  assert.equal(out.res.status, 502);
  assert.match(out.json.error, /nothing was purchased/);
  assert.equal(out.data.PhoneNumber.length, 0);
  assert.deepEqual(out.data.IntegrationSecret[0].phone_inventory_creation_claims, {});
  assert.equal(out.calls.some((c) => c.url.includes("/v2/10dlc/")), false);
});

test("a pending fax-line purchase keeps the current outbound fax line", async () => {
  const pending = numberOrder("+12155550199", { status: "pending" }, { status: "pending" });
  const out = await purchaseWith({
    e164: "+12155550199", purpose: "fax", post: pending, reread: pending,
    agency: [{ id: "AS1", outbound_fax_number_e164: "+12155550100" }],
  });
  assert.equal(out.res.status, 200);
  assert.equal(out.json.outbound_fax_set, false);
  assert.equal(out.data.AgencySettings[0].outbound_fax_number_e164, "+12155550100", "a working outbound line is not replaced by one that cannot send");
  assert.equal(out.writes.some((w) => w.entity === "AgencySettings"), false);
  assert.equal(out.data.PhoneNumber[0].status, "reserved");
  assert.ok(out.json.warnings.some((w) => /NOT made the outbound fax line/.test(w)), out.json.warnings.join(" | "));
});

test("a number search returns cost, region and features, and flags best-effort results", async () => {
  const available = [
    {
      record_type: "available_phone_number", phone_number: "+12155550101", best_effort: false, quickship: true, reservable: true,
      region_information: [
        { region_type: "country_code", region_name: "US" }, { region_type: "rate_center", region_name: "PHILADELPHIA" },
        { region_type: "state", region_name: "PA" }, { region_type: "location", region_name: "Philadelphia" },
      ],
      cost_information: { upfront_cost: "1.00", monthly_cost: "1.00", currency: "USD" },
      features: [{ name: "sms" }, { name: "voice" }, { name: "sms" }],
    },
    {
      phone_number: "+12675550102", best_effort: true,
      region_information: [{ region_type: "state", region_name: "PA" }],
      cost_information: { monthly_cost: "<b>free</b>", currency: "usd" },
      features: "voice",
    },
    { phone_number: "not-a-number" },
  ];
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/available_phone_numbers"), respond: () => ({ status: 200, json: { data: available, metadata: { total_results: 2, best_effort_results: 1 } } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest" }] } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "search", area_code: "215" }),
  }));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.numbers, [
    {
      e164: "+12155550101", locality: "Philadelphia", rate_center: "PHILADELPHIA", region: "PA",
      monthly_cost: "1.00", upfront_cost: "1.00", currency: "USD", features: ["sms", "voice"], best_effort: false,
    },
    {
      e164: "+12675550102", locality: null, rate_center: null, region: "PA",
      monthly_cost: null, upfront_cost: null, currency: null, features: [], best_effort: true,
    },
  ]);
  const url = new URL(calls.find((c) => c.url.includes("/v2/available_phone_numbers")).url);
  // deepObject `filter` with an array member: repeated `filter[features][]`,
  // the form the spec documents for its explicit array filters.
  assert.deepEqual(url.searchParams.getAll("filter[features][]"), ["sms", "voice"]);
  assert.equal(url.searchParams.get("filter[national_destination_code]"), "215");
  assert.equal(url.searchParams.has("filter[best_effort]"), false);
});

// ---- nurse assignment checks the line with Telnyx first ----
const assignmentData = (secret = {}) => ({
  User: [{ id: "u1", email: "n@x.com" }],
  AgencySettings: [],
  PhoneNumber: [{ id: "p1", e164: "+12155550188", status: "available", twilio_phone_number_sid: "order_line_old" }],
  IntegrationSecret: [{ api_key: "KEYtest", voice_connection_id: "VC1", messaging_profile_id: "MP1", ...secret }],
});
const lookupRoute = (respond) => ({ match: (u) => u.includes("/v2/phone_numbers?"), respond });

async function assignWith(name, data, routes) {
  const writes = [];
  const { impl, calls } = makeFetch(routes);
  const handler = await loadHandler(`../functions/${name}/entry.ts`, {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" }, makeClient: () => makeSpyBase44({ data, writes }), fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/test", { method: "POST", body: JSON.stringify({
    action: "assign", id: "p1", target_user_email: "n@x.com", work_phone_number: "+12155550188",
  }) }));
  return { res, json: await res.json(), writes, calls };
}

test("manual nurse assignment refuses a number Telnyx reports as not ready, before any claim", async () => {
  const cases = [
    ["not in the account", [], /not in your Telnyx account yet/],
    ["purchase pending", [ownedNumber("+12155550188", { status: "purchase-pending" })], /"purchase-pending" in Telnyx, not active/],
    ["another voice connection", [ownedNumber("+12155550188", { connection_id: "OTHER" })], /connection "OTHER", not the configured Voice connection "VC1"/],
    ["another messaging profile", [ownedNumber("+12155550188", { messaging_profile_id: "MP-OTHER" })], /messaging profile "MP-OTHER", not the configured Messaging Profile "MP1"/],
    // Telnyx refuses every send from such a number ("not on a messaging profile").
    ["no messaging profile", [ownedNumber("+12155550188", { messaging_profile_id: null, messaging_profile_name: null })],
      /not on any messaging profile, so every text from it fails \(Telnyx: 'not on a messaging profile'\)\. Add it to the configured Messaging Profile "MP1"/],
  ];
  for (const name of ["managePhoneNumberPool", "provisionNurseWorkNumber"]) {
    for (const [label, owned, problem] of cases) {
      const data = assignmentData();
      const out = await assignWith(name, data, [lookupRoute(() => ({ json: { data: owned } }))]);
      assert.equal(out.res.status, 409, `${name}/${label}`);
      assert.equal(out.json.code, "work_line_not_ready", `${name}/${label}`);
      assert.ok(out.json.problems.some((p) => problem.test(p)), `${name}/${label}: ${out.json.problems.join(" | ")}`);
      assert.equal(data.PhoneNumber[0].status, "available", `${name}/${label} leaves the pool row unclaimed`);
      assert.equal(out.writes.some((w) => w.entity === "User" || (w.entity === "PhoneNumber" && w.op === "updateMany")), false, `${name}/${label}`);
      assert.equal(out.calls.filter((c) => c.method !== "GET").length, 0, "the check is read-only");
    }
  }
});

// GET /v2/10dlc/phone_number_campaigns/{phoneNumber} answers a bare
// PhoneNumberCampaign (no `data` wrapper) per the spec.
const campaignRoute = (respond) => ({ match: (u) => u.includes("/v2/10dlc/phone_number_campaigns/"), respond });
const onCampaign = (overrides = {}) => campaignRoute(() => ({ json: {
  phoneNumber: "+12155550188", campaignId: "CAMP1", tcrCampaignId: "C0ZURTX", telnyxCampaignId: "CAMP1",
  assignmentStatus: "ASSIGNED", createdAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00", ...overrides,
} }));

test("a verified nurse line is assigned with its phone-number resource id", async () => {
  for (const name of ["managePhoneNumberPool", "provisionNurseWorkNumber"]) {
    const data = assignmentData();
    const out = await assignWith(name, data, [lookupRoute(() => ({ json: { data: [ownedNumber("+12155550188")] } })), onCampaign()]);
    assert.equal(out.res.status, 200, name);
    assert.equal(out.json.line_verified, true, name);
    assert.deepEqual(out.json.warnings, [], name);
    assert.equal(data.PhoneNumber[0].status, "assigned", name);
    assert.equal(data.User[0].twilio_phone_number_sid, "pn_resource_1", `${name} replaces a stored order-line id with the resource id`);
    assert.equal(out.calls[0]?.url, "https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=12155550188");
    assert.equal(out.calls[1]?.url, "https://api.telnyx.com/v2/10dlc/phone_number_campaigns/%2B12155550188");
  }
});

test("a nurse line that is not on the saved 10DLC campaign is assigned with a warning, never enrolled", async () => {
  const cases = [
    ["no campaign at all", campaignRoute(() => ({ status: 404, json: { errors: [{ code: 10005, title: "Resource not found" }] } })),
      /not on any A2P 10DLC campaign \(the saved campaign is CAMP1\)/],
    ["another campaign", onCampaign({ campaignId: "OTHER", tcrCampaignId: "C0OTHER", telnyxCampaignId: "OTHER" }),
      /on A2P 10DLC campaign C0OTHER, not the saved campaign CAMP1/],
    ["assignment still pending", onCampaign({ assignmentStatus: "PENDING_ASSIGNMENT" }), /assignment to campaign C0ZURTX is PENDING_ASSIGNMENT/],
    ["campaign unreadable", campaignRoute(() => ({ status: 500, json: {} })), /campaign could not be checked \(HTTP 500\)/],
  ];
  for (const name of ["managePhoneNumberPool", "provisionNurseWorkNumber"]) {
    for (const [label, route, warning] of cases) {
      const data = assignmentData();
      data.AgencySettings = [{ id: "AS1", a2p_campaign_id: "CAMP1" }];
      const out = await assignWith(name, data, [lookupRoute(() => ({ json: { data: [ownedNumber("+12155550188")] } })), route]);
      assert.equal(out.res.status, 200, `${name}/${label}: a texting registration does not block a voice line`);
      assert.equal(data.PhoneNumber[0].status, "assigned", `${name}/${label}`);
      assert.ok(out.json.warnings.some((w) => warning.test(w)), `${name}/${label}: ${out.json.warnings.join(" | ")}`);
      assert.equal(out.calls.filter((c) => c.method !== "GET").length, 0, `${name}/${label}: the check never enrolls`);
    }
    // The owner's saved id may be the TCR id (C0ZURTX) or Telnyx's: either matches.
    const data = assignmentData();
    data.AgencySettings = [{ id: "AS1", a2p_campaign_id: "C0ZURTX" }];
    const out = await assignWith(name, data, [lookupRoute(() => ({ json: { data: [ownedNumber("+12155550188")] } })),
      onCampaign({ campaignId: "3008dd9f-66d7-40e0-bf23-bf2d8d1a96ba", telnyxCampaignId: "3008dd9f-66d7-40e0-bf23-bf2d8d1a96ba" })]);
    assert.deepEqual(out.json.warnings, [], `${name}: a TCR campaign id matches`);
  }
});

test("a toll-free line is not checked against 10DLC, and a profile-less line warns when no profile is saved", async () => {
  for (const name of ["managePhoneNumberPool", "provisionNurseWorkNumber"]) {
    // Toll-free numbers are not 10DLC long codes; a 404 there would be a false alarm.
    const tollFree = assignmentData();
    tollFree.PhoneNumber[0].e164 = "+18555140223";
    tollFree.AgencySettings = [{ id: "AS1", a2p_campaign_id: "C0ZURTX" }];
    const routes = [lookupRoute(() => ({ json: { data: [ownedNumber("+18555140223", { phone_number_type: "toll_free" })] } })),
      campaignRoute(() => { throw new Error("toll-free must not be checked against 10DLC"); })];
    const { impl, calls } = makeFetch(routes);
    const handler = await loadHandler(`../functions/${name}/entry.ts`, {
      env: { SUPER_ADMIN_EMAIL: "a@x.com" }, makeClient: () => makeSpyBase44({ data: tollFree }), fetchImpl: impl,
    });
    const res = await handler(new Request("https://app/functions/test", { method: "POST", body: JSON.stringify({
      action: "assign", id: "p1", target_user_email: "n@x.com", work_phone_number: "+18555140223",
    }) }));
    assert.equal(res.status, 200, name);
    assert.deepEqual((await res.json()).warnings, [], name);
    assert.equal(calls.some((c) => c.url.includes("/10dlc/")), false, name);

    // With no Messaging Profile saved there is nothing to compare against, but
    // a number on no profile still cannot text, and the admin is told so.
    const noSaved = assignmentData({ messaging_profile_id: "" });
    const out = await assignWith(name, noSaved, [lookupRoute(() => ({ json: { data: [ownedNumber("+12155550188", { messaging_profile_id: null })] } })), onCampaign()]);
    assert.equal(out.res.status, 200, name);
    assert.ok(out.json.warnings.some((w) => /not on any messaging profile, so every text from it will fail/.test(w)), out.json.warnings.join(" | "));
  }
});

test("a Telnyx line check that cannot be made warns but does not block a manual assignment", async () => {
  const unreadable = [
    ["Telnyx 503", () => ({ status: 503, json: { errors: [{ code: "10011" }] } })],
    ["messaging profile UNAVAILABLE", () => ({ json: { data: [ownedNumber("+12155550188", { messaging_profile_id: "UNAVAILABLE" })] } })],
  ];
  for (const name of ["managePhoneNumberPool", "provisionNurseWorkNumber"]) {
    for (const [label, respond] of unreadable) {
      const data = assignmentData();
      const out = await assignWith(name, data, [lookupRoute(respond)]);
      assert.equal(out.res.status, 200, `${name}/${label}`);
      assert.equal(data.PhoneNumber[0].status, "assigned", `${name}/${label}`);
      assert.ok(out.json.warnings.length > 0, `${name}/${label} says what was not checked`);
    }
    const noCreds = assignmentData();
    noCreds.IntegrationSecret = [];
    const out = await assignWith(name, noCreds, [lookupRoute(() => { throw new Error("no lookup without a key"); })]);
    assert.equal(out.res.status, 200, `${name}/no credentials`);
    assert.equal(out.json.line_verified, false);
    assert.ok(out.json.warnings.some((w) => /no Telnyx API key is configured/.test(w)), out.json.warnings.join(" | "));
    assert.equal(out.calls.length, 0);
  }
});

test("bulk assignment skips numbers Telnyx reports as not ready and hands out the next good one", async () => {
  const data = {
    User: [{ id: "u1", email: "n@x.com" }],
    AgencySettings: [],
    PhoneNumber: [
      { id: "p1", e164: "+12155550101", status: "available", created_date: "2026-01-01T00:00:01.000Z" },
      { id: "p2", e164: "+12155550102", status: "available", created_date: "2026-01-01T00:00:02.000Z" },
    ],
    IntegrationSecret: [{ api_key: "KEYtest", voice_connection_id: "VC1", messaging_profile_id: "MP1" }],
  };
  const { impl, calls } = makeFetch([lookupRoute((u) => ({ json: { data: u.endsWith("=12155550101")
    ? [ownedNumber("+12155550101", { connection_id: "OTHER" })]
    : [ownedNumber("+12155550102", { id: "pn_resource_2" })] } }))]);
  const handler = await loadHandler("../functions/autoAssignWorkNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" }, makeClient: () => makeSpyBase44({ data }), fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/autoAssignWorkNumbers", { method: "POST", body: "{}" }));
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(out.assigned, [{ email: "n@x.com", e164: "+12155550102" }]);
  assert.equal(out.skipped_numbers.length, 1);
  assert.equal(out.skipped_numbers[0].e164, "+12155550101");
  assert.match(out.message, /Skipped 1 pool number/);
  assert.equal(data.PhoneNumber[0].status, "available", "the broken line stays in the pool, unassigned");
  assert.equal(data.User[0].twilio_phone_number_sid, "pn_resource_2");
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});

test("bulk assignment stops checking after the first check that cannot be made, and warns once", async () => {
  const data = {
    User: [{ id: "u1", email: "a1@x.com" }, { id: "u2", email: "a2@x.com" }],
    AgencySettings: [],
    PhoneNumber: [
      { id: "p1", e164: "+12155550101", status: "available", created_date: "2026-01-01T00:00:01.000Z" },
      { id: "p2", e164: "+12155550102", status: "available", created_date: "2026-01-01T00:00:02.000Z" },
    ],
    IntegrationSecret: [{ api_key: "KEYtest", voice_connection_id: "VC1", messaging_profile_id: "MP1" }],
  };
  const { impl, calls } = makeFetch([lookupRoute(() => ({ status: 500, json: {} }))]);
  const handler = await loadHandler("../functions/autoAssignWorkNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" }, makeClient: () => makeSpyBase44({ data }), fetchImpl: impl,
  });
  const out = await (await handler(new Request("https://app/functions/autoAssignWorkNumbers", { method: "POST", body: "{}" }))).json();
  assert.equal(out.assigned_count, 2, "an unreachable Telnyx does not block assignment");
  assert.equal(calls.length, 1, "one failed check, not one timeout per number");
  assert.ok(out.warnings.some((w) => /without a Telnyx check/.test(w)), out.warnings.join(" | "));
});

test('concurrent fax provisioning, purchases and manual pool adds share one creation reservation', async () => {
  for (const pair of [['provision_fax', 'provision_fax'], ['provision_fax', 'add'], ['purchase', 'add']]) {
    const data = { IntegrationSecret: [activeTelnyxSecret()], PhoneNumber: [] };
    const writes = [];
    const client = makeSpyBase44({ data, writes });
    let arrived = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const update = client.asServiceRole.entities.IntegrationSecret.updateMany;
    client.asServiceRole.entities.IntegrationSecret.updateMany = async (query, patch) => {
      if (Object.keys(patch.$set.phone_inventory_creation_claims).length) {
        arrived += 1;
        if (arrived === 2) release();
        await barrier;
      }
      return update(query, patch);
    };
    const { impl, calls } = makeFetch([
      { match: url => url.includes('/phone_numbers?'), respond: () => ({ json: { data: [{ id: 'np_7', phone_number: '+12155550188' }] } }) },
      { match: url => url.endsWith('/number_orders'), respond: () => ({ json: { data: numberOrder('+12155550188', { id: 'order_1' }) } }) },
      { match: url => url.endsWith('/phone_numbers/np_7'), respond: () => ({ json: { data: { id: 'np_7' } } }) },
    ]);
    const handlers = [];
    for (const action of pair) handlers.push(await loadHandler(`../functions/${action === 'add' ? 'managePhoneNumberPool' : 'searchPurchaseTelnyxNumbers'}/entry.ts`, {
      env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: impl,
    }));
    const responses = await Promise.all(handlers.map((handler, index) => handler(new Request('https://app/functions/test', {
      method: 'POST', body: JSON.stringify({ action: pair[index], purpose: 'fax', e164: '+12155550188', set_as_outbound_fax: false }),
    }))));
    assert.equal(arrived, 2, 'both creators saw an empty inventory');
    assert.equal(responses.filter(response => response.status === 200).length, 1, pair.join('/'));
    assert.equal(data.PhoneNumber.length, 1);
    assert.equal(writes.filter(write => write.entity === 'PhoneNumber' && write.op === 'create').length, 1);
    assert.ok(calls.filter(call => call.method === 'POST' && call.url.endsWith('/number_orders')).length <= 1);
    assert.deepEqual(data.IntegrationSecret[0].phone_inventory_creation_claims, {});
  }
});

test('inventory creation recovers a lost create acknowledgement and fences an unknown create', async () => {
  for (const persisted of [true, false]) {
    const data = { IntegrationSecret: [activeTelnyxSecret()], PhoneNumber: [] };
    const client = makeSpyBase44({ data });
    let creates = 0;
    const create = client.asServiceRole.entities.PhoneNumber.create;
    client.asServiceRole.entities.PhoneNumber.create = async input => {
      creates += 1;
      if (persisted) await create(input);
      throw new Error('lost acknowledgement');
    };
    const handler = await loadHandler('../functions/managePhoneNumberPool/entry.ts', {
      env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: async () => { throw new Error('No provider call allowed'); },
    });
    const invoke = () => handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({ action: 'add', e164: '+12155550188' }) }));
    assert.equal((await invoke()).status, persisted ? 200 : 500);
    await invoke();
    assert.equal(creates, 1);
    assert.equal(data.PhoneNumber.length, persisted ? 1 : 0);
    assert.equal(Object.keys(data.IntegrationSecret[0].phone_inventory_creation_claims).length, persisted ? 0 : 1);
  }
});

test('existing fax provisioning reserves inventory even when the provider id is already correct', async () => {
  for (const action of ['provision_fax', 'purchase']) {
    const data = { IntegrationSecret: [{ api_key: 'KEYtest', fax_connection_id: 'FC1' }],
      PhoneNumber: [{ id: 'p1', e164: '+12155550188', status: 'available', twilio_phone_number_sid: 'np_7' }] };
    const { impl, calls } = makeFetch([
      { match: (url) => url.includes('/phone_numbers?'), respond: () => ({ json: { data: [{ id: 'np_7', phone_number: '+12155550188' }] } }) },
      { match: (url) => url.endsWith('/phone_numbers/np_7'), respond: () => {
        assert.equal(data.PhoneNumber[0].status, 'reserved', 'reserved before changing provider routing');
        return { json: { data: { id: 'np_7' } } };
      } },
    ]);
    const handler = await loadHandler('../functions/searchPurchaseTelnyxNumbers/entry.ts', {
      env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => makeSpyBase44({ data }), fetchImpl: impl,
    });
    const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({
      action, purpose: 'fax', e164: '+12155550188', set_as_outbound_fax: false,
    }) }));
    assert.equal(response.status, 200, action);
    assert.equal(data.PhoneNumber[0].status, 'reserved');
    assert.equal(calls.some((call) => call.url.endsWith('/number_orders')), false);
  }
});

test('fax routing rejection restores only the exact new reservation and retains uncertain or newer claims', async () => {
  for (const originalStatus of ['available', 'reserved', 'missing']) {
    for (const status of [422, 429, 500]) {
      for (const newerOwner of [false, true]) {
        const data = { IntegrationSecret: [activeTelnyxSecret()], PhoneNumber: originalStatus === 'missing' ? [] : [
          { id: 'phone_1', e164: '+12155550188', status: originalStatus, updated_date: '2026-09-11T12:00:00.000Z' },
        ] };
        const client = makeSpyBase44({ data });
        const { impl } = makeFetch([
          { match: url => url.includes('/phone_numbers?'), respond: () => ({ json: { data: [{ id: 'np_7', phone_number: '+12155550188' }] } }) },
          { match: url => url.endsWith('/phone_numbers/np_7'), respond: () => {
            if (newerOwner) data.PhoneNumber[0].updated_date = '2030-01-01T00:00:00.000Z';
            return { status, json: { errors: [{ code: 'synthetic' }] } };
          } },
        ]);
        const handler = await loadHandler('../functions/searchPurchaseTelnyxNumbers/entry.ts', {
          env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: impl,
        });
        const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({
          action: 'provision_fax', e164: '+12155550188', set_as_outbound_fax: false,
        }) }));
        assert.equal(response.status, 502);
        const restored = status < 500 && !newerOwner && originalStatus !== 'reserved';
        assert.equal(data.PhoneNumber[0].status, restored ? 'available' : 'reserved', `${originalStatus}/${status}/${newerOwner}`);
      }
    }
  }
});

test('a concurrent fax reservation defeats all nurse assignment paths before User writes', async () => {
  for (const name of ['autoAssignWorkNumbers', 'managePhoneNumberPool', 'provisionNurseWorkNumber']) {
    const writes = [];
    const data = { User: [{ id: 'u1', email: 'n@x.com' }], AgencySettings: [],
      PhoneNumber: [{ id: 'p1', e164: '+12155550188', status: 'available' }] };
    const client = makeSpyBase44({ data, writes });
    const original = client.asServiceRole.entities.PhoneNumber.updateMany;
    client.asServiceRole.entities.PhoneNumber.updateMany = async (query, patch) => {
      data.PhoneNumber[0].status = 'reserved';
      return original(query, patch);
    };
    const handler = await loadHandler(`../functions/${name}/entry.ts`, {
      env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: makeFetch([]).impl,
    });
    const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({
      action: 'assign', id: 'p1', target_user_email: 'n@x.com', work_phone_number: '+12155550188',
    }) }));
    assert.equal(response.status, name === 'autoAssignWorkNumbers' ? 200 : 409, name);
    assert.equal(writes.some((write) => write.entity === 'User'), false, name);
    assert.equal(data.PhoneNumber[0].status, 'reserved', name);
  }
});

test('a concurrent nurse claim prevents changing the provider fax connection', async () => {
  const data = { IntegrationSecret: [{ api_key: 'KEYtest', fax_connection_id: 'FC1' }],
    PhoneNumber: [{ id: 'p1', e164: '+12155550188', status: 'available' }] };
  const client = makeSpyBase44({ data });
  const original = client.asServiceRole.entities.PhoneNumber.updateMany;
  client.asServiceRole.entities.PhoneNumber.updateMany = async (query, patch) => {
    Object.assign(data.PhoneNumber[0], { status: 'assigned', assigned_to_email: 'n@x.com' });
    return original(query, patch);
  };
  const { impl, calls } = makeFetch([{ match: (url) => url.includes('/phone_numbers?'),
    respond: () => ({ json: { data: [{ id: 'np_7', phone_number: '+12155550188' }] } }) }]);
  const handler = await loadHandler('../functions/searchPurchaseTelnyxNumbers/entry.ts', {
    env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: impl,
  });
  const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({
    action: 'provision_fax', e164: '+12155550188', set_as_outbound_fax: false,
  }) }));
  assert.equal(response.status, 409);
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
  assert.equal(data.PhoneNumber[0].status, 'assigned');
});

test('a concurrent fax reservation prevents pool removal or release', async () => {
  for (const action of ['remove', 'release']) {
    const data = { PhoneNumber: [{ id: 'p1', e164: '+12155550188', status: 'available' }] };
    const client = makeSpyBase44({ data });
    const method = action === 'remove' ? 'deleteMany' : 'updateMany';
    const original = client.asServiceRole.entities.PhoneNumber[method];
    client.asServiceRole.entities.PhoneNumber[method] = async (...args) => {
      data.PhoneNumber[0].status = 'reserved';
      return original(...args);
    };
    const handler = await loadHandler('../functions/managePhoneNumberPool/entry.ts', {
      env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: makeFetch([]).impl,
    });
    const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({ action, id: 'p1' }) }));
    assert.equal(response.status, 409, action);
    assert.equal(data.PhoneNumber.length, 1);
    assert.equal(data.PhoneNumber[0].status, 'reserved');
  }
});

test('manual nurse provisioning cannot assign an untracked number while fax inventory is being created', async () => {
  const writes = [];
  const client = makeSpyBase44({ data: { User: [{ id: 'u1', email: 'n@x.com' }], PhoneNumber: [] }, writes });
  const handler = await loadHandler('../functions/provisionNurseWorkNumber/entry.ts', {
    env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: makeFetch([]).impl,
  });
  const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({
    target_user_email: 'n@x.com', work_phone_number: '+12155550188',
  }) }));
  assert.equal(response.status, 409);
  assert.deepEqual(writes, []);
});

test('nurse assignment reconciles failed and lost-acknowledgement User writes', async () => {
  for (const name of ['managePhoneNumberPool', 'provisionNurseWorkNumber', 'autoAssignWorkNumbers']) {
    for (const mode of ['rejected', 'accepted_ack_lost', 'read_unknown', 'newer_claim']) {
      const data = { User: [{ id: 'u1', email: 'n@x.com' }], AgencySettings: [],
        PhoneNumber: [{ id: 'p1', e164: '+12155550188', status: 'available' }] };
      const client = makeSpyBase44({ data });
      const originalUpdate = client.asServiceRole.entities.User.update;
      const originalRead = client.asServiceRole.entities.User.filter;
      let attempted = false;
      client.asServiceRole.entities.User.update = async (...args) => {
        attempted = true;
        if (mode === 'accepted_ack_lost') await originalUpdate(...args);
        if (mode === 'newer_claim') data.PhoneNumber[0].updated_date = new Date(Date.now() + 60_000).toISOString();
        throw new Error('simulated User write failure');
      };
      client.asServiceRole.entities.User.filter = async (...args) => {
        if (attempted && mode === 'read_unknown') throw new Error('unavailable confirmation');
        return originalRead(...args);
      };
      const handler = await loadHandler(`../functions/${name}/entry.ts`, {
        env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, makeClient: () => client, fetchImpl: makeFetch([]).impl,
      });
      const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({
        action: 'assign', id: 'p1', target_user_email: 'n@x.com', work_phone_number: '+12155550188',
      }) }));
      assert.equal(response.status, mode === 'accepted_ack_lost' || name === 'autoAssignWorkNumbers' ? 200 : 500, `${name}/${mode}`);
      assert.equal(data.PhoneNumber[0].status, mode === 'rejected' ? 'available' : 'assigned', `${name}/${mode}`);
      assert.equal(data.User[0].work_phone_number, mode === 'accepted_ack_lost' ? '+12155550188' : undefined, `${name}/${mode}`);
    }
  }
});

test("sendFax transmits from the blind outbound line masked as the office fax", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/faxes"), respond: () => ({ status: 200, json: { data: { id: "fax_3", status: "queued" } } }) },
  ]);
  const handler = await loadHandler("../functions/sendFax/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "n@x.com" },
    makeClient: () => makeBase44({ user: {
      email: "n@x.com", role: "admin", full_name: "Nora",
      work_phone_number: "+12155550100", personal_cell_e164: "+12155550111",
    }, data: {
      IntegrationSecret: [{ api_key: "KEYtest", fax_connection_id: "FC1" }],
      AgencySettings: [{ office_fax_number_e164: "+17244650444", outbound_fax_number_e164: "+12155550190" }],
    } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/sendFax", {
    method: "POST", body: JSON.stringify({ file_url: "https://base44.app/files/x.pdf", to_number: "+12155550144" }),
  }));
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/faxes");
  assert.ok(call, "posted to the Telnyx Faxes endpoint");
  assert.equal(call.body.from, "+12155550190", "transmits from the blind outbound line");
  assert.equal(call.body.from_display_name, "Office Fax 724-465-0444", "presents the office machine's number to the recipient");
});

test("a stray inbound fax on the blind line is passed straight through to the office machine", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.endsWith("/v2/faxes"), respond: () => ({ status: 200, json: { data: { id: "fwd_1" } } }) },
  ]);
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret({
      public_key: pubB64,
      fax_connection_id: "FC1",
      messaging_profile_id: "MP1",
    })],
    TelecomDestinationBinding: [faxBinding()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    // fax_receiving_enabled is NOT set — the default posture forwards to the office.
    AgencySettings: [{
      agency_id: "agency_a",
      agency_code: "AGENCY-A",
      office_fax_number_e164: "+17244650444",
    }],
    IncomingFax: [],
  };
  const client = makeSpyBase44({ writes, data: state });
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => client,
    fetchImpl: impl,
  });
  const event = { data: { event_type: "fax.received", payload: {
    id: "faxin_1", direction: "inbound", media_url: "https://media.telnyx.com/f1.pdf",
    from: "+13125550182", to: "+12155550190",
  } } };
  const res = await handler(signedWebhook(privateKey, event));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const replay = await handler(signedWebhook(privateKey, event));
  assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
  const replayBody = await replay.json();
  assert.equal(replayBody.deduped, true, JSON.stringify(replayBody));
  const fwd = calls.find((c) => c.url.endsWith("/v2/faxes"));
  assert.ok(fwd, "forwarded the received fax to the office");
  assert.equal(calls.filter((c) => c.url.endsWith("/v2/faxes")).length, 1, "a replay never forwards twice");
  assert.equal(fwd.body.to, "+17244650444", "delivered to the office fax machine");
  assert.equal(fwd.body.from, "+12155550190", "sent from the line that received it");
  assert.equal(fwd.body.media_url, "https://media.telnyx.com/f1.pdf");
  const row = writes.find((w) => w.entity === "IncomingFax" && w.op === "create");
  assert.ok(row, "created the at-most-once forward record");
  assert.equal(row.row.processing_status, "completed", "kept away from the in-app OCR job");
  const claim = writes.find((w) => (
    w.entity === "IncomingFax" && w.op === "updateMany" && w.patch.$set.status === "reviewing"
  ));
  assert.ok(claim, "claimed the inbound row before calling the fax provider");
  assert.equal(claim.patch.$set.routed_to, "office_fax_pending");
  const routed = writes.find((w) => (
    w.entity === "IncomingFax" && w.op === "updateMany" && w.patch.$set.status === "routed"
  ));
  assert.equal(routed?.patch.$set.status, "routed", "marked routed after the successful forward");
  assert.equal(routed?.query.claimed_by, claim.patch.$set.claimed_by, "only the claim owner can finalize");
});

// The app receives no faxes (product owner, 2026-10-09): the retired
// fax_receiving_enabled opt-in no longer selects in-app ingestion, so an
// exact-bound inbound fax is forwarded to the office machine, never ingested.
test("an exact-bound inbound fax is forwarded once with immutable tenant provenance, never ingested, even with the retired opt-in set", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.endsWith("/v2/faxes"), respond: () => ({ status: 202, json: { data: { id: "fwd_bound_1" } } }) },
  ]);
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret({
      public_key: pubB64,
      fax_connection_id: "FC1",
      messaging_profile_id: "MP1",
    })],
    TelecomDestinationBinding: [faxBinding()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    AgencySettings: [{
      agency_id: "agency_a",
      agency_code: "AGENCY-A",
      fax_receiving_enabled: true,
      office_fax_number_e164: "+17244650444",
    }],
    IncomingFax: [],
  };
  const client = makeSpyBase44({ writes, data: state });
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => client,
    fetchImpl: impl,
  });
  const event = { data: { event_type: "fax.received", payload: {
    id: "faxin_bound_1", direction: "inbound", media_url: "https://media.telnyx.com/bound.pdf",
    from: "+13125550182", to: "+12155550190", page_count: 3,
  } } };
  const first = await handler(signedWebhook(privateKey, event));
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  const second = await handler(signedWebhook(privateKey, event));
  assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
  assert.equal((await second.json()).deduped, true);
  const creates = writes.filter((write) => write.entity === "IncomingFax" && write.op === "create");
  assert.equal(creates.length, 1);
  assert.deepEqual({
    agency_id: creates[0].row.agency_id,
    ingress_binding_id: creates[0].row.ingress_binding_id,
    ingress_binding_key: creates[0].row.ingress_binding_key,
    ingress_binding_version: creates[0].row.ingress_binding_version,
    integration_secret_id: creates[0].row.integration_secret_id,
    received_to_number: creates[0].row.received_to_number,
    processing_status: creates[0].row.processing_status,
    version: creates[0].row.version,
  }, {
    agency_id: "agency_a",
    ingress_binding_id: "fax_binding_1",
    ingress_binding_key: "telnyx:integration_1:+12155550190",
    ingress_binding_version: 1,
    integration_secret_id: "integration_1",
    received_to_number: "+12155550190",
    // 'completed' keeps it away from the processInboundFaxes OCR worker.
    processing_status: "completed",
    version: 1,
  });
  assert.equal(state.IncomingFax[0].status, "routed");
  assert.equal(state.IncomingFax[0].routed_to, "office_fax");
  const forwards = calls.filter((c) => c.url.endsWith("/v2/faxes"));
  assert.equal(forwards.length, 1, "forwarded exactly once; the replay never forwards again");
  assert.equal(forwards[0].body.to, "+17244650444");
});

test("an existing foreign inbound fax identity blocks disclosure, creation, and forwarding", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([]);
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret({
      public_key: pubB64,
      fax_connection_id: "FC1",
      messaging_profile_id: "MP1",
    })],
    TelecomDestinationBinding: [faxBinding()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    AgencySettings: [{
      agency_id: "agency_a",
      agency_code: "AGENCY-A",
      fax_receiving_enabled: true,
    }],
    IncomingFax: [{
      id: "incoming_foreign",
      agency_id: "agency_b",
      telnyx_fax_id: "faxin_conflict_1",
      document_url: "https://media.telnyx.com/conflict.pdf",
    }],
  };
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({ writes, data: state }),
    fetchImpl: impl,
  });
  const response = await handler(signedWebhook(privateKey, { data: {
    event_type: "fax.received",
    payload: {
      id: "faxin_conflict_1",
      direction: "inbound",
      media_url: "https://media.telnyx.com/conflict.pdf",
      from: "+13125550182",
      to: "+12155550190",
    },
  } }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "INBOUND_FAX_IDENTITY_CONFLICT");
  assert.equal(writes.length, 0);
  assert.equal(calls.length, 0);
});

test("sendFax normalizes a formatted office fax number to E.164 on `from`", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/faxes"), respond: () => ({ status: 200, json: { data: { id: "fax_2", status: "queued" } } }) },
  ]);
  const handler = await loadHandler("../functions/sendFax/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "n@x.com" },
    makeClient: () => makeBase44({ user: {
      email: "n@x.com", role: "admin", full_name: "Nora",
      work_phone_number: "+12155550100", personal_cell_e164: "+12155550111",
    }, data: {
      IntegrationSecret: [{ api_key: "KEYtest", fax_connection_id: "FC1" }],
      // The admin typed a formatted number — Telnyx requires E.164 on `from`.
      AgencySettings: [{ office_fax_number_e164: "(215) 555-0190" }],
    } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/sendFax", {
    method: "POST", body: JSON.stringify({ file_url: "https://base44.app/files/x.pdf", to_number: "+12155550144" }),
  }));
  assert.equal(res.status, 200);
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/faxes");
  assert.ok(call, "posted to the Telnyx Faxes endpoint");
  assert.equal(call.body.from, "+12155550190", "from is normalized E.164, not the raw formatted string");
});

test("provisionNurseWorkNumber refuses to hand out the shared office fax number", async () => {
  const { impl } = makeFetch([]);
  const handler = await loadHandler("../functions/provisionNurseWorkNumber/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({
      user: { email: "a@x.com", role: "admin", full_name: "Ada" },
      data: {
        User: [{ id: "u1", email: "n@x.com" }],
        AgencySettings: [{ office_fax_number_e164: "+12155550190" }],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/provisionNurseWorkNumber", {
    method: "POST", body: JSON.stringify({ target_user_email: "n@x.com", work_phone_number: "+12155550190" }),
  }));
  assert.equal(res.status, 409, "the office fax line can't become a personal work number");
});

test("provisionNurseWorkNumber syncs the pool row for a manually-typed assignment", async () => {
  const { impl } = makeFetch([]);
  const writes = [];
  const handler = await loadHandler("../functions/provisionNurseWorkNumber/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({
      user: { email: "a@x.com", role: "admin", full_name: "Ada" },
      writes,
      data: {
        User: [{ id: "u1", email: "n@x.com" }],
        PhoneNumber: [{ id: "p1", e164: "+12155550100", twilio_phone_number_sid: "np_1", status: "available" }],
        AgencySettings: [],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/provisionNurseWorkNumber", {
    method: "POST", body: JSON.stringify({ target_user_email: "n@x.com", work_phone_number: "215-555-0100" }),
  }));
  assert.equal(res.status, 200);
  const userWrite = writes.find((w) => w.entity === "User" && w.op === "update");
  assert.equal(userWrite?.patch.work_phone_number, "+12155550100");
  assert.equal(userWrite?.patch.twilio_phone_number_sid, "np_1", "adopts the pool row's Telnyx number id");
  const poolWrite = writes.find((w) => w.entity === "PhoneNumber" && w.op === "updateMany" && w.query.id === "p1");
  assert.equal(poolWrite?.patch.$set.status, "assigned", "the matching pool row is marked assigned");
  assert.equal(poolWrite?.patch.$set.assigned_to_email, "n@x.com");
});

test("autoAssignWorkNumbers skips the shared office fax / main office numbers", async () => {
  const { impl } = makeFetch([]);
  const writes = [];
  const handler = await loadHandler("../functions/autoAssignWorkNumbers/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "a@x.com" },
    makeClient: () => makeSpyBase44({
      user: { email: "a@x.com", role: "admin", full_name: "Ada" },
      writes,
      data: {
        // The office fax line sits FIRST in the pool — FIFO must not hand it out.
        PhoneNumber: [
          { id: "p1", e164: "+12155550190", status: "available" },
          { id: "p2", e164: "+12155550101", status: "available" },
        ],
        User: [{ id: "u1", email: "n@x.com" }],
        AgencySettings: [{ office_fax_number_e164: "+12155550190" }],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/autoAssignWorkNumbers", {
    method: "POST", body: JSON.stringify({}),
  }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.assigned_count, 1);
  assert.equal(out.assigned[0].e164, "+12155550101", "the fax line was skipped; the next number was assigned");
  const userWrite = writes.find((w) => w.entity === "User" && w.op === "update");
  assert.equal(userWrite?.patch.work_phone_number, "+12155550101");
});

test("reserved fax inventory cannot be assigned, released, removed, or manually provisioned without settings", async () => {
  for (const action of ['assign', 'release', 'remove', 'provision']) {
    const writes = [];
    const { impl, calls } = makeFetch([]);
    const name = action === 'provision' ? 'provisionNurseWorkNumber' : 'managePhoneNumberPool';
    const handler = await loadHandler(`../functions/${name}/entry.ts`, {
      env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, fetchImpl: impl,
      makeClient: () => makeSpyBase44({ user: { id: 'admin-1', email: 'a@x.com', role: 'admin' }, writes,
        data: { User: [{ id: 'u1', email: 'n@x.com' }], AgencySettings: [],
          PhoneNumber: [{ id: 'fax-1', e164: '+12155550190', status: 'reserved' }] } }),
    });
    const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: JSON.stringify({
      action, id: 'fax-1', target_user_email: 'n@x.com', work_phone_number: '+12155550190',
    }) }));
    assert.equal(response.status, 409, action);
    assert.deepEqual(writes, [], action);
    assert.deepEqual(calls, [], action);
  }
});

test("automatic work-number assignment skips reserved inventory even without agency settings", async () => {
  const writes = [];
  const { impl } = makeFetch([]);
  const handler = await loadHandler('../functions/autoAssignWorkNumbers/entry.ts', {
    env: { SUPER_ADMIN_EMAIL: 'a@x.com' }, fetchImpl: impl,
    makeClient: () => makeSpyBase44({ user: { id: 'admin-1', email: 'a@x.com', role: 'admin' }, writes,
      data: { User: [{ id: 'u1', email: 'n@x.com' }], AgencySettings: [], PhoneNumber: [
        { id: 'fax-1', e164: '+12155550190', status: 'reserved' },
        { id: 'nurse-1', e164: '+12155550101', status: 'available' },
      ] } }),
  });
  const response = await handler(new Request('https://app/functions/test', { method: 'POST', body: '{}' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).assigned[0].e164, '+12155550101');
  assert.equal(writes.some((write) => write.id === 'fax-1'), false);
});

// ============================ VIDEO TOKEN ============================
test("createTelehealthToken provisions a room and mints a join token", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => /\/v2\/rooms\?/.test(u), respond: () => ({ status: 200, json: { data: [] } }) },
    { match: (u) => u.endsWith("/v2/rooms"), respond: () => ({ status: 200, json: { data: { id: "room_1" } } }) },
    { match: (u) => u.includes("/actions/generate_join_client_token"), respond: () => ({ status: 200, json: { data: { token: "JOIN", refresh_token: "R" } } }) },
  ]);
  const handler = await loadHandler("../functions/createTelehealthToken/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest" },
    makeClient: () => makeBase44({
      user: { email: "host@x.com", role: "admin" },
      data: {
        IntegrationSecret: [{ api_key: "KEYtest" }],
        TelehealthSession: [{ room_name: "visit-1", host_email: "host@x.com", status: "active", participant_list: [] }],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/createTelehealthToken", {
    method: "POST", body: JSON.stringify({ room_name: "visit-1" }),
  }));
  const out = await res.json();
  assert.equal(out.token, "JOIN");
  assert.equal(out.room_id, "room_1");
  const tokenCall = calls.find((c) => c.url.includes("/v2/rooms/room_1/actions/generate_join_client_token"));
  assert.ok(tokenCall, "minted a join client token for the room");
  assert.match(BEARER(tokenCall.headers), /^Bearer KEYtest$/);
});

// Guest join tokens are stored HASHED at rest (TelehealthSession.join_token_hash);
// the guest path must accept the raw token whose SHA-256 matches, reject others,
// and only fall back to the legacy plaintext invite_link when no hash exists.
test("createTelehealthToken validates guest tokens against join_token_hash", async () => {
  const rawToken = "a".repeat(48);
  const session = {
    room_name: "visit-2", host_email: "host@x.com", status: "scheduled",
    scheduled_at: new Date().toISOString(),
    join_token_hash: createHash("sha256").update(rawToken).digest("hex"),
    // A stale plaintext link must be IGNORED once a hash exists.
    invite_link: "https://app/join?room=visit-2&t=stale-different-token",
  };
  const mkHandler = () => loadHandler("../functions/createTelehealthToken/entry.ts", {
    env: {},
    makeClient: () => makeBase44({
      user: null,
      data: { IntegrationSecret: [{ api_key: "KEYtest" }], TelehealthSession: [session] },
    }),
    fetchImpl: makeFetch([
      { match: (u) => /\/v2\/rooms\?/.test(u), respond: () => ({ status: 200, json: { data: [{ id: "room_2", unique_name: "visit-2" }] } }) },
      { match: (u) => u.includes("/actions/generate_join_client_token"), respond: () => ({ status: 200, json: { data: { token: "JOIN2" } } }) },
    ]).impl,
  });

  let handler = await mkHandler();
  const ok = await handler(new Request("https://app/functions/createTelehealthToken", {
    method: "POST", body: JSON.stringify({ room_name: "visit-2", join_token: rawToken }),
  }));
  assert.equal(ok.status, 200, "the raw token matching the stored hash is accepted");
  assert.equal((await ok.json()).token, "JOIN2");

  handler = await mkHandler();
  const wrong = await handler(new Request("https://app/functions/createTelehealthToken", {
    method: "POST", body: JSON.stringify({ room_name: "visit-2", join_token: "b".repeat(48) }),
  }));
  assert.equal(wrong.status, 403, "a non-matching token is rejected");

  // The stale plaintext token embedded in invite_link must NOT work once a hash exists.
  handler = await mkHandler();
  const stale = await handler(new Request("https://app/functions/createTelehealthToken", {
    method: "POST", body: JSON.stringify({ room_name: "visit-2", join_token: "stale-different-token" }),
  }));
  assert.equal(stale.status, 403, "the retired invite_link token is rejected when a hash exists");
});

test("createTelehealthToken still honors legacy plaintext invite_link sessions (no hash)", async () => {
  const handler = await loadHandler("../functions/createTelehealthToken/entry.ts", {
    env: {},
    makeClient: () => makeBase44({
      user: null,
      data: {
        IntegrationSecret: [{ api_key: "KEYtest" }],
        TelehealthSession: [{
          room_name: "visit-legacy", host_email: "host@x.com", status: "scheduled",
          scheduled_at: new Date().toISOString(),
          invite_link: "https://app/join?room=visit-legacy&t=legacy-token-123",
        }],
      },
    }),
    fetchImpl: makeFetch([
      { match: (u) => /\/v2\/rooms\?/.test(u), respond: () => ({ status: 200, json: { data: [{ id: "room_l", unique_name: "visit-legacy" }] } }) },
      { match: (u) => u.includes("/actions/generate_join_client_token"), respond: () => ({ status: 200, json: { data: { token: "JOINL" } } }) },
    ]).impl,
  });
  const res = await handler(new Request("https://app/functions/createTelehealthToken", {
    method: "POST", body: JSON.stringify({ room_name: "visit-legacy", join_token: "legacy-token-123" }),
  }));
  assert.equal(res.status, 200, "pre-hash sessions keep working via the invite_link token");
});

// ---- in-visit token renewal ----
// Client tokens live at most 3600 s (Telnyx's token_ttl_secs maximum), so a
// visit past an hour renews through action 'refresh': the same authorization,
// an existing room only, and no Telnyx refresh_token in the browser (Telnyx's
// refresh endpoint is `security: []`, so that token would renew access with no
// check of ours).
const GUEST_TOKEN = "c".repeat(48);
const guestSession = (overrides = {}) => ({
  room_name: "visit-r", host_email: "host@x.com", host_user_id: "host_1", status: "active",
  scheduled_at: new Date().toISOString(), participant_list: ["family@x.com"],
  join_token_hash: createHash("sha256").update(GUEST_TOKEN).digest("hex"),
  ...overrides,
});
async function telehealthTokenWith({ session = guestSession(), user = null, rooms = [{ id: "room_r", unique_name: "visit-r" }], roomsStatus = 200, body }) {
  const { impl, calls } = makeFetch([
    { match: (u) => /\/v2\/rooms\?/.test(u), respond: () => ({ status: roomsStatus, json: { data: rooms } }) },
    { match: (u, init) => u.endsWith("/v2/rooms") && init.method === "POST", respond: () => ({ status: 201, json: { data: { id: "room_new" } } }) },
    { match: (u) => u.includes("/actions/generate_join_client_token"), respond: () => ({
      status: 201, json: { data: { token: "JOIN-R", token_expires_at: "2026-10-09T21:00:00Z", refresh_token: "REFRESH-SECRET", refresh_token_expires_at: "2026-10-09T20:01:00Z" } },
    }) },
  ]);
  const handler = await loadHandler("../functions/createTelehealthToken/entry.ts", {
    env: { SUPER_ADMIN_EMAIL: "owner@x.com" },
    makeClient: () => makeBase44({ user, data: { IntegrationSecret: [{ api_key: "KEYtest" }], TelehealthSession: [session] } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/createTelehealthToken", { method: "POST", body: JSON.stringify(body) }));
  return { res, json: await res.json(), calls };
}

test("createTelehealthToken returns the token expiry and never hands the browser a Telnyx refresh token", async () => {
  const out = await telehealthTokenWith({ body: { room_name: "visit-r", join_token: GUEST_TOKEN } });
  assert.equal(out.res.status, 200);
  assert.equal(out.json.token, "JOIN-R");
  assert.equal(out.json.token_expires_at, "2026-10-09T21:00:00Z");
  assert.equal(out.json.token_ttl_secs, 3600);
  assert.equal(Object.hasOwn(out.json, "refresh_token"), false);
  assert.equal(JSON.stringify(out.json).includes("REFRESH-SECRET"), false);
  const mint = out.calls.find((c) => c.url.includes("/actions/generate_join_client_token"));
  assert.deepEqual(mint.body, { token_ttl_secs: 3600, refresh_token_ttl_secs: 60 }, "within the spec's 10–3600 and 60–86400 bounds");
});

test("a token refresh re-runs the guest and staff authorization and reuses the existing room", async () => {
  const guest = await telehealthTokenWith({ body: { action: "refresh", room_name: "visit-r", join_token: GUEST_TOKEN } });
  assert.equal(guest.res.status, 200);
  assert.equal(guest.json.token, "JOIN-R");
  assert.equal(guest.calls.some((c) => c.method === "POST" && c.url.endsWith("/v2/rooms")), false, "a refresh never creates a room");
  assert.ok(guest.calls.some((c) => c.url.includes("/v2/rooms/room_r/actions/generate_join_client_token")));

  const host = await telehealthTokenWith({ user: { id: "host_1", email: "host@x.com", role: "user" }, body: { action: "refresh", room_name: "visit-r" } });
  assert.equal(host.res.status, 200, "the host renews through the staff path");

  const refusals = [
    ["a wrong guest token", { body: { action: "refresh", room_name: "visit-r", join_token: "d".repeat(48) } }],
    ["a visit that has ended", { session: guestSession({ status: "completed" }), body: { action: "refresh", room_name: "visit-r", join_token: GUEST_TOKEN } }],
    ["a guest link past its window", { session: guestSession({ scheduled_at: new Date(Date.now() - 13 * 3600 * 1000).toISOString() }), body: { action: "refresh", room_name: "visit-r", join_token: GUEST_TOKEN } }],
    ["a signed-in non-participant", { user: { id: "u9", email: "other@x.com", role: "user" }, body: { action: "refresh", room_name: "visit-r" } }],
  ];
  for (const [label, input] of refusals) {
    const out = await telehealthTokenWith(input);
    assert.equal(out.res.status, 403, label);
    assert.equal(out.calls.length, 0, `${label}: refused before any Telnyx call`);
  }
});

test("a token refresh for a room that no longer exists is refused, not re-provisioned", async () => {
  const gone = await telehealthTokenWith({ rooms: [], body: { action: "refresh", room_name: "visit-r", join_token: GUEST_TOKEN } });
  assert.equal(gone.res.status, 409);
  assert.equal(gone.json.code, "telehealth_room_gone");
  assert.equal(gone.calls.some((c) => c.method === "POST"), false);

  const unreadable = await telehealthTokenWith({ roomsStatus: 503, body: { action: "refresh", room_name: "visit-r", join_token: GUEST_TOKEN } });
  assert.equal(unreadable.res.status, 502);
  assert.equal(unreadable.calls.some((c) => c.method === "POST"), false);

  const bad = await telehealthTokenWith({ body: { action: "renew", room_name: "visit-r", join_token: GUEST_TOKEN } });
  assert.equal(bad.res.status, 400);
  assert.equal(bad.calls.length, 0);
});

test("rotateTelehealthJoinToken mints a fresh token and stores only its hash", async () => {
  const writes = [];
  const sessionRow = { id: "ts1", room_name: "visit-3", host_email: "host@x.com", status: "scheduled", participant_list: [] };
  const mkHandler = (user) => loadHandler("../functions/rotateTelehealthJoinToken/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({ user, writes, data: { TelehealthSession: [sessionRow] } }),
    fetchImpl: makeFetch([]).impl,
  });

  let handler = await mkHandler({ email: "host@x.com", role: "user" });
  const res = await handler(new Request("https://app/functions/rotateTelehealthJoinToken", {
    method: "POST", body: JSON.stringify({ session_id: "ts1" }),
  }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.match(out.token, /^[0-9a-f]{48}$/, "returns a 192-bit hex token to the authorized staff caller");
  const write = writes.find((w) => w.entity === "TelehealthSession" && w.op === "update" && w.id === "ts1");
  assert.ok(write, "persists the rotation on the session");
  assert.equal(write.patch.join_token_hash, createHash("sha256").update(out.token).digest("hex"), "stores the SHA-256 of the token, not the token");
  assert.equal(write.patch.invite_link, null, "retires any legacy plaintext invite_link");
  assert.ok(!JSON.stringify(write.patch).includes(out.token), "the raw token is never written at rest");

  // A non-host, non-participant, non-admin caller must be refused.
  handler = await mkHandler({ email: "other@x.com", role: "user" });
  const forbidden = await handler(new Request("https://app/functions/rotateTelehealthJoinToken", {
    method: "POST", body: JSON.stringify({ session_id: "ts1" }),
  }));
  assert.equal(forbidden.status, 403);

  // Closed sessions must not get new capabilities minted.
  sessionRow.status = "completed";
  handler = await mkHandler({ email: "host@x.com", role: "user" });
  const closed = await handler(new Request("https://app/functions/rotateTelehealthJoinToken", {
    method: "POST", body: JSON.stringify({ session_id: "ts1" }),
  }));
  assert.equal(closed.status, 409);
  sessionRow.status = "scheduled";
});

// ============================ WEBHOOK + CALL CONTROL BRIDGE ============================
// Generate a real Ed25519 keypair, sign `${timestamp}|${body}`, and feed the
// signed webhook through handleTelnyxStatusWebhook — validating signature
// verification AND that an answered masked-bridge leg issues the transfer command.
function rawEd25519PublicKeyB64(publicKey) {
  // SPKI DER for Ed25519 is a fixed 12-byte header + the 32-byte raw key.
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32)).toString("base64");
}

// Build a validly-signed Telnyx webhook request for an event object.
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
  to_name: "Example Practice",
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

const activeFaxSenderMembership = (overrides = {}) => ({
  id: "membership_a",
  agency_id: "agency_a",
  user_id: "user_a",
  membership_key: "agency_a:user_a",
  user_email_normalized: "staff@example.com",
  tenant_role: "clinician",
  status: "active",
  created_by_user_id: "user_owner",
  last_transition_by_user_id: "user_owner",
  last_transition_by_email_normalized: "owner@example.com",
  last_transition_at: "2026-01-01T00:00:00.000Z",
  last_transition_reason: "Activated for agency fax access",
  activated_at: "2026-01-01T00:00:00.000Z",
  version: 2,
  ...overrides,
});

test("pollFaxStatuses is default-false before Base44 SDK construction", async () => {
  let clientConstructions = 0;
  const provider = makeFetch([]);
  const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: {},
    makeClient: () => {
      clientConstructions++;
      throw new Error("SDK construction must remain unreachable while gated");
    },
    fetchImpl: provider.impl,
  });

  const response = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Fax status polling is not released" });
  assert.equal(clientConstructions, 0);
  assert.equal(provider.calls.length, 0);

  const workflow = JSON.parse(await readFile(
    new URL("../workflows/Poll Fax Statuses.jsonc", import.meta.url),
    "utf8",
  ));
  assert.equal(workflow.definition?.do?.[0]?.run_function?.with?.function_name, "pollFaxStatuses");
  assert.deepEqual(workflow.definition?.do?.[0]?.run_function?.with?.args, {});
  assert.equal(workflow.trigger?.config?.schedule_mode, "interval");
  assert.equal(workflow.trigger?.config?.interval_value, 15);
  assert.equal(workflow.trigger?.config?.interval_unit, "minutes");
  await assert.rejects(
    readFile(new URL("../functions/pollFaxStatuses/function.jsonc", import.meta.url), "utf8"),
    (error) => error?.code === "ENOENT",
  );
});

test("pollFaxStatuses persists fairness across a cold start beyond twenty rows", async () => {
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    FaxLog: Array.from({ length: 30 }, (_, index) => outboundFax({
      id: `FaxLog_${index + 1}`,
      telnyx_fax_id: `outbound_fax_${index + 1}`,
      provider_submission_attempt_id: `submission_attempt_${index + 1}`,
      created_date: new Date(Date.UTC(2020, 0, 1) + index * 1000).toISOString(),
      updated_date: new Date(Date.UTC(2026, 8, 6) + index * 1000).toISOString(),
    })),
  };
  const provider = makeFetch([{
    match: (url) => url.includes("/v2/faxes/outbound_fax_"),
    respond: (url) => ({ status: 200, json: { data: {
      id: decodeURIComponent(url.split("/").at(-1)),
      status: "sending",
    } } }),
  }]);
  const loadPoller = () => loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ data: state }),
    fetchImpl: provider.impl,
  });
  const handler = await loadPoller();

  const first = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  const firstBody = await first.json();
  assert.equal(firstBody.checked, 20);
  assert.equal(firstBody.scanned, 25);
  assert.ok(
    provider.calls.some((call) => call.url.endsWith("/v2/faxes/outbound_fax_1")),
    "an attempt more than 48 hours old is still polled",
  );

  // Load a fresh module to model a cold function isolate. Progress must come
  // from FaxLog leases, never process memory.
  const coldHandler = await loadPoller();
  const second = await coldHandler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
  const secondBody = await second.json();
  assert.equal(secondBody.checked, 10);
  assert.equal(secondBody.scanned, 10);
  assert.equal(provider.calls.length, 30);
  assert.ok(
    provider.calls.some((call) => call.url.endsWith("/v2/faxes/outbound_fax_21")),
    "rows fetched just beyond the provider budget are not skipped by the cursor",
  );
  assert.ok(
    provider.calls.some((call) => call.url.endsWith("/v2/faxes/outbound_fax_30")),
    "the next page is reached instead of repeatedly polling only twenty rows",
  );
  assert.ok(state.FaxLog.every((row) => Number.isFinite(Date.parse(row.status_poll_last_attempt_at))));
});

test("pollFaxStatuses reserves provider capacity across non-terminal statuses", async () => {
  const queued = Array.from({ length: 25 }, (_, index) => outboundFax({
    id: `QueuedFax_${index + 1}`,
    telnyx_fax_id: `queued_fax_${index + 1}`,
    provider_submission_attempt_id: `queued_attempt_${index + 1}`,
    status: "queued",
    created_date: new Date(Date.UTC(2020, 0, 1) + index * 1000).toISOString(),
  }));
  const sent = outboundFax({
    id: "SentFax_1",
    telnyx_fax_id: "sent_fax_1",
    provider_submission_attempt_id: "sent_attempt_1",
    status: "sent",
    created_date: "2026-09-06T12:00:00.000Z",
  });
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    FaxLog: [...queued, sent],
  };
  const provider = makeFetch([{
    match: (url) => url.includes("/v2/faxes/"),
    respond: (url) => ({ status: 200, json: { data: {
      id: decodeURIComponent(url.split("/").at(-1)),
      status: url.endsWith("/sent_fax_1") ? "sent" : "queued",
    } } }),
  }]);
  const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ data: state }),
    fetchImpl: provider.impl,
  });

  const response = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).checked, 20);
  assert.equal(provider.calls.length, 20);
  assert.ok(
    provider.calls.some((call) => call.url.endsWith("/v2/faxes/sent_fax_1")),
    "a queued backlog cannot consume every provider call",
  );
});

test("pollFaxStatuses bounds provider GETs and returns a PHI-free degraded summary", async () => {
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    FaxLog: [outboundFax()],
  };
  let observedSignal = null;
  const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ data: state }),
    fetchImpl: async (_url, init = {}) => {
      observedSignal = init.signal;
      throw new DOMException("simulated timeout", "AbortError");
    },
  });

  const response = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.degraded, true);
  assert.equal(body.checked, 1);
  assert.equal(body.updated, 0);
  assert.equal(body.provider_failures, 1);
  assert.equal(body.row_failures, 0);
  assert.ok(observedSignal instanceof AbortSignal, "Telnyx GET receives an AbortSignal timeout");
  const serialized = JSON.stringify(body);
  for (const secretOrPhi of [
    "FaxLog_1",
    "outbound_fax_1",
    "staff@example.com",
    "+13125550182",
  ]) {
    assert.equal(serialized.includes(secretOrPhi), false);
  }
});

test("pollFaxStatuses uses exact provider identity, CAS, and immutable agency retry policy", async () => {
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    FaxRetryConfig: [{ agency_id: "agency_a", max_retries: 3, retry_delay_minutes: 15 }],
    FaxLog: [outboundFax()],
    Notification: [],
  };
  const { impl, calls } = makeFetch([{
    match: (url) => url.endsWith("/v2/faxes/outbound_fax_1"),
    respond: () => ({ status: 200, json: { data: {
      id: "outbound_fax_1",
      status: "failed",
      failure_reason: "remote line busy",
    } } }),
  }]);
  const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ writes, data: state }),
    fetchImpl: impl,
  });
  const response = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(calls.length, 1);
  assert.equal(state.FaxLog[0].status, "failed");
  assert.equal(state.FaxLog[0].provider_terminal_status, "failed");
  assert.equal(state.FaxLog[0].retry_count, 1);
  assert.ok(Number.isFinite(Date.parse(state.FaxLog[0].next_retry_at)));
  assert.equal(writes.some((write) => write.entity === "User"), false);
  const transition = writes.find((write) => write.entity === "FaxLog" && write.op === "updateMany"
    && write.query.telnyx_fax_id === "outbound_fax_1");
  assert.equal(transition?.query.id, "FaxLog_1");
  assert.equal(transition?.query.telnyx_fax_id, "outbound_fax_1");
  assert.equal(transition?.query.status, "sending");
  assert.equal(transition?.query.updated_date, "2026-09-06T12:00:01.001Z");
});

test("pollFaxStatuses releases a stale retry only with an exactly rejected child", async () => {
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    FaxRetryConfig: [{ agency_id: 'agency_a', max_retries: 1 }],
    AgencyMembership: [activeFaxSenderMembership()],
    FaxLog: [outboundFax({
      status: "retrying",
      provider_terminal_status: "failed",
      provider_terminal_at: "2026-09-06T12:05:00.000Z",
      retry_count: 1,
      retry_generation: 0,
      retry_claimed_by: "retry_claim_1",
      retry_claimed_by_user_id: "user_a",
      retry_claimed_at: "2020-01-01T00:00:00.000Z",
      final_failure_notified: false,
    })],
    Notification: [],
  };
  const client = makeSpyBase44({ writes, data: state });
  state.FaxLog.push(outboundFax({ id: 'FaxLog_retry', status: 'failed',
    retry_of_fax_log_id: 'FaxLog_1', retry_generation: 1, retry_count: 1,
    provider_submission_state: 'rejected', telnyx_fax_id: null, final_failure_notified: false,
  }));
  const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => client,
    fetchImpl: makeFetch([]).impl,
  });
  const response = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).released_stale_retries, 1);
  assert.equal(state.FaxLog[0].status, "failed");
  assert.equal(state.Notification.length, 1);
  assert.equal(state.FaxLog[0].final_failure_notified, true);
  assert.equal(state.FaxLog[0].failure_notify_publication_state, "started");
  const release = writes.find((write) => (
    write.entity === "FaxLog"
    && write.op === "updateMany"
    && write.query.retry_claimed_by === "retry_claim_1"
  ));
  assert.equal(release.query.retry_count, 1);
  assert.equal(release.query.retry_generation, 0);
  assert.equal(release.query.integration_secret_id, "integration_1");
  assert.equal(release.query.integration_secret_updated_at, "2026-09-06T11:59:00.000Z");
  assert.equal(release.query.fax_connection_id, "fax_connection_1");
});

test("fax status poller fails closed for malformed or inactive retry policies", async () => {
  for (const policy of [
    { agency_id: "agency_a", max_retries: 100, retry_delay_minutes: 15 },
    { agency_id: "agency_a", max_retries: 3, retry_delay_minutes: 361 },
    { agency_id: "agency_a", max_retries: 3, retry_delay_minutes: 15, is_active: false },
  ]) {
    const state = {
      IntegrationSecret: [activeTelnyxSecret()],
      Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
      AgencyMembership: [activeFaxSenderMembership()],
      FaxRetryConfig: [policy],
      FaxLog: [outboundFax()],
      Notification: [],
    };
    const provider = makeFetch([{
      match: (url) => url.endsWith("/v2/faxes/outbound_fax_1"),
      respond: () => ({ status: 200, json: { data: {
        id: "outbound_fax_1",
        status: "failed",
        failure_reason: "remote line busy",
      } } }),
    }]);
    const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
      env: pollFaxStatusesReleased,
      makeClient: () => makeSpyBase44({ data: state }),
      fetchImpl: provider.impl,
    });
    const response = await handler(new Request("https://app/functions/pollFaxStatuses"));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(provider.calls.length, 1);
    assert.equal(state.FaxLog[0].status, "failed");
    assert.equal(state.FaxLog[0].retry_count, 0);
    assert.equal(state.FaxLog[0].next_retry_at, null);
    assert.equal(state.FaxLog[0].final_failure_notified, true);
    assert.equal(state.Notification.length, 1);
  }
});

test("pollFaxStatuses never schedules legacy fax rows and rejects ambiguous active credentials", async () => {
  const legacyWrites = [];
  const legacyState = {
    IntegrationSecret: [activeTelnyxSecret()],
    FaxLog: [outboundFax({
      provider_submission_attempt_id: undefined,
      document_url: "https://legacy.example/fax.pdf",
    })],
    Notification: [],
  };
  const legacyFetch = makeFetch([{
    match: (url) => url.endsWith("/v2/faxes/outbound_fax_1"),
    respond: () => ({ status: 200, json: { data: {
      id: "outbound_fax_1",
      status: "failed",
      failure_reason: "remote line busy",
    } } }),
  }]);
  const legacyHandler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ writes: legacyWrites, data: legacyState }),
    fetchImpl: legacyFetch.impl,
  });
  const legacyResponse = await legacyHandler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(legacyResponse.status, 503);
  assert.equal((await legacyResponse.json()).row_failures, 1);
  assert.equal(legacyFetch.calls.length, 0);
  assert.equal(legacyState.FaxLog[0].status, "sending");
  assert.equal(legacyState.FaxLog[0].next_retry_at, undefined);
  assert.equal(legacyState.FaxLog[0].retry_count, 0);
  assert.equal(legacyState.FaxLog[0].final_failure_notified, false);
  assert.equal(legacyState.Notification.length, 0);
  assert.equal(legacyWrites.length, 2);
  const legacyQuarantine = legacyWrites.find((write) => (
    write.entity === "FaxLog" && write.patch?.$set?.status_poll_quarantined_at
  ));
  assert.equal(legacyQuarantine.patch.$set.status_poll_last_error_code, "invalid_status_poll_authority");

  const duplicateCredentials = [
    activeTelnyxSecret({ id: "integration_1", api_key: "KEYone" }),
    activeTelnyxSecret({ id: "integration_2", api_key: "KEYtwo" }),
  ];
  const ambiguousFetch = makeFetch([]);
  const ambiguousHandler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ data: {
      IntegrationSecret: duplicateCredentials,
      FaxLog: [outboundFax()],
    } }),
    fetchImpl: ambiguousFetch.impl,
  });
  const ambiguousResponse = await ambiguousHandler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(ambiguousResponse.status, 500);
  assert.equal(ambiguousFetch.calls.length, 0);
});

test("pollFaxStatuses quarantines duplicate provider ids before calling Telnyx", async () => {
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    FaxLog: [outboundFax(), outboundFax({ id: "FaxLog_2" })],
  };
  const provider = makeFetch([]);
  const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ writes, data: state }),
    fetchImpl: provider.impl,
  });
  const response = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    success: false,
    degraded: true,
    checked: 0,
    updated: 0,
    scanned: 2,
    provider_failures: 0,
    row_failures: 2,
    scan_failures: 0,
    recovery_failures: 0,
    released_stale_retries: 0,
    ambiguous_fax_identities: 1,
  });
  assert.equal(provider.calls.length, 0);
  assert.equal(writes.length, 4);
  assert.equal(writes.filter((write) => (
    write.entity === "FaxLog"
    && write.patch?.$set?.status_poll_last_error_code === "ambiguous_provider_fax_identity"
  )).length, 2);
});

test("fax status consumers quarantine a stale credential revision", async () => {
  const pollWrites = [];
  const pollState = {
    IntegrationSecret: [activeTelnyxSecret()],
    FaxLog: [outboundFax({ integration_secret_updated_at: "2026-09-05T11:59:00.000Z" })],
  };
  const provider = makeFetch([]);
  const pollHandler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => makeSpyBase44({ writes: pollWrites, data: pollState }),
    fetchImpl: provider.impl,
  });
  const pollResponse = await pollHandler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(pollResponse.status, 503);
  const pollBody = await pollResponse.json();
  assert.equal(pollBody.checked, 0);
  assert.equal(pollBody.row_failures, 1);
  assert.equal(provider.calls.length, 0);
  assert.equal(pollWrites.length, 2);
  assert.equal(
    pollWrites.at(-1).patch.$set.status_poll_last_error_code,
    "stale_status_poll_credential",
  );
  assert.ok(Number.isFinite(Date.parse(pollState.FaxLog[0].status_poll_quarantined_at)));

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const webhookWrites = [];
  const webhookState = {
    IntegrationSecret: [activeTelnyxSecret({ public_key: pubB64 })],
    FaxLog: [outboundFax({ integration_secret_updated_at: "2026-09-05T11:59:00.000Z" })],
  };
  const webhookHandler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({ writes: webhookWrites, data: webhookState }),
    fetchImpl: makeFetch([]).impl,
  });
  const event = { data: { event_type: "fax.failed", payload: {
    id: "outbound_fax_1",
    status: "failed",
    failure_reason: "remote line busy",
  } } };
  const webhookResponse = await webhookHandler(signedWebhook(privateKey, event));
  assert.equal(webhookResponse.status, 409);
  assert.equal(webhookWrites.length, 0);
  assert.equal(webhookState.FaxLog[0].status, "sending");
});

test("signed outbound fax statuses transition exactly once and preserve retry authority", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret({ public_key: pubB64 })],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    FaxRetryConfig: [{ agency_id: "agency_a", max_retries: 3, retry_delay_minutes: 15 }],
    FaxLog: [outboundFax()],
    Notification: [],
  };
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({ writes, data: state }),
    fetchImpl: makeFetch([]).impl,
  });
  const event = { data: { event_type: "fax.failed", payload: {
    id: "outbound_fax_1",
    status: "failed",
    failure_reason: "remote line busy",
  } } };
  const first = await handler(signedWebhook(privateKey, event));
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  assert.equal(state.FaxLog[0].status, "failed");
  assert.equal(state.FaxLog[0].provider_submission_state, "accepted");
  assert.equal(state.FaxLog[0].provider_terminal_status, "failed");
  assert.ok(Number.isFinite(Date.parse(state.FaxLog[0].provider_terminal_at)));
  assert.equal(state.FaxLog[0].retry_count, 1);
  assert.ok(Number.isFinite(Date.parse(state.FaxLog[0].next_retry_at)));
  const transitions = writes.filter((write) => write.entity === "FaxLog" && write.op === "updateMany");
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].query.telnyx_fax_id, "outbound_fax_1");
  assert.equal(transitions[0].query.status, "sending");
  assert.equal(transitions[0].query.updated_date, "2026-09-06T12:00:01.000Z");

  const replay = await handler(signedWebhook(privateKey, event));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).deduped, true);
  assert.equal(writes.filter((write) => write.entity === "FaxLog" && write.op === "updateMany").length, 1);
});

test("signed fax webhook fails closed for malformed or inactive retry policies", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  for (const policy of [
    { agency_id: "agency_a", max_retries: 100, retry_delay_minutes: 15 },
    { agency_id: "agency_a", max_retries: 3, retry_delay_minutes: 361 },
    { agency_id: "agency_a", max_retries: 3, retry_delay_minutes: 15, is_active: false },
  ]) {
    const state = {
      IntegrationSecret: [activeTelnyxSecret({ public_key: pubB64 })],
      Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
      AgencyMembership: [activeFaxSenderMembership()],
      FaxRetryConfig: [policy],
      FaxLog: [outboundFax()],
      Notification: [],
    };
    const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
      env: {},
      makeClient: () => makeSpyBase44({ data: state }),
      fetchImpl: makeFetch([]).impl,
    });
    const response = await handler(signedWebhook(privateKey, { data: {
      event_type: "fax.failed",
      payload: {
        id: "outbound_fax_1",
        status: "failed",
        failure_reason: "remote line busy",
      },
    } }));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(state.FaxLog[0].status, "failed");
    assert.equal(state.FaxLog[0].retry_count, 0);
    assert.equal(state.FaxLog[0].next_retry_at, null);
    assert.equal(state.FaxLog[0].final_failure_notified, true);
    assert.equal(state.Notification.length, 1);
  }
});

test("fax webhooks reject ambiguous active Telnyx credentials before any status write", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const writes = [];
  const state = {
    IntegrationSecret: [
      activeTelnyxSecret({ id: "integration_1", public_key: pubB64 }),
      activeTelnyxSecret({ id: "integration_2", public_key: pubB64 }),
    ],
    FaxLog: [outboundFax()],
  };
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({ writes, data: state }),
    fetchImpl: makeFetch([]).impl,
  });
  const response = await handler(signedWebhook(privateKey, { data: {
    event_type: "fax.failed",
    payload: { id: "outbound_fax_1", status: "failed" },
  } }));
  assert.equal(response.status, 503);
  assert.equal(state.FaxLog[0].status, "sending");
  assert.equal(writes.length, 0);
});

test("an ambiguous committed fax notification is reconciled without a duplicate create", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret({ public_key: pubB64 })],
    AgencyMembership: [activeFaxSenderMembership()],
    FaxLog: [outboundFax()],
    Notification: [],
  };
  const client = makeSpyBase44({ writes, data: state });
  const notificationEntity = client.asServiceRole.entities.Notification;
  const createNotification = notificationEntity.create;
  let loseCreateResponse = true;
  notificationEntity.create = async (row) => {
    const created = await createNotification(row);
    if (loseCreateResponse) {
      loseCreateResponse = false;
      throw new Error("simulated response loss after notification commit");
    }
    return created;
  };
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => client,
    fetchImpl: makeFetch([]).impl,
  });
  const event = { data: { event_type: "fax.delivered", payload: {
    id: "outbound_fax_1",
    status: "delivered",
    page_count: 2,
  } } };
  const first = await handler(signedWebhook(privateKey, event));
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  assert.equal(state.Notification.length, 1);
  assert.match(state.Notification[0].dedupe_key, /^fax:agency_a:FaxLog_1:delivered$/);
  assert.equal(state.FaxLog[0].delivery_confirmation_sent, true);
  assert.equal(state.FaxLog[0].delivery_notify_claimed_by, null);

  const replay = await handler(signedWebhook(privateKey, event));
  assert.equal(replay.status, 200);
  assert.equal(state.Notification.length, 1);
});

test("pollFaxStatuses recovers a stale terminal notification claim", async () => {
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    AgencyMembership: [activeFaxSenderMembership()],
    FaxLog: [outboundFax({
      status: "delivered",
      provider_terminal_status: "delivered",
      provider_terminal_at: "2026-09-06T12:05:00.000Z",
      delivery_confirmation_sent: false,
      delivery_notify_claimed_by: "stale-delivery-claim",
      delivery_notify_claimed_at: "2026-09-06T12:05:00.000Z",
      delivery_notify_publication_state: "ready",
      updated_date: "2026-09-06T12:05:00.000Z",
    })],
    Notification: [],
  };
  const provider = makeFetch([{
    match: (url) => url.endsWith("/v2/faxes/outbound_fax_1"),
    respond: () => ({ status: 200, json: { data: {
      id: "outbound_fax_1",
      status: "delivered",
      page_count: 2,
    } } }),
  }]);
  const client = makeSpyBase44({ writes, data: state });
  const handler = await loadHandler("../functions/pollFaxStatuses/entry.ts", {
    env: pollFaxStatusesReleased,
    makeClient: () => client,
    fetchImpl: provider.impl,
  });
  const first = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  assert.equal(state.Notification.length, 1);
  assert.equal(state.FaxLog[0].delivery_confirmation_sent, true);
  assert.equal(state.FaxLog[0].delivery_notify_claimed_by, null);
  assert.equal(state.FaxLog[0].delivery_notify_claimed_at, null);

  const second = await handler(new Request("https://app/functions/pollFaxStatuses"));
  assert.equal(second.status, 200);
  assert.equal(state.Notification.length, 1);
  assert.equal(writes.filter((write) => (
    write.entity === "Notification" && write.op === "create"
  )).length, 1);
});

test('fax polling includes hosted null leases and rejects null required authority', async () => {
  for (const invalidField of [null, 'agency_id', 'document_id', 'referral_id', 'sent_by_user_id', 'sent_by_membership_id', 'sender_settings_id', 'provider_submission_attempt_id']) {
    const state = { IntegrationSecret: [activeTelnyxSecret()], FaxLog: [outboundFax({
      status_poll_quarantined_at: null, status_poll_next_attempt_at: null,
      ...(invalidField ? { [invalidField]: null } : {}),
    })] };
    const provider = makeFetch([{ match: () => true, respond: () => ({ json: { data: { id: 'outbound_fax_1', status: 'sent' } } }) }]);
    const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state }), fetchImpl: provider.impl,
    });
    const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(response.status, invalidField ? 503 : 200, String(invalidField));
    assert.equal(provider.calls.length, invalidField ? 0 : 1, String(invalidField));
    assert.equal(state.FaxLog[0].status, invalidField ? 'sending' : 'sent');
  }
});

test('a stale retry with no visible child stays quarantined instead of authorizing a resend', async () => {
  const state = { IntegrationSecret: [activeTelnyxSecret()], FaxLog: [outboundFax({
    status: 'retrying', provider_terminal_status: 'failed', provider_terminal_at: '2026-09-06T12:05:00.000Z',
    retry_count: 1, retry_generation: 0, retry_claimed_by: 'retry-claim', retry_claimed_by_user_id: 'user_a',
    retry_claimed_at: '2020-01-01T00:00:00.000Z', final_failure_notified: true,
    retry_recovery_quarantined_at: null, retry_recovery_next_attempt_at: null,
  })] };
  const provider = makeFetch([]);
  const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
    env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state }), fetchImpl: provider.impl,
  });
  const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).recovery_failures, 1);
  assert.equal(state.FaxLog[0].status, 'retrying');
  assert.equal(state.FaxLog[0].retry_claimed_by, 'retry-claim');
  assert.equal(state.FaxLog[0].retry_recovery_last_error_code, 'stale_retry_child_unresolved');
  assert.equal(provider.calls.length, 0);
});

test('terminal recovery reports partial scan failures and pending legacy publications', async () => {
  for (const scenario of ['partial-scan', 'legacy-publication']) {
    const state = { IntegrationSecret: [activeTelnyxSecret()], AgencyMembership: [activeFaxSenderMembership()],
      FaxLog: scenario === 'partial-scan' ? [] : [outboundFax({
        status: 'delivered', provider_terminal_status: 'delivered', provider_terminal_at: '2026-09-06T12:05:00.000Z',
        notification_recovery_quarantined_at: null, notification_recovery_next_attempt_at: null,
        delivery_notify_claimed_by: 'legacy-claim', delivery_notify_claimed_at: '2020-01-01T00:00:00.000Z',
      })], Notification: [] };
    const client = makeSpyBase44({ data: state });
    const filter = client.asServiceRole.entities.FaxLog.filter;
    client.asServiceRole.entities.FaxLog.filter = async (query, ...args) => {
      if (scenario === 'partial-scan' && query.status === 'delivered' && query.$and) throw new Error('page unavailable');
      return filter(query, ...args);
    };
    const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => client, fetchImpl: makeFetch([]).impl,
    });
    const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(response.status, 503, scenario);
    assert.equal((await response.json()).recovery_failures, 1, scenario);
    assert.equal(state.Notification.length, 0);
  }
});

test('poller and webhook fence delayed notification creates across expired claims', async () => {
  for (const initiator of ['poller', 'webhook']) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const state = { IntegrationSecret: [activeTelnyxSecret({ public_key: rawEd25519PublicKeyB64(publicKey) })],
      AgencyMembership: [activeFaxSenderMembership()], FaxLog: [outboundFax()], Notification: [] };
    const client = makeSpyBase44({ data: state });
    const create = client.asServiceRole.entities.Notification.create;
    let started;
    let release;
    const creating = new Promise((resolve) => { started = resolve; });
    const finish = new Promise((resolve) => { release = resolve; });
    let attempts = 0;
    client.asServiceRole.entities.Notification.create = async (payload) => {
      attempts++;
      started();
      await finish;
      return create(payload);
    };
    const provider = makeFetch([{ match: () => true, respond: () => ({ json: { data: { id: 'outbound_fax_1', status: 'delivered' } } }) }]);
    const firstHandler = await loadHandler(`../functions/${initiator === 'poller' ? 'pollFaxStatuses' : 'handleTelnyxStatusWebhook'}/entry.ts`, {
      env: pollFaxStatusesReleased, makeClient: () => client, fetchImpl: provider.impl,
    });
    const pending = firstHandler(initiator === 'poller' ? new Request('https://app/functions/pollFaxStatuses')
      : signedWebhook(privateKey, { data: { event_type: 'fax.delivered', payload: { id: 'outbound_fax_1', status: 'delivered' } } }));
    await creating;
    assert.equal(state.FaxLog[0].delivery_notify_publication_state, 'started');
    state.FaxLog[0].delivery_notify_claimed_at = '2020-01-01T00:00:00.000Z';
    const recovery = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => client, fetchImpl: provider.impl,
    });
    const unresolved = await recovery(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(unresolved.status, 503, initiator);
    assert.equal(attempts, 1, initiator);
    release();
    await pending;
    state.FaxLog[0].delivery_notify_claimed_at = '2020-01-01T00:00:00.000Z';
    state.FaxLog[0].notification_recovery_next_attempt_at = '2020-01-01T00:00:00.000Z';
    const recovered = await recovery(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
    assert.equal(attempts, 1);
    assert.equal(state.Notification.length, 1);
    assert.equal(state.FaxLog[0].delivery_confirmation_sent, true);
  }
});

test('duplicate committed notifications are rejected rather than finalized', async () => {
  const state = { IntegrationSecret: [activeTelnyxSecret()], AgencyMembership: [activeFaxSenderMembership()],
    FaxLog: [outboundFax()], Notification: [] };
  const client = makeSpyBase44({ data: state });
  const provider = makeFetch([{ match: () => true, respond: () => ({ json: { data: { id: 'outbound_fax_1', status: 'delivered' } } }) }]);
  const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
    env: pollFaxStatusesReleased, makeClient: () => client, fetchImpl: provider.impl,
  });
  assert.equal((await handler(new Request('https://app/functions/pollFaxStatuses'))).status, 200);
  state.Notification.push({ ...structuredClone(state.Notification[0]), id: 'duplicate-notification' });
  Object.assign(state.FaxLog[0], { delivery_confirmation_sent: false,
    delivery_notify_claimed_by: 'old-claim', delivery_notify_claimed_at: '2020-01-01T00:00:00.000Z' });
  const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
  assert.equal(response.status, 503);
  assert.equal(state.FaxLog[0].delivery_confirmation_sent, false);
  assert.equal(state.Notification.length, 2);
});

test("ambiguous outbound fax identity and legacy URL rows never receive a retry schedule", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const duplicateState = {
    IntegrationSecret: [activeTelnyxSecret({ public_key: pubB64 })],
    FaxLog: [outboundFax(), outboundFax({ id: "FaxLog_2" })],
  };
  const duplicateWrites = [];
  const duplicateHandler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({ writes: duplicateWrites, data: duplicateState }),
    fetchImpl: makeFetch([]).impl,
  });
  const event = { data: { event_type: "fax.failed", payload: {
    id: "outbound_fax_1",
    status: "failed",
    failure_reason: "remote line busy",
  } } };
  const duplicateResponse = await duplicateHandler(signedWebhook(privateKey, event));
  assert.equal(duplicateResponse.status, 409);
  assert.equal(duplicateWrites.length, 0);

  const legacyWrites = [];
  const legacyState = {
    IntegrationSecret: [activeTelnyxSecret({ public_key: pubB64 })],
    FaxLog: [outboundFax({
      provider_submission_attempt_id: undefined,
      document_url: "https://legacy.example/fax.pdf",
    })],
    Notification: [],
  };
  const legacyHandler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({ writes: legacyWrites, data: legacyState }),
    fetchImpl: makeFetch([]).impl,
  });
  const legacyResponse = await legacyHandler(signedWebhook(privateKey, event));
  // A legacy URL row can never be authorized for a status write, so its event
  // is acknowledged (no Telnyx redelivery) — and still nothing is written.
  assert.equal(legacyResponse.status, 200, JSON.stringify(await legacyResponse.clone().json()));
  assert.equal((await legacyResponse.clone().json()).skipped, "untracked_fax_row");
  assert.equal(legacyState.FaxLog[0].status, "sending");
  assert.equal(legacyState.FaxLog[0].next_retry_at, undefined);
  assert.equal(legacyState.FaxLog[0].retry_count, 0);
  assert.equal(legacyState.FaxLog[0].final_failure_notified, false);
  assert.equal(legacyState.Notification.length, 0);
  assert.equal(legacyWrites.length, 0);
});

const b64json = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const decodeState = (b64) => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

// ---- Voice harness ----
// Call events are claimed by their envelope id (data.id) in UserActivity before
// they act, so the voice fake REMEMBERS what it is given and answers exact-match
// filters, which the shared makeBase44 (a fixed answer per entity) cannot.
function makeVoiceBase44({ data = {}, writes = [], uploads = [], failClaimReads = false, uploadHangs = false, claimBarrier = 0 } = {}) {
  // claimBarrier holds the first N claim reads until all N have arrived, so N
  // deliveries of one event all see "no claim yet" -- the race the
  // earliest-claim-wins rule exists for, which an in-memory store never
  // produces on its own.
  const waiting = [];
  let clock = Date.parse("2026-10-09T12:00:00.000Z");
  let serial = 0;
  const matches = (row, query = {}) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value);
  const sorted = (rows, sort) => {
    if (typeof sort !== "string") return rows;
    const direction = sort.startsWith("-") ? -1 : 1;
    const field = sort.replace(/^-/, "");
    return [...rows].sort((a, b) => direction * String(a?.[field] ?? "").localeCompare(String(b?.[field] ?? "")));
  };
  const limited = (rows, limit) => (Number.isInteger(limit) ? rows.slice(0, limit) : rows);
  const entity = (name) => ({
    filter: async (query = {}, sort, limit) => {
      if (name === "UserActivity" && failClaimReads) throw new Error("store unavailable");
      if (name === "UserActivity" && waiting.length < claimBarrier) {
        await new Promise((release) => {
          waiting.push(release);
          if (waiting.length === claimBarrier) for (const go of waiting) go();
        });
      }
      return limited(sorted((data[name] || []).filter((row) => matches(row, query)), sort), limit);
    },
    list: async (sort, limit) => limited(sorted(data[name] || [], sort), limit),
    create: async (row) => {
      clock += 1;
      serial += 1;
      const created = { id: `${name}_${serial}`, created_date: new Date(clock).toISOString(), ...row };
      (data[name] ||= []).push(created);
      writes.push({ entity: name, op: "create", row: created });
      return created;
    },
    update: async (id, patch) => {
      const rows = data[name] || [];
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...patch };
      writes.push({ entity: name, op: "update", id, patch });
      return { id, ...patch };
    },
  });
  const cache = {};
  const entities = new Proxy({}, { get: (_t, name) => (cache[name] ||= entity(String(name))) });
  const Core = {
    UploadPrivateFile: async ({ file }) => {
      if (uploadHangs) return new Promise(() => {});
      uploads.push({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
      return { file_uri: `private/voicemail/${uploads.length}.mp3` };
    },
  };
  return { auth: { me: async () => ({}) }, entities, asServiceRole: { entities, integrations: { Core } } };
}

let voiceEventSerial = 0;
const voiceEvent = (eventType, payload, id = `voice-event-${++voiceEventSerial}`) => ({
  data: { id, event_type: eventType, occurred_at: "2026-10-09T12:00:00.000Z", payload },
});
const isAction = (call) => /\/v2\/calls\/[^/]+\/actions\//.test(call.url);
const actionsOf = (calls) => calls.filter(isAction);
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Load the webhook against the voice fake. Every Call Control action answers 200
// unless an earlier route says otherwise; `binary` answers a non-JSON download.
async function loadVoiceWebhook({ data = {}, routes = [], binary = null, failClaimReads = false, uploadHangs = false, copyBudgetMs = null, claimBarrier = 0 } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  data.IntegrationSecret ||= [activeTelnyxSecret({ public_key: pubB64 })];
  const writes = [];
  const uploads = [];
  const client = makeVoiceBase44({ data, writes, uploads, failClaimReads, uploadHangs, claimBarrier });
  const base = makeFetch([
    ...routes,
    { match: (u) => /\/actions\//.test(u), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const calls = base.calls;
  const impl = async (url, init = {}) => {
    const answer = binary?.(String(url), init);
    if (answer) {
      calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: null, init });
      return answer;
    }
    return base.impl(url, init);
  };
  // A budget test shrinks the voicemail copy budget in a temporary copy of the
  // entry, so a timeout is exercised in milliseconds rather than seconds.
  let entry = "../functions/handleTelnyxStatusWebhook/entry.ts";
  let scratch = null;
  if (copyBudgetMs != null) {
    const source = await readFile(new URL(entry, import.meta.url), "utf8");
    const budget = "const VOICEMAIL_COPY_BUDGET_MS = 5000;";
    assert.ok(source.includes(budget), "the voicemail copy budget is where this harness expects it");
    scratch = await mkdtemp(join(tmpdir(), "voice-budget-"));
    await mkdir(join(scratch, "handleTelnyxStatusWebhook"));
    entry = pathToFileURL(join(scratch, "handleTelnyxStatusWebhook", "entry.ts")).href;
    await writeFile(new URL(entry), source.replace(budget, `const VOICEMAIL_COPY_BUDGET_MS = ${copyBudgetMs};`));
  }
  try {
    const handler = await loadHandler(entry, { env: {}, makeClient: () => client, fetchImpl: impl });
    return { send: (event) => handler(signedWebhook(privateKey, event)), calls, data, writes, uploads };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

const maskedBridgeState = (overrides = {}) => b64json({
  t: "masked_bridge", bridge_to: "+12155550144", caller_id: "+12155550100", call_log_id: "CallLog_1", amd: true, ...overrides,
});
const outboundLog = (overrides = {}) => ({
  id: "CallLog_1", direction: "outbound", status: "ringing", provider_call_id: "cc_nurse", ...overrides,
});
const inboundLog = (overrides = {}) => ({
  id: "CallLog_in", direction: "inbound", status: "in_progress", provider_call_id: "cc_caller",
  displayed_number: "+12155550100", from_number: "+13125550182", ...overrides,
});
const ringdownTargets = [
  { to: "+12155550111", kind: "primary" },
  { to: "+12155550122", kind: "backup" },
  { to: "+17244650440", kind: "office" },
];
const ringdownLegState = (overrides = {}) => b64json({
  t: "ringdown", idx: 0, callerId: "+12155550100", a_leg: "cc_caller", targets: ringdownTargets, ...overrides,
});

test("handleTelnyxStatusWebhook verifies Ed25519 and bridges a masked call a person answered", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [outboundLog()] } });
  const answered = await v.send(voiceEvent("call.answered", { call_control_id: "cc_nurse", direction: "outgoing", client_state: maskedBridgeState() }));
  assert.equal(answered.status, 200, "valid signature is accepted");
  assert.equal(actionsOf(v.calls).length, 0, "an answer alone dials nobody: the answering leg may be the nurse's voicemail");
  assert.equal(v.data.CallLog[0].status, "in_progress");

  for (const [result, leg] of [["human", "cc_nurse"], ["not_sure", "cc_nurse_2"]]) {
    await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: leg, client_state: maskedBridgeState(), result }));
    const transfer = v.calls.find((c) => c.url === `https://api.telnyx.com/v2/calls/${leg}/actions/transfer`);
    assert.ok(transfer, `a ${result} verdict bridges the patient`);
    assert.equal(transfer.body.to, "+12155550144");
    assert.equal(transfer.body.from, "+12155550100", "the patient sees the work number");
    // The patient leg carries a state of its own, on whichever leg Telnyx stamps it.
    assert.deepEqual(decodeState(transfer.body.target_leg_client_state), { t: "masked_patient_leg", call_log_id: "CallLog_1", nurse_leg: leg });
    assert.equal(transfer.body.client_state, transfer.body.target_leg_client_state);
    assert.match(transfer.body.command_id, UUID_SHAPE);
  }
});

test("a machine verdict on the nurse leg hangs up and never dials the patient", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [outboundLog({ status: "in_progress" })] } });
  const res = await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_nurse", client_state: maskedBridgeState(), result: "machine" }));
  assert.equal((await res.json()).machine, true);
  assert.deepEqual(actionsOf(v.calls).map((c) => c.url), ["https://api.telnyx.com/v2/calls/cc_nurse/actions/hangup"]);
  assert.equal(v.data.CallLog[0].status, "failed");
  assert.match(v.data.CallLog[0].failure_reason, /^Reached voicemail/);
  // The nurse leg's trailing hangup cannot regress the failure to 'completed'.
  await v.send(voiceEvent("call.hangup", { call_control_id: "cc_nurse", client_state: maskedBridgeState(), hangup_cause: "normal_clearing" }));
  assert.equal(v.data.CallLog[0].status, "failed");
});

test("a masked call placed before detection existed still bridges on call.answered", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [outboundLog()] } });
  await v.send(voiceEvent("call.answered", { call_control_id: "cc_nurse", direction: "outgoing", client_state: maskedBridgeState({ amd: undefined }) }));
  const transfer = v.calls.find((c) => /\/cc_nurse\/actions\/transfer$/.test(c.url));
  assert.ok(transfer, "a call in flight across the deploy is not left waiting for a verdict nobody requested");
  // ...and a stray verdict for it is ignored rather than bridging twice.
  await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_nurse", client_state: maskedBridgeState({ amd: undefined }), result: "human" }));
  assert.equal(v.calls.filter((c) => /\/actions\/transfer$/.test(c.url)).length, 1);
});

test("a failed masked-bridge transfer falls back to speak+hangup and marks the call failed", async () => {
  // Transfer returns 422 (e.g. invalid patient number) → must not strand the leg.
  const v = await loadVoiceWebhook({
    data: { CallLog: [outboundLog({ id: "CallLog_9", status: "in_progress" })] },
    routes: [{ match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 422, json: { errors: [{ detail: "bad number" }] } }) }],
  });
  await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_f", client_state: maskedBridgeState({ call_log_id: "CallLog_9" }), result: "human" }));
  assert.ok(v.calls.find((c) => /\/actions\/speak$/.test(c.url)), "spoke an apology to the nurse");
  assert.ok(v.calls.find((c) => /\/actions\/hangup$/.test(c.url)), "hung up instead of stranding dead air");
  assert.equal(v.data.CallLog[0].status, "failed");
});

test("a masked state without a caller id never presents the nurse's cell", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [outboundLog()] } });
  await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_nurse", client_state: maskedBridgeState({ caller_id: null }), result: "human" }));
  assert.ok(!v.calls.some((c) => /\/actions\/transfer$/.test(c.url)),
    "with no from, Telnyx would default the caller id to the nurse leg's own to — the cell");
  assert.equal(v.data.CallLog[0].status, "failed");
});

// ---- Finding: redelivered call webhooks ----
test("a redelivered call event never repeats its Call Control commands or their fallback", async () => {
  // Telnyx would refuse the repeat of a transfer for a leg already connecting;
  // the old handler answered that refusal with an apology and a hangup.
  let transfers = 0;
  const v = await loadVoiceWebhook({
    data: { CallLog: [outboundLog({ status: "in_progress" })] },
    routes: [{ match: (u) => u.includes("/actions/transfer"), respond: () => (++transfers === 1
      ? { status: 200, json: { data: {} } }
      : { status: 422, json: { errors: [{ detail: "call is not in a state to transfer" }] } }) }],
  });
  const event = voiceEvent("call.machine.detection.ended", { call_control_id: "cc_nurse", client_state: maskedBridgeState(), result: "human" }, "evt-redelivered-1");
  assert.equal((await (await v.send(event)).json()).bridged, true);
  const repeat = await v.send(event);
  assert.equal(repeat.status, 200, "a repeat is acknowledged, so Telnyx stops redelivering it");
  assert.equal((await repeat.json()).deduped, true);
  assert.equal(transfers, 1, "the transfer was sent once");
  assert.ok(!v.calls.some((c) => /\/actions\/(?:speak|hangup)$/.test(c.url)), "no apology, no hangup of the connecting call");
  assert.notEqual(v.data.CallLog[0].status, "failed");

  // Two deliveries racing each other: exactly one acts.
  const raced = voiceEvent("call.answered", {
    call_control_id: "cc_caller", direction: "incoming",
    client_state: b64json({ t: "inbound_ivr", action: "ringdown", greeting: "", to: null, callerId: "+12155550100", targets: ringdownTargets }),
  }, "evt-raced-1");
  const race = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] }, claimBarrier: 3 });
  await Promise.all([race.send(raced), race.send(raced), race.send(raced)]);
  assert.equal(race.calls.filter((c) => /\/cc_caller\/actions\/transfer$/.test(c.url)).length, 1);
  const claims = race.data.UserActivity.filter((row) => row.entity_type === "TelnyxCallEvent" && row.entity_id === "evt-raced-1");
  assert.ok(claims.length >= 1);
  for (const row of claims) {
    assert.deepEqual(Object.keys(row.details).sort(), ["claim", "event_type"], "a claim records the event and nothing about the call");
  }
});

test("an unprovable claim acts on nothing, and an event without an id sends nothing", async () => {
  const down = await loadVoiceWebhook({ data: { CallLog: [outboundLog()] }, failClaimReads: true });
  const res = await down.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_nurse", client_state: maskedBridgeState(), result: "human" }));
  assert.equal(res.status, 503, "Telnyx redelivers once the store answers");
  assert.equal(actionsOf(down.calls).length, 0);

  const v = await loadVoiceWebhook({ data: { CallLog: [outboundLog()] } });
  const anonymous = { data: { event_type: "call.machine.detection.ended", payload: { call_control_id: "cc_nurse", client_state: maskedBridgeState(), result: "human" } } };
  assert.equal((await (await v.send(anonymous)).json()).skipped, "no event id");
  assert.equal(actionsOf(v.calls).length, 0);
});

test("every Call Control command carries a deterministic, per-command command_id", async () => {
  // Both targets are refused, so one event sends transfer, transfer, speak, hangup.
  const event = voiceEvent("call.answered", {
    call_control_id: "cc_caller", direction: "incoming",
    client_state: b64json({ t: "inbound_ivr", action: "ringdown", greeting: "", to: null, callerId: "+12155550100",
      targets: [{ to: "+12155550111", kind: "primary" }, { to: "+17244650440", kind: "office" }] }),
  }, "evt-command-ids-1");
  const run = async () => {
    const v = await loadVoiceWebhook({
      data: { CallLog: [inboundLog()] },
      routes: [{ match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 422, json: {} }) }],
    });
    await v.send(event);
    return actionsOf(v.calls).map((c) => ({ command: c.url.split("/").pop(), id: c.body.command_id }));
  };
  const first = await run();
  assert.deepEqual(first.map((c) => c.command), ["transfer", "transfer", "speak", "hangup"]);
  for (const { id } of first) assert.match(id, UUID_SHAPE);
  assert.equal(new Set(first.map((c) => c.id)).size, first.length, "two transfers in one event never share an id");
  assert.deepEqual(await run(), first, "the same event always derives the same ids");

  // And the event-scoped sender is the only way to reach the gated wrapper.
  const source = await readFile(new URL("../functions/handleTelnyxStatusWebhook/entry.ts", import.meta.url), "utf8");
  const direct = source.split("\n").filter((line) => /\bcallCommand\(/.test(line) && !/async function callCommand\(/.test(line));
  assert.deepEqual(direct.map((line) => line.trim()), ["return callCommand(apiKey, callControlId, command, body);"]);
});

// ---- Inbound IVR ----
test("inbound call answers first, then bridges an on-duty nurse on call.answered", async () => {
  const data = () => ({
    User: [{ email: "n@x.com", work_phone_number: "+12155550100", personal_cell_e164: "+12155550111", duty_status: "on_duty" }],
    // Disable the 5pm auto-off so this bridge assertion is time-independent.
    AgencySettings: [{ auto_off_duty_enabled: false }], CallLog: [],
  });
  // Step 1: call.initiated (incoming) must ANSWER first (not transfer on a
  // ringing leg), carrying the bridge decision in client_state.
  const v1 = await loadVoiceWebhook({ data: data() });
  await v1.send(voiceEvent("call.initiated", { call_control_id: "cc_in", direction: "incoming", from: "+13125550182", to: "+12155550100" }));
  const answer = v1.calls.find((c) => /\/actions\/answer$/.test(c.url));
  assert.ok(answer, "answered the inbound call first");
  const carried = decodeState(answer.body.client_state);
  assert.equal(carried.action, "ringdown");
  assert.equal(carried.targets[0].to, "+12155550111", "first ringdown target = nurse cell");

  // Step 2: call.answered with that client_state rings the first target.
  const v2 = await loadVoiceWebhook({ data: data() });
  await v2.send(voiceEvent("call.answered", { call_control_id: "cc_in", direction: "incoming", client_state: b64json({ t: "inbound_ivr", action: "ringdown", greeting: "", to: carried.to, callerId: carried.callerId, targets: carried.targets }) }));
  const transfer = v2.calls.find((c) => /\/v2\/calls\/cc_in\/actions\/transfer$/.test(c.url));
  assert.ok(transfer, "rang the first target on answer");
  assert.equal(transfer.body.to, "+12155550111");
  assert.equal(transfer.body.from, "+12155550100");
  // The ringdown state reaches the new leg (target_leg_client_state) so an
  // unanswered hangup can advance, and a personal cell is screened.
  const legState = decodeState(transfer.body.target_leg_client_state);
  assert.equal(legState.t, "ringdown");
  assert.equal(legState.a_leg, "cc_in");
  assert.equal(transfer.body.answering_machine_detection, "detect");
  assert.equal(transfer.body.answering_machine_detection_config.total_analysis_time_millis, 5000);
});

test("an after-hours/weekend inbound call greets and transfers to the NORMALIZED after-hours number", async () => {
  const v = await loadVoiceWebhook({
    data: {
      User: [{ email: "n@x.com", work_phone_number: "+12155550100", personal_cell_e164: "+12155550111", duty_status: "on_duty" }],
      // Business hours ON with no open days = closed all week (nights/weekends).
      // The transfer number is stored FORMATTED — routing must normalize it.
      AgencySettings: [{
        business_hours_enabled: true, business_hours: {},
        after_hours_call_action: "transfer",
        after_hours_transfer_number_e164: "(724) 465-0440",
      }],
      CallLog: [],
    },
  });
  await v.send(voiceEvent("call.initiated", { call_control_id: "cc_ah", direction: "incoming", from: "+13125550182", to: "+12155550100" }));
  const answer = v.calls.find((c) => /\/actions\/answer$/.test(c.url));
  assert.ok(answer, "answered the after-hours call (to speak the greeting)");
  const carried = decodeState(answer.body.client_state);
  assert.equal(carried.action, "greet_transfer", "after-hours calls greet then transfer");
  assert.equal(carried.to, "+17244650440", "transfer target is normalized E.164, not the raw formatted string");

  // The greeting ends → the transfer presents the dialed work number and is
  // never screened (an office phone tree is a legitimate answer).
  await v.send(voiceEvent("call.speak.ended", { call_control_id: "cc_ah", client_state: b64json({ t: "inbound_after_greet", action: carried.action, to: carried.to, callerId: carried.callerId, targets: null }) }));
  const transfer = v.calls.find((c) => /\/cc_ah\/actions\/transfer$/.test(c.url));
  assert.equal(transfer.body.to, "+17244650440");
  assert.equal(transfer.body.from, "+12155550100");
  assert.equal(transfer.body.answering_machine_detection, undefined);
});

test("a rejected ringdown transfer advances to the next target instead of stranding the caller", async () => {
  let transferCalls = 0;
  const v = await loadVoiceWebhook({
    // First target is rejected outright (e.g. bad number); the next succeeds.
    routes: [{ match: (u) => u.includes("/actions/transfer"), respond: () => (++transferCalls === 1
      ? { status: 422, json: { errors: [{ detail: "invalid destination" }] } }
      : { status: 200, json: { data: {} } }) }],
  });
  await v.send(voiceEvent("call.answered", {
    call_control_id: "cc_rd", direction: "incoming",
    client_state: b64json({ t: "inbound_ivr", action: "ringdown", greeting: "", to: null, callerId: "+12155550100",
      targets: [{ to: "724-465", kind: "primary" }, { to: "+17244650440", kind: "office" }] }),
  }));
  const transfers = v.calls.filter((c) => /\/actions\/transfer$/.test(c.url));
  assert.equal(transfers.length, 2, "retried the next target after the rejection");
  assert.equal(transfers[1].body.to, "+17244650440", "second attempt rings the next ringdown target");
  assert.ok(!v.calls.some((c) => /\/actions\/hangup$/.test(c.url)), "caller was not hung up — the second target is ringing");
});

test("find-me-follow-me rolls to the next target when a leg goes unanswered", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  // The dialed leg (target 0 = nurse cell) hangs up unanswered; a_leg is the caller.
  await v.send(voiceEvent("call.hangup", { call_control_id: "cc_leg0", client_state: ringdownLegState(), hangup_cause: "no_answer", hangup_source: "callee" }));
  // It must transfer the ORIGINAL caller leg to the next target (the backup nurse).
  const next = v.calls.find((c) => /\/v2\/calls\/cc_caller\/actions\/transfer$/.test(c.url));
  assert.ok(next, "rolled to the next target on the caller leg");
  assert.equal(next.body.to, "+12155550122");
  assert.equal(decodeState(next.body.target_leg_client_state).idx, 1);
  // A ringing leg that times out (dial timeout) also advances.
  await v.send(voiceEvent("call.hangup", { call_control_id: "cc_leg1", client_state: ringdownLegState({ idx: 1 }), hangup_cause: "timeout", hangup_source: "unknown" }));
  const office = v.calls.filter((c) => /\/cc_caller\/actions\/transfer$/.test(c.url))[1];
  assert.equal(office.body.to, "+17244650440");
  assert.equal(office.body.answering_machine_detection, undefined, "the office line is never screened");
  // The ringdown state on the CALLER leg (client_state is "every subsequent
  // webhook") never advances anything: a_leg tells it apart.
  await v.send(voiceEvent("call.hangup", { call_control_id: "cc_caller", client_state: ringdownLegState({ idx: 2 }), hangup_cause: "no_answer" }));
  assert.equal(v.calls.filter((c) => /\/actions\/transfer$/.test(c.url)).length, 2);
});

// ---- Finding: answering-machine detection on ringdown legs ----
test("a nurse's voicemail answering a ringdown leg moves the caller on", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  // A person or not_sure stays connected.
  for (const result of ["human", "not_sure"]) {
    await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_leg0", client_state: ringdownLegState(), result }));
  }
  assert.equal(actionsOf(v.calls).length, 0);
  // The primary's voicemail answered: transfer the CALLER leg to the backup.
  await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_leg0", client_state: ringdownLegState(), result: "machine" }));
  const moved = actionsOf(v.calls);
  assert.deepEqual(moved.map((c) => c.url), ["https://api.telnyx.com/v2/calls/cc_caller/actions/transfer"],
    "the voicemail leg is not hung up directly: hanging up a bridged leg would hang up the caller");
  assert.equal(moved[0].body.to, "+12155550122");
  assert.equal(moved[0].body.answering_machine_detection, "detect");
  // ...and its trailing normal hangup does not advance a second time.
  await v.send(voiceEvent("call.hangup", { call_control_id: "cc_leg0", client_state: ringdownLegState(), hangup_cause: "normal_clearing" }));
  assert.equal(actionsOf(v.calls).length, 1);
  // The last screened target's voicemail with nothing after it ends the call as missed.
  const lone = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  await lone.send(voiceEvent("call.machine.detection.ended", {
    call_control_id: "cc_only", result: "machine",
    client_state: ringdownLegState({ targets: [{ to: "+12155550111", kind: "primary" }] }),
  }));
  assert.deepEqual(actionsOf(lone.calls).map((c) => c.url), ["https://api.telnyx.com/v2/calls/cc_caller/actions/hangup"]);
  assert.equal(lone.data.CallLog[0].status, "failed");
  // A machine verdict on the office leg is never acted on.
  const office = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  await office.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_leg2", client_state: ringdownLegState({ idx: 2 }), result: "machine" }));
  assert.equal(actionsOf(office.calls).length, 0);
});

test("a refused onward transfer from a voicemail leaves the caller there rather than hanging up", async () => {
  const v = await loadVoiceWebhook({
    data: { CallLog: [inboundLog()] },
    routes: [{ match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 422, json: {} }) }],
  });
  await v.send(voiceEvent("call.machine.detection.ended", { call_control_id: "cc_leg0", client_state: ringdownLegState(), result: "machine" }));
  assert.ok(!v.calls.some((c) => /\/actions\/(?:speak|hangup)$/.test(c.url)));
});

// ---- Finding: caller hang-up during ringdown ----
test("a caller who hangs up during the ringdown stops it and is logged missed", async () => {
  // The caller hung up while the primary's cell rang: Telnyx cancels that leg.
  const v = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  const res = await v.send(voiceEvent("call.hangup", { call_control_id: "cc_leg0", client_state: ringdownLegState(), hangup_cause: "originator_cancel", hangup_source: "caller" }));
  assert.equal((await res.json()).ringdown_abandoned, true);
  assert.equal(actionsOf(v.calls).length, 0, "no transfer of a dead caller leg to the remaining targets");
  assert.equal(v.data.CallLog[0].status, "failed");
  assert.equal(v.data.CallLog[0].failure_reason, "Caller hung up before anyone answered");

  // The caller leg's own hangup arrived first (generic → completed); a later
  // unanswered dialed leg still stops and turns it into a missed call.
  const w = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  await w.send(voiceEvent("call.hangup", { call_control_id: "cc_caller", client_state: ringdownLegState(), hangup_cause: "normal_clearing", hangup_source: "caller" }));
  assert.equal(w.data.CallLog[0].status, "completed");
  await w.send(voiceEvent("call.hangup", { call_control_id: "cc_leg0", client_state: ringdownLegState(), hangup_cause: "no_answer", hangup_source: "callee" }));
  assert.equal(actionsOf(w.calls).length, 0);
  assert.equal(w.data.CallLog[0].status, "failed");

  // A cancel that does not name the caller keeps ringing a caller who is still there.
  const x = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  await x.send(voiceEvent("call.hangup", { call_control_id: "cc_leg0", client_state: ringdownLegState(), hangup_cause: "originator_cancel", hangup_source: "unknown" }));
  assert.equal(x.calls.filter((c) => /\/cc_caller\/actions\/transfer$/.test(c.url)).length, 1);
});

test("a caller who hangs up during the greeting is not transferred, and an apology never re-runs it", async () => {
  const greeted = b64json({ t: "inbound_after_greet", action: "greet_transfer", to: "+17244650440", callerId: "+12155550100", targets: null });
  const v = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  await v.send(voiceEvent("call.speak.ended", { call_control_id: "cc_caller", client_state: greeted, status: "call_hangup" }));
  assert.equal(actionsOf(v.calls).length, 0, "no transfer of a caller who already hung up");
  assert.equal(v.data.CallLog[0].failure_reason, "Caller hung up before anyone answered");

  // A refused transfer apologizes with a state of its own, so that speak's
  // call.speak.ended cannot be read as the greeting's and transfer again.
  const w = await loadVoiceWebhook({
    data: { CallLog: [inboundLog()] },
    routes: [{ match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 422, json: {} }) }],
  });
  await w.send(voiceEvent("call.speak.ended", { call_control_id: "cc_caller", client_state: greeted, status: "completed" }));
  const apology = w.calls.find((c) => /\/actions\/speak$/.test(c.url));
  assert.deepEqual(decodeState(apology.body.client_state), { t: "call_ending" });
  const sent = actionsOf(w.calls).length;
  await w.send(voiceEvent("call.speak.ended", { call_control_id: "cc_caller", client_state: apology.body.client_state, status: "completed" }));
  assert.equal(actionsOf(w.calls).length, sent);
});

// ---- Finding: caller id fallback ----
test("an onward leg presents the dialed number, never the destination", async () => {
  const lostState = b64json({ t: "inbound_ivr", action: "ringdown", greeting: "", to: null, callerId: null, targets: ringdownTargets });
  // The state lost its caller id: the caller leg's logged dialed number is used.
  const v = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  await v.send(voiceEvent("call.answered", { call_control_id: "cc_caller", direction: "incoming", client_state: lostState }));
  const transfer = v.calls.find((c) => /\/actions\/transfer$/.test(c.url));
  assert.equal(transfer.body.from, "+12155550100");
  assert.equal(decodeState(transfer.body.target_leg_client_state).callerId, "+12155550100", "later legs carry it");
  // Nothing to fall back on: `from` is omitted, which TransferCallRequest defaults
  // to the original call's `to` — the number the patient dialed.
  const w = await loadVoiceWebhook({ data: { CallLog: [] } });
  await w.send(voiceEvent("call.answered", { call_control_id: "cc_caller", direction: "incoming", client_state: lostState }));
  const bare = w.calls.find((c) => /\/actions\/transfer$/.test(c.url));
  assert.equal(Object.hasOwn(bare.body, "from"), false);
  // Same for a greet-then-transfer.
  const g = await loadVoiceWebhook({ data: { CallLog: [inboundLog()] } });
  await g.send(voiceEvent("call.speak.ended", { call_control_id: "cc_caller", client_state: b64json({ t: "inbound_after_greet", action: "greet_transfer", to: "+17244650440", callerId: null, targets: null }) }));
  const greeted = g.calls.find((c) => /\/actions\/transfer$/.test(c.url));
  assert.equal(greeted.body.from, "+12155550100");
  for (const call of [...v.calls, ...w.calls, ...g.calls].filter((c) => /\/actions\/transfer$/.test(c.url))) {
    assert.notEqual(call.body.from, call.body.to, "the destination is never presented as the caller");
  }
});

// ---- Finding: the masked call's patient leg ----
test("patient-leg events never re-enter the bridge, and an unanswered patient ends the nurse leg", async () => {
  const patientLeg = b64json({ t: "masked_patient_leg", call_log_id: "CallLog_1", nurse_leg: "cc_nurse" });
  const v = await loadVoiceWebhook({ data: { CallLog: [outboundLog({ status: "in_progress" })] } });
  for (const eventType of ["call.initiated", "call.answered", "call.bridged", "call.machine.detection.ended"]) {
    await v.send(voiceEvent(eventType, { call_control_id: "cc_patient", direction: "outgoing", client_state: patientLeg, result: "human" }));
  }
  // The nurse leg itself carrying the patient-leg state is only a status update.
  await v.send(voiceEvent("call.hangup", { call_control_id: "cc_nurse", client_state: patientLeg, hangup_cause: "no_answer" }));
  assert.equal(actionsOf(v.calls).length, 0, "no event of either leg re-bridges or hangs anything up");

  const w = await loadVoiceWebhook({ data: { CallLog: [outboundLog({ status: "in_progress" })] } });
  await w.send(voiceEvent("call.hangup", { call_control_id: "cc_patient", client_state: patientLeg, hangup_cause: "no_answer", hangup_source: "callee" }));
  assert.deepEqual(actionsOf(w.calls).map((c) => c.url), [
    "https://api.telnyx.com/v2/calls/cc_nurse/actions/speak",
    "https://api.telnyx.com/v2/calls/cc_nurse/actions/hangup",
  ], "the nurse is told and their leg ended rather than left on dead air");
  assert.equal(w.data.CallLog[0].status, "failed");
  assert.equal(w.data.CallLog[0].failure_reason, "Patient did not answer (no_answer)");
});

// ---- Finding: voicemail links expire ----
const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x64]);
const RECORDING_URL = "https://s3.amazonaws.com/telephony-recorder-prod/rec-1.mp3?X-Amz-Signature=abc";
const voicemailState = b64json({ t: "voicemail", a_leg: "cc_vm" });
const voicemailLog = (overrides = {}) => inboundLog({ id: "CallLog_vm", provider_call_id: "cc_vm", nurse_email: "n@x.com", ...overrides });
const recordingSaved = (urls, extra = {}) => voiceEvent("call.recording.saved", {
  call_leg_id: "leg-vm", client_state: voicemailState,
  recording_started_at: "2026-10-09T12:00:00.000Z", recording_ended_at: "2026-10-09T12:00:42.000Z",
  channels: "single", recording_urls: urls, ...extra,
});

test("a voicemail is copied into private storage and the row keeps the private reference", async () => {
  const v = await loadVoiceWebhook({
    data: { CallLog: [voicemailLog()] },
    binary: (url) => (url === RECORDING_URL ? new Response(MP3_BYTES, { status: 200, headers: { "content-type": "audio/mpeg" } }) : null),
  });
  // call.recording.saved carries no call_control_id: the caller leg comes from
  // the record_start state.
  await v.send(recordingSaved({ mp3: RECORDING_URL, wav: null }, { public_recording_urls: { mp3: "https://public.example/rec.mp3" } }));
  const download = v.calls.find((c) => c.url === RECORDING_URL);
  assert.ok(download, "downloaded the ten-minute link");
  assert.equal(download.init.redirect, "error", "a redirect cannot take the download off the allowed host");
  assert.equal(v.uploads.length, 1);
  assert.equal(v.uploads[0].type, "audio/mpeg");
  assert.deepEqual([...v.uploads[0].bytes], [...MP3_BYTES]);
  const row = v.data.CallLog[0];
  assert.equal(row.voicemail_url, "private/voicemail/1.mp3");
  assert.equal(row.has_voicemail, true);
  assert.equal(row.voicemail_duration_seconds, 42);
  assert.ok(!v.calls.some((c) => c.url.includes("public.example")), "the unauthenticated permanent link is never used");
  assert.equal(v.data.Notification.length, 1);
  // A redelivery stores nothing twice and notifies nobody twice.
  const again = recordingSaved({ mp3: RECORDING_URL });
  again.data.id = "evt-vm-again";
  await v.send(again);
  await v.send(again);
  assert.equal(v.uploads.length, 2, "a distinct event is a distinct recording");
  assert.equal(v.data.Notification.length, 1);
});

test("a voicemail that cannot be copied keeps the provider link and logs only a category", async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const cases = [
      ["host_refused", { mp3: "https://example.com/recording.mp3" }, null],
      ["host_refused", { mp3: "http://s3.amazonaws.com/rec.mp3" }, null],
      ["download_rejected", { mp3: RECORDING_URL }, () => new Response("denied", { status: 403 })],
      ["download_too_large", { mp3: RECORDING_URL }, () => new Response(MP3_BYTES, { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } })],
      ["download_too_large", { mp3: RECORDING_URL }, () => new Response(new ReadableStream({
        start(controller) { for (let i = 0; i < 11; i += 1) controller.enqueue(new Uint8Array(1024 * 1024).fill(0xff)); controller.close(); },
      }), { status: 200 })],
      ["not_audio", { mp3: RECORDING_URL }, () => new Response("<html>error</html>", { status: 200 })],
    ];
    for (const [reason, urls, answer] of cases) {
      errors.length = 0;
      const v = await loadVoiceWebhook({ data: { CallLog: [voicemailLog()] }, binary: (url) => (answer && url.startsWith("https://s3.amazonaws.com/") ? answer() : null) });
      await v.send(recordingSaved(urls));
      assert.equal(v.uploads.length, 0, reason);
      assert.equal(v.data.CallLog[0].voicemail_url, urls.mp3, `${reason}: the provider link is kept as before`);
      assert.deepEqual(errors, [`Voicemail recording kept at the provider link: ${reason}`]);
      if (reason === "host_refused") assert.ok(!v.calls.some((c) => c.url === urls.mp3), "a refused host is never fetched");
    }
  } finally {
    console.error = original;
  }
});

test("the voicemail copy stays inside the webhook timeout and keeps the provider link past it", async () => {
  // The Voice API app retries a webhook it has no answer to after 10 s, so the
  // whole copy shares one budget well short of that.
  const source = await readFile(new URL("../functions/handleTelnyxStatusWebhook/entry.ts", import.meta.url), "utf8");
  const budget = Number(source.match(/const VOICEMAIL_COPY_BUDGET_MS = (\d+);/)?.[1]);
  assert.ok(budget > 0 && budget <= 6000, `copy budget ${budget} ms leaves the claim and the writes inside 10 s`);

  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    // A download that never finishes is abandoned at the budget.
    const slowDownload = await loadVoiceWebhook({
      data: { CallLog: [voicemailLog()] }, copyBudgetMs: 150,
      binary: (url, init) => (url === RECORDING_URL ? new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }) : null),
    });
    let started = Date.now();
    assert.equal((await slowDownload.send(recordingSaved({ mp3: RECORDING_URL }))).status, 200);
    assert.ok(Date.now() - started < 2000, "answered without waiting out the download");
    assert.equal(slowDownload.data.CallLog[0].voicemail_url, RECORDING_URL);
    assert.deepEqual(errors, ["Voicemail recording kept at the provider link: budget_exhausted"]);

    // An upload that never answers is abandoned too.
    errors.length = 0;
    const slowUpload = await loadVoiceWebhook({
      data: { CallLog: [voicemailLog()] }, copyBudgetMs: 150, uploadHangs: true,
      binary: (url) => (url === RECORDING_URL ? new Response(MP3_BYTES, { status: 200 }) : null),
    });
    started = Date.now();
    assert.equal((await slowUpload.send(recordingSaved({ mp3: RECORDING_URL }))).status, 200);
    assert.ok(Date.now() - started < 2000, "answered without waiting out the upload");
    assert.equal(slowUpload.data.CallLog[0].voicemail_url, RECORDING_URL);
    assert.equal(slowUpload.data.CallLog[0].has_voicemail, true);
    assert.deepEqual(errors, ["Voicemail recording kept at the provider link: budget_exhausted"]);
  } finally {
    console.error = original;
  }
});

test("a recording offered only as a public link is never stored or fetched", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [voicemailLog()] } });
  await v.send(recordingSaved(null, { public_recording_urls: { mp3: "https://s3.amazonaws.com/public/rec.mp3" } }));
  assert.equal(v.data.CallLog[0].voicemail_url ?? null, null);
  assert.equal(v.uploads.length, 0);
  assert.ok(!v.calls.some((c) => c.url.includes("/public/")));
});

test("the voicemail recorder tells call.recording.saved which call it belongs to", async () => {
  const v = await loadVoiceWebhook({ data: { CallLog: [voicemailLog()] } });
  await v.send(voiceEvent("call.speak.ended", { call_control_id: "cc_vm", client_state: b64json({ t: "inbound_after_greet", action: "voicemail", to: null, callerId: null, targets: null }) }));
  const record = v.calls.find((c) => /\/cc_vm\/actions\/record_start$/.test(c.url));
  assert.deepEqual(decodeState(record.body.client_state), { t: "voicemail", a_leg: "cc_vm" });
  assert.equal(record.body.play_beep, true);
});

test("sendSms forwards MMS media_urls and rejects non-https/oversized media", async () => {
  const mk = () => makeBase44({ user: {
    email: "n@x.com", role: "admin", full_name: "Nora",
    work_phone_number: "+12155550100", personal_cell_e164: "+12155550111",
  }, data: {
    IntegrationSecret: [activeTelnyxSecret({ messaging_profile_id: "MP1" })],
    TelecomDestinationBinding: [smsBinding()],
    AgencySettings: [{ tcpa_quiet_hours_enabled: false, sms_enabled: true }],
    SmsConsent: [scopedSmsConsent()],
  } });
  // Happy path: media_urls forwarded to Telnyx.
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "m", to: [{ status: "queued" }] } } }) },
  ]);
  const handler = await loadHandler("../functions/sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", SUPER_ADMIN_EMAIL: "n@x.com" }, makeClient: mk, fetchImpl: impl,
  });
  await handler(new Request("https://app/functions/sendSms", { method: "POST", body: JSON.stringify({ to_number: "2155550133", body: "see attached", media_urls: ["https://files/x.jpg"] }) }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/messages");
  assert.deepEqual(call.body.media_urls, ["https://files/x.jpg"]);

  // Validation: a non-https URL is rejected before any send.
  const { impl: impl2, calls: calls2 } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "m" } } }) },
  ]);
  const handler2 = await loadHandler("../functions/sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", SUPER_ADMIN_EMAIL: "n@x.com" }, makeClient: mk, fetchImpl: impl2,
  });
  const res = await handler2(new Request("https://app/functions/sendSms", { method: "POST", body: JSON.stringify({ to_number: "2155550133", body: "x", media_urls: ["http://insecure/x.jpg"] }) }));
  assert.equal(res.status, 400);
  assert.equal(calls2.length, 0, "no send attempted for invalid media");
});

test("an inbound text to an off-duty nurse gets the off-duty auto-reply", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "reply_1" } } }) },
  ]);
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_PUBLIC_KEY: pubB64 },
    // Inbound texts route through the receiving line's binding and the line's
    // service-written PhoneNumber assignment to an active member of that
    // agency (released 2026-10-08) — not through User.work_phone_number.
    makeClient: () => makeBase44({
      data: {
        IntegrationSecret: [activeTelnyxSecret({ public_key: pubB64, messaging_profile_id: "MP1" })],
        TelecomDestinationBinding: [smsBinding()],
        PhoneNumber: [{ id: "phone_number_1", e164: "+12155550100", status: "assigned", assigned_to_email: "n@x.com" }],
        AgencyMembership: [{ id: "m1", agency_id: "agency_a", user_id: "u1", user_email_normalized: "n@x.com", tenant_role: "clinician", status: "active" }],
        // Nurse with no duty_status → default OFF until they toggle on.
        User: [{ id: "u1", email: "n@x.com" }],
        AgencySettings: [{ main_office_number_e164: "724-465-0440" }],
        SmsConsent: [], Patient: [],
      },
    }),
    fetchImpl: impl,
  });
  await handler(signedWebhook(privateKey, { data: { event_type: "message.received", payload: { id: "in_1", from: { phone_number: "+13125550182" }, to: [{ phone_number: "+12155550100" }], messaging_profile_id: "MP1", text: "are you available?" } } }));
  const reply = calls.find((c) => c.url === "https://api.telnyx.com/v2/messages");
  assert.ok(reply, "sent an auto-reply");
  assert.equal(reply.body.from, "+12155550100", "reply comes from the work number");
  assert.equal(reply.body.to, "+13125550182");
  assert.match(reply.body.text, /currently not working/i);
  assert.match(reply.body.text, /724-465-0440/);
});

test("handleTelnyxStatusWebhook rejects a tampered signature (fail-closed)", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const rawBody = JSON.stringify({ data: { event_type: "message.received", payload: {} } });
  const timestamp = String(Math.floor(Date.now() / 1000));

  const { impl } = makeFetch([]);
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_PUBLIC_KEY: pubB64 },
    makeClient: () => makeBase44({ data: { IntegrationSecret: [activeTelnyxSecret({ api_key: undefined, public_key: pubB64 })] } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/handleTelnyxStatusWebhook", {
    method: "POST",
    headers: { "telnyx-signature-ed25519": Buffer.from("not-a-real-signature-of-the-right-length-aaaaaaaaaaaaaaaaaaaaaaaaaaaa").toString("base64"), "telnyx-timestamp": timestamp, "content-type": "application/json" },
    body: rawBody,
  }));
  assert.equal(res.status, 401, "a bad signature is rejected");
});


test('automatic retry rejection hands final failure to poller without reopening a started publication', async () => {
  for (const publication of [null, 'started']) {
    const state = {
      IntegrationSecret: [activeTelnyxSecret()],
      Agency: [{ id: 'agency_a', agency_code: 'AGENCY-A', status: 'active' }],
      AgencyMembership: [activeFaxSenderMembership()],
      FaxRetryConfig: [{ agency_id: 'agency_a', max_retries: 1, retry_delay_minutes: 15 }],
      Notification: [],
      FaxLog: [outboundFax({
        status: 'failed', provider_terminal_status: 'failed',
        provider_terminal_at: '2026-09-06T12:05:00.000Z',
        document_binding_id: 'binding_a', document_binding_version: 2,
        document_content_sha256: 'a'.repeat(64),
        sender_telecom_binding_id: 'sender_a', sender_telecom_binding_version: 2,
        sender_provider_number_id: 'provider_number_a',
        next_retry_at: '2020-01-01T00:00:00.000Z', retry_count: 1, retry_submission_state: 'ready',
        failure_notify_publication_state: publication,
      })],
    };
    const client = makeSpyBase44({ data: state });
    client.asServiceRole.functions = { invoke: async (name) => {
      assert.equal(name, 'sendBatchFax');
      state.FaxLog.push(outboundFax({ id: 'FaxLog_child', status: 'failed',
        retry_of_fax_log_id: 'FaxLog_1', retry_generation: 1, retry_count: 1,
        provider_submission_state: 'rejected', telnyx_fax_id: null,
      }));
      return { data: { success: true, total: 1, retry_source_fax_log_id: 'FaxLog_1',
        retry_generation: 1, accepted: 0, failed: 1, unknown: 0 } };
    } };
    const retry = await loadHandler('../functions/autoRetryFailedFaxes/entry.ts', {
      env: { WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES: 'enabled-v1',
        INTERNAL_FN_SECRET: 'fax-rejection-regression-secret-32-bytes-minimum' },
      makeClient: () => client, fetchImpl: makeFetch([]).impl,
    });
    const rejection = await retry(new Request('https://app/functions/autoRetryFailedFaxes'));
    assert.equal(rejection.status, 200);
    assert.equal((await rejection.json()).provider_rejected, 1);
    assert.equal(state.FaxLog[0].next_retry_at, null);
    assert.equal(state.FaxLog[0].failure_notify_publication_state, publication || 'ready');
    const poll = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => client, fetchImpl: makeFetch([]).impl,
    });
    const response = await poll(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(response.status, publication ? 503 : 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).recovery_failures, publication ? 1 : 0);
    assert.equal(state.Notification.length, publication ? 0 : 1);
    assert.equal(state.FaxLog[0].final_failure_notified, !publication);
    assert.equal(state.FaxLog[1].notification_recovery_quarantined_at, undefined);
  }
});

test('rejected retry children cannot starve an accepted terminal notification', async () => {
  const state = { IntegrationSecret: [activeTelnyxSecret()],
    AgencyMembership: [activeFaxSenderMembership()], Notification: [],
    FaxLog: Array.from({ length: 25 }, (_, index) => outboundFax({
      id: `rejected_${index}`, status: 'failed', retry_of_fax_log_id: 'source',
      provider_submission_state: 'rejected', telnyx_fax_id: null,
    })),
  };
  state.FaxLog.push(outboundFax({ status: 'failed', provider_terminal_status: 'failed',
    provider_terminal_at: '2026-09-06T12:05:00.000Z', failure_notify_publication_state: 'ready',
    updated_date: '2026-09-06T12:10:00.000Z',
  }));
  const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
    env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state }),
    fetchImpl: makeFetch([]).impl,
  });
  const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(state.Notification.length, 1);
  assert.equal(state.FaxLog.at(-1).final_failure_notified, true);
});

test('all unresolved stale retry recovery outcomes degrade the polling run', async () => {
  for (const failure of ['reservation', 'source', 'read', 'ambiguous', 'child', 'release']) {
    const source = outboundFax({ status: 'retrying', provider_terminal_status: 'failed',
      provider_terminal_at: '2026-09-06T12:05:00.000Z', retry_count: 1,
      retry_claimed_by: 'retry_claim', retry_claimed_by_user_id: 'user_a',
      retry_claimed_at: '2020-01-01T00:00:00.000Z', final_failure_notified: true,
    });
    if (failure === 'source') source.retry_claimed_by_user_id = null;
    const child = outboundFax({ id: 'retry_child', status: 'failed',
      retry_of_fax_log_id: source.id, retry_generation: 1, retry_count: 1,
      provider_submission_state: 'rejected', telnyx_fax_id: null,
    });
    if (failure === 'child') child.agency_id = 'foreign_agency';
    const state = { IntegrationSecret: [activeTelnyxSecret()], FaxLog: [source, child], Notification: [] };
    if (failure === 'ambiguous') state.FaxLog.push({ ...child, id: 'second_child' });
    const client = makeSpyBase44({ data: state });
    const originalUpdate = client.asServiceRole.entities.FaxLog.updateMany;
    client.asServiceRole.entities.FaxLog.updateMany = async (query, patch) => {
      if ((failure === 'reservation' && patch.$set?.retry_recovery_last_attempt_at)
        || (failure === 'release' && query.retry_claimed_by)) return null;
      return originalUpdate(query, patch);
    };
    const originalFilter = client.asServiceRole.entities.FaxLog.filter;
    client.asServiceRole.entities.FaxLog.filter = async (query, ...args) => {
      if (failure === 'read' && query.retry_of_fax_log_id) throw new Error('read failed');
      return originalFilter(query, ...args);
    };
    const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => client, fetchImpl: makeFetch([]).impl,
    });
    const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(response.status, 503, failure);
    assert.equal((await response.json()).recovery_failures, 1, failure);
    assert.equal(state.FaxLog[0].status, 'retrying', failure);
    assert.equal(state.Notification.length, 0, failure);
  }
});


test('terminal notification recovery leaves scheduled retries to the retry queue', async () => {
  const pending = Array.from({ length: 25 }, (_, index) => outboundFax({
    id: `pending_retry_${index}`, telnyx_fax_id: `pending_provider_${index}`,
    status: 'failed', provider_terminal_status: 'failed',
    provider_terminal_at: '2026-09-06T12:05:00.000Z',
    next_retry_at: index % 2 ? '2020-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z',
  }));
  const state = { IntegrationSecret: [activeTelnyxSecret()],
    AgencyMembership: [activeFaxSenderMembership()], Notification: [],
    FaxLog: [...pending, outboundFax({ status: 'failed', provider_terminal_status: 'failed',
      provider_terminal_at: '2026-09-06T12:05:00.000Z', failure_notify_publication_state: 'ready',
      updated_date: '2026-09-06T12:10:00.000Z', next_retry_at: null,
    })],
  };
  const writes = [];
  const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
    env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state, writes }),
    fetchImpl: makeFetch([]).impl,
  });
  const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).recovery_failures, 0);
  assert.equal(state.Notification.length, 1);
  assert.equal(state.FaxLog.at(-1).final_failure_notified, true);
  assert.equal(writes.some((write) => write.query?.id?.startsWith('pending_retry_')), false);
});


test('stale rejected-child handoff preserves prior publication uncertainty', async () => {
  for (const previous of [
    { failure_notify_publication_state: 'started' },
    { failure_notify_claimed_by: 'legacy_claim', failure_notify_claimed_at: '2020-01-01T00:00:00.000Z' },
  ]) {
    const state = { IntegrationSecret: [activeTelnyxSecret()],
      FaxRetryConfig: [{ agency_id: 'agency_a', max_retries: 1 }],
    AgencyMembership: [activeFaxSenderMembership()], Notification: [],
      FaxLog: [outboundFax({ status: 'retrying', provider_terminal_status: 'failed',
        provider_terminal_at: '2026-09-06T12:05:00.000Z', retry_count: 1,
        retry_claimed_by: 'retry_claim', retry_claimed_by_user_id: 'user_a',
        retry_claimed_at: '2020-01-01T00:00:00.000Z', ...previous,
      }), outboundFax({ id: 'rejected_child', status: 'failed',
        retry_of_fax_log_id: 'FaxLog_1', retry_generation: 1, retry_count: 1,
        provider_submission_state: 'rejected', telnyx_fax_id: null,
      })],
    };
    const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state }),
      fetchImpl: makeFetch([]).impl,
    });
    const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).recovery_failures, 1);
    assert.equal(state.FaxLog[0].status, 'failed');
    assert.equal(state.FaxLog[0].failure_notify_publication_state, 'started');
    assert.equal(state.FaxLog[0].final_failure_notified, false);
    assert.equal(state.Notification.length, 0);
  }
});


test('recovered retry rejection honors disabled final-failure notifications', async () => {
  const state = { IntegrationSecret: [activeTelnyxSecret()],
    AgencyMembership: [activeFaxSenderMembership()], Notification: [],
    FaxRetryConfig: [{ agency_id: 'agency_a', max_retries: 1, notify_on_final_failure: false }],
    FaxLog: [outboundFax({ status: 'retrying', provider_terminal_status: 'failed',
      provider_terminal_at: '2026-09-06T12:05:00.000Z', retry_count: 1,
      retry_claimed_by: 'retry_claim', retry_claimed_by_user_id: 'user_a',
      retry_claimed_at: '2020-01-01T00:00:00.000Z',
    }), outboundFax({ id: 'rejected_child', status: 'failed',
      retry_of_fax_log_id: 'FaxLog_1', retry_generation: 1, retry_count: 1,
      provider_submission_state: 'rejected', telnyx_fax_id: null,
    })],
  };
  const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
    env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state }),
    fetchImpl: makeFetch([]).impl,
  });
  const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(state.FaxLog[0].status, 'failed');
  assert.equal(state.FaxLog[0].final_failure_notified, true);
  assert.equal(state.Notification.length, 0);
});


test('unknown automatic retry keeps its claim until a delayed child can be reconciled', async () => {
  const state = {
    IntegrationSecret: [activeTelnyxSecret()],
    Agency: [{ id: 'agency_a', agency_code: 'AGENCY-A', status: 'active' }],
    FaxRetryConfig: [{ agency_id: 'agency_a', max_retries: 3, retry_delay_minutes: 15 }],
    FaxLog: [outboundFax({ status: 'failed', provider_terminal_status: 'failed',
      provider_terminal_at: '2026-09-06T12:05:00.000Z', document_binding_id: 'binding_a',
      document_binding_version: 2, document_content_sha256: 'a'.repeat(64),
      sender_telecom_binding_id: 'sender_a', sender_telecom_binding_version: 2,
      sender_provider_number_id: 'provider_number_a', next_retry_at: '2020-01-01T00:00:00.000Z',
      retry_count: 2, retry_generation: 1, retry_submission_state: 'ready' })],
  };
  const client = makeSpyBase44({ data: state });
  client.asServiceRole.functions = { invoke: async () => {
    state.FaxLog[0].retry_submission_state = 'started';
    return { data: { success: true, total: 1, retry_source_fax_log_id: 'FaxLog_1', retry_generation: 2,
      accepted: 0, failed: 0, unknown: 1, requires_reconciliation: true } };
  } };
  const retry = await loadHandler('../functions/autoRetryFailedFaxes/entry.ts', {
    env: { WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES: 'enabled-v1', INTERNAL_FN_SECRET: 'fax-unknown-regression-secret-32-bytes-minimum' },
    makeClient: () => client, fetchImpl: makeFetch([]).impl,
  });
  const response = await retry(new Request('https://app/functions/autoRetryFailedFaxes'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).requires_reconciliation, 1);
  assert.equal(state.FaxLog[0].status, 'retrying');
  assert.ok(state.FaxLog[0].retry_claimed_by);
  state.FaxLog[0].retry_claimed_at = '2020-01-01T00:00:00.000Z';
  // An older rejected generation must not make the current child ambiguous.
  state.FaxLog.push(outboundFax({ id: 'prior-rejected', status: 'failed', retry_of_fax_log_id: 'FaxLog_1',
    retry_generation: 1, retry_count: 1, provider_submission_state: 'rejected', telnyx_fax_id: null }));
  state.FaxLog.push(outboundFax({ id: 'late-child', status: 'queued', retry_of_fax_log_id: 'FaxLog_1',
    retry_generation: 2, retry_count: 2, telnyx_fax_id: 'late-provider', status_poll_quarantined_at: new Date().toISOString() }));
  const poll = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
    env: pollFaxStatusesReleased, makeClient: () => client, fetchImpl: makeFetch([]).impl,
  });
  const recovered = await poll(new Request('https://app/functions/pollFaxStatuses'));
  assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
  assert.equal(state.FaxLog[0].status, 'retried');
  assert.equal(state.FaxLog[0].retry_claimed_by, null);
});

test('stale retries proven unstarted return to the queue with bounded backoff', async () => {
  for (const previousAttempts of [0, 11]) {
    const row = outboundFax({ status: 'retrying', provider_terminal_status: 'failed',
      provider_terminal_at: '2026-09-06T12:05:00.000Z', retry_count: 1, retry_generation: 0,
      retry_claimed_by: 'old-claim', retry_claimed_by_user_id: 'user_a', retry_claimed_at: '2020-01-01T00:00:00.000Z',
      retry_submission_state: 'ready', automatic_retry_queue_attempts: previousAttempts,
      final_failure_notified: true });
    const state = { IntegrationSecret: [activeTelnyxSecret()], FaxLog: [row] };
    const provider = makeFetch([]);
    const poll = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state }), fetchImpl: provider.impl,
    });
    const response = await poll(new Request('https://app/functions/pollFaxStatuses'));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(state.FaxLog[0].status, 'failed');
    assert.equal(state.FaxLog[0].retry_claimed_by, null);
    assert.equal(state.FaxLog[0].retry_submission_state, 'ready');
    assert.equal(state.FaxLog[0].automatic_retry_queue_attempts, previousAttempts + 1);
    assert.equal(!!state.FaxLog[0].next_retry_at, previousAttempts === 0);
    assert.equal(provider.calls.length, 0);
  }
});


// Inbound faxes are only ever forwarded now, so a recovered row is the
// 'completed' forward record: a lost create acknowledgement is recovered on the
// replay, its reservation released, and the fax forwarded exactly once.
test('inbound forward replay recovers a lost create acknowledgement and forwards once', async () => {
  for (const dropMarker of [false, true]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.endsWith("/v2/faxes"), respond: () => ({ status: 202, json: { data: { id: "fwd_replay_1" } } }) },
  ]);
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret({
      public_key: pubB64,
      fax_connection_id: "FC1",
      messaging_profile_id: "MP1",
    })],
    TelecomDestinationBinding: [faxBinding()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    AgencySettings: [{
      agency_id: "agency_a",
      agency_code: "AGENCY-A",
      fax_receiving_enabled: true,
      office_fax_number_e164: "+17244650444",
    }],
    IncomingFax: [],
  };
  const client = makeSpyBase44({ writes, data: state });
  const create = client.asServiceRole.entities.IncomingFax.create;
  client.asServiceRole.entities.IncomingFax.create = async fields => {
    const row = await create(fields);
    if (dropMarker) delete row.processing_notification_state;
    throw new Error('Response lost after create');
  };
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => client,
    fetchImpl: impl,
  });
  const event = { data: { event_type: "fax.received", payload: {
    id: "faxin_bound_1", direction: "inbound", media_url: "https://media.telnyx.com/bound.pdf",
    from: "+13125550182", to: "+12155550190", page_count: 3,
  } } };

  const first = await handler(signedWebhook(privateKey, event));
  assert.notEqual(first.status, 200);
  assert.equal(state.IncomingFax.length, 1);
  assert.equal(Object.keys(state.Agency[0].fax_workflow_reservations).length, 1);
  assert.equal(calls.length, 0, 'nothing is forwarded before the forward record is confirmed');
  const second = await handler(signedWebhook(privateKey, event));
  // The OCR publication marker only fenced in-app ingestion; a forward record
  // never carries one, so its absence no longer blocks the recovery.
  assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
  assert.equal(Object.keys(state.Agency[0].fax_workflow_reservations).length, 0);
  assert.equal(writes.filter(write => write.entity === 'IncomingFax' && write.op === 'create').length, 1);
  assert.equal(state.IncomingFax[0].processing_status, 'completed');
  assert.equal(state.IncomingFax[0].status, 'routed');
  assert.equal(calls.filter((c) => c.url.endsWith('/v2/faxes')).length, 1);
  }
});


test('inbound forwarding retains uncertain provider failures and releases only definite rejection', async () => {
  for (const providerStatus of [408, 409, 425, 500, 422]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.endsWith("/v2/faxes"), respond: () => ({ status: providerStatus, json: { data: { id: "fwd_1" } } }) },
  ]);
  const writes = [];
  const state = {
    IntegrationSecret: [activeTelnyxSecret({
      public_key: pubB64,
      fax_connection_id: "FC1",
      messaging_profile_id: "MP1",
    })],
    TelecomDestinationBinding: [faxBinding()],
    Agency: [{ id: "agency_a", agency_code: "AGENCY-A", status: "active", updated_date: "2026-09-01T00:00:00.000Z" }],
    // fax_receiving_enabled is NOT set — the default posture forwards to the office.
    AgencySettings: [{
      agency_id: "agency_a",
      agency_code: "AGENCY-A",
      office_fax_number_e164: "+17244650444",
    }],
    IncomingFax: [],
  };
  const client = makeSpyBase44({ writes, data: state });
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => client,
    fetchImpl: impl,
  });
  const event = { data: { event_type: "fax.received", payload: {
    id: "faxin_1", direction: "inbound", media_url: "https://media.telnyx.com/f1.pdf",
    from: "+13125550182", to: "+12155550190",
  } } };

  assert.equal((await handler(signedWebhook(privateKey, event))).status, 502);
  const definite = providerStatus === 422;
  assert.equal(state.IncomingFax[0].status, definite ? 'unread' : 'reviewing');
  await handler(signedWebhook(privateKey, event));
  assert.equal(calls.length, definite ? 2 : 1);
  }
});


test('recovered rejected retries preserve remaining policy budget and uncertain policy reads preserve claims', async () => {
  for (const policy of [ { max_retries: 3 }, { max_retries: 3, auto_retry_enabled: false }, { max_retries: 100 }, null ]) {
    const state = { IntegrationSecret: [activeTelnyxSecret()], Notification: [],
      AgencyMembership: [activeFaxSenderMembership()],
      FaxRetryConfig: policy ? [{ agency_id: 'agency_a', retry_delay_minutes: 15, ...policy }] : [],
      FaxLog: [outboundFax({ status: 'retrying', provider_terminal_status: 'failed',
        provider_terminal_at: '2026-09-06T12:05:00.000Z', retry_count: 1, retry_generation: 0,
        retry_claimed_by: 'retry_claim', retry_claimed_by_user_id: 'user_a',
        retry_claimed_at: '2020-01-01T00:00:00.000Z', retry_submission_state: 'started',
      }), outboundFax({ id: 'rejected_child', status: 'failed', retry_of_fax_log_id: 'FaxLog_1',
        retry_generation: 1, retry_count: 1, provider_submission_state: 'rejected', telnyx_fax_id: null })],
    };
    const handler = await loadHandler('../functions/pollFaxStatuses/entry.ts', {
      env: pollFaxStatusesReleased, makeClient: () => makeSpyBase44({ data: state }), fetchImpl: makeFetch([]).impl,
    });
    const response = await handler(new Request('https://app/functions/pollFaxStatuses'));
    const invalidPolicy = !policy || policy.max_retries === 100;
    assert.equal(response.status, invalidPolicy ? 503 : 200);
    if (invalidPolicy) {
      assert.equal(state.FaxLog[0].status, 'retrying');
      assert.equal(state.FaxLog[0].retry_claimed_by, 'retry_claim');
      assert.equal(state.Notification.length, 0);
    } else if (policy.auto_retry_enabled === false) {
      assert.equal(state.FaxLog[0].next_retry_at, null);
      assert.equal(state.Notification.length, 1);
    } else {
      assert.equal(state.FaxLog[0].status, 'failed');
      assert.equal(state.FaxLog[0].retry_generation, 1);
      assert.equal(state.FaxLog[0].retry_count, 2);
      assert.equal(state.FaxLog[0].retry_submission_state, 'ready');
      assert.ok(Date.parse(state.FaxLog[0].next_retry_at) > Date.now());
      assert.equal(state.Notification.length, 0);
    }
  }
});
