import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";
import { mapFaxStatus } from "../../src/components/integrations/telnyx/telnyxUtils.js";
import * as correlation from "../../src/components/fax/faxProviderCorrelation.js";

/**
 * Drift guard for the Telnyx fax STATUS readers. The webhook and the poller
 * each inline mapFaxStatus; until 2026-10-09 the poller's copy was a
 * case-sensitive lookup table, so the same provider status could map in one and
 * not the other. Both must now answer exactly what telnyxUtils.mapFaxStatus
 * answers, and every reader of a provider failure must classify it with the
 * field Telnyx documents (internal_failure_reason), never failure_code /
 * error_code, which the Fax resource and fax.failed payload do not have.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const tmp = join(tmpdir(), `faxstatus_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${transpileTs(src).outputText}\nexport { ${names.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// Telnyx's Fax `status` enum (OpenAPI, 2026-10-09), the legacy aliases, case
// variants, and values that must stay unknown.
const TELNYX_FAX_STATUSES = ["queued", "media.processing", "media.processed", "originated", "sending",
  "delivered", "failed", "initiated", "receiving", "received"];
const STATUSES = [...TELNYX_FAX_STATUSES, "sent", "cancelled", "canceled",
  "QUEUED", "Delivered", "MEDIA.PROCESSED", "Failed", "bogus", "", null, undefined];

const STATUS_READERS = [
  "../functions/handleTelnyxStatusWebhook/entry.ts",
  "../functions/pollFaxStatuses/entry.ts",
];

test("every inlined fax status reader maps exactly like telnyxUtils.mapFaxStatus", async () => {
  for (const file of STATUS_READERS) {
    const inline = await loadInline(file, ["mapFaxStatus"]);
    for (const status of STATUSES) {
      assert.equal(inline.mapFaxStatus(status), mapFaxStatus(status), `${file}: mapFaxStatus(${JSON.stringify(status)})`);
    }
  }
});

test("the canonical fax status map covers the documented outbound lifecycle and nothing inbound", () => {
  assert.equal(mapFaxStatus("media.processing"), "queued");
  assert.equal(mapFaxStatus("media.processed"), "sending");
  assert.equal(mapFaxStatus("Delivered"), "delivered");
  for (const inbound of ["initiated", "receiving", "received"]) assert.equal(mapFaxStatus(inbound), null, inbound);
});

const CORRELATION_CONSUMERS = [
  "../functions/sendFax/entry.ts",
  "../functions/sendBatchFax/entry.ts",
  "../functions/sendAuthorizedReferralFax/entry.ts",
  "../functions/handleTelnyxStatusWebhook/entry.ts",
];

test("every inlined fax correlation copy round-trips with the canonical module", async () => {
  const ids = ["FaxLog_1", "69a0f1c2e3b4", " padded", "$where", "x".repeat(201), "", null, 7];
  const urls = [
    ["https://app/api/apps/a/functions/sendFax", "sendFax"],
    ["https://app/functions/sendFax/", "sendFax"],
    ["https://app/", "sendFax"],
    ["https://app/functions/sendBatchFax", "sendFax"],
    ["http://app/functions/sendFax", "sendFax"],
    ["not a url", "sendFax"],
  ];
  const payloads = [{ fax_id: "f1" }, { id: "f1" }, { fax_id: "f1", id: "f1" }, { fax_id: "f1", id: "f2" }, {}, null];
  for (const file of CORRELATION_CONSUMERS) {
    const inline = await loadInline(file, [
      "encodeFaxClientState", "decodeFaxClientState", "faxEventProviderId", "faxStatusWebhookUrl",
    ]);
    for (const kind of ["outbound", "office_forward", "other"]) {
      for (const id of ids) {
        const encoded = inline.encodeFaxClientState(kind, id);
        assert.equal(encoded, correlation.encodeFaxClientState(kind, id), `${file}: encode(${kind}, ${id})`);
        assert.deepEqual(correlation.decodeFaxClientState(encoded), inline.decodeFaxClientState(encoded), `${file}: decode`);
      }
    }
    for (const [url, name] of urls) {
      assert.equal(inline.faxStatusWebhookUrl(url, name), correlation.faxStatusWebhookUrl(url, name), `${file}: ${url}`);
    }
    for (const payload of payloads) {
      assert.deepEqual(inline.faxEventProviderId(payload), correlation.faxEventProviderId(payload), `${file}: ${JSON.stringify(payload)}`);
    }
  }
});

test("fax failure readers classify with internal_failure_reason, never an undocumented code field", async () => {
  for (const file of [
    "../functions/handleTelnyxStatusWebhook/entry.ts",
    "../functions/pollFaxStatuses/entry.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.(failure_code|error_code)\b/, `${file}: reads a field Telnyx does not send`);
    assert.match(source, /errorCode:\s*[\w?.]*\.internal_failure_reason/, `${file}: classifies with internal_failure_reason`);
  }
});

test("every outbound fax sender records the provider's detail before its title", async () => {
  const expectations = {
    sendFax: /firstErr\?\.detail\s*\|\|\s*firstErr\?\.title/,
    sendBatchFax: /boundedLabel\(provider\?\.errors\?\.\[0\]\?\.detail\)\s*\|\|\s*boundedLabel\(provider\?\.errors\?\.\[0\]\?\.title\)/,
    sendAuthorizedReferralFax: /boundedLabel\(firstError\?\.detail\)\s*\|\|\s*boundedLabel\(firstError\?\.title\)/,
  };
  for (const [name, pattern] of Object.entries(expectations)) {
    const source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), "utf8");
    assert.match(source, pattern, name);
  }
});
