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
  const lines = [
    ...SYSTEM_COLUMNS.map(column => `  ${quote(column.name)} ${column.type}${column.notNull ? ' not null' : ''}`),
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
  `create function ${quote(SCHEMA)}.caller_agencies() returns setof text
  language sql stable security definer set search_path = '' as $$
  select m.agency_id::text from pennsync_private.membership m
  where m.app_id = pennsync_private.deployment_app_id()
    and m.auth_user_id = auth.uid()
    and m.status = 'active' and m.revoked_at is null
$$;`,
  `create function ${quote(SCHEMA)}.caller_user_id() returns text
  language sql stable security definer set search_path = '' as $$
  select i.base44_user_id from pennsync_private.identity_map i
  where i.app_id = pennsync_private.deployment_app_id()
    and i.auth_user_id = auth.uid() and i.enabled and i.revoked_at is null
$$;`,
  `create function ${quote(SCHEMA)}.caller_email() returns text
  language sql stable security definer set search_path = '' as $$
  select i.expected_email from pennsync_private.identity_map i
  where i.app_id = pennsync_private.deployment_app_id()
    and i.auth_user_id = auth.uid() and i.enabled and i.revoked_at is null
$$;`,
  // Nothing may call these directly; they exist to be asked by a policy.
  `revoke all on function ${quote(SCHEMA)}.caller_agencies(), ${quote(SCHEMA)}.caller_user_id(),
  ${quote(SCHEMA)}.caller_email() from public, anon, authenticated, service_role;`,
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
  const tenant = tenantPredicate(plan.entity, self, 0, resolution);
  const kind = plan.tenant_decision;

  if (kind === 'global') {
    // Platform reference: every caller reads it and no tenant surface writes
    // it. Forced RLS with no write policy is what refuses the writes.
    return [`create policy ${name('read')} on ${qualified} for select using (true);`];
  }
  let read = tenant;
  if (kind === 'self') {
    const binding = SELF_BINDING[plan.self_subject];
    if (!binding) throw new Error(`SELF_SUBJECT_UNSUPPORTED:${plan.entity}:${plan.self_subject}`);
    read = `${self}.${quote(plan.self_subject)} = ${quote(SCHEMA)}.${binding}()`;
  } else if (kind === 'shared') {
    // Platform rows are readable by everyone and writable by nobody: the write
    // policies below never mention the flag, so only the agency rows move.
    read = `${tenant} or ${self}.${quote(plan.platform_flag)} is true`;
  }
  const write = kind === 'self' ? read : tenant;
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

export function comparePlan(plan, expectations) {
  const current = new Map(plan.entities.map(entity => [entity.entity, entity]));
  const recorded = new Map(expectations.entities.map(entity => [entity.entity, entity]));
  const added = [...current.keys()].filter(name => !recorded.has(name)).sort();
  const removed = [...recorded.keys()].filter(name => !current.has(name)).sort();
  const changed = [...current.entries()]
    .filter(([name, entity]) => recorded.has(name) && (
      recorded.get(name).table !== entity.table
      || recorded.get(name).columns !== entity.columns
      || recorded.get(name).constrained !== entity.constrained
      || recorded.get(name).tenant_key !== entity.tenant_key))
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
  if (args.some(argument => !['--json', '--summary', '--sql', '--update'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let plan; let sql;
  try { ({ plan, sql } = renderDdl(repository)); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'ENTITY_SCHEMAS_UNAVAILABLE' })); return 2; }
  if (args.includes('--sql')) { log(sql); return 0; }
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
