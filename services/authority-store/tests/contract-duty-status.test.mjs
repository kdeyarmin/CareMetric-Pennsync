import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, PROFILE_SELF_WRITABLE } from '../../../tools-entity-schema-plan.mjs';
import {
  applyRecordMigrations, assertNewestRecordMigration, recordMigrationNames,
} from './record-migrations.mjs';

/**
 * The duty toggle, the scheduled window and the off-duty message —
 * `setNurseDutyStatus`, and the FIRST caller of D82's profile-write path.
 *
 * That is what makes this suite worth more than its own capability. D82 gave
 * `pennsync_records.user` an update policy naming `caller_user_id()` and a
 * trigger admitting only `PROFILE_SELF_WRITABLE`, and nothing had ever written
 * that table, so both halves were built and unexercised. Every test below that
 * writes a row is also the first evidence either one works against a database.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATION = 'services/authority-store/supabase/record-migrations/'
  + '20260920710000_contract_duty_status.sql';
const ORIGINAL = 'base44/functions/setNurseDutyStatus/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = n => `6aac00000000${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const SET = 'select "public"."pennsync_contract_duty_status_set"($1,$2,$3) as result';
const A = 'agency-a'; const B = 'agency-b';
let db; let original;

before(async () => {
  original = await readFile(resolve(repository, ORIGINAL), 'utf8');
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The whole record directory in the deployment's own order, so a forward
  // migration that lands on this contract is applied by this suite too, and
  // then both halves of the check: that what was applied IS the directory, so
  // a file added beside this one cannot be silently skipped, and that this
  // migration sorts LAST, so `planMigration` will not refuse
  // MIGRATE_OUT_OF_ORDER on a store that has already applied an earlier one.
  //
  // The ordering guard belongs to whichever migration is the newest PENDING
  // one and is never held by two suites at once. It arrived here from
  // `contract-reference-writes.test.mjs`, which is still unmerged — so the
  // move was not that suite's migration merging, the usual reason, but this
  // one overtaking it inside the same change. A held guard whose file has been
  // overtaken asserts a tree that the overtaking change makes false, which is
  // exactly the red it produced.
  const applied = await applyRecordMigrations(db);
  assert.deepEqual(applied, await recordMigrationNames(),
    'the record directory and what was applied to this store disagree');
  assertNewestRecordMigration(applied, '20260920710000_contract_duty_status.sql');
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  // Carried profile rows for three people in two agencies. Every authority
  // label on them is a lie, as everywhere else here, because D23's whole point
  // is that the roster answers from membership and never from these columns.
  await db.exec(`insert into ${SCHEMA}."user"
    ("source_app_id","id","agency_id","agency_name","account_type","role",
     "duty_status","off_duty_message") values
    ('${APP}','${rid(ADMIN_A)}','agency-z','Claimed Z','platform_admin','admin',
     'off_duty','original message'),
    ('${APP}','${rid(CLINICIAN_A)}','agency-z','Claimed Z','platform_admin','admin',
     'off_duty',null),
    ('${APP}','${rid(ADMIN_B)}','agency-z','Claimed Z','platform_admin','admin',
     'on_duty',null);`);
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
    await db.exec(commit ? 'commit' : 'rollback');
    return rows[0]?.result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}
const refusal = async (n, params, code, commit = false) => {
  await assert.rejects(() => as(n, SET, params, commit),
    error => String(error.message).includes(code),
    `expected ${code} for ${JSON.stringify(params)}`);
};
const rowOf = async n => (await db.query(
  `select * from ${SCHEMA}."user" where "id" = $1`, [rid(n)])).rows[0];

test('the toggle writes the caller\'s own row, which nothing had ever done', async () => {
  const answer = await as(CLINICIAN_A, SET, [A, null, { duty_status: 'on_duty' }], true);
  assert.deepEqual(answer, { success: true, duty_status: 'on_duty' });
  const row = await rowOf(CLINICIAN_A);
  assert.equal(row.duty_status, 'on_duty');
  // `duty_on_since` is STAMPED, never sent. The inbound call and SMS webhooks
  // treat a toggle stamped on an earlier day as expired, so a caller who could
  // send it could hold themselves on duty indefinitely.
  assert.ok(row.duty_on_since instanceof Date || typeof row.duty_on_since === 'string');
  assert.ok(!PROFILE_SELF_WRITABLE.includes('id'),
    'and the allowlist is the one this write had to pass');

  const off = await as(CLINICIAN_A, SET, [A, null, { duty_status: 'off_duty' }], true);
  assert.deepEqual(off, { success: true, duty_status: 'off_duty' });
  assert.equal((await rowOf(CLINICIAN_A)).duty_on_since, null,
    'cleared on the way off, as the original clears it');
});

test('a colleague\'s row is refused by name rather than silently not written', async () => {
  // D14 and D22 removed the platform tier the original's cross-user leg runs
  // on, and `user_update` would refuse this write anyway — as a row that did
  // not update, which reaches the caller as success. The contract raises first.
  await refusal(ADMIN_A, [A, 'clinician-a@example.invalid', { duty_status: 'on_duty' }],
    'PENNSYNC_DUTY_STATUS_TARGET_UNSUPPORTED');
  assert.equal((await rowOf(CLINICIAN_A)).duty_status, 'off_duty');

  // The original's own gate is what this replaces, so it is read out of the
  // original rather than described: the only branch that admits a target is
  // the protected platform owner's.
  assert.ok(/isProtectedSuperAdmin\(user\)/.test(original)
    && /SUPER_ADMIN_EMAIL/.test(original),
    'the leg being refused is the platform owner\'s, in the original\'s own words');

  // What is underneath the refusal, said accurately rather than assumed. The
  // first draft of this asserted that a direct update of a colleague's row, as
  // `authenticated`, touches zero rows — and it does not touch the table at
  // all: `user_update` calls `deployment_app()`, a policy expression runs with
  // the QUERYING role's privileges, and that role holds no execute on it. So
  // the refusal is `permission denied for function deployment_app` and the
  // contract is the only path to the table. A stronger result than the one
  // being asked for, and a different one.
  await assert.rejects(() => as(ADMIN_A, `with w as (
      update ${SCHEMA}."user" set "duty_status" = 'on_duty'
      where "id" = '${rid(CLINICIAN_A)}' returning 1)
    select count(*)::int as result from w`),
  error => /permission denied for function deployment_app/.test(String(error.message)),
  'a caller does not reach the table to be refused by its policy');

  // Which leaves the policy's own narrowing proved by nothing here, and that
  // is worth saying rather than implying. The contract's UPDATE carries
  // `where u."id" = v_user`, so it reaches the caller's row before the policy
  // has to, and this suite cannot make `user_update` be the thing that
  // refuses. That predicate is deliberate — D51's rule, that a policy is not a
  // predicate a contract may leave unstated — so the catalog is asserted
  // instead, and the claim is only that the policy says what D82 says it does.
  const { rows: [policy] } = await db.query(
    `select qual, with_check from pg_policies
     where schemaname = 'pennsync_records' and tablename = 'user' and policyname = 'user_update'`);
  for (const expression of [policy.qual, policy.with_check]) {
    assert.match(String(expression), /caller_user_id\(\)/);
  }

  // And the caller's OWN address is not a cross-user write, so a client that
  // always sends the field keeps working.
  const answer = await as(ADMIN_A, SET, [A, 'admin-a@example.invalid', { duty_status: 'on_duty' }]);
  assert.deepEqual(answer, { success: true, duty_status: 'on_duty' });
});

test('membership decides, and it is the agency named in the call', async () => {
  await refusal(ADMIN_B, [A, null, { duty_status: 'on_duty' }],
    'PENNSYNC_DUTY_STATUS_AGENCY_NOT_HELD');
  // The narrowing this carries: the original admits the platform owner INSTEAD
  // of an active membership, and here membership is the only way in.
  assert.ok(/active agency membership required/.test(original));
  const answer = await as(ADMIN_B, SET, [B, null, { duty_status: 'off_duty' }]);
  assert.deepEqual(answer, { success: true, duty_status: 'off_duty' });
});

test('a field the server decides, and a field nobody named, are both refused', async () => {
  for (const patch of [{ duty_on_since: '2026-01-01T00:00:00Z' }, { is_approved: true },
    { role: 'admin' }, { dutyStatus: 'on_duty' }]) {
    await refusal(CLINICIAN_A, [A, null, patch], 'PENNSYNC_DUTY_STATUS_FIELD_UNSUPPORTED');
  }
  // Refused rather than filtered, which is D39: a silent filter is what keeps a
  // caller away from a field it must not set AND what loses a misspelling.
  await refusal(CLINICIAN_A, [A, null, {}], 'PENNSYNC_DUTY_STATUS_PATCH_INVALID');
  await refusal(CLINICIAN_A, [A, null, null], 'PENNSYNC_DUTY_STATUS_PATCH_INVALID');
  for (const bad of ['ON_DUTY', 'on duty', '', 'active']) {
    await refusal(CLINICIAN_A, [A, null, { duty_status: bad }],
      'PENNSYNC_DUTY_STATUS_VALUE_INVALID');
  }
});

test('the window is paired, ordered, and bounded only when it repeats', async () => {
  const start = '2026-03-02T09:00:00Z'; const end = '2026-03-03T09:00:00Z';
  for (const patch of [{ scheduled_off_duty_start: start }, { scheduled_off_duty_end: end },
    { scheduled_off_duty_start: start, scheduled_off_duty_end: null },
    { scheduled_off_duty_start: null, scheduled_off_duty_end: end }]) {
    await refusal(CLINICIAN_A, [A, null, patch], 'PENNSYNC_DUTY_STATUS_WINDOW_INCOMPLETE');
  }
  await refusal(CLINICIAN_A, [A, null,
    { scheduled_off_duty_start: end, scheduled_off_duty_end: start }],
  'PENNSYNC_DUTY_STATUS_WINDOW_INVALID');
  await refusal(CLINICIAN_A, [A, null,
    { scheduled_off_duty_start: start, scheduled_off_duty_end: start }],
  'PENNSYNC_DUTY_STATUS_WINDOW_INVALID');
  // D38's reason for parsing a TEXT date rather than taking a `date`
  // parameter: an impossible one is this contract's refusal, in its own
  // vocabulary, rather than the transport's.
  await refusal(CLINICIAN_A, [A, null,
    { scheduled_off_duty_start: '2026-02-31T09:00:00Z', scheduled_off_duty_end: end }],
  'PENNSYNC_DUTY_STATUS_WINDOW_INVALID');

  // Eight days is fine when it does not repeat and refused when it does, which
  // is the original's rule and not a length limit on windows.
  const long = { scheduled_off_duty_start: start, scheduled_off_duty_end: '2026-03-10T09:00:00Z' };
  assert.deepEqual(await as(CLINICIAN_A, SET, [A, null, long]),
    { success: true, duty_status: 'off_duty' });
  await refusal(CLINICIAN_A, [A, null, { ...long, scheduled_off_duty_recurring: true }],
    'PENNSYNC_DUTY_STATUS_WINDOW_TOO_LONG');

  // Clearing drops the recurrence with the window, so it cannot linger on a
  // window that no longer exists.
  await as(CLINICIAN_A, SET, [A, null, { scheduled_off_duty_start: start,
    scheduled_off_duty_end: end, scheduled_off_duty_recurring: true }], true);
  assert.equal((await rowOf(CLINICIAN_A)).scheduled_off_duty_recurring, true);
  await as(CLINICIAN_A, SET, [A, null,
    { scheduled_off_duty_start: null, scheduled_off_duty_end: null }], true);
  const cleared = await rowOf(CLINICIAN_A);
  assert.equal(cleared.scheduled_off_duty_start, null);
  assert.equal(cleared.scheduled_off_duty_recurring, false);
});

test('the recurrence flag is a boolean here and is coerced in the original', async () => {
  // The original writes `!!scheduled_off_duty_recurring`, so the string
  // "false" creates a repeating window. Refused instead. A NARROWING, and the
  // original's own expression is read rather than described.
  assert.ok(/!!scheduled_off_duty_recurring/.test(original));
  await refusal(CLINICIAN_A, [A, null, { scheduled_off_duty_start: '2026-03-02T09:00:00Z',
    scheduled_off_duty_end: '2026-03-03T09:00:00Z', scheduled_off_duty_recurring: 'false' }],
  'PENNSYNC_DUTY_STATUS_VALUE_INVALID');
});

test('the off-duty message is sanitized in SQL, because a service cannot be the boundary', async () => {
  // The original's comment says why this is a disclosure control rather than
  // shaping: the message is spoken to callers by TTS and sent as an SMS
  // auto-reply. A control the service applies is one a direct RPC call skips.
  assert.ok(/SSML\/markup injection/.test(original));
  await as(CLINICIAN_A, SET, [A, null,
    { off_duty_message: 'back <b>soon</b>\u0007 ok' }], true);
  assert.equal((await rowOf(CLINICIAN_A)).off_duty_message, 'back bsoon/b  ok');

  // Cut at 320 UTF-16 code units, counted the way D33's `bounded_reason`
  // counts them — an astral character weighs two — so a message of 160 emoji
  // is already at the bound and the 161st is dropped whole rather than split.
  // PostgreSQL text cannot hold a lone surrogate, so the original's mid-pair
  // cut has no representation here; this is one character shorter in that one
  // case, and identical everywhere else.
  const { rows: [{ b }] } = await db.query(
    `select "pennsync_records".duty_message_bounded($1) as b`, ['a'.repeat(400)]);
  assert.equal(b.length, 320);
  const { rows: [{ e }] } = await db.query(
    `select "pennsync_records".duty_message_bounded($1) as e`, ['\u{1F600}'.repeat(200)]);
  assert.equal([...e].length, 160, 'an astral character weighs two');
  assert.equal(e.length, 320, 'which is the count the original slices on');

  // Nulling it is a clear, not a no-op.
  await as(CLINICIAN_A, SET, [A, null, { off_duty_message: null }], true);
  assert.equal((await rowOf(CLINICIAN_A)).off_duty_message, null);
  await refusal(CLINICIAN_A, [A, null, { off_duty_message: 7 }],
    'PENNSYNC_DUTY_STATUS_VALUE_INVALID');
});

test('the change and its trail entry are one transaction', async () => {
  // D37's shape. The original writes `UserActivity` with `.catch()`, so a
  // failed audit leaves the change made and unrecorded; here neither half can
  // exist without the other. Stricter than the original, and deliberate.
  assert.ok(/\.catch\(\(err\) => console\.error\('Failed to log activity/.test(original));
  const before = (await db.query(
    "select count(*)::int as n from pennsync_records.activity_audit where action = 'duty_status_changed'"
  )).rows[0].n;
  await as(ADMIN_A, SET, [A, null, { duty_status: 'on_duty' }], true);
  const after = (await db.query(
    "select count(*)::int as n from pennsync_records.activity_audit where action = 'duty_status_changed'"
  )).rows[0].n;
  assert.equal(after, before + 1);

  // And a refused change appends nothing, which is the same property from the
  // other side: an entry recording a duty change nobody made is worse than
  // none. Asserted on a refusal AFTER the write would have happened, so it
  // exercises the rollback rather than an early return.
  await refusal(ADMIN_A, [A, null, { duty_status: 'on_duty', scheduled_off_duty_start: 'x' }],
    'PENNSYNC_DUTY_STATUS_WINDOW_INCOMPLETE');
  assert.equal((await db.query(
    "select count(*)::int as n from pennsync_records.activity_audit where action = 'duty_status_changed'"
  )).rows[0].n, after);
});

test('the contract is reachable by a member and by nobody else', async () => {
  for (const [role, expected] of [['anon', false], ['authenticated', true], ['service_role', false]]) {
    const { rows: [{ ok }] } = await db.query(
      "select has_function_privilege($1,'public.pennsync_contract_duty_status_set(text,text,jsonb)','execute') as ok",
      [role]);
    assert.equal(ok, expected, `${role} should ${expected ? '' : 'not '}reach the wrapper`);
  }
  // The helpers are the record owner's alone: a caller who could ask
  // `duty_message_bounded` directly learns nothing, and one who could ask for
  // the writable field list would be reading the gate rather than passing it.
  for (const helper of ['pennsync_records.duty_status_writable_fields()',
    'pennsync_records.duty_message_bounded(text)']) {
    const { rows: [{ ok }] } = await db.query(
      "select has_function_privilege('authenticated',$1,'execute') as ok", [helper]);
    assert.equal(ok, false, `${helper} is not a caller's to ask`);
  }
});

test('every column the contract writes is one D82 admits', async () => {
  // The reason this capability was in the wrong bucket, asserted rather than
  // narrated: all six are on the allowlist, so the trigger admits the write and
  // the port was never blocked. If a later change adds a seventh that is not,
  // this fails here rather than at a caller's first toggle.
  const { rows: [{ fields }] } = await db.query(
    'select "pennsync_records".duty_status_writable_fields() as fields');
  const written = [...fields, 'duty_on_since'];
  for (const column of written) {
    assert.ok(PROFILE_SELF_WRITABLE.includes(column),
      `${column} must be on PROFILE_SELF_WRITABLE or the trigger refuses the write`);
  }
  // And the derived one is NOT in the caller's set, which is the other half.
  assert.equal(fields.includes('duty_on_since'), false);
  const migration = await readFile(resolve(repository, MIGRATION), 'utf8');
  assert.equal(/p_patch ->> 'duty_on_since'/.test(migration), false,
    'the stamp is never read from the patch');
});

test('the original serves only a caller with exactly one membership, and this does not', () => {
  // The divergence the call-site review turned up, recorded rather than
  // discovered later. `hasExactActiveAgencyMembership` filters for `status:
  // 'active'` with a limit of 2 and refuses unless it gets back EXACTLY ONE
  // row, so a person who holds two agencies cannot use this capability in
  // Base44 at all.
  assert.match(original, /rows\.length !== 1/);
  assert.match(original, /undefined,\s*\n\s*2,/);

  // Here the request names its tenant -- the business API's invariant -- and
  // the gate is membership in THAT agency, so a two-agency caller is served.
  // That is a WIDENING, and it is D68's shape rather than a decision taken
  // here: the exact-one check is how a handler with no envelope establishes a
  // tenant at all, and it is a compensation the envelope removes.
  //
  // What the agency actually decides is worth naming, because it is the whole
  // of the widening's blast radius: the row being written is the caller's own
  // profile, which carries no agency, so the only agency-scoped effect is
  // which agency's activity trail the entry lands in -- and they hold both.
  //
  // The scan below strips comments first, and that is not tidiness: the first
  // version of it failed on this contract's OWN HEADER, which names the check
  // it deletes in the sentence explaining why it is deleted. A check that reads
  // a file for an absent name must say whether it means absent from the CODE or
  // absent from the PAGE. This one means the code. (The same defect the
  // state-incident port recorded, arriving in the test written to avoid it.)
  const migration = readFileSync(resolve(repository, MIGRATION), 'utf8')
    .split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
  assert.match(migration, /caller_tenant_role\(p_agency\)/);
  assert.equal(/rows\.length|exactly one|limit 2/i.test(migration), false,
    'the compensation is deleted rather than reimplemented');
});
