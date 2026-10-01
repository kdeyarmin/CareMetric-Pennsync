import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, CONTRACT_UNIQUE, contractUniqueName } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations, RECORD_MIGRATION_DIRECTORY } from './record-migrations.mjs';

/**
 * An agency's fax retry policy: a read and a save.
 *
 * The tests that carry weight are the ones about the DELETED derived scope.
 * `fetchCallerScopedConfig` filters on `agency_name` — a self-editable label —
 * and falls back to the five newest rows in the DEPLOYMENT when that filter
 * matches nothing, which is how a platform admin came to overwrite an agency's
 * configuration. So another agency's row is seeded here and every test checks
 * it is neither read nor written, which is the failure that docstring
 * describes.
 */
const APP = '6a9881683dc68a0bd54f1ef7';
const A = 'agency-a'; const B = 'agency-b';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const READ = 'select "public"."pennsync_contract_fax_retry_config_read"($1) as result';
const SAVE = 'select "public"."pennsync_contract_fax_retry_config_save"($1,$2) as result';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await applyRecordMigrations(db);
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`, [APP, id, name]);
  }
  // Agency B's policy, which is what the original's legacy-row fallback could
  // reach and adopt. It is also NEWER than anything agency A will have, which
  // is the condition under which "the five newest rows in the deployment"
  // returns somebody else's configuration.
  await db.query(`insert into ${SCHEMA}."fax_retry_config"
    ("source_app_id","id","agency_id","agency_name","max_retries","retry_delay_minutes",
     "auto_retry_enabled","notify_on_final_failure","is_active","updated_date")
    values ($1,'cfg-b',$2,'Allegheny Care Partners',9,99,false,false,true,
      clock_timestamp() + interval '1 day')`, [APP, B]);
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = true) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const refuses = (promise, code) => assert.rejects(promise, error => {
  assert.match(error.message, new RegExp(code));
  return true;
});
const rowB = async () => (await db.query(
  `select * from ${SCHEMA}."fax_retry_config" where "id" = 'cfg-b'`)).rows[0];

test('an agency with no policy is told so, rather than handed the newest one anywhere', async () => {
  // D43's bug, from the read side. The original's fallback lists the five
  // newest rows in the deployment, and agency B's is newer than anything here.
  const answer = await as(CLINICIAN_A, READ, [A]);
  assert.equal(answer.success, true);
  assert.equal(answer.config, null);
  assert.equal(answer.reason, 'retry_config_missing');
});

test('the save is an agency_admin\'s, and the read is any member\'s', async () => {
  // D40: the original's gate is `role === 'admin'`, so the successor is an
  // agency_admin scoped to their own agency and nobody else.
  await refuses(as(CLINICIAN_A, SAVE, [A, { max_retries: 5 }]),
    'PENNSYNC_RETRY_CONFIG_FORBIDDEN');
  await refuses(as(ADMIN_B, SAVE, [A, { max_retries: 5 }]),
    'PENNSYNC_RETRY_CONFIG_FORBIDDEN');
  const saved = await as(ADMIN_A, SAVE, [A, { max_retries: 5, retry_delay_minutes: 20 }]);
  assert.equal(saved.config.max_retries, 5);
  assert.equal(saved.config.retry_delay_minutes, 20);
  // The display name is the CARRIED agency row's, not the caller's profile.
  assert.equal(saved.config.agency_name, 'Keystone Home Health');
  // A worker computing a delay is not an administrator, so the read is wider
  // than the save by design — and it is the caller's OWN agency either way.
  const asMember = await as(CLINICIAN_A, READ, [A]);
  assert.equal(asMember.config.max_retries, 5);
  await refuses(as(ADMIN_B, READ, [A]), 'PENNSYNC_RETRY_CONFIG_FORBIDDEN');
});

test('another agency\'s policy is neither read nor overwritten', async () => {
  // The whole of D43's finding in one assertion: agency B's row is newer and
  // untouched, and agency A's save did not adopt it.
  const before = await rowB();
  await as(ADMIN_A, SAVE, [A, { max_retries: 7 }]);
  const after = await rowB();
  assert.deepEqual(
    [after.max_retries, after.retry_delay_minutes, after.auto_retry_enabled, after.agency_id],
    [before.max_retries, before.retry_delay_minutes, before.auto_retry_enabled, B]);
  assert.equal((await as(ADMIN_A, READ, [A])).config.max_retries, 7);
});

test('a value outside the schema\'s range is clamped, and the answer says which', async () => {
  // Clamped rather than refused, because that is the original's behaviour — but
  // REPORTED (D54's rule about a substitution count), so a caller that sent 50
  // is not told it saved 50.
  const saved = await as(ADMIN_A, SAVE, [A, { max_retries: 50, retry_delay_minutes: 0 }]);
  assert.equal(saved.config.max_retries, 10);
  assert.equal(saved.config.retry_delay_minutes, 1);
  assert.deepEqual(saved.clamped, ['max_retries', 'retry_delay_minutes']);
  // And an in-range value reports nothing, or the field would be noise.
  const fine = await as(ADMIN_A, SAVE, [A, { max_retries: 4 }]);
  assert.deepEqual(fine.clamped, []);
});

test('an empty body is refused, because it would reset the policy to the defaults', async () => {
  // D43's own guard, for its own reason.
  await refuses(as(ADMIN_A, SAVE, [A, {}]), 'PENNSYNC_RETRY_CONFIG_EMPTY');
  await refuses(as(ADMIN_A, SAVE, [A, null]), 'PENNSYNC_RETRY_CONFIG_INVALID');
  await refuses(as(ADMIN_A, SAVE, [A, { agency_name: 'Mine now' }]),
    'PENNSYNC_RETRY_CONFIG_FIELD_UNSUPPORTED');
  await refuses(as(ADMIN_A, SAVE, [A, { agency_id: B }]),
    'PENNSYNC_RETRY_CONFIG_FIELD_UNSUPPORTED');
});

test('the save keeps the keys it does not name, and leaves one row', async () => {
  await as(ADMIN_A, SAVE, [A, { max_retries: 6, retry_delay_minutes: 45 }]);
  const after = await as(ADMIN_A, SAVE, [A, { auto_retry_enabled: false }]);
  assert.equal(after.config.max_retries, 6);
  assert.equal(after.config.retry_delay_minutes, 45);
  assert.equal(after.config.auto_retry_enabled, false);
  // One row per agency, which is what every reader's `limit 1` assumes.
  const { rows } = await db.query(
    `select count(*)::int as n from ${SCHEMA}."fax_retry_config" where "agency_id" = $1`, [A]);
  assert.equal(rows[0].n, 1);
});

test('the priority multipliers are the four the entity declares, and an extra key is dropped', async () => {
  const saved = await as(ADMIN_A, SAVE, [A, {
    priority_multiplier: { urgent: 0.25, high: 2, nonsense: 5 },
  }]);
  // The four known keys, with the entity's own defaults for the two not sent.
  assert.deepEqual(Object.keys(saved.config.priority_multiplier).sort(),
    ['high', 'low', 'normal', 'urgent']);
  assert.equal(saved.config.priority_multiplier.urgent, 0.25);
  assert.equal(saved.config.priority_multiplier.high, 2);
  assert.equal(saved.config.priority_multiplier.normal, 1);
  assert.equal(saved.config.priority_multiplier.low, 2);
  // DROPPED rather than refused, and the reason is D54's rather than D39's:
  // these feed a worker's delay arithmetic, the blob has no schema behind it,
  // and a harmless extra key must not break a save of the four that matter.
  assert.equal(Object.hasOwn(saved.config.priority_multiplier, 'nonsense'), false);
});

test('the D78 key exists, is partial, and is what the save catches by name', async () => {
  // The enumeration and the SQL have to agree, because the save catches this
  // constraint BY NAME and re-raises anything else: a rename in the generator
  // turns a correct retry answer into a raw database error.
  const declared = CONTRACT_UNIQUE['FaxRetryConfig.active_agency'];
  assert.deepEqual(declared.columns, ['agency_id']);
  assert.equal(declared.live, 'is_active');
  const index = contractUniqueName('fax_retry_config', 'active_agency');
  assert.equal(index, 'fax_retry_config_active_agency_unique');
  const contract = await readFile(
    new URL(declared.migration, RECORD_MIGRATION_DIRECTORY), 'utf8');
  assert.ok(contract.includes(`v_constraint is distinct from '${index}'`),
    'the save must compare the caught constraint against exactly this index');

  // It is in the store, and it is PARTIAL — a whole-table key would narrow the
  // entity to one policy ever, and a deactivated one is history it may keep.
  const { rows } = await db.query(
    'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
    ['pennsync_records', index]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].indexdef, /WHERE .*is_active/i);

  // And it bites: a second ACTIVE row for one agency is refused by the
  // database rather than by the contract, which is the point of having it.
  await as(ADMIN_A, SAVE, [A, { max_retries: 3 }]);
  await assert.rejects(db.query(`insert into ${SCHEMA}."fax_retry_config"
    ("source_app_id","id","agency_id","max_retries","is_active")
    values ($1,'cfg-a-second',$2,1,true)`, [APP, A]),
  error => {
    assert.match(error.message, /duplicate key|unique/i);
    return true;
  });
  // A deactivated second row is allowed, which is the partial half.
  await db.query(`insert into ${SCHEMA}."fax_retry_config"
    ("source_app_id","id","agency_id","max_retries","is_active")
    values ($1,'cfg-a-history',$2,1,false)`, [APP, A]);
  // And the read still returns the live one rather than the newest.
  assert.equal((await as(ADMIN_A, READ, [A])).config.max_retries, 3);
  await db.query(`delete from ${SCHEMA}."fax_retry_config" where "id" = 'cfg-a-history'`);
});
