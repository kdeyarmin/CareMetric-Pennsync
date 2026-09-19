import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARRIED, EXPECTATIONS_FILE, FORMAT, FORMAT_VERSION, SCHEMA,
  buildPlan, columnType, comparePlan, enumValues, main, parseExpectations, planEntity, renderEntity, snakeCase,
} from './tools-entity-schema-plan.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const entity = (properties, name = 'Probe') => JSON.stringify({ name, type: 'object', properties, required: [], rls: {} });

test('the committed plan still matches the entity definitions', () => {
  const report = comparePlan(buildPlan(repository), parseExpectations(readFileSync(resolve(repository, EXPECTATIONS_FILE), 'utf8')));
  assert.deepEqual(report.added, [], 'A carried entity appeared. Regenerate the plan and review the new table.');
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.changed, []);
});

test('only entities dispositioned port or broker get a table', () => {
  const plan = buildPlan(repository);
  const dispositions = JSON.parse(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')).entities;
  for (const carried of plan.entities) {
    assert.ok(CARRIED.includes(dispositions[carried.entity]), `${carried.entity} should not be carried`);
  }
  // A paused or retired entity must not silently acquire a home here.
  assert.equal(plan.entities.some(carried => carried.entity === 'OASISAssessment'), false);
  assert.equal(plan.entities.some(carried => carried.entity === 'TrainingCourse'), false);
  assert.ok(plan.entities.some(carried => carried.entity === 'Patient'));
});

test('the plan never claims to be reviewed, indexed or applied', () => {
  const plan = buildPlan(repository);
  assert.equal(plan.reviewed, false);
  assert.equal(plan.applied_anywhere, false);
  assert.equal(plan.indexes_planned, false);
  assert.equal(plan.foreign_keys_planned, false);
  assert.equal(plan.retention_planned, false);
});

test('names become distinct, lowercase, PostgreSQL-safe identifiers', () => {
  assert.equal(snakeCase('PatientOutcomeMetric'), 'patient_outcome_metric');
  assert.equal(snakeCase('OASISAssessment'), 'oasis_assessment');
  assert.equal(snakeCase('PDGMRateConfig'), 'pdgm_rate_config');
  assert.equal(snakeCase('AIConfiguration'), 'ai_configuration');
  const plan = buildPlan(repository);
  const tables = plan.entities.map(carried => carried.table);
  assert.equal(new Set(tables).size, tables.length, 'table names must be unique');
  for (const table of tables) assert.match(table, /^[a-z][a-z0-9_]{0,62}$/);
});

test('property types map to durable PostgreSQL types', () => {
  assert.equal(columnType({ type: 'string' }), 'text');
  assert.equal(columnType({ type: 'string', format: 'date' }), 'date');
  assert.equal(columnType({ type: 'string', format: 'date-time' }), 'timestamptz');
  assert.equal(columnType({ type: 'string', format: 'email' }), 'text');
  assert.equal(columnType({ type: 'integer' }), 'bigint');
  assert.equal(columnType({ type: 'number' }), 'double precision');
  assert.equal(columnType({ type: 'boolean' }), 'boolean');
  assert.equal(columnType({ type: 'array' }), 'jsonb');
  assert.equal(columnType({ type: 'object' }), 'jsonb');
  assert.equal(columnType({}), 'text');
});

test('only a finite list of distinct strings becomes a constraint', () => {
  assert.deepEqual(enumValues({ enum: ['a', 'b'] }), ['a', 'b']);
  assert.equal(enumValues({ enum: [] }), null);
  assert.equal(enumValues({ enum: ['a', 'a'] }), null);
  assert.equal(enumValues({ enum: [1, 2] }), null);
  assert.equal(enumValues({ enum: Array.from({ length: 201 }, (_, index) => `v${index}`) }), null);
  assert.equal(enumValues({}), null);
});

test('reserved words and enum values are quoted and escaped', () => {
  const plan = planEntity('Probe', entity({
    type: { type: 'string', enum: ["it's", 'plain'] },
    order: { type: 'integer' },
    'weird name': { type: 'string' },
  }), 'port');
  const sql = renderEntity(plan);
  assert.match(sql, /"type" text/);
  assert.match(sql, /"order" bigint/);
  assert.match(sql, /"weird_name" text/);
  // A quote inside an enum value must not end the literal.
  assert.match(sql, /'it''s'/);
  assert.match(sql, new RegExp(`create table "${SCHEMA}"\\."probe"`));
  assert.match(sql, /force row level security/);
  assert.match(sql, /primary key \("source_app_id", "id"\)/);
});

test('an entity redeclaring a platform column merges instead of losing it', () => {
  const plan = planEntity('Probe', entity({ created_by: { type: 'string' }, note: { type: 'string' } }), 'port');
  assert.equal(plan.merged_system_columns, 1);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.columns, 1);
  const sql = renderEntity(plan);
  assert.equal(sql.match(/"created_by"/g).length, 1, 'created_by must appear exactly once');
});

test('a conflicting platform column is a reviewable error, never a silent drop', () => {
  assert.throws(() => planEntity('Probe', entity({ id: { type: 'string' } }), 'port'), /IDENTITY_COLUMN_REDEFINED/);
  assert.throws(() => planEntity('Probe', entity({ source_app_id: { type: 'string' } }), 'port'), /IDENTITY_COLUMN_REDEFINED/);
  assert.throws(() => planEntity('Probe', entity({ created_by: { type: 'boolean' } }), 'port'), /SYSTEM_COLUMN_TYPE_CONFLICT/);
});

test('a duplicate after normalization is recorded rather than overwriting a column', () => {
  const plan = planEntity('Probe', entity({ 'care type': { type: 'string' }, care_type: { type: 'string' } }), 'port');
  assert.equal(plan.columns, 1);
  assert.deepEqual(plan.skipped, [{ property: 'care_type', reason: 'DUPLICATE_AFTER_NORMALIZATION' }]);
});

test('a tenant key is recorded only where the entity actually carries one', () => {
  assert.equal(planEntity('Probe', entity({ agency_id: { type: 'string' } }), 'port').tenant_key, 'agency_id');
  assert.equal(planEntity('Probe', entity({ note: { type: 'string' } }), 'port').tenant_key, null);
  // Most carried entities still have no explicit tenant key; that gap is the
  // documented isolation blocker, so the count must stay visible.
  const plan = buildPlan(repository);
  assert.ok(plan.totals.tenant_scoped < plan.totals.carried);
});

test('plan changes are reported by entity', () => {
  const current = { entities: [{ entity: 'A', table: 'a', columns: 2, constrained: 0, tenant_key: null }] };
  assert.deepEqual(comparePlan(current, { entities: [] }).added, ['A']);
  assert.deepEqual(comparePlan({ entities: [] }, current).removed, ['A']);
  assert.deepEqual(comparePlan(current, {
    entities: [{ entity: 'A', table: 'a', columns: 3, constrained: 0, tenant_key: null }],
  }).changed, ['A']);
  assert.equal(comparePlan(current, current).matches_expectations, true);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify({ format: 'other', schema_version: FORMAT_VERSION, entities: [] }),
  wrongVersion: JSON.stringify({ format: FORMAT, schema_version: 2, entities: [] }),
  entitiesNotArray: JSON.stringify({ format: FORMAT, schema_version: FORMAT_VERSION, entities: {} }),
  entryMissingTable: JSON.stringify({ format: FORMAT, schema_version: FORMAT_VERSION, entities: [{ entity: 'A', columns: 1 }] }),
})) {
  test(`plan expectations reject ${name}`, () => assert.throws(() => parseExpectations(raw)));
}

test('the command line emits SQL, reports, updates and refuses unknown arguments', () => {
  const lines = [];
  assert.equal(main(['--sql'], { repository, log: value => lines.push(value) }), 0);
  assert.match(lines[0], new RegExp(`create schema "${SCHEMA}";`));
  assert.ok(lines[0].split('\n').length > 1000, 'the emitted schema should be substantial');
  lines.length = 0;
  assert.equal(main(['--summary'], { repository, log: value => lines.push(value) }), 0);
  assert.match(lines[0], /entity schema plan unchanged/);
  lines.length = 0;
  let written = null;
  assert.equal(main(['--update'], { repository, log: () => {}, write: (path, body) => { written = { path, body }; } }), 0);
  assert.ok(written.path.endsWith(EXPECTATIONS_FILE));
  assert.equal(parseExpectations(written.body).format, FORMAT);
  lines.length = 0;
  assert.equal(main(['--drop'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
});
