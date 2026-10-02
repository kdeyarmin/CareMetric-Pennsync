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
  '../authority-store/supabase/record-migrations/20260920660000_contract_compliance_reads.sql');

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
  // Not a floor on the COUNT. A length inequality is satisfied by a regex that
  // stopped matching the projection and started matching something else of a
  // similar size, and that shape has already passed in this repository while
  // measuring nothing. What is pinned instead is the projection's own structure:
  // every row a contract in this family returns carries `id`, and a projection
  // names each column once, so a parse that drifted onto other quoted text fails
  // on one of the two rather than on an arbitrary threshold.
  assert.ok(keys.includes('id'), `${fn}'s parsed projection has no 'id'; the parse has drifted`);
  assert.deepEqual([...new Set(keys)], keys,
    `${fn}'s parsed projection repeats a key, so this is not a jsonb_build_object key list`);
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

/**
 * The telecom capabilities, bounded by their contract's own TEXT CAPS.
 *
 * The compliance five are over the default with every value null. These three
 * are not -- a null-valued page of 500 contacts is about 0.1 MiB -- and they
 * are over it anyway, because `fax_text` caps `notes` at 2000 for a contact and
 * 5000 for a cover page and the ceiling is 500 and 200 rows. So this half reads
 * a different floor out of a different migration, and the two are kept apart
 * rather than averaged into one rule that is true of neither.
 *
 * `row` is the projection, `writer` is the function whose insert carries the
 * caps, and `ceiling` is read from the list's own `least(greatest(...))` or, for
 * the batch, from the refusal that bounds it.
 */
const TELECOM_DIR = resolve(HERE, '../authority-store/supabase/record-migrations');
const TELECOM = Object.freeze({
  listFaxContacts: {
    file: '20260920850000_contract_fax_contact.sql', payload: 'p_contact',
    row: 'fax_contact_row', writer: 'contract_fax_contact_create',
    ceiling: /v_limit := least\(greatest\(coalesce\(p_limit, \d+\), 1\), (\d+)\)/,
  },
  bulkCreateFaxContacts: {
    file: '20260920850000_contract_fax_contact.sql', payload: 'p_contact',
    row: 'fax_contact_row', writer: 'contract_fax_contact_create',
    // The batch returns every created contact in full, so its page is the
    // batch's own refusal rather than a read limit.
    ceiling: /if v_count > (\d+) then/,
  },
  listFaxTemplates: {
    file: '20260920860000_contract_fax_template.sql', payload: 'p_template',
    row: 'fax_template_row', writer: 'contract_fax_template_create',
    ceiling: /v_limit := least\(greatest\(coalesce\(p_limit, \d+\), 1\), (\d+)\)/,
  },
});

/**
 * A byte allowance per projected key, for a column this contract does not cap.
 *
 * An id, an address, a timestamp or a boolean. Declared rather than parsed,
 * because the carried schema is where those widths live and reading it here
 * would make this suite depend on a second generator. It is generous on
 * purpose: the figure this produces has to be an upper bound on what a page of
 * CONTRACT-WRITTEN rows can be, or comparing an allowance against it proves
 * nothing.
 */
const UNCAPPED_KEY_BYTES = 256;

function telecomBounds(sql, spec) {
  const body = fn => {
    const start = sql.indexOf(`create function "pennsync_records".${fn}(`);
    assert.ok(start > 0, `${fn} is not declared in ${spec.file}`);
    const next = sql.indexOf('create function "pennsync_records".', start + 1);
    return sql.slice(start, next > 0 ? next : sql.length);
  };
  const projection = body(spec.row);
  const keys = [...projection.slice(projection.indexOf('jsonb_build_object('))
    .matchAll(/'([a-z0-9_]+)'\s*,/g)].map(match => match[1]);
  // The same two drift guards the compliance half uses, for the same reason: a
  // regex that stopped matching the projection and started matching other
  // quoted text of a similar size satisfies a length inequality while measuring
  // nothing, and that has happened in this repository before.
  assert.ok(keys.includes('id'), `${spec.row}'s parsed projection has no 'id'; the parse has drifted`);
  assert.deepEqual([...new Set(keys)], keys,
    `${spec.row}'s parsed projection repeats a key, so this is not a jsonb_build_object key list`);
  // The caps, per column, out of the writer's own `fax_text` calls.
  const caps = new Map();
  for (const match of body(spec.writer)
    .matchAll(new RegExp(`fax_text\\(${spec.payload}->'([a-z0-9_]+)', (\\d+)\\)`, 'g'))) {
    caps.set(match[1], Math.max(caps.get(match[1]) ?? 0, Number(match[2])));
  }
  assert.ok(caps.size > 0, `${spec.writer} caps no text column; the caps parse has drifted`);
  for (const column of caps.keys()) {
    assert.ok(keys.includes(column),
      `${spec.writer} caps ${column}, which ${spec.row} does not project; one parse is wrong`);
  }
  const ceiling = sql.match(spec.ceiling);
  assert.ok(ceiling, `${spec.file} does not bound this capability's page as expected`);
  // `"key":"<value>",` per column: the key, its quotes, the colon and comma,
  // then the capped width or the declared allowance.
  const perRow = keys.reduce((total, key) =>
    total + key.length + 4 + (caps.get(key) ?? UNCAPPED_KEY_BYTES) + 2, 0) + 2;
  return { ceiling: Number(ceiling[1]), caps: caps.size, atCeiling: perRow * Number(ceiling[1]) };
}

test('every telecom capability whose capped page cannot fit the default has an allowance', () => {
  let overDefault = 0;
  for (const [handler, spec] of Object.entries(TELECOM)) {
    const sql = readFileSync(resolve(TELECOM_DIR, spec.file), 'utf8');
    const { ceiling, atCeiling } = telecomBounds(sql, spec);
    assert.ok(Object.hasOwn(BULK_RESPONSE_BYTES, handler),
      `${handler} pages to ${ceiling} rows of capped text and has no declared allowance`);
    assert.ok(BULK_RESPONSE_BYTES[handler] >= atCeiling,
      `${handler} allows ${BULK_RESPONSE_BYTES[handler]} bytes and a page of capped text `
      + `at its ceiling of ${ceiling} needs ${atCeiling}`);
    if (atCeiling > DEFAULT_RESPONSE_BYTES) overDefault += 1;
  }
  // All three, or the entries added for them are dead weight. This is the
  // assertion that fails if a ceiling or a cap is lowered to the point where
  // the default would do, which is a decision rather than a tidy-up.
  assert.equal(overDefault, Object.keys(TELECOM).length,
    `${overDefault} of ${Object.keys(TELECOM).length} telecom capabilities exceed the 1 MiB `
    + 'default; the measurement that motivated their allowances no longer holds');
});

test('the two fax log reads are bounded by their projection, not by a cap', () => {
  // The third measure, and the one a first draft of this suite got wrong in the
  // direction that looks safe. `fax_log_row` projects no `ocr_text` -- the one
  // unbounded column on that row -- and from that I concluded both reads fit the
  // default. The absent column is real; the conclusion was not. The log has no
  // writer in this tree, so NO contract caps any of the nineteen columns it does
  // project, and the only bound available is the declared per-key allowance.
  //
  // So this case is symmetric rather than one-sided: whichever of the two is
  // over the default must carry an allowance, whichever is under must not, and
  // it must come out one of each -- otherwise one of the two directions is
  // asserted against nothing, which is the state the first draft was in.
  const sql = readFileSync(TELECOM_DIR + '/20260920890000_contract_fax_log.sql', 'utf8');
  const body = fn => {
    const at = sql.indexOf(`create function "pennsync_records".${fn}(`);
    assert.ok(at > 0, `${fn} is not declared`);
    const after = sql.indexOf('create function "pennsync_records".', at + 1);
    return sql.slice(at, after > 0 ? after : sql.length);
  };
  const projected = text => [...text.slice(text.indexOf('jsonb_build_object('))
    .matchAll(/'([a-z0-9_]+)'\s*,/g)].map(match => match[1]);
  const rowKeys = projected(body('fax_log_row'));
  assert.ok(rowKeys.includes('id'), "fax_log_row's parsed projection has no 'id'; the parse has drifted");
  assert.deepEqual([...new Set(rowKeys)], rowKeys,
    "fax_log_row's parsed projection repeats a key, so this is not a jsonb_build_object key list");
  // Recorded rather than relied on: if the log ever gains a contract that caps
  // one of these, this suite is reading the wrong instrument for it.
  assert.equal(rowKeys.includes('ocr_text'), false,
    'fax_log_row projects ocr_text, so the allowance below understates the row');

  // The search adds its own keys to each row, and the excerpt is capped in SQL,
  // so it is the one column here with a real width.
  const EXTRA = Object.freeze({ ocr_excerpt: 300, ocr_truncated: UNCAPPED_KEY_BYTES });
  const READS = Object.freeze({
    listFaxLogs: { fn: 'contract_fax_log_list', extra: {} },
    searchFaxLogs: { fn: 'contract_fax_log_search', extra: EXTRA },
  });
  let overDefault = 0;
  for (const [handler, { fn, extra }] of Object.entries(READS)) {
    const text = body(fn);
    const ceiling = text.match(/v_limit := least\(greatest\(coalesce\(p_limit, \d+\), 1\), (\d+)\)/);
    assert.ok(ceiling, `${fn} does not bound its page as expected`);
    for (const key of Object.keys(extra)) {
      assert.ok(text.includes(`'${key}'`), `${fn} does not add ${key}; this suite's extra keys are stale`);
    }
    const width = key => extra[key] ?? UNCAPPED_KEY_BYTES;
    const perRow = [...rowKeys, ...Object.keys(extra)]
      .reduce((total, key) => total + key.length + 4 + width(key) + 2, 0) + 2;
    const atCeiling = perRow * Number(ceiling[1]);
    if (atCeiling > DEFAULT_RESPONSE_BYTES) {
      overDefault += 1;
      assert.ok(Object.hasOwn(BULK_RESPONSE_BYTES, handler),
        `${handler} pages to ${ceiling[1]} uncapped rows needing ${atCeiling} bytes, `
        + `over the ${DEFAULT_RESPONSE_BYTES} default, and has no declared allowance`);
      assert.ok(BULK_RESPONSE_BYTES[handler] >= atCeiling,
        `${handler} allows ${BULK_RESPONSE_BYTES[handler]} bytes and its page needs ${atCeiling}`);
    } else {
      assert.equal(Object.hasOwn(BULK_RESPONSE_BYTES, handler), false,
        `${handler}'s page is ${atCeiling} bytes, inside the default, so its allowance is dead weight`);
    }
  }
  assert.equal(overDefault, 1,
    `${overDefault} of the two fax log reads is over the default; with none or both, one `
    + 'direction of this case is asserted against nothing');
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
