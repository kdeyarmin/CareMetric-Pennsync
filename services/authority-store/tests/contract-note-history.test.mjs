import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';

/**
 * The clinical note history (`contract_note_history` / `contract_note_append`).
 *
 * The property this file exists for is the one that would be silently wrong:
 * **the derived keys must equal the Base44 originals' byte for byte.**
 * `logical_note_key` groups every revision of one note and the read shows only
 * the latest member of each group, so a key that disagreed with a carried
 * row's would split one note's history in two and surface an older revision
 * beside the newer one as if both were current. The expectations below are
 * computed in JavaScript, the way the originals compute them, rather than read
 * back from the database — a test that asked the contract for its own answer
 * would agree with itself.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const NOTES = 'services/authority-store/supabase/record-migrations/20260920170000_contract_note_history.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = n => `7aac00000000${String(n).padStart(12, '0')}`;
const vid = n => `9bbd00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const APPEND = 'select "public"."pennsync_contract_note_append"($1,$2,$3,$4,$5) as result';
const HISTORY = 'select "public"."pennsync_contract_note_history"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
const MINE = pid(1); const THEIRS = pid(2);
/** The originals' own derivations, in the language they are written in. */
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const noteKey = parts => sha(JSON.stringify(parts));
const fingerprint = ({ mode, visit_date: date, visit_type: type, note, compliance_score: score }) =>
  sha(JSON.stringify({
    clinical_notes: note,
    compliance_score: score ?? null,
    mode,
    note,
    visit_date: date,
    visit_type: type,
  }));
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, NOTES]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  for (const [id, status] of [[MINE, 'active'], [THEIRS, 'active']]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","status","is_sample","is_archived","first_name","last_name")
      values ($1,$2,$3,$4,false,false,'Ada','Lovelace')`, [APP, id, A, status]);
  }
  await db.query(`insert into pennsync_private.chart_assignment
    (app_id,agency_id,patient_id,membership_id,status,changed_by)
    values ($1,$2,$3,'membership-2','active',$4)`, [APP, A, MINE, uid(1)]);
});
after(async () => db?.close());

let nextVisit = 0;
async function seedVisit({ patient = MINE, status = 'completed', notes = 'First revision.',
  score = null, date = '2026-10-01', type = 'routine_visit', updated = '2026-09-01 00:00:00+00' } = {}) {
  nextVisit += 1;
  const id = vid(nextVisit);
  await db.query(`insert into ${SCHEMA}."visit"
    ("source_app_id","id","agency_id","patient_id","status","visit_date","visit_type",
     "nurse_notes","compliance_score","updated_date","is_sample")
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
  [APP, id, A, patient, status, date, type, notes, score, updated]);
  return id;
}
async function call(n, sql, params, commit = true) {
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
const append = (n, patient, entry, { mode = 'append', clinical = null, agency = A } = {}) =>
  call(n, APPEND, [agency, patient, mode, JSON.stringify(entry), clinical]);
const history = (n, patient, { limit = null, offset = null, agency = A } = {}) =>
  call(n, HISTORY, [agency, patient, limit, offset], false);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const stored = async key => (await db.query(
  `select * from ${SCHEMA}."patient_note_history_entry" where "event_key" = $1`, [key])).rows[0];

test('the derived keys are the originals\' byte for byte', async () => {
  const note = 'Patient stable. BP 120/80. café — 🩺';
  const visit = await seedVisit({ notes: note, score: 93.5 });
  const answer = await append(CLINICIAN_A, MINE,
    { visit_id: visit, note, compliance_score: 93.5, entry_id: 'queue-1' });
  assert.equal(answer.created, true);
  const expectedFingerprint = fingerprint({
    mode: 'append', visit_date: '2026-10-01', visit_type: 'routine_visit',
    note, compliance_score: 93.5,
  });
  const row = await stored(noteKey([A, MINE, visit, 'queue-1']));
  assert.ok(row, 'the event key is the one the original would derive');
  assert.equal(row.logical_note_key, noteKey([A, MINE, visit]));
  assert.equal(row.payload_fingerprint, expectedFingerprint);
  // Without a client entry id the event key is scoped by the payload instead,
  // which is the original's `idempotencyScope`.
  const other = await seedVisit({ notes: 'Second note.' });
  await append(CLINICIAN_A, MINE, { visit_id: other, note: 'Second note.' });
  const scope = fingerprint({ mode: 'append', visit_date: '2026-10-01',
    visit_type: 'routine_visit', note: 'Second note.', compliance_score: null });
  assert.ok(await stored(noteKey([A, MINE, other, scope])));
});

test('the event carries this store\'s membership, not Base44\'s', async () => {
  const visit = await seedVisit({ notes: 'Provenance.' });
  await append(CLINICIAN_A, MINE, { visit_id: visit, note: 'Provenance.', entry_id: 'prov-1' });
  const row = await stored(noteKey([A, MINE, visit, 'prov-1']));
  // `pennsync_private.membership` is the authority now, so the provenance an
  // event carries is something that can actually be checked.
  assert.equal(row.membership_id, 'membership-2');
  assert.equal(row.membership_version, 1);
  assert.match(row.actor_email_normalized, /@/);
  assert.equal(row.agency_id, A);
  assert.equal(row.visit_revision_at.toISOString?.().slice(0, 10) ?? String(row.visit_revision_at),
    '2026-09-01');
});

test('a replay answers the event it already wrote, and a changed one conflicts', async () => {
  const note = 'Replayed note.';
  const visit = await seedVisit({ notes: note });
  const first = await append(CLINICIAN_A, MINE, { visit_id: visit, note, entry_id: 'queue-r' });
  const again = await append(CLINICIAN_A, MINE, { visit_id: visit, note, entry_id: 'queue-r' });
  assert.equal(again.created, false);
  assert.equal(again.duplicate_count, 1);
  assert.deepEqual(again.event, first.event);
  // The same queue id with different text is a different note, and answering
  // the first would discard this one.
  await db.query(`update ${SCHEMA}."visit" set "nurse_notes" = 'Edited text.' where "id" = $1`,
    [visit]);
  await refusal(append(CLINICIAN_A, MINE,
    { visit_id: visit, note: 'Edited text.', entry_id: 'queue-r' }), 'PENNSYNC_NOTE_EVENT_CONFLICT');
  // With no queue id the payload is the scope, so the same text replays and
  // different text appends.
  const plain = await seedVisit({ notes: 'Plain note.' });
  assert.equal((await append(CLINICIAN_A, MINE, { visit_id: plain, note: 'Plain note.' })).created,
    true);
  assert.equal((await append(CLINICIAN_A, MINE, { visit_id: plain, note: 'Plain note.' })).created,
    false);
});

test('the read shows the latest revision of each note and nothing older', async () => {
  const visit = await seedVisit({ notes: 'Revision one.' });
  await append(CLINICIAN_A, MINE, { visit_id: visit, note: 'Revision one.', entry_id: 'rev-1' });
  // A later revision of the SAME visit: the note moves on and the Visit's
  // revision stamp moves with it.
  await db.query(`update ${SCHEMA}."visit"
    set "nurse_notes" = 'Revision two.', "updated_date" = '2026-09-05 00:00:00+00'
    where "id" = $1`, [visit]);
  await append(CLINICIAN_A, MINE, { visit_id: visit, note: 'Revision two.',
    entry_id: 'rev-2' }, { mode: 'update' });
  const both = await db.query(
    `select count(*)::int as n from ${SCHEMA}."patient_note_history_entry" where "visit_id" = $1`,
    [visit]);
  assert.equal(both.rows[0].n, 2, 'both events are kept — the log is append-only');
  const seen = await history(CLINICIAN_A, MINE);
  const forVisit = seen.entries.filter(entry => entry.visit_id === visit);
  assert.equal(forVisit.length, 1, 'one row per logical note');
  assert.equal(forVisit[0].note, 'Revision two.');
  assert.equal(forVisit[0].entry_id, 'rev-2');
  assert.equal(seen.patient_id, MINE);
  assert.equal(seen.latest_clinical_notes, seen.entries.at(-1).note);
});

test('the page is bounded and reports where it got to', async () => {
  const seen = await history(ADMIN_A, MINE, { limit: 2 });
  assert.equal(seen.page.offset, 0);
  assert.equal(seen.page.event_count, 2);
  assert.equal(seen.page.next_offset, 2);
  assert.equal(seen.page.has_more, true);
  const next = await history(ADMIN_A, MINE, { limit: 2, offset: 2 });
  assert.equal(next.page.offset, 2);
  assert.equal(next.page.next_offset, 2 + next.page.event_count);
  for (const [options, code] of [
    [{ limit: 0 }, 'PENNSYNC_NOTE_LIMIT_INVALID'],
    [{ limit: 501 }, 'PENNSYNC_NOTE_LIMIT_INVALID'],
    [{ offset: -1 }, 'PENNSYNC_NOTE_OFFSET_INVALID'],
    [{ offset: 1000001 }, 'PENNSYNC_NOTE_OFFSET_INVALID'],
  ]) await refusal(history(ADMIN_A, MINE, options), code);
  // An empty history is an empty page rather than an error.
  const empty = await history(ADMIN_A, THEIRS);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.latest_clinical_notes, '');
});

test('the chart decides, and office staff authors nothing', async () => {
  const visit = await seedVisit({ notes: 'Gated.' });
  // `NOTE_AUTHOR_ROLES` and `NOTE_READER_ROLES` both exclude office staff, and
  // D24 gives it no chart either, so the gate and the policies agree.
  await refusal(append(OFFICE_A, MINE, { visit_id: visit, note: 'Gated.' }),
    'PENNSYNC_NOTE_FORBIDDEN');
  await refusal(history(OFFICE_A, MINE), 'PENNSYNC_NOTE_FORBIDDEN');
  // A chart the clinician is not assigned is absent, not forbidden.
  const theirs = await seedVisit({ patient: THEIRS, notes: 'Elsewhere.' });
  await refusal(append(CLINICIAN_A, THEIRS, { visit_id: theirs, note: 'Elsewhere.' }),
    'PENNSYNC_NOTE_PATIENT_NOT_VISIBLE');
  assert.deepEqual((await history(CLINICIAN_A, THEIRS)).entries, []);
  // An agency admin opens every chart in the agency and none outside it.
  assert.equal((await append(ADMIN_A, THEIRS, { visit_id: theirs, note: 'Elsewhere.' })).created,
    true);
  await refusal(append(ADMIN_B, MINE, { visit_id: visit, note: 'Gated.' }),
    'PENNSYNC_NOTE_AGENCY_NOT_HELD');
  await refusal(history(ADMIN_A, MINE, { agency: B }), 'PENNSYNC_NOTE_AGENCY_NOT_HELD');
});

test('a note belongs to a documented visit and says what the visit says', async () => {
  const scheduled = await seedVisit({ status: 'scheduled', notes: 'Too early.' });
  await refusal(append(CLINICIAN_A, MINE, { visit_id: scheduled, note: 'Too early.' }),
    'PENNSYNC_NOTE_VISIT_UNAVAILABLE');
  const visit = await seedVisit({ notes: 'The stored text.' });
  // A note that does not match the Visit would be a second, divergent record
  // of the same encounter.
  await refusal(append(CLINICIAN_A, MINE, { visit_id: visit, note: 'Something else.' }),
    'PENNSYNC_NOTE_CONTENT_MISMATCH');
  await refusal(append(CLINICIAN_A, MINE,
    { visit_id: visit, note: 'The stored text.', compliance_score: 50 }),
  'PENNSYNC_NOTE_CONTENT_MISMATCH');
  // A caller may restate the Visit's metadata and must restate it correctly.
  await refusal(append(CLINICIAN_A, MINE,
    { visit_id: visit, note: 'The stored text.', date: '2026-01-01' }),
  'PENNSYNC_NOTE_VISIT_METADATA_MISMATCH');
  await refusal(append(CLINICIAN_A, MINE,
    { visit_id: visit, note: 'The stored text.', visit_type: 'admission' }),
  'PENNSYNC_NOTE_VISIT_METADATA_MISMATCH');
  assert.equal((await append(CLINICIAN_A, MINE, { visit_id: visit, note: 'The stored text.',
    date: '2026-10-01', visit_type: 'routine_visit' })).created, true);
  // A visit belonging to another chart is not this chart's to document.
  const elsewhere = await seedVisit({ patient: THEIRS, notes: 'Not mine.' });
  await refusal(append(ADMIN_A, MINE, { visit_id: elsewhere, note: 'Not mine.' }),
    'PENNSYNC_NOTE_VISIT_NOT_VISIBLE');
});

test('a malformed append never reaches the table', async () => {
  const visit = await seedVisit({ notes: 'Shape.' });
  const before = (await db.query(
    `select count(*)::int as n from ${SCHEMA}."patient_note_history_entry"`)).rows[0].n;
  for (const [entry, options, code] of [
    [{ visit_id: visit, note: 'Shape.', unexpected: 1 }, {}, 'PENNSYNC_NOTE_FIELD_UNSUPPORTED'],
    [{ note: 'Shape.' }, {}, 'PENNSYNC_NOTE_VISIT_INVALID'],
    [{ visit_id: 'has spaces', note: 'Shape.' }, {}, 'PENNSYNC_NOTE_VISIT_INVALID'],
    [{ visit_id: visit, note: '   ' }, {}, 'PENNSYNC_NOTE_TEXT_INVALID'],
    [{ visit_id: visit, note: 42 }, {}, 'PENNSYNC_NOTE_TEXT_INVALID'],
    [{ visit_id: visit }, {}, 'PENNSYNC_NOTE_TEXT_INVALID'],
    [{ visit_id: visit, note: 'Shape.', entry_id: 'has spaces' }, {},
      'PENNSYNC_NOTE_ENTRY_ID_INVALID'],
    [{ visit_id: visit, note: 'Shape.', compliance_score: 101 }, {}, 'PENNSYNC_NOTE_SCORE_INVALID'],
    [{ visit_id: visit, note: 'Shape.', compliance_score: 'high' }, {},
      'PENNSYNC_NOTE_SCORE_INVALID'],
    [{ visit_id: visit, note: 'Shape.' }, { mode: 'rewrite' }, 'PENNSYNC_NOTE_MODE_INVALID'],
    // The entity keeps both copies of the text because the legacy column was
    // written from the same note; they may not diverge.
    [{ visit_id: visit, note: 'Shape.' }, { clinical: 'Different.' },
      'PENNSYNC_NOTE_CLINICAL_MISMATCH'],
  ]) await refusal(append(CLINICIAN_A, MINE, entry, options), code);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."patient_note_history_entry"`)).rows[0].n, before);
});

test('the log is append-only, and the contract has no way to make it otherwise', async () => {
  const sql = readFileSync(resolve(repository, NOTES), 'utf8');
  // D32 withholds the update and delete policies; this asserts the contract
  // does not even contain a statement that would want them.
  assert.equal(/update\s+"pennsync_records"\."patient_note_history_entry"/i.test(sql), false);
  assert.equal(/delete\s+from/i.test(sql), false);
  const granted = async name => (await db.query(
    'select has_function_privilege($1,$2,$3) as ok', ['authenticated', name, 'execute'])).rows[0].ok;
  assert.equal(await granted('pennsync_records.note_key(text[])'), false);
  assert.equal(await granted('pennsync_private.caller_membership(text)'), false,
    'the membership helper is the record owner\'s alone');
  assert.equal(await granted(
    'public.pennsync_contract_note_append(text,text,text,jsonb,text)'), true);
  assert.equal(await granted(
    'public.pennsync_contract_note_history(text,text,integer,integer)'), true);
});
