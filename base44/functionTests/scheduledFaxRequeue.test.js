import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

/**
 * Guards the requeue-vs-destroy decision in the two scheduled-fax processors.
 *
 * Both used to mark a ScheduledFax row 'failed' whenever sendBatchFax reported
 * anything other than success — including when it had rejected the whole batch
 * before dispatching a single recipient (unreadable Telnyx credentials being the
 * case that actually happened). Because both crons only ever read
 * status:'pending', that permanently destroyed the queued PHI document: fixing
 * the credentials sent none of them, and there is no UI anywhere that lists or
 * requeues ScheduledFax rows.
 *
 * The decision is genuinely two-sided, which is why it is pinned here:
 *  - requeue something that WAS partially transmitted and Telnyx re-faxes PHI
 *    (there is no client idempotency key);
 *  - fail something that was never dispatched and the document is gone for good.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `schedfax_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${names.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const FILES = [
  "../functions/processScheduledFaxes/entry.ts",
  "../functions/processScheduledFaxesByPriority/entry.ts",
];

const CASES = [
  {
    name: "credentials unreadable (500, no accounting) → requeue, never destroy",
    payload: { error: "Could not read Telnyx fax credentials — the stored-credential lookup failed (…)." },
    status: 500,
    requeue: true,
  },
  {
    name: "credentials not configured (500, no accounting) → requeue",
    payload: { error: "Telnyx fax credentials not configured — add the API key in Admin › Telnyx (…)." },
    status: 500,
    requeue: true,
  },
  {
    name: "every recipient attempted and failed → terminal, do NOT re-fax",
    payload: { error: "All recipients failed", successful: 0, failed: 3 },
    status: 200,
    requeue: false,
  },
  {
    name: "partial success → terminal, re-faxing would duplicate PHI",
    payload: { successful: 2, failed: 1 },
    status: 200,
    requeue: false,
  },
  {
    name: "full success → terminal",
    payload: { successful: 3, failed: 0 },
    status: 200,
    requeue: false,
  },
  {
    name: "disallowed file_url (400) → terminal; retrying can never succeed and nothing lists stuck rows",
    payload: { error: "Invalid or disallowed file_url" },
    status: 400,
    requeue: false,
  },
  {
    name: "unknown status with no accounting → requeue (a stuck row is recoverable, a destroyed document is not)",
    payload: { error: "Telnyx credentials not configured" },
    status: undefined,
    requeue: true,
  },
];

for (const file of FILES) {
  for (const c of CASES) {
    test(`${file.split("/").at(-2)} — ${c.name}`, async () => {
      const mod = await loadInline(file, ["batchNeverDispatched"]);
      assert.equal(mod.batchNeverDispatched(c.payload, c.status), c.requeue);
    });
  }

  test(`${file.split("/").at(-2)} — a missing payload is not treated as never-dispatched`, async () => {
    const mod = await loadInline(file, ["batchNeverDispatched"]);
    assert.equal(mod.batchNeverDispatched(undefined, 500), false);
    assert.equal(mod.batchNeverDispatched(null, undefined), false);
    assert.equal(mod.batchNeverDispatched({}, 500), false);
  });
}
