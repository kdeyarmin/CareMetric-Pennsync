import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARRIED, CHART_ROOT, CHART_SUBJECTS, DECLARED_IMMUTABLE, DECLARED_UNIQUE, EXPECTATIONS_FILE,
  FORMAT, FORMAT_VERSION, IMMUTABILITY_CLAIM, IMMUTABLE_KINDS,
  CONTRACT_UNIQUE, RECORD_MIGRATION_FILE, SCHEMA, UNIQUENESS_CLAIM, UNIQUE_KINDS,
  buildPlan, chartPredicate, chartSubject, columnType, comparePlan, constraintName, contractUniqueKeys, contractUniqueName, declaredImmutability, declaredUniqueness, enumValues, main, parseExpectations, planEntity, renderEntity, renderPolicies, snakeCase, uniqueIndexName,
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
  // A binding path borrows its source's narrowing exactly as a reference
  // borrows its target's — the difference is which side holds the key, not
  // what travels — so both hops count here. Leaving `binding` out reported
  // `Document` and the two tables that reference it as narrowed for no
  // reason, which is the shape of a rule quietly hiding rows.
  const BORROWING = ['reference', 'binding'];
  const reaches = (entity, seen = new Set()) => {
    if (seen.has(entity)) return false;
    seen.add(entity);
    const path = paths.get(entity);
    if (!path || !BORROWING.includes(path.kind)) return false;
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

test('every key a schema says would be unique is accounted for, and eight say so', () => {
  // The claim is the SCHEMAS', not this tool's: eleven descriptions say a key
  // would be unique if the datastore allowed one, and every one of them is a
  // server-derived idempotency or identity key with a hand-written duplicate
  // check in the capability that writes it. We own the datastore now.
  const found = declaredUniqueness(repository);
  const keys = [...found.values()].flat().map(claim => `${claim.entity}.${claim.property}`).sort();
  assert.deepEqual(keys, Object.keys(DECLARED_UNIQUE).sort(),
    'a claim in a schema and not in the list, or the other way round');
  assert.equal(keys.length, 11);
  const byKind = kind => Object.entries(DECLARED_UNIQUE)
    .filter(([, claim]) => claim.kind === kind).map(([key]) => key);
  assert.deepEqual(byKind('unique'), ['AgencyMembership.membership_key',
    'DocumentTenantBinding.binding_key', 'Message.message_creation_key',
    'Notification.dedupe_key', 'Patient.patient_creation_key',
    'PatientCareTeamAssignment.assignment_key', 'Referral.referral_creation_key',
    'ScheduledFax.schedule_key']);
  // Two schemas say uniqueness "must still be proved before migration", which
  // is a statement about the EXISTING rows rather than a hedge. An index would
  // fail to build on import and building it is not what proves the data.
  assert.deepEqual(byKind('unproved'),
    ['ContentScopeBinding.binding_key', 'PhysicianAgencyProfile.profile_key']);
  // And one is unique among ACTIVE rows only, which is an authority decision
  // about telecom routing rather than something to read off a sentence.
  assert.deepEqual(byKind('conditional'), ['TelecomDestinationBinding.binding_key']);
  // Every kind that withholds an index owes a reason, because "no index" and
  // "no index yet, and here is what would settle it" are different states.
  for (const [key, claim] of Object.entries(DECLARED_UNIQUE)) {
    assert.ok(UNIQUE_KINDS.includes(claim.kind), key);
    if (claim.kind !== 'unique') assert.ok(claim.because?.length > 20, `${key} says why`);
  }
});

test('a claim that appears, moves or loses its column fails the run', () => {
  const claims = properties => declaredUniqueness(null, () => [['Probe', { properties }]]);
  // The half that matters: the next key like this will be written by somebody
  // who has not read the enumeration, so an unenumerated claim is an error
  // rather than a field that quietly gets no constraint.
  assert.throws(() => claims({ new_key: { type: 'string', description: 'datastore uniqueness is not assumed.' } }),
    error => /^UNIQUENESS_CLAIM_UNENUMERATED:/.test(error.message));
  // And a claim the enumeration still carries after the schema dropped it.
  assert.throws(() => claims({}), error => /^UNIQUENESS_CLAIM_STALE:/.test(error.message));
  // A claimed column that is not a column of the table it belongs to.
  assert.throws(() => planEntity('Probe', entity({ kept: { type: 'string' } }), 'port', null,
    [{ entity: 'Probe', property: 'gone_key', column: 'gone_key', kind: 'unique' }]),
  error => error.message === 'UNIQUENESS_COLUMN_MISSING:Probe.gone_key');
  // The phrase is what locates a claim, and it is the schemas' own wording.
  for (const said of ['datastore uniqueness is not assumed', 'schema-level uniqueness is not assumed',
    'Best-effort until Base44 exposes a datastore uniqueness constraint',
    'schema uniqueness is not assumed', 'Datastore uniqueness must still be proved before migration']) {
    assert.ok(UNIQUENESS_CLAIM.test(said), said);
  }
  assert.equal(UNIQUENESS_CLAIM.test('Server-derived key for a workflow.'), false);
});

test('a declared unique key becomes a partial index on the deployment and the key', () => {
  const sql = renderEntity(planEntity('Probe',
    entity({ probe_key: { type: 'string' }, other: { type: 'string' } }), 'port', null,
    [{ entity: 'Probe', property: 'probe_key', column: 'probe_key', kind: 'unique' }]));
  assert.match(sql, /create unique index "probe_probe_key_unique" on "pennsync_records"\."probe" \("source_app_id", "probe_key"\)/);
  // Partial, because an absent key is not a duplicate of another absent key:
  // these columns are null on every row whose capability does not key on them,
  // and an empty string is how a caller sends "none" through a text field.
  assert.match(sql, /where "probe_key" is not null and "probe_key" <> ''/);
  // A kind that withholds the index emits nothing at all, rather than a
  // commented-out index somebody would later uncomment without the proof.
  for (const kind of ['unproved', 'conditional']) {
    assert.equal(renderEntity(planEntity('Probe',
      entity({ probe_key: { type: 'string' } }), 'port', null,
      [{ entity: 'Probe', property: 'probe_key', column: 'probe_key', kind, because: 'x' }]))
      .includes('create unique index'), false, kind);
  }
  // Long names truncate, and two that truncate to one name would silently
  // become one index — the same hazard `constraintName` already guards.
  assert.equal(uniqueIndexName('t'.repeat(60), 'c').length, 63);
});

test('the committed migration carries an index for every carried unique key', () => {
  const plan = buildPlan(repository);
  const declared = plan.entities.flatMap(row => row.unique_keys.map(column => `${row.table}_${column}_unique`)).sort();
  const byContract = plan.entities.flatMap(row => row.contract_unique_keys.map(key => key.index)).sort();
  const expected = [...declared, ...byContract].sort();
  const sql = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  const emitted = [...sql.matchAll(/create unique index "([a-z_]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(emitted, expected);
  assert.equal(plan.totals.unique_keys, declared.length);
  assert.equal(plan.totals.contract_unique_keys, byContract.length);
  // Six of the eight `unique` claims, because `Message` and `ScheduledFax` get
  // no table here at all — their entities are not carried, and a claim in a
  // schema without a table is still enumerated rather than forgotten.
  assert.equal(declared.length, 6);
  assert.ok(emitted.includes('patient_patient_creation_key_unique'));
  // And the two `unproved` ones are not among them, which is the whole of
  // what their schemas asked for.
  for (const table of ['content_scope_binding', 'physician_agency_profile']) {
    assert.equal(emitted.some(name => name.startsWith(table)), false, table);
  }
});

test('a contract key becomes a partial composite index over the columns it names', () => {
  // `renderEntity` is a pure function of the plan, so the enumeration is
  // injected rather than edited: a test that had to add a real key to
  // `CONTRACT_UNIQUE` to exercise the emitter would be changing the store.
  const plan = planEntity('Probe', entity({
    email: { type: 'string' }, day: { type: 'string', format: 'date' },
    live: { type: 'boolean' },
  }), 'port');
  plan.contract_unique_keys = contractUniqueKeys('Probe', plan.table, plan.definition.columns, {
    'Probe.window': { columns: ['email', 'day'], live: 'live',
      contract: 'contract_probe', migration: 'probe.sql', because: 'a reason' },
  });
  const sql = renderEntity(plan);
  assert.match(sql, /create unique index "probe_window_unique" on "pennsync_records"\."probe" \("source_app_id", "email", "day"\)/);
  // `<> ''` only where the column is TEXT. An empty string is how a caller
  // sends "none" through a text field; a date has no empty value to send, and
  // `"day" <> ''` would not even be valid SQL.
  assert.match(sql, /where "email" is not null and "email" <> '' and "day" is not null and "live" is not false;/);
  // A key with no live flag emits no predicate for one.
  plan.contract_unique_keys = contractUniqueKeys('Probe', plan.table, plan.definition.columns, {
    'Probe.window': { columns: ['email'], contract: 'c', migration: 'm.sql', because: 'r' },
  });
  assert.match(renderEntity(plan), /where "email" is not null and "email" <> '';/);
  // And the two families share one collision check, because they truncate at
  // the same length and two indexes with one name silently become one.
  assert.equal(contractUniqueName('t'.repeat(60), 'k').length, 63);
  assert.throws(() => renderEntity({ ...plan, unique_keys: ['window_unique_x'],
    contract_unique_keys: [{ key: 'w', index: 'probe_window_unique_x_unique', columns: ['email'], live: null }] }),
  error => /^UNIQUE_INDEX_NAME_COLLISION:/.test(error.message));
});

test('a contract key that drifts from the table it constrains fails the run', () => {
  const columns = [{ name: 'email', type: 'text' }, { name: 'live', type: 'boolean' }];
  const raise = declared => contractUniqueKeys('Probe', 'probe', columns, declared);
  const key = (extra = {}) => ({ 'Probe.window': { columns: ['email'],
    contract: 'c', migration: 'm.sql', because: 'r', ...extra } });
  // Each of these is a way the enumeration and the tables could drift apart
  // while both still looked right on their own page.
  assert.throws(() => raise({ 'Probe.Window': key()['Probe.window'] }),
    error => error.message === 'CONTRACT_UNIQUE_KEY_INVALID:Probe.Window');
  assert.throws(() => raise(key({ because: undefined })),
    error => error.message === 'CONTRACT_UNIQUE_REASON_MISSING:Probe.window');
  // The contract and the migration are what make the index NAME checkable,
  // which is the whole reason this family exists rather than a bare index.
  for (const missing of ['contract', 'migration']) {
    assert.throws(() => raise(key({ [missing]: undefined })),
      error => error.message === 'CONTRACT_UNIQUE_CONTRACT_MISSING:Probe.window');
  }
  assert.throws(() => raise(key({ columns: [] })),
    error => error.message === 'CONTRACT_UNIQUE_COLUMNS_EMPTY:Probe.window');
  assert.throws(() => raise(key({ columns: ['email', 'email'] })),
    error => error.message === 'CONTRACT_UNIQUE_COLUMN_REPEATED:Probe.window');
  // The deployment is prepended by the emitter, so naming it would index it twice.
  assert.throws(() => raise(key({ columns: ['source_app_id', 'email'] })),
    error => error.message === 'CONTRACT_UNIQUE_COLUMN_RESERVED:Probe.window');
  // A column renamed in a schema. This is the one that would otherwise be
  // silent: the index would simply not be emitted and the contract would catch
  // a constraint that no longer exists.
  assert.throws(() => raise(key({ columns: ['gone'] })),
    error => error.message === 'CONTRACT_UNIQUE_COLUMN_UNKNOWN:Probe.window.gone');
  assert.throws(() => raise(key({ live: 'email' })),
    error => error.message === 'CONTRACT_UNIQUE_LIVE_INVALID:Probe.window');
  assert.throws(() => raise(key({ live: 'absent' })),
    error => error.message === 'CONTRACT_UNIQUE_LIVE_INVALID:Probe.window');
  // A flag inside the key would make its two states two rows, which is the
  // opposite of what a partial index over it says.
  assert.throws(() => raise({ 'Probe.window': { columns: ['email', 'live'], live: 'live',
    contract: 'c', migration: 'm.sql', because: 'r' } }),
  error => error.message === 'CONTRACT_UNIQUE_LIVE_IN_KEY:Probe.window');
  // A key on an entity with no table emits nothing and says nothing, which is
  // exactly how the declared family would have drifted without its stale check.
  assert.throws(() => buildPlan(repository, {
    plans: [{ entity: 'Elsewhere', table: 'elsewhere', unique_keys: [], contract_unique_keys: [],
      columns: 0, constrained: 0, skipped: [], merged_system_columns: 0 }],
    excluded: [],
  }), error => /^CONTRACT_UNIQUE_ENTITY_NOT_CARRIED:/.test(error.message));
});

test('every contract key is caught by name in the contract that names it', () => {
  // D30 says a rename "turns a correct retry answer into a raw database error"
  // and nothing checked it. This is the check: the enumeration names a
  // migration, the migration has to compare the caught constraint against
  // exactly this index, and the function it claims to belong to has to be there.
  const plan = buildPlan(repository);
  const keys = plan.entities.flatMap(row => row.contract_unique_keys);
  assert.equal(keys.length, 3, 'three contracts depend on a key of their own');
  assert.deepEqual(keys.map(key => key.index).sort(),
    ['policy_acknowledgment_distribution_unique', 'timesheet_period_unique',
      'visit_point_config_active_agency_unique']);
  for (const key of keys) {
    const sql = readFileSync(resolve(repository,
      'services/authority-store/supabase/record-migrations', key.migration), 'utf8');
    assert.ok(sql.includes(`create function "pennsync_records".${key.contract}(`),
      `${key.migration} defines ${key.contract}`);
    // The comparison, not merely the string: a header that MENTIONS the index
    // while the code catches something else is the shape D36 warns about.
    assert.match(sql, new RegExp(`v_constraint is distinct from '${key.index}'`),
      `${key.contract} catches ${key.index} by name`);
    // And it re-raises anything else, so an unrelated unique violation is not
    // swallowed as this one.
    assert.match(sql, /get stacked diagnostics v_constraint = constraint_name;/);
  }
  // Every entry owes a reason, and a real one: this is the only place the
  // argument for the constraint is written down.
  for (const [name, entry] of Object.entries(CONTRACT_UNIQUE)) {
    assert.ok(entry.because.length > 200, `${name} says why at length`);
  }
});

test('an entity whose schema calls the ROW immutable gets no update or delete policy', () => {
  // Twelve entity descriptions mention immutability and four of them say it
  // about the ROW. The other eight say it about a field inside a row that is
  // otherwise versioned — `AgencyMembership` binds "an immutable Base44 User
  // id" and then transitions through a whole lifecycle — so a regular
  // expression cannot tell them apart and all twelve are enumerated.
  const rows = declaredImmutability(repository);
  assert.deepEqual([...rows].sort(), ['ContentScopeBinding', 'DocumentTenantBinding',
    'FleetServiceReview', 'PatientNoteHistoryEntry', 'SignatureArtifactBinding',
    'SignatureAuditEvent', 'SmsConsent']);
  assert.equal(Object.keys(DECLARED_IMMUTABLE).length, 12);
  for (const [entity, claim] of Object.entries(DECLARED_IMMUTABLE)) {
    assert.ok(IMMUTABLE_KINDS.includes(claim.kind), entity);
    // A `field` claim withholds the guarantee, so it owes a reason; a `row`
    // claim takes the description at its word and needs none.
    if (claim.kind === 'field') assert.ok(claim.because?.length > 20, `${entity} says why`);
    else assert.equal(claim.because, undefined, entity);
  }
  // The plan carries it, so the checked-in artefact says which tables cannot
  // be rewritten rather than leaving it to be re-derived.
  const plan = buildPlan(repository);
  const carried = plan.entities.filter(entity => entity.append_only).map(entity => entity.entity);
  assert.deepEqual(carried.sort(), ['ContentScopeBinding', 'DocumentTenantBinding',
    'FleetServiceReview', 'PatientNoteHistoryEntry'], 'the three uncarried ones have no table');
  assert.equal(plan.totals.append_only, 4);
});

test('a new immutability claim, or one that moved, fails the run', () => {
  const claims = description => declaredImmutability(null, () => [['Probe', { description }]]);
  // The half that matters: somebody writes "append-only" on a new entity and
  // the generator stops until a kind is decided, rather than that entity
  // quietly getting update and delete policies.
  assert.throws(() => claims('Append-only ledger of something.'),
    error => /^IMMUTABILITY_CLAIM_UNENUMERATED:Probe/.test(error.message));
  assert.throws(() => claims('An ordinary entity.'),
    error => /^IMMUTABILITY_CLAIM_STALE:/.test(error.message));
  // A description that no longer says it, for an entity the list still names.
  assert.ok(IMMUTABILITY_CLAIM.test('Immutable, server-authored clinical-note revision.'));
  assert.ok(IMMUTABILITY_CLAIM.test('Append-only vehicle-service review annotations.'));
  assert.equal(IMMUTABILITY_CLAIM.test('An ordinary clinical record.'), false);
});

test('the append-only policies are an absence, not a predicate that says no', () => {
  // The mechanism is the same one the activity trail and the roster use: with
  // no policy for a command, forced RLS refuses it from everyone including the
  // table owner. A permissive-looking policy that evaluates false would be one
  // edit away from being true.
  const definition = entity('Probe', { agency_id: { type: 'string' }, note: { type: 'string' } });
  const resolution = {
    paths: new Map([['Probe', { entity: 'Probe', kind: 'direct' }]]),
    tables: new Map([['Probe', 'probe']]),
    plans: new Map(),
  };
  const mutable = planEntity('Probe', definition, 'port', { kind: 'agency' });
  resolution.plans.set('Probe', mutable);
  const four = renderPolicies(mutable, resolution);
  assert.equal(four.length, 4);
  const appendOnly = planEntity('Probe', definition, 'port', { kind: 'agency' }, [], true);
  resolution.plans.set('Probe', appendOnly);
  const two = renderPolicies(appendOnly, resolution);
  assert.deepEqual(two.slice(0, 2), four.slice(0, 2), 'the read and the insert are unchanged');
  assert.equal(two.filter(line => line.startsWith('create policy')).length, 2);
  assert.match(two.at(-1), /^-- probe: append-only by its own schema/);
  for (const line of two) assert.equal(/for (update|delete)/.test(line), false);
});
