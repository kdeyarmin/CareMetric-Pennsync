import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import * as faxRetry from "../../src/components/fax/faxRetry.js";

/**
 * Drift guard for the fax retry policy mirrored into handleTelnyxStatusWebhook
 * and autoRetryFailedFaxes. Transpiles each inline copy and asserts it behaves
 * identically to src/components/fax/faxRetry.js (the unit-tested source).
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

async function loadInline(entryPath, names) {
  let src = await readFile(new URL(entryPath, import.meta.url), "utf8");
  src = src.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, "const createClientFromRequest = () => ({});");
  const present = names.filter((n) => new RegExp(`(function|const)\\s+${n}\\b`).test(src));
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const tmp = join(tmpdir(), `faxinline_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tmp, `${js}\nexport { ${present.join(", ")} };\n`);
  try {
    return { mod: await import(pathToFileURL(tmp).href), present };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

const CONFIGS = [undefined, {}, { auto_retry_enabled: false }, { max_retries: 5, retry_delay_minutes: 10 }, { priority_multiplier: { urgent: 0.5, low: 2 } }];
const FAILURES = [["7211", "not a fax machine"], [null, "busy"], ["", ""], [null, "Invalid To number"], ["x", "temporary network error"]];

test("inline classifyFaxFailure matches faxRetry across both functions", async () => {
  for (const f of ["./handleTelnyxStatusWebhook/entry.ts", "./autoRetryFailedFaxes/entry.ts"]) {
    const { mod } = await loadInline(f, ["classifyFaxFailure"]);
    for (const [code, msg] of FAILURES) {
      assert.equal(mod.classifyFaxFailure(code, msg), faxRetry.classifyFaxFailure(code, msg), `classifyFaxFailure drift in ${f}`);
    }
  }
});

test("inline faxRetryConfig matches faxRetry across both functions", async () => {
  for (const f of ["./handleTelnyxStatusWebhook/entry.ts", "./autoRetryFailedFaxes/entry.ts"]) {
    const { mod } = await loadInline(f, ["faxRetryConfig"]);
    for (const cfg of CONFIGS) {
      assert.deepEqual(mod.faxRetryConfig(cfg), faxRetry.faxRetryConfig(cfg), `faxRetryConfig drift in ${f}`);
    }
  }
});

test("inline nextRetryDelayMinutes matches across both functions", async () => {
  for (const f of ["./handleTelnyxStatusWebhook/entry.ts", "./autoRetryFailedFaxes/entry.ts"]) {
    const { mod } = await loadInline(f, ["nextRetryDelayMinutes"]);
    for (const cfg of CONFIGS) {
      for (const attempt of [0, 1, 2, 5]) {
        for (const pri of ["normal", "urgent", "low"]) {
          assert.equal(
            mod.nextRetryDelayMinutes(attempt, cfg, pri),
            faxRetry.nextRetryDelayMinutes(attempt, cfg, pri),
            `nextRetryDelayMinutes drift in ${f} cfg=${JSON.stringify(cfg)} a=${attempt} p=${pri}`,
          );
        }
      }
    }
  }
});

test("inline planFaxRetry matches (webhook + telnyx mirror)", async () => {
  const now = Date.parse("2026-06-04T12:00:00Z");
  for (const f of ["./handleTelnyxStatusWebhook/entry.ts"]) {
    const { mod } = await loadInline(f, ["planFaxRetry"]);
    for (const [code, msg] of FAILURES) {
      for (const retryCount of [0, 2, 3]) {
        const a = mod.planFaxRetry({ retryCount, errorCode: code, errorMessage: msg, config: { max_retries: 3 }, now });
        const b = faxRetry.planFaxRetry({ retryCount, errorCode: code, errorMessage: msg, config: { max_retries: 3 }, now });
        assert.deepEqual(a, b, `planFaxRetry drift in ${f} code=${code} msg=${msg} n=${retryCount}`);
      }
    }
  }
});

test("inline isFaxRetryDue matches faxRetry (cron)", async () => {
  const { mod } = await loadInline("./autoRetryFailedFaxes/entry.ts", ["isFaxRetryDue"]);
  const base = { status: "failed", document_url: "u", retry_count: 1, next_retry_at: "2026-06-04T12:00:00Z" };
  const now = Date.parse("2026-06-04T12:05:00Z");
  const cases = [
    [base, undefined],
    [{ ...base, next_retry_at: "2026-06-04T13:00:00Z" }, undefined],
    [{ ...base, status: "delivered" }, undefined],
    [{ ...base, document_url: "" }, undefined],
    [{ ...base, retry_count: 4 }, { max_retries: 3 }],
    [base, { auto_retry_enabled: false }],
  ];
  for (const [fax, cfg] of cases) {
    assert.equal(mod.isFaxRetryDue(fax, now, cfg), faxRetry.isFaxRetryDue(fax, now, cfg), `isFaxRetryDue drift ${JSON.stringify(fax)}`);
  }
});
