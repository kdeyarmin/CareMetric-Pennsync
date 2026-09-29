import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { OWNER_ROLE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations } from './record-migrations.mjs';

/**
 * The general activity trail (D25).
 *
 * Its whole value is that it cannot be rewritten, so most of what is under
 * test is what the table REFUSES — including to the record owner, which
 * `force row level security` binds exactly as it binds a caller. A trail that
 * can be edited is a log, and a log is not evidence of anything.
 *
 * The second claim worth proving is that a capability cannot attribute its
 * action to somebody else. The actor is stamped from the caller helpers, so
 * the test tries to supply one and checks the stored row rather than the
 * return value.
 */
// The migration this capability is declared in. It is named because the
// comparison below derives the capability's functions from this file's own
// `create function` headers (D148) — not to decide what gets applied, which is
// `applyRecordMigrations`'s job reading the directory. A hand-kept build is what
// left a forward migration over this contract unapplied unless somebody
// remembered to add it (D88), and the audit trail is the worst place for that
// gap: what it proves is that the table REFUSES a rewrite to everyone including
// its owner, and a forward granting an update policy is exactly the shape that
// would slip past a three-file build.
const AUDIT_MIGRATION = '20260920010000_activity_audit.sql';
/**
 * Every `schema.function` the audit migration DECLARES, read out of its own
 * `create function` headers (D148). Two tests need it and neither may keep a
 * second copy: a hand-written list of the four is the same transcription a
 * `proname like '%activity_%'` pattern is, one step further from the source.
 */
let declared;
let applied;
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** 1 is agency_admin in agency-a, 2 a clinician there, 4 agency_admin in agency-b. */
const ADMIN_A = 1; const CLINICIAN_A = 2; const ADMIN_B = 4;
const EMAIL = { 1: 'admin-a@example.invalid', 2: 'clinician-a@example.invalid' };
const A = 'agency-a'; const B = 'agency-b';
const APPEND = 'select "public"."pennsync_contract_activity_append"($1,$2,$3,$4,$5) as id';
const LIST = 'select "public"."pennsync_contract_activity_list"($1,$2,$3) as result';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  applied = await applyRecordMigrations(db);
  const auditSql = await readFile(
    new URL(`../supabase/record-migrations/${AUDIT_MIGRATION}`, import.meta.url), 'utf8');
  declared = [...auditSql.matchAll(
    /^create (?:or replace )?function\s+"?([a-z_]+)"?\.\s*"?([a-z_]+)"?\s*\(/gmi)]
    .map(([, schema, name]) => `${schema}.${name}`).sort();
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    return rows;
  } finally { await db.exec('rollback'); }
}
/** Kept open, so an appended row can be read back inside the same transaction. */
async function session(n, run) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    return await run(async (sql, params = []) => (await db.query(sql, params)).rows);
  } finally { await db.exec('rollback'); }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);

test('any member may append, and the actor is stamped rather than supplied', async () => {
  await session(CLINICIAN_A, async (run) => {
    // A clinician, not an administrator: every capability audits as it works.
    const [{ id }] = await run(APPEND, [A, 'patient.viewed', 'patient', 'patient-a1', { note: 'chart opened' }]);
    assert.match(id, /^[0-9a-f]{32}$/);
    // That a clinician may not READ is proved below, against the refusal the
    // contract raises. Catching the error here and checking only that something
    // failed would pass on any failure at all, including the append's.
  });
  // Read it back as the administrator, who may.
  await session(ADMIN_A, async (run) => {
    await run(APPEND, [A, 'patient.viewed', 'patient', 'patient-a1', { note: 'chart opened' }]);
    const [{ result }] = await run(LIST, [A, 100, null]);
    assert.equal(result.entries.length, 1);
    const [entry] = result.entries;
    assert.equal(entry.action, 'patient.viewed');
    assert.equal(entry.subject_kind, 'patient');
    assert.equal(entry.subject_id, 'patient-a1');
    assert.equal(entry.agency_id, A);
    assert.equal(entry.source_app_id, APP);
    // Stamped from the caller helpers, which is the one thing an audit trail
    // must refuse to take from the caller.
    assert.equal(entry.actor_email, EMAIL[ADMIN_A]);
    assert.ok(entry.actor_user_id && entry.occurred_at);
  });
});

test('the trail cannot be rewritten or removed, by anyone, including its owner', async () => {
  // The append-only guarantee is the absence of an update or delete policy, and
  // `force row level security` binds the owner too. If either policy were added
  // by accident this is the assertion that fails.
  const { rows: policies } = await db.query(`
    select cmd from pg_catalog.pg_policies where schemaname = $1 and tablename = 'activity_audit'`, [SCHEMA]);
  assert.deepEqual(policies.map(row => row.cmd).sort(), ['INSERT', 'SELECT']);

  // Seeded as the migration administrator so a row exists to attack.
  await db.query(`insert into ${SCHEMA}."activity_audit"
    ("source_app_id","id","agency_id","occurred_at","actor_user_id","actor_email","action")
    values ($1,'audit-a1',$2, now(), 'u-1', $3, 'seeded')`, [APP, A, EMAIL[ADMIN_A]]);
  try {
    for (const statement of [
      `update ${SCHEMA}."activity_audit" set "action" = 'rewritten' where "id" = 'audit-a1'`,
      `delete from ${SCHEMA}."activity_audit" where "id" = 'audit-a1'`,
    ]) {
      // As a caller.
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
          sub: uid(ADMIN_A), session_id: sid(ADMIN_A), role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })]);
        await db.exec('set local role authenticated');
        await assert.rejects(db.query(statement), 'a caller must not rewrite the trail');
      } finally { await db.exec('rollback'); }

      // And as the record owner, which the policies bind exactly as they bind
      // a caller. An owner that could edit the trail would make it worthless.
      await db.exec('begin');
      try {
        await db.exec(`set local role ${OWNER_ROLE}`);
        const { rows } = await db.query(statement.replace(/^(update|delete)/, '$1')
          .replace(/$/, ' returning "id"')).catch(() => ({ rows: [] }));
        assert.deepEqual(rows, [], `${OWNER_ROLE} must not be able to change an audit row`);
      } finally { await db.exec('rollback'); }
    }
    // Still there, unchanged.
    const { rows } = await db.query(`select "action" from ${SCHEMA}."activity_audit" where "id" = 'audit-a1'`);
    assert.deepEqual(rows, [{ action: 'seeded' }]);
  } finally {
    await db.query(`delete from ${SCHEMA}."activity_audit" where "id" = 'audit-a1'`);
  }
});

test('an agency the caller does not hold is refused, and the trail stays inside one', async () => {
  await refusal(as(ADMIN_A, APPEND, [B, 'x.y', null, null, null]), 'PENNSYNC_AUDIT_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_A, LIST, [B, 100, null]), 'PENNSYNC_AUDIT_AGENCY_NOT_HELD');
  await refusal(as(ADMIN_B, LIST, [A, 100, null]), 'PENNSYNC_AUDIT_AGENCY_NOT_HELD');
  for (const agency of [null, '', 'no-such-agency']) {
    await refusal(as(ADMIN_A, APPEND, [agency, 'x.y', null, null, null]), 'PENNSYNC_AUDIT_AGENCY_NOT_HELD');
  }
  // Two agencies, one trail each.
  await session(ADMIN_A, async (run) => {
    await run(APPEND, [A, 'a.happened', null, null, null]);
    const [{ result }] = await run(LIST, [A, 100, null]);
    assert.ok(result.entries.every(entry => entry.agency_id === A));
  });
});

test('the trail reads newest first and pages without repeating or skipping a row', async () => {
  await session(ADMIN_A, async (run) => {
    // Nine entries, appended in order. They land microseconds apart and some
    // may share a timestamp, which is exactly the case the id tiebreaker is in
    // the key for.
    for (let n = 1; n <= 9; n += 1) await run(APPEND, [A, `step.${n}`, null, null, null]);
    const [{ result: all }] = await run(LIST, [A, 100, null]);
    assert.equal(all.entries.length, 9);
    // Newest first. Ordered by the random id instead, this passes only by
    // chance — which is why it is asserted rather than eyeballed.
    const times = all.entries.map(entry => entry.occurred_at);
    assert.deepEqual(times, [...times].sort().reverse());
    // TIE-AWARE, and it has to be. This asserted `entries[0].action` was
    // 'step.9' and CI caught it being 'step.8' once in nine runs: two appends
    // landed in the same microsecond, and the contract's own header says the
    // id is in the key as a TIEBREAKER FOR PAGING — it is a random uuid, so
    // which of a tied pair sorts first is a coin flip and cannot be asserted.
    // What the ordering does guarantee is the timestamp, so the newest append
    // is among the newest-stamped entries and the first is among the oldest.
    // Do not tighten this back without giving the table a monotonic column.
    const at = instant => all.entries.filter(entry => entry.occurred_at === instant)
      .map(entry => entry.action);
    assert.ok(at(times[0]).includes('step.9'), `newest group was ${at(times[0])}`);
    assert.ok(at(times[8]).includes('step.1'), `oldest group was ${at(times[8])}`);
    // And every append is present exactly once, which is what the two row
    // assertions were standing in for.
    assert.deepEqual(all.entries.map(entry => entry.action).sort(),
      Array.from({ length: 9 }, (unused, index) => `step.${index + 1}`).sort());
    // A full page carries a cursor; the last page does not, because a cursor
    // there invites a round trip that can only come back empty.
    assert.equal(all.next, null);

    // Walk it in threes and prove the walk is exactly the whole trail: every
    // row once, in the same order.
    const walked = [];
    let cursor = null;
    for (let page = 0; page < 5; page += 1) {
      const [{ result }] = await run(LIST, [A, 3, cursor]);
      walked.push(...result.entries.map(entry => entry.id));
      cursor = result.next;
      if (!cursor) break;
    }
    assert.deepEqual(walked, all.entries.map(entry => entry.id), 'the walk must be the trail, in order');
    assert.equal(new Set(walked).size, 9, 'no row may appear twice');
    assert.equal(cursor, null, 'the walk must terminate');
  });
});

test('two rows sharing an instant still page exactly once, in either order', async () => {
  // The tie the test above must NOT assert a position for, forced rather than
  // waited for: a microsecond collision is rare enough that CI hit it once in
  // nine runs and this machine does not reproduce it at all. Written directly
  // so the case is deterministic.
  //
  // What the contract guarantees for a tie is the keyset, not the display
  // order — `(occurred_at, id)` is total, so the walk is exact; `id` is a
  // random uuid, so WHICH of the pair is first is a coin flip. Both are
  // asserted here, and that is the whole shape of the bug in the test above.
  const instant = '2026-06-15T12:00:00.000000Z';
  for (const [id, action] of [['a'.repeat(32), 'tied.one'], ['b'.repeat(32), 'tied.two']]) {
    await db.query(`insert into ${SCHEMA}."activity_audit"("source_app_id","id","agency_id",
      "occurred_at","actor_user_id","actor_email","action")
      values ($1,$2,$3,$4::timestamptz,'actor-1','a@example.invalid',$5)`,
    [APP, id, A, instant, action]);
  }
  try {
    await session(ADMIN_A, async (run) => {
      const [{ result: all }] = await run(LIST, [A, 100, null]);
      const tied = all.entries.filter(entry => entry.action.startsWith('tied.'));
      assert.equal(tied.length, 2, 'both tied rows are returned');
      assert.equal(tied[0].occurred_at, tied[1].occurred_at, 'they really do share an instant');
      // Either order is correct. Asserting one would be asserting a coin flip.
      assert.deepEqual(tied.map(entry => entry.action).sort(), ['tied.one', 'tied.two']);
      // The timestamps still descend across the whole trail.
      const times = all.entries.map(entry => entry.occurred_at);
      assert.deepEqual(times, [...times].sort().reverse());
      // And a walk in ONES crosses the tie without repeating or skipping —
      // which is what the id is in the key for.
      const walked = [];
      let cursor = null;
      for (let page = 0; page < all.entries.length + 2; page += 1) {
        const [{ result }] = await run(LIST, [A, 1, cursor]);
        walked.push(...result.entries.map(entry => entry.id));
        cursor = result.next;
        if (!cursor) break;
      }
      assert.deepEqual(walked, all.entries.map(entry => entry.id),
        'the walk must be the trail, in order, across the tie');
      assert.equal(new Set(walked).size, walked.length, 'no row may appear twice');
    });
  } finally {
    await db.query(`delete from ${SCHEMA}."activity_audit" where "action" like 'tied.%'`);
  }
});

test('a cursor nobody can parse is refused rather than read as the beginning', async () => {
  // Silently returning page one to a caller asking for page nine repeats rows
  // an auditor has already read, and looks like duplicated activity.
  //
  // One transaction per case, because a refusal aborts the one it was raised
  // in — which the shared session helper would then carry into every case
  // after it, reporting them all as passing for the wrong reason.
  for (const cursor of ['', 'nonsense', '|', 'x|y', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z|',
    '2026-09-20T00:00:00Z|nothex', `2026-09-20T00:00:00Z|${'f'.repeat(31)}`,
    `not-a-time|${'f'.repeat(32)}`]) {
    await refusal(as(ADMIN_A, LIST, [A, 100, cursor]), 'PENNSYNC_AUDIT_CURSOR_INVALID');
  }
  // And a well-formed one is not, even when it matches nothing. The cursor asks
  // for entries older than 1999, so this answers empty whatever the trail holds.
  const [{ result }] = await as(ADMIN_A, LIST, [A, 100, `1999-01-01T00:00:00Z|${'0'.repeat(32)}`]);
  assert.deepEqual(result.entries, []);
  assert.equal(result.next, null);
});

test('reading the trail is an administrative act', async () => {
  await refusal(as(CLINICIAN_A, LIST, [A, 100, null]), 'PENNSYNC_AUDIT_FORBIDDEN');
  // And appending is not, which is the point: the clinician above wrote fine.
  await session(CLINICIAN_A, async (run) => {
    assert.match((await run(APPEND, [A, 'visit.saved', 'visit', 'v-1', null]))[0].id, /^[0-9a-f]{32}$/);
  });
});

test('a malformed entry is refused rather than stored badly', async () => {
  for (const action of [null, '', 'x'.repeat(121)]) {
    await refusal(as(ADMIN_A, APPEND, [A, action, null, null, null]), 'PENNSYNC_AUDIT_ACTION_INVALID');
  }
  // A subject is a pair or it is nothing; half of one names something nobody
  // can look up.
  await refusal(as(ADMIN_A, APPEND, [A, 'x.y', 'patient', null, null]), 'PENNSYNC_AUDIT_SUBJECT_INVALID');
  await refusal(as(ADMIN_A, APPEND, [A, 'x.y', null, 'patient-a1', null]), 'PENNSYNC_AUDIT_SUBJECT_INVALID');
  for (const detail of ['"text"', '[]', '5']) {
    await refusal(as(ADMIN_A, APPEND, [A, 'x.y', null, null, detail]), 'PENNSYNC_AUDIT_DETAIL_INVALID');
  }
  // Refused, not truncated: a shortened audit entry looks complete.
  const huge = JSON.stringify({ blob: 'x'.repeat(9000) });
  await refusal(as(ADMIN_A, APPEND, [A, 'x.y', null, null, huge]), 'PENNSYNC_AUDIT_DETAIL_TOO_LARGE');
});

test('a session with no identity writes nothing', async () => {
  await db.exec('begin');
  try {
    await db.exec("select set_config('request.jwt.claims', null, true)");
    await db.exec('set local role authenticated');
    await refusal(db.query(APPEND, [A, 'x.y', null, null, null]), 'PENNSYNC_AUDIT_AGENCY_NOT_HELD');
  } finally { await db.exec('rollback'); }
});

test('no caller role reaches the table, only the two contracts', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const { rows } = await db.query(`
      select has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE') as reachable`,
    [role, `${SCHEMA}.activity_audit`]);
    assert.equal(rows[0].reachable, false, `${role} must not reach the audit table directly`);
  }
  // TWO CLAIMS, TWO POPULATIONS, and which line carries which is written down
  // (D151). This block used to make both with one `proname like '%activity_%'`
  // query compared against a hand-written list of the four names, which reads as
  // a single strong assertion and is two weak ones: the pattern decided what the
  // capability IS, and the literal list was a third copy of the migration's own
  // headers. The pattern matches exactly those four in today's directory, so it
  // passed — that is the trap rather than the justification (D148).
  //
  // 1. THE CAPABILITY IS REACHABLE. Population derived from the migration's own
  //    `create function` headers, so a function added to this capability upstream
  //    joins the claim with nobody widening anything, and a rename fails here.
  const reachable = async names => {
    const { rows } = await db.query(`
      select n.nspname || '.' || p.proname as name
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname || '.' || p.proname = any($1::text[])
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')`, [names]);
    return rows.map(row => row.name).sort();
  };
  assert.deepEqual(await reachable(declared), declared,
    'every function the audit migration declares must be callable by a caller');

  // 2. NOTHING ELSE IN THE NEIGHBOURHOOD IS. Here a pattern is the RIGHT
  //    instrument, because the question genuinely is about the neighbourhood
  //    rather than about this capability — so it is asserted as a set DIFFERENCE
  //    against the derived set, never against a literal. A later migration that
  //    adds a reachable `activity_` function fails this line and not the one
  //    above, which is the point of splitting them.
  const { rows: neighbourhood } = await db.query(`
    select n.nspname || '.' || p.proname as name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any(array['pennsync_records', 'public'])
      and p.proname like '%activity_%'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  assert.deepEqual(
    neighbourhood.map(row => row.name).sort().filter(name => !declared.includes(name)), [],
    'no function beyond the ones this migration declares may be reachable');
});

test('the whole directory is applied, and it leaves this capability the surface the named build gave it', async () => {
  // D141's sibling and the reason this suite was converted. It used to build the
  // record store, the broker family and its own migration BY NAME, so a forward
  // migration over the audit trail reached it only if somebody remembered to add
  // the file — and what this suite proves is that the table refuses a rewrite to
  // everyone including its owner, which is exactly the kind of property a later
  // forward could relax with every suite green (D88).
  // PIN THE SET, NOT A LENGTH. `applied` is what the before hook really applied
  // to this database, compared against an independent `readdir` of the same
  // directory — not against `recordMigrationNames` again, which would be the
  // helper agreeing with itself. An inequality here (`applied.length >
  // MEASURED.length`) is the obvious way to write this and the wrong one: it is
  // satisfied by any build of four or more files, including one that silently
  // omits a migration this suite does not name, which is the whole defect the
  // conversion exists to close.
  const onDisk = (await readdir(new URL('../supabase/record-migrations/', import.meta.url)))
    .filter(file => file.endsWith('.sql')).sort();
  assert.deepEqual(applied, onDisk,
    'the walk must apply every record migration on disk, in apply order');
  // THAT LINE CARRIES THE WHOLE CLAIM, so the two that used to sit here are gone
  // rather than strengthened: a loop asserting each MEASURED name was applied,
  // and a `notDeepEqual` against MEASURED. Both are implied by the equality
  // above, so neither was doing anything except lending the reader confidence,
  // and keeping them would be one more thing that has to stay true. Ask whether a
  // line has a job before giving it teeth.
  //
  // This one does have a job, and it is not implied: the declaration derivation
  // below READS a migration file, and nothing otherwise says that file is one the
  // walk applied. Without it the comparison could faithfully describe a
  // capability declared in a file that never ran.
  assert.ok(onDisk.includes(AUDIT_MIGRATION),
    'the migration the capability is derived from must be one the walk applied');

  // D127's case here is NEITHER strong nor absorbing, measured rather than
  // assumed: of the five other record migrations naming `activity_audit` or
  // `contract_activity_append`, every one is a CALLER or a precondition guard
  // (`to_regprocedure(...) is null then` refuse) and not one creates, alters,
  // drops or re-policies the table or either function. So the swap changes
  // nothing observable today, which makes this an UNCHANGED figure — and an
  // unchanged figure needs a known-positive control as much as a zero does.
  // The comparison below is that control's subject, and the planted function is
  // the control: without it, an assertion that the surface did not widen passes
  // whether or not the comparison can see a widening at all.
  // D148. DERIVE THE COMPARED POPULATION FROM THE CAPABILITY'S OWN DECLARATIONS,
  // which removes the too-wide-or-too-narrow question rather than answering it. A
  // `proname like '%activity_%'` pattern matches exactly these four in today's
  // directory, so it would pass — and that is the trap, not a reason to keep it:
  // a pattern answers a question about the NEIGHBOURHOOD, and the asymmetry is
  // what makes it dangerous. Too wide fails loudly when a later migration adds a
  // matching function and somebody looks; too narrow passes quietly and nobody
  // does. Reading the migration's own `create function` headers means a function
  // added to this capability upstream joins the comparison with nobody widening
  // anything, and a renamed one fails here rather than vanishing from it.
  assert.equal(declared.length, 4,
    'the audit migration declares the two contracts and their two public wrappers');
  assert.ok(new Set(declared).size === declared.length, 'no declaration counted twice');

  const surface = async build => {
    const probe = new PGlite();
    try {
      await probe.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
      const dir = new URL('../supabase/migrations/', import.meta.url);
      for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
        await probe.exec(await readFile(new URL(name, dir), 'utf8'));
      }
      await build(probe);
      // `proname` alone is not the signature: PostgREST resolves an RPC by the
      // NAMES of the body's keys, so a parameter renamed consistently in SQL is
      // a different call shape and identical here without the identity args.
      const { rows } = await probe.query(`
        select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname || '.' || p.proname = any($1::text[])`, [declared]);
      return rows.map(row => `${row.nspname}.${row.proname}(${row.args})`).sort();
    } finally { await probe.close(); }
  };
  // The pre-conversion build, reproduced here as the comparison's other side: the
  // three files this suite used to name by hand. They are listed HERE, inside the
  // control, rather than as a module constant — the only thing that still needs
  // them is this comparison, and a constant at the top would read as a build list.
  const handKept = ['20260919170000_record_store.sql', '20260919180000_record_brokers.sql',
    AUDIT_MIGRATION];
  const named = await surface(async probe => {
    for (const name of handKept) {
      await probe.exec(await readFile(new URL(`../supabase/record-migrations/${name}`, import.meta.url), 'utf8'));
    }
  });
  const whole = await surface(probe => applyRecordMigrations(probe));
  assert.deepEqual(whole, named,
    'the directory walk must not widen or narrow the audit capability against the named build');
  assert.ok(named.length >= 4, 'the named build must actually produce the capability');

  // The control. A planted migration that adds one `activity_` function must
  // make that comparison fail; if it does not, the equality above is vacuous and
  // says nothing about the swap. Planted through the SAME code path the suites
  // use rather than by a second walk, so the two cannot agree with each other
  // while disagreeing with the helper.
  // The comparison is scoped to the capability's FOUR functions by name, not by a
  // `proname like '%activity_%'` pattern. The pattern happens to match exactly
  // those four in today's directory, so a pattern-scoped test would pass — and
  // that is the trap rather than a reason to keep it: a pattern answers a
  // question about the NEIGHBOURHOOD, and the asymmetry is what makes it
  // dangerous. Too wide fails loudly when a later migration adds a matching
  // function and somebody looks; too narrow passes quietly and nobody does.
  // Two known-positives below, because a scoped comparison and a comparison that
  // simply cannot see anything are the same green.
  //
  // A. A function added INSIDE the capability must be seen.
  const inside = await surface(async probe => {
    await applyRecordMigrations(probe);
    await probe.exec(`create function "${SCHEMA}"."contract_activity_list"(p_planted text)
      returns integer language sql immutable as $$ select 1 $$`);
  });
  assert.notDeepEqual(inside, named, 'the surface comparison must see an added overload');
  assert.equal(inside.length, named.length + 1);

  // B. The neighbourhood move. A function matching what a pattern would have
  // swept in, but NOT one of the four, must be INVISIBLE here — otherwise the
  // scoping is a comment rather than a control, and this comparison would report
  // a later migration's unrelated addition as a change to this capability.
  const beside = await surface(async probe => {
    await applyRecordMigrations(probe);
    await probe.exec(`create function "${SCHEMA}"."contract_activity_neighbour"(p_agency text)
      returns integer language sql immutable as $$ select 1 $$`);
  });
  assert.deepEqual(beside, named,
    'a matching function outside the capability must not read as a change to it');
});
