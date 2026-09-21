import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';
import { transpileTs } from '../../../tools-transpile-ts.mjs';

/**
 * The care-team assignment lifecycle (`contract_assignment_inspect` /
 * `contract_assignment_transition`).
 *
 * This is the port that **re-enables a capability paused at source**, so the
 * burden here is higher than for the others: the pause named conditions, and
 * these tests are where the conditions are met rather than claimed. Two of
 * them live next door in `record-contract-postgres.test.mjs`, which drives the
 * concurrency matrix through two real connections — PGlite is one process and
 * cannot show a lock wait.
 *
 * The property this file exists for: **a suspension actually closes the
 * chart.** Every other ported capability authorizes on these rows through
 * `caller_assigned_patients`, and until now nothing could take a clinician off
 * a care team. The lifecycle test asserts that through `listAuthorizedPatients`
 * — a capability already ported, called as the clinician — rather than through
 * the assignment row it just wrote or the helper no caller may execute.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CLAIM = 'services/authority-store/supabase/record-migrations/'
  + '20260920110000_claim_new_chart.sql';
// Loaded so the chart closure can be proved through a capability that is
// already ported, rather than through the helper it calls.
const PURPOSE = 'services/authority-store/supabase/record-migrations/'
  + '20260920050000_patient_purpose_policy.sql';
const PATIENT_READ = 'services/authority-store/supabase/record-migrations/'
  + '20260920060000_contract_patient_read.sql';
const ASSIGNMENT = 'services/authority-store/supabase/record-migrations/'
  + '20260920180000_contract_assignment.sql';
const ORIGINAL = 'base44/functions/managePatientCareTeamAssignment/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const b44 = n => `6aac00000000${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const SPARE_A = 3; const ADMIN_B = 4;
const INSPECT = 'select "public"."pennsync_contract_assignment_inspect"($1,$2,$3) as result';
const MOVE = 'select "public"."pennsync_contract_assignment_transition"'
  + '($1,$2,$3,$4,$5,$6,$7) as result';
const A = 'agency-a'; const B = 'agency-b';
// One chart per lifecycle so a committed transition cannot leak sideways.
const WALK = pid(1); const OTHER = pid(2); const ELSEWHERE = pid(3);
const ARCHIVED = pid(4); const IDEMPOTENT = pid(5); const STALE = pid(6);
let db;
let counter = 0;
const nextRequest = () => `req-${++counter}`;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, PURPOSE, PATIENT_READ,
    CLAIM, ASSIGNMENT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency, archived] of [
    [WALK, A, false], [OTHER, A, false], [ELSEWHERE, B, false],
    [ARCHIVED, A, true], [IDEMPOTENT, A, false], [STALE, A, false],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived",
       "first_name","last_name","created_by")
      values ($1,$2,$3,'active',false,$4,'Ada','Lovelace',$5)`,
    [APP, id, agency, archived, 'admin-a@example.invalid']);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = false) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const inspect = (n, patient, target = b44(CLINICIAN_A), agency = A) =>
  as(n, INSPECT, [agency, patient, target]);
const move = (n, patient, action, {
  target = b44(CLINICIAN_A), agency = A, request = null, reason = 'covering the weekend',
  version = null,
} = {}) => as(n, MOVE, [agency, patient, target, action, request ?? nextRequest(), reason, version], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
/**
 * Whether the chart is open, asked the way the PRODUCT asks it.
 *
 * Not `caller_assigned_patients` directly — `authenticated` holds no execute
 * on that helper, and a test that granted itself one would be proving
 * something no caller can do. This goes through `listAuthorizedPatients`,
 * already ported, whose `roster` purpose admits a clinician and whose
 * projection is narrowed to the care team by the same policies every other
 * capability inherits. If a suspension does not close the chart here, it does
 * not close it anywhere.
 */
const opensChart = async (n, patient, agency = A) => {
  const result = await as(n,
    'select "public"."pennsync_contract_patient_list"($1,$2,null,$3,null) as result',
    // The `roster` purpose's own page size; the contract refuses null rather
    // than defaulting, the way the original refuses it.
    [agency, 'roster', 50]);
  return (result.patients ?? []).some(row => row.id === patient);
};

test('only an agency manager may ask, and only about their own agency', async () => {
  await refusal(inspect(CLINICIAN_A, WALK), 'PENNSYNC_ASSIGNMENT_FORBIDDEN');
  await refusal(move(CLINICIAN_A, WALK, 'grant'), 'PENNSYNC_ASSIGNMENT_FORBIDDEN');
  // An agency the caller holds no membership in is refused before anything
  // else, so it cannot be used to ask whether a patient or a person exists.
  await refusal(inspect(ADMIN_A, ELSEWHERE, b44(ADMIN_B), B), 'PENNSYNC_ASSIGNMENT_AGENCY_NOT_HELD');
  await refusal(inspect(ADMIN_B, WALK, b44(CLINICIAN_A), A), 'PENNSYNC_ASSIGNMENT_AGENCY_NOT_HELD');
  // `office_staff` is a tenant role the original's MANAGER_ROLES excludes.
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  await refusal(inspect(SPARE_A, WALK), 'PENNSYNC_ASSIGNMENT_FORBIDDEN');
  await db.exec(`update pennsync_private.membership set tenant_role = 'clinician'
    where id = 'membership-3'`);
});

test('the target must be an active colleague in the same agency', async () => {
  // A real person, but in the other agency.
  await refusal(inspect(ADMIN_A, WALK, b44(ADMIN_B)), 'PENNSYNC_ASSIGNMENT_TARGET_NOT_A_COLLEAGUE');
  await refusal(inspect(ADMIN_A, WALK, 'nobody-at-all'), 'PENNSYNC_ASSIGNMENT_TARGET_NOT_A_COLLEAGUE');
  await db.exec(`update pennsync_private.membership set status = 'revoked',
    revoked_at = clock_timestamp(), revoked_by = '${'10000000-0000-4000-8000-000000000001'}'
    where id = 'membership-3'`);
  await refusal(inspect(ADMIN_A, WALK, b44(SPARE_A)), 'PENNSYNC_ASSIGNMENT_TARGET_NOT_A_COLLEAGUE');
  await db.exec(`update pennsync_private.membership set status = 'active',
    revoked_at = null, revoked_by = null where id = 'membership-3'`);
});

test('arguments are checked before the chart or the colleague is looked at', async () => {
  await refusal(inspect(ADMIN_A, 'has spaces'), 'PENNSYNC_ASSIGNMENT_SUBJECT_INVALID');
  await refusal(inspect(ADMIN_A, WALK, 'has spaces'), 'PENNSYNC_ASSIGNMENT_SUBJECT_INVALID');
  await refusal(move(ADMIN_A, WALK, 'delete'), 'PENNSYNC_ASSIGNMENT_ACTION_INVALID');
  await refusal(move(ADMIN_A, WALK, 'grant', { request: 'has spaces' }),
    'PENNSYNC_ASSIGNMENT_REQUEST_ID_INVALID');
  await refusal(move(ADMIN_A, WALK, 'grant', { reason: '   ' }),
    'PENNSYNC_ASSIGNMENT_REASON_REQUIRED');
  await refusal(move(ADMIN_A, WALK, 'grant', { reason: 'x'.repeat(501) }),
    'PENNSYNC_ASSIGNMENT_REASON_REQUIRED');
  // The version is required for a transition and refused for a grant, because
  // a grant has no prior state the caller could have read.
  await refusal(move(ADMIN_A, WALK, 'suspend'), 'PENNSYNC_ASSIGNMENT_VERSION_REQUIRED');
  await refusal(move(ADMIN_A, WALK, 'grant', { version: 1 }),
    'PENNSYNC_ASSIGNMENT_VERSION_UNEXPECTED');
});

test('the reason is the original\'s boundedReason, proved against it', async () => {
  let source = await readFile(resolve(repository, ORIGINAL), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, '');
  source = source.replace(/Deno\.serve\([\s\S]*$/, '');
  source += '\nexport { boundedReason };\n';
  const file = join(tmpdir(), `reasonparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let boundedReason;
  try { ({ boundedReason } = await import(pathToFileURL(file).href)); }
  finally { await unlink(file).catch(() => {}); }

  // Three families the obvious `btrim(x) <> '' and length(x) <= 500` gets
  // wrong: Unicode space separators the JavaScript trim strips, astral
  // characters that count TWICE toward the cap, and the control class the
  // original tests only after trimming.
  const cases = [
    'granted for the weekend rotation', '  padded  ', '', '   ', '\t\n', ' ',
    '  real  ', ' ideographic　', '﻿bom', 'a\u000bb',
    '\u000bwrapped\u000c', 'tab\there', 'line\nbreak', 'cr\rhere', 'del\u007fhere',
    'bell\u0007here', 'x'.repeat(500), 'x'.repeat(501), '\u{1F600}'.repeat(250),
    '\u{1F600}'.repeat(251), `  ${'x'.repeat(500)}  `, 'é'.repeat(500), 'a\u001fb',
    ' ls ',
  ];
  for (const input of cases) {
    const { rows } = await db.query('select "pennsync_records".bounded_reason($1) as r', [input]);
    assert.equal(rows[0].r, boundedReason(input), `bounded_reason disagreed on ${JSON.stringify(input)}`);
  }
  assert.ok(cases.some(input => boundedReason(input) === null), 'the table must contain refusals');
});

test('inspect answers a chart with no assignment rather than refusing', async () => {
  const result = await inspect(ADMIN_A, OTHER);
  assert.equal(result.assigned, false);
  assert.equal(result.assignment, null);
  assert.equal(result.target_user_id, b44(CLINICIAN_A));
  assert.equal(result.tenant_role, 'clinician');
});

test('a chart outside the agency is not visible even to its own manager', async () => {
  await refusal(inspect(ADMIN_A, ELSEWHERE), 'PENNSYNC_ASSIGNMENT_PATIENT_NOT_VISIBLE');
  await refusal(move(ADMIN_A, ELSEWHERE, 'grant'), 'PENNSYNC_ASSIGNMENT_PATIENT_NOT_VISIBLE');
});

test('an archived chart may be closed but not opened', async () => {
  // The original's ENABLING_ACTIONS check: taking access away must work on a
  // chart that has since been archived, because withdrawal is never the thing
  // to block. Inspect reads the wider set, so the manager can still look.
  await refusal(move(ADMIN_A, ARCHIVED, 'grant'), 'PENNSYNC_ASSIGNMENT_PATIENT_NOT_VISIBLE');
  const looked = await inspect(ADMIN_A, ARCHIVED);
  assert.equal(looked.assigned, false);
  // Put the clinician on it while it is open, then archive it and revoke.
  await db.query(`update ${SCHEMA}."patient" set "is_archived" = false
    where "source_app_id" = $1 and "id" = $2`, [APP, ARCHIVED]);
  const granted = await move(ADMIN_A, ARCHIVED, 'grant');
  assert.equal(granted.assignment.status, 'active');
  await db.query(`update ${SCHEMA}."patient" set "is_archived" = true
    where "source_app_id" = $1 and "id" = $2`, [APP, ARCHIVED]);
  const revoked = await move(ADMIN_A, ARCHIVED, 'revoke', { version: 1 });
  assert.equal(revoked.assignment.status, 'revoked');
});

test('the lifecycle walks grant, suspend, activate, revoke and stops there', async () => {
  assert.equal(await opensChart(CLINICIAN_A, WALK), false);

  const granted = await move(ADMIN_A, WALK, 'grant', { reason: 'weekend rotation' });
  assert.equal(granted.action, 'grant');
  assert.equal(granted.assignment.status, 'active');
  assert.equal(granted.assignment.version, 1);
  assert.equal(granted.assignment.last_reason, 'weekend rotation');
  assert.ok(granted.assignment.granted_at);
  assert.equal(granted.assignment.suspended_at, null);
  // The whole point of the capability: the chart is now open to the clinician.
  assert.equal(await opensChart(CLINICIAN_A, WALK), true);
  const seen = await inspect(ADMIN_A, WALK);
  assert.equal(seen.assigned, true);
  assert.equal(seen.assignment.version, 1);

  // A second grant is not a retry; the pair already has a row.
  await refusal(move(ADMIN_A, WALK, 'grant'), 'PENNSYNC_ASSIGNMENT_EXISTS');
  // An active assignment cannot be activated again.
  await refusal(move(ADMIN_A, WALK, 'activate', { version: 1 }),
    'PENNSYNC_ASSIGNMENT_TRANSITION');

  const suspended = await move(ADMIN_A, WALK, 'suspend', { version: 1, reason: 'on leave' });
  assert.equal(suspended.assignment.status, 'suspended');
  assert.equal(suspended.assignment.version, 2);
  assert.ok(suspended.assignment.suspended_at);
  // **The closure.** Asserted through the helper every policy calls, so this
  // says the chart is shut rather than that a column changed.
  assert.equal(await opensChart(CLINICIAN_A, WALK), false);
  // Inspect still finds the row; `assigned` is about access, not existence.
  const dormant = await inspect(ADMIN_A, WALK);
  assert.equal(dormant.assigned, false);
  assert.equal(dormant.assignment.status, 'suspended');

  await refusal(move(ADMIN_A, WALK, 'suspend', { version: 2 }), 'PENNSYNC_ASSIGNMENT_TRANSITION');

  const reactivated = await move(ADMIN_A, WALK, 'activate', { version: 2, reason: 'back' });
  assert.equal(reactivated.assignment.status, 'active');
  assert.equal(reactivated.assignment.version, 3);
  assert.equal(await opensChart(CLINICIAN_A, WALK), true);

  const revoked = await move(ADMIN_A, WALK, 'revoke', { version: 3, reason: 'left the agency' });
  assert.equal(revoked.assignment.status, 'revoked');
  assert.equal(revoked.assignment.version, 4);
  assert.ok(revoked.assignment.revoked_at);
  assert.equal(await opensChart(CLINICIAN_A, WALK), false);

  // Terminal. Putting the person back on the chart is a new decision, and the
  // record that they were once on it survives either way.
  for (const [action, version] of [['activate', 4], ['suspend', 4], ['revoke', 4], ['grant', null]]) {
    await refusal(move(ADMIN_A, WALK, action, { version }),
      action === 'grant' ? 'PENNSYNC_ASSIGNMENT_EXISTS' : 'PENNSYNC_ASSIGNMENT_REVOKED');
  }
});

test('a transition against a version the caller did not read is refused', async () => {
  await move(ADMIN_A, STALE, 'grant');
  // The manager who loaded the row at version 1, after somebody else moved it.
  await move(ADMIN_A, STALE, 'suspend', { version: 1 });
  await refusal(move(ADMIN_A, STALE, 'activate', { version: 1 }), 'PENNSYNC_ASSIGNMENT_STALE');
  await refusal(move(ADMIN_A, STALE, 'revoke', { version: 99 }), 'PENNSYNC_ASSIGNMENT_STALE');
  // The version they would have read after refreshing works.
  const moved = await move(ADMIN_A, STALE, 'activate', { version: 2 });
  assert.equal(moved.assignment.version, 3);
  // A transition on a pair with no row at all is a miss, not a stale read.
  await refusal(move(ADMIN_A, OTHER, 'suspend', { version: 1 }), 'PENNSYNC_ASSIGNMENT_NOT_FOUND');
});

test('a retried request answers what it already did, and a reused one conflicts', async () => {
  const request = 'retry-me';
  const first = await move(ADMIN_A, IDEMPOTENT, 'grant', { request });
  const again = await move(ADMIN_A, IDEMPOTENT, 'grant', { request });
  // The same row, not a second grant and not an EXISTS refusal.
  assert.equal(again.assignment.version, first.assignment.version);
  assert.equal(again.assignment.granted_at, first.assignment.granted_at);
  // The same request id naming a different action is a client bug, and saying
  // so is better than applying it or silently answering the wrong one.
  await refusal(move(ADMIN_A, IDEMPOTENT, 'suspend', { request, version: 1 }),
    'PENNSYNC_ASSIGNMENT_REQUEST_CONFLICT');
  // A fresh request id moves it, and retrying THAT is idempotent too.
  const suspended = await move(ADMIN_A, IDEMPOTENT, 'suspend', { request: 'and-again', version: 1 });
  assert.equal(suspended.assignment.version, 2);
  const retried = await move(ADMIN_A, IDEMPOTENT, 'suspend', { request: 'and-again', version: 1 });
  assert.equal(retried.assignment.version, 2);
  // Even a retry that arrives with a now-stale version, which is what a client
  // that never saw the first answer would send.
  assert.equal(retried.assignment.status, 'suspended');
  // One caller's request id cannot be mistaken for another's: the key carries
  // the agency, the chart and the person, so the same id on a different chart
  // is a different request.
  const elsewhere = await move(ADMIN_A, OTHER, 'grant', { request: 'and-again' });
  assert.equal(elsewhere.assignment.patient_id, OTHER);
  assert.equal(elsewhere.assignment.version, 1);
});

test('the provenance trigger still refuses to rewrite or delete the record', async () => {
  // D24's table says an assignment records that a person was given access to a
  // chart, so which person and which chart can never move and the row can
  // never be deleted. The lifecycle migration must not have loosened that.
  await assert.rejects(db.query(`update pennsync_private.chart_assignment
    set patient_id = $1 where patient_id = $2`, [OTHER, WALK]), /immutable|provenance/i);
  await assert.rejects(db.query(`delete from pennsync_private.chart_assignment
    where patient_id = $1`, [WALK]), /immutable|provenance/i);
  // And the coherence constraint refuses a row the lifecycle cannot produce.
  await assert.rejects(db.query(`update pennsync_private.chart_assignment
    set status = 'active', last_action = 'activate' where patient_id = $1`, [WALK]),
  /chart_assignment_lifecycle_coherent|immutable|provenance/i);
});
