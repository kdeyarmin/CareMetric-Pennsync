import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

import {
  RECORD_MIGRATION_DIRECTORY, applyRecordMigrations,
} from './record-migrations.mjs';
import { maskPhone } from '../../../src/components/voice/phoneUtils.js';

/**
 * The roster's telecom keys (`20260920720000_roster_phone_provisioned.sql`).
 *
 * The CONTRACT behaviour — that the four keys are privileged-only and null
 * rather than absent for everybody else — is asserted in
 * `contract-roster.test.mjs`, beside the rest of the projection and over that
 * suite's lying-label fixtures. What is here is the three things that suite
 * cannot answer, each of which is about this file agreeing with something
 * OUTSIDE the store:
 *
 *   1. The projection is a LIFT of the one in
 *      `20260920630000_roster_display_name.sql` plus four keys, and not a
 *      thirty-key retype that could have drifted a column while adding them.
 *   2. `phone_masked` agrees with the browser's `maskPhone`, which is the
 *      function it ports, on inputs chosen to break a careless port.
 *   3. The presence booleans agree with the BROWSER's test, which is bare
 *      truthiness and not a trim.
 *
 * None of those needs a caller, an agency or a carried row, so this suite seeds
 * none and calls the functions directly as the record owner.
 */
const NAME = '20260920720000_roster_phone_provisioned.sql';
const LIFTED_FROM = '20260920630000_roster_display_name.sql';
/** Where the lifted tail begins in this file; the comment is the marker, by its own words. */
const TAIL_MARKER = '    -- Telecom provisioning, for the three admin screens that read it.';
/** The last key the lifted body ends on, whose closing paren the four new keys displace. */
const LIFT_SEAM = "    'ai_content_agreement_accepted',\n"
  + '      case when p_privileged then p_profile."ai_content_agreement_accepted" end';

let db;
/** The record migrations this suite's store was built from. */
let applied;

const read = name => readFile(new URL(name, RECORD_MIGRATION_DIRECTORY), 'utf8');

/**
 * The body of the LAST `roster_entry` definition in a migration's text.
 *
 * Deliberately the last rather than the only one: a forward file replacing the
 * projection could legitimately carry an earlier mention of it in a comment or
 * a drop, and taking the first match would then measure the wrong thing.
 */
function projectionBody(sql) {
  const parts = sql.split('$projection$');
  // `create ... as $projection$ BODY $projection$;` for each of this file's
  // functions, so the bodies are the odd-indexed parts. `roster_entry` is the
  // one whose body builds the object with `jsonb_build_object`.
  const bodies = parts.filter((_, index) => index % 2 === 1)
    .filter(body => body.includes('jsonb_build_object'));
  assert.equal(bodies.length, 1, 'expected exactly one roster_entry body to read');
  return bodies[0];
}

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  applied = await applyRecordMigrations(db);
  assert.ok(applied.includes(NAME), `${NAME} must be applied: this suite measures it`);
  // The guard RETIRED here, by the rule the comment it replaces states: this
  // migration has MERGED, so a later file sorting after it is a correct tree
  // rather than a base that moved. `20260920750000_oasis_schema_tables` is the
  // newest pending file and holds the call now.
  //
  // Nothing about this suite changed. Keeping the call would have failed this
  // `before` and taken every test in the file down with it, naming a migration
  // that had done nothing wrong — which is why the helper says to retire rather
  // than widen. What is kept is this suite's own property: that its migration
  // really was applied to the store it measures.
});
after(async () => db?.close());

/** Run as the record owner, which is the only role either function is granted to. */
async function asOwner(sql, params = []) {
  await db.exec('begin');
  try {
    await db.exec('set local role "pennsync_records_owner"');
    const { rows } = await db.query(sql, params);
    return rows;
  } finally { await db.exec('rollback'); }
}

test('the projection is the display-name one plus four keys, not a retype', async () => {
  const mine = projectionBody(await read(NAME));
  const lifted = projectionBody(await read(LIFTED_FROM));

  // The seam is read rather than assumed: if the older file stopped ending on
  // this key the reconstruction below would be measuring a coincidence.
  assert.ok(lifted.includes(`${LIFT_SEAM})`),
    `${LIFTED_FROM} must still end its projection on ai_content_agreement_accepted`);
  assert.ok(mine.includes(`${LIFT_SEAM},`),
    'this file must continue that key with a comma, which is the one edit the lift makes');

  const cut = mine.indexOf(TAIL_MARKER);
  assert.ok(cut > 0, 'the telecom block must be findable by its own opening comment');
  // Put back the paren the comma displaced and the two must be byte-identical.
  const reconstructed = `${mine.slice(0, cut).replace(/,\n$/, ')\n')}`;
  assert.equal(reconstructed, lifted,
    'everything above the telecom block must be byte-for-byte the projection it was '
    + `lifted from: re-lift it from ${LIFTED_FROM} rather than editing by hand`);

  // And the tail really is only the four keys, so "plus four" is measured in
  // both directions rather than only from the top.
  const added = [...mine.slice(cut).matchAll(/^ {4}'([a-z_]+)',/gm)].map(match => match[1]);
  assert.deepEqual(added,
    ['has_work_phone', 'has_personal_cell', 'work_phone_number', 'personal_cell_masked']);
});

/**
 * Inputs chosen so a careless port fails, not so the port passes.
 *
 * `(215) 555-0100` is the browser's own display format, which a mask must not
 * read as digits-with-punctuation differently from the way `maskPhone` does.
 * `+1 215 555 0100` is E.164 with separators, which is what the column actually
 * holds. `12` and `+1` are under four digits and reach the `••••` branch. `abc`
 * has no digits at all and reaches it too, which is the case a port that
 * returned the input unchanged would get wrong. `  ` is whitespace, which is
 * NOT empty for either function. And the astral and unicode-digit cases are the
 * two a regexp written as `\d` or a POSIX class would diverge on: PostgreSQL's
 * `[[:digit:]]` matches `٣` and JavaScript's `\d` does not, which is why the SQL
 * spells `[^0-9]` out.
 */
const MASK_CASES = Object.freeze([
  '+12155550100', '(215) 555-0100', '+1 215 555 0100', '215.555.0100',
  '0100', '12', '+1', 'abc', '  ', 'ext 4', '٣٤٥٦', '٣٤٥٦7890', '👍1234',
]);

test('phone_masked is the browser maskPhone, on every input but an absent one', async () => {
  for (const raw of MASK_CASES) {
    const [{ masked }] = await asOwner('select "pennsync_records".phone_masked($1) as masked', [raw]);
    assert.equal(masked, maskPhone(raw),
      `phone_masked(${JSON.stringify(raw)}) must equal the browser's maskPhone`);
  }
  // The ONE recorded divergence, asserted rather than left to be noticed: the
  // browser answers the literal string "unknown" for an absent number and this
  // answers null, because null is the projection's convention for a value that
  // is not there and "unknown" is a string a screen could print. The browser
  // never reaches its branch — its only call is guarded by the value's own
  // truthiness — so this narrows nothing a screen can see.
  for (const absent of [null, '']) {
    const [{ masked }] = await asOwner('select "pennsync_records".phone_masked($1) as masked', [absent]);
    assert.equal(masked, null, 'an absent number is null here');
    assert.equal(maskPhone(absent), 'unknown', 'and "unknown" in the browser; recorded divergence');
  }
  // A guard on the cases themselves: if every one of them hit `••••` this test
  // would pass while proving nothing about the digits that are revealed.
  const revealed = MASK_CASES.map(raw => maskPhone(raw)).filter(value => value !== '••••');
  assert.ok(revealed.length >= 6, `only ${revealed.length} cases reveal digits; widen MASK_CASES`);
});

/**
 * Call the real projection over a carried row the test plants.
 *
 * Through `roster_entry` and NOT through an expression this file writes out
 * again. A first version of this test asserted `coalesce($1,'') <> ''` against
 * JavaScript truthiness, which is a true statement about an expression and says
 * nothing about the migration: adding `btrim` to the projection left it green.
 * That is the shape the whole file is written against — a test whose comment
 * describes something the test does not do reads exactly like one that works —
 * and only sabotaging the migration told them apart.
 */
async function entryFor({ work = null, cell = null }, privileged = true) {
  await db.exec('begin');
  try {
    // Planted and read as the bootstrap superuser rather than as the record
    // owner, because `pennsync_records."user"` is FORCE RLS with a read policy
    // and NO write policy at all (D23) — a write refuses for the owner too, by
    // design. `roster_entry` is an immutable SQL function that reaches no table,
    // so nothing about this call depends on the caller's role; who may CALL it
    // is the ACL test's question and is asked there.
    await db.query(`insert into "pennsync_records"."user"
      ("source_app_id","id","work_phone_number","personal_cell_e164")
      values ('6a9881683dc68a0bd54f1ef7','probe',$1,$2)`, [work, cell]);
    const { rows } = await db.query(`select "pennsync_records".roster_entry(
      'auth-id','probe@example.invalid','Synthetic Probe','agency-a','Synthetic Agency A',
      'clinician', true, u, $1) as entry
      from "pennsync_records"."user" u where u."id" = 'probe'`, [privileged]);
    assert.equal(rows.length, 1, 'the planted row must be readable to be projected');
    return rows[0].entry;
  } finally { await db.exec('rollback'); }
}

test('the presence booleans are the browser test, which does not trim', async () => {
  // `TelnyxSetupProgress.jsx:125-126` and `phoneAnalytics.js:99-100` both filter
  // on the bare value — `users.filter((u) => u.work_phone_number)` — so a space
  // is PRESENT for them. A `btrim` in the projection would make the store
  // stricter than the screen it answers, and the two would then disagree about
  // whether a nurse is provisioned.
  //
  // `'0'` is the case worth planting rather than reading: it is truthy as a
  // STRING in JavaScript and falsy as a number, so a port that coerced would get
  // it wrong in the one direction nothing else here catches.
  for (const raw of [null, '', ' ', '   ', '\t', '0', '+12155550100', 'anything']) {
    const entry = await entryFor({ work: raw, cell: raw });
    assert.equal(entry.has_work_phone, !!raw,
      `has_work_phone for ${JSON.stringify(raw)} must match JavaScript truthiness`);
    assert.equal(entry.has_personal_cell, !!raw,
      `has_personal_cell for ${JSON.stringify(raw)} must match JavaScript truthiness`);
  }
});

test('the projection carries the work line in full and the cell masked', async () => {
  const entry = await entryFor({ work: '+12155550100', cell: '+12155550199' });
  assert.equal(entry.work_phone_number, '+12155550100',
    'the work line is a number the product assigns and the panel prints in full');
  assert.equal(entry.personal_cell_masked, '(•••) •••-0199');
  assert.equal(entry.personal_cell_masked, maskPhone('+12155550199'),
    'and it is the browser mask, so the panel shows the same digits either way');
  // The full cell reaches no key under any name. Asserted over the whole object
  // rather than the keys this file happens to know about, because the point is
  // that it is NOWHERE.
  assert.ok(!JSON.stringify(entry).includes('5550199'),
    'the full personal cell must not appear in the projection at all');
  assert.ok(JSON.stringify(entry).includes('5550100'),
    'and the work line must, which is what makes the line above a real check');

  const absent = await entryFor({});
  assert.deepEqual(
    [absent.has_work_phone, absent.has_personal_cell,
      absent.work_phone_number, absent.personal_cell_masked],
    [false, false, null, null],
    'a nurse with neither number is NOT provisioned, and neither value is a string');
});

test('all four keys are privileged-only, and null rather than absent', async () => {
  // The same reason the six administrative keys beside them are: the shape must
  // not tell a handler which kind of caller it is serving. Both rendering panels
  // gate on `isAdminLike`, whose whole body is `role === "admin"` — the platform
  // tier D14 and D22 removed — so the successor audience is D40's `agency_admin`
  // scoped to their own agency, which the contract's own gate decides.
  const entry = await entryFor({ work: '+12155550100', cell: '+12155550199' }, false);
  for (const key of ['has_work_phone', 'has_personal_cell',
    'work_phone_number', 'personal_cell_masked']) {
    assert.ok(Object.hasOwn(entry, key), `${key} must still be present for an ordinary caller`);
    assert.equal(entry[key], null, `${key} must not reach an ordinary caller`);
  }
  // And the working roster survives, so this is a narrowing of personnel detail
  // and not of the projection.
  assert.equal(entry.email, 'probe@example.invalid');
  assert.equal(entry.tenant_role, 'clinician');
});

test('phone_masked is reachable by nobody but the record owner', async () => {
  // A NEW function gets EXECUTE for PUBLIC by default, which is how the nine
  // helpers in `20260920650000_revoke_nonauthorizing_helpers.sql` came to be
  // reachable. Asserted per role rather than by reading the revoke statement
  // back out of the file it is written in.
  const SIGNATURE = 'pennsync_records.phone_masked(text)';
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const { rows: [{ allowed }] } = await db.query(
      "select pg_catalog.has_function_privilege($1, $2, 'execute') as allowed",
      [role, SIGNATURE]);
    assert.equal(allowed, false, `${role} must not reach phone_masked`);
  }
  // PUBLIC is a pseudo-role and `has_function_privilege` has no name for it, so
  // its grant is read off the ACL, where an aclitem with an EMPTY grantee is
  // the PUBLIC one. A null `proacl` means the default is still in force, which
  // for a function INCLUDES public — so a null here is a failure, not an
  // absence of grants.
  const { rows: [{ acl }] } = await db.query(`select p.proacl::text[] as acl
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pennsync_records' and p.proname = 'phone_masked'`);
  assert.ok(Array.isArray(acl) && acl.length > 0,
    'a null ACL is the default, and the default grants EXECUTE to PUBLIC');
  assert.deepEqual(acl.filter(item => item.startsWith('=')), [],
    'no aclitem may have an empty grantee: that is the PUBLIC grant');

  const { rows: [{ allowed }] } = await db.query(
    "select pg_catalog.has_function_privilege($1, $2, 'execute') as allowed",
    ['pennsync_records_owner', SIGNATURE]);
  assert.equal(allowed, true, 'the record owner calls it from inside the projection');
});

test('roster_entry kept the ACL and the owner a create-or-replace does not reset', async () => {
  // The reason this file may use `create or replace` where the display-name
  // migration needed drop-and-create: the signature does not move, so neither
  // the owner nor the grants the two contracts inherit are touched. A
  // drop-and-create here would silently drop them, and the failure would be a
  // permission error from inside a contract rather than from this file.
  const { rows: [{ owner }] } = await db.query(`select pg_catalog.pg_get_userbyid(p.proowner) as owner
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pennsync_records' and p.proname = 'roster_entry'`);
  assert.equal(owner, 'pennsync_records_owner');
  const { rows: [{ allowed }] } = await db.query(
    "select pg_catalog.has_function_privilege($1, $2, 'execute') as allowed",
    ['pennsync_records_owner',
      'pennsync_records.roster_entry(text,text,text,text,text,text,boolean,'
      + 'pennsync_records."user",boolean)']);
  assert.equal(allowed, true);
});
