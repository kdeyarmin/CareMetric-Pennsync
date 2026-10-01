/**
 * The duty-status contract, against the real migration.
 *
 * Four things about this suite are load-bearing rather than shape.
 *
 * It applies the WHOLE record directory, so the store it writes against is the
 * one a deployment gets — and here that matters more than usual, because the
 * thing this contract relies on is not in its own file. D82's `user_update`
 * policy and `user_self_write_guard` trigger live in the generated migration
 * and its catch-up; a suite that applied only this contract's SQL would be
 * asserting against a table with no policy at all, where every write succeeds
 * and nothing is proved. Two tests below fail if either object is missing, and
 * the migration itself refuses to install without them.
 *
 * It COMMITS every write, because the read-back is the assertion: a contract
 * that answered correctly and wrote nothing would pass every check made on its
 * answer alone.
 *
 * Its callers are seeded so tenancy and ownership DIFFER — two colleagues in
 * one agency, an admin in another — because the whole question this contract
 * leans on is whether sharing an agency is the same as owning a row. A suite
 * whose callers each held their own agency would pass with D82's policy
 * deleted.
 *
 * And the refused leg is asserted by its CODE, not merely by "it refused". The
 * target leg refuses, and so does a body naming a column nobody may
 * self-write — for entirely different reasons, one in this file and one in
 * D82's trigger. An assertion both satisfy proves neither.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA, PROFILE_SELF_WRITABLE } from '../../../tools-entity-schema-plan.mjs';
import {
  applyRecordMigrations, recordMigrationNames,
} from './record-migrations.mjs';

const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const RECORDS = 'services/authority-store/supabase/record-migrations/';
const DUTY_NAME = '20260920690000_contract_duty_status.sql';
const DUTY = resolve(repository, RECORDS + DUTY_NAME);
const ORIGINAL = resolve(repository, 'base44/functions/setNurseDutyStatus/entry.ts');
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bid = n => `6aac00000000${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const A = 'agency-a'; const B = 'agency-b';

const SET = 'select "public"."pennsync_contract_duty_status_set"($1,$2) as result';

let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  const applied = await applyRecordMigrations(db);
  assert.deepEqual(applied, await recordMigrationNames(),
    'the record directory and what was applied to this store disagree');
  // The ordering guard is NOT here, and the comment that used to claim it was
  // is why this is spelled out. This file was the newest pending migration when
  // it landed on `main`; it stopped being that when this branch's
  // `20260920700000_contract_reference_writes` merged in, which sorts after it.
  // So the guard moved on to `contract-reference-writes.test.mjs` and this
  // suite keeps only the property that is its own.
  //
  // Nothing about this file changed. It was OVERTAKEN, which is the rule the
  // helper's error text does not name — it names merging, the commonest cause.
  // A suite that kept the call after being overtaken asserts a tree the
  // overtaking change makes false, and fails for a reason that reads like a
  // defect in this contract.
  assert.ok(applied.includes(DUTY_NAME),
    `the record walk did not apply ${DUTY_NAME}`);
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));

  // The carried profile rows. The fixtures stop at the authority store, and
  // this is the first contract that writes `pennsync_records.user`.
  //
  // There is no `email` column to seed and that is not an oversight: Base44
  // keeps the address on the platform ACCOUNT, so the carried table has
  // neither a name nor an address. `caller_email()` reads
  // `identity_map.expected_email`, which the fixtures do seed, and that is
  // what the target-leg comparison below comes from.
  for (const n of [ADMIN_A, CLINICIAN_A, CLINICIAN_EMPTY, ADMIN_B]) {
    await db.query(`insert into ${SCHEMA}."user"
      ("source_app_id","id","duty_status") values ($1,$2,$3)`,
    [APP, bid(n), 'off_duty']);
  }
});

after(async () => { await db?.close(); });

/** Run as a caller and COMMIT, because the read-back is the assertion. */
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

/** The refusal's own message, which is what the HTTP boundary classifies. */
async function refusal(n, sql, params = []) {
  try {
    await as(n, sql, params);
  } catch (error) { return error.message; }
  throw new Error(`expected a refusal from ${sql}`);
}

const set = (n, agency, updates) => as(n, SET, [agency, JSON.stringify(updates)]);
const refuse = (n, agency, updates) => refusal(n, SET, [agency, JSON.stringify(updates)]);

/** Read the profile row back through the store rather than through the answer. */
async function profile(n) {
  const { rows } = await db.query(
    `select * from ${SCHEMA}."user" where "source_app_id" = $1 and "id" = $2`, [APP, bid(n)]);
  return rows[0];
}

/* --------------------------------------------------------------- the toggle */

test('a clinician toggles their own duty status, and the row moves', async () => {
  const answer = await set(CLINICIAN_A, A, { duty_status: 'on_duty' });
  assert.equal(answer.success, true);
  assert.equal(answer.duty_status, 'on_duty');
  const stored = await profile(CLINICIAN_A);
  assert.equal(stored.duty_status, 'on_duty');
  // The stamp is what makes an on-duty toggle expire overnight on its own.
  assert.ok(stored.duty_on_since instanceof Date, 'duty_on_since was not stamped');
});

test('toggling off CLEARS the stamp rather than leaving yesterday pointing at today', async () => {
  await set(CLINICIAN_A, A, { duty_status: 'on_duty' });
  await set(CLINICIAN_A, A, { duty_status: 'off_duty' });
  const stored = await profile(CLINICIAN_A);
  assert.equal(stored.duty_status, 'off_duty');
  assert.equal(stored.duty_on_since, null);
});

test('an unnamed field is left alone rather than wiped', async () => {
  await set(CLINICIAN_A, A, { off_duty_message: 'Back Monday' });
  await set(CLINICIAN_A, A, { duty_status: 'on_duty' });
  const stored = await profile(CLINICIAN_A);
  assert.equal(stored.off_duty_message, 'Back Monday',
    'a body naming only duty_status wiped a field it did not name');
});

test('an empty body is refused rather than treated as a no-op write', async () => {
  assert.match(await refuse(CLINICIAN_A, A, {}), /PENNSYNC_DUTY_NOTHING_TO_UPDATE/);
});

test('duty_status outside the pair is refused', async () => {
  assert.match(await refuse(CLINICIAN_A, A, { duty_status: 'on_call' }),
    /PENNSYNC_DUTY_STATUS_INVALID/);
  // The original tests truthiness first, so an empty string is "not supplied"
  // and falls through to the empty-body refusal rather than the enum's.
  assert.match(await refuse(CLINICIAN_A, A, { duty_status: '' }),
    /PENNSYNC_DUTY_NOTHING_TO_UPDATE/);
});

/* ------------------------------------------------------- whose row, and D82 */

test('a colleague in the same agency cannot move my duty status', async () => {
  // Both callers hold agency-a, so this is the assertion that sharing an
  // agency is not owning the row. The contract names the caller's own row and
  // D82's policy is what refuses anything else, so what this proves is that
  // naming somebody else never reaches a row at all.
  const before = await profile(CLINICIAN_A);
  await set(CLINICIAN_EMPTY, A, { duty_status: 'on_duty' });
  const after = await profile(CLINICIAN_A);
  assert.equal(after.duty_status, before.duty_status,
    'one colleague changed another colleague\'s duty status');
  assert.equal((await profile(CLINICIAN_EMPTY)).duty_status, 'on_duty');
});

test('naming somebody else is refused BY NAME, not silently dropped', async () => {
  // D81's shape: the leg whose performer D14 and D22 removed answers with its
  // own code, so a caller who believed it took effect is told otherwise. The
  // code is asserted rather than the refusal, because a body naming a column
  // nobody may self-write also refuses — for a different reason, in D82's
  // trigger — and an assertion both satisfy proves neither.
  assert.match(
    await refuse(CLINICIAN_A, A, { duty_status: 'on_duty', target_user_email: email(CLINICIAN_EMPTY) }),
    /PENNSYNC_DUTY_TARGET_FORBIDDEN/);
});

test('naming YOURSELF is accepted, because the original accepts it', async () => {
  // The original's guard is `target_user_email && target_user_email !== user.email`,
  // so an address equal to the caller's own never reaches the super-admin gate.
  // Refusing it here would be a narrowing nobody decided.
  const answer = await set(CLINICIAN_A, A, {
    duty_status: 'off_duty', target_user_email: email(CLINICIAN_A),
  });
  assert.equal(answer.success, true);
});

test('and the comparison is EXACT, because the original\'s is', async () => {
  // `!==` on two strings folds no case and trims no padding, so an address
  // differing only in case goes down the protected-owner branch and an
  // ordinary caller is refused there. Accepting it here would be a widening,
  // and the direction matters: this is the only check standing between a
  // caller and somebody else's row.
  for (const named of [
    email(CLINICIAN_A).toUpperCase(),
    ` ${email(CLINICIAN_A)} `,
  ]) {
    assert.match(
      await refuse(CLINICIAN_A, A, { duty_status: 'off_duty', target_user_email: named }),
      /PENNSYNC_DUTY_TARGET_FORBIDDEN/,
      `${JSON.stringify(named)} is not the caller's address`);
  }
});

test('a truthy NON-STRING target is refused rather than ignored', async () => {
  // `5 !== 'someone@example.invalid'` is true in the original, so a number or
  // an object reaches the protected-owner gate and is refused there. A type
  // check that simply skipped a non-string would silently write the caller's
  // own row for a body that asked for somebody else's.
  for (const named of [5, { email: email(CLINICIAN_EMPTY) }, [email(CLINICIAN_EMPTY)]]) {
    assert.match(
      await refuse(CLINICIAN_A, A, { duty_status: 'off_duty', target_user_email: named }),
      /PENNSYNC_DUTY_TARGET_FORBIDDEN/,
      `${JSON.stringify(named)} is truthy and is not the caller's address`);
  }
  // …while a FALSY one is "not supplied" and writes the caller's own row, which
  // is what `target_user_email &&` does.
  for (const named of [null, '', false, 0]) {
    assert.equal((await set(CLINICIAN_A, A, {
      duty_status: 'off_duty', target_user_email: named,
    })).success, true, `${JSON.stringify(named)} is falsy, so no target was named`);
  }
});

test('an agency the caller does not hold is refused', async () => {
  assert.match(await refuse(CLINICIAN_A, B, { duty_status: 'on_duty' }),
    /PENNSYNC_DUTY_AGENCY_NOT_HELD/);
});

test('D82 is what this contract writes through, and it is really there', async () => {
  // The contract adds no ownership predicate because the policy carries it.
  // That is only true while the policy exists, so the suite asserts the
  // premise rather than the consequence — the failure mode otherwise is a
  // store where every write succeeds and every test above still passes.
  const { rows: policies } = await db.query(`select polname from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relname = 'user' order by polname`, [SCHEMA]);
  assert.deepEqual(policies.map(r => r.polname), ['user_read', 'user_update'],
    'the profile table gained or lost a policy; D82 says one update policy and no more');
  const { rows: triggers } = await db.query(`select tgname, tgenabled from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 and c.relname = 'user' and not t.tgisinternal`, [SCHEMA]);
  assert.deepEqual(triggers, [{ tgname: 'user_self_write_guard', tgenabled: 'O' }],
    'the self-write guard is missing or disabled; a disabled trigger deparses identically (D95)');
});

test('a caller role cannot reach this table at all, so a definer is the only way in', async () => {
  // The REACHABILITY condition, not a second copy of the guard's refusals.
  //
  // The first draft of this test tried to drive `update … set role = 'admin'`
  // directly and assert the guard's message. It cannot work, and the reason is
  // worth keeping: run as `authenticated`, the statement is refused for want
  // of a privilege on `deployment_app` before any policy is read; run as
  // `pennsync_records_owner`, `caller_user_id()` is NULL — the caller helpers
  // resolve an identity from the session's claims through
  // `pennsync_private`, which the owner does not hold — so D82's policy
  // matches no rows and the update silently affects none. Either way the
  // trigger never fires, and asserting "it refused" would have passed for a
  // reason that has nothing to do with the guard.
  //
  // So the guard's own refusals stay where they can be raised —
  // `record-store-migration.test.mjs` drives them through a broker — and what
  // this suite proves is the premise those refusals rest on: no caller role
  // holds a grant here, so the only path to this table is a SECURITY DEFINER
  // contract, and every such contract is reviewed.
  const { rows } = await db.query(`select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = $1 and table_name = 'user'
      and grantee in ('anon','authenticated','service_role','public','PUBLIC')`, [SCHEMA]);
  assert.deepEqual(rows, [],
    'a caller role was granted something on the profile table; D82\'s guard and policy '
    + 'are the only things between it and a self-asserted role, and a direct grant '
    + 'routes around the contract that was reviewed');
});

test('every column this contract writes is on PROFILE_SELF_WRITABLE', async () => {
  // The contract's `update` list and D82's allowlist are two files, and the
  // guard is what would catch a disagreement — at runtime, on a real caller.
  // Deriving the list from the SQL rather than retyping it is D82's own rule
  // about a second copy kept by hand.
  const sql = readFileSync(DUTY, 'utf8');
  const columns = [...sql.matchAll(/^ +(?:set )?"([a-z_]+)" = /gm)].map(m => m[1]);
  assert.ok(columns.length >= 7, `read ${columns.length} written columns, expected the whole set`);
  for (const column of columns) {
    assert.ok(PROFILE_SELF_WRITABLE.includes(column),
      `${column} is written by this contract and is not on PROFILE_SELF_WRITABLE`);
  }
});

/* ------------------------------------------------------------ the schedule */

test('start and end move together, and a one-sided body is refused', async () => {
  assert.match(
    await refuse(CLINICIAN_A, A, { scheduled_off_duty_start: '2026-10-03T09:00:00Z' }),
    /PENNSYNC_DUTY_SCHEDULE_PAIR_REQUIRED/);
  assert.match(
    await refuse(CLINICIAN_A, A, { scheduled_off_duty_end: '2026-10-03T09:00:00Z' }),
    /PENNSYNC_DUTY_SCHEDULE_PAIR_REQUIRED/);
});

test('one null and one date is refused rather than half-persisted', async () => {
  assert.match(await refuse(CLINICIAN_A, A, {
    scheduled_off_duty_start: '2026-10-03T09:00:00Z', scheduled_off_duty_end: null,
  }), /PENNSYNC_DUTY_SCHEDULE_INCOMPLETE/);
});

test('a window is stored, and clearing it drops the recurrence with it', async () => {
  const answer = await set(CLINICIAN_A, A, {
    scheduled_off_duty_start: '2026-10-03T09:00:00Z',
    scheduled_off_duty_end: '2026-10-05T09:00:00Z',
    scheduled_off_duty_recurring: true,
  });
  assert.equal(answer.scheduled_off_duty_recurring, true);
  assert.ok((await profile(CLINICIAN_A)).scheduled_off_duty_start instanceof Date);

  const cleared = await set(CLINICIAN_A, A, {
    scheduled_off_duty_start: null, scheduled_off_duty_end: null,
  });
  assert.equal(cleared.scheduled_off_duty_start, null);
  assert.equal(cleared.scheduled_off_duty_end, null);
  // A repeat must not outlive the dates it was repeating.
  assert.equal(cleared.scheduled_off_duty_recurring, false);
});

test('an end at or before the start is refused', async () => {
  for (const end of ['2026-10-03T09:00:00Z', '2026-10-02T09:00:00Z']) {
    assert.match(await refuse(CLINICIAN_A, A, {
      scheduled_off_duty_start: '2026-10-03T09:00:00Z', scheduled_off_duty_end: end,
    }), /PENNSYNC_DUTY_SCHEDULE_BACKWARDS/);
  }
});

test('a repeating window of a week or more is refused, and a shorter one is not', async () => {
  // The original's bound is `e - s >= WEEK_MS`, so exactly seven days is out
  // and a minute under it is in. Both sides are asserted because a `>` written
  // for a `>=` passes every test that only checks the far side.
  assert.match(await refuse(CLINICIAN_A, A, {
    scheduled_off_duty_start: '2026-10-03T09:00:00Z',
    scheduled_off_duty_end: '2026-10-10T09:00:00Z',
    scheduled_off_duty_recurring: true,
  }), /PENNSYNC_DUTY_SCHEDULE_TOO_LONG/);
  const ok = await set(CLINICIAN_A, A, {
    scheduled_off_duty_start: '2026-10-03T09:00:00Z',
    scheduled_off_duty_end: '2026-10-10T08:59:00Z',
    scheduled_off_duty_recurring: true,
  });
  assert.equal(ok.success, true);
  // And the bound is the RECURRING one only: a one-off month off is allowed
  // there and has to be allowed here.
  const long = await set(CLINICIAN_A, A, {
    scheduled_off_duty_start: '2026-10-03T09:00:00Z',
    scheduled_off_duty_end: '2026-11-03T09:00:00Z',
    scheduled_off_duty_recurring: false,
  });
  assert.equal(long.success, true);
});

test('an impossible date is refused as a date, not stored as one PostgreSQL rounded', async () => {
  // D38's reason for parsing text rather than taking a timestamptz parameter:
  // the driver would decide what this means before the contract saw it.
  assert.match(await refuse(CLINICIAN_A, A, {
    scheduled_off_duty_start: '2026-02-31T09:00:00Z',
    scheduled_off_duty_end: '2026-03-05T09:00:00Z',
  }), /PENNSYNC_DUTY_SCHEDULE_INVALID/);
  assert.match(await refuse(CLINICIAN_A, A, {
    scheduled_off_duty_start: 'next tuesday', scheduled_off_duty_end: '2026-03-05T09:00:00Z',
  }), /PENNSYNC_DUTY_SCHEDULE_INVALID/);
});

test('PostgreSQL\'s eight special time literals are refused, because `new Date` refuses them', async () => {
  // This is the one direction `::timestamptz` is WIDER than the original's
  // parser, and both halves of it are real. `infinity` persists a window that
  // never ends; `today` and its neighbours persist one that means something
  // different every day it is read — and the webhooks read this window live,
  // so a context-dependent value would answer a caller differently tomorrow
  // with nothing in the row having changed. Every one of them is `NaN` to
  // `new Date()` and refused by the original.
  for (const literal of [
    'infinity', '+infinity', '-infinity', 'INFINITY', '  infinity  ',
    'now', 'today', 'tomorrow', 'yesterday', 'epoch', 'allballs',
  ]) {
    assert.match(await refuse(CLINICIAN_A, A, {
      scheduled_off_duty_start: literal,
      scheduled_off_duty_end: '2026-10-05T09:00:00Z',
    }), /PENNSYNC_DUTY_SCHEDULE_INVALID/, `${JSON.stringify(literal)} as a start`);
    assert.match(await refuse(CLINICIAN_A, A, {
      scheduled_off_duty_start: '2026-10-03T09:00:00Z',
      scheduled_off_duty_end: literal,
    }), /PENNSYNC_DUTY_SCHEDULE_INVALID/, `${JSON.stringify(literal)} as an end`);
  }
});

test('the recurrence flag follows JAVASCRIPT truthiness, not a boolean cast', async () => {
  // The original writes `!!scheduled_off_duty_recurring`, and `::boolean`
  // disagrees with it in both directions: the strings "false" and "0" are
  // truthy in JavaScript and false to PostgreSQL, while an object or an array
  // makes the cast raise instead of answering. The week bound reads this
  // value, so the disagreement decides whether a window is refused.
  for (const truthy of ['false', '0', 'no', {}, [], 'x', 1, -1, 0.5]) {
    assert.match(await refuse(CLINICIAN_A, A, {
      scheduled_off_duty_start: '2026-10-03T09:00:00Z',
      scheduled_off_duty_end: '2026-10-10T09:00:00Z',
      scheduled_off_duty_recurring: truthy,
    }), /PENNSYNC_DUTY_SCHEDULE_TOO_LONG/, `${JSON.stringify(truthy)} is truthy`);
  }
  for (const falsy of [false, 0, '', null]) {
    const answer = await set(CLINICIAN_A, A, {
      scheduled_off_duty_start: '2026-10-03T09:00:00Z',
      scheduled_off_duty_end: '2026-10-10T09:00:00Z',
      scheduled_off_duty_recurring: falsy,
    });
    assert.equal(answer.success, true, `${JSON.stringify(falsy)} is falsy`);
    assert.equal(answer.scheduled_off_duty_recurring, false,
      `${JSON.stringify(falsy)} is stored as false, the way \`!!x\` stores it`);
  }
  // And a truthy non-boolean is STORED as true rather than raising.
  const stored = await set(CLINICIAN_A, A, { scheduled_off_duty_recurring: 'false' });
  assert.equal(stored.scheduled_off_duty_recurring, true);
});

/* ------------------------------------------------------- the off-duty message */

test('the message is sanitized on WRITE, in the original\'s own order', async () => {
  // It is spoken to callers by TTS and sent as an SMS auto-reply, which is why
  // the original sanitizes going in rather than coming out. Stripping the
  // angle brackets FIRST means a control character between them survives as a
  // space rather than being eaten with them, so the input below distinguishes
  // the two orders.
  const answer = await set(CLINICIAN_A, A, { off_duty_message: 'Away <break\u0007time="2s"> back soon' });
  assert.equal(answer.off_duty_message, 'Away break time="2s" back soon');
});

test('the message cap folds UTF-16 code units, as slice(0, 320) does', async () => {
  // Divergence 4. An astral character costs two units there and one character
  // here, so a naive `left(x, 320)` would store 320 emoji where the original
  // stores 160 — a widening, in a field that is read aloud to callers.
  const answer = await set(CLINICIAN_A, A, { off_duty_message: '\u{1F600}'.repeat(400) });
  assert.equal([...answer.off_duty_message].length, 160);
  assert.equal(answer.off_duty_message.length, 320, 'the cap did not count code units');
  // And the plain case still counts characters, because there they agree.
  const plain = await set(CLINICIAN_A, A, { off_duty_message: 'a'.repeat(400) });
  assert.equal(plain.off_duty_message.length, 320);
});

test('a message whose cut falls inside a surrogate pair drops the character whole', async () => {
  // The one respect in which the cap is not byte-exact, and a narrowing:
  // PostgreSQL will not store a lone surrogate, so 319 units of text followed
  // by an emoji ends at 319 rather than at a half character.
  const answer = await set(CLINICIAN_A, A, { off_duty_message: `${'a'.repeat(319)}\u{1F600}b` });
  assert.equal(answer.off_duty_message.length, 319);
  assert.ok(!/[\uD800-\uDFFF]/.test(answer.off_duty_message), 'a lone surrogate was stored');
});

test('a non-string message is refused rather than coerced', async () => {
  assert.match(await refuse(CLINICIAN_A, A, { off_duty_message: 42 }),
    /PENNSYNC_DUTY_MESSAGE_INVALID/);
});

test('null clears the message and absent leaves it', async () => {
  await set(CLINICIAN_A, A, { off_duty_message: 'Back Monday' });
  const cleared = await set(CLINICIAN_A, A, { off_duty_message: null });
  assert.equal(cleared.off_duty_message, null);
});

/* ------------------------------------------------------------------ the trail */

test('the write and its audit entry are one transaction', async () => {
  // D37's reading: the original writes `UserActivity` behind a `.catch(() => {})`,
  // which is a compensation for two round trips. Here neither half can exist
  // without the other, so there is no `audit_recorded` flag to report (D53).
  const before = await db.query(
    `select count(*)::int as n from ${SCHEMA}."activity_audit" where "action" = $1`,
    ['duty_status_changed']);
  await set(CLINICIAN_A, A, { duty_status: 'on_duty' });
  const after = await db.query(
    `select "actor_user_id","subject_kind","subject_id","detail" from ${SCHEMA}."activity_audit"
     where "action" = $1 order by "occurred_at" desc, "id" desc limit 1`, ['duty_status_changed']);
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0].actor_user_id, bid(CLINICIAN_A));
  assert.equal(after.rows[0].subject_kind, 'user');
  assert.equal(after.rows[0].subject_id, bid(CLINICIAN_A));
  assert.equal(after.rows[0].detail.duty_status, 'on_duty');
  const { rows } = await db.query(
    `select count(*)::int as n from ${SCHEMA}."activity_audit" where "action" = $1`,
    ['duty_status_changed']);
  assert.equal(rows[0].n, before.rows[0].n + 1);
});

test('the trail names recurrence only when this call WROTE recurrence', async () => {
  // The original records `update.scheduled_off_duty_recurring`, which is
  // `undefined` unless the field was supplied or a window was cleared, and
  // `JSON.stringify` drops an undefined value rather than storing it. Reading
  // the row's standing value instead would make a duty-status-only change read
  // as though recurrence took part in it — a false entry in a compliance trail,
  // which is the thing D42 says is worse than an absent one.
  const detail = async () => (await db.query(
    `select "detail" from ${SCHEMA}."activity_audit" where "action" = $1
     order by "occurred_at" desc, "id" desc limit 1`, ['duty_status_changed'])).rows[0].detail;

  await set(CLINICIAN_A, A, {
    scheduled_off_duty_start: '2026-10-03T09:00:00Z',
    scheduled_off_duty_end: '2026-10-05T09:00:00Z',
    scheduled_off_duty_recurring: true,
  });
  assert.equal((await detail()).scheduled_off_duty_recurring, true,
    'supplied, so it is recorded');

  await set(CLINICIAN_A, A, { duty_status: 'off_duty' });
  assert.ok(!('scheduled_off_duty_recurring' in await detail()),
    'not supplied and nothing cleared, so the key is absent rather than restated');

  // Clearing the window writes recurrence without the caller naming it, so the
  // key IS present — the original's `if (clearingSchedule)` puts it in `update`.
  await set(CLINICIAN_A, A, {
    scheduled_off_duty_start: null, scheduled_off_duty_end: null,
  });
  assert.equal((await detail()).scheduled_off_duty_recurring, false,
    'clearing writes recurrence, so the entry says so');
});

test('a refused write leaves no audit entry behind', async () => {
  const before = await db.query(
    `select count(*)::int as n from ${SCHEMA}."activity_audit" where "action" = $1`,
    ['duty_status_changed']);
  await refuse(CLINICIAN_A, A, { duty_status: 'on_call' });
  const { rows } = await db.query(
    `select count(*)::int as n from ${SCHEMA}."activity_audit" where "action" = $1`,
    ['duty_status_changed']);
  assert.equal(rows[0].n, before.rows[0].n);
});

test('the trail carries no name, because the carried table has no name column', async () => {
  // Divergence 3. The original stamps `user.full_name`; the carried table has
  // no such column, which is what this test pins. It does NOT pin that the
  // store holds no name — `pennsync_private.staff_name` does, under a policyless
  // force-RLS table and the real-names hold — so read the absence as local to
  // this table. What makes the trail's silence independent of that hold is
  // D25: it stamps its actor from the caller helpers and refuses a payload
  // naming one, so there is nothing to pass either way.
  const { rows } = await db.query(
    `select "detail" from ${SCHEMA}."activity_audit" where "action" = $1
     order by "occurred_at" desc, "id" desc limit 1`, ['duty_status_changed']);
  assert.ok(!('user_name' in rows[0].detail), 'the trail carries a name it cannot have');
  const { rows: columns } = await db.query(
    `select 1 from information_schema.columns
     where table_schema = $1 and table_name = 'user' and column_name = 'full_name'`, [SCHEMA]);
  assert.equal(columns.length, 0, 'the carried profile gained a name column; re-read divergence 3');
});

/* ------------------------------------------- what the original still says today */

test('the original\'s constants are read from the original, not retyped', async () => {
  // D12's discipline. Each of these is a number or a pair this contract
  // reproduces, and a change upstream should fail here rather than pass
  // quietly against a copy.
  const source = readFileSync(ORIGINAL, 'utf8');
  assert.match(source, /\['on_duty', 'off_duty'\]\.includes\(duty_status\)/,
    'the duty_status pair moved');
  assert.match(source, /const WEEK_MS = 7 \* 24 \* 60 \* 60 \* 1000;/, 'the recurring bound moved');
  assert.match(source, /e - s >= WEEK_MS/, 'the recurring bound changed direction');
  assert.match(source, /\.replace\(\/\[<>\]\/g, ""\)\.replace\(\/\[\\u0000-\\u001F\\u007F\]\/g, " "\)\.slice\(0, 320\)/,
    'the sanitizer or its order moved');
  assert.match(source, /if \(!isProtectedSuperAdmin\(user\)\) \{/,
    'the target leg\'s gate moved; the refusal above is keyed to it being the platform tier');
});

test('the migration refuses to install on a store without D82', async () => {
  // The contract carries no ownership check because the policy does. A store
  // missing the policy would accept every write this makes and enforce
  // nothing, so the migration refuses rather than running unbound. Proved by
  // dropping the policy in a fresh store and re-applying this file.
  const scratch = new PGlite();
  try {
    await scratch.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      await scratch.exec(await readFile(new URL(name, dir), 'utf8'));
    }
    await applyRecordMigrations(scratch, { omit: [DUTY_NAME] });
    await scratch.exec(`drop policy "user_update" on ${SCHEMA}."user"`);
    await assert.rejects(scratch.exec(readFileSync(DUTY, 'utf8')),
      /PENNSYNC_PROFILE_SELF_WRITE_REQUIRED/);
  } finally { await scratch.close(); }
});
