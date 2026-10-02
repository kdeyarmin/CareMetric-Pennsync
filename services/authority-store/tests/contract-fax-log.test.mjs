import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import {
  applyRecordMigrations, assertNewestRecordMigration, recordMigrationNames,
} from './record-migrations.mjs';

/**
 * The fax transmission log: two reads and no write.
 *
 * Three properties carry this suite. The ownership predicate is `sent_by`, so
 * a colleague in the same agency gets nothing although every `fax_log` policy
 * admits them. D24's chart narrowing applies ON TOP, so a row naming a chart
 * the caller does not open is invisible even to the person who sent it — which
 * is the one place here where the policy is stricter than the entity's own
 * rule, and it is asserted rather than assumed. And `ocr_text` never leaves
 * the store whole: the listing read does not project it at all, and the search
 * read returns the 300-character excerpt the screen already renders.
 *
 * THIS SUITE HOLDS THE RECORD-MIGRATION ORDERING GUARD, over
 * `20260920890000_contract_fax_log.sql`, because that is the newest file in the
 * record directory. It took the guard from `record-store-catchup.test.mjs` by
 * OVERTAKING the schema-only wave at 840000 in the same change, which is the
 * handover `assertNewestRecordMigration`'s own error text describes. When some
 * later migration overtakes this one, the guard moves there and the call here
 * is retired — not widened, because a guard that admits exceptions stops
 * asserting the thing it is for.
 */
const APP = '6a9881683dc68a0bd54f1ef7';
const A = 'agency-a'; const B = 'agency-b';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SENDER = 2; const COLLEAGUE = 1; const OUTSIDER = 4;
const LIST = 'select "public"."pennsync_contract_fax_log_list"($1,$2,$3) as result';
const SEARCH = 'select "public"."pennsync_contract_fax_log_search"($1,$2,$3) as result';
const NEWEST = '20260920890000_contract_fax_log.sql';
// Long enough that the excerpt is a cut rather than the whole thing.
const ORDERS = `${'Wound care orders for the follow up visit. '.repeat(20)}END MARKER`;
let db;

before(async () => {
  // The guard belongs to whichever suite owns the newest record migration.
  assertNewestRecordMigration(await recordMigrationNames(), NEWEST);
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
  // `patient-a1` is chart-assigned to membership-2 (the sender) by the
  // fixtures; `patient-a2` is not assigned to anybody.
  for (const [id, patient] of [['patient-a1', 'Ann'], ['patient-a2', 'Beth']]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","first_name") values ($1,$2,$3,$4)`,
    [APP, id, A, patient]);
  }
  const rows = [
    // The sender's own, naming no chart.
    ['fl-mine', A, 'clinician-a@example.invalid', null, 'Dr Reed', ORDERS],
    // The sender's own, on a chart they DO open.
    ['fl-chart-open', A, 'clinician-a@example.invalid', 'patient-a1', 'Dr Chen', ORDERS],
    // The sender's own, on a chart they do NOT open. D24 hides it.
    ['fl-chart-closed', A, 'clinician-a@example.invalid', 'patient-a2', 'Dr Gray', ORDERS],
    // A colleague's, in the same agency. The policies admit it; `sent_by` does not.
    ['fl-colleague', A, 'admin-a@example.invalid', null, 'Dr Novak', 'colleague document'],
    // Another agency's.
    ['fl-other-agency', B, 'admin-b@example.invalid', null, 'Dr Blum', 'other agency document'],
  ];
  for (const [id, agency, sentBy, patient, toName, text] of rows) {
    await db.query(`insert into ${SCHEMA}."fax_log"
      ("source_app_id","id","agency_id","from_number","to_number","to_name","status",
       "sent_by","patient_id","ocr_text","ocr_processed","pages","document_url",
       "provider_submission_attempt_id","integration_secret_id")
      values ($1,$2,$3,'+12155550100','+14125550100',$4,'sent',$5,$6,$7,true,2,
        'https://base44.app/storage/legacy.pdf','attempt-1','secret-1')`,
    [APP, id, agency, toName, sentBy, patient, text]);
  }
});
after(async () => db?.close());

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
const refuses = (promise, code) => assert.rejects(promise, error => {
  assert.match(error.message, new RegExp(code));
  return true;
});
const ids = answer => answer.entries.map(row => row.id).sort();

test('a fax belongs to the person who sent it, and the chart narrows further', async () => {
  // `fl-chart-closed` is the sender's OWN row and is still absent, because
  // `fax_log_read` carries D24's narrowing and `patient-a2` is assigned to
  // nobody. That is the one place the policy is stricter than the entity rule.
  assert.deepEqual(await ids(await as(SENDER, LIST, [A, null, 100])),
    ['fl-chart-open', 'fl-mine']);
  // The colleague's row is admitted by every policy and refused by `sent_by`.
  assert.deepEqual(await ids(await as(COLLEAGUE, LIST, [A, null, 100])), ['fl-colleague']);
  await refuses(as(OUTSIDER, LIST, [A, null, 100]), 'PENNSYNC_FAX_LOG_FORBIDDEN');
});

test('a chart filter serves the history screen\'s other shape', async () => {
  // `FaxLog.filter({ patient_id }, …)` when the screen is opened on a chart.
  assert.deepEqual(await ids(await as(SENDER, LIST, [A, 'patient-a1', 100])),
    ['fl-chart-open']);
  // A chart the caller does not open answers with no rows rather than a
  // refusal, which is the same answer the original gives.
  assert.deepEqual((await as(SENDER, LIST, [A, 'patient-a2', 100])).entries, []);
  assert.deepEqual((await as(SENDER, LIST, [A, 'no-such-chart', 100])).entries, []);
});

test('the listing read projects no extracted text, and no storage locator', async () => {
  // D64: every column reaching a read is named. `ocr_text` is the extracted
  // content of a faxed clinical document, and `document_url` is the expiring
  // delivery capability the entity's own description says new sends stopped
  // persisting.
  const answer = await as(SENDER, LIST, [A, null, 100]);
  const body = JSON.stringify(answer);
  assert.equal(body.includes('ocr_text'), false);
  assert.equal(body.includes('END MARKER'), false);
  assert.equal(body.includes('document_url'), false);
  assert.equal(body.includes('base44.app'), false);
  // Nor the transmission workflow's machinery: a provider identity in a
  // browser payload is a disclosure with no caller.
  for (const field of ['provider_submission_attempt_id', 'integration_secret_id',
    'sender_telecom_binding_id', 'retry_claimed_by']) {
    assert.equal(Object.hasOwn(answer.entries[0], field), false, field);
  }
  // What IS projected is what the four screens render.
  assert.deepEqual(Object.keys(answer.entries[0]).sort(), [
    'created_date', 'document_name', 'estimated_cost', 'failure_reason', 'from_number',
    'id', 'next_retry_at', 'ocr_processed', 'pages', 'patient_id', 'priority',
    'provider_terminal_status', 'referral_id', 'retry_count', 'sent_by', 'status',
    'to_name', 'to_number', 'updated_date',
  ]);
});

test('the content search matches in SQL and returns a bounded excerpt', async () => {
  const found = await as(SENDER, SEARCH, [A, 'wound', 50]);
  assert.deepEqual(await ids(found), ['fl-chart-open', 'fl-mine']);
  const [row] = found.entries;
  // 300 characters, which is exactly `log.ocr_text.substring(0, 300)` — the
  // screen's own cut. From the START and not a window around the match, or the
  // port would disclose more of the document than the screen does today.
  assert.equal(row.ocr_excerpt.length, 300);
  assert.equal(row.ocr_truncated, true);
  assert.equal(row.ocr_excerpt, ORDERS.slice(0, 300));
  assert.equal(JSON.stringify(found).includes('END MARKER'), false);
  // The count is over the whole matching corpus while the rows are bounded, so
  // a caller is told there is more rather than shown it.
  const one = await as(SENDER, SEARCH, [A, 'wound', 1]);
  assert.equal(one.entries.length, 1);
  assert.equal(one.matched, 2);
  // Case-insensitive substring, because that is what the original does.
  assert.equal((await as(SENDER, SEARCH, [A, 'WOUND CARE', 50])).matched, 2);
  // The search obeys the same two predicates as the listing read.
  assert.deepEqual(await ids(await as(COLLEAGUE, SEARCH, [A, 'colleague', 50])),
    ['fl-colleague']);
  assert.equal((await as(SENDER, SEARCH, [A, 'colleague', 50])).matched, 0);
  assert.equal((await as(SENDER, SEARCH, [A, 'Gray', 50])).matched, 0,
    'the closed chart is out of the corpus too');
});

test('a query too short to narrow anything is refused', async () => {
  // A one-character query matches nearly every document, which turns the
  // search into "give me an excerpt of every fax I ever sent".
  await refuses(as(SENDER, SEARCH, [A, 'w', 50]), 'PENNSYNC_FAX_LOG_QUERY_TOO_SHORT');
  await refuses(as(SENDER, SEARCH, [A, ' ', 50]), 'PENNSYNC_FAX_LOG_QUERY_TOO_SHORT');
  await refuses(as(SENDER, SEARCH, [A, null, 50]), 'PENNSYNC_FAX_LOG_QUERY_TOO_SHORT');
  await refuses(as(OUTSIDER, SEARCH, [A, 'wound', 50]), 'PENNSYNC_FAX_LOG_FORBIDDEN');
});

test('NOTHING here writes a fax log, because the entity refuses every write', async () => {
  // Its own rls is `"create": false, "update": false, "delete": false`, so a
  // send belongs to the transmission workflow and that capability is paused.
  // Asserted as an absence, D39's way, so adding one is a visible decision.
  const dir = new URL('../supabase/record-migrations/', import.meta.url);
  const writes = [];
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, dir), 'utf8');
    const body = sql.replace(/^\s*--.*$/gm, '');
    if (/(insert into|update|delete from)\s+"pennsync_records"\."fax_log"/i.test(body)) {
      writes.push(name);
    }
  }
  assert.deepEqual(writes, []);
});
