import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/**
 * Drift guard for resolveTelnyxCreds, which is inlined (single-file Deno deploy
 * model) into every Telnyx function: testTelnyxConnection, sendTelnyxSms,
 * sendTelnyxFax, startTelnyxCall, handleTelnyxStatusWebhook (and the apiKey-only
 * copy in createTelnyxVideoToken). It resolves Telnyx credentials from the
 * in-app IntegrationSecret row first — the TELNYX_* dashboard-env override path
 * was retired for interactive functions. Exception: the three SCHEDULED fax
 * functions (autoRetryFailedFaxes, sendBatchFax, syncFaxStatuses) keep an
 * app-level-secret fallback (TELNYX_API_KEY / TELNYX_CONNECTION_ID) so cron
 * jobs still run before an admin has saved Telnyx config in-app; the DB row
 * always wins when present. Since resolution gates who can send/verify across
 * all four channels, a silent divergence between copies is a security concern;
 * this asserts every copy resolves each field it exposes identically (and that
 * no copy outside the scheduled-fax allowlist quietly re-grows an env read).
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const tmp = join(tmpdir(), `tnxcreds_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${names.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// file -> the credential fields that copy actually returns. Provider-neutral
// function names (sendSms, sendFax, startMaskedCall, createTelehealthToken) now
// run on Telnyx; createTelehealthToken keeps an apiKey-only copy.
const ALL = ["apiKey", "publicKey", "messagingProfileId", "voiceConnectionId", "faxConnectionId"];
const FILES = {
  "./testTelnyxConnection/entry.ts": ALL,
  "./sendSms/entry.ts": ALL,
  "./sendFax/entry.ts": ALL,
  "./startMaskedCall/entry.ts": ALL,
  "./handleTelnyxStatusWebhook/entry.ts": ALL,
  "./searchPurchaseTelnyxNumbers/entry.ts": ALL,
  "./retryFailedFax/entry.ts": ALL,
  "./autoRetryFailedFaxes/entry.ts": ALL,
  "./sendBatchFax/entry.ts": ALL,
  "./syncFaxStatuses/entry.ts": ALL,
  "./pollFaxStatuses/entry.ts": ALL,
  "./sendFaxStatusNotification/entry.ts": ALL,
  "./sendTestSms/entry.ts": ALL,
  "./dispatchScheduledSms/entry.ts": ALL,
  "./redriveFailedSms/entry.ts": ALL,
  "./createTelehealthToken/entry.ts": ["apiKey"],
};

const SCENARIOS = [
  {
    name: "resolves every field from the in-app IntegrationSecret",
    env: {},
    rows: [{ api_key: "KEYdb", public_key: "PUBdb", messaging_profile_id: "MPdb", voice_connection_id: "VCdb", fax_connection_id: "FCdb" }],
    expect: { apiKey: "KEYdb", publicKey: "PUBdb", messagingProfileId: "MPdb", voiceConnectionId: "VCdb", faxConnectionId: "FCdb" },
  },
  {
    name: "blank stored values resolve to null",
    env: {},
    rows: [{ api_key: "KEYdb", public_key: "  ", messaging_profile_id: "" }],
    expect: { apiKey: "KEYdb", publicKey: null, messagingProfileId: null, voiceConnectionId: null, faxConnectionId: null },
  },
  {
    name: "retired TELNYX_* env vars are ignored (IntegrationSecret only)",
    env: {
      TELNYX_API_KEY: "KEYenv", TELNYX_PUBLIC_KEY: "PUBenv", TELNYX_MESSAGING_PROFILE_ID: "MPenv",
      TELNYX_VOICE_CONNECTION_ID: "VCenv", TELNYX_CONNECTION_ID: "VClegacy", TELNYX_FAX_CONNECTION_ID: "FCenv",
    },
    rows: [{ api_key: "KEYdb", public_key: "PUBdb", messaging_profile_id: "MPdb", voice_connection_id: "VCdb", fax_connection_id: "FCdb" }],
    expect: { apiKey: "KEYdb", publicKey: "PUBdb", messagingProfileId: "MPdb", voiceConnectionId: "VCdb", faxConnectionId: "FCdb" },
  },
  {
    name: "retired env vars alone configure nothing (except the scheduled-fax fallback)",
    env: { TELNYX_API_KEY: "KEYenv", TELNYX_CONNECTION_ID: "VClegacy" },
    rows: [],
    expect: { apiKey: null, publicKey: null, messagingProfileId: null, voiceConnectionId: null, faxConnectionId: null },
    // Scheduled fax jobs deliberately fall back to app-level secrets so they
    // keep running before the in-app Telnyx config has been saved.
    overrides: {
      "./autoRetryFailedFaxes/entry.ts": { apiKey: "KEYenv", faxConnectionId: "VClegacy" },
      "./sendBatchFax/entry.ts": { apiKey: "KEYenv", faxConnectionId: "VClegacy" },
      "./syncFaxStatuses/entry.ts": { apiKey: "KEYenv" },
    },
  },
  {
    name: "no creds anywhere → nulls",
    env: {},
    rows: [],
    expect: { apiKey: null, publicKey: null, messagingProfileId: null, voiceConnectionId: null, faxConnectionId: null },
  },
];

const makeBase44 = (rows) => ({
  asServiceRole: { entities: { IntegrationSecret: { filter: async () => rows } } },
});

for (const scenario of SCENARIOS) {
  test(`resolveTelnyxCreds parity — ${scenario.name}`, async () => {
    globalThis.Deno.env.get = (k) => scenario.env[k];
    try {
      for (const [file, fields] of Object.entries(FILES)) {
        const mod = await loadInline(file, ["resolveTelnyxCreds"]);
        const got = await mod.resolveTelnyxCreds(makeBase44(scenario.rows));
        const expected = { ...scenario.expect, ...(scenario.overrides?.[file] || {}) };
        for (const f of fields) {
          assert.equal(got[f], expected[f], `${file} field ${f}`);
        }
      }
    } finally {
      globalThis.Deno.env.get = () => undefined;
    }
  });
}
