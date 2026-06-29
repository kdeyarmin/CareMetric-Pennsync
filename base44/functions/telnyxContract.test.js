import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import ts from "typescript";

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
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
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
  const handler = await loadHandler("./sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_MESSAGING_PROFILE_ID: "MP1" },
    makeClient: () => makeBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest", messaging_profile_id: "MP1" }] } }),
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
  const handler = await loadHandler("./sendFax/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_FAX_CONNECTION_ID: "FC1", TELNYX_FAX_NUMBER: "+12155550190" },
    makeClient: () => makeBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest", fax_connection_id: "FC1" }] } }),
    fetchImpl: impl,
  });
  await handler(new Request("https://app/functions/sendFax", {
    method: "POST", body: JSON.stringify({ file_url: "https://files/x.pdf", to_number: "+12155550144", document_name: "Doc" }),
  }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/faxes");
  assert.ok(call, "posted to the Telnyx Faxes endpoint");
  assert.match(BEARER(call.headers), /^Bearer KEYtest$/);
  assert.equal(call.body.connection_id, "FC1");
  assert.equal(call.body.from, "+12155550190");
  assert.equal(call.body.to, "+12155550144");
  assert.equal(call.body.media_url, "https://files/x.pdf");
});

// ============================ VOICE (outbound) ============================
test("startMaskedCall posts the Telnyx Call Control create-call contract", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => u.endsWith("/v2/calls"), respond: () => ({ status: 200, json: { data: { call_control_id: "cc_1" } } }) },
  ]);
  const handler = await loadHandler("./startMaskedCall/entry.ts", {
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
  const handler = await loadHandler("./searchPurchaseTelnyxNumbers/entry.ts", {
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

// ============================ VIDEO TOKEN ============================
test("createTelehealthToken provisions a room and mints a join token", async () => {
  const { impl, calls } = makeFetch([
    { match: (u) => /\/v2\/rooms\?/.test(u), respond: () => ({ status: 200, json: { data: [] } }) },
    { match: (u) => u.endsWith("/v2/rooms"), respond: () => ({ status: 200, json: { data: { id: "room_1" } } }) },
    { match: (u) => u.includes("/actions/generate_join_client_token"), respond: () => ({ status: 200, json: { data: { token: "JOIN", refresh_token: "R" } } }) },
  ]);
  const handler = await loadHandler("./createTelehealthToken/entry.ts", {
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
  const handler = await loadHandler("./handleTelnyxStatusWebhook/entry.ts", {
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
  const h1 = await loadHandler("./handleTelnyxStatusWebhook/entry.ts", {
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
  const h2 = await loadHandler("./handleTelnyxStatusWebhook/entry.ts", {
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

test("find-me-follow-me rolls to the next target when a leg goes unanswered", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = rawEd25519PublicKeyB64(publicKey);
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/actions/transfer"), respond: () => ({ status: 200, json: { data: {} } }) },
  ]);
  const handler = await loadHandler("./handleTelnyxStatusWebhook/entry.ts", {
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
  const handler = await loadHandler("./handleTelnyxStatusWebhook/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest", TELNYX_PUBLIC_KEY: pubB64 }, makeClient: client, fetchImpl: impl,
  });
  await handler(signedWebhook(privateKey, { data: { event_type: "call.answered", payload: { call_control_id: "cc_f", direction: "outgoing", client_state: b64json({ t: "masked_bridge", bridge_to: "+12155550144", caller_id: "+12155550100", call_log_id: "CallLog_9" }) } } }));
  assert.ok(calls.find((c) => /\/actions\/speak$/.test(c.url)), "spoke an apology to the nurse");
  assert.ok(calls.find((c) => /\/actions\/hangup$/.test(c.url)), "hung up instead of stranding dead air");
  assert.equal(updated?.id, "CallLog_9");
  assert.equal(updated?.patch.status, "failed");
});

test("sendSms forwards MMS media_urls and rejects non-https/oversized media", async () => {
  const mk = () => makeBase44({ data: { IntegrationSecret: [{ api_key: "KEYtest" }] } });
  // Happy path: media_urls forwarded to Telnyx.
  const { impl, calls } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "m", to: [{ status: "queued" }] } } }) },
  ]);
  const handler = await loadHandler("./sendSms/entry.ts", {
    env: { TELNYX_API_KEY: "KEYtest" }, makeClient: mk, fetchImpl: impl,
  });
  await handler(new Request("https://app/functions/sendSms", { method: "POST", body: JSON.stringify({ to_number: "2155550133", body: "see attached", media_urls: ["https://files/x.jpg"] }) }));
  const call = calls.find((c) => c.url === "https://api.telnyx.com/v2/messages");
  assert.deepEqual(call.body.media_urls, ["https://files/x.jpg"]);

  // Validation: a non-https URL is rejected before any send.
  const { impl: impl2, calls: calls2 } = makeFetch([
    { match: (u) => u.includes("/v2/messages"), respond: () => ({ status: 200, json: { data: { id: "m" } } }) },
  ]);
  const handler2 = await loadHandler("./sendSms/entry.ts", {
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
  const handler = await loadHandler("./handleTelnyxStatusWebhook/entry.ts", {
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
  const handler = await loadHandler("./handleTelnyxStatusWebhook/entry.ts", {
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
