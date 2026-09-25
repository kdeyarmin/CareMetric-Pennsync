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
 * The seven reference and configuration reads (D101).
 *
 * These are the first contracts replacing no Base44 function, so there is no
 * original to prove parity against — which removes the usual anchor and makes
 * two things this suite's job rather than a comparison's.
 *
 * **The projection.** Four of these were written with `to_jsonb(row)` under a
 * header already claiming every column was named, which is the defect D64 exists
 * for arriving in the file that cites it. A comment cannot catch that, so every
 * one of the four has a test that adds a column to the table and fails if it
 * reaches the answer. That test bites on the shape of the mistake rather than on
 * the list of columns, so it keeps working as the product grows.
 *
 * **The authorization.** The gate is membership and nothing else, which is a
 * decision rather than a port, so it is proved from both sides: a member of one
 * agency sees that agency's rows, and asking about an agency they do not hold is
 * a REFUSAL rather than an empty list — an empty list would confirm the agency
 * exists.
 *
 * And one thing that is emphatically not this contract's: `medicare_guideline`
 * and `medicare_compliance_rule` have one policy each, a read. The SPA calls
 * `.create` and `.update` on them, and the store refuses. That is asserted here
 * because the absence of a write contract is a decision (D83) and an absence
 * nothing checks is indistinguishable from an omission.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DIR = 'services/authority-store/supabase/record-migrations/';
const CARRIED = [
  `${DIR}20260920520000_file_locator_map.sql`,
  `${DIR}20260920570000_contract_reference_reads.sql`,
];
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ...CARRIED]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await seed();
});
after(async () => db?.close());

/**
 * Rows planted in an order that is NOT the order any contract returns, so a
 * contract that lost its `order by` would be visible rather than lucky.
 */
async function seed() {
  await db.exec(`
    insert into ${SCHEMA}.medicare_compliance_rule
      (source_app_id,id,rule_name,cop_reference,is_active,created_date) values
      ('${APP}','rule-3','Third','484.60',true,'2026-01-03T00:00:00Z'),
      ('${APP}','rule-1','First','484.45',true,'2026-01-01T00:00:00Z'),
      ('${APP}','rule-2','Second','484.50',false,'2026-01-02T00:00:00Z');
    insert into ${SCHEMA}.medicare_guideline
      (source_app_id,id,title,url,is_active,last_fetched_date) values
      ('${APP}','g-old','Older guidance','https://www.cms.gov/old',true,'2026-02-01T00:00:00Z'),
      ('${APP}','g-new','Newer guidance','https://www.cms.gov/new',true,'2026-03-01T00:00:00Z'),
      ('${APP}','g-off','Withdrawn guidance','https://www.cms.gov/off',false,'2026-04-01T00:00:00Z');
    insert into ${SCHEMA}.physician
      (source_app_id,id,agency_id,full_name,is_active,referral_count,created_date) values
      ('${APP}','doc-b','${A}','Brown, B',true,5,'2026-01-02T00:00:00Z'),
      ('${APP}','doc-a','${A}','Adams, A',true,11,'2026-01-03T00:00:00Z'),
      ('${APP}','doc-c','${A}','Clark, C',false,99,'2026-01-01T00:00:00Z'),
      ('${APP}','doc-z','${B}','Zephyr, Z',true,77,'2026-01-04T00:00:00Z');
    insert into ${SCHEMA}.document_template
      (source_app_id,id,agency_id,template_name,is_system_template,created_date) values
      ('${APP}','tpl-own','${A}','Our own template',false,'2026-01-01T00:00:00Z'),
      ('${APP}','tpl-system','${B}','A published system template',true,'2026-01-02T00:00:00Z'),
      ('${APP}','tpl-theirs','${B}','Another agency private template',false,'2026-01-03T00:00:00Z');
    insert into ${SCHEMA}.library_document
      (source_app_id,id,agency_id,title,file_url,created_date) values
      ('${APP}','lib-1','${A}','Wound care handout','https://base44.app/storage/lib-1.pdf','2026-01-01T00:00:00Z'),
      ('${APP}','lib-2','${A}','Fall prevention','cmfile:11111111-2222-4333-8444-555555555555','2026-01-02T00:00:00Z'),
      ('${APP}','lib-b','${B}','Their handout','https://base44.app/storage/lib-b.pdf','2026-01-03T00:00:00Z');
    insert into ${SCHEMA}.on_call_shift
      (source_app_id,id,agency_id,shift_date,coverage_type) values
      ('${APP}','shift-mid','${A}','2026-03-15','overnight'),
      ('${APP}','shift-early','${A}','2026-03-01','holiday'),
      ('${APP}','shift-late','${A}','2026-04-05','overnight'),
      ('${APP}','shift-b','${B}','2026-03-10','overnight');
    insert into ${SCHEMA}.visit_point_config
      (source_app_id,id,agency_id,agency_name,active,soc_points,updated_date) values
      ('${APP}','cfg-old','${A}','Synthetic Agency A',false,1,'2026-01-01T00:00:00Z'),
      ('${APP}','cfg-new','${A}','Synthetic Agency A',true,2,'2026-02-01T00:00:00Z'),
      ('${APP}','cfg-b','${B}','Synthetic Agency B',true,9,'2026-03-01T00:00:00Z');
  `);
}

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows[0];
  } catch (error) { await db.exec('rollback'); throw error; }
}

const call = async (who, name, params) => {
  const holes = params.map((_, index) => `$${index + 1}`).join(',');
  const row = await as(who, `select "public"."pennsync_contract_${name}"(${holes}) as result`, params);
  return row.result.entries;
};
const ids = rows => rows.map(row => row.id);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

/** Every capability, so the gate is proved once per contract and not once. */
const EVERY = Object.freeze([
  ['medicare_compliance_rule_list', agency => [agency, 100]],
  ['medicare_guideline_list', agency => [agency, 100, null]],
  ['physician_list', agency => [agency, 100, 'name', null]],
  ['document_template_list', agency => [agency, 100]],
  ['library_document_list', agency => [agency, 100]],
  ['on_call_shift_list', agency => [agency, 100, null, null]],
  ['visit_point_config_list', agency => [agency, 100]],
]);

test('membership is the gate, and an agency the caller does not hold refuses', async () => {
  for (const [name, args] of EVERY) {
    // A member of the agency, whatever their role: these are the physician
    // directory and the published rules, which everybody who opens the app needs.
    assert.ok(Array.isArray(await call(CLINICIAN_A, name, args(A))), name);
    assert.ok(Array.isArray(await call(ADMIN_A, name, args(A))), name);
    // And the other agency's administrator is refused rather than shown nothing.
    // An empty list would tell them the agency exists.
    await refusal(call(ADMIN_B, name, args(A)), 'PENNSYNC_CONTRACT_AGENCY_NOT_HELD');
    await refusal(call(ADMIN_A, name, args(B)), 'PENNSYNC_CONTRACT_AGENCY_NOT_HELD');
  }
});

test('the two global tables are agency-blind and the five tenanted ones are not', async () => {
  // D83: these carry no `agency_id` at all, so every agency reads the same rows.
  assert.deepEqual(ids(await call(ADMIN_A, 'medicare_compliance_rule_list', [A, 100])),
    ['rule-1', 'rule-2', 'rule-3']);
  assert.deepEqual(ids(await call(ADMIN_B, 'medicare_compliance_rule_list', [B, 100])),
    ['rule-1', 'rule-2', 'rule-3']);
  // The rest are the agency's own. Each seeded a row in agency-b to prove it.
  assert.deepEqual(ids(await call(ADMIN_A, 'physician_list', [A, 100, 'name', null])),
    ['doc-a', 'doc-b', 'doc-c']);
  assert.deepEqual(ids(await call(ADMIN_A, 'library_document_list', [A, 100])), ['lib-2', 'lib-1']);
  assert.deepEqual(ids(await call(ADMIN_A, 'on_call_shift_list', [A, 100, null, null])),
    ['shift-early', 'shift-mid', 'shift-late']);
  assert.deepEqual(ids(await call(ADMIN_A, 'visit_point_config_list', [A, 100])), ['cfg-new', 'cfg-old']);
});

/**
 * The one read with no tenant predicate of its own. `document_template_read`
 * admits an agency's own rows OR any row FLAGGED `is_system_template`, whichever
 * agency owns it — so the contract must not restate tenancy, and the proof is
 * that another agency's system template arrives while its private one does not.
 */
test('a system template published by another agency is visible; its private one is not', async () => {
  assert.deepEqual(ids(await call(ADMIN_A, 'document_template_list', [A, 100])),
    ['tpl-system', 'tpl-own']);
});

test('each contract returns the order its call sites ask for', async () => {
  // No call site asks an order of the rules, so the contract chose the one a
  // reader looks a rule up in.
  assert.deepEqual(
    (await call(ADMIN_A, 'medicare_compliance_rule_list', [A, 100])).map(row => row.cop_reference),
    ['484.45', '484.50', '484.60']);
  assert.deepEqual(ids(await call(ADMIN_A, 'medicare_guideline_list', [A, 100, null])),
    ['g-off', 'g-new', 'g-old'], 'most recently fetched first');
  assert.deepEqual(ids(await call(ADMIN_A, 'physician_list', [A, 100, 'recent', null])),
    ['doc-a', 'doc-b', 'doc-c']);
  assert.deepEqual(ids(await call(ADMIN_A, 'physician_list', [A, 100, 'referrals', null])),
    ['doc-c', 'doc-a', 'doc-b']);
  assert.deepEqual(ids(await call(ADMIN_A, 'physician_list', [A, 100, 'name', null])),
    ['doc-a', 'doc-b', 'doc-c']);
});

test('the active filter is a preference, and absent means no preference', async () => {
  assert.deepEqual(ids(await call(ADMIN_A, 'medicare_guideline_list', [A, 100, true])),
    ['g-new', 'g-old']);
  assert.deepEqual(ids(await call(ADMIN_A, 'medicare_guideline_list', [A, 100, false])), ['g-off']);
  assert.equal((await call(ADMIN_A, 'medicare_guideline_list', [A, 100, null])).length, 3);
  assert.deepEqual(ids(await call(ADMIN_A, 'physician_list', [A, 100, 'name', true])),
    ['doc-a', 'doc-b']);
});

test('an order the contract does not implement is refused, not approximated', async () => {
  for (const order of [null, '', 'created_date', 'FULL_NAME', 'name; drop table x']) {
    await refusal(call(ADMIN_A, 'physician_list', [A, 100, order, null]),
      'PENNSYNC_CONTRACT_ORDER_INVALID');
  }
});

test('the rota window is parsed here so an impossible day is our refusal', async () => {
  assert.deepEqual(ids(await call(ADMIN_A, 'on_call_shift_list', [A, 100, '2026-03-01', '2026-03-31'])),
    ['shift-early', 'shift-mid']);
  assert.deepEqual(ids(await call(ADMIN_A, 'on_call_shift_list', [A, 100, '2026-04-01', null])),
    ['shift-late']);
  // A day that does not exist. Taking a `date` parameter would make this a cast
  // error at the HTTP boundary, which a caller cannot act on (D38).
  await refusal(call(ADMIN_A, 'on_call_shift_list', [A, 100, '2026-02-31', null]),
    'PENNSYNC_CONTRACT_DATE_INVALID');
  await refusal(call(ADMIN_A, 'on_call_shift_list', [A, 100, 'the fifteenth', null]),
    'PENNSYNC_CONTRACT_DATE_INVALID');
  await refusal(call(ADMIN_A, 'on_call_shift_list', [A, 100, '2026-04-01', '2026-03-01']),
    'PENNSYNC_CONTRACT_RANGE_INVALID');
});

/**
 * The defect this suite exists for, planted one table at a time.
 *
 * A first draft of four of these contracts projected `to_jsonb(row)`, under a
 * header that already said every column was named. Nothing in the migration
 * could catch that and no reviewer did. So each of the four gets a column added
 * to its table here, and fails if the column reaches the answer.
 */
test('every column is named, so a column added to a table does not reach a caller', async () => {
  const planted = [
    ['document_template', 'document_template_list', [A, 100]],
    ['library_document', 'library_document_list', [A, 100]],
    ['on_call_shift', 'on_call_shift_list', [A, 100, null, null]],
    ['visit_point_config', 'visit_point_config_list', [A, 100]],
    ['physician', 'physician_list', [A, 100, 'name', null]],
    ['medicare_compliance_rule', 'medicare_compliance_rule_list', [A, 100]],
    ['medicare_guideline', 'medicare_guideline_list', [A, 100, null]],
  ];
  for (const [table, name, args] of planted) {
    await db.exec(`alter table ${SCHEMA}.${table} add column "later_addition" text`);
    await db.exec(`update ${SCHEMA}.${table} set "later_addition" = 'a value nobody asked for'`);
    const rows = await call(ADMIN_A, name, args);
    assert.ok(rows.length > 0, table);
    for (const row of rows) {
      assert.ok(!Object.hasOwn(row, 'later_addition'),
        `${table}: the projection returned the row rather than its columns`);
    }
    await db.exec(`alter table ${SCHEMA}.${table} drop column "later_addition"`);
  }
});

/**
 * `library_document.file_url` is a Base44 storage locator on a carried row, so
 * it is projected THROUGH D77's map. Until the file copy has run that is null,
 * and null is the answer we want: handing the browser the Base44 URL would have
 * it fetch the platform this migration is leaving.
 */
test('a library document\'s locator resolves through the map and fails closed', async () => {
  const before = await call(ADMIN_A, 'library_document_list', [A, 100]);
  const unmapped = before.find(row => row.id === 'lib-1');
  assert.equal(unmapped.file_url, null, 'an unmapped Base44 URL is never returned as itself');
  // A `cmfile:` handle is already owned and passes straight through.
  assert.equal(before.find(row => row.id === 'lib-2').file_url,
    'cmfile:11111111-2222-4333-8444-555555555555');
  // Mapped, it resolves. Inserted outside `as()` because `file_object` is forced
  // RLS with no policy at all: the resolver is the only way in.
  await db.exec(`insert into pennsync_private.file_object
    (app_id,locator_key,locator,file_uri,content_sha256,byte_size,copy_run,recorded_by)
    values ('${APP}', encode(sha256(convert_to('https://base44.app/storage/lib-1.pdf','UTF8')),'hex'),
      'https://base44.app/storage/lib-1.pdf','cmfile:99999999-8888-4777-8666-555555555555',
      repeat('a',64), 1024, 'contract-reference-reads.test', '${uid(ADMIN_A)}')`);
  const after = await call(ADMIN_A, 'library_document_list', [A, 100]);
  assert.equal(after.find(row => row.id === 'lib-1').file_url,
    'cmfile:99999999-8888-4777-8666-555555555555');
});

/**
 * The row bound is the contract's and no caller reaches past it (D71). Proved on
 * the clamp itself rather than by seeding two thousand rows, because what is
 * being asserted is that the ceiling wins over the argument.
 */
test('the row bound is clamped where the caller cannot reach it', async () => {
  assert.deepEqual(ids(await call(ADMIN_A, 'medicare_compliance_rule_list', [A, 2])),
    ['rule-1', 'rule-2'], 'the caller\'s own smaller bound is honoured');
  await db.exec('begin');
  await db.exec('set local role "pennsync_records_owner"');
  const { rows } = await db.query(
    `select ${SCHEMA}.reference_read_limit($1,$2) as bound`, [5000, 100]);
  await db.exec('commit');
  assert.equal(rows[0].bound, 100, 'a limit above the ceiling is the ceiling');
});

/**
 * D83, asserted because an absence is otherwise indistinguishable from an
 * omission. The SPA calls `.create` and `.update` on both Medicare tables from
 * two admin screens. They have one policy each, a read, so an insert matches no
 * policy and an update matches no row — and no write contract is written here.
 */
test('the two global reference tables cannot be written by a caller at all', async () => {
  // Measured rather than assumed, and the measurement moved the claim. A first
  // draft expected `row-level security`, on the reasoning that one read policy
  // leaves an insert matching none. What actually refuses is a GRANT: these
  // tables grant `authenticated` nothing at all, so a caller never reaches the
  // policies — every path in is a definer contract owned by the record owner.
  // Both refusals are worth having, and this is the stronger one.
  for (const write of [
    `insert into ${SCHEMA}.medicare_guideline (source_app_id,id,title)
      values ('${APP}','g-new-row','Invented') returning id as result`,
    `update ${SCHEMA}.medicare_guideline set title = 'Rewritten'
      where id = 'g-new' returning id as result`,
    `delete from ${SCHEMA}.medicare_compliance_rule where id = 'rule-1' returning id as result`,
    `insert into ${SCHEMA}.medicare_compliance_rule (source_app_id,id,rule_name)
      values ('${APP}','rule-new','Invented') returning id as result`,
  ]) {
    await refusal(as(ADMIN_A, write), 'permission denied');
  }
  // One policy each, and it is a read — which is what makes D83 the decision
  // here rather than an omission. The SPA calls `.create` and `.update` on both
  // of these from two admin screens and always failed.
  const { rows } = await db.query(`select tablename, cmd from pg_policies
    where schemaname = $1 and tablename = any($2) order by tablename`,
  [SCHEMA, ['medicare_compliance_rule', 'medicare_guideline']]);
  assert.deepEqual(rows, [
    { tablename: 'medicare_compliance_rule', cmd: 'SELECT' },
    { tablename: 'medicare_guideline', cmd: 'SELECT' },
  ]);
  // And no write contract is written over them. An absence nothing checks is
  // indistinguishable from something nobody got round to.
  const contracts = readFileSync(resolve(repository, CARRIED[1]), 'utf8');
  for (const forbidden of ['medicare_guideline_create', 'medicare_guideline_update',
    'medicare_compliance_rule_create', 'medicare_compliance_rule_update']) {
    assert.ok(!contracts.includes(forbidden), `${forbidden} must not exist without changing D83`);
  }
});

test('the helpers are the record owner\'s alone', async () => {
  for (const helper of ['reference_read_role', 'reference_read_limit']) {
    const { rows } = await db.query(`select has_function_privilege('authenticated',
      p.oid, 'execute') as granted from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 and p.proname = $2`, [SCHEMA, helper]);
    assert.equal(rows.length, 1, helper);
    assert.equal(rows[0].granted, false, `${helper} is not a capability`);
  }
});
