import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import {
  BACKFILL_CONTRACT, applyBackfill, planBackfill, readExport,
} from '../../../tools-pennsync-assignment-backfill.mjs';

/**
 * D24 end to end, against a real database: the backfill writes, and the record
 * store's narrowing then honours what it wrote.
 *
 * The unit tests prove what the planner refuses. This proves the two halves
 * meet — which is the half of D24 nobody can check by reading either file,
 * and the half that was structurally impossible until the patient foreign key
 * came off `pennsync_private.assignment`. Until then an assignment could only
 * name a SYNTHETIC patient, so the backfill could not have written one row.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3;
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await db.exec(readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8'));
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`
    grant usage on schema ${SCHEMA} to authenticated;
    grant select on all tables in schema ${SCHEMA} to authenticated;
    grant execute on function ${SCHEMA}.caller_identity(), ${SCHEMA}.caller_identified(),
      ${SCHEMA}.caller_agencies(), ${SCHEMA}.caller_tenant_role(text),
      ${SCHEMA}.caller_opens_every_chart(text), ${SCHEMA}.caller_assigned_patients(text),
      ${SCHEMA}.caller_email(), ${SCHEMA}.caller_user_id(), ${SCHEMA}.deployment_app() to authenticated;`);
  // Two patients of record. Neither can exist in `pennsync_private.patient`:
  // its `display_name` must be `like 'Synthetic %'` and its `synthetic` column
  // carries `check (synthetic)`, so that table holds staging rows and nothing
  // else. This is the whole reason the foreign key had to come off.
  await db.exec(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id") values
    ('${APP}','rec-p1','agency-a'), ('${APP}','rec-p2','agency-a');`);
});
after(async () => db?.close());

const execute = (sql, params = []) => db.query(sql, params);
const chartsOf = async (n) => {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(`select "id" from ${SCHEMA}."patient" order by "id"`);
    return rows.map(row => row.id);
  } finally { await db.exec('rollback'); }
};
/** What the store answers about itself, which is the only side the planner trusts. */
async function roster() {
  const { rows } = await db.query(`
    select i.expected_email as email, m.agency_id::text as agency_id, m.id as membership_id,
           m.tenant_role, m.status
    from pennsync_private.membership m
    join pennsync_private.identity_map i
      on i.app_id = m.app_id and i.auth_user_id = m.auth_user_id and i.base44_user_id = m.base44_user_id
    where m.app_id = $1`, [APP]);
  return rows;
}
async function existing() {
  const { rows } = await db.query(
    'select patient_id, membership_id, status from pennsync_private.assignment where app_id = $1', [APP]);
  return rows;
}

test('an assignment can name a patient of record, which is what made the backfill possible', async () => {
  // Before the key came off, this insert was refused outright — and with it,
  // every row the backfill would ever write.
  const { rows } = await db.query(`select conname from pg_catalog.pg_constraint
    where conrelid = 'pennsync_private.assignment'::regclass and contype = 'f'`);
  assert.deepEqual(rows.map(row => row.conname), ['assignment_app_id_agency_id_membership_id_fkey'],
    'the patient key is gone and the membership key stays');
  // The staging mutation path still requires a patient this store holds: the
  // key was a second copy of a check `pennsync_private.mutate` already makes,
  // and only the copy could not tell a real patient from a synthetic one.
  const source = readFileSync(resolve(repository,
    'services/authority-store/supabase/migrations/20260918015112_independent_staging_authority.sql'), 'utf8');
  assert.match(source, /PENNSYNC_PATIENT_DENIED/);
});

test('the backfill carries a care team across, and the chart opens for exactly those it named', async () => {
  // Nobody is assigned to a patient of record yet, so a clinician opens
  // nothing while an administrator opens both.
  assert.deepEqual(await chartsOf(CLINICIAN_A), []);
  assert.deepEqual(await chartsOf(ADMIN_A), ['rec-p1', 'rec-p2']);

  const exported = JSON.stringify({
    contract: BACKFILL_CONTRACT,
    app_id: APP,
    patients: [
      // `clinician-a` is on the first chart. `admin-a` is named on it too and
      // is dropped: an administrator already opens every chart, and writing
      // the row would record an assignment nobody made.
      { id: 'rec-p1', agency_id: 'agency-a',
        assigned_nurses: ['clinician-a@example.invalid', 'admin-a@example.invalid'] },
      // The second chart names somebody this deployment has never heard of.
      { id: 'rec-p2', agency_id: 'agency-a', assigned_nurses: ['agency@example.invalid'] },
    ],
  });
  const plan = planBackfill(readExport(exported), await roster(), await existing());
  assert.deepEqual(plan.grants.map(grant => grant.patient_id), ['rec-p1']);
  assert.deepEqual(plan.skipped.map(entry => entry.reason), ['role_not_assignable', 'address_unknown']);

  assert.deepEqual(await applyBackfill(execute, plan, { actorId: uid(ADMIN_A), expectedDigest: plan.digest }),
    { applied: 1 });

  // The loop closes here: a row the backfill wrote is a chart the narrowing
  // opens, and only that one.
  assert.deepEqual(await chartsOf(CLINICIAN_A), ['rec-p1']);
  assert.deepEqual(await chartsOf(CLINICIAN_EMPTY), [], 'a colleague named by nobody still opens nothing');
  assert.deepEqual(await chartsOf(ADMIN_A), ['rec-p1', 'rec-p2'], 'an administrator is unchanged');
});

test('running it again writes nothing, and a withdrawal stays withdrawn', async () => {
  const exported = JSON.stringify({ contract: BACKFILL_CONTRACT, app_id: APP, patients: [
    { id: 'rec-p1', agency_id: 'agency-a', assigned_nurses: ['clinician-a@example.invalid'] }] });
  const again = planBackfill(readExport(exported), await roster(), await existing());
  assert.deepEqual(again.grants, []);
  assert.deepEqual(again.skipped.map(entry => entry.reason), ['already_recorded']);

  // And the case that matters most: access somebody deliberately withdrew.
  // `assigned_nurses` cannot tell that from never having been assigned, so a
  // second run must not restore it.
  await db.exec(`update pennsync_private.assignment set status = 'revoked'
    where app_id = '${APP}' and patient_id = 'rec-p1'`);
  assert.deepEqual(await chartsOf(CLINICIAN_A), [], 'the revocation closes the chart');
  const afterRevoke = planBackfill(readExport(exported), await roster(), await existing());
  assert.deepEqual(afterRevoke.grants, [], 'a withdrawn assignment is never re-granted');
  assert.deepEqual(afterRevoke.skipped.map(entry => entry.reason), ['already_recorded']);
  assert.deepEqual(await chartsOf(CLINICIAN_A), []);
});
