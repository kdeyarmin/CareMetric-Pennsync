import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";
import JSON5 from "json5";

const ENTRY_URL = new URL("../functions/handleTelnyxStatusWebhook/entry.ts", import.meta.url);
const BINDING_URL = new URL("../entities/TelecomDestinationBinding.jsonc", import.meta.url);
const FUNCTIONS_URL = new URL("../functions/", import.meta.url);

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

function makeBinding(overrides = {}) {
  const integrationSecretId = overrides.integration_secret_id || "integration_1";
  const destination = overrides.destination_e164 || "+12155550100";
  const binding = {
    id: "binding_1",
    binding_key: `telnyx:${integrationSecretId}:${destination}`,
    provider: "telnyx",
    integration_secret_id: integrationSecretId,
    destination_e164: destination,
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
    created_at: "2026-09-01T00:00:01.000Z",
    activated_at: "2026-09-01T00:00:01.000Z",
    last_transition_by_user_id: "user_owner",
    last_transition_by_email_normalized: "owner@example.com",
    last_transition_at: "2026-09-01T00:00:01.000Z",
    last_transition_reason: "Reviewed initial binding",
    last_transition_action: "bind",
    last_transition_request_id: "request_1",
    last_transition_request_key: `telnyx:${integrationSecretId}:${destination}:request_1`,
    version: 1,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "last_transition_request_key")) {
    binding.last_transition_request_key = `${binding.binding_key}:${binding.last_transition_request_id}`;
  }
  return binding;
}

function makeStatefulClient({ publicKeyB64, secretOverrides = {}, secrets, bindings = [makeBinding()], consents = [] } = {}) {
  const entityCalls = [];
  const defaultSecret = {
    id: "integration_1",
    provider: "telnyx",
    api_key: "KEYtest",
    public_key: publicKeyB64,
    messaging_profile_id: "MP1",
    is_active: true,
    ...secretOverrides,
  };
  const data = {
    IntegrationSecret: secrets || [defaultSecret],
    TelecomDestinationBinding: bindings,
    SmsConsent: consents,
  };
  const matches = (row, query = {}) => Object.entries(query)
    .every(([key, value]) => row?.[key] === value);
  const entities = new Proxy({}, {
    get: (_target, nameValue) => {
      const name = String(nameValue);
      return {
        filter: async (query = {}, sort, limit = 5000) => {
          entityCalls.push({ name, operation: "filter", query, sort, limit });
          let rows = (data[name] || []).filter((row) => matches(row, query));
          if (sort === "-captured_at") {
            rows = [...rows].sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
          }
          return rows.slice(0, limit);
        },
        list: async (sort, limit = 5000) => {
          entityCalls.push({ name, operation: "list", sort, limit });
          return (data[name] || []).slice(0, limit);
        },
        create: async (row) => {
          entityCalls.push({ name, operation: "create", row });
          const created = { id: `${name}_${(data[name] || []).length + 1}`, ...row };
          (data[name] ||= []).push(created);
          return created;
        },
        update: async (id, patch) => {
          entityCalls.push({ name, operation: "update", id, patch });
          return { id, ...patch };
        },
      };
    },
  });
  return {
    client: { entities, asServiceRole: { entities } },
    data,
    entityCalls,
  };
}

function keywordEvent({
  eventId,
  occurredAt,
  messageId,
  keyword,
  from = "+13125550182",
  to = "+12155550100",
  profile = "MP1",
} = {}) {
  return {
    data: {
      id: eventId,
      occurred_at: occurredAt,
      event_type: "message.received",
      payload: {
        id: messageId,
        direction: "inbound",
        from: { phone_number: from },
        to: [{ phone_number: to }],
        messaging_profile_id: profile,
        autoresponse_type: keyword,
        text: keyword,
      },
    },
  };
}

test("TelecomDestinationBinding is a private versioned authority model", async () => {
  const schema = JSON5.parse(await readFile(BINDING_URL, "utf8"));
  assert.equal(schema.name, "TelecomDestinationBinding");
  assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
  for (const field of [
    "binding_key", "provider", "integration_secret_id", "destination_e164",
    "provider_number_id", "phone_number_id", "agency_id", "messaging_profile_id", "sms_inbound_enabled",
    "sms_outbound_enabled", "voice_inbound_enabled", "fax_inbound_enabled", "status", "source",
    "created_by_user_id", "created_by_user_email_normalized", "created_at", "activated_at",
    "last_transition_by_user_id", "last_transition_by_email_normalized", "last_transition_at",
    "last_transition_reason", "last_transition_action", "last_transition_request_id",
    "last_transition_request_key", "version",
  ]) {
    assert.ok(schema.required.includes(field), `${field} is required`);
  }
  assert.deepEqual(schema.properties.provider.enum, ["telnyx"]);
  assert.equal(schema.properties.version.type, "integer");
  assert.equal(schema.properties.version.minimum, 1);

  const mutator = /entities\.TelecomDestinationBinding\s*\.\s*(?:create|update|delete|bulkCreate|bulkUpdate|bulkDelete)\s*\(/;
  for (const directory of await readdir(FUNCTIONS_URL, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const source = await readFile(new URL(`${directory.name}/entry.ts`, FUNCTIONS_URL), "utf8").catch(() => "");
    assert.doesNotMatch(source, mutator, `${directory.name} cannot mutate immutable telecom authority`);
  }
});

test("every live consent broker uses composite authority while unsafe provider paths stay literally paused", async () => {
  const liveConsumers = [
    "handleTelnyxStatusWebhook",
    "sendSms",
    "sendTestSms",
    "sendFaxStatusNotification",
    "recordSmsConsent",
    "manageSmsConsent",
  ];
  for (const name of liveConsumers) {
    const source = await readFile(new URL(`${name}/entry.ts`, FUNCTIONS_URL), "utf8");
    assert.match(source, /<<<BEGIN SHARED HELPER: telnyxSmsAuthority/, `${name} uses the generated authority helper`);
    assert.doesNotMatch(
      source.slice(source.indexOf("Deno.serve")),
      /entities\.SmsConsent\s*\.\s*filter\s*\(\s*\{\s*phone_e164\s*:/,
      `${name} has no live phone-only consent read`,
    );
  }

  for (const name of ["sendSms", "sendTestSms", "sendFaxStatusNotification", "recordSmsConsent", "manageSmsConsent"]) {
    const source = await readFile(new URL(`${name}/entry.ts`, FUNCTIONS_URL), "utf8");
    assert.match(source.slice(source.indexOf("Deno.serve")), /requireOutbound:\s*true/, `${name} requires outbound capability`);
  }
  for (const name of ["recordSmsConsent", "manageSmsConsent"]) {
    const source = await readFile(new URL(`${name}/entry.ts`, FUNCTIONS_URL), "utf8");
    assert.match(
      source.slice(source.indexOf("Deno.serve")),
      /status === 'opted_in'[\s\S]{0,120}latest\.keywordStopActive/,
      `${name} cannot hide a keyword STOP behind intervening manual rows`,
    );
  }
  const consentManager = await readFile(new URL("manageSmsConsent/entry.ts", FUNCTIONS_URL), "utf8");
  assert.match(consentManager, /ambiguousScopes\.size > 0/);
  assert.match(consentManager, /code: 'sms_consent_latest_ambiguous'/);
  const sendSms = await readFile(new URL("sendSms/entry.ts", FUNCTIONS_URL), "utf8");
  assert.match(sendSms, /TELNYX_SMS_CONSENT_SCAN_LIMIT \+ 1/);
  assert.match(sendSms, /effectiveStatus: keywordStopActive \? 'opted_out'/);
  const webhook = await readFile(ENTRY_URL, "utf8");
  assert.match(webhook, /requireClaimedProfile:\s*true/);
  assert.match(webhook, /requireInbound:\s*true/);
  assert.match(webhook, /console\.error\('handleTelnyxStatusWebhook failed'\)/);
  assert.doesNotMatch(webhook, /handleTelnyxStatusWebhook error:[^\n]*error\?\.message/);

  const paused = [
    ["scheduleSms", "const SCHEDULED_SMS_CREATION_PAUSED = true;"],
    ["dispatchScheduledSms", "const SCHEDULED_SMS_DISPATCH_PAUSED = true;"],
    ["redriveFailedSms", "const SMS_REDRIVE_MIGRATION_PAUSED = true;"],
  ];
  for (const [name, literal] of paused) {
    const source = await readFile(new URL(`${name}/entry.ts`, FUNCTIONS_URL), "utf8");
    const handler = source.slice(source.indexOf("Deno.serve"));
    assert.ok(source.includes(literal), `${name} retains its literal pause`);
    assert.ok(
      handler.indexOf("status: 503") >= 0
        && handler.indexOf("status: 503") < handler.indexOf("entities.SmsConsent"),
      `${name} returns 503 before its legacy consent path`,
    );
  }
});

test("signed provider-classified STOP/START appends scoped, replay-safe consent only", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = rawEd25519PublicKeyB64(publicKey);
  // Exercise the valid reactivation shape as well as the initial-bind shape
  // used by the fail-closed cases below.
  const state = makeStatefulClient({
    publicKeyB64,
    bindings: [makeBinding({
      created_at: "2026-09-01T00:00:00.000Z",
      last_transition_action: "activate",
      suspended_at: "2026-09-01T00:00:00.500Z",
      version: 2,
    })],
  });
  const fetchCalls = [];
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  const originalMakeClient = globalThis.__inboundRoutingMakeClient;
  try {
    const handler = await loadHandler(
      () => state.client,
      async (...args) => {
        fetchCalls.push(args);
        return Response.json({ data: {} });
      },
    );

    const stop = keywordEvent({
      eventId: "event_stop_new",
      messageId: "message_stop_new",
      keyword: "STOP",
      occurredAt: "2026-09-05T12:00:02.000Z",
    });
    const stopResponse = await handler(signedWebhook(privateKey, stop));
    assert.equal(stopResponse.status, 200);
    assert.equal((await stopResponse.json()).consent_status, "opted_out");
    assert.equal(state.data.SmsConsent.length, 1);
    assert.deepEqual(
      {
        consent_key: state.data.SmsConsent[0].consent_key,
        agency_id: state.data.SmsConsent[0].agency_id,
        integration_secret_id: state.data.SmsConsent[0].integration_secret_id,
        messaging_profile_id: state.data.SmsConsent[0].messaging_profile_id,
        destination_binding_id: state.data.SmsConsent[0].destination_binding_id,
        destination_e164: state.data.SmsConsent[0].destination_e164,
        phone_e164: state.data.SmsConsent[0].phone_e164,
        provider_event_id: state.data.SmsConsent[0].provider_event_id,
        provider_message_id: state.data.SmsConsent[0].provider_message_id,
        captured_at: state.data.SmsConsent[0].captured_at,
      },
      {
        consent_key: "telnyx:integration_1:MP1:agency_a:+13125550182",
        agency_id: "agency_a",
        integration_secret_id: "integration_1",
        messaging_profile_id: "MP1",
        destination_binding_id: "binding_1",
        destination_e164: "+12155550100",
        phone_e164: "+13125550182",
        provider_event_id: "event_stop_new",
        provider_message_id: "message_stop_new",
        captured_at: "2026-09-05T12:00:02.000Z",
      },
    );

    // A delayed older START is retained as history but cannot become the live
    // state because captured_at comes from signed data.occurred_at.
    const staleStart = keywordEvent({
      eventId: "event_start_old",
      messageId: "message_start_old",
      keyword: "START",
      occurredAt: "2026-09-05T12:00:01.000Z",
    });
    assert.equal((await handler(signedWebhook(privateKey, staleStart))).status, 200);
    const ordered = [...state.data.SmsConsent]
      .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
    assert.equal(ordered[0].consent_status, "opted_out", "older START cannot supersede newer STOP");

    const replay = await handler(signedWebhook(privateKey, staleStart));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).deduped, true);
    assert.equal(state.data.SmsConsent.length, 2, "event replay does not append a second row");

    const conflictingReplay = keywordEvent({
      eventId: "event_start_old",
      messageId: "message_start_old",
      keyword: "STOP",
      occurredAt: "2026-09-05T12:00:01.000Z",
    });
    assert.equal(
      (await handler(signedWebhook(privateKey, conflictingReplay))).status,
      503,
      "a reused event id with conflicting consent content fails closed",
    );
    assert.equal(state.data.SmsConsent.length, 2, "a conflicting replay does not append");

    const newerStart = keywordEvent({
      eventId: "event_start_new",
      messageId: "message_start_new",
      keyword: "START",
      occurredAt: "2026-09-05T12:00:03.000Z",
    });
    assert.equal((await handler(signedWebhook(privateKey, newerStart))).status, 200);
    const newest = [...state.data.SmsConsent]
      .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at))[0];
    assert.equal(newest.consent_status, "opted_in");

    const help = keywordEvent({
      eventId: "event_help",
      messageId: "message_help",
      keyword: "HELP",
      occurredAt: "2026-09-05T12:00:04.000Z",
    });
    assert.equal(
      (await handler(signedWebhook(privateKey, help))).status,
      503,
      "HELP and all non-consent inbound handling retain the literal routing pause",
    );
    assert.equal(state.data.SmsConsent.length, 3, "HELP never becomes a consent event");
    assert.equal(fetchCalls.length, 0, "Telnyx owns the keyword autoresponse; the webhook sends no duplicate reply");

    for (const entity of ["User", "Patient", "AgencySettings", "SmsMessage", "Notification"]) {
      assert.equal(
        state.entityCalls.filter((call) => call.name === entity).length,
        0,
        `keyword handling never reads or writes ${entity}`,
      );
    }
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    globalThis.__inboundRoutingMakeClient = originalMakeClient;
  }
});

test("signed consent keywords fail closed without one exact active destination/profile authority", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = rawEd25519PublicKeyB64(publicKey);
  const baseEvent = keywordEvent({
    eventId: "event_stop_1",
    messageId: "message_stop_1",
    keyword: "STOP",
    occurredAt: "2026-09-05T12:00:00.000Z",
  });
  const missingProfileEvent = keywordEvent({
    eventId: "event_stop_1",
    messageId: "message_stop_1",
    keyword: "STOP",
    occurredAt: "2026-09-05T12:00:00.000Z",
  });
  delete missingProfileEvent.data.payload.messaging_profile_id;
  const cases = [
    {
      name: "inactive IntegrationSecret",
      expectedStatus: 401,
      options: { secretOverrides: { is_active: false } },
    },
    {
      name: "non-Telnyx IntegrationSecret",
      expectedStatus: 401,
      options: { secretOverrides: { provider: "other" } },
    },
    {
      name: "multiple active Telnyx credentials",
      options: {
        secrets: [
          {
            id: "integration_1", provider: "telnyx", is_active: true,
            api_key: "KEYtest", public_key: publicKeyB64, messaging_profile_id: "MP1",
          },
          {
            id: "integration_2", provider: "telnyx", is_active: true,
            api_key: "KEYother", public_key: publicKeyB64, messaging_profile_id: "MP2",
          },
        ],
      },
    },
    {
      name: "missing signed messaging profile",
      event: missingProfileEvent,
    },
    {
      name: "mismatched signed messaging profile",
      event: keywordEvent({
        eventId: "event_stop_1",
        messageId: "message_stop_1",
        keyword: "START",
        occurredAt: "2026-09-05T12:00:00.000Z",
        profile: "MP_OTHER",
      }),
    },
    {
      name: "missing webhook event identity",
      event: keywordEvent({
        messageId: "message_stop_1",
        keyword: "STOP",
        occurredAt: "2026-09-05T12:00:00.000Z",
      }),
    },
    {
      name: "missing provider occurrence time",
      event: keywordEvent({
        eventId: "event_stop_1",
        messageId: "message_stop_1",
        keyword: "STOP",
      }),
    },
    {
      name: "provider occurrence time is implausibly in the future",
      event: keywordEvent({
        eventId: "event_stop_1",
        messageId: "message_stop_1",
        keyword: "START",
        occurredAt: "2999-09-05T12:00:00.000Z",
      }),
    },
    { name: "missing destination binding", options: { bindings: [] } },
    {
      name: "inbound capability disabled",
      options: { bindings: [makeBinding({ sms_inbound_enabled: false })] },
    },
    {
      name: "missing lifecycle creator provenance",
      options: { bindings: [makeBinding({ created_by_user_id: undefined })] },
    },
    {
      name: "forged lifecycle request-key preimage",
      options: { bindings: [makeBinding({ last_transition_request_key: "telnyx:forged:request_1" })] },
    },
    {
      name: "initial bind carrying a later lifecycle version",
      options: { bindings: [makeBinding({ version: 2 })] },
    },
    {
      name: "initial bind transition actor differs from creator",
      options: { bindings: [makeBinding({
        last_transition_by_user_id: "user_other",
        last_transition_by_email_normalized: "other@example.com",
      })] },
    },
    {
      name: "reactivation without a prior suspension marker",
      options: { bindings: [makeBinding({ last_transition_action: "activate", version: 2 })] },
    },
    {
      name: "active transition timestamp differs from activation",
      options: { bindings: [makeBinding({ last_transition_at: "2026-09-01T00:00:02.000Z" })] },
    },
    {
      name: "missing non-SMS capability provenance",
      options: { bindings: [makeBinding({ voice_inbound_enabled: undefined })] },
    },
    {
      name: "active row carrying a revoked terminal marker",
      options: { bindings: [makeBinding({
        revoked_at: "2026-09-02T00:00:00.000Z",
        revocation_reason: "revoked",
      })] },
    },
    {
      name: "active row whose last transition is suspension",
      options: { bindings: [makeBinding({ last_transition_action: "suspend" })] },
    },
    {
      name: "invalid lifecycle timestamp order",
      options: { bindings: [makeBinding({ activated_at: "2026-08-31T23:59:59.000Z" })] },
    },
    {
      name: "unreconciled suspension marker on an active binding",
      options: { bindings: [makeBinding({ suspended_at: "2026-09-01T00:00:00.500Z" })] },
    },
    {
      name: "duplicate destination authority",
      options: {
        bindings: [
          makeBinding(),
          makeBinding({ id: "binding_duplicate", provider_number_id: "telnyx_number_2", phone_number_id: "phone_number_2" }),
        ],
      },
    },
    {
      name: "messaging profile spans tenants",
      options: {
        bindings: [
          makeBinding(),
          makeBinding({
            id: "binding_b",
            destination_e164: "+12155550101",
            binding_key: "telnyx:integration_1:+12155550101",
            provider_number_id: "telnyx_number_2",
            phone_number_id: "phone_number_2",
            agency_id: "agency_b",
          }),
        ],
      },
    },
  ];

  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  const originalMakeClient = globalThis.__inboundRoutingMakeClient;
  try {
    for (const scenario of cases) {
      const state = makeStatefulClient({ publicKeyB64, ...(scenario.options || {}) });
      const fetchCalls = [];
      const handler = await loadHandler(
        () => state.client,
        async (...args) => {
          fetchCalls.push(args);
          return Response.json({ data: {} });
        },
      );
      const response = await handler(signedWebhook(privateKey, scenario.event || baseEvent));
      assert.equal(response.status, scenario.expectedStatus || 503, scenario.name);
      assert.equal(state.data.SmsConsent.length, 0, `${scenario.name}: no consent row is written`);
      assert.equal(fetchCalls.length, 0, `${scenario.name}: no provider action is attempted`);
    }
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    globalThis.__inboundRoutingMakeClient = originalMakeClient;
  }
});

test("the same subscriber has independent consent scopes across provider profiles and tenants", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = rawEd25519PublicKeyB64(publicKey);
  const tenantA = makeStatefulClient({ publicKeyB64 });
  const tenantB = makeStatefulClient({
    publicKeyB64,
    secretOverrides: { id: "integration_2", messaging_profile_id: "MP2" },
    bindings: [makeBinding({
      id: "binding_2",
      binding_key: "telnyx:integration_2:+12155550200",
      integration_secret_id: "integration_2",
      destination_e164: "+12155550200",
      provider_number_id: "telnyx_number_2",
      phone_number_id: "phone_number_2",
      agency_id: "agency_b",
      messaging_profile_id: "MP2",
    })],
  });

  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;
  const originalMakeClient = globalThis.__inboundRoutingMakeClient;
  try {
    const handlerA = await loadHandler(() => tenantA.client, async () => Response.json({ data: {} }));
    const stopA = keywordEvent({
      eventId: "event_a",
      messageId: "message_a",
      keyword: "STOP",
      occurredAt: "2026-09-05T12:00:00.000Z",
    });
    assert.equal((await handlerA(signedWebhook(privateKey, stopA))).status, 200);

    const handlerB = await loadHandler(() => tenantB.client, async () => Response.json({ data: {} }));
    const startB = keywordEvent({
      eventId: "event_b",
      messageId: "message_b",
      keyword: "START",
      occurredAt: "2026-09-05T12:00:01.000Z",
      to: "+12155550200",
      profile: "MP2",
    });
    assert.equal((await handlerB(signedWebhook(privateKey, startB))).status, 200);

    assert.equal(tenantA.data.SmsConsent[0].phone_e164, tenantB.data.SmsConsent[0].phone_e164);
    assert.equal(tenantA.data.SmsConsent[0].consent_status, "opted_out");
    assert.equal(tenantB.data.SmsConsent[0].consent_status, "opted_in");
    assert.notEqual(tenantA.data.SmsConsent[0].consent_key, tenantB.data.SmsConsent[0].consent_key);
    assert.notEqual(tenantA.data.SmsConsent[0].agency_id, tenantB.data.SmsConsent[0].agency_id);
  } finally {
    globalThis.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    globalThis.__inboundRoutingMakeClient = originalMakeClient;
  }
});

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
  const verification = entry.indexOf("await verifyTelnyxSignature");
  const extraction = entry.indexOf("extractTelnyxEvent(body)");
  const smsGate = entry.indexOf("eventType === 'message.received' && INBOUND_PATIENT_SMS_ROUTING_PAUSED");
  const keywordBinding = entry.indexOf("handleInboundConsentKeyword(base44, telnyxCreds, event, payload)");
  const faxGate = entry.indexOf("eventType === 'fax.received' && INBOUND_PATIENT_FAX_ROUTING_PAUSED");
  const callGate = entry.indexOf("INBOUND_PATIENT_CALL_ROUTING_PAUSED && isInboundPatientCallEvent");
  const smsDispatch = entry.indexOf("return await handleInboundMessage");
  const faxDispatch = entry.indexOf("return await handleInboundFax");
  const callDispatch = entry.indexOf("return await handleCallEvent");
  assert.ok(verification >= 0 && verification < extraction, "signature verification precedes event extraction");
  assert.ok(
    extraction < smsGate && smsGate < keywordBinding && keywordBinding < smsDispatch,
    "signed extraction precedes the narrow keyword binding path and legacy SMS dispatch stays paused",
  );
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
            return [{ id: "integration_1", provider: "telnyx", api_key: "KEYtest", public_key: publicKeyB64, messaging_profile_id: "MP1", is_active: true }];
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
          // Text alone is not trusted as a carrier keyword classification. A
          // signed autoresponse_type and exact binding are required to carve out
          // STOP/START; every other inbound message remains paused.
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
