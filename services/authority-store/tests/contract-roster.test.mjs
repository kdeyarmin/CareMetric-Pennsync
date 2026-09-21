import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';

/**
 * The staff roster contract (D23).
 *
 * Two claims are under test and only one of them is about rows.
 *
 * The first is isolation, which every contract here has to prove: an agency
 * sees its own people and nobody else's, and a caller holding nothing in an
 * agency is refused rather than shown an empty list.
 *
 * The second is the one this contract exists for. `user.agency_id`,
 * `agency_name`, `account_type` and `role` are self-editable profile labels —
 * the entity schema says so in each field's own description — and the answer
 * must come from the authority store instead. So every carried row below is
 * seeded with a LYING label: each person's row claims the other agency, the
 * wrong name and a `platform_admin` account type. A contract that projected
 * the carried copy would return those, and every assertion about who is who
 * would come out backwards.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CONTRACT = 'services/authority-store/supabase/record-migrations/20260920030000_contract_roster.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = n => `6aac00000000${String(n).padStart(12, '0')}`;
/** 1 is agency_admin in agency-a, 2 and 3 clinicians there, 4 agency_admin in agency-b. */
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const LIST = 'select "public"."pennsync_contract_roster_list"($1,$2,$3) as result';
const GET = 'select "public"."pennsync_contract_roster_get"($1,$2) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await db.exec(readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8'));
  // The broker family is what grants a caller USAGE on the schema; a contract
  // reached through it inherits that and grants nothing of its own. Applying
  // it here is the deployment's own order rather than a convenience.
  await db.exec(readFileSync(resolve(repository, BROKER_MIGRATION_FILE), 'utf8'));
  await db.exec(readFileSync(resolve(repository, CONTRACT), 'utf8'));
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // Carried profile rows, every authority label a lie. 3 is deliberately
  // absent: a colleague with a membership and no profile row is still on the
  // roster, which is the half of this a join written the other way round
  // would silently drop.
  await db.exec(`insert into ${SCHEMA}."user"
    ("source_app_id","id","agency_id","agency_name","account_type","role",
     "staff_role","duty_status","phone","credentials","license_number","manager_email") values
    ('${APP}','${rid(1)}','agency-b','Claimed B','platform_admin','admin',
     'nurse','on_duty','555-0001','RN BSN','LIC-1','boss@example.invalid'),
    ('${APP}','${rid(2)}','agency-b','Claimed B','platform_admin','admin',
     'social_worker','off_duty','555-0002','MSW','LIC-2','boss@example.invalid'),
    ('${APP}','${rid(4)}','agency-a','Claimed A','platform_admin','admin',
     'office_staff','off_duty','555-0004','none','LIC-4','boss@example.invalid');`);
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    return rows;
  } finally { await db.exec('rollback'); }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const listAs = async (n, agency = A, limit = 200, after = null) =>
  (await as(n, LIST, [agency, limit, after]))[0].result;

test('the roster is the authority store membership, not the carried row own label', async () => {
  const result = await listAs(ADMIN_A);
  assert.deepEqual(result.entries.map(entry => entry.id), [rid(1), rid(2), rid(3)],
    'agency-a is 1, 2 and 3 — every one of whose carried rows claims agency-b');
  for (const entry of result.entries) {
    assert.equal(entry.agency_id, A, 'the agency comes from the membership');
    assert.equal(entry.agency_name, 'Synthetic Agency A', 'and its name from the agency row');
  }
  // 3 has no carried profile row at all and is still here, with the profile
  // fields empty. A join written the other way round would have dropped them.
  const [, , three] = result.entries;
  assert.equal(three.id, rid(3));
  assert.equal(three.email, 'clinician-empty@example.invalid');
  assert.equal(three.tenant_role, 'clinician');
  assert.equal(three.staff_role, null);

  // The four self-editable labels are not projected under ANY name. Returning
  // them would put the untrustworthy copy back in front of every ported
  // handler, which is the whole reason this contract exists.
  for (const entry of result.entries) {
    assert.ok(!Object.hasOwn(entry, 'role'), 'role is replaced by tenant_role');
    assert.ok(!Object.hasOwn(entry, 'account_type'), 'account_type is replaced by tenant_role');
    assert.ok(!JSON.stringify(entry).includes('platform_admin'), 'no self-asserted account type may escape');
    assert.ok(!JSON.stringify(entry).includes('Claimed'), 'no self-asserted agency name may escape');
  }
});

test('the other agency roster is not visible, and not knowable either', async () => {
  assert.deepEqual((await listAs(ADMIN_B, B)).entries.map(entry => entry.id), [rid(4)]);
  // A refusal, not an empty list: an empty list would confirm the agency
  // exists and say it has nobody in it.
  await refusal(as(ADMIN_A, LIST, [B, 200, null]), 'PENNSYNC_ROSTER_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_B, LIST, [A, 200, null]), 'PENNSYNC_ROSTER_AGENCY_NOT_HELD');
  for (const agency of [null, '', 'no-such-agency']) {
    await refusal(as(ADMIN_A, LIST, [agency, 200, null]), 'PENNSYNC_ROSTER_AGENCY_NOT_HELD');
  }
  // Naming a colleague of the other agency directly answers null, the same way
  // it answers for somebody who does not exist.
  assert.equal((await as(ADMIN_A, GET, [A, rid(4)]))[0].result, null);
  assert.equal((await as(ADMIN_A, GET, [A, '6aac0000000000000000ffff']))[0].result, null);
});

test('personnel detail widens on the authoritative role, never on the stored flag', async () => {
  // Every carried row says `role: admin` and `account_type: platform_admin`.
  // If either decided this, the clinician below would see everything.
  const [admin] = (await listAs(ADMIN_A)).entries;
  assert.equal(admin.tenant_role, 'agency_admin');
  assert.equal(admin.is_manager, true, 'derived from tenant_role, not the stored boolean');
  assert.equal(admin.phone, '555-0001');
  assert.equal(admin.credentials, 'RN BSN');
  assert.equal(admin.license_number, 'LIC-1');

  const seen = (await listAs(CLINICIAN_A)).entries;
  assert.deepEqual(seen.map(entry => entry.id), [rid(1), rid(2), rid(3)], 'a clinician sees the same colleagues');
  for (const entry of seen) {
    assert.equal(entry.is_manager, entry.tenant_role === 'agency_admin');
    // The working roster is still there — who they are, what they do, whether
    // they are on duty — which is what 35 capabilities actually read.
    assert.ok(Object.hasOwn(entry, 'staff_role') && Object.hasOwn(entry, 'duty_status'));
    // Null rather than absent, so the shape does not tell a handler which kind
    // of caller it is serving.
    for (const field of ['phone', 'credentials', 'license_number', 'manager_email',
      'profile_completeness_score', 'ai_content_agreement_accepted']) {
      assert.ok(Object.hasOwn(entry, field), `${field} must still be present`);
      assert.equal(entry[field], null, `${field} is administrative and must not reach a clinician`);
    }
  }
  assert.equal((await as(CLINICIAN_A, GET, [A, rid(1)]))[0].result.phone, null, 'get widens the same way');
  assert.equal((await as(ADMIN_A, GET, [A, rid(1)]))[0].result.phone, '555-0001');
});

test('it reads alphabetically and pages without repeating or skipping a colleague', async () => {
  const all = await listAs(ADMIN_A);
  const emails = all.entries.map(entry => entry.email);
  assert.deepEqual(emails, [...emails].sort(), 'a roster is read alphabetically');
  assert.equal(all.next, null, 'the last page carries no cursor');

  const walked = [];
  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const result = await listAs(ADMIN_A, A, 1, cursor);
    walked.push(...result.entries.map(entry => entry.id));
    cursor = result.next;
    if (!cursor) break;
  }
  assert.deepEqual(walked, all.entries.map(entry => entry.id), 'the walk must be the roster, in order');
  assert.equal(new Set(walked).size, 3);
  assert.equal(cursor, null);
});

test('a malformed cursor or subject is refused rather than guessed at', async () => {
  for (const cursor of ['', 'nonsense', rid(1).toUpperCase(), `${rid(1)}0`, rid(1).slice(0, 23)]) {
    await refusal(as(ADMIN_A, LIST, [A, 200, cursor]), 'PENNSYNC_ROSTER_CURSOR_INVALID');
  }
  for (const subject of [null, '', 'nonsense', `${rid(1)}0`]) {
    await refusal(as(ADMIN_A, GET, [A, subject]), 'PENNSYNC_ROSTER_SUBJECT_INVALID');
  }
  // A well-formed cursor naming nobody on this roster is refused too, and the
  // case that produces one is real: a colleague revoked between two pages of a
  // walk. The row the cursor names is gone, the keyset comparison has nothing
  // to compare against, and the walk ends early — an agency of thirty reported
  // as an agency of three. Answering the whole roster instead would repeat
  // every colleague already seen. Neither: start again.
  await refusal(as(ADMIN_A, LIST, [A, 200, rid(4)]), 'PENNSYNC_ROSTER_CURSOR_UNKNOWN');
  await refusal(as(ADMIN_A, LIST, [A, 200, '6aac0000000000000000ffff']), 'PENNSYNC_ROSTER_CURSOR_UNKNOWN');
});

test('a revoked membership leaves the roster, however the carried row reads', async () => {
  await db.exec('begin');
  try {
    await db.query(`update pennsync_private.membership set status = 'revoked',
      revoked_at = clock_timestamp(), revoked_by = $1 where id = 'membership-2'`, [uid(ADMIN_A)]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(ADMIN_A), session_id: sid(ADMIN_A), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(LIST, [A, 200, null]);
    assert.deepEqual(rows[0].result.entries.map(entry => entry.id), [rid(1), rid(3)],
      'the carried row for 2 is untouched and must not keep them on the roster');
    // And the two sources agree about it. If the contract listed a revoked
    // colleague while `user_read` hid their profile row, they would appear
    // with every profile field empty — a phantom that reads as somebody who
    // never filled anything in.
    assert.equal((await db.query(GET, [A, rid(2)])).rows[0].result, null);
  } finally { await db.exec('rollback'); }
});

test('no caller role reaches the roster except through the two contracts', async () => {
  const { rows } = await db.query(`
    select p.proname as name, pg_catalog.oidvectortypes(p.proargtypes) as args, n.nspname as schema
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proname like '%roster%' and n.nspname = any(array['pennsync_records','public'])
    order by n.nspname, p.proname`);
  const reachable = [];
  for (const row of rows) {
    const { rows: allowed } = await db.query(
      'select has_function_privilege($1, $2, \'execute\') as allowed',
      ['authenticated', `${row.schema}.${row.name}(${row.args})`]);
    if (allowed[0].allowed) reachable.push(`${row.schema}.${row.name}`);
  }
  // The two contracts are reachable by both spellings, which is deliberate and
  // is what `listPolicyLibrary` does: each is SECURITY DEFINER and performs
  // its own authorization, and the `public` wrapper only exists so a caller
  // reaches it without a Supabase project setting naming another schema.
  //
  // What must NOT be reachable is anything that does no authorization:
  // `caller_roster`, which answers the authority store's roster for whatever
  // agency it is handed, and `roster_entry`, which projects a row with the
  // privileged fields filled in if its boolean says so.
  assert.deepEqual(reachable.sort(),
    ['pennsync_records.contract_roster_get', 'pennsync_records.contract_roster_list',
      'public.pennsync_contract_roster_get', 'public.pennsync_contract_roster_list']);
  for (const unreachable of ['caller_roster', 'roster_entry']) {
    assert.ok(!reachable.some(name => name.endsWith(unreachable)),
      `${unreachable} performs no authorization and must not be callable`);
    await assert.rejects(() => as(ADMIN_A, `select * from ${SCHEMA}.${unreachable}($1)`, [A]),
      /permission denied|does not exist/i, `${unreachable} must refuse a caller`);
  }
  // And the table itself is not a door either.
  await assert.rejects(() => as(ADMIN_A, `select "id" from ${SCHEMA}."user"`), /permission denied/i);
});
