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
 * Credential expiry warnings — `sendExpirationNotifications`' credential half.
 *
 * The last of D49's four scheduler capabilities and the second with nothing
 * paused, because its reminder is a row rather than an email (D51).
 *
 * Two of its properties are the ones worth breaking a build over, and both are
 * somebody else's finding arriving here. D50: the three credential-reminder
 * crons must not share a marker column, and this is the capability its
 * renewal sibling names in its own comment as the one that consumed tier 30.
 * D45: a capability that writes a row another capability reads is not proved
 * by either suite alone, so the warnings are read back through the reader.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const DIR = 'services/authority-store/supabase/record-migrations/';
// `caller_membership` arrives with the note-history contract (D34) and
// `agency_today` plus `credential_due_offsets` with the credential sweep (D50);
// both this contract and the mint refuse to apply without their dependencies,
// by name in their own preambles rather than on first use.
const CARRIED = [
  `${DIR}20260920170000_contract_note_history.sql`,
  `${DIR}20260920285000_notification_mint.sql`,
  `${DIR}20260920300000_contract_notification.sql`,
  `${DIR}20260920340000_contract_credential_sweep.sql`,
  `${DIR}20260920550000_contract_expiration_notices.sql`,
];
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const SWEEP = 'select "public"."pennsync_contract_expiration_notice_sweep"($1) as result';
const EXPIRY_SWEEP = 'select "public"."pennsync_contract_credential_expiration_sweep"($1) as result';
const RENEWAL_SWEEP = 'select "public"."pennsync_contract_credential_renewal_sweep"($1) as result';
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
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ...CARRIED]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
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

// The dates are built from `agency_today()` rather than from the test runner's
// clock, because that is the expression the contract compares against.
const seed = async (id, days, overrides = {}) => {
  const row = {
    agency_id: A, user_id: email(CLINICIAN_A), user_name: 'Ada Lovelace',
    title: 'RN License', item_type: 'license', status: 'approved',
    reminder_offsets_sent: null, renewal_email_offsets_sent: null,
    expiration_note_offsets_sent: null, ...overrides,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into ${SCHEMA}."personnel_credential" ("source_app_id","id",
      "expiration_date",${keys.map(k => `"${k}"`).join(',')})
     values ($1,$2,(${SCHEMA}.agency_today() + $3::integer),
       ${keys.map((_, i) => `$${i + 4}`).join(',')})`,
    [APP, id, days, ...keys.map(k => row[k])]);
};
const clear = async () => {
  await db.query(`delete from ${SCHEMA}."personnel_credential"`);
  await db.query(`delete from ${SCHEMA}."notification"`);
};
const marker = async id => (await db.query(
  `select "expiration_note_offsets_sent" as m from ${SCHEMA}."personnel_credential"
   where "id" = $1`, [id])).rows[0].m;

test('only an agency_admin of that agency may sweep', async () => {
  // D40's gate. The original admits the built-in `role === 'admin'` that D14
  // and D22 removed, or a shared secret over every tenant that has no
  // successor here — so this is the per-agency half D49 says to take.
  await refusal(sweep(CLINICIAN_A), 'PENNSYNC_EXPIRATION_FORBIDDEN');
  await refusal(sweep(ADMIN_B, A), 'PENNSYNC_EXPIRATION_FORBIDDEN');
  await refusal(sweep(ADMIN_A, B), 'PENNSYNC_EXPIRATION_FORBIDDEN');
  assert.equal((await sweep(ADMIN_A)).success, true);
});

test('a tier fires at or below its offset, and 31 days out fires nothing', async () => {
  await clear();
  for (const days of [40, 31, 30, 20, 14, 8, 7, 3, 0]) await seed(`d${days}`, days);
  const result = await sweep(ADMIN_A);
  assert.deepEqual(result.notifications.map(n => n.days_until_expiration),
    [0, 3, 7, 8, 14, 20, 30], 'soonest first, and nothing past 30');
  assert.equal(result.employee_notifications, 7);
  // At or below, never an exact-day match: eight days out crosses 30 and 14.
  assert.deepEqual(await marker('d8'), [30, 14]);
  assert.deepEqual(await marker('d0'), [30, 14, 7, 3]);
  assert.equal(await marker('d31'), null, 'untouched');
});

test('an already-expired credential is not warned about', async () => {
  // `credential_due_offsets` requires the count to be at or above zero. The
  // status flip for what is already past belongs to `credential_sweep`, which
  // is a different capability with a different marker.
  await clear();
  await seed('past', -1);
  await seed('today', 0);
  assert.deepEqual((await sweep(ADMIN_A)).notifications.map(n => n.credential_id),
    ['today']);
});

test('a tier is consumed once, and only the unsent ones fire', async () => {
  await clear();
  await seed('partly', 5, { expiration_note_offsets_sent: [30, 14] });
  const first = await sweep(ADMIN_A);
  assert.deepEqual(first.notifications[0].claimed_offsets, [7]);
  assert.deepEqual(await marker('partly'), [30, 14, 7]);
  const second = await sweep(ADMIN_A);
  assert.equal(second.employee_notifications, 0, 'nothing left to claim');
  assert.equal(second.admin_summaries_sent, 0, 'and so no summary');
});

test('THE marker is this capability s alone, in both directions', async () => {
  // D50's whole finding, and the reason `credential_sweep` takes the column as
  // a parameter: the three crons once shared `reminder_offsets_sent`, so
  // whichever fired a shared tier first consumed it for the others — and the
  // renewal original names THIS capability as the one that did it.
  await clear();
  await seed('shared', 5, {
    reminder_offsets_sent: [90, 60, 30, 14], renewal_email_offsets_sent: [90, 60, 30, 14, 7],
  });
  assert.equal((await sweep(ADMIN_A)).employee_notifications, 1,
    'the siblings marker sets do not suppress this one');
  assert.deepEqual(await marker('shared'), [30, 14, 7]);
  // And this one's claim does not suppress theirs. Their tiers include 90 and
  // 60, which this capability has not got, so they still have work.
  await clear();
  await seed('mine', 5);
  await sweep(ADMIN_A);
  assert.deepEqual(await marker('mine'), [30, 14, 7]);
  const expiry = await as(ADMIN_A, EXPIRY_SWEEP, [A]);
  const renewal = await as(ADMIN_A, RENEWAL_SWEEP, [A]);
  assert.equal(expiry.reminders_due, 1, 'sendPersonnelExpirationNotifications is unaffected');
  assert.equal(renewal.reminders_due, 1, 'sendCredentialRenewalReminders is unaffected');
  // Neither of those claims anything — their send is paused — so the column
  // this one wrote is still exactly what it wrote.
  assert.deepEqual(await marker('mine'), [30, 14, 7]);
});

test('the wording, type and urgency are the original s', async () => {
  await clear();
  await seed('urgent', 5, { title: 'BLS Certification' });
  await seed('soon', 20, { title: 'Auto Insurance' });
  await sweep(ADMIN_A);
  const seen = (await list(CLINICIAN_A)).notifications;
  const urgent = seen.find(n => n.title.includes('BLS'));
  assert.equal(urgent.title, 'Credential Expiring Soon: BLS Certification');
  assert.equal(urgent.message,
    'Your BLS Certification expires in 5 days. Please upload a renewed document.');
  assert.equal(urgent.type, 'credential_expiration');
  assert.equal(urgent.action_url, '/PersonnelFile');
  assert.equal(urgent.priority, 'high', 'seven days or fewer is high');
  assert.equal(seen.find(n => n.title.includes('Auto')).priority, 'medium');
});

test('a credential that is not approved, or another agency s, is skipped', async () => {
  await clear();
  await seed('approved', 3);
  await seed('pending', 3, { status: 'pending_approval' });
  await seed('rejected', 3, { status: 'rejected' });
  await seed('expired-status', 3, { status: 'expired' });
  await seed('theirs', 3, { agency_id: B, user_id: email(ADMIN_B) });
  const result = await sweep(ADMIN_A);
  assert.deepEqual(result.notifications.map(n => n.credential_id), ['approved']);
  // The other agency's is swept by the other agency's administrator.
  assert.deepEqual((await sweep(ADMIN_B, B)).notifications.map(n => n.credential_id),
    ['theirs']);
});

test('a credential whose holder has left is reported rather than dropped', async () => {
  // Divergence 4. The original addresses whatever string `user_id` holds, so a
  // departed nurse's warning is minted for an identity that does not exist.
  await clear();
  await seed('orphan', 3, { user_id: 'departed@example.invalid' });
  await seed('mine', 3);
  const result = await sweep(ADMIN_A);
  assert.equal(result.employee_notifications, 1);
  assert.equal(result.unreachable_count, 1);
  assert.equal(result.unreachable[0].credential_id, 'orphan');
  assert.equal(result.unreachable[0].user_id, 'departed@example.invalid');
  // Nothing was written for it, and its tiers were NOT consumed — so the
  // warning is still owed if the nurse comes back.
  assert.equal(await marker('orphan'), null);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."notification"
     where "type" = 'credential_expiration'`)).rows[0].n, 1);
  // And the orphan ALONE, which is the plpgsql trap D38 records: a `record`
  // variable read before anything has assigned it raises `record "x" is not
  // assigned yet`. Above, `mine` sorts first and assigns it, so that path is
  // never the first thing the loop does. Here it is.
  await clear();
  await seed('orphan-only', 3, { user_id: 'departed@example.invalid' });
  const alone = await sweep(ADMIN_A);
  assert.equal(alone.employee_notifications, 0);
  assert.equal(alone.unreachable_count, 1);
  assert.equal(alone.admin_summaries_sent, 0, 'and nothing to summarise');
});

test('the administrators summary counts, links and names nobody', async () => {
  // Divergence 7. The original's `metadata: { expirations: scoped }` carries
  // every colleague's name, their credential's title and its date, and
  // `notification_read` is agency-WIDE — D44's rule, about personnel here
  // rather than a patient. Nothing in the SPA reads that blob.
  await clear();
  await seed('one', 3, { user_name: 'Ada Lovelace', title: 'RN License' });
  await seed('two', 5, { user_name: 'Grace Hopper', title: 'CPR Card',
    user_id: email(3) });
  const result = await sweep(ADMIN_A);
  assert.equal(result.employee_notifications, 2);
  assert.equal(result.admin_summaries_sent, 1, 'one administrator on this roster');
  const summary = (await list(ADMIN_A)).notifications
    .find(n => n.type === 'admin_expiration_summary');
  assert.equal(summary.title, '2 Upcoming Expirations');
  assert.equal(summary.message, 'There are 2 credentials expiring soon.',
    'and not "training certifications or credentials", which this half no longer reaches');
  assert.equal(summary.action_url, '/AdminOperations');
  assert.ok(!summary.message.includes('Ada') && !summary.title.includes('Ada'));
  // The STORED row, not the reader's projection. A first draft read
  // `summary.metadata` and proved nothing, because `projectNotification` says
  // in its own comment that it returns no `metadata` — so putting every
  // colleague's name back in the blob passed this test. That is the worse
  // half of the disclosure rather than a reason to allow it: the detail would
  // sit in an agency-wide table with nothing reading it, which is a surface
  // with no consumer, and D45's defect was exactly a writer and a reader
  // disagreeing about that column.
  const { rows } = await db.query(
    `select "metadata" from ${SCHEMA}."notification"
     where "type" = 'admin_expiration_summary'`);
  assert.equal(rows.length, 1);
  const blob = JSON.stringify(rows[0].metadata ?? {});
  assert.equal(blob, JSON.stringify({ expiration_count: 2 }));
  for (const leak of ['Ada', 'Grace', 'RN License', 'CPR Card', email(CLINICIAN_A)]) {
    assert.ok(!blob.includes(leak), `summary metadata names ${leak}`);
  }
});

test('an administrator gets one summary a day, and the rest are counted', async () => {
  // Divergence 8. The original mints one on every invocation; with the
  // unattended run still an open decision the caller is a person pressing a
  // button, and a second press should not notify their colleagues twice.
  await clear();
  await seed('first', 3);
  assert.equal((await sweep(ADMIN_A)).admin_summaries_sent, 1);
  await seed('second', 5, { user_id: email(3) });
  const again = await sweep(ADMIN_A);
  assert.equal(again.employee_notifications, 1, 'the new credential is warned about');
  assert.equal(again.admin_summaries_sent, 0);
  assert.equal(again.admin_summaries_suppressed, 1, 'counted, not hidden');
});

test('the training half is declared, not reported as zero', async () => {
  // D84's `uncarried_legs` entry settles that leg by name, so the answer says
  // where it went. A zero here would read as "no training expired".
  await clear();
  const result = await sweep(ADMIN_A);
  assert.equal(result.training_expirations, 'served_by_hub');
  assert.equal(result.code, 'PENNSYNC_EXPIRATION_TRAINING_LEG_ON_HUB');
  const manifest = JSON.parse(readFileSync(
    resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  const leg = manifest.uncarried_legs?.sendExpirationNotifications;
  assert.ok(leg, 'the leg is settled in the manifest, not only in a comment');
  assert.deepEqual(leg.entities, ['TrainingAssignment']);
  assert.equal(manifest.entities.TrainingAssignment, 'hub');
});

test('the warning is minted with the envelope its reader filters on', async () => {
  // D45: a capability that writes a row another capability reads is not proved
  // by either suite alone. The ADR port is the evidence — its original stamps
  // none of the six authority columns, so in Base44 today that reminder is
  // shown to nobody.
  await clear();
  await seed('envelope', 3);
  const result = await sweep(ADMIN_A);
  const seen = (await list(CLINICIAN_A)).notifications
    .filter(n => n.type === 'credential_expiration');
  assert.equal(seen.length, 1, 'the holder sees their own warning');
  assert.equal(seen[0].id, result.notifications[0].notification_id);
  // And nobody else's reader shows it: the recipient predicate is the
  // contract's own, because `notification_read` is agency-wide (D45).
  assert.equal((await list(ADMIN_A)).notifications
    .filter(n => n.type === 'credential_expiration').length, 0);
});

test('a unique violation that is NOT the one it names still raises', async () => {
  // Both catches swallow `notification_dedupe_key_unique` by name. Swallowing
  // every `unique_violation` passes every other test in this file, so each
  // table gets a second unique index for the length of one case and the
  // contract has to let it out.
  //
  // The two cases need different setups and the reason is the contract's
  // shape. Two credentials mean two warnings, so the second collides with a
  // sabotage index over that type. Only ONE administrator is on this roster,
  // so one sweep mints one summary and collides with nothing — the rival row
  // has to be there already, and it carries a dedupe key of its own so the
  // index that fires is the sabotage one rather than the dedupe key the
  // contract is allowed to swallow.
  for (const [index, type, rival] of [
    ['sabotage_warning_unique', 'credential_expiration', false],
    ['sabotage_summary_unique', 'admin_expiration_summary', true],
  ]) {
    await clear();
    await seed('one', 3);
    await seed('two', 5, { user_id: email(3) });
    if (rival) {
      await db.query(`insert into ${SCHEMA}."notification"
        ("source_app_id","id","agency_id","dedupe_key","type","title")
        values ($1,'rival',$2,'rival-key',$3,'Already here')`, [APP, A, type]);
    }
    await db.exec(`create unique index "${index}" on ${SCHEMA}."notification"
      ("source_app_id","type") where "type" = '${type}'`);
    try {
      await refusal(sweep(ADMIN_A), index);
    } finally {
      await db.exec(`drop index ${SCHEMA}."${index}"`);
    }
  }
  // And with neither in place the same sweep succeeds, so the refusals above
  // are the indexes' and not something else about the fixture.
  await clear();
  await seed('one', 3);
  await seed('two', 5, { user_id: email(3) });
  assert.equal((await sweep(ADMIN_A)).employee_notifications, 2);
});
