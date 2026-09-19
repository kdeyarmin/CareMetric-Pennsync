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

export function planEntity(name, raw, disposition) {
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
  return {
    entity: name,
    disposition,
    table,
    tenant_key: columns.some(column => column.name === 'agency_id') ? 'agency_id' : null,
    columns: columns.length,
    constrained: checks.length,
    merged_system_columns: merged.length,
    skipped,
    definition: { columns, checks },
  };
}

export function renderEntity(plan) {
  const qualified = `${quote(SCHEMA)}.${quote(plan.table)}`;
  const lines = [
    ...SYSTEM_COLUMNS.map(column => `  ${quote(column.name)} ${column.type}${column.notNull ? ' not null' : ''}`),
    ...plan.definition.columns.map(column => `  ${quote(column.name)} ${column.type}`),
    `  constraint ${quote(`${plan.table}_pkey`)} primary key (${quote('source_app_id')}, ${quote('id')})`,
    ...plan.definition.checks.map(check =>
      `  constraint ${quote(`${plan.table}_${check.column}_allowed`.slice(0, MAX_IDENTIFIER))} `
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

export function buildPlan(repository) {
  const dispositions = JSON.parse(readFileSync(join(repository, DISPOSITION_FILE), 'utf8')).entities;
  const directory = join(repository, ENTITY_DIRECTORY);
  const files = readdirSync(directory).filter(file => /\.jsonc?$/.test(file)).sort();
  const plans = [];
  const excluded = [];
  for (const file of files) {
    const name = file.replace(/\.jsonc?$/, '');
    const disposition = dispositions[name];
    if (!CARRIED.includes(disposition)) { excluded.push({ entity: name, disposition: disposition ?? 'missing' }); continue; }
    plans.push(planEntity(name, readFileSync(join(directory, file), 'utf8'), disposition));
  }
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

export function renderDdl(repository) {
  const plan = buildPlan(repository);
  const dispositions = JSON.parse(readFileSync(join(repository, DISPOSITION_FILE), 'utf8')).entities;
  const directory = join(repository, ENTITY_DIRECTORY);
  const files = readdirSync(directory).filter(file => /\.jsonc?$/.test(file)).sort();
  const statements = [
    `create schema ${quote(SCHEMA)};`,
  ];
  for (const file of files) {
    const name = file.replace(/\.jsonc?$/, '');
    if (!CARRIED.includes(dispositions[name])) continue;
    statements.push(renderEntity(planEntity(name, readFileSync(join(directory, file), 'utf8'), dispositions[name])));
  }
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
