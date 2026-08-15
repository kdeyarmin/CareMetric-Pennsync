import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Drift guard for resolveTelnyxCreds, which is inlined (single-file Deno deploy
 * model) into every function that sends fax/SMS/voice or verifies an inbound
 * Telnyx webhook. It resolves credentials from the in-app IntegrationSecret row
 * ONLY — the TELNYX_* dashboard-env override path was retired. Since it gates
 * who can send/verify across all channels, a silent divergence between copies is
 * a security concern; this asserts every copy resolves each field it exposes
 * identically (and that no copy quietly re-grows an env read).
 *
 * The copies are now GENERATED from base44/_shared/backendHelpers.mjs, so
 * `pnpm run check:shared-helpers` catches a hand-edit textually and this test
 * catches it behaviourally. That belt-and-braces pairing is deliberate: the
 * TELNYX_* env fallback has been re-added by the Base44 builder bot twice
 * (2026-07-22 and 2026-08-05), and the bot edits the hosted function directly
 * — so the only guardrail it ever reads is the comment inside the helper body
 * itself. Keep that comment; it is load-bearing.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const js = transpileTs(src).outputText;
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
  "../functions/testTelnyxConnection/entry.ts": ALL,
  "../functions/sendSms/entry.ts": ALL,
  "../functions/sendFax/entry.ts": ALL,
  "../functions/startMaskedCall/entry.ts": ALL,
  "../functions/handleTelnyxStatusWebhook/entry.ts": ALL,
  "../functions/searchPurchaseTelnyxNumbers/entry.ts": ALL,
  "../functions/retryFailedFax/entry.ts": ALL,
  "../functions/autoRetryFailedFaxes/entry.ts": ALL,
  "../functions/sendBatchFax/entry.ts": ALL,
  "../functions/syncFaxStatuses/entry.ts": ALL,
  "../functions/pollFaxStatuses/entry.ts": ALL,
  "../functions/sendFaxStatusNotification/entry.ts": ALL,
  "../functions/sendTestSms/entry.ts": ALL,
  "../functions/dispatchScheduledSms/entry.ts": ALL,
  "../functions/redriveFailedSms/entry.ts": ALL,
  "../functions/discoverTelnyxResources/entry.ts": ALL,
  "../functions/createTelehealthToken/entry.ts": ["apiKey"],
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
    name: "retired env vars alone configure nothing",
    env: { TELNYX_API_KEY: "KEYenv", TELNYX_CONNECTION_ID: "VClegacy" },
    rows: [],
    expect: { apiKey: null, publicKey: null, messagingProfileId: null, voiceConnectionId: null, faxConnectionId: null },
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
        for (const f of fields) {
          assert.equal(got[f], scenario.expect[f], `${file} field ${f}`);
        }
      }
    } finally {
      globalThis.Deno.env.get = () => undefined;
    }
  });
}

// The read used to be unsorted with no is_active filter, taking rows[0] — and
// saveTelnyxSecret picks from the same unordered query, so with two telnyx rows
// the admin could be writing one row while the senders read another, and
// re-entering the key could never fix it.
test("resolveTelnyxCreds picks the active, populated row rather than whatever sorts first", async () => {
  const mod = await loadInline("../functions/sendFax/entry.ts", ["resolveTelnyxCreds"]);

  const shadowedByEmpty = await mod.resolveTelnyxCreds(makeBase44([
    { provider: "telnyx", api_key: "" },
    { provider: "telnyx", api_key: "KEYreal", fax_connection_id: "FCreal" },
  ]));
  assert.equal(shadowedByEmpty.apiKey, "KEYreal", "an empty row must not shadow the real one");
  assert.equal(shadowedByEmpty.faxConnectionId, "FCreal");

  const activeWins = await mod.resolveTelnyxCreds(makeBase44([
    { provider: "telnyx", api_key: "KEYstale", is_active: false },
    { provider: "telnyx", api_key: "KEYlive", is_active: true },
  ]));
  assert.equal(activeWins.apiKey, "KEYlive", "is_active must select the live credential");
});

// THE regression that keeps bringing the env fallback back: a failed credential
// READ used to be indistinguishable from "no credentials stored", so an operator
// with a perfectly good key was told to add the key. Both incidents (2026-07-22,
// 2026-08-05) ended with someone adding a TELNYX_* env fallback that had to be
// reverted. A read failure must say so, in every copy.
test("a failed IntegrationSecret read reports readError, not 'not configured'", async () => {
  const throwing = {
    asServiceRole: {
      entities: {
        IntegrationSecret: {
          filter: async () => { throw new Error("Service token is required to use asServiceRole"); },
        },
      },
    },
  };
  for (const file of Object.keys(FILES)) {
    const mod = await loadInline(file, ["resolveTelnyxCreds", "telnyxCredsMessage"]);
    const got = await mod.resolveTelnyxCreds(throwing);
    assert.equal(got.apiKey, null, `${file} must not invent a key`);
    assert.match(got.readError || "", /Service token is required/, `${file} must surface the read failure`);

    const message = mod.telnyxCredsMessage(got, "fax credentials");
    assert.match(message, /Could not read Telnyx fax credentials/, `${file} message must name a read failure`);
    assert.doesNotMatch(message, /add the API key/, `${file} must not tell the admin to re-enter a key that is not the problem`);

    // And the unconfigured case still reads as unconfigured.
    const absent = await mod.resolveTelnyxCreds(makeBase44([]));
    assert.equal(absent.readError, null, `${file} must not claim a read error when the row is simply absent`);
    assert.match(mod.telnyxCredsMessage(absent, "credentials"), /not configured/, `${file} unconfigured message`);
  }
});

// Coverage completeness: a new inline copy that nobody adds to FILES would be
// entirely unguarded — which is how four of the copies drifted in the first
// place. Assert the map covers every function that defines the helper, and that
// every copy sits inside the shared-helper markers so `check:shared-helpers`
// sees it too.
test("every inlined resolveTelnyxCreds copy is covered by this guard and generated", async () => {
  const functionsDir = new URL("../functions/", import.meta.url);
  const entries = await readdir(functionsDir, { withFileTypes: true });
  const definers = [];
  const unmarked = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rel = `../functions/${entry.name}/entry.ts`;
    let src;
    try { src = await readFile(new URL(rel, import.meta.url), "utf8"); } catch { continue; }
    if (!/^async function resolveTelnyxCreds\(base44\) \{/m.test(src)) continue;
    definers.push(rel);
    if (!src.includes("<<<BEGIN SHARED HELPER: resolveTelnyxCreds")) unmarked.push(entry.name);
  }

  assert.deepEqual(
    unmarked,
    [],
    `these copies are hand-maintained instead of generated from base44/_shared/backendHelpers.mjs: ${unmarked.join(", ")}`,
  );
  assert.deepEqual(
    definers.filter((f) => !(f in FILES)).sort(),
    [],
    "a function defines resolveTelnyxCreds but is missing from this test's FILES map",
  );
});
