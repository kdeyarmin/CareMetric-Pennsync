import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const CASES = [
  {
    name: 'checkStaleFollowUpRequests',
    marker: 'REFERRAL_STALE_ESCALATION_ENABLED = false',
    code: 'referral_stale_escalation_tenant_migration_pending',
  },
  {
    name: 'processInboundFaxes',
    marker: 'INBOUND_REFERRAL_FAX_MATCHING_ENABLED = false',
    code: 'inbound_referral_fax_tenant_binding_pending',
  },
  {
    name: 'extractReferralDataForSmartNote',
    marker: 'REFERRAL_SMART_NOTE_BRIDGE_ENABLED = false',
    code: 'referral_smart_note_tenant_broker_pending',
  },
];

async function loadPausedHandler(functionName) {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__referralContainmentCreateClient;',
  );
  const target = join(
    tmpdir(),
    `referral_containment_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__referralContainmentCreateClient = () => {
    throw new Error('paused path constructed the SDK client');
  };
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: () => { throw new Error('paused path read environment state'); } },
  };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
  }
  return handler;
}

test('legacy privileged Referral consumers stay paused before SDK, request, or PHI access', async () => {
  for (const scenario of CASES) {
    const source = await readFile(
      new URL(`../functions/${scenario.name}/entry.ts`, import.meta.url),
      'utf8',
    );
    assert.match(source, new RegExp(scenario.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const handler = await loadPausedHandler(scenario.name);
    assert.equal(typeof handler, 'function');
    const request = {
      json: async () => { throw new Error('paused path parsed a request body'); },
      headers: { get: () => { throw new Error('paused path read request headers'); } },
    };
    const response = await handler(request);
    const body = await response.json();
    assert.equal(response.status, 503, scenario.name);
    assert.equal(response.headers.get('cache-control'), 'no-store', scenario.name);
    assert.equal(body.code, scenario.code, scenario.name);
  }
});
