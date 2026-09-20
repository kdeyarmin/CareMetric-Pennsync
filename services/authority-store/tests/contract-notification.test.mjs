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
 * A person's own notifications.
 *
 * Two properties carry this file. `notification_read` and
 * `notification_update` are agency-WIDE, so every ownership test here is of
 * the CONTRACT rather than of the policies — the second time tenancy has not
 * been ownership (D36), and the first time the policy says so plainly.
 *
 * And the last test is a cross-contract one: it submits an urgent incident
 * through D44's contract and then reads the alert through this one. That pair
 * is how the missing authority envelope was found — the fan-out stamped three
 * of the six columns this reader filters on, so every alert it wrote would
 * have been invisible to the administrator it was for.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const AUDIT = 'services/authority-store/supabase/record-migrations/'
  + '20260920010000_activity_audit.sql';
const NOTE_HISTORY = 'services/authority-store/supabase/record-migrations/'
  + '20260920170000_contract_note_history.sql';
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const INCIDENT = 'services/authority-store/supabase/record-migrations/'
  + '20260920290000_contract_incident.sql';
const MINT = 'services/authority-store/supabase/record-migrations/'
  + '20260920285000_notification_mint.sql';
const NOTIFICATION = 'services/authority-store/supabase/record-migrations/'
  + '20260920300000_contract_notification.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const base44Id = n => `6aac00000000${String(n).padStart(12, '0')}`.slice(0, 12)
  + uid(n).slice(-12);
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3;
const LIST = 'select "public"."pennsync_contract_notification_list"($1) as result';
const MOVE = 'select "public"."pennsync_contract_notification_transition"($1,$2,$3,$4) as result';
const ALL = 'select "public"."pennsync_contract_notification_mark_all"($1) as result';
const SUBMIT = 'select "public"."pennsync_contract_incident_submit"($1,$2) as result';
const A = 'agency-a';
let db;

const seed = async (id, recipient, overrides = {}) => {
  const member = (await db.query(
    `select "id","version" from pennsync_private.membership
     where "agency_id" = $1 and "base44_user_id" = $2`, [A, base44Id(recipient)])).rows[0];
  const row = {
    title: 'A thing happened', message: 'Have a look when you can.',
    type: 'info', priority: 'medium', action_url: '/Incidents',
    action_label: 'Open', is_read: false, read_at: null,
    dismissed: false, dismissed_at: null, version: 1,
    recipient_membership_id: member.id,
    recipient_membership_version: member.version,
    authority_version: 1, authority_state: 'active',
    recipient_user_id: base44Id(recipient), user_email: email(recipient),
    agency_id: A, ...overrides,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into ${SCHEMA}."notification" ("source_app_id","id","created_date",
      ${keys.map(k => `"${k}"`).join(',')})
     values ($1,$2,clock_timestamp(),${keys.map((_, i) => `$${i + 3}`).join(',')})`,
    [APP, id, ...keys.map(k => row[k])]);
  return id;
};

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // `caller_membership` arrives with the note-history contract (D34); the
  // incident contract is here for the cross-contract test at the end.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, AUDIT,
    NOTE_HISTORY, TIME_OFF, MINT, INCIDENT, NOTIFICATION]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.query(`insert into ${SCHEMA}."patient"
    ("source_app_id","id","agency_id","first_name","last_name")
    values ($1,'patient-a1',$2,'Ada','Lovelace')`, [APP, A]);
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
const list = n => as(n, LIST, [A]);
const move = (n, id, version, action) => as(n, MOVE, [A, id, version, action]);
const markAll = n => as(n, ALL, [A]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const clear = () => db.query(`delete from ${SCHEMA}."notification"`);

test('the base44 id the fixtures mint is the one this file seeds with', async () => {
  // Every ownership test below turns on this, so it is proved rather than
  // assumed: `recipient_user_id` is the Base44 user id. It is read from
  // `identity_map` rather than from `caller_user_id()`, because that helper is
  // granted to the record owner alone and a tenant role calling it gets
  // `permission denied for function` — which is the point of the grant list.
  for (const person of [ADMIN_A, CLINICIAN_A, CLINICIAN_EMPTY]) {
    const row = (await db.query(
      `select "base44_user_id","expected_email" from pennsync_private.identity_map
       where "auth_user_id" = $1`, [uid(person)])).rows[0];
    assert.equal(row.base44_user_id, base44Id(person));
    assert.equal(row.expected_email, email(person));
  }
});

test('a notification is read by the person it is for, not by the agency', async () => {
  // `notification_read` is agency-WIDE — every member of agency A matches it —
  // so this is the contract's own predicate, not the policy's.
  await clear();
  await seed('note-mine', CLINICIAN_A, { title: 'For the clinician' });
  await seed('note-theirs', ADMIN_A, { title: 'For the administrator' });
  const mine = await list(CLINICIAN_A);
  assert.equal(mine.notifications.length, 1);
  assert.equal(mine.notifications[0].title, 'For the clinician');
  assert.equal(mine.complete, true);
  const theirs = await list(ADMIN_A);
  assert.equal(theirs.notifications.length, 1);
  assert.equal(theirs.notifications[0].title, 'For the administrator');
  // And a colleague cannot move somebody else's row either, although the
  // update policy admits them to the table.
  await refusal(move(CLINICIAN_A, 'note-theirs', 1, 'mark_read'),
    'PENNSYNC_NOTIFICATION_NOT_FOUND');
  assert.equal((await db.query(
    `select "is_read" from ${SCHEMA}."notification" where "id" = 'note-theirs'`))
    .rows[0].is_read, false);
});

test('an address that does not match the identity is nobody s', async () => {
  // The original requires `user_email` to agree with `recipient_user_id`; a row
  // carrying one of each is not delivered to either person.
  await clear();
  await seed('note-mismatch', CLINICIAN_A, { user_email: email(ADMIN_A) });
  assert.equal((await list(CLINICIAN_A)).notifications.length, 0);
  assert.equal((await list(ADMIN_A)).notifications.length, 0);
});

test('a membership that moved on leaves its notifications behind', async () => {
  // This is the property that looks like a derived scope and is not: the row
  // records which membership, at which version, it was minted for. The
  // original filters on it, so a stale row is HIDDEN rather than refused.
  await clear();
  await seed('note-current', CLINICIAN_A);
  await seed('note-stale', CLINICIAN_A, { recipient_membership_version: 0 });
  await seed('note-elsewhere', CLINICIAN_A, { recipient_membership_id: 'membership-9' });
  await seed('note-invalidated', CLINICIAN_A, { authority_state: 'invalidated' });
  const answer = await list(CLINICIAN_A);
  assert.equal(answer.notifications.length, 1);
  assert.equal(answer.notifications[0].id, 'note-current');
  for (const id of ['note-stale', 'note-elsewhere', 'note-invalidated']) {
    await refusal(move(CLINICIAN_A, id, 1, 'mark_read'), 'PENNSYNC_NOTIFICATION_NOT_FOUND');
  }
});

test('a dismissed notification leaves the list and stays dismissed', async () => {
  await clear();
  await seed('note-1', CLINICIAN_A);
  const done = await move(CLINICIAN_A, 'note-1', 1, 'dismiss');
  assert.equal(done.idempotent, false);
  // A dismiss marks it read as well, which is the original's own behaviour.
  assert.equal(done.notification.dismissed, true);
  assert.equal(done.notification.is_read, true);
  assert.ok(done.notification.read_at);
  assert.equal(Number(done.notification.version), 2);
  assert.equal((await list(CLINICIAN_A)).notifications.length, 0);
  // Replaying it is idempotent rather than an error, and is answered before
  // the version compare — so the version the caller sent (now stale because
  // its own first attempt moved it) does not fail the retry.
  const again = await move(CLINICIAN_A, 'note-1', 1, 'dismiss');
  assert.equal(again.idempotent, true);
  assert.equal(Number(again.notification.version), 2, 'a replay moves nothing');
});

test('a stale expected_version is refused rather than applied', async () => {
  await clear();
  await seed('note-2', CLINICIAN_A);
  await refusal(move(CLINICIAN_A, 'note-2', 7, 'mark_read'), 'PENNSYNC_NOTIFICATION_STALE');
  assert.equal((await db.query(
    `select "is_read" from ${SCHEMA}."notification" where "id" = 'note-2'`))
    .rows[0].is_read, false);
  const ok = await move(CLINICIAN_A, 'note-2', 1, 'mark_read');
  assert.equal(ok.notification.is_read, true);
  assert.equal(ok.notification.dismissed, false, 'mark_read does not dismiss');
  assert.equal((await list(CLINICIAN_A)).notifications.length, 1, 'read is still listed');
});

test('the envelope, the action and the identifier are all checked', async () => {
  await clear();
  await seed('note-3', CLINICIAN_A);
  await refusal(move(CLINICIAN_A, 'note-3', 1, 'delete'), 'PENNSYNC_NOTIFICATION_ACTION_INVALID');
  await refusal(move(CLINICIAN_A, 'has spaces', 1, 'mark_read'),
    'PENNSYNC_NOTIFICATION_SUBJECT_INVALID');
  await refusal(move(CLINICIAN_A, 'note-3', 0, 'mark_read'),
    'PENNSYNC_NOTIFICATION_VERSION_INVALID');
  await refusal(as(CLINICIAN_A, LIST, ['agency-b']), 'PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD');
  await refusal(as(CLINICIAN_A, ALL, ['agency-b']), 'PENNSYNC_NOTIFICATION_AGENCY_NOT_HELD');
});

test('mark_all_read moves only the caller s unread, undismissed rows', async () => {
  await clear();
  await seed('all-1', CLINICIAN_A);
  await seed('all-2', CLINICIAN_A);
  await seed('all-3', CLINICIAN_A, { is_read: true, read_at: new Date().toISOString() });
  await seed('all-4', CLINICIAN_A, { dismissed: true, dismissed_at: new Date().toISOString(),
    is_read: true, read_at: new Date().toISOString() });
  await seed('all-5', ADMIN_A);
  const answer = await markAll(CLINICIAN_A);
  assert.equal(answer.marked, 2, 'the already-read and the dismissed are not re-marked');
  const rows = (await db.query(
    `select "id","is_read","version" from ${SCHEMA}."notification" order by "id"`)).rows;
  assert.deepEqual(rows.map(r => [r.id, r.is_read, Number(r.version)]), [
    ['all-1', true, 2], ['all-2', true, 2], ['all-3', true, 1],
    ['all-4', true, 1], ['all-5', false, 1],
  ]);
  assert.equal((await markAll(CLINICIAN_A)).marked, 0, 'running it again moves nothing');
});

test('a malformed row is refused rather than shown', async () => {
  // The original throws on a row that passed its filter and then failed its
  // integrity check. In this store that can only mean a contract wrote a bad
  // row, which is worth failing on.
  await clear();
  await seed('bad-read', CLINICIAN_A, { is_read: true, read_at: null });
  await refusal(list(CLINICIAN_A), 'PENNSYNC_NOTIFICATION_INTEGRITY');
  await refusal(move(CLINICIAN_A, 'bad-read', 1, 'mark_read'),
    'PENNSYNC_NOTIFICATION_INTEGRITY');
  await clear();
  await seed('bad-title', CLINICIAN_A, { title: '' });
  await refusal(list(CLINICIAN_A), 'PENNSYNC_NOTIFICATION_INTEGRITY');
});

test('a link that leaves the product is projected away, not followed', async () => {
  // `safeActionUrl`: a notification's link is rendered as a button, so an
  // absolute URL or a protocol-relative host would be an open redirect.
  await clear();
  for (const [id, url] of [
    ['url-ok', '/Incidents?tab=open'], ['url-absolute', 'https://evil.invalid/x'],
    ['url-scheme', '//evil.invalid/x'], ['url-slash', '/a\\b'],
  ]) {
    await seed(id, CLINICIAN_A, { action_url: url });
  }
  await refusal(list(CLINICIAN_A), 'PENNSYNC_NOTIFICATION_INTEGRITY');
  // Each of the three is refused on its own, which is the original's answer:
  // the row carries a link it will not render, so the row is not sound.
  for (const id of ['url-absolute', 'url-scheme', 'url-slash']) {
    await clear();
    await seed(id, CLINICIAN_A, { action_url:
      { 'url-absolute': 'https://evil.invalid/x', 'url-scheme': '//evil.invalid/x',
        'url-slash': '/a\\b' }[id] });
    await refusal(list(CLINICIAN_A), 'PENNSYNC_NOTIFICATION_INTEGRITY');
  }
  await clear();
  await seed('url-ok', CLINICIAN_A, { action_url: '/Incidents?tab=open' });
  assert.equal((await list(CLINICIAN_A)).notifications[0].action_url, '/Incidents?tab=open');
  await clear();
  await seed('url-none', CLINICIAN_A, { action_url: null, action_label: null });
  const answer = await list(CLINICIAN_A);
  assert.equal(answer.notifications[0].action_url, null);
  assert.equal(answer.notifications[0].action_label, null);
});

test('the projection carries no recipient identity and no metadata', async () => {
  await clear();
  await seed('note-p', CLINICIAN_A, { metadata: JSON.stringify({ patient_id: 'patient-a1' }) });
  const row = (await list(CLINICIAN_A)).notifications[0];
  assert.deepEqual(Object.keys(row).sort(), ['action_label', 'action_url', 'agency_id',
    'created_date', 'dismissed', 'dismissed_at', 'id', 'is_read', 'message',
    'priority', 'read_at', 'title', 'type', 'version']);
  assert.equal(JSON.stringify(row).includes('patient-a1'), false);
});

test('D44 urgent alert really reaches the administrator it is for', async () => {
  // The cross-contract test, and the reason this port found a defect in the
  // one before it: `submitIncidentReport`'s fan-out has to stamp all six
  // envelope columns this reader filters on, and a version of it stamped
  // three. Nothing in either contract's own suite could see that.
  await clear();
  await db.query(`insert into pennsync_private.chart_assignment
    (app_id,agency_id,patient_id,membership_id,status,changed_by)
    select $1,$2,'patient-a1','membership-2','active',$3
    where not exists (select 1 from pennsync_private.chart_assignment
      where patient_id = 'patient-a1' and membership_id = 'membership-2')`,
  [APP, A, uid(ADMIN_A)]);
  const incident = await as(CLINICIAN_A, SUBMIT, [A, JSON.stringify({
    patient_id: 'patient-a1', incident_type: 'fall', incident_date: '2026-09-18',
    report: 'Found on the bedroom floor.', severity: 'high', immediate_alert: true,
  })]);
  assert.equal(incident.notified, 1);
  const answer = await list(ADMIN_A);
  assert.equal(answer.notifications.length, 1, 'the alert is visible to its recipient');
  const alert = answer.notifications[0];
  assert.equal(alert.type, 'critical_alert');
  assert.equal(alert.priority, 'critical');
  assert.match(alert.title, /^Urgent incident: fall$/);
  assert.equal(alert.action_url, '/Incidents');
  // The reporter is not a recipient, and sees nothing.
  assert.equal((await list(CLINICIAN_A)).notifications.length, 0);
  assert.equal((await list(CLINICIAN_EMPTY)).notifications.length, 0);
  // And the administrator can act on it through this contract.
  const moved = await move(ADMIN_A, alert.id, alert.version, 'dismiss');
  assert.equal(moved.idempotent, false);
  assert.equal((await list(ADMIN_A)).notifications.length, 0);
});
