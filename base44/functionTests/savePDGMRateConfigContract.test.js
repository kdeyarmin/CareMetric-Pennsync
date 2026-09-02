import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

async function loadHandler(functionName) {
  const source = await readFile(new URL(`../functions/${functionName}/entry.ts`, import.meta.url), "utf8");
  const output = transpileTs(source).outputText;
  const temporaryModule = join(tmpdir(), `pdgm_rates_gate_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporaryModule, output);
  let handler;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  return handler;
}

test("PDGM rate writes are globally paused before reading the request", async () => {
  const handler = await loadHandler("savePDGMRateConfig");
  let bodyRead = false;
  const response = await handler({
    json: async () => {
      bodyRead = true;
      return { is_official: true, rates: { basePaymentRate: 999999 } };
    },
  });
  const json = await response.json();

  assert.equal(response.status, 409);
  assert.equal(bodyRead, false);
  assert.equal(json.configWritesAvailable, false);
  assert.equal(json.paymentAvailable, false);
  assert.match(json.message, /No PDGM rate set can be saved or marked official/i);
});

test("PDGM rate reads return no config before reading caller input", async () => {
  const handler = await loadHandler("getPDGMRateConfig");
  let bodyRead = false;
  const response = await handler({
    json: async () => {
      bodyRead = true;
      return { agency_id: "other-tenant" };
    },
  });
  const json = await response.json();

  assert.equal(response.status, 409);
  assert.equal(bodyRead, false);
  assert.equal(json.configReadsAvailable, false);
  assert.equal(json.config, null);
  assert.equal(json.paymentAvailable, false);
});

test("paused rate endpoints contain no service-role data access", async () => {
  for (const functionName of ["savePDGMRateConfig", "getPDGMRateConfig"]) {
    const source = await readFile(new URL(`../functions/${functionName}/entry.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /asServiceRole|\.auth\.me\s*\(|req\.json\s*\(/);
  }
});

test("PDGM rate entity remains service-role-only", async () => {
  const schema = JSON.parse(await readFile(new URL("../entities/PDGMRateConfig.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(schema.rls.read, { user_condition: { role: "__service_role_only__" } });
  assert.deepEqual(schema.rls.write, { user_condition: { role: "__service_role_only__" } });
});
