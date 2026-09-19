#!/usr/bin/env node
/**
 * Candidate PostgreSQL schema for the entities being carried off Base44.
 *
 * Phase 2 of the exit needs an independent home for the entity types marked
 * `port` or `broker` in `tools-transition-disposition.json`. This derives that
 * schema from the committed JSONC definitions so the shape follows the source
 * of truth rather than a hand transcription of 250 files.
 *
 * What it produces is a **candidate**, not an approved schema. It is
 * deliberately permissive about existing data and strict about access:
 *
 * - Columns are nullable even where the entity marks them required, because a
 *   legacy row that predates a requirement must still migrate and be
 *   reconciled rather than rejected at load time.
 * - Enum values become CHECK constraints, so a row carrying a retired value
 *   fails loudly and is quarantined instead of being silently accepted.
 * - The primary key is (source_app_id, id). The two source apps have
 *   independent identity spaces with colliding ids, so a single-column key
 *   would merge unrelated records.
 * - Every table forces row level security with no policy and no grant, matching
 *   the authority store: reads go through reviewed brokers, never direct CRUD.
 *
 * Indexes, foreign keys, partitioning and retention are deliberately absent:
 * each needs a per-entity decision this tool cannot make. It is offline and
 * writes nothing to any database.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';

export const FORMAT = 'pennsync-entity-schema-plan';
export const FORMAT_VERSION = 1;
export const EXPECTATIONS_FILE = 'tools-entity-schema-plan-expectations.json';
export const DISPOSITION_FILE = 'tools-transition-disposition.json';
export const ENTITY_DIRECTORY = 'base44/entities';
/** A separate namespace from the authority store's `pennsync_private`. */
export const SCHEMA = 'pennsync_records';
/** Only these dispositions get a table here. */
export const CARRIED = Object.freeze(['port', 'broker']);
export const MAX_IDENTIFIER = 63;

/**
 * Columns every carried row has, independent of its entity definition.
 *
 * `identity` columns form the primary key and cannot be redefined: an entity
 * declaring one is a conflict a person must resolve, not something to merge.
 * The rest are platform metadata that several entities also declare
 * explicitly, usually to document the creator's email. Those merge onto the
 * one column rather than being dropped, which would silently lose the field.
 */
export const SYSTEM_COLUMNS = Object.freeze([
  { name: 'source_app_id', type: 'text', notNull: true, identity: true },
  { name: 'id', type: 'text', notNull: true, identity: true },
  { name: 'created_date', type: 'timestamptz' },
  { name: 'updated_date', type: 'timestamptz' },
  { name: 'created_by', type: 'text' },
]);
const SYSTEM_BY_NAME = new Map(SYSTEM_COLUMNS.map(column => [column.name, column]));

/** Where the tenant decisions are recorded; read as data to avoid an import cycle. */
export const TENANT_DECISION_FILE = 'tools-tenant-decision.json';
/** The column that names an owning agency. */
export const TENANT_COLUMN = 'agency_id';
/**
 * Decision kinds whose tables carry a tenant key. `agency_id` is added here,
 * before any row is loaded, rather than backfilled afterwards: a row that
 * arrives without an owner cannot be given one later without guessing, and a
 * guess in this column is a cross-tenant disclosure.
 */
export const STAMPED_KINDS = Object.freeze(['agency', 'shared']);

export function snakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/** Quote every identifier: many property names are reserved words. */
export const quote = value => `"${String(value).replace(/"/g, '""')}"`;
const literal = value => `'${String(value).replace(/'/g, "''")}'`;

export function columnType(property) {
  const type = Array.isArray(property?.type) ? property.type[0] : property?.type;
  if (type === 'string') {
    if (property.format === 'date') return 'date';
    if (property.format === 'date-time') return 'timestamptz';
    return 'text';
  }
  if (type === 'integer') return 'bigint';
  if (type === 'number') return 'double precision';
  if (type === 'boolean') return 'boolean';
  // Arrays and nested objects keep their exact shape rather than being
  // flattened into columns this tool would have to invent.
  if (type === 'array' || type === 'object') return 'jsonb';
  return 'text';
}

/** A finite, non-empty list of plain scalars is the only enum worth constraining. */
export function enumValues(property) {
  const values = property?.enum;
  if (!Array.isArray(values) || values.length === 0 || values.length > 200) return null;
  if (!values.every(value => typeof value === 'string' && value.length <= 200)) return null;
  if (new Set(values).size !== values.length) return null;
  return values;
}

export function planEntity(name, raw, disposition, decision = null) {
  const schema = JSON5.parse(raw);
  const table = snakeCase(name);
  const columns = [];
  const checks = [];
  const skipped = [];
  const merged = [];
  for (const [property, definition] of Object.entries(schema.properties || {})) {
    const column = snakeCase(property);
    if (!column || column.length > MAX_IDENTIFIER) { skipped.push({ property, reason: 'INVALID_COLUMN_NAME' }); continue; }
    const system = SYSTEM_BY_NAME.get(column);
    if (system?.identity) throw new Error(`IDENTITY_COLUMN_REDEFINED:${name}.${property}`);
    const type = columnType(definition);
    if (system) {
      // The entity documents the same platform field. Keep the one column and
      // require the declared type to agree, so a mismatch is reviewed.
      if (type !== system.type) throw new Error(`SYSTEM_COLUMN_TYPE_CONFLICT:${name}.${property}:${type}`);
      merged.push({ property, column });
      continue;
    }
    if (columns.some(existing => existing.name === column)) { skipped.push({ property, reason: 'DUPLICATE_AFTER_NORMALIZATION' }); continue; }
    columns.push({ name: column, property, type });
    const values = type === 'text' ? enumValues(definition) : null;
    if (values) checks.push({ column, values });
  }
  // A decided tenant key is added as a real column so the table cannot be
  // loaded without an owner. Appended after the declared columns, so the
  // output stays byte-deterministic.
  const declaredTenant = columns.some(column => column.name === TENANT_COLUMN);
  const stamped = !declaredTenant && STAMPED_KINDS.includes(decision?.kind);
  if (stamped) columns.push({ name: TENANT_COLUMN, property: null, type: 'text', notNull: true, stamped: true });
  return {
    entity: name,
    disposition,
    table,
    tenant_key: declaredTenant || stamped ? TENANT_COLUMN : null,
    tenant_decision: decision?.kind ?? null,
    self_subject: decision?.kind === 'self' ? snakeCase(decision.subject) : null,
    platform_flag: decision?.kind === 'shared' ? snakeCase(decision.platform_flag) : null,
    columns: columns.length,
    constrained: checks.length,
    merged_system_columns: merged.length,
    skipped,
    definition: { columns, checks },
  };
}

/** PostgreSQL truncates a long identifier, which can merge two constraints into one. */
export function constraintName(table, column) {
  return `${table}_${column}_allowed`.slice(0, MAX_IDENTIFIER);
}

export function renderEntity(plan) {
  const qualified = `${quote(SCHEMA)}.${quote(plan.table)}`;
  const names = plan.definition.checks.map(check => constraintName(plan.table, check.column));
  if (new Set(names).size !== names.length) {
    // Two constraints sharing a name would silently become one. Fail instead.
    throw new Error(`CONSTRAINT_NAME_COLLISION:${plan.entity}`);
  }
  // A global table is read by every agency, so the platform's own `created_by`
  // would hand each of them an account identifier from whichever agency
  // authored the row. Reference data has no author worth carrying, so the
  // column is not emitted there at all rather than being filtered later.
  if (plan.tenant_decision === 'global' && plan.merged_system_columns > 0) {
    // It declares a platform column of its own, which would be dropped rather
    // than merged once the platform one is withheld. Silently losing a field
    // is the defect this generator already had once.
    throw new Error(`GLOBAL_ENTITY_DECLARES_SYSTEM_COLUMN:${plan.entity}`);
  }
  const systemColumns = plan.tenant_decision === 'global'
    ? SYSTEM_COLUMNS.filter(column => column.name !== 'created_by') : SYSTEM_COLUMNS;
  const lines = [
    ...systemColumns.map(column => `  ${quote(column.name)} ${column.type}${column.notNull ? ' not null' : ''}`),
    ...plan.definition.columns.map(column => `  ${quote(column.name)} ${column.type}${column.notNull ? ' not null' : ''}`),
    `  constraint ${quote(`${plan.table}_pkey`)} primary key (${quote('source_app_id')}, ${quote('id')})`,
    ...plan.definition.checks.map(check =>
      `  constraint ${quote(constraintName(plan.table, check.column))} `
      + `check (${quote(check.column)} is null or ${quote(check.column)} in (${check.values.map(literal).join(', ')}))`),
  ];
  return [
    `create table ${qualified} (`,
    lines.join(',\n'),
    ');',
    `alter table ${qualified} enable row level security;`,
    `alter table ${qualified} force row level security;`,
    `revoke all on ${qualified} from public;`,
  ].join('\n');
}

/** Plan every carried entity exactly once; both callers below reuse the result. */
function planAll(repository) {
  const dispositions = JSON.parse(readFileSync(join(repository, DISPOSITION_FILE), 'utf8')).entities;
  const decisions = JSON.parse(readFileSync(join(repository, TENANT_DECISION_FILE), 'utf8')).entities ?? {};
  const directory = join(repository, ENTITY_DIRECTORY);
  const files = readdirSync(directory).filter(file => /\.jsonc?$/.test(file)).sort();
  const plans = [];
  const excluded = [];
  for (const file of files) {
    const name = file.replace(/\.jsonc?$/, '');
    const disposition = dispositions[name];
    if (!CARRIED.includes(disposition)) { excluded.push({ entity: name, disposition: disposition ?? 'missing' }); continue; }
    plans.push(planEntity(name, readFileSync(join(directory, file), 'utf8'), disposition, decisions[name] ?? null));
  }
  return { plans, excluded };
}

export function buildPlan(repository, prepared = null) {
  const { plans, excluded } = prepared ?? planAll(repository);
  const tables = plans.map(plan => plan.table);
  const collisions = tables.filter((table, index) => tables.indexOf(table) !== index);
  if (collisions.length) throw new Error(`TABLE_NAME_COLLISION:${[...new Set(collisions)].sort().join(',')}`);
  const oversized = plans.filter(plan => plan.table.length > MAX_IDENTIFIER).map(plan => plan.entity);
  if (oversized.length) throw new Error(`TABLE_NAME_TOO_LONG:${oversized.join(',')}`);
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    target_schema: SCHEMA,
    totals: {
      carried: plans.length,
      excluded: excluded.length,
      columns: plans.reduce((sum, plan) => sum + plan.columns, 0),
      constrained_columns: plans.reduce((sum, plan) => sum + plan.constrained, 0),
      tenant_scoped: plans.filter(plan => plan.tenant_key).length,
      skipped_properties: plans.reduce((sum, plan) => sum + plan.skipped.length, 0),
      merged_system_columns: plans.reduce((sum, plan) => sum + plan.merged_system_columns, 0),
    },
    entities: plans.map(({ definition, ...rest }) => rest),
    // Everything this schema deliberately does not decide.
    indexes_planned: false,
    foreign_keys_planned: false,
    retention_planned: false,
    reviewed: false,
    applied_anywhere: false,
  };
}

/**
 * The caller-binding functions every policy below asks.
 *
 * SECURITY DEFINER because `pennsync_private` is not readable by a tenant
 * role: the answer has to be computed by something that can see the
 * membership roster without handing the caller access to it. STABLE because a
 * policy calls these once per row and the answer cannot change inside a
 * statement.
 *
 * A boundary these policies CANNOT enforce, stated because assuming otherwise
 * is how they get trusted too far: a SUPERUSER or BYPASSRLS role bypasses row
 * level security even where it is forced. The authority migration requires
 * exactly such a role to own its objects
 * (`PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED`), so a broker running as the
 * migration owner is not bound by anything below. Brokers must therefore run
 * as a role with neither attribute. `record-tenant-isolation.test.mjs`
 * demonstrates the bypass rather than describing it, so the requirement is
 * visible instead of implied.
 *
 * An active membership requires BOTH `status = 'active'` AND `revoked_at is
 * null`. The thirteen hand-copied `validateMembershipRows` variants disagreed
 * on exactly this, some accepting a row whose `revoked_at` is set while its
 * status still says active. Reading the store settles it: `membership_check`
 * already makes that row unrepresentable, so the argument was about a state
 * the database will not hold. Both markers are asked anyway, because a
 * predicate that leans on a constraint in another schema is one migration
 * away from being wrong, and a test pins the constraint so the redundancy
 * cannot quietly become the only thing holding.
 */
export const POLICY_HELPERS = [
  // The single gate, reused rather than reimplemented. `actor()` checks the
  // authenticated role, the JWT's expiry, a live session row, an active
  // non-banned native user, and an enabled identity whose email still matches.
  // An earlier version of this helper asked only `auth.uid()` plus an active
  // membership, which let a still-valid token from a signed-out or banned
  // account keep reading. A policy has to filter rather than raise, so the
  // gate's refusal becomes "no identity" here.
  `create function ${quote(SCHEMA)}.caller_identity() returns pennsync_private.identity_map
  language plpgsql stable security definer set search_path = '' as $$
  declare v_identity pennsync_private.identity_map;
  begin
    begin
      v_identity := pennsync_private.actor(pennsync_private.deployment_app_id(), false);
    exception when others then return null;
    end;
    return v_identity;
  end $$;`,
  `create function ${quote(SCHEMA)}.caller_identified() returns boolean
  language sql stable security definer set search_path = '' as $$
  select (${quote(SCHEMA)}.caller_identity()).auth_user_id is not null
$$;`,
  // A suspended agency keeps its membership rows, so the agency's own status
  // is checked here the way `context_value` checks it.
  `create function ${quote(SCHEMA)}.caller_agencies() returns setof text
  language sql stable security definer set search_path = '' as $$
  select m.agency_id::text
  from ${quote(SCHEMA)}.caller_identity() i
  join pennsync_private.membership m
    on m.app_id = i.app_id and m.auth_user_id = i.auth_user_id
   and m.base44_user_id = i.base44_user_id
  join pennsync_private.agency a on a.app_id = m.app_id and a.id = m.agency_id
  where i.auth_user_id is not null
    and m.status = 'active' and m.revoked_at is null
    and a.status in ('active','trial')
$$;`,
  `create function ${quote(SCHEMA)}.caller_user_id() returns text
  language sql stable security definer set search_path = '' as $$
  select (${quote(SCHEMA)}.caller_identity()).base44_user_id
$$;`,
  `create function ${quote(SCHEMA)}.caller_email() returns text
  language sql stable security definer set search_path = '' as $$
  select (${quote(SCHEMA)}.caller_identity()).expected_email
$$;`,
  // Nothing may call these directly; they exist to be asked by a policy.
  // `source_app_id` is plain text on these tables, so nothing stops a row of
  // another source app existing here — and ids collide across the two apps,
  // which is why the primary key is composite. Without this, a caller whose
  // agency key matches would read the other app's row. Every predicate below
  // asks it.
  `create function ${quote(SCHEMA)}.deployment_app() returns text
  language sql stable security definer set search_path = '' as $$
  select pennsync_private.deployment_app_id()
$$;`,
  `revoke all on function ${quote(SCHEMA)}.caller_identity(), ${quote(SCHEMA)}.caller_identified(),
  ${quote(SCHEMA)}.caller_agencies(), ${quote(SCHEMA)}.caller_user_id(),
  ${quote(SCHEMA)}.caller_email(), ${quote(SCHEMA)}.deployment_app() from public, anon, authenticated, service_role;`,
];

/** Where the resolved tenant paths are recorded; read as data to avoid an import cycle. */
export const TENANT_PATH_FILE = 'tools-tenant-path-expectations.json';

/**
 * The predicate proving a row of `entity` belongs to an agency the caller is
 * in, as SQL against `alias`.
 *
 * A `reference` entity does not carry a key: it reaches one through another
 * entity, so its predicate is an EXISTS over that entity carrying the same
 * question one hop further in. The resolver caps a path at three hops and
 * resolves only through `root`, `direct` and `reference`, so this terminates;
 * `depth` is threaded through anyway so a cycle introduced later fails loudly
 * instead of recursing forever.
 */
export function tenantPredicate(entity, alias, index, { paths, tables }, depth = 0) {
  if (depth > 4) throw new Error(`TENANT_PATH_TOO_DEEP:${entity}`);
  const path = paths.get(entity);
  const agencies = `${quote(SCHEMA)}.caller_agencies()`;
  if (!path) throw new Error(`TENANT_PATH_MISSING:${entity}`);
  // `Agency` is not in a tenant, it is one.
  if (path.kind === 'root') return `${alias}.${quote('id')} in (select ${agencies})`;
  if (path.kind === 'direct') return `${alias}.${quote(TENANT_COLUMN)} in (select ${agencies})`;
  if (path.kind === 'reference') {
    const next = `t${index + 1}`;
    const target = tables.get(path.target);
    if (!target) throw new Error(`TENANT_PATH_TARGET_UNKNOWN:${entity}:${path.target}`);
    const inner = tenantPredicate(path.target, next, index + 1, { paths, tables }, depth + 1);
    // Joined on the whole primary key: an id is only unique within its source
    // app, so matching on id alone would reach across the two source apps.
    return `exists (select 1 from ${quote(SCHEMA)}.${quote(target)} ${next}`
      + ` where ${next}.${quote('source_app_id')} = ${alias}.${quote('source_app_id')}`
      + ` and ${next}.${quote('id')} = ${alias}.${quote(snakeCase(path.via))}`
      + ` and ${inner})`;
  }
  // A self-editable profile claim is excluded from authorization by
  // construction — it is the defect that paused `analyzeClinicalData`. Falling
  // through to the agency predicate here would authorize `User` reads through
  // the very column the account can rewrite about itself, so this refuses to
  // generate anything rather than generating something wrong.
  if (path.kind === 'profile_claim') throw new Error(`TENANT_PATH_IS_PROFILE_CLAIM:${entity}`);
  if (path.kind !== 'actor' && path.kind !== 'unresolved') throw new Error(`TENANT_PATH_UNHANDLED:${entity}:${path.kind}`);
  // Anything still blocking here was decided, and a decision stamps the key on.
  return `${alias}.${quote(TENANT_COLUMN)} in (select ${agencies})`;
}

/** The subject column a `self` table matches against, by the column's name. */
const SELF_BINDING = Object.freeze({ user_id: 'caller_user_id', user_email: 'caller_email' });

/**
 * Policies are `to public` rather than `to authenticated` on purpose. These
 * tables carry no grant, so no role reaches them directly; access runs through
 * SECURITY DEFINER brokers, and `force row level security` subjects the table
 * owner — and therefore the broker — to these policies too. Naming a role here
 * would exempt the broker from the predicate it exists to enforce.
 */
export function renderPolicies(plan, resolution) {
  const qualified = `${quote(SCHEMA)}.${quote(plan.table)}`;
  const name = suffix => quote(`${plan.table}_${suffix}`.slice(0, MAX_IDENTIFIER));
  const self = quote(plan.table);
  // The deployment serves one app; a row belonging to the other is not this
  // deployment's to show or touch, however its agency key reads.
  const thisApp = `${self}.${quote('source_app_id')} = ${quote(SCHEMA)}.deployment_app()`;
  const kind = plan.tenant_decision;

  // `User` carries only a claim it can edit about itself, so no predicate here
  // can be trusted. Forced RLS with NO policy is the honest answer: the table
  // exists, holds its rows, and is unreachable through this surface until a
  // decision says how it may be read.
  if (resolution.paths.get(plan.entity)?.kind === 'profile_claim') {
    return [`-- ${plan.table}: excluded from authorization (self-editable profile claim); forced RLS, no policy.`];
  }
  const tenant = `${thisApp} and ${tenantPredicate(plan.entity, self, 0, resolution)}`;

  if (kind === 'global') {
    // Platform reference: every caller reads it and no tenant surface writes
    // it. Forced RLS with no write policy is what refuses the writes. Still
    // scoped to the deployment's own app, because global means every agency
    // here, not every app.
    // `using (true)` let any role that reached the table read every row with no
    // session at all. Global means every *identified* caller in this
    // deployment, so the identity check is in the predicate rather than left
    // for each future broker to remember.
    return [`create policy ${name('read')} on ${qualified} for select `
      + `using (${thisApp} and ${quote(SCHEMA)}.caller_identified());`];
  }
  let read = tenant;
  if (kind === 'self') {
    const binding = SELF_BINDING[plan.self_subject];
    if (!binding) throw new Error(`SELF_SUBJECT_UNSUPPORTED:${plan.entity}:${plan.self_subject}`);
    read = `${thisApp} and ${self}.${quote(plan.self_subject)} = ${quote(SCHEMA)}.${binding}()`;
  } else if (kind === 'shared') {
    read = `(${tenant}) or (${thisApp} and ${self}.${quote(plan.platform_flag)} is true)`;
  }
  // A shared table's write must also refuse to SET the platform flag. Without
  // that an agency writes its own row — which the tenant predicate allows —
  // marks it platform, and the read policy above then shows it to every other
  // agency. Restricting the row's agency is not enough; the flag is the thing
  // that publishes it.
  const write = kind === 'self' ? read
    : kind === 'shared' ? `${tenant} and ${self}.${quote(plan.platform_flag)} is not true`
      : tenant;
  return [
    `create policy ${name('read')} on ${qualified} for select using (${read});`,
    `create policy ${name('insert')} on ${qualified} for insert with check (${write});`,
    `create policy ${name('update')} on ${qualified} for update using (${write}) with check (${write});`,
    `create policy ${name('delete')} on ${qualified} for delete using (${write});`,
  ];
}

export function renderDdl(repository) {
  const prepared = planAll(repository);
  const plan = buildPlan(repository, prepared);
  const recorded = JSON.parse(readFileSync(join(repository, TENANT_PATH_FILE), 'utf8')).entities;
  const resolution = {
    paths: new Map(recorded.map(entry => [entry.entity, entry])),
    tables: new Map(prepared.plans.map(entity => [entity.entity, entity.table])),
  };
  // Every table before any policy: a reference path names the table it reaches
  // through, and that table is not always created first in name order.
  const statements = [
    `create schema ${quote(SCHEMA)};`,
    ...POLICY_HELPERS,
    ...prepared.plans.map(renderEntity),
    ...prepared.plans.flatMap(plan => renderPolicies(plan, resolution)),
  ];
  return { plan, sql: statements.join('\n\n') + '\n' };
}

/**
 * The role that owns the record tables, and why the store needs one of its own.
 *
 * `force row level security` binds a table's owner to its own policies — but
 * not a `SUPERUSER` or `BYPASSRLS` role, which bypasses RLS however it is
 * declared. The authority store's migrations require exactly such an
 * administrator (`PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED`), so leaving
 * these tables owned by the migration role would leave all 596 policies
 * decorative: anything running as that role reads every agency's rows.
 *
 * So the migration creates a role with neither attribute, and the tables are
 * created while acting as it. Measured rather than assumed: with `force` and a
 * non-bypass owner, the owner's own `select` returns the policy-filtered rows.
 *
 * The caller helpers are deliberately NOT owned by this role. They read
 * `pennsync_private`, whose tables carry forced RLS with no allowing policy,
 * so only the migration administrator can reach them. They stay
 * administrator-owned and are granted to the record owner alone.
 */
export const OWNER_ROLE = 'pennsync_records_owner';
/** Where the generated migration is committed, so a deployment applies it like any other. */
export const RECORD_MIGRATION_FILE =
  'services/authority-store/supabase/migrations/20260919170000_record_store.sql';

/**
 * The record store as a migration a real deployment can apply.
 *
 * `renderDdl` produces the schema; this wraps it in the ownership boundary
 * that makes its policies enforceable, and grants nothing to any caller role.
 *
 * That last part is the substantive choice. RLS policy expressions are
 * evaluated with the privileges of the role running the query, so a caller
 * granted direct table access would also need `execute` on the caller helpers
 * — the very functions the generated DDL revokes from `authenticated`, since
 * they answer "who is asking" and must not be callable by the asker. Granting
 * both back would hand every caller the table and the gate.
 *
 * Instead no caller role is granted anything here. The intended surface is a
 * broker owned by the record owner: inside a `SECURITY DEFINER` function,
 * `current_user` becomes the owner (so the policies bind and the helpers are
 * callable) while the `role` setting still reads `authenticated` (so
 * `pennsync_private.actor()` still recognises the caller). Both halves were
 * measured before this was written.
 */
export function renderMigration(repository) {
  const { plan, sql } = renderDdl(repository);
  const created = `create schema ${quote(SCHEMA)};`;
  if (!sql.startsWith(created)) throw new Error('RECORD_SCHEMA_STATEMENT_NOT_FIRST');
  // Split the generated body: helpers stay administrator-owned, the rest is
  // created while acting as the non-bypass owner.
  const body = sql.slice(created.length);
  const marker = POLICY_HELPERS[POLICY_HELPERS.length - 1];
  const cut = body.indexOf(marker);
  if (cut < 0) throw new Error('RECORD_HELPER_REVOKE_NOT_FOUND');
  const helpers = body.slice(0, cut + marker.length).trim();
  const tables = body.slice(cut + marker.length).trim();
  const helperList = `${quote(SCHEMA)}.caller_identity(), ${quote(SCHEMA)}.caller_identified(), `
    + `${quote(SCHEMA)}.caller_agencies(), ${quote(SCHEMA)}.caller_user_id(), `
    + `${quote(SCHEMA)}.caller_email(), ${quote(SCHEMA)}.deployment_app()`;
  const statements = [
    `-- The record store: ${plan.totals.carried} carried entities, ${plan.totals.columns} columns,
-- under an owner that row level security actually binds.
--
-- GENERATED by \`node tools-entity-schema-plan.mjs --write-migration\`. Do not edit
-- by hand: a test regenerates this file and fails if it differs. Change the
-- entity definitions, the tenant decisions or the generator instead.
begin;`,
    `-- Same administrator contract as the rest of the store: creating a table with
-- forced RLS and no allowing policy requires a role RLS does not apply to.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;`,
    `-- The record store is meaningless without the authority store it asks about,
-- and the deployment pin decides which app's rows may live here at all.
do $$
begin
  if to_regprocedure('pennsync_private.deployment_app_id()') is null then
    raise exception using errcode='42501',message='PENNSYNC_AUTHORITY_STORE_REQUIRED';
  end if;
end $$;`,
    `-- The owner: created if absent, and verified either way. A pre-existing role
-- carrying BYPASSRLS would silently void every policy below, so that case is
-- refused rather than adopted.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = '${OWNER_ROLE}') then
    begin
      create role ${quote(OWNER_ROLE)} nologin nosuperuser nobypassrls nocreatedb nocreaterole;
    exception when insufficient_privilege then
      -- BYPASSRLS does not carry CREATEROLE, so an administrator who can apply
      -- every other migration here can still fail at this one line. Say which
      -- role is missing rather than leaving a bare permission error.
      raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_NOT_CREATABLE';
    end;
  end if;
  if exists (select 1 from pg_catalog.pg_roles
    where rolname = '${OWNER_ROLE}' and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = '${OWNER_ROLE}' and rolcanlogin) then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_MUST_NOT_LOGIN';
  end if;
  if not pg_catalog.pg_has_role(current_user, '${OWNER_ROLE}', 'USAGE') then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE';
  end if;
end $$;`,
    `create schema ${quote(SCHEMA)} authorization ${quote(OWNER_ROLE)};`,
    `revoke all on schema ${quote(SCHEMA)} from public, anon, authenticated, service_role;`,
    `-- The helpers stay administrator-owned: they read \`pennsync_private\`, which
-- carries forced RLS with no allowing policy, so the record owner cannot.`,
    helpers,
    `-- The owner may ask who is calling. No caller role may.`,
    `grant execute on function ${helperList} to ${quote(OWNER_ROLE)};`,
    `-- Everything below is created while acting as the owner, so the owner is what
-- \`force row level security\` binds.
set local role ${quote(OWNER_ROLE)};`,
    tables,
    `reset role;`,
    `-- Deliberately no grant to anon, authenticated or service_role, on any table or
-- helper, and no USAGE on this schema either. A caller reaches these rows only
-- through a broker owned by ${OWNER_ROLE}, which the policies bind exactly as
-- they bind the owner. The migration that adds those brokers is what grants a
-- caller role USAGE on this schema and EXECUTE on the brokers themselves —
-- nothing else, and never a table.
commit;`,
  ];
  return { plan, sql: statements.join('\n\n') + '\n' };
}

export function comparePlan(plan, expectations) {
  const current = new Map(plan.entities.map(entity => [entity.entity, entity]));
  const recorded = new Map(expectations.entities.map(entity => [entity.entity, entity]));
  const added = [...current.keys()].filter(name => !recorded.has(name)).sort();
  const removed = [...recorded.keys()].filter(name => !current.has(name)).sort();
  // Every field the emitted policies are derived from. Comparing only the
  // table's shape let an authorization change pass as `unchanged`: swapping a
  // shared table's platform flag for another existing boolean, or changing a
  // self subject, rewrites the predicate while leaving columns and the tenant
  // key identical. The decision gate checks a new value is admissible; this is
  // what checks it matches the one that was accepted.
  const COMPARED = ['table', 'columns', 'constrained', 'tenant_key',
    'tenant_decision', 'self_subject', 'platform_flag'];
  const changed = [...current.entries()]
    .filter(([name, entity]) => recorded.has(name)
      && COMPARED.some(field => recorded.get(name)[field] !== entity[field]))
    .map(([name]) => name).sort();
  return { added, removed, changed, matches_expectations: !added.length && !removed.length && !changed.length };
}

export function parseExpectations(raw) {
  let expectations;
  try { expectations = JSON.parse(raw); } catch { throw new Error('PLAN_INVALID_JSON'); }
  if (!expectations || typeof expectations !== 'object' || Array.isArray(expectations)) throw new Error('PLAN_INVALID_SHAPE');
  if (expectations.format !== FORMAT || expectations.schema_version !== FORMAT_VERSION) throw new Error('PLAN_UNSUPPORTED_FORMAT');
  if (!Array.isArray(expectations.entities)) throw new Error('PLAN_INVALID_ENTITIES');
  for (const entity of expectations.entities) {
    if (typeof entity?.entity !== 'string' || typeof entity?.table !== 'string'
      || !Number.isSafeInteger(entity?.columns)) throw new Error('PLAN_INVALID_ENTITIES');
  }
  return expectations;
}

export function main(args = process.argv.slice(2), { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync } = {}) {
  if (args.some(argument => !['--json', '--summary', '--sql', '--update', '--migration', '--write-migration'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let plan; let sql;
  try { ({ plan, sql } = renderDdl(repository)); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'ENTITY_SCHEMAS_UNAVAILABLE' })); return 2; }
  if (args.includes('--sql')) { log(sql); return 0; }
  if (args.includes('--migration') || args.includes('--write-migration')) {
    let migration;
    try { ({ sql: migration } = renderMigration(repository)); }
    catch (error) { log(JSON.stringify({ error: error?.message || 'MIGRATION_UNAVAILABLE' })); return 2; }
    if (args.includes('--migration')) { log(migration); return 0; }
    write(join(repository, RECORD_MIGRATION_FILE), migration);
    log(JSON.stringify({ updated: RECORD_MIGRATION_FILE, bytes: migration.length }, null, 2));
    return 0;
  }
  const expectationsPath = join(repository, EXPECTATIONS_FILE);
  if (args.includes('--update')) {
    write(expectationsPath, JSON.stringify(plan, null, 2) + '\n');
    log(JSON.stringify({ updated: EXPECTATIONS_FILE, totals: plan.totals }, null, 2));
    return 0;
  }
  let expectations;
  try { expectations = parseExpectations(readFileSync(expectationsPath, 'utf8')); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'PLAN_UNAVAILABLE' })); return 2; }
  const report = comparePlan(plan, expectations);
  if (args.includes('--summary')) {
    log(`entity schema plan ${report.matches_expectations ? 'unchanged' : 'CHANGED'}: `
      + `${plan.totals.carried} tables, ${plan.totals.columns} columns, `
      + `${plan.totals.constrained_columns} constrained, ${plan.totals.tenant_scoped} tenant-scoped; `
      + `added=${report.added.length} removed=${report.removed.length} changed=${report.changed.length}`);
  } else {
    log(JSON.stringify({ ...report, totals: plan.totals }, null, 2));
  }
  return report.matches_expectations ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
