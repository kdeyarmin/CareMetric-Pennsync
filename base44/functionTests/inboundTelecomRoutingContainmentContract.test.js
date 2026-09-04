import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

const ENTRY_URL = new URL("../functions/handleTelnyxStatusWebhook/entry.ts", import.meta.url);

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
    headers: {
      "content-type": "application/json",
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": timestamp,
    },
    body: rawBody,
  });
}

async function loadHandler(makeClient, fetchImpl) {
  let source = await readFile(ENTRY_URL, "utf8");
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__inboundRoutingMakeClient;",
  );
  const js = transpileTs(source).outputText;
  const tempPath = join(tmpdir(), `inbound-routing-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tempPath, js);

  let handler;
  globalThis.__inboundRoutingMakeClient = makeClient;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  globalThis.fetch = fetchImpl;
  try {
    await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return handler;
}

test("signed inbound patient telecom events fail closed before mutable User routing", async () => {
  const source = await readFile(ENTRY_URL, "utf8");
  assert.match(source, /const INBOUND_PATIENT_SMS_ROUTING_PAUSED = true;/);
  assert.match(source, /const INBOUND_PATIENT_FAX_ROUTING_PAUSED = true;/);
  assert.match(source, /const INBOUND_PATIENT_CALL_ROUTING_PAUSED = true;/);
  for (const state of ["inbound_ivr", "inbound_after_greet", "ringdown", "voicemail"]) {
    assert.match(source, new RegExp(`['\"]${state}['\"]`));
  }

  // Ordering is a security property: reject forged input first, then apply the
  // literal migration gates before either legacy inbound handler is dispatched.
  const entry = source.slice(source.indexOf("Deno.serve"));
  const verification = entry.indexOf("if (!(await verifyTelnyxSignature");
  const extraction = entry.indexOf("extractTelnyxEvent(body)");
  const smsGate = entry.indexOf("eventType === 'message.received' && INBOUND_PATIENT_SMS_ROUTING_PAUSED");
  const faxGate = entry.indexOf("eventType === 'fax.received' && INBOUND_PATIENT_FAX_ROUTING_PAUSED");
  const callGate = entry.indexOf("INBOUND_PATIENT_CALL_ROUTING_PAUSED && isInboundPatientCallEvent");
  const smsDispatch = entry.indexOf("return await handleInboundMessage");
  const faxDispatch = entry.indexOf("return await handleInboundFax");
  const callDispatch = entry.indexOf("return await handleCallEvent");
  assert.ok(verification >= 0 && verification < extraction, "signature verification precedes event extraction");
  assert.ok(extraction < smsGate && smsGate < smsDispatch, "SMS pause precedes legacy inbound dispatch");
  assert.ok(extraction < faxGate && faxGate < faxDispatch, "fax pause precedes legacy inbound dispatch");
  assert.ok(extraction < callGate && callGate < callDispatch, "call pause precedes legacy call dispatch");

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = rawEd25519PublicKeyB64(publicKey);
  const entityCalls = [];
  const fetchCalls = [];
  const entities = new Proxy({}, {
    get: (_target, nameValue) => {
      const name = String(nameValue);
      return {
        filter: async (...args) => {
          entityCalls.push({ name, operation: "filter", args });
          if (name === "IntegrationSecret") {
            return [{ api_key: "KEYtest", public_key: publicKeyB64, messaging_profile_id: "MP1" }];
          }
          return [];
        },
        list: async (...args) => {
          entityCalls.push({ name, operation: "list", args });
          return [];
        },
        create: async (...args) => {
          entityCalls.push({ name, operation: "create", args });
          return { id: `${name}_1`, ...args[0] };
        },
        update: async (...args) => {
          entityCalls.push({ name, operation: "update", args });
          return { id: args[0], ...args[1] };
        },
      };
    },
  });
  const client = { entities, asServiceRole: { entities } };
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  const originalMakeClient = globalThis.__inboundRoutingMakeClient;

  try {
    const handler = await loadHandler(
      () => client,
      async (url, init = {}) => {
        fetchCalls.push({ url: String(url), init });
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    const smsResponse = await handler(signedWebhook(privateKey, {
      data: {
        event_type: "message.received",
        payload: {
          id: "inbound-message-1",
          from: { phone_number: "+13125550182" },
          to: [{ phone_number: "+12155550100" }],
          // STOP remains paused because the legacy ledger is not scoped by an
          // immutable destination/tenant binding; this must be resolved before release.
          text: "STOP",
        },
      },
    }));
    assert.equal(smsResponse.status, 503);
    assert.equal(smsResponse.headers.get("retry-after"), "300");
    assert.equal((await smsResponse.json()).code, "INBOUND_TELECOM_BINDING_MIGRATION_PAUSED");

    const inboundCallResponse = await handler(signedWebhook(privateKey, {
      data: {
        event_type: "call.initiated",
        payload: {
          call_control_id: "inbound-call-1",
          direction: "incoming",
          from: "+13125550182",
          to: "+12155550100",
        },
      },
    }));
    assert.equal(inboundCallResponse.status, 503);

    const inboundFaxResponse = await handler(signedWebhook(privateKey, {
      data: {
        event_type: "fax.received",
        payload: {
          id: "inbound-fax-1",
          direction: "inbound",
          from: "+13125550182",
          to: "+12155550190",
          media_url: "https://example.test/inbound-fax.pdf",
        },
      },
    }));
    assert.equal(inboundFaxResponse.status, 503);

    // Follow-on ringdown legs can be direction=outgoing or omit direction, but
    // they still execute targets derived by the paused inbound routing chain.
    const ringdownState = Buffer.from(JSON.stringify({
      t: "ringdown",
      a_leg: "inbound-call-1",
      targets: [{ to: "+12155550111", kind: "primary" }],
    })).toString("base64");
    const continuationResponse = await handler(signedWebhook(privateKey, {
      data: {
        event_type: "call.hangup",
        payload: {
          call_control_id: "ringdown-leg-1",
          client_state: ringdownState,
          hangup_cause: "no_answer",
        },
      },
    }));
    assert.equal(continuationResponse.status, 503);

    assert.equal(
      entityCalls.filter((call) => call.name === "User").length,
      0,
      "paused inbound events never consult mutable User telecom fields",
    );
    assert.equal(
      entityCalls.filter((call) => call.name === "AgencySettings").length,
      0,
      "paused inbound fax events never consult mutable agency routing settings",
    );
    assert.equal(fetchCalls.length, 0, "paused inbound events execute no Telnyx routing command");

    // Delivery receipts remain live; only message.received is paused.
    const deliveryResponse = await handler(signedWebhook(privateKey, {
      data: {
        event_type: "message.delivered",
        payload: { id: "outbound-message-1", to: [{ status: "delivered" }] },
      },
    }));
    assert.equal(deliveryResponse.status, 404, "outbound SMS status reaches its existing reconciliation handler");

    const faxDeliveryResponse = await handler(signedWebhook(privateKey, {
      data: {
        event_type: "fax.delivered",
        payload: { id: "outbound-fax-1", status: "delivered", page_count: 2 },
      },
    }));
    assert.equal(faxDeliveryResponse.status, 404, "outbound fax status reaches its existing reconciliation handler");

    // Outbound masked-call continuation remains live and is not mistaken for
    // inbound IVR merely because it is a call event.
    const maskedBridgeState = Buffer.from(JSON.stringify({
      t: "masked_bridge",
      bridge_to: "+12155550144",
      caller_id: "+12155550100",
      call_log_id: "CallLog_1",
    })).toString("base64");
    const outboundCallResponse = await handler(signedWebhook(privateKey, {
      data: {
        event_type: "call.answered",
        payload: {
          call_control_id: "outbound-call-1",
          direction: "outgoing",
          client_state: maskedBridgeState,
        },
      },
    }));
    assert.equal(outboundCallResponse.status, 200);
    assert.ok(fetchCalls.some((call) => call.url.endsWith("/v2/calls/outbound-call-1/actions/transfer")));

    const invalidBody = JSON.stringify({ data: { event_type: "message.received", payload: {} } });
    const invalidTimestamp = String(Math.floor(Date.now() / 1000));
    const invalidResponse = await handler(new Request("https://app/functions/handleTelnyxStatusWebhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": Buffer.alloc(64).toString("base64"),
        "telnyx-timestamp": invalidTimestamp,
      },
      body: invalidBody,
    }));
    assert.equal(invalidResponse.status, 401, "a forged inbound event is rejected before the migration response");
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    globalThis.__inboundRoutingMakeClient = originalMakeClient;
  }
});
