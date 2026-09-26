/**
 * The bulk read handlers' response allowance, derived rather than declared.
 *
 * `maxResponseBytes` defaults to 1 MiB in `callFunction`, and the five
 * compliance list capabilities are the first handlers whose own SQL row ceiling
 * is larger than that default can carry. A page at the ceiling with every value
 * NULL is already over it for three of the five, so left at the default a
 * compliance screen asking for the page its Base44 original asked for would get
 * `INVALID_AUTHORITY_RESPONSE` for the whole screen.
 *
 * Two things are proved here, and the second is the one that matters. The
 * allowance is compared against a floor READ OUT of the contract migration —
 * each capability's projected keys and its own ceiling — so widening a
 * projection or raising a ceiling fails this suite rather than a screen. And
 * the allowance is then shown to be IN EFFECT, by driving a body larger than
 * the default through the real client: a map entry nothing consults would pass
 * every assertion about its own contents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_TARGETS, BULK_RESPONSE_BYTES, STAGING_APP_ID, createStagingAuthorityClient } from './client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE,
  '../authority-store/supabase/record-migrations/20260920650000_contract_compliance_reads.sql');

/** The client's own default, restated here so a change to it fails this suite. */
const DEFAULT_RESPONSE_BYTES = 1024 * 1024;

/** Handler name to the contract function whose ceiling and projection bound it. */
const CAPABILITIES = Object.freeze({
  listAgencyIncidents: 'contract_incident_list',
  listComplianceAudits: 'contract_compliance_audit_list',
  listAdrAuditCases: 'contract_adr_case_list',
  listPersonnelCredentials: 'contract_personnel_credential_list',
  listPolicyAcknowledgments: 'contract_policy_acknowledgment_list',
});

/**
 * One capability's row ceiling and projected key count, out of the SQL.
 *
 * The body runs from its own `create function` line to the next one, so a
 * projection cannot be read off the wrong capability. Both parses are FLOORED:
 * a regex that stopped matching would otherwise report a zero-byte row and pass
 * every comparison below while measuring nothing, which is how a guard comes to
 * read correctly and do nothing.
 */
function bounds(sql, fn) {
  const start = sql.indexOf(`create function "pennsync_records".${fn}(`);
  assert.ok(start > 0, `${fn} is not declared in the migration`);
  const next = sql.indexOf('create function "pennsync_records".', start + 1);
  const body = sql.slice(start, next > 0 ? next : sql.length);
  const ceiling = body.match(/compliance_read_limit\(p_limit,\s*\d+,\s*(\d+)\)/);
  assert.ok(ceiling, `${fn} does not take its limit through compliance_read_limit`);
  const projection = body.slice(body.indexOf('jsonb_build_object('));
  const keys = [...projection.matchAll(/'([a-z0-9_]+)'\s*,/g)].map(match => match[1]);
  assert.ok(keys.length >= 15, `${fn} projects ${keys.length} keys, which is not a projection`);
  // `"key":null,` per column, plus the array's own brackets. A floor, not an
  // estimate: every real value is longer than `null`.
  const perRow = keys.reduce((total, key) => total + key.length + 8, 0) + 2;
  return { ceiling: Number(ceiling[1]), keys: keys.length, atCeiling: perRow * Number(ceiling[1]) };
}

test('every bulk capability whose page cannot fit the default has an allowance', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  let overDefault = 0;
  for (const [handler, fn] of Object.entries(CAPABILITIES)) {
    const { ceiling, atCeiling } = bounds(sql, fn);
    assert.ok(Object.hasOwn(BULK_RESPONSE_BYTES, handler),
      `${handler} pages to ${ceiling} rows and has no declared allowance`);
    assert.ok(BULK_RESPONSE_BYTES[handler] >= atCeiling,
      `${handler} allows ${BULK_RESPONSE_BYTES[handler]} bytes and a null-valued page `
      + `at its ceiling of ${ceiling} needs ${atCeiling}`);
    if (atCeiling > DEFAULT_RESPONSE_BYTES) overDefault += 1;
  }
  // The reason the map exists at all. If this ever reads 0 the allowance is
  // dead weight and should go rather than be carried.
  assert.ok(overDefault >= 3,
    `${overDefault} of these capabilities exceed the 1 MiB default; the measurement `
    + 'that motivated this map no longer holds');
});

test('the allowance is what the client actually sends a response through', async () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const { atCeiling } = bounds(sql, CAPABILITIES.listAgencyIncidents);
  assert.ok(atCeiling > DEFAULT_RESPONSE_BYTES, 'the oversized case is no longer oversized');

  // One body over the default and under the allowance, with the padding INSIDE
  // the payload so what is measured is a response a caller would really read.
  const padding = 'x'.repeat(DEFAULT_RESPONSE_BYTES + 64 * 1024);
  const entries = [{ id: '11111111-1111-4111-8111-111111111111', report: padding }];
  const oversized = { entries, order: 'created_date', limit: 200 };
  const bytes = JSON.stringify({ success: true, result: oversized }).length;
  assert.ok(bytes > DEFAULT_RESPONSE_BYTES, 'the fixture is not over the default');
  assert.ok(bytes < BULK_RESPONSE_BYTES.listAgencyIncidents, 'the fixture is over the allowance');

  // Served, because this handler has an allowance.
  const allowed = harness(oversized);
  await allowed.client.signIn(PASSWORD);
  assert.deepEqual(await allowed.client.callFunction('listAgencyIncidents', 'agency-a', {}), oversized,
    'a page inside the declared allowance was refused');

  // Refused, for a handler that has none — the same body, the same transport,
  // the same size. This is the control: without it the test above passes for a
  // client that ignores the map and caps nothing at all.
  const plain = harness(oversized);
  await plain.client.signIn(PASSWORD);
  await assert.rejects(plain.client.callFunction('validatePatientData', 'agency-a', {}),
    error => error?.code === 'INVALID_AUTHORITY_RESPONSE',
    'the 1 MiB default is not in force for a handler without an allowance');
});

/** The same synthetic caller `ported-api.test.mjs` uses; no real credential. */
const CONFIG = {
  appId: STAGING_APP_ID, projectRef: 'local-pennsync-authority', projectUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_synthetic_test_key',
  authUserId: '10000000-0000-4000-8000-000000000001', email: 'info+pennsync-admin-a@caremetricai.com',
};
const PASSWORD = 'Synthetic-test-password-only';
const USER = {
  id: CONFIG.authUserId, email: CONFIG.email, email_confirmed_at: '2026-09-17T00:00:00Z',
  role: 'authenticated', is_anonymous: false,
};
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

function harness(result) {
  const client = createStagingAuthorityClient({ ...CONFIG, apiUrl: API_TARGETS[1] }, {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/token?grant_type=password')) {
        return json({ user: { ...USER }, access_token: 'synthetic.access.token', token_type: 'bearer' });
      }
      if (String(url).endsWith('/user')) return json({ ...USER });
      return json({ success: true, result, execution: 'pennsync-api', base44ExecutionDependency: false });
    },
  });
  return { client };
}
