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
 * Submitting a staff credential (`contract_credential_submit`).
 *
 * The property worth the file is what is NOT here. `reviewPersonnelCredential`
 * is the first whole capability with no performer left — its only gate is
 * `u.role === 'admin'`, the platform tier D14 and D22 removed — so nothing in
 * this migration can move a credential out of `pending_approval`, and the last
 * test asserts that rather than leaving it to be noticed. Who may approve a
 * credential is a product decision, and taking it here would have widened what
 * the code ever granted.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TIME_OFF = 'services/authority-store/supabase/record-migrations/'
  + '20260920230000_contract_time_off.sql';
const CREDENTIAL = 'services/authority-store/supabase/record-migrations/'
  + '20260920240000_contract_credential.sql';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const SPARE_A = 3;
const SUBMIT = 'select "public"."pennsync_contract_credential_submit"($1,$2,$3,$4) as result';
const A = 'agency-a'; const B = 'agency-b';
const GOOD = Object.freeze({
  item_type: 'license', title: 'RN Licence', issuing_organization: 'PA Board',
  credential_number: 'RN-12345', issued_date: '2024-01-15',
  expiration_date: '2028-01-14', notes: 'renews every four years',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The time-off migration carries `time_off_date`, which this one reuses
  // rather than declaring a second date parser that could drift from it.
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, TIME_OFF, CREDENTIAL]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
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
const submit = (n, credential = GOOD, { id = null, renews = null, agency = A } = {}) =>
  as(n, SUBMIT, [agency, id, renews, JSON.stringify(credential)], true);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const rowOf = async id => (await db.query(
  `select "user_id","user_name","status","approved_by","title","notes","expiration_date",
     "uploaded_file_url" from ${SCHEMA}."personnel_credential" where "id" = $1`, [id])).rows[0];

test('a member files their own credential, and the server owns the decision fields', async () => {
  const result = await submit(CLINICIAN_A);
  assert.equal(result.success, true);
  assert.equal(result.credential.status, 'pending_approval');
  assert.equal(result.credential.user_id, email(CLINICIAN_A));
  assert.equal(result.credential.title, 'RN Licence');
  assert.equal(result.credential.approved_by, null);
  // Divergence 2: the carried profile has no name column, so the name is the
  // address — the original's own fallback.
  const row = await rowOf(result.credential.id);
  assert.equal(row.user_name, email(CLINICIAN_A));
  assert.equal(row.status, 'pending_approval');
  await refusal(submit(CLINICIAN_A, GOOD, { agency: B }), 'PENNSYNC_CREDENTIAL_AGENCY_NOT_HELD');
});

test('an unknown field is refused, not filtered away', async () => {
  // The original filters `SELF_SERVICE_FIELDS` silently. A caller who misspells
  // `expiration_date` would file a credential with no expiry and never know,
  // so this refuses the key instead.
  await refusal(submit(CLINICIAN_A, { ...GOOD, expiraton_date: '2028-01-14' }),
    'PENNSYNC_CREDENTIAL_FIELD_UNSUPPORTED');
  // And the server-controlled fields are refused by the same rule, which is
  // the point: a staff member with row access could otherwise approve their
  // own licence.
  for (const field of ['status', 'approved_by', 'approved_at', 'rejection_reason']) {
    await refusal(submit(CLINICIAN_A, { ...GOOD, [field]: 'approved' }),
      'PENNSYNC_CREDENTIAL_FIELD_UNSUPPORTED');
  }
});

test('the required three are required and the dates are real', async () => {
  await refusal(submit(CLINICIAN_A, { ...GOOD, title: '' }), 'PENNSYNC_CREDENTIAL_REQUIRED');
  await refusal(submit(CLINICIAN_A, { ...GOOD, item_type: 'badge' }),
    'PENNSYNC_CREDENTIAL_REQUIRED');
  await refusal(submit(CLINICIAN_A, { ...GOOD, expiration_date: '' }),
    'PENNSYNC_CREDENTIAL_REQUIRED');
  await refusal(submit(CLINICIAN_A, { ...GOOD, expiration_date: '2026-02-31' }),
    'PENNSYNC_CREDENTIAL_DATE_INVALID');
  await refusal(submit(CLINICIAN_A, { ...GOOD, issued_date: '2029-01-01' }),
    'PENNSYNC_CREDENTIAL_DATE_ORDER');
  await refusal(submit(CLINICIAN_A, { ...GOOD, notes: 'x'.repeat(4001) }),
    'PENNSYNC_CREDENTIAL_INVALID');
  await refusal(submit(CLINICIAN_A, { ...GOOD, title: 'x'.repeat(2001) }),
    'PENNSYNC_CREDENTIAL_INVALID');
  // An issued date is optional, and omitting it is not a refusal.
  const withoutIssued = Object.fromEntries(
    Object.entries(GOOD).filter(([key]) => key !== 'issued_date'));
  assert.equal((await submit(CLINICIAN_A, withoutIssued)).credential.issued_date, null);
});

test('the file link is bounded the way the original bounds it', async () => {
  // HTTPS, and no user information in the authority. It is stored and never
  // fetched — nothing in the port fetches a locator — so this bounds what can
  // be written rather than what can be reached.
  for (const bad of ['http://example.invalid/a.pdf', 'https://user:pw@example.invalid/a.pdf',
    'ftp://example.invalid/a.pdf', 'javascript:alert(1)', '/relative/a.pdf']) {
    await refusal(submit(CLINICIAN_A, { ...GOOD, uploaded_file_url: bad }),
      'PENNSYNC_CREDENTIAL_FILE_URL_INVALID');
  }
  const ok = await submit(CLINICIAN_A,
    { ...GOOD, uploaded_file_url: 'https://files.example.invalid/rn.pdf',
      uploaded_file_name: 'rn.pdf' });
  assert.equal((await rowOf(ok.credential.id)).uploaded_file_url,
    'https://files.example.invalid/rn.pdf');
  // The locator is stored and NOT projected back, the way the document pair
  // declines to disclose one.
  assert.equal(JSON.stringify(ok.credential).includes('files.example.invalid'), false);
});

test('editing returns a credential to review, and only its owner or an admin may', async () => {
  const mine = (await submit(CLINICIAN_A)).credential;
  // Pretend it had been decided, so the clearing is visible.
  await db.query(`update ${SCHEMA}."personnel_credential"
    set "status" = 'approved', "approved_by" = $2, "approved_at" = clock_timestamp()
    where "id" = $1`, [mine.id, email(ADMIN_A)]);
  // A colleague who is neither the owner nor an administrator cannot touch it.
  await refusal(submit(SPARE_A, { ...GOOD, title: 'Theirs' }, { id: mine.id }),
    'PENNSYNC_CREDENTIAL_FORBIDDEN');
  assert.equal((await rowOf(mine.id)).status, 'approved');

  const edited = await submit(CLINICIAN_A, { ...GOOD, title: 'RN Licence (renewed)' },
    { id: mine.id });
  assert.equal(edited.credential.title, 'RN Licence (renewed)');
  // Back to review, and the previous decision cleared: an edited credential is
  // not the one that was approved.
  assert.equal(edited.credential.status, 'pending_approval');
  assert.equal(edited.credential.approved_by, null);
  assert.equal((await rowOf(mine.id)).approved_by, null);
  // The agency's administrator may correct a colleague's.
  assert.equal((await submit(ADMIN_A, { ...GOOD, title: 'Corrected' }, { id: mine.id }))
    .credential.title, 'Corrected');
  await refusal(submit(CLINICIAN_A, GOOD, { id: 'no-such-credential' }),
    'PENNSYNC_CREDENTIAL_NOT_FOUND');
});

test('a renewal stamps the old credential and leaves its status alone', async () => {
  const old = (await submit(CLINICIAN_A, { ...GOOD, title: 'Expiring' })).credential;
  await db.query(`update ${SCHEMA}."personnel_credential" set "status" = 'approved'
    where "id" = $1`, [old.id]);
  const renewal = await submit(CLINICIAN_A, { ...GOOD, title: 'Renewed' },
    { renews: old.id });
  assert.equal(renewal.credential.status, 'pending_approval');
  const stamped = await rowOf(old.id);
  // The old one is annotated and STILL APPROVED — it stays valid until a
  // reviewer supersedes it, which is what the original is careful about.
  assert.match(stamped.notes, /\[Renewal submitted on \d{4}-\d{2}-\d{2}\]/);
  assert.equal(stamped.status, 'approved');
  // Somebody else's credential cannot be stamped by naming it as a renewal.
  const theirs = (await submit(SPARE_A, { ...GOOD, title: 'Not yours' })).credential;
  const before = (await rowOf(theirs.id)).notes;
  await submit(CLINICIAN_A, GOOD, { renews: theirs.id });
  assert.equal((await rowOf(theirs.id)).notes, before);
});

test('nothing here can approve a credential, and that is the point', async () => {
  // `reviewPersonnelCredential` gates on `u.role === 'admin'` — the platform
  // tier D14 and D22 removed — so the whole capability has no performer left
  // and is deliberately unported. This asserts the absence, so adding an
  // approve path without the product decision fails a test rather than
  // slipping through review.
  const source = readFileSync(resolve(repository, CREDENTIAL), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  for (const forbidden of ["'approved'", "'rejected'", '"approved_by" =', '"approved_at" ='] ) {
    // The only mentions are the ones that CLEAR a decision, which is a null.
    const uses = [...source.matchAll(new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
    for (const use of uses) {
      const tail = source.slice(use.index, use.index + 40);
      assert.match(tail, /= null|approved_by" = null|approved_at" = null/,
        `${forbidden} is only ever cleared, never set: ${tail}`);
    }
  }
  assert.equal(/contract_credential_(approve|review|reject)/.test(source), false);
  // And a submitted credential is pending, full stop.
  const fresh = (await submit(CLINICIAN_A, { ...GOOD, title: 'Still pending' })).credential;
  assert.equal(fresh.status, 'pending_approval');
});
