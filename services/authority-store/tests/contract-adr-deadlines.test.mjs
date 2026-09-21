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
 * ADR response deadline reminders.
 *
 * The first D49 sweep with nothing paused — its reminder is a row rather than
 * an email — and the evidence for why `notification_mint` is a facility. The
 * original creates its reminder with none of the six authority columns
 * `manageMyNotifications` filters on, so in Base44 today an ADR deadline
 * reminder is never shown to anybody. The last test proves the port does not
 * repeat that, by reading the reminder back through the reader.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const NOTE_HISTORY = 'services/authority-store/supabase/record-migrations/'
  + '20260920170000_contract_note_history.sql';
const MINT = 'services/authority-store/supabase/record-migrations/'
  + '20260920285000_notification_mint.sql';
const READER = 'services/authority-store/supabase/record-migrations/'
  + '20260920300000_contract_notification.sql';
const CREDENTIAL_SWEEP = 'services/authority-store/supabase/record-migrations/'
  + '20260920340000_contract_credential_sweep.sql';
const ADR = 'services/authority-store/supabase/record-migrations/'
  + '20260920350000_contract_adr_deadlines.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const SWEEP = 'select "public"."pennsync_contract_adr_deadline_sweep"($1) as result';
const LIST = 'select "public"."pennsync_contract_notification_list"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // `agency_today` arrives with the credential sweep; `caller_membership` with
  // the note-history contract.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE,
    NOTE_HISTORY, MINT, READER, CREDENTIAL_SWEEP, ADR]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, agency] of [['patient-a1', A], ['patient-b1', B]]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","first_name","last_name")
      values ($1,$2,$3,'Ada','Lovelace')`, [APP, id, agency]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = true) {
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
const sweep = (n, agency = A) => as(n, SWEEP, [agency]);
const list = (n, agency = A) => as(n, LIST, [agency]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
// `agency_today` is the agency's calendar day, so the fixture dates are built
// from the same expression rather than from the test runner's clock.
// `adr_audit_case` carries its own agency since D61 — its only tenant path was
// an OPTIONAL `patient_id`, so a case filed before a chart existed was in no
// tenant — and D24 still narrows it to the chart wherever a subject is named.
const seedCase = async (id, agency, days, overrides = {}) => {
  const row = {
    agency_id: agency,
    created_by: email(CLINICIAN_A), case_name: 'Claim 8812',
    status: 'letter_uploaded', deadline_reminders: null,
    patient_id: agency === A ? 'patient-a1' : 'patient-b1', ...overrides,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into ${SCHEMA}."adr_audit_case" ("source_app_id","id",
      "response_due_date",${keys.map(k => `"${k}"`).join(',')})
     values ($1,$2,(${SCHEMA}.agency_today() + $3::integer),
       ${keys.map((_, i) => `$${i + 4}`).join(',')})`,
    [APP, id, days, ...keys.map(k => row[k])]);
};
const clear = async () => {
  await db.query(`delete from ${SCHEMA}."adr_audit_case"`);
  await db.query(`delete from ${SCHEMA}."notification"`);
};

test('a reminder fires on the planner s days and on no others', async () => {
  await clear();
  // The original's `[7, 3, 1, 0]` pre-window, exactly — not "within seven
  // days", which would fire every day.
  for (const days of [10, 7, 5, 3, 2, 1, 0]) await seedCase(`due-${days}`, A, days);
  const result = await sweep(ADMIN_A);
  assert.deepEqual(result.reminders.map(r => r.days_left).sort((a, b) => a - b),
    [0, 1, 3, 7]);
  assert.equal(result.notified, 4);
  assert.equal(result.unreachable_count, 0);
});

test('an overdue case is reminded for a week and then left alone', async () => {
  await clear();
  for (const days of [-1, -7, -8, -30]) await seedCase(`over-${-days}`, A, days);
  const result = await sweep(ADMIN_A);
  assert.deepEqual(result.reminders.map(r => r.days_left).sort((a, b) => a - b),
    [-7, -1]);
  const titles = (await list(CLINICIAN_A)).notifications.map(n => n.title).sort();
  assert.deepEqual(titles, ['🚨 ADR response overdue by 1 day',
    '🚨 ADR response overdue by 7 days']);
});

test('the wording and the urgency are the original s', async () => {
  await clear();
  await seedCase('due-today', A, 0);
  await seedCase('due-3', A, 3);
  await sweep(ADMIN_A);
  const seen = (await list(CLINICIAN_A)).notifications;
  const today = seen.find(n => n.title.includes('TODAY'));
  assert.equal(today.title, '⏰ ADR response due TODAY');
  assert.match(today.message, /the documentation response is due \d{4}-\d{2}-\d{2}\./);
  assert.match(today.message,
    /Documentation not received by the deadline is treated as missing and the claim is denied\./);
  assert.equal(today.priority, 'critical', 'due today or tomorrow is critical');
  assert.equal(today.type, 'compliance_alert');
  assert.equal(today.action_url, '/ADRCenter');
  const three = seen.find(n => n.title.includes('in 3 days'));
  assert.equal(three.title, '⏰ ADR response due in 3 days');
  assert.equal(three.priority, 'high');
  // Singular and plural, which the original spells out.
  await clear();
  await seedCase('due-1', A, 1);
  await sweep(ADMIN_A);
  assert.equal((await list(CLINICIAN_A)).notifications[0].title,
    '⏰ ADR response due in 1 day');
});

test('a closed case, an unowned case and another agency s are all skipped', async () => {
  await clear();
  await seedCase('open', A, 3);
  await seedCase('submitted', A, 3, { status: 'submitted' });
  await seedCase('closed', A, 3, { status: 'closed' });
  await seedCase('no-owner', A, 3, { created_by: '' });
  // A case with no patient IS reminded, and that is D61. Until the case
  // carried its own `agency_id`, its only tenant path was this optional
  // `patient_id` — so a case filed before a chart existed was in no tenant,
  // invisible to everyone including the administrator sweeping for it, and no
  // predicate here could reach it. This assertion used to say so.
  await seedCase('no-chart', A, 3, { patient_id: null });
  // Agency B's case belongs to agency B's own member; `clinician-a` is not on
  // that roster, so a case of theirs naming them would be unreachable.
  await seedCase('theirs', B, 3, { created_by: email(ADMIN_B) });
  const result = await sweep(ADMIN_A);
  assert.deepEqual(result.reminders.map(r => r.case_id), ['no-chart', 'open']);
  // Agency B's case is reminded by agency B's administrator, not this one.
  assert.deepEqual((await sweep(ADMIN_B, B)).reminders.map(r => r.case_id), ['theirs']);
});

test('a case whose owner has left is reported rather than silently dropped', async () => {
  // Divergence 3. The original mints a row addressed to whatever string is on
  // `created_by`; a deadline with no owner is the thing an administrator most
  // needs to see, so it comes back in the answer.
  await clear();
  await seedCase('orphan', A, 1, { created_by: 'departed@example.invalid' });
  await seedCase('mine', A, 1);
  const result = await sweep(ADMIN_A);
  assert.equal(result.notified, 1);
  assert.equal(result.unreachable_count, 1);
  assert.equal(result.unreachable[0].case_id, 'orphan');
  assert.equal(result.unreachable[0].created_by, 'departed@example.invalid');
  assert.equal(result.unreachable[0].days_left, 1);
  // And nothing was written for it.
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."notification"`)).rows[0].n, 1);
});

test('a case is reminded once a day, and the claim is in the same transaction', async () => {
  await clear();
  await seedCase('daily', A, 3);
  assert.equal((await sweep(ADMIN_A)).notified, 1);
  assert.equal((await sweep(ADMIN_A)).notified, 0, 'already reminded today');
  const reminders = (await db.query(
    `select "deadline_reminders" as r from ${SCHEMA}."adr_audit_case" where "id" = 'daily'`
  )).rows[0].r;
  assert.equal(reminders.last_days_left, 3);
  assert.ok(reminders.last_notified_date);
  // Yesterday's claim does not suppress today's — but the dedupe index does,
  // and when the two disagree the index wins. Editing the claim back to
  // yesterday is exactly that disagreement, and it is counted rather than
  // raising a raw duplicate-key error the boundary could not classify.
  await db.query(`update ${SCHEMA}."adr_audit_case"
    set "deadline_reminders" = jsonb_build_object('last_notified_date',
      to_char(${SCHEMA}.agency_today() - 1, 'YYYY-MM-DD')) where "id" = 'daily'`);
  const again = await sweep(ADMIN_A);
  assert.equal(again.notified, 0);
  assert.equal(again.already_reminded, 1);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."notification"`)).rows[0].n, 1);
  // With yesterday's reminder really gone, today's fires.
  await db.query(`delete from ${SCHEMA}."notification"`);
  assert.equal((await sweep(ADMIN_A)).notified, 1);
  // The original's run token and its release-on-failure path are what one
  // transaction removes: a reminder and its claim cannot disagree.
  const source = readFileSync(resolve(repository, ADR), 'utf8');
  // Scoped to the contract body: the header names the mechanism it deletes.
  const body = source.slice(
    source.indexOf('create function "pennsync_records".contract_adr_deadline_sweep'),
    source.indexOf('reset role;'))
    // Comments out: the header and the body both NAME the mechanism they
    // delete, and naming it is the point.
    .split('\n').map(line => line.replace(/--.*$/, '')).join('\n');
  assert.ok(body.length > 1000, 'the slice really covers the contract body');
  assert.equal(body.includes('claimed_by'), false);
});

test('the reminder is one the reader can actually find', async () => {
  // The whole reason `notification_mint` is a facility. The original creates
  // its reminder with none of the six authority columns the reader filters on,
  // so in Base44 today an ADR deadline reminder is shown to nobody.
  await clear();
  await seedCase('visible', A, 0);
  const result = await sweep(ADMIN_A);
  const seen = await list(CLINICIAN_A);
  assert.equal(seen.notifications.length, 1);
  assert.equal(seen.notifications[0].id, result.reminders[0].notification_id);
  // And the original's omission is read rather than asserted, so this fails if
  // the original is ever fixed and the port's reason changes.
  const original = readFileSync(resolve(repository,
    'base44/functions/checkAdrDeadlines/entry.ts'), 'utf8');
  const create = original.slice(original.indexOf('entities.Notification.create({'),
    original.indexOf('entities.Notification.create({') + 600);
  for (const column of ['recipient_user_id', 'recipient_membership_id',
    'authority_version']) {
    assert.equal(create.includes(column), false,
      `the original still omits ${column}; the port's reason has changed`);
  }
});

test('only the agency administrator sweeps, and only their own agency', async () => {
  await refusal(sweep(CLINICIAN_A), 'PENNSYNC_ADR_FORBIDDEN');
  await refusal(sweep(ADMIN_A, B), 'PENNSYNC_ADR_FORBIDDEN');
});
