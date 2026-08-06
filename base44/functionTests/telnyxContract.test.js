import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
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
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
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

const BEARER = (h) => (h && (h.Authorization || h.authorization)) || "";

// ============================ MESSAGES ============================
test("sendSms posts the Telnyx Messages contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "msg_1", to: [{ status: "queued" }] } } }) },
  ]);
  const handler = await loadHandler("../functions/sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_MESSAGING_PROFILE_ID: "MP1" },
    makeClient: () => makeBase44({ data: {
      IntegrationSecret: [{ api_key: "KEYtest", messaging_profile_id: "MP1" }],
      // Contract tests are wall-clock independent: disable TCPA quiet hours so a
      // night-time CI run does not 403 a Messages-API shape assertion.
      AgencySettings: [{ tcpa_quiet_hours_enabled: false, sms_enabled: true }],
      SmsConsent: [{ phone_e164: "+12155550133", consent_status: "opted_in", captured_at: "2026-01-01T00:00:00Z" }],
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

// ============================ FAX ============================
test("sendFax posts the Telnyx Programmable Fax contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/faxes"), respond: () => ({ status: 200, json: { data: { id: "fax_1", status: "queued" } } }) },
  ]);
  const handler = await loadHandler("../functions/sendFax/entry.ts", {
    env: {},
    makeClient: () => makeBase44({ data: {
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
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_VOICE_CONNECTION_ID: "VC1" },
    makeClient: () => makeBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest", voice_connection_id: "VC1" }] } }),
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
});

// ============================ NUMBER PROVISIONING ============================
test("searchPurchaseTelnyxNumbers posts the Telnyx number-order contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: { id: "ord_1", phone_numbers: [{ id: "np_1", phone_number: "+12155550177" }] } } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest" },
    makeClient: () => makeBase44({ user: { email: "a@x.com", account_type: "super_admin" }, data: { IntegrationSecret: [{ api_key: "KEYtest" }] } }),
    fetchImpl: impl,
  });
  await handler(new Request("https://app/functions/searchPurchaseTelnyxNumbers", {
    method: "POST", body: JSON.stringify({ action: "purchase", e164: "2155550177" }),
  }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/number_orders");
  assert.ok(call, "posted to the Telnyx number_orders endpoint");
  assert.match(BEARER(call.headers), /^Bearer KEYtest$/);
  assert.deepEqual(call.body.phone_numbers, [{ phone_number: "+12155550177" }]);
});

test("a nurse-line purchase auto-enrolls the number in the saved A2P campaign", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: { id: "ord_3", phone_numbers: [{ id: "np_2", phone_number: "+12155550188" }] } } }) },
    { match: (u) => u.includes("/v2/10dlc/phone_number_campaigns"), respond: () => ({ status: 200, json: { phoneNumber: "+12155550188", campaignId: "CAMP1" } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: {},
    makeClient: () => makeBase44({
      user: { email: "a@x.com", account_type: "super_admin" },
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
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: { id: "ord_4", phone_numbers: [{ id: "np_3", phone_number: "+12155550190" }] } } }) },
  ]);
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: {},
    makeClient: () => makeBase44({
      user: { email: "a@x.com", account_type: "super_admin" },
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
function makeSpyBase44({ user = { email: "a@x.com", account_type: "super_admin", full_name: "Ada" }, data = {}, writes = [] } = {}) {
  const cache = {};
  const entity = (name) => {
    if (!cache[name]) {
      cache[name] = {
        create: async (row) => {
          const created = { id: `${name}_1`, ...row };
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
        // Support id-equality filters used by claim-before-assign / claim-before-send.
        filter: async (query = {}) => {
          const rows = data[name] || [];
          if (query && query.id != null) return rows.filter((r) => r.id === query.id);
          return rows;
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
    env: {},
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
    { match: (u) => u.includes("/v2/number_orders"), respond: () => ({ status: 200, json: { data: { id: "ord_2", phone_numbers: [{ id: "np_9", phone_number: "+12155550199" }] } } }) },
  ]);
  const writes = [];
  const handler = await loadHandler("../functions/searchPurchaseTelnyxNumbers/entry.ts", {
    env: {},
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
    env: {},
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
  const patch = calls.find((c) => /\/v2\/phone_numbers\/np_7$/.test(c.url) && c.method === "PATCH");
  assert.ok(patch, "PATCHed the owned Telnyx number");
  assert.equal(patch.body.connection_id, "FC1", "re-pointed at the Programmable Fax connection");
  const outboundWrite = writes.find((w) => w.entity === "AgencySettings" && w.op === "update");
  assert.equal(outboundWrite?.patch.outbound_fax_number_e164, "+12155550188", "stored normalized as the blind outbound fax line");
});

test("sendFax transmits from the blind outbound line masked as the office fax", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/faxes"), respond: () => ({ status: 200, json: { data: { id: "fax_3", status: "queued" } } }) },
  ]);
  const handler = await loadHandler("../functions/sendFax/entry.ts", {
    env: {},
    makeClient: () => makeBase44({ data: {
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
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeSpyBase44({
      writes,
      data: {
        IntegrationSecret: [{ api_key: "KEYtest", public_key: pubB64, fax_connection_id: "FC1" }],
        // fax_receiving_enabled is NOT set — the default posture forwards to the office.
        AgencySettings: [{ office_fax_number_e164: "+17244650444" }],
        IncomingFax: [],
      },
    }),
    fetchImpl: impl,
  });
  const res = await handler(signedWebhook(privateKey, { data: { event_type: "fax.received", payload: {
    id: "faxin_1", direction: "inbound", media_url: "https://media.telnyx.com/f1.pdf",
    from: "+13125550182", to: "+12155550190",
  } } }));
  assert.equal(res.status, 200);
  const fwd = calls.find((c) => c.url.endsWith("/v2/faxes"));
  assert.ok(fwd, "forwarded the received fax to the office");
  assert.equal(fwd.body.to, "+17244650444", "delivered to the office fax machine");
  assert.equal(fwd.body.from, "+12155550190", "sent from the line that received it");
  assert.equal(fwd.body.media_url, "https://media.telnyx.com/f1.pdf");
  const row = writes.find((w) => w.entity === "IncomingFax" && w.op === "create");
  assert.ok(row, "created the at-most-once forward record");
  assert.equal(row.row.processing_status, "completed", "kept away from the in-app OCR job");
  const routed = writes.find((w) => w.entity === "IncomingFax" && w.op === "update");
  assert.equal(routed?.patch.status, "routed", "marked routed after the successful forward");
});

test("sendFax normalizes a formatted office fax number to E.164 on `from`", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/faxes"), respond: () => ({ status: 200, json: { data: { id: "fax_2", status: "queued" } } }) },
  ]);
  const handler = await loadHandler("../functions/sendFax/entry.ts", {
    env: {},
    makeClient: () => makeBase44({ data: {
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
    env: {},
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
    env: {},
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
  const poolWrite = writes.find((w) => w.entity === "PhoneNumber" && w.op === "update" && w.id === "p1");
  assert.equal(poolWrite?.patch.status, "assigned", "the matching pool row is marked assigned");
  assert.equal(poolWrite?.patch.assigned_to_email, "n@x.com");
});

test("autoAssignWorkNumbers skips the shared office fax / main office numbers", async () => {
  const { impl } = makeFetch([]);
  const writes = [];
  const handler = await loadHandler("../functions/autoAssignWorkNumbers/entry.ts", {
    env: {},
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

const b64json = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const decodeState = (b64) => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

test("handleTelnyxStatusWebhook verifies Ed25519 and bridges an answered masked call", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);

  const clientState = Buffer.from(JSON.stringify({ t: "masked_bridge", bridge_to: "+12155550144", caller_id: "+12155550100", call_log_id: "CallLog_1" })).toString("base64");
  const event = { data: { event_type: "call.answered", payload: { call_control_id: "cc_9", direction: "outgoing", client_state: clientState } } };
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = nodeSign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString("base64");

  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_PUBLIC_KEY: pubB64 },
    makeClient: () => makeBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest", public_key: pubB64 }], CallLog: [{ id: "CallLog_1", status: "ringing" }] } }),
    fetchImpl: impl,
  });

  const res = await handler(new Request("https://app/functions/handleTelnyxStatusWebhook", {
    method: "POST",
    headers: { "telnyx-signature-ed25519": signature, "telnyx-timestamp": timestamp, "content-type": "application/json" },
    body: rawBody,
  }));
  assert.equal(res.status, 200, "valid signature is accepted");

  const transfer = calls.find((c) => /\/v2\/calls\/cc_9\/actions\/transfer$/.test(c.url));
  assert.ok(transfer, "issued a Call Control transfer to bridge the patient");
  assert.equal(transfer.body.to, "+12155550144");
  assert.equal(transfer.body.from, "+12155550100");
});

test("inbound call answers first, then bridges an on-duty nurse on call.answered", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const base = () => makeBase44({
    data: {
      IntegrationSecret: [{ api_key: "KEYtest", public_key: pubB64 }],
      User: [{ email: "n@x.com", work_phone_number: "+12155550100", personal_cell_e164: "+12155550111", duty_status: "on_duty" }],
      // Disable the 5pm auto-off so this bridge assertion is time-independent.
      AgencySettings: [{ auto_off_duty_enabled: false }], CallLog: [],
    },
  });

  // Step 1: call.initiated (incoming) must ANSWER first (not transfer on a
  // ringing leg), carrying the bridge decision in client_state.
  const { impl: impl1, calls: calls1 } = makeFetch([
    { match: (u) => u.includes("/actions/answer"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const h1 = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_PUBLIC_KEY: pubB64 }, makeClient: base, fetchImpl: impl1,
  });
  await h1(signedWebhook(privateKey, { data: { event_type: "call.initiated", payload: { call_control_id: "cc_in", direction: "incoming", from: "+13125550182", to: "+12155550100" } } }));
  const answer = calls1.find((c) => /\/actions\/answer$/.test(c.url));
  assert.ok(answer, "answered the inbound call first");
  const carried = decodeState(answer.body.client_state);
  assert.equal(carried.action, "ringdown");
  assert.equal(carried.targets[0].to, "+12155550111", "first ringdown target = nurse cell");

  // Step 2: call.answered with that client_state rings the first target.
  const { impl: impl2, calls: calls2 } = makeFetch([
    { match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const h2 = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_PUBLIC_KEY: pubB64 }, makeClient: base, fetchImpl: impl2,
  });
  await h2(signedWebhook(privateKey, { data: { event_type: "call.answered", payload: { call_control_id: "cc_in", direction: "incoming", client_state: b64json({ t: "inbound_ivr", action: "ringdown", greeting: "", to: carried.to, callerId: carried.callerId, targets: carried.targets }) } } }));
  const transfer = calls2.find((c) => /\/v2\/calls\/cc_in\/actions\/transfer$/.test(c.url));
  assert.ok(transfer, "rang the first target on answer");
  assert.equal(transfer.body.to, "+12155550111");
  assert.equal(transfer.body.from, "+12155550100");
  // The transfer carries ringdown state so an unanswered hangup can advance.
  assert.equal(decodeState(transfer.body.client_state).t, "ringdown");
});

test("an after-hours/weekend inbound call greets and transfers to the NORMALIZED after-hours number", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/actions/answer"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeBase44({
      data: {
        IntegrationSecret: [{ api_key: "KEYtest", public_key: pubB64 }],
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
    }),
    fetchImpl: impl,
  });
  await handler(signedWebhook(privateKey, { data: { event_type: "call.initiated", payload: { call_control_id: "cc_ah", direction: "incoming", from: "+13125550182", to: "+12155550100" } } }));
  const answer = calls.find((c) => /\/actions\/answer$/.test(c.url));
  assert.ok(answer, "answered the after-hours call (to speak the greeting)");
  const carried = decodeState(answer.body.client_state);
  assert.equal(carried.action, "greet_transfer", "after-hours calls greet then transfer");
  assert.equal(carried.to, "+17244650440", "transfer target is normalized E.164, not the raw formatted string");
});

test("a rejected ringdown transfer advances to the next target instead of stranding the caller", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  let transferCalls = 0;
  const { impl, calls } = makeFetch([
    // First target is rejected outright (e.g. bad number); the next succeeds.
    { match: (u) => u.includes("/actions/transfer"), respond: () => (++transferCalls === 1
      ? { status: 422, json: { errors: [{ detail: "invalid destination" }] } }
      : { status: 200, json: { data: {} } }) },
    { match: (u) => u.includes("/actions/speak"), respond: () => ({ status: 200, json: { data: {} } }) },
    { match: (u) => u.includes("/actions/hangup"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: {},
    makeClient: () => makeBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest", public_key: pubB64 }] } }),
    fetchImpl: impl,
  });
  await handler(signedWebhook(privateKey, { data: { event_type: "call.answered", payload: {
    call_control_id: "cc_rd", direction: "incoming",
    client_state: b64json({ t: "inbound_ivr", action: "ringdown", greeting: "", to: null, callerId: "+12155550100",
      targets: [{ to: "724-465", kind: "primary" }, { to: "+17244650440", kind: "office" }] }),
  } } }));
  const transfers = calls.filter((c) => /\/actions\/transfer$/.test(c.url));
  assert.equal(transfers.length, 2, "retried the next target after the rejection");
  assert.equal(transfers[1].body.to, "+17244650440", "second attempt rings the next ringdown target");
  assert.ok(!calls.some((c) => /\/actions\/hangup$/.test(c.url)), "caller was not hung up — the second target is ringing");
});

test("find-me-follow-me rolls to the next target when a leg goes unanswered", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_PUBLIC_KEY: pubB64 },
    makeClient: () => makeBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest", public_key: pubB64 }] } }),
    fetchImpl: impl,
  });
  // The dialed leg (target 0 = nurse cell) hangs up unanswered; a_leg is the caller.
  const ringdownState = b64json({
    t: "ringdown", idx: 0, callerId: "+12155550100", a_leg: "cc_caller",
    targets: [{ to: "+12155550111", kind: "primary" }, { to: "+17244650440", kind: "office" }],
  });
  await handler(signedWebhook(privateKey, { data: { event_type: "call.hangup", payload: { call_control_id: "cc_leg0", client_state: ringdownState, hangup_cause: "no_answer" } } }));
  // It must transfer the ORIGINAL caller leg to the next target (the office).
  const next = calls.find((c) => /\/v2\/calls\/cc_caller\/actions\/transfer$/.test(c.url));
  assert.ok(next, "rolled to the next target on the caller leg");
  assert.equal(next.body.to, "+17244650440");
  assert.equal(decodeState(next.body.client_state).idx, 1);
});

test("a failed masked-bridge transfer falls back to speak+hangup and marks the call failed", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  // Transfer returns 422 (e.g. invalid patient number) → must not strand the leg.
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 422, json: { errors: [{ detail: "bad number" }] } }) },
    { match: (u) => u.includes("/actions/speak"), respond: () => ({ status: 200, json: { data: {} } }) },
    { match: (u) => u.includes("/actions/hangup"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  let updated = null;
  const client = () => {
    // Stable entities object so the CallLog.update spy persists (the default
    // makeBase44 Proxy returns a fresh entity per access).
    const callLog = { create: async (r) => ({ id: "x", ...r }), filter: async () => [], list: async () => [], update: async (id, patch) => { updated = { id, patch }; return { id, ...patch }; } };
    const generic = { create: async (r) => ({ id: "x", ...r }), filter: async () => [], list: async () => [], update: async () => ({}) };
    const entities = new Proxy({}, { get: (_t, n) => (n === "CallLog" ? callLog : (n === "IntegrationSecret" ? { ...generic, filter: async () => [{ api_key: "KEYtest", public_key: pubB64 }] } : generic)) });
    return { auth: { me: async () => ({}) }, entities, asServiceRole: { entities } };
  };
  const handler = await loadHandler("../functions/handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_PUBLIC_KEY: pubB64 }, makeClient: client, fetchImpl: impl,
  });
  await handler(signedWebhook(privateKey, { data: { event_type: "call.answered", payload: { call_control_id: "cc_f", direction: "outgoing", client_state: b64json({ t: "masked_bridge", bridge_to: "+12155550144", caller_id: "+12155550100", call_log_id: "CallLog_9" }) } } }));
  assert.ok(calls.find((c) => /\/actions\/speak$/.test(c.url)), "spoke an apology to the nurse");
  assert.ok(calls.find((c) => /\/actions\/hangup$/.test(c.url)), "hung up instead of stranding dead air");
  assert.equal(updated?.id, "CallLog_9");
  assert.equal(updated?.patch.status, "failed");
});

test("sendSms forwards MMS media_urls and rejects non-https/oversized media", async () => {
  const mk = () => makeBase44({ data: {
    IntegrationSecret: [{ api_key: "KEYtest" }],
    AgencySettings: [{ tcpa_quiet_hours_enabled: false, sms_enabled: true }],
    SmsConsent: [{ phone_e164: "+12155550133", consent_status: "opted_in", captured_at: "2026-01-01T00:00:00Z" }],
  } });
  // Happy path: media_urls forwarded to Telnyx.
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "m", to: [{ status: "queued" }] } } }) },
  ]);
  const handler = await loadHandler("../functions/sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest" }, makeClient: mk, fetchImpl: impl,
  });
  await handler(new Request("https://app/functions/sendSms", { method: "POST", body: JSON.stringify({ to_number: "2155550133", body: "see attached", media_urls: ["https://files/x.jpg"] }) }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/messages");
  assert.deepEqual(call.body.media_urls, ["https://files/x.jpg"]);

  // Validation: a non-https URL is rejected before any send.
  const { impl: impl2, calls: calls2 } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "m" } } }) },
  ]);
  const handler2 = await loadHandler("../functions/sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest" }, makeClient: mk, fetchImpl: impl2,
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
    makeClient: () => makeBase44({
      data: {
        IntegrationSecret: [{ api_key: "KEYtest", public_key: pubB64 }],
        // Nurse with no duty_status → default OFF until they toggle on.
        User: [{ email: "n@x.com", work_phone_number: "+12155550100" }],
        AgencySettings: [{ main_office_number_e164: "724-465-0440" }],
        SmsConsent: [], Patient: [],
      },
    }),
    fetchImpl: impl,
  });
  await handler(signedWebhook(privateKey, { data: { event_type: "message.received", payload: { id: "in_1", from: { phone_number: "+13125550182" }, to: [{ phone_number: "+12155550100" }], text: "are you available?" } } }));
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
    makeClient: () => makeBase44({ data: { IntegrationSecret: [{ public_key: pubB64 }] } }),
    fetchImpl: impl,
  });
  const res = await handler(new Request("https://app/functions/handleTelnyxStatusWebhook", {
    method: "POST",
    headers: { "telnyx-signature-ed25519": Buffer.from("not-a-real-signature-of-the-right-length-aaaaaaaaaaaaaaaaaaaaaaaaaaaa").toString("base64"), "telnyx-timestamp": timestamp, "content-type": "application/json" },
    body: rawBody,
  }));
  assert.equal(res.status, 401, "a bad signature is rejected");
});
