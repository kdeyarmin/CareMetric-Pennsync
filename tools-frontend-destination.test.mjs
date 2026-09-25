import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_ENTITIES, DESTINATIONS, FORMAT, FORMAT_VERSION, MANIFEST_FILE, READ_OPERATIONS, REALTIME_OPERATIONS, SERVED,
  TENANT_DECISION_FILE, WRITE_OPERATIONS, classifyOperation, compare, destinationFor, main,
  measureDestinations, parseBaseline, refineGlobalReference, refineRetired, summarise,
} from './tools-frontend-destination.mjs';
import { measureSurface } from './tools-base44-surface.mjs';
import { snakeCase } from './tools-entity-schema-plan.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const baseline = (maximum_unserved) => JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, maximum_unserved });

test('this tool and the surface ratchet count the same call sites', () => {
  // The whole point of sharing `sourceFiles` and `ENTITY_CALL`. If these two
  // ever disagreed, one of them would be describing a different frontend from
  // the other and both would look right — the failure mode D45 records, where
  // a writer and a reader of the same thing each pass their own suite.
  //
  // It also pins the production/test boundary. The ratchet excludes `.test.`
  // and `.spec.` files with its reason in its own header: they model the very
  // surface being retired. A first measurement of this that included them read
  // 475 and 220 unserved, which is a real number about a different question.
  const measured = measureDestinations(repository);
  assert.equal(measured.sites.length, measureSurface(repository).counts.entity_call_sites);
  assert.deepEqual(measured.undeclared, [], 'a frontend call site reaches an entity with no disposition');
});

test('an operation the frontend performs is classified, never assumed', () => {
  for (const operation of READ_OPERATIONS) assert.equal(classifyOperation(operation), 'read');
  for (const operation of WRITE_OPERATIONS) assert.equal(classifyOperation(operation), 'write');
  for (const operation of REALTIME_OPERATIONS) assert.equal(classifyOperation(operation), 'realtime');
  assert.equal(classifyOperation('upsert'), null);
  // Fails closed. A new operation is either a read the broker family might
  // serve or a write it refuses, and defaulting either way is the difference
  // between "this is fine" and "this silently cannot work".
  assert.throws(() => destinationFor('broker', 'upsert'), /FRONTEND_DESTINATION_UNKNOWN_OPERATION:upsert/);
  assert.throws(() => destinationFor('invented', 'list'), /FRONTEND_DESTINATION_UNKNOWN_DISPOSITION:invented/);
});

test('the broker family serves reads and refuses writes, and the split is the finding', () => {
  // D2's ceiling, re-checked per schema by D22: three entities, all read-only.
  // An entity being "served" is not the same as a CALL SITE being served, and
  // a tool that answered per entity would report these nine as fine.
  assert.equal(destinationFor('broker', 'list'), 'broker_family');
  assert.equal(destinationFor('broker', 'filter'), 'broker_family');
  assert.equal(destinationFor('broker', 'create'), 'broker_is_read_only');
  assert.equal(destinationFor('broker', 'update'), 'broker_is_read_only');
  assert.equal(destinationFor('broker', 'delete'), 'broker_is_read_only');
  assert.ok(!SERVED.includes('broker_is_read_only'));
});

test('a table that is not coming is not a destination, whichever way it goes', () => {
  for (const disposition of ['hub', 'preserved_paused']) {
    for (const operation of [...READ_OPERATIONS, ...WRITE_OPERATIONS]) {
      assert.equal(destinationFor(disposition, operation), 'no_table', `${disposition}.${operation}`);
    }
  }
  assert.equal(destinationFor('port', 'create'), 'record_store');
  assert.equal(destinationFor('port', 'list'), 'record_store');
});

test('realtime outranks the disposition, because the seam does not exist at all', () => {
  // Not a table question: a `port` entity with a table still has nowhere to
  // put a subscription, so classifying by disposition first would call this
  // one served.
  for (const disposition of ['port', 'broker', 'retire', 'hub', 'preserved_paused']) {
    assert.equal(destinationFor(disposition, 'subscribe'), 'no_realtime_seam', disposition);
  }
});

test('the activity trail succeeds a retired LOG table and nothing else', () => {
  // D25 decided where three tables' rows go and never that the product stops
  // auditing. A fourth retired entity is an archive row with no live read, so
  // a call site reaching one has nowhere to land.
  for (const entity of AUDITED_ENTITIES) {
    assert.equal(refineRetired('export_archive_only', entity), 'activity_trail');
  }
  assert.equal(refineRetired('export_archive_only', 'SomeOtherRetiredThing'), 'export_archive_only');
  assert.ok(!SERVED.includes('export_archive_only'));
  // The refinement never invents a destination for something already placed.
  assert.equal(refineRetired('no_table', 'SystemLog'), 'no_table');
});

test('the measured frontend is two populations, and the smaller one is the surprise', () => {
  const report = compare(measureDestinations(repository), JSON.parse(baseline(208)));
  assert.equal(report.total, 445);
  assert.equal(report.served, 237);
  // 208 of 445. Stage J reads as "replace call sites tier by tier", which is a
  // refactor whose size is the count; 47% of them reach a domain the migration
  // has DECIDED not to carry, and each one needs a product answer rather than
  // an edit.
  assert.equal(report.unserved, 208);
  assert.equal(report.served + report.unserved, report.total);
  assert.deepEqual(report.by_destination, {
    record_store: 227, broker_family: 7, activity_trail: 3,
    no_table: 193, broker_is_read_only: 9, global_reference_is_read_only: 5,
    no_realtime_seam: 1, export_archive_only: 0, undeclared: 0,
  });
  // The training domain alone is more call sites than the broker family serves
  // in total, and it is `hub` — a different destination entirely.
  assert.equal(report.by_disposition.hub, 119);
  assert.equal(report.by_disposition.preserved_paused, 75);
  assert.equal(report.within_baseline, true);
});

test('every unserved entity names why, so the decision has a subject', () => {
  const report = compare(measureDestinations(repository), JSON.parse(baseline(208)));
  const entries = Object.entries(report.unserved_entities);
  assert.equal(entries.reduce((total, [, entry]) => total + entry.sites, 0), report.unserved);
  for (const [name, entry] of entries) {
    assert.ok(!SERVED.includes(entry.destination), `${name} is listed unserved but its destination is served`);
    assert.ok(entry.sites > 0, name);
  }
  // Ordered by weight, because the list is read to decide what to answer first.
  const counts = entries.map(([, entry]) => entry.sites);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  assert.equal(entries[0][0], 'TrainingCourse');
});

test('the baseline ratchets one way and refuses a malformed one', () => {
  const measured = measureDestinations(repository);
  assert.equal(compare(measured, JSON.parse(baseline(208))).regressed, false);
  assert.equal(compare(measured, JSON.parse(baseline(209))).regressed, false, 'below the ceiling passes');
  const tightened = compare(measured, JSON.parse(baseline(207)));
  assert.equal(tightened.regressed, true, 'a call site above the ceiling fails');
  assert.equal(tightened.within_baseline, false);
  assert.throws(() => parseBaseline('{'), /BASELINE_INVALID_JSON/);
  assert.throws(() => parseBaseline('[]'), /BASELINE_INVALID_SHAPE/);
  assert.throws(() => parseBaseline(JSON.stringify({ format: 'other', version: 1, maximum_unserved: 0 })),
    /BASELINE_UNSUPPORTED_FORMAT/);
  assert.throws(() => parseBaseline(JSON.stringify({ format: FORMAT, version: FORMAT_VERSION })),
    /BASELINE_INVALID_MAXIMUM/);
  assert.throws(() => parseBaseline(JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, maximum_unserved: -1 })),
    /BASELINE_INVALID_MAXIMUM/);
});

test('an undeclared entity fails the run rather than being counted as fine', () => {
  const measured = { sites: [], undeclared: ['Invented'] };
  const report = compare(measured, JSON.parse(baseline(0)));
  assert.equal(report.within_baseline, false);
  assert.deepEqual(report.undeclared_entities, ['Invented']);
});

test('an undeclared call site is still counted, so a failing run reports every site', () => {
  // The first version skipped the site: the gate failed on `undeclared`, but
  // the report it failed with understated the total and the unserved count —
  // in the one state where somebody reads them closely. Measured through the
  // real walker and matcher over a fixture tree, not a hand-built `measured`.
  const root = mkdtempSync(join(tmpdir(), 'frontend-destination-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'screen.jsx'),
      'base44.entities.Invented.list();\nbase44.entities.Known.create({});\n');
    writeFileSync(join(root, MANIFEST_FILE), JSON.stringify({ entities: { Known: 'port' } }));
    writeFileSync(join(root, TENANT_DECISION_FILE), JSON.stringify({ entities: {} }));
    const measured = measureDestinations(root);
    assert.equal(measured.sites.length, 2, 'both call sites are rows');
    assert.deepEqual(measured.undeclared, ['Invented']);
    const report = compare(measured, JSON.parse(baseline(10)));
    assert.equal(report.total, 2);
    assert.equal(report.served, 1);
    assert.equal(report.unserved, 1);
    assert.equal(report.by_destination.undeclared, 1);
    assert.deepEqual(report.unserved_entities.Invented, { disposition: null, destination: 'undeclared', sites: 1 });
    // Under a generous baseline it still fails, because nothing placed it.
    assert.equal(report.regressed, false);
    assert.equal(report.within_baseline, false);
    assert.ok(!SERVED.includes('undeclared'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('summarise counts each site exactly once', () => {
  const sites = [
    { entity: 'A', disposition: 'port', operation: 'list', destination: 'record_store' },
    { entity: 'B', disposition: 'hub', operation: 'list', destination: 'no_table' },
    { entity: 'B', disposition: 'hub', operation: 'create', destination: 'no_table' },
    { entity: 'C', disposition: 'broker', operation: 'create', destination: 'broker_is_read_only' },
  ];
  const summary = summarise({ sites, undeclared: [] });
  assert.equal(summary.total, 4);
  assert.equal(summary.served, 1);
  assert.equal(summary.unserved, 3);
  assert.deepEqual(Object.keys(summary.unserved_entities), ['B', 'C']);
  assert.equal(summary.unserved_entities.B.sites, 2);
  // Every destination appears, so a zero reads as measured rather than missing.
  assert.deepEqual(Object.keys(summary.by_destination), [...DESTINATIONS]);
});

test('the command line refuses an unknown argument and an unavailable baseline', () => {
  const lines = [];
  assert.equal(main(['--nope'], { repository, log: (line) => lines.push(line) }), 2);
  assert.match(lines[0], /INVALID_ARGUMENTS/);
  lines.length = 0;
  assert.equal(main([], { repository: resolve(repository, 'src'), log: (line) => lines.push(line) }), 2);
  assert.match(lines[0], /MEASUREMENT_FAILED|ENOENT|BASELINE_UNAVAILABLE/);
});

test('the summary names what cannot land and stays quiet about what can', () => {
  const lines = [];
  assert.equal(main(['--summary'], { repository, log: (line) => lines.push(line) }), 0);
  assert.match(lines[0], /445 call sites, 237 can land, 208\/208 cannot/);
  assert.ok(lines.some(line => /no_table: 193/.test(line)));
  assert.ok(lines.some(line => /broker_is_read_only: 9/.test(line)));
  assert.ok(!lines.some(line => /record_store/.test(line)), 'the served destinations are not the finding');
});

const RECORD_STORE_SQL = join('services', 'authority-store', 'supabase', 'record-migrations',
  '20260919170000_record_store.sql');

/** The eight entities the tenant decisions call D83 reference data. */
const globalEntities = () => Object.entries(
  JSON.parse(readFileSync(join(repository, TENANT_DECISION_FILE), 'utf8')).entities)
  .filter(([, decision]) => decision?.kind === 'global').map(([entity]) => entity);

/**
 * The generator's OWN name for the table, never a second spelling of the rule.
 * A hand-rolled `AIModelConfiguration` came out `aimodel_configuration` and the
 * assertion failed for the wrong reason, which is how a test reads as a finding.
 */
const tableName = (entity) => snakeCase(entity);

test('a write to a D83 global reference table has nowhere to land', () => {
  // The entity is `port` and the table exists, so the disposition alone says
  // `record_store` and is wrong — the same shape as the broker split.
  assert.equal(destinationFor('port', 'update'), 'record_store');
  assert.equal(refineGlobalReference('record_store', 'update', true), 'global_reference_is_read_only');
  assert.equal(refineGlobalReference('record_store', 'delete', true), 'global_reference_is_read_only');
  // Reads are unaffected: these tables exist to be read.
  assert.equal(refineGlobalReference('record_store', 'list', true), 'record_store');
  assert.equal(refineGlobalReference('record_store', 'get', true), 'record_store');
  // It refines nothing else, and invents no destination for an already-placed
  // site: a `hub` write stays `no_table` whatever the tenant decision says.
  assert.equal(refineGlobalReference('no_table', 'update', true), 'no_table');
  assert.equal(refineGlobalReference('record_store', 'update', false), 'record_store');
  assert.ok(!SERVED.includes('global_reference_is_read_only'));
});

/**
 * The refinement is only sound while the store really refuses these writes, so
 * it is read out of the emitted SQL rather than taken from D83's word. **The
 * refusal is the GRANT**: these tables grant no caller role anything, so
 * `authenticated` never reaches a policy and the error is `permission denied
 * for table` — which is why a definer contract owned by the record owner could
 * still write them if D83 were revisited.
 *
 * Whichever way that goes, this test fails first: a grant or a write policy
 * appearing on one of these tables makes the destination wrong.
 */
test('the store refuses those writes, and by the grant rather than the policy', () => {
  const sql = readFileSync(join(repository, RECORD_STORE_SQL), 'utf8');
  const entities = globalEntities();
  assert.equal(entities.length, 8, 'the decision file moved; re-read which tables this covers');
  for (const entity of entities) {
    const table = `"pennsync_records"."${tableName(entity)}"`;
    assert.ok(sql.includes(`revoke all on ${table} from public;`), `${entity} is not revoked`);
    const policies = [...sql.matchAll(
      new RegExp(`create policy "([^"]+)" on ${table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} for (\\w+)`, 'g'))];
    assert.deepEqual(policies.map(match => match[2]), ['select'],
      `${entity} has a policy other than its read: ${policies.map(match => match[1]).join(', ')}`);
    assert.equal(sql.includes(`grant select on ${table}`), false, `${entity} grants a caller a read`);
    assert.equal(sql.includes(`grant insert on ${table}`), false, `${entity} grants a caller a write`);
    assert.equal(new RegExp(`grant [a-z, ]+ on ${table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      .test(sql), false, `${entity} grants a caller role something`);
  }
});

test('the five sites this moves are named, so the correction has a subject', () => {
  const measured = measureDestinations(repository);
  const moved = measured.sites.filter(site => site.destination === 'global_reference_is_read_only');
  assert.deepEqual(moved.map(site => `${site.entity}.${site.operation}`).sort(), [
    'ComplianceRule.create', 'ComplianceRule.update',
    'MedicareComplianceRule.create', 'MedicareComplianceRule.update',
    'MedicareGuideline.update',
  ]);
  // Every one is `port`, which is the finding: the disposition is right and the
  // call still cannot land.
  for (const site of moved) assert.equal(site.disposition, 'port', site.file);
});
