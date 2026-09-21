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
 * Creating a notification for somebody else.
 *
 * The writer half of D45. Two properties carry it: the authority envelope is
 * `notification_mint`'s and not this contract's — so a row it writes is one the
 * reader can find, proved here by reading it back through the reader rather
 * than by asserting columns — and the recipient's in-app preference is
 * honoured by the READER, because `notification_preference_read` is
 * `user_email = caller_email()` and the sender cannot ask.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MINT = 'services/authority-store/supabase/record-migrations/'
  + '20260920285000_notification_mint.sql';
const NOTE_HISTORY = 'services/authority-store/supabase/record-migrations/'
  + '20260920170000_contract_note_history.sql';
const READER = 'services/authority-store/supabase/record-migrations/'
  + '20260920300000_contract_notification.sql';
const CREATE = 'services/authority-store/supabase/record-migrations/'
  + '20260920320000_contract_notification_create.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const MAKE = 'select "public"."pennsync_contract_notification_create"($1,$2) as result';
const LIST = 'select "public"."pennsync_contract_notification_list"($1) as result';
const A = 'agency-a'; const B = 'agency-b';
const GOOD = Object.freeze({
  user_email: 'clinician-a@example.invalid', title: 'Chart ready',
  message: 'The visit note is ready for your signature.', type: 'task_assigned',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE,
    NOTE_HISTORY, MINT, READER, CREATE]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.query(`insert into ${SCHEMA}."patient"
    ("source_app_id","id","agency_id","first_name","last_name")
    values ($1,'patient-a1',$2,'Ada','Lovelace'),($1,'patient-a2',$2,'Grace','Hopper')`,
  [APP, A]);
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
const make = (n, body = GOOD, agency = A) => as(n, MAKE, [agency, JSON.stringify(body)]);
const list = (n, agency = A) => as(n, LIST, [agency]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const clear = async () => {
  await db.query(`delete from ${SCHEMA}."notification"`);
  await db.query(`delete from ${SCHEMA}."notification_preference"`);
};

test('a minted notification is one the reader can actually find', async () => {
  // The whole reason `notification_mint` exists. Proved by READING IT BACK
  // through the reader rather than by asserting the columns it stamped: the
  // D45 defect was a writer whose own assertions all passed.
  await clear();
  const made = await make(ADMIN_A);
  assert.equal(made.success, true);
  assert.ok(made.notification_id);
  assert.equal(made.delivery_paused, true, 'Core.SendEmail is not brokered');
  const seen = await list(CLINICIAN_A);
  assert.equal(seen.notifications.length, 1);
  assert.equal(seen.notifications[0].id, made.notification_id);
  assert.equal(seen.notifications[0].title, 'Chart ready');
  assert.equal(seen.notifications[0].type, 'task_assigned');
  assert.equal(seen.notifications[0].priority, 'medium', 'the original defaults it');
  assert.equal(Number(seen.notifications[0].version), 1);
  // And it is not anybody else's.
  assert.equal((await list(ADMIN_A)).notifications.length, 0);
});

test('both parties hold the agency the envelope names', async () => {
  await clear();
  // The original intersects the caller's and the recipient's membership sets
  // and refuses unless exactly one agency is shared. Every request here names
  // its tenant, which is the same invariant D34 settled, so the question is
  // simply whether both hold it.
  await refusal(make(ADMIN_A, { ...GOOD, user_email: email(ADMIN_B) }),
    'PENNSYNC_NOTIFICATION_RECIPIENT_UNKNOWN');
  await refusal(make(ADMIN_A, { ...GOOD, user_email: 'nobody@example.invalid' }),
    'PENNSYNC_NOTIFICATION_RECIPIENT_UNKNOWN');
  await refusal(make(ADMIN_A, GOOD, B), 'PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD');
  // The address is matched as the identity store holds it, not as sent.
  const made = await make(ADMIN_A, { ...GOOD, user_email: '  CLINICIAN-A@Example.Invalid ' });
  assert.ok(made.notification_id);
});

test('a non-administrator notifies few people and few things', async () => {
  await clear();
  // The original's two rules: a restricted type set, and only yourself or an
  // administrator. `role === 'admin'` on the recipient becomes their tenant
  // role, because D23 says the carried profile decides nothing.
  await refusal(make(CLINICIAN_A, { ...GOOD, user_email: email(CLINICIAN_A),
    type: 'critical_alert' }), 'PENNSYNC_NOTIFICATION_TYPE_FORBIDDEN');
  await refusal(make(CLINICIAN_A, { ...GOOD, user_email: email(CLINICIAN_EMPTY) }),
    'PENNSYNC_NOTIFICATION_RECIPIENT_FORBIDDEN');
  // Themselves is allowed.
  assert.ok((await make(CLINICIAN_A, { ...GOOD, user_email: email(CLINICIAN_A) }))
    .notification_id);
  // And an administrator is allowed.
  assert.ok((await make(CLINICIAN_A, { ...GOOD, user_email: email(ADMIN_A) }))
    .notification_id);
  // A manager or an agency administrator may send anything to anybody in the
  // agency.
  assert.ok((await make(ADMIN_A, { ...GOOD, user_email: email(CLINICIAN_EMPTY),
    type: 'critical_alert', priority: 'critical' })).notification_id);
});

test('a patient notification goes only to somebody who opens that chart', async () => {
  await clear();
  // Divergence 4. The original asks whether the RECIPIENT created a visit on
  // the patient; D24 made care-team membership the authority for chart access,
  // and this asks that. It is asked of the recipient, so no policy can answer
  // it — a policy binds the caller.
  await refusal(make(ADMIN_A, { ...GOOD, user_email: email(CLINICIAN_EMPTY),
    type: 'patient_alert', patient_id: 'patient-a1' }),
  'PENNSYNC_NOTIFICATION_PATIENT_FORBIDDEN');
  // `clinician-a` is on patient-a1's care team in the fixtures.
  assert.ok((await make(ADMIN_A, { ...GOOD, user_email: email(CLINICIAN_A),
    type: 'patient_alert', patient_id: 'patient-a1' })).notification_id);
  // But not on patient-a2's.
  await refusal(make(ADMIN_A, { ...GOOD, user_email: email(CLINICIAN_A),
    type: 'patient_alert', patient_id: 'patient-a2' }),
  'PENNSYNC_NOTIFICATION_PATIENT_FORBIDDEN');
  // An administrator opens every chart, so they may be told about any of them.
  assert.ok((await make(ADMIN_A, { ...GOOD, user_email: email(ADMIN_A),
    type: 'patient_alert', patient_id: 'patient-a2' })).notification_id);
  // The three types the original exempts name a patient without being about
  // one, and skip the check.
  for (const type of ['compliance_alert', 'report_ready', 'training_due']) {
    assert.ok((await make(ADMIN_A, { ...GOOD, user_email: email(CLINICIAN_EMPTY),
      type, patient_id: 'patient-a1' })).notification_id, type);
  }
});

test('the body is checked the way the original checks it', async () => {
  await clear();
  for (const patch of [{ title: '' }, { message: null }, { type: 'gossip' },
    { user_email: 'not-an-address' }]) {
    await refusal(make(ADMIN_A, { ...GOOD, ...patch }), 'PENNSYNC_NOTIFICATION_REQUIRED');
  }
  await refusal(make(ADMIN_A, { ...GOOD, colour: 'red' }),
    'PENNSYNC_NOTIFICATION_FIELD_UNSUPPORTED');
  await refusal(make(ADMIN_A, { ...GOOD, metadata: [1, 2] }),
    'PENNSYNC_NOTIFICATION_FIELD_UNSUPPORTED');
  await refusal(make(ADMIN_A, { ...GOOD, patient_id: 'has spaces' }),
    'PENNSYNC_NOTIFICATION_SUBJECT_INVALID');
  // A link that leaves the product is refused at the door rather than stored
  // and projected away later.
  for (const url of ['https://evil.invalid/x', '//evil.invalid/x', '/a\\b']) {
    await refusal(make(ADMIN_A, { ...GOOD, action_url: url }),
      'PENNSYNC_NOTIFICATION_ACTION_URL_INVALID');
  }
  const made = await make(ADMIN_A, { ...GOOD, action_url: '/Visits?tab=open',
    action_label: 'Open the visit', priority: 'nonsense' });
  const seen = (await list(CLINICIAN_A)).notifications.find(n => n.id === made.notification_id);
  assert.equal(seen.action_url, '/Visits?tab=open');
  assert.equal(seen.action_label, 'Open the visit');
  assert.equal(seen.priority, 'medium', 'an unknown priority defaults rather than refusing');
});

test('the recipient s in-app preference is honoured by the reader', async () => {
  // The sender CANNOT read it: `notification_preference_read` is
  // `user_email = caller_email()`, and the table is force-RLS so no role
  // escapes. The row is written either way, so what was sent stays
  // answerable, and the preference that decides what is shown is the current
  // one rather than the one held at send time.
  await clear();
  await make(ADMIN_A, { ...GOOD, type: 'task_assigned' });
  await make(ADMIN_A, { ...GOOD, type: 'info' });
  assert.equal((await list(CLINICIAN_A)).notifications.length, 2);
  // One type off.
  await db.query(`insert into ${SCHEMA}."notification_preference"
    ("source_app_id","id","user_email","in_app_notifications_enabled","preferences")
    values ($1,'pref-1',$2,true,$3)`,
  [APP, email(CLINICIAN_A), JSON.stringify({ task_assigned: { in_app: false } })]);
  assert.deepEqual((await list(CLINICIAN_A)).notifications.map(n => n.type), ['info']);
  // Both rows are still there; the reader filters, the writer did not.
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."notification"`)).rows[0].n, 2);
  // In-app off entirely.
  await db.query(`update ${SCHEMA}."notification_preference"
    set "in_app_notifications_enabled" = false where "id" = 'pref-1'`);
  assert.equal((await list(CLINICIAN_A)).notifications.length, 0);
  // Only an explicit false disables: an absent key, and a row with no
  // `preferences` at all, both show everything.
  await db.query(`update ${SCHEMA}."notification_preference"
    set "in_app_notifications_enabled" = true, "preferences" = null where "id" = 'pref-1'`);
  assert.equal((await list(CLINICIAN_A)).notifications.length, 2);
  // And it is the RECIPIENT's preference, not the sender's.
  await db.query(`insert into ${SCHEMA}."notification_preference"
    ("source_app_id","id","user_email","in_app_notifications_enabled")
    values ($1,'pref-2',$2,false)`, [APP, email(ADMIN_A)]);
  assert.equal((await list(CLINICIAN_A)).notifications.length, 2);
});

test('the envelope lives in the facility and nowhere else', async () => {
  // The D45 lesson made structural: two callers, one place to get it wrong.
  const inserts = [];
  for (const file of ['20260920285000_notification_mint.sql',
    '20260920290000_contract_incident.sql',
    '20260920300000_contract_notification.sql',
    '20260920320000_contract_notification_create.sql']) {
    const source = readFileSync(resolve(repository,
      `services/authority-store/supabase/record-migrations/${file}`), 'utf8');
    if (/insert into "pennsync_records"\."notification"/.test(source)) inserts.push(file);
  }
  assert.deepEqual(inserts, ['20260920285000_notification_mint.sql'],
    'only the facility writes a notification row');
});
