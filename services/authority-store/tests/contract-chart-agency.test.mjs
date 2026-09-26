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
 * A chart that belongs to another agency, hidden on READ.
 *
 * `20260920580000_contract_operational_tables.sql` refuses a write naming a
 * foreign chart and says in its own header that it does not hide one already
 * there. This suite is the other half, and almost all of it is one question
 * asked carefully, because the control is a FILTER: an absent row and a hidden
 * row are the same empty result, with no code to tell them apart. Asserting
 * that a crossed row does not come back proves nothing unless the same fixture
 * has first been shown to RETURN it — the row exists, it is tenanted here, and
 * this caller reaches it. So every case below sabotages the term, asserts the
 * row arrives, restores it, and only then asserts it is gone (D107).
 *
 * The sabotage is the term and nothing else: `chart_not_elsewhere` replaced by
 * one that answers true. The restore is the migration's own text, read back
 * out of the file rather than retyped, so a drift between them cannot make the
 * "after" half pass against a definition this repository does not ship.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const LOCATORS = 'services/authority-store/supabase/record-migrations/'
  + '20260920520000_file_locator_map.sql';
const OPERATIONAL = 'services/authority-store/supabase/record-migrations/'
  + '20260920580000_contract_operational_tables.sql';
const CHART_AGENCY = 'services/authority-store/supabase/record-migrations/'
  + '20260920590000_chart_agency.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1;
const A = 'agency-a'; const B = 'agency-b';

// The four reads this migration replaces, with the row each one is given and
// the argument that fetches it. `contract_care_plan_list` is deliberately
// absent: `care_plan` has no `agency_id`, so its tenancy IS the chart and the
// contract already joins `patient`.
const READS = Object.freeze([
  {
    entity: 'task', label: 'Task',
    call: 'select "public"."pennsync_contract_task_list"($1,null,null,null,null,$2,null) as result',
    args: [A, 'created_date'],
  },
  {
    entity: 'face_to_face_encounter', label: 'FaceToFaceEncounter',
    call: 'select "public"."pennsync_contract_face_to_face_list"($1,null,null) as result',
    args: [A],
  },
  {
    entity: 'document_record', label: 'DocumentRecord',
    call: 'select "public"."pennsync_contract_document_record_list"($1,null,null) as result',
    args: [A],
  },
  {
    entity: 'note_conversion', label: 'NoteConversion',
    call: 'select "public"."pennsync_contract_note_conversion_list"($1,null,null) as result',
    args: [A],
  },
]);

// Three rows per entity, all tenanted to agency A, differing only in the chart
// they name. Their ids say which branch of the term each one exercises.
const CROSSED = 'crossed'; const UNCHARTED = 'uncharted'; const UNCARRIED = 'uncarried';

let db; let restoreTerm;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, LOCATORS,
    OPERATIONAL, CHART_AGENCY]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));

  for (const [id, agency] of [['patient-a1', A], ['patient-b1', B]]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","first_name","last_name","status")
      values ($1,$2,$3,'Synthetic','Chart','active')`, [APP, id, agency]);
  }
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`,
    [APP, id, name]);
  }

  // Written by the administrator, which is what a carried row is: the write
  // contracts refuse the crossed one now, and Base44 never asked the question.
  for (const { entity } of READS) {
    for (const [id, patient] of [[CROSSED, 'patient-b1'], [UNCHARTED, null],
      [UNCARRIED, 'patient-not-in-this-store']]) {
      await db.query(`insert into ${SCHEMA}."${entity}"
        ("source_app_id","id","agency_id","patient_id") values ($1,$2,$3,$4)`,
      [APP, `${entity}-${id}`, A, patient]);
    }
  }

  restoreTerm = termDefinition(readFileSync(resolve(repository, CHART_AGENCY), 'utf8'));
});
after(async () => db?.close());

/** The term's own definition, out of the migration that ships it. */
function termDefinition(sql) {
  const open = sql.indexOf('create function "pennsync_records".chart_not_elsewhere(');
  assert.ok(open >= 0, 'the migration no longer declares chart_not_elsewhere');
  const close = sql.indexOf('$chart$;\n', open);
  assert.ok(close >= 0, 'unterminated chart_not_elsewhere');
  return 'create or replace ' + sql.slice(open + 'create '.length, close + '$chart$;\n'.length);
}

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}

const ids = page => page.entries.map(entry => entry.id).sort();

/** Run `body` with the term answering true for every row, then put it back. */
async function withoutTheTerm(body) {
  await db.exec(`create or replace function "pennsync_records".chart_not_elsewhere(
    p_patient_id text, p_agency text) returns boolean
    language sql stable set search_path = '' as $sabotage$ select true $sabotage$;`);
  try { return await body(); } finally { await db.exec(restoreTerm); }
}

test('the helper answers which agency a chart is in, past every policy', async () => {
  // The property the whole control rests on, and the reason a join could not
  // do this: it tells ABSENT from HIDDEN. Asked as the administrator, which is
  // the role the function is owned by and therefore runs as.
  const { rows } = await db.query(
    `select pennsync_private.chart_agency($1) as carried,
            pennsync_private.chart_agency($2) as absent`,
    ['patient-b1', 'patient-not-in-this-store']);
  assert.equal(rows[0].carried, B);
  assert.equal(rows[0].absent, null);
});

test('no caller role can ask the helper directly', async () => {
  // A caller who could would be able to test any chart id for existence in
  // every tenant at once. `authenticated` has no usage on the schema and the
  // execute grant names the record owner alone.
  await assert.rejects(as(ADMIN_A, 'select pennsync_private.chart_agency($1) as result',
    ['patient-b1']), /permission denied|does not exist/);
});

for (const { entity, label, call, args } of READS) {
  test(`${label}: a row naming another agency's chart is reachable, then hidden`,
    async () => {
      // THE PRECONDITION. Without this the assertion below would pass against
      // a fixture that never had the row, a caller who could not reach it, or
      // a page the limit had already cut — three ways to measure nothing.
      const reachable = await withoutTheTerm(() => as(ADMIN_A, call, args));
      assert.deepEqual(ids(reachable),
        [`${entity}-${CROSSED}`, `${entity}-${UNCARRIED}`, `${entity}-${UNCHARTED}`],
        'the crossed row must be returned with the term removed');

      // And now the control, which is the only thing that changed. The
      // assertion is the EXACT surviving set rather than `!includes(crossed)`:
      // a weaker one is satisfied by a second, different regression — a term
      // that hid all three rows would pass it — and a refusal test that a
      // wrong answer can satisfy is the vacuous case one assertion away.
      assert.deepEqual(ids(await as(ADMIN_A, call, args)),
        [`${entity}-${UNCARRIED}`, `${entity}-${UNCHARTED}`],
        'the term must remove the crossed row and nothing else');
    });

  test(`${label}: a row naming no chart, or one this store does not carry, stays`,
    async () => {
      // The term's other two branches, and they are decisions rather than
      // fallbacks. A row with no `patient_id` is agency-scoped and is not
      // anybody's chart yet; a row whose chart is not carried is UNRESOLVABLE
      // rather than proved crossed, and hiding it would lose a row from its
      // own agency for a reason nobody can see (D61). Without these two cases
      // a tightening that deleted both `is null` branches would pass.
      const page = ids(await as(ADMIN_A, call, args));
      assert.deepEqual(page, [`${entity}-${UNCARRIED}`, `${entity}-${UNCHARTED}`]);
    });
}

test('the four replaced bodies differ from the merged ones by the term alone', async () => {
  // The forward migration carries a copy of four functions that live in an
  // already-merged file, which is the one direction nothing else here
  // measures. Re-derived rather than compared by eye: if the merged body ever
  // changes, this fails instead of the two quietly diverging.
  const { CROSSABLE, originalBody, forwardBody } =
    await import('../../../tools-chart-agency-forward.mjs');
  const merged = readFileSync(resolve(repository, OPERATIONAL), 'utf8');
  const forward = readFileSync(resolve(repository, CHART_AGENCY), 'utf8');
  for (const contract of CROSSABLE) {
    const expected = forwardBody(originalBody(merged, contract.name), contract);
    assert.ok(forward.includes(expected),
      `${contract.name} is not the merged body plus the term`);
  }
  // And nothing else was replaced: four `create or replace`, no more.
  assert.equal(forward.match(/^create or replace function /gm).length, CROSSABLE.length);
});
