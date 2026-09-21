import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BINDING_TENANCY, BLOCKING_KINDS, EXPECTATIONS_FILE, FORMAT, FORMAT_VERSION, KINDS,
  RESOLVING_KINDS, ROOT_ENTITY,
  applyBindingTenancy, buildPaths, carriedEntities, comparePaths, isActorColumn, main, normalize, parseExpectations, referenceColumns,
} from './tools-tenant-path.mjs';
import { STAMPED_KINDS } from './tools-entity-schema-plan.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const paths = buildPaths(repository);
const byEntity = new Map(paths.entities.map(entry => [entry.entity, entry]));

test('the committed tenant paths still match the entity definitions', () => {
  const report = comparePaths(paths, parseExpectations(readFileSync(resolve(repository, EXPECTATIONS_FILE), 'utf8')));
  assert.deepEqual(report.added, [], 'A carried entity appeared. Regenerate and review its tenant path.');
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.changed, [], 'An entity changed how its agency is reached. Review before regenerating.');
});

test('every carried entity is classified exactly once', () => {
  const carried = carriedEntities(repository);
  assert.equal(paths.entities.length, carried.length);
  assert.deepEqual(paths.entities.map(entry => entry.entity), carried);
  for (const entry of paths.entities) assert.ok(KINDS.includes(entry.kind), `${entry.entity} has kind ${entry.kind}`);
  assert.equal(new Set(paths.entities.map(entry => entry.entity)).size, paths.entities.length);
});

test('the anchors are the ones authority actually rests on', () => {
  assert.deepEqual(byEntity.get(ROOT_ENTITY), { entity: 'Agency', kind: 'root', via: null, target: null, depth: 0 });
  for (const name of ['Patient', 'Visit', 'AgencyMembership']) {
    assert.equal(byEntity.get(name).kind, 'direct', `${name} should carry its own agency_id`);
    assert.equal(byEntity.get(name).depth, 1);
  }
});

test('a self-editable profile is never a tenant key', () => {
  // User.agency_id is a claim the account can rewrite about itself. Treating it
  // as authority is the defect that paused analyzeClinicalData.
  const user = byEntity.get('User');
  assert.equal(user.kind, 'profile_claim');
  assert.equal(user.via, 'agency_id');
  assert.equal(user.depth, null, 'a claim has no depth because it is not a path');
  assert.ok(BLOCKING_KINDS.includes(user.kind));
});

test('a reference resolves only through an entity that is itself resolved', () => {
  for (const entry of paths.entities.filter(item => item.kind === 'reference')) {
    const target = byEntity.get(entry.target);
    assert.ok(target, `${entry.entity} points at unknown ${entry.target}`);
    assert.ok(RESOLVING_KINDS.includes(target.kind),
      `${entry.entity} resolves through ${entry.target}, which is ${target.kind}`);
    assert.equal(entry.depth, target.depth + 1, `${entry.entity} depth should be one past ${entry.target}`);
    assert.ok(entry.depth >= 2 && entry.depth <= paths.totals.max_depth);
  }
});

test('the isolation gap stays counted rather than estimated', () => {
  const blocking = paths.entities.filter(entry => BLOCKING_KINDS.includes(entry.kind));
  assert.equal(paths.totals.blocking, blocking.length);
  assert.ok(paths.totals.blocking > 0, 'the gap is real; a zero here means the detector broke');
  // Summed from the kinds themselves rather than from a list of them, so a
  // kind added later is counted instead of quietly dropped — which is what
  // happened when D27 added `binding` and this line still named five.
  assert.equal(paths.totals.carried,
    KINDS.reduce((total, kind) => total + paths.totals[kind], 0));
  // Agreed with the schema plan. Its tenant-scoped count is every table that
  // ends up with agency_id: the ones that declared it (the direct keys plus the
  // one profile claim) and the ones a decision stamps it onto. The gap this
  // test counts is closed by deciding, not by the resolver getting cleverer,
  // so the two numbers are kept in agreement here rather than restated.
  const plan = JSON.parse(readFileSync(resolve(repository, 'tools-entity-schema-plan-expectations.json'), 'utf8'));
  const decisions = JSON.parse(readFileSync(resolve(repository, 'tools-tenant-decision.json'), 'utf8')).entities;
  const stamped = Object.values(decisions).filter(decision => STAMPED_KINDS.includes(decision.kind)).length;
  const declared = paths.totals.direct + paths.totals.profile_claim;
  assert.equal(plan.totals.tenant_scoped, declared + stamped);
  assert.equal(plan.totals.carried, paths.totals.carried);
  // Every blocking entity is decided, the profile claim included. It used to
  // be the one exception — excluded from authorization rather than decided,
  // because every kind then available would have authorized through the very
  // column its subject can rewrite. D23 adds `roster`, which does not read
  // that column at all, so nothing is left unowned and nothing is exempt.
  assert.equal(paths.totals.blocking, Object.keys(decisions).length);
  assert.equal(paths.totals.profile_claim, 1);
  assert.equal(decisions.User.kind, 'roster');
});

test('the plan never claims a path was reviewed or a policy written', () => {
  assert.equal(paths.reviewed, false);
  assert.equal(paths.policies_written, false);
});

test('an actor column names the acting account, not any person on the record', () => {
  for (const column of ['created_by', 'created_by_user_id', 'approved_by', 'updated_by_email',
    'user_id', 'user_email', 'assigned_user_email', 'invited_by']) {
    assert.equal(isActorColumn(column), true, `${column} should be an actor column`);
  }
  // A person the record is about, or a display name, identifies no account.
  for (const column of ['provider_email', 'nurse_email', 'employee_email', 'billing_contact_email',
    'user_name', 'patient_id', 'agency_id', 'standby', 'supply_id']) {
    assert.equal(isActorColumn(column), false, `${column} should not be an actor column`);
  }
});

test('reference columns are matched by name, ignoring case and separators', () => {
  assert.equal(normalize('OASISAssessment'), 'oasisassessment');
  assert.equal(normalize('oasis_assessment'), 'oasisassessment');
  const known = new Map([['patient', 'Patient'], ['oasisassessment', 'OASISAssessment']]);
  assert.deepEqual(referenceColumns({
    patient_id: {}, oasis_assessment_id: {}, agency_id: {}, created_by_user_id: {}, nowhere_id: {}, note: {},
  }, known), [
    { column: 'oasis_assessment_id', target: 'OASISAssessment' },
    { column: 'patient_id', target: 'Patient' },
  ]);
  // The tenant column and actor columns are never reference hops.
  assert.deepEqual(referenceColumns({ agency_id: {}, user_id: {} }, new Map([['agency', 'Agency'], ['user', 'User']])), []);
});

test('path changes are reported by entity', () => {
  const current = { entities: [{ entity: 'A', kind: 'direct', via: 'agency_id', target: null, depth: 1 }] };
  assert.deepEqual(comparePaths(current, { entities: [] }).added, ['A']);
  assert.deepEqual(comparePaths({ entities: [] }, current).removed, ['A']);
  assert.deepEqual(comparePaths(current, {
    entities: [{ entity: 'A', kind: 'actor', via: 'created_by', target: null, depth: null }],
  }).changed, ['A']);
  assert.equal(comparePaths(current, current).matches_expectations, true);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify({ format: 'other', schema_version: FORMAT_VERSION, entities: [] }),
  wrongVersion: JSON.stringify({ format: FORMAT, schema_version: 2, entities: [] }),
  entitiesNotArray: JSON.stringify({ format: FORMAT, schema_version: FORMAT_VERSION, entities: {} }),
  unknownKind: JSON.stringify({ format: FORMAT, schema_version: FORMAT_VERSION, entities: [{ entity: 'A', kind: 'maybe' }] }),
})) {
  test(`tenant path expectations reject ${name}`, () => assert.throws(() => parseExpectations(raw)));
}

test('the command line reports, lists blockers, updates and refuses unknown arguments', () => {
  const lines = [];
  assert.equal(main(['--summary'], { repository, log: value => lines.push(value) }), 0);
  assert.match(lines[0], /tenant paths unchanged/);
  assert.match(lines[0], /blocking=\d+/);
  lines.length = 0;
  assert.equal(main(['--blocking'], { repository, log: value => lines.push(value) }), 0);
  assert.equal(lines.length, paths.totals.blocking);
  for (const line of lines) assert.ok(BLOCKING_KINDS.includes(line.split('\t')[0]));
  lines.length = 0;
  let written = null;
  assert.equal(main(['--update'], { repository, log: () => {}, write: (path, body) => { written = { path, body }; } }), 0);
  assert.ok(written.path.endsWith(EXPECTATIONS_FILE));
  assert.equal(parseExpectations(written.body).format, FORMAT);
  lines.length = 0;
  assert.equal(main(['--apply'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
});

test('a binding path is a declared claim, and every part of it is re-checked', () => {
  // D27. `Document` has no `agency_id`, so following the columns it holds
  // reaches `Patient` — which reads as tenancy and is not: a document bound to
  // an agency and no patient then belongs to nobody. The binding table is what
  // carries the agency, and the claim says so by name.
  const document = paths.entities.find(entry => entry.entity === 'Document');
  assert.deepEqual(document,
    { entity: 'Document', kind: 'binding', via: 'document_id', target: 'DocumentTenantBinding', depth: 2 });
  // The source must carry its own agency, or the claim would move the question
  // rather than answer it.
  const source = paths.entities.find(entry => entry.entity === 'DocumentTenantBinding');
  assert.equal(source.kind, 'direct');
  assert.equal(document.depth, source.depth + 1);
  // Declared, never inferred. "Some carried table references me and has an
  // agency" is true of dozens of tables, and inferring from it would let any
  // of them authorize the row — including one a caller can write.
  assert.deepEqual(Object.keys(BINDING_TENANCY), ['Document']);
  for (const claim of Object.values(BINDING_TENANCY)) {
    assert.ok(typeof claim.because === 'string' && claim.because.length > 40,
      'a claim states why, because the next one will be read against this one');
  }
  // And a binding resolves a reference, exactly as a reference does: the two
  // tables that reference `Document` reach their tenancy through it.
  assert.ok(RESOLVING_KINDS.includes('binding'));
  for (const entity of ['EmbedConfig', 'TermsAcceptanceAudit']) {
    const entry = paths.entities.find(row => row.entity === entity);
    assert.equal(entry.kind, 'reference');
    assert.equal(entry.target, 'Document');
  }
});

test('a binding claim that does not hold refuses to build rather than falling back', () => {
  // The fallback is the danger: a claim written to replace a wrong path must
  // not quietly restore it when the claim stops being true. Exercised against
  // the real resolver with synthetic inputs, so these are the checks that run
  // and not a second copy of them.
  const base = () => ({
    resolved: new Map([['Binder', { kind: 'direct', via: 'agency_id', target: null, depth: 1 }],
      ['Owned', { kind: 'direct', via: 'agency_id', target: null, depth: 1 }],
      ['Hop', { kind: 'reference', via: 'binder_id', target: 'Binder', depth: 2 }]]),
    names: ['Binder', 'Bound', 'Owned', 'Hop'],
    properties: new Map([['Binder', { agency_id: {}, bound_id: {} }], ['Bound', { title: {} }],
      ['Owned', { agency_id: {} }], ['Hop', { binder_id: {} }]]),
  });
  const refuses = (claims, code) => assert.throws(() => applyBindingTenancy(base(), claims),
    error => {
      assert.match(String(error?.message), new RegExp(`^${code}`));
      return true;
    }, code);

  // The happy path first, so the refusals below are about the claim rather
  // than about the harness.
  const good = base();
  applyBindingTenancy(good, { Bound: { source: 'Binder', via: 'bound_id' } });
  assert.deepEqual(good.resolved.get('Bound'),
    { kind: 'binding', via: 'bound_id', target: 'Binder', depth: 2 });

  refuses({ Missing: { source: 'Binder', via: 'bound_id' } }, 'BINDING_TENANCY_NOT_CARRIED');
  // An entity with its own agency is already resolved; a claim on it would
  // replace a direct key with a join.
  refuses({ Owned: { source: 'Binder', via: 'bound_id' } }, 'BINDING_TENANCY_HAS_OWN_TENANT');
  refuses({ Bound: { source: 'Nobody', via: 'bound_id' } }, 'BINDING_SOURCE_NOT_CARRIED');
  // A source that does not carry its own agency moves the question one table
  // along rather than answering it.
  refuses({ Bound: { source: 'Hop', via: 'bound_id' } }, 'BINDING_SOURCE_NOT_DIRECT');
  refuses({ Bound: { source: 'Binder', via: 'not_a_column' } }, 'BINDING_SOURCE_COLUMN_MISSING');
});
