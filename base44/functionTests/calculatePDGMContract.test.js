import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transpileTs } from "../../tools-transpile-ts.mjs";

async function loadHandler({ flipGlobalFlagOnly = false } = {}) {
  let source = await readFile(new URL("../functions/calculatePDGM/entry.ts", import.meta.url), "utf8");
  if (flipGlobalFlagOnly) {
    const flipped = source.replace(
      "const PDGM_REIMBURSEMENT_ENABLED = false;",
      "const PDGM_REIMBURSEMENT_ENABLED = true;",
    );
    assert.notEqual(flipped, source, "test must flip only the raw global flag");
    source = flipped;
  }
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    "const createClientFromRequest = globalThis.__pdgmMakeClient;",
  );
  const output = transpileTs(source).outputText;
  const temporaryModule = join(tmpdir(), `pdgm_gate_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporaryModule, output);

  let handler;
  const calls = { client: 0, auth: 0, requestJson: 0, agencySettings: 0, rateConfig: 0 };
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: () => undefined } };
  globalThis.__pdgmMakeClient = () => {
    calls.client += 1;
    return {
      auth: { me: async () => { calls.auth += 1; return { id: "u1", role: "admin" }; } },
      asServiceRole: {
        entities: {
          AgencySettings: {
            filter: async () => { calls.agencySettings += 1; return []; },
            list: async () => { calls.agencySettings += 1; return []; },
          },
          PDGMRateConfig: {
            filter: async () => { calls.rateConfig += 1; return []; },
            list: async () => { calls.rateConfig += 1; return []; },
          },
        },
      },
    };
  };

  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  return { handler, calls };
}

async function call(handler, body = {}) {
  const response = await handler({ json: async () => body });
  return { status: response.status, json: await response.json() };
}

test("global PDGM gate refuses every reimbursement result with explicit nulls", async () => {
  const { handler } = await loadHandler();
  const { status, json } = await call(handler, {
    pdgmData: {
      primary_diagnosis_code: "I50.9",
      functional_scores: { m1800_grooming: "1" },
    },
  });

  assert.equal(status, 409);
  assert.equal(json.featureEnabled, false);
  assert.equal(json.calculationStatus, "blocked");
  assert.equal(json.paymentAvailable, false);
  assert.equal(json.payment, null);
  assert.equal(json.totalPayment, null);
  assert.equal(json.caseMixWeight, null);
  assert.equal(json.original.paymentAvailable, false);
  assert.equal(json.original.totalPayment, null);
  assert.equal(json.original.caseMixWeight, null);
  assert.equal(json.original.clinicalGroup, null);
  assert.equal(json.corrected, null);
  assert.equal(json.revenueDifference, null);
  assert.equal(json.percentageIncrease, null);
  assert.equal(json.financialImpact, null);
  assert.equal(json.wageIndexApplied, null);
  assert.match(json.message, /unavailable.*not a \$0 result/i);
});

test("independent retirement lock still blocks a global-flag-only source edit", async () => {
  const { handler, calls } = await loadHandler({ flipGlobalFlagOnly: true });
  const { status, json } = await call(handler, {
    is_official: true,
    pdgmData: { totalPayment: 999999, caseMixWeight: 9.99 },
  });

  assert.equal(status, 409);
  assert.equal(json.featureEnabled, false);
  assert.equal(json.paymentAvailable, false);
  assert.equal(json.totalPayment, null);
  assert.equal(json.original.totalPayment, null);
  assert.equal(json.rateBasis.isOfficial, false);
  assert.deepEqual(calls, {
    client: 0,
    auth: 0,
    requestJson: 0,
    agencySettings: 0,
    rateConfig: 0,
  });
});

test("disabled handler returns before client, auth, body parsing, or service-role reads", async () => {
  const { handler, calls } = await loadHandler();
  const response = await handler({
    json: async () => {
      calls.requestJson += 1;
      throw new Error("request body must not be read");
    },
  });

  assert.equal(response.status, 409);
  assert.deepEqual(calls, {
    client: 0,
    auth: 0,
    requestJson: 0,
    agencySettings: 0,
    rateConfig: 0,
  });
});

test("forged payment, official, corrected, and alternative payloads are ignored", async () => {
  const { handler } = await loadHandler();
  const { json } = await call(handler, {
    paymentAvailable: true,
    totalPayment: 999999,
    is_official: true,
    pdgmData: { totalPayment: 999999, caseMixWeight: 9.99 },
    correctedPdgmData: { totalPayment: 1999999, caseMixWeight: 19.99 },
    alternativeScenarios: { available: true, maxPayment: 9999999 },
  });

  assert.equal(json.paymentAvailable, false);
  assert.equal(json.totalPayment, null);
  assert.equal(json.original.totalPayment, null);
  assert.equal(json.corrected, null);
  assert.equal(json.alternativeScenarios.available, false);
  assert.deepEqual(json.alternativeScenarios.scenarios, {});
  assert.equal(json.alternativeScenarios.maxPayment, null);
  assert.equal(json.rateBasis.isOfficial, false);
});

test("response names the independent CMS grouper and functional-definition blockers", async () => {
  const { handler } = await loadHandler();
  const { json } = await call(handler);

  assert.ok(json.blockers.some((blocker) => blocker.code === "cms_432_group_grouper_unavailable"));
  assert.match(json.blockers[0].message, /432-group/i);
  for (const item of ["M1800", "M1810", "M1820", "M1850"]) {
    assert.ok(json.missing.some((entry) => entry.includes(item)), `${item} must be named`);
  }
  assert.ok(json.actionRequired.every((action) => /official EMR\/CMS-approved grouper/i.test(action)));
});

test("the default-off state ignores caller-controlled identity claims", async () => {
  const { handler } = await loadHandler();
  const forgedClaims = {
    role: "admin",
    account_type: "super_admin",
    agency_id: "other-tenant",
    agency_name: "other-tenant",
    is_active: true,
  };
  const { status, json } = await call(handler, { user: forgedClaims, paymentAvailable: true, totalPayment: 1 });
  assert.equal(status, 409);
  assert.equal(json.featureEnabled, false);
  assert.equal(json.totalPayment, null);
});
