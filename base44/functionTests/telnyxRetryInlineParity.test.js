import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

import * as telnyxRetry from "../../src/components/voice/telnyxRetry.js";

/**
 * Drift guard for the Telnyx retry policy the four outbound functions inline
 * (single-file Deno deploy). src/components/voice/telnyxRetry.js is the
 * unit-tested source. None of POST /v2/messages or POST /v2/calls takes an
 * idempotency key, so a copy that still retried 500/502/504 — or a thrown
 * timeout — could text or call a patient twice; this pins every copy to the
 * module status by status, and drives each copy's retry loop.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(name, exportNames) {
  let src = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const js = transpileTs(src).outputText;
  const tmp = join(tmpdir(), `tnxretry_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${exportNames.join(", ")} };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const COPIES = {
  sendSms: "sendWithRetry",
  sendTestSms: "sendWithRetry",
  startMaskedCall: "originateWithRetry",
  dispatchScheduledSms: "sendTelnyx",
};

test("every inline copy retries exactly the statuses telnyxRetry.js retries", async () => {
  assert.deepEqual([...telnyxRetry.RETRYABLE_STATUSES].sort(), [408, 425, 429, 503]);
  for (const name of Object.keys(COPIES)) {
    const inline = await loadInline(name, ["RETRYABLE_STATUSES", "isRetryableStatus"]);
    assert.deepEqual([...inline.RETRYABLE_STATUSES].sort(), [...telnyxRetry.RETRYABLE_STATUSES].sort(), name);
    for (let status = 100; status <= 599; status += 1) {
      assert.equal(inline.isRetryableStatus(status), telnyxRetry.isRetryableStatus(status), `${name}: ${status}`);
    }
  }
});

test("no inline retry loop re-sends an outcome-unknown 5xx or a thrown timeout", async () => {
  for (const [name, loop] of Object.entries(COPIES)) {
    if (name === "dispatchScheduledSms") continue; // its loop owns the fetch; driven below
    const inline = await loadInline(name, [loop]);
    for (const status of [500, 502, 504]) {
      let calls = 0;
      const result = await inline[loop](async () => {
        calls += 1;
        return { ok: false, status, retryAfter: "0" };
      });
      assert.equal(calls, 1, `${name}: ${status} is sent once`);
      assert.equal(result.status, status);
    }
    let calls = 0;
    await assert.rejects(inline[loop](async () => {
      calls += 1;
      throw Object.assign(new Error("The signal has been aborted"), { name: "AbortError" });
    }));
    assert.equal(calls, 1, `${name}: a thrown timeout is never retried`);
    // A 503 proves the request was not processed, so it is retried.
    const statuses = [503, 200];
    calls = 0;
    const retried = await inline[loop](async () => {
      const status = statuses[calls];
      calls += 1;
      return { ok: status === 200, status, retryAfter: "0" };
    });
    assert.equal(calls, 2, `${name}: 503 is retried`);
    assert.equal(retried.ok, true);
  }
});

test("dispatchScheduledSms's send loop follows the same policy", async () => {
  const inline = await loadInline("dispatchScheduledSms", ["sendTelnyx"]);
  const originalFetch = globalThis.fetch;
  try {
    for (const [statuses, expectedCalls] of [[[502, 200], 1], [[504, 200], 1], [[500, 200], 1], [[429, 200], 2], [[503, 200], 2]]) {
      let calls = 0;
      globalThis.fetch = async () => {
        const status = statuses[calls];
        calls += 1;
        return new Response(JSON.stringify(status === 200 ? { data: { id: "m1" } } : { errors: [] }), {
          status, headers: { "retry-after": "0" },
        });
      };
      await inline.sendTelnyx("KEY", "MP1", "+12155550100", "+13125550182", "hi", undefined);
      assert.equal(calls, expectedCalls, `first answer ${statuses[0]}`);
    }
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw Object.assign(new Error("The signal has been aborted"), { name: "AbortError" });
    };
    await assert.rejects(inline.sendTelnyx("KEY", "MP1", "+12155550100", "+13125550182", "hi", undefined));
    assert.equal(calls, 1, "a thrown timeout is never retried");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
