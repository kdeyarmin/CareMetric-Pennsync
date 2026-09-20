import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARRIED, CHART_ROOT, CHART_SUBJECTS, EXPECTATIONS_FILE, FORMAT, FORMAT_VERSION, RECORD_MIGRATION_FILE, SCHEMA,
  buildPlan, chartPredicate, chartSubject, columnType, comparePlan, constraintName, enumValues, main, parseExpectations, planEntity, renderEntity, snakeCase,
} from './tools-entity-schema-plan.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const entity = (properties, name = 'Probe') => JSON.stringify({ name, type: 'object', properties, required: [], rls: {} });

test('the gate notices a change to any field the policies are derived from', async () => {
  const { buildPlan, comparePlan } = await import('./tools-entity-schema-plan.mjs');
  const plan = buildPlan(process.cwd());
  const accepted = JSON.parse(JSON.stringify(plan));
  assert.equal(comparePlan(plan, accepted).matches_expectations, true);

  // Each of these rewrites an emitted policy while leaving the table's shape
  // untouched, so a comparison over columns alone reports `unchanged`.
  const drifts = [
    ['tenant_decision', entity => entity.tenant_decision === 'agency'],
    ['self_subject', entity => entity.self_subject !== null],
    ['platform_flag', entity => entity.platform_flag !== null],
  ];
  for (const [field, pick] of drifts) {
    const target = accepted.entities.find(pick);
    assert.ok(target, `expected an entity with ${field} to drift`);
    const before = target[field];
    // Whatever it is now, this is not it.
    target[field] = `${before}_drifted`;
    const report = comparePlan(plan, accepted);
    assert.deepEqual(report.changed, [target.entity], `${field} drift must be reported`);
    assert.equal(report.matches_expectations, false);
    target[field] = before;
  }
});

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

test('two constraints that would share a truncated name fail instead of merging', () => {
  // Both column names are legal (63 characters) and differ only past the point
  // where PostgreSQL truncates the constraint name, so the two constraints
  // would silently become one.
  const shared = 'w'.repeat(57);
  const plan = planEntity('Probe', entity({
    [`${shared}alpha1`]: { type: 'string', enum: ['a'] },
    [`${shared}beta02`]: { type: 'string', enum: ['b'] },
  }), 'port');
  assert.equal(plan.constrained, 2, 'both columns must survive planning');
  assert.equal(constraintName('probe', `${shared}alpha1`), constraintName('probe', `${shared}beta02`));
  assert.throws(() => renderEntity(plan), /CONSTRAINT_NAME_COLLISION/);
});

test('every real constraint name fits without truncation', () => {
  const plan = buildPlan(repository);
  for (const carried of plan.entities) {
    assert.ok(carried.table.length + 40 < 200, `${carried.entity} table name is implausible`);
  }
  // Rendering the whole repository must not hit the collision guard.
  assert.doesNotThrow(() => main(['--sql'], { repository, log: () => {} }));
});

test('every table that names a chart is narrowed to it, by its own predicate or a borrowed one', () => {
  // D24, and the property this asserts is the one a first version got wrong:
  // belonging to the caller's agency is not the same as being a chart the
  // caller may open. A reference predicate inlines the target's TENANT check,
  // so narrowing `Patient` alone left `document`, `medication`, `patient_alert`
  // and fifty-one others agency-wide — every row of a chart the caller was
  // never assigned to.
  //
  // It is checked against the emitted SQL rather than against a list, because
  // a list is the thing that would need remembering. 58 carried entities name
  // a patient.
  const sql = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  const narrowed = new Set();
  for (const match of sql.matchAll(/create policy "([a-z0-9_]+)_read" on [^;]+;/g)) {
    if (match[0].includes('caller_assigned_patients')) narrowed.add(match[1]);
  }
  const plan = JSON.parse(readFileSync(resolve(repository, EXPECTATIONS_FILE), 'utf8')).entities;
  const paths = new Map(JSON.parse(readFileSync(resolve(repository, 'tools-tenant-path-expectations.json'), 'utf8'))
    .entities.map(entry => [entry.entity, entry]));
  const subjects = new Map(plan.map(entry => [entry.entity, entry.chart_subject ?? null]));
  const namesAChart = (entity) => entity === CHART_ROOT || subjects.get(entity) !== null;
  const reaches = (entity, seen = new Set()) => {
    if (seen.has(entity)) return false;
    seen.add(entity);
    const path = paths.get(entity);
    if (!path || path.kind !== 'reference') return false;
    return namesAChart(path.target) || reaches(path.target, seen);
  };
  const missing = plan.filter(entry => (namesAChart(entry.entity) || reaches(entry.entity))
    && !narrowed.has(entry.table)).map(entry => entry.entity);
  assert.deepEqual(missing, [], 'a table naming a chart must be narrowed to it');
  assert.ok(narrowed.size > 50, `expected the chart surface to be substantial, found ${narrowed.size}`);
  // And the converse: nothing is narrowed that has no chart to narrow to, or
  // the rule would be quietly hiding rows it was never meant to touch.
  const spurious = plan.filter(entry => narrowed.has(entry.table)
    && !namesAChart(entry.entity) && !reaches(entry.entity)).map(entry => entry.entity);
  assert.deepEqual(spurious, []);
});

test('the chart subject is derived from the columns, never from a name', () => {
  // Derivation is what makes this a safety rule rather than a checklist: an
  // entity that grows a `patient_id` is narrowed by the next regeneration
  // whether or not anybody remembered.
  const plan = (properties, name = 'Probe') => planEntity(name, entity(properties, name), 'port');
  const agency = { agency_id: { type: 'string' } };
  for (const column of CHART_SUBJECTS) {
    assert.equal(plan({ ...agency, [column]: { type: 'string' } }).chart_subject, column, column);
  }
  // The chart root is its own chart, keyed on its identity — which it never
  // declares, because `id` is a platform column every table already carries.
  assert.equal(plan(agency, CHART_ROOT).chart_subject, 'id');
  // No patient column, no narrowing — and no agency column either, because a
  // predicate that cannot name an agency cannot ask who opens its charts.
  assert.equal(plan({ ...agency, note: { type: 'string' } }).chart_subject, null);
  assert.equal(plan({ patient_id: { type: 'string' } }).chart_subject, null,
    'a row with no tenancy of its own borrows the narrowing through its reference');
  // Another clinical subject is deliberately not a chart key: those rows reach
  // a chart through the entity they reference, and adding a second key would
  // mean a second set to keep in agreement.
  assert.equal(plan({ ...agency, visit_id: { type: 'string' } }).chart_subject, null);
  // Called directly it is the same function, with nothing read off a plan.
  assert.equal(chartSubject('Probe', 'agency_id', [{ name: 'patient_id' }]), 'patient_id');
  assert.equal(chartSubject('Probe', null, [{ name: 'patient_id' }]), null);

  // The predicate itself: an absent subject stays with its agency, except on
  // the chart root where the subject is the primary key and cannot be absent.
  const withPatient = chartPredicate(plan({ ...agency, patient_id: { type: 'string' } }), '"t"');
  assert.match(withPatient, /"patient_id" is null or/);
  assert.match(withPatient, /caller_opens_every_chart\("t"\."agency_id"\)/);
  assert.match(withPatient, /caller_assigned_patients\("t"\."agency_id"\)/);
  const root = chartPredicate(plan(agency, CHART_ROOT), '"t"');
  assert.ok(!root.includes('is null'), 'the chart root has no absent-subject case');
  assert.equal(chartPredicate(plan({ ...agency, note: { type: 'string' } }), '"t"'), null);
  assert.equal(chartPredicate(null, '"t"'), null);
});
