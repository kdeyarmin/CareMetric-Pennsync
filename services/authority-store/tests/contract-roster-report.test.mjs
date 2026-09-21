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
 * The roster report contract.
 *
 * Short, because it delegates the paging to `contract_roster_list` — so what
 * this file proves is the two things that are its own: the GATE, and a summary
 * counted over the whole agency rather than over a page. The delegation is
 * proved too, in both directions: the inherited cursor refusals really can
 * reach a caller through here, and `PENNSYNC_ROSTER_AGENCY_NOT_HELD` really
 * cannot, because the gate asks first with its own code.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATIONS = 'services/authority-store/supabase/record-migrations/';
const ROSTER = `${MIGRATIONS}20260920030000_contract_roster.sql`;
const REPORT = `${MIGRATIONS}20260920470000_contract_roster_report.sql`;
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const MANAGER_A = 3; const ADMIN_B = 4;
const REPORT_SQL = 'select "public"."pennsync_contract_roster_report"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, ROSTER, REPORT]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // A `manager` in agency-a, so the gate has something to refuse that the
  // roster's own privileged projection admits.
  await db.exec(`update pennsync_private.membership set tenant_role = 'manager'
    where id = 'membership-3'`);
  // Carried profile rows, for the one thing the authority store has no column
  // for: the credential the summary counts.
  for (const [id, credential] of [
    [`6aac00000000${uid(ADMIN_A).slice(-12)}`, 'RN'],
    [`6aac00000000${uid(CLINICIAN_A).slice(-12)}`, 'LPN'],
    [`6aac00000000${uid(MANAGER_A).slice(-12)}`, 'RN'],
  ]) {
    await db.query(`insert into ${SCHEMA}."user"("source_app_id","id","credential_type",
      "care_scope","agency_name","account_type","is_approved","role")
      values ($1,$2,$3,'home_health','Claimed Elsewhere','super_admin',false,'admin')`,
    [APP, id, credential]);
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
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const report = (n, options = {}) => as(n, REPORT_SQL,
  [options.agency ?? A, options.limit ?? 500, options.after ?? null]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
});

test('only an agency_admin may run it, and the gate is the original\'s live branch', async () => {
  assert.equal((await report(ADMIN_A)).summary.total, 3);
  // A `manager` is admitted by the roster's own privileged projection and is
  // refused here: the original's gate was the platform tier and an
  // `agency_admin` membership, never a manager.
  await refusal(report(MANAGER_A), 'PENNSYNC_ROSTER_REPORT_FORBIDDEN');
  await refusal(report(CLINICIAN_A), 'PENNSYNC_ROSTER_REPORT_FORBIDDEN');
  // An agency the caller holds nothing in answers with the gate's OWN code
  // rather than the roster's, which is what keeps a refusal vocabulary from
  // crossing between contracts.
  await refusal(report(ADMIN_B, { agency: A }), 'PENNSYNC_ROSTER_REPORT_AGENCY_NOT_HELD');
  await refusal(report(ADMIN_A, { agency: B }), 'PENNSYNC_ROSTER_REPORT_AGENCY_NOT_HELD');
  await refusal(report(ADMIN_A, { agency: 'agency-nowhere' }),
    'PENNSYNC_ROSTER_REPORT_AGENCY_NOT_HELD');
});

test('the cursor refusals it inherits by delegation really can be raised through it', async () => {
  // Declared in `record-contracts.mjs` because they can cross; asserted here
  // because "can cross" is a claim about the code, not about the comment.
  await refusal(report(ADMIN_A, { after: 'not-a-cursor' }), 'PENNSYNC_ROSTER_CURSOR_INVALID');
  await refusal(report(ADMIN_A, { after: 'a'.repeat(24) }), 'PENNSYNC_ROSTER_CURSOR_UNKNOWN');
});

test('the summary counts the whole agency, not the page', async () => {
  const first = await report(ADMIN_A, { limit: 1 });
  assert.equal(first.entries.length, 1);
  assert.ok(first.next, 'a page of one leaves a cursor');
  // The original counts its entire unpaged list, and a report whose first page
  // said "Total Users: 1" for an agency of three would be worse than none.
  assert.deepEqual(first.summary, { total: 3, approved: 3, pending: 0, rn: 2, lpn: 1 });
  const second = await report(ADMIN_A, { limit: 1, after: first.next });
  assert.deepEqual(second.summary, first.summary);
  assert.notEqual(second.entries[0].id, first.entries[0].id);
  // Another agency's members are not counted: the fixture's agency-b admin has
  // no credential row and is in nobody else's total.
  assert.deepEqual((await report(ADMIN_B, { agency: B })).summary,
    { total: 1, approved: 1, pending: 0, rn: 0, lpn: 0 });
});

test('approved is the identity being enabled, never the self-editable flag', async () => {
  // Every carried profile row here says `is_approved: false`, `role: 'admin'`
  // and `account_type: 'super_admin'` — the three labels the original reads.
  // The report says approved, because membership and the identity map do.
  assert.equal((await report(ADMIN_A)).summary.approved, 3);
  for (const entry of (await report(ADMIN_A)).entries) {
    assert.equal(entry.is_approved, true);
    // The two self-editable labels are not projected under any name.
    for (const field of ['account_type', 'role']) {
      assert.equal(Object.hasOwn(entry, field), false, `${field} is not projected`);
    }
    // `agency_name` IS projected and comes from the AUTHORITY store's agency
    // row, not from the carried profile — which says 'Claimed Elsewhere' here
    // precisely so a copy could not pass this.
    assert.equal(entry.agency_name, 'Synthetic Agency A');
    assert.equal(entry.agency_id, A);
    assert.ok(['agency_admin', 'manager', 'clinician'].includes(entry.tenant_role));
  }
  // Revoking the IDENTITY moves the person from approved to pending without
  // touching their membership — which is the distinction the column is for.
  // The revocation is TERMINAL: `protect_identity` refuses to re-enable a
  // disabled row (D35's reason for using this flag rather than the carried
  // `is_active`), so this assertion is not undone and every later test sees
  // the roster in this state.
  await db.exec(`update pennsync_private.identity_map
    set enabled = false, revoked_at = clock_timestamp(), version = version + 1
    where base44_user_id = '6aac00000000${uid(CLINICIAN_A).slice(-12)}'`);
  await assert.rejects(db.exec(`update pennsync_private.identity_map
    set enabled = true, version = version + 1
    where base44_user_id = '6aac00000000${uid(CLINICIAN_A).slice(-12)}'`),
  error => /PENNSYNC_IMMUTABLE_IDENTITY/.test(String(error?.message ?? error)));
  const after = await report(ADMIN_A);
  assert.deepEqual(after.summary, { total: 3, approved: 2, pending: 1, rn: 2, lpn: 1 });
  assert.equal(after.entries.find(entry => entry.email === email(CLINICIAN_A)).is_approved,
    false);
  // And they are still ON the roster: a colleague who can no longer sign in is
  // exactly the row an administrator's report should show as pending.
  assert.equal(after.entries.length, 3);
});

test('the paging body is delegated rather than copied', async () => {
  // D12's rule: a second copy is a second thing to keep in agreement. The
  // contract calls the roster's list and adds one key to the answer.
  const sql = readFileSync(resolve(repository, REPORT), 'utf8');
  assert.match(sql, /"pennsync_records"\.contract_roster_list\(p_agency, p_limit, p_after\)/);
  assert.equal(/caller_roster\(p_agency\)/.test(sql), true, 'the summary reads the roster');
  // No keyset, no cursor parsing, no projection of its own.
  for (const copied of [/order by m\.email/, /roster_entry\(/, /\^\[a-f0-9\]\{24\}\$/]) {
    assert.equal(copied.test(sql), false, `the report should not re-implement ${copied}`);
  }
  const full = await report(ADMIN_A);
  assert.deepEqual(Object.keys(full).sort(), ['entries', 'next', 'summary']);
  assert.equal(full.next, null, 'one page holds the whole agency');
});
