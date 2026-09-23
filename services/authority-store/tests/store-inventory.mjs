/**
 * What "the store" is made of, as one statement and one differencer.
 *
 * Lifted out of `hosted-store.test.mjs` so that `store-inventory.test.mjs` can
 * sabotage the SAME text this suite sends to the hosted project. A second copy
 * would drift, and a comparison proved against a copy proves nothing about the
 * original — which is the failure this file is here to close rather than
 * repeat.
 *
 * WHAT IS COMPARED, AND BY WHICH REPRESENTATION. That second half is the one
 * that matters. Every entry below records a representation chosen on purpose,
 * because a comparison is blind to everything its representation leaves out and
 * blind SILENTLY:
 *
 *   tables      relkind, owner, relrowsecurity, relforcerowsecurity.
 *               Every persistent relation kind, not just ordinary tables: a
 *               VIEW over a record table, created by a privileged role and
 *               granted to `authenticated`, reads every tenant's rows past
 *               every policy, and a comparison filtered to `relkind = 'r'`
 *               reports nothing at all about it.
 *   columns     format_type, attnotnull, the DEFAULT expression, and whether
 *               the column is generated or an identity. The type and the
 *               nullability are not the column: dropping the default from
 *               `chart_assignment.granted_at` (D33) or the expression from
 *               `membership.membership_key` (D34) leaves both unchanged.
 *   constraints pg_get_constraintdef, which carries the foreign key's ON
 *               DELETE and ON UPDATE actions, a partial exclusion's predicate,
 *               deferrability and NOT VALID. `contype = 'n'` is excluded; see
 *               the version note in `hosted-store.test.mjs`.
 *   indexes     pg_get_indexdef AND validity. An index left invalid by a failed
 *               concurrent build enforces no uniqueness and deparses
 *               identically, so the definition alone cannot see it.
 *   policies    command, roles, permissiveness, qual and with_check.
 *   functions   owner, security mode, volatility, settings, return type,
 *               grants, the body digest — and the full ARGUMENT list, STRICT
 *               and LEAKPROOF. `pg_get_function_identity_arguments` omits
 *               argument defaults by definition, and PostgREST resolves
 *               `/rest/v1/rpc/<name>` by the names of the body's keys, so the
 *               defaults are what decide which call shapes exist. STRICT and
 *               LEAKPROOF are both outside `prosrc`, so `md5(prosrc)` cannot
 *               see either.
 *   triggers    pg_get_triggerdef AND tgenabled. A trigger disabled with
 *               `alter table … disable trigger` fires on nothing and deparses
 *               byte for byte the same; every immutability and provenance
 *               guard in this store is a trigger.
 *
 * WHAT IS DELIBERATELY NOT COMPARED is recorded in D95 rather than here,
 * because a reason is only useful where somebody looks for it.
 *
 * IT IMPORTS NOTHING. `record-contract-postgres.test.mjs` records why: the CI
 * job running the hosted suite installs only `services/authority-store`'s own
 * dependencies and does no root install, so anything here reaching a root
 * module with a third-party dependency dies at load.
 */

const SCHEMA = 'pennsync_records';
const PRIVATE = 'pennsync_private';
const SCHEMA_LIST = `'${SCHEMA}', '${PRIVATE}'`;

/**
 * Persistent relation kinds, and the subset a caller's TABLE privileges are
 * meaningful for.
 *
 * Sequences are inventoried — one appearing in either schema is a fact worth a
 * failure — but left out of the privilege cross-product, because a sequence
 * answers `has_sequence_privilege` and `has_table_privilege(…, 'insert')`
 * raises on one, which would turn a new sequence into a read that errors
 * instead of a difference that names it.
 */
const RELKINDS = `('r', 'p', 'v', 'm', 'f', 'S')`;
const GRANTABLE = `('r', 'p', 'v', 'm', 'f')`;

/** The relation kinds that hold rows of their own and can carry RLS. */
export const TABLE_KINDS = Object.freeze(['r', 'p']);

/**
 * One statement, asked of both databases, so the two sides cannot be measured
 * differently. Everything is aggregated into a single `jsonb` document because
 * each hosted read is an HTTPS round trip, and because `jsonb` sidesteps the
 * bigint-as-string difference between the two drivers.
 *
 * Every part is keyed on `k` so a difference names the object rather than an
 * array index.
 */
export const INVENTORY = `select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object(
      'k', n.nspname || '.' || c.relname,
      'kind', c.relkind::text,
      'owner', pg_get_userbyid(c.relowner),
      'rls', c.relrowsecurity,
      'forced', c.relforcerowsecurity) order by n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in (${SCHEMA_LIST}) and c.relkind in ${RELKINDS}),
  'columns', (select jsonb_agg(jsonb_build_object(
      'k', n.nspname || '.' || c.relname || '.' || a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'notnull', a.attnotnull,
      'default', coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
      'generated', a.attgenerated::text || a.attidentity::text)
      order by n.nspname, c.relname, a.attname)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname in (${SCHEMA_LIST}) and c.relkind in ${GRANTABLE}
      and a.attnum > 0 and not a.attisdropped),
  'constraints', (select jsonb_agg(jsonb_build_object(
      'k', n.nspname || '.' || rel.relname || '.' || c.conname,
      'type', c.contype::text,
      'def', pg_get_constraintdef(c.oid)) order by n.nspname, rel.relname, c.conname)
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname in (${SCHEMA_LIST}) and c.contype <> 'n'),
  'indexes', (select jsonb_agg(jsonb_build_object(
      'k', n.nspname || '.' || rel.relname || '.' || idx.relname,
      'def', pg_get_indexdef(i.indexrelid),
      'valid', i.indisvalid and i.indisready and i.indislive)
      order by n.nspname, rel.relname, idx.relname)
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class rel on rel.oid = i.indrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname in (${SCHEMA_LIST})),
  'policies', (select jsonb_agg(jsonb_build_object(
      'k', schemaname || '.' || tablename || '.' || policyname,
      'cmd', cmd, 'permissive', permissive, 'roles', roles::text,
      'qual', qual, 'with_check', with_check)
      order by schemaname, tablename, policyname)
    from pg_policies where schemaname in (${SCHEMA_LIST})),
  'functions', (select jsonb_agg(jsonb_build_object(
      'k', n.nspname || '.' || p.proname
        || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      'args', pg_get_function_arguments(p.oid),
      'owner', pg_get_userbyid(p.proowner),
      'secdef', p.prosecdef,
      'strict', p.proisstrict,
      'leakproof', p.proleakproof,
      'volatile', p.provolatile::text,
      'cfg', coalesce(p.proconfig::text, ''),
      'returns', pg_get_function_result(p.oid),
      'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
      'anon', has_function_privilege('anon', p.oid, 'execute'),
      'body', md5(coalesce(p.prosrc, '')))
      order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (${SCHEMA_LIST})
       or (n.nspname = 'public' and p.proname like 'pennsync|_%' escape '|')),
  'triggers', (select jsonb_agg(jsonb_build_object(
      'k', n.nspname || '.' || rel.relname || '.' || t.tgname,
      'enabled', t.tgenabled::text,
      'def', pg_get_triggerdef(t.oid)) order by n.nspname, rel.relname, t.tgname)
    from pg_trigger t
    join pg_class rel on rel.oid = t.tgrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname in (${SCHEMA_LIST}) and not t.tgisinternal),
  'caller_table_privileges', (select coalesce(jsonb_agg(granted order by granted), '[]'::jsonb)
    from (
      select n.nspname || '.' || c.relname || ':' || r.rolname || ':' || p.priv as granted
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (select unnest(array['anon', 'authenticated', 'service_role']) as rolname) r
      cross join (select unnest(array['select', 'insert', 'update', 'delete',
        'references', 'trigger']) as priv) p
      where n.nspname in (${SCHEMA_LIST}) and c.relkind in ${GRANTABLE}
        and has_table_privilege(r.rolname, c.oid, p.priv)) reachable),
  'schema_privileges', (select jsonb_agg(jsonb_build_object(
      'k', r.rolname || ':' || s.nsp,
      'usage', has_schema_privilege(r.rolname, s.nsp, 'usage'),
      'create', has_schema_privilege(r.rolname, s.nsp, 'create')) order by r.rolname, s.nsp)
    from (select unnest(array['anon', 'authenticated', 'service_role']) as rolname) r
    cross join (select unnest(array['${SCHEMA}', '${PRIVATE}']) as nsp) s),
  'publication_tables', (select coalesce(jsonb_agg(
      pubname || ':' || schemaname || '.' || tablename
      order by pubname, schemaname, tablename), '[]'::jsonb)
    from pg_publication_tables where schemaname in (${SCHEMA_LIST}))
) as inventory`;

/** The keyed parts, differenced object by object. */
export const KEYED_PARTS = Object.freeze(['tables', 'columns', 'constraints',
  'indexes', 'policies', 'functions', 'triggers']);

/**
 * The unkeyed parts, compared whole.
 *
 * `publication_tables` joined these on 2026-09-23 (D96). It shipped in D95 as a
 * reading that was deliberately NOT asserted: a table in a publication streams
 * its rows to whatever holds the replication slot, which on a Supabase project
 * is Realtime, and whether Supabase's own `supabase_realtime` publication
 * arrives empty or `FOR ALL TABLES` is a platform fact no pull request can
 * measure. Asserting it unmeasured would have put `main` red for a reason
 * discoverable only after the merge, which is D93's cost.
 *
 * The first `main` run under the widened check supplied the number: no record
 * or authority table is published. So the comparison is now the ordinary one —
 * the reference publishes nothing, hosted publishes nothing, and a table
 * enabled for Realtime from the dashboard is a fault with its name in it.
 */
export const WHOLE_PARTS = Object.freeze(['caller_table_privileges', 'schema_privileges',
  'publication_tables']);

/**
 * Two keyed inventories, differenced so a failure NAMES what differs.
 *
 * `assert.deepEqual` over 3,402 columns prints both arrays and tells a reader
 * nothing. This reports the missing keys, the extra keys and the fields that
 * disagree, which is the difference between a diagnosable failure and a wall
 * of JSON.
 *
 * It RETURNS the faults rather than asserting them, and that is a correction
 * rather than a style. It used to assert per category, inside a loop over
 * seven of them in a fixed order, so the first failing category ended the test
 * and the ones after it were never compared at all. D82's three missing
 * objects are one gap — a policy, a function and a trigger — and the suite
 * could only ever name the policy, so fixing that alone would have gone red at
 * `functions`, then at `triggers`: three rounds reading like new regressions
 * when nothing new had happened. One assertion over every category says the
 * whole divergence in one run.
 */
export function differences(part, reference, hosted) {
  const ref = new Map((reference ?? []).map(entry => [entry.k, entry]));
  const host = new Map((hosted ?? []).map(entry => [entry.k, entry]));
  const missing = [...ref.keys()].filter(key => !host.has(key));
  const extra = [...host.keys()].filter(key => !ref.has(key));
  const changed = [];
  for (const [key, expected] of ref) {
    const actual = host.get(key);
    if (!actual) continue;
    for (const field of Object.keys(expected)) {
      if (field === 'k') continue;
      if (JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) {
        changed.push(`${key}.${field}: committed ${JSON.stringify(expected[field])}`
          + ` hosted ${JSON.stringify(actual[field])}`);
      }
    }
  }
  return [
    ...missing.map(key => `missing from hosted: ${key}`),
    ...extra.map(key => `present on hosted only: ${key}`),
    ...changed,
  ].map(fault => `${part}: ${fault}`);
}

/**
 * Every difference between two inventories, keyed parts and whole parts alike.
 *
 * One list rather than one per category, for the reason `differences` gives:
 * a divergence reported a category at a time reads as three regressions.
 */
export function inventoryFaults(reference, hosted) {
  const faults = KEYED_PARTS.flatMap(part => differences(part, reference[part], hosted[part]));
  for (const part of WHOLE_PARTS) {
    if (JSON.stringify(reference[part]) !== JSON.stringify(hosted[part])) {
      faults.push(`${part}: committed ${JSON.stringify(reference[part])}`
        + ` hosted ${JSON.stringify(hosted[part])}`);
    }
  }
  return faults;
}
