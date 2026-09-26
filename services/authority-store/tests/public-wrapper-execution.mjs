/**
 * Call every public wrapper the record store exposes, and look at what comes
 * back — not at whether it resolves by name.
 *
 * `service-rpc-signatures.test.mjs` proves every call the service makes
 * matches a function in `pg_proc` by name and by the names of its parameters.
 * It never executes one, deliberately: it is a name-resolution gate and its
 * value is that it says nothing about behaviour. So a body that cannot run at
 * all passes it, and passed it — `pennsync_records.operational_limit` called
 * `pg_catalog.least`, which is not a function in any PostgreSQL because LEAST
 * is an SQL construct that cannot be schema-qualified, and seven capabilities
 * refused every non-null limit while the whole suite was green. A plpgsql body
 * does not resolve names at creation (D51 records the same trap for a column),
 * so the migration applied cleanly and nothing executed it until a person did.
 *
 * This module executes all of them, as a real signed-in caller against a store
 * built from both migration directories. Two properties make it a gate rather
 * than a survey.
 *
 * A wrapper is declared either as a CALL that must answer or as a STOP pinned
 * to one refusal code, and the two together must equal the public function set
 * exactly (D107, D113) — a wrapper added tomorrow fails here instead of being
 * skipped. A STOP is an IOU, not coverage: it records that these arguments do
 * not reach the end of the body, names the parameter that stops them, and
 * fails if the refusal ever changes OR if the call starts succeeding, so the
 * debt cannot be quietly paid or quietly deepened.
 *
 * And the failure condition is an error the contracts do not raise themselves.
 * Every refusal this store makes carries a `PENNSYNC_` message; an
 * `undefined_function`, an `undefined_column`, an unassigned record, a type
 * mismatch — nothing here produces those on purpose. The diagnostic travels
 * with the finding (D112), because a sweep of 152 calls that reports "one of
 * them threw" has measured something and told nobody what.
 */
import { readdir, readFile } from 'node:fs/promises';
import { applyRecordMigrations } from './record-migrations.mjs';

/** Identity 1 in `fixtures.sql`: `agency_admin` in agency A, opens every chart. */
export const ADMIN_A = 1;
export const AGENCY_A = 'agency-a';

const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Every public function, with its parameter names and types in order.
 *
 * `pg_get_function_identity_arguments` is not used, because it omits argument
 * defaults by definition and this needs the NAMES to bind values to; the same
 * reason D95 gives for not treating it as the signature.
 */
export async function publicWrappers(db) {
  const { rows } = await db.query(`
    select p.proname as name,
      array(select a.n from pg_catalog.unnest(p.proargnames) with ordinality as a(n, o)
        order by a.o) as args,
      array(select pg_catalog.format_type(t, null)
        from pg_catalog.unnest(p.proargtypes) as t) as types
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' order by p.proname`);
  if (rows.length === 0) {
    throw new Error('PENNSYNC_TEST_NO_PUBLIC_WRAPPERS: the store exposes no public '
      + 'function, so every assertion below would hold vacuously (D115).');
  }
  return rows;
}

/**
 * Call one wrapper as an identity, inside a transaction that is always rolled
 * back — the writes among these are real, and a sweep that left its rows
 * behind would make the next call's answer depend on the order of the sweep.
 */
export async function callAs(db, identity, wrapper, values) {
  const args = (wrapper.args ?? []).map(name => values[name] ?? null);
  const placeholders = args.map((_, i) => `$${i + 1}::${wrapper.types[i]}`).join(',');
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(identity), session_id: sid(identity), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    await db.query(`select "public"."${wrapper.name}"(${placeholders})`, args);
    return { name: wrapper.name, outcome: 'answered' };
  } catch (error) {
    const message = String(error?.message ?? error);
    return {
      name: wrapper.name,
      outcome: message.startsWith('PENNSYNC_') ? 'refused' : 'failed',
      code: error?.code ?? null,
      message,
    };
  } finally {
    await db.exec('rollback').catch(() => {});
  }
}

/**
 * Every wrapper, called once.
 *
 * `defaults` binds a parameter NAME wherever it appears — `p_agency` and
 * `p_limit` are the same thing in all 152 — and `perName` overrides them for
 * one wrapper. Keeping the two apart is what stops a value chosen for one
 * capability from silently deciding another's.
 */
export async function sweep(db, { identity = ADMIN_A, defaults = {}, perName = {} } = {}) {
  const results = [];
  for (const wrapper of await publicWrappers(db)) {
    results.push(await callAs(db, identity, wrapper, { ...defaults, ...(perName[wrapper.name] ?? {}) }));
  }
  return results;
}

/**
 * THE production assertion. Both the real sweep and the planted control raise
 * this one (D120): a control that recomputed the predicate would stay green if
 * this were weakened, which is the failure the control exists to rule out.
 */
export function assertNoDeadBodies(assert, results) {
  const dead = results.filter(result => result.outcome === 'failed');
  assert.deepEqual(dead.map(d => `${d.name}: ${d.code} ${d.message}`), [],
    'a public wrapper raised an error the contracts do not raise themselves, '
    + 'which is a body that cannot run rather than a request that was refused');
}

/**
 * The store the sweep runs against: the authority directory whole, then the
 * record directory whole through #316's helper, then the shared fixtures — the
 * order a deployment applies them, which `tools-pennsync-migrate.mjs` fixes by
 * construction rather than by timestamp.
 */
export async function buildStore(db, options = {}) {
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const authority = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(authority)).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, authority), 'utf8'));
  }
  await applyRecordMigrations(db, options);
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
}

/**
 * Which `pennsync_records` helpers the sweep actually executes.
 *
 * This is the gate's own blind spot, measured rather than assumed. A PINNED
 * wrapper's body stops at its refusal, so everything below that line is
 * unexecuted — and the helpers are where the shared defects live, which is the
 * whole reason this suite exists: `operational_limit` is a helper, and seven
 * wrappers died on it. A pin therefore hides more than one capability.
 *
 * The reach is the transitive closure of `pennsync_records.<name>(` over the
 * function bodies, one wrapper at a time, taken from `pg_proc.prosrc` so it
 * describes the store that was built rather than the files on disk — a
 * `create or replace` in a later migration is what a caller reaches, and
 * splitting the FILES by `create function` instead attributes a trailing
 * `grant`/`revoke` block, which names every signature in the file, to whatever
 * function it happens to follow.
 */
export function helperReach(rows) {
  const bodies = new Map(rows.filter(r => r.schema === 'pennsync_records').map(r => [r.name, r.src]));
  const calls = text => [...String(text ?? '').matchAll(/"?pennsync_records"?\s*\.\s*"?([a-z0-9_]+)"?\s*\(/g)]
    .map(match => match[1]).filter(name => bodies.has(name));
  const closure = (seeds) => {
    const seen = new Set();
    const pending = [...seeds];
    while (pending.length > 0) {
      const name = pending.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      pending.push(...calls(bodies.get(name)));
    }
    return seen;
  };
  return new Map(rows.filter(r => r.schema === 'public').map(r => [r.name, closure(calls(r.src))]));
}

/** Every function body in the two schemas, as text. */
export async function functionBodies(db) {
  const { rows } = await db.query(`
    select p.proname as name, p.prosrc as src, n.nspname as schema
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'pennsync_records') and p.prokind = 'f'`);
  return rows;
}
