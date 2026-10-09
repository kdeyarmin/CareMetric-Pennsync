import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_ENTITIES, DESTINATIONS, FORMAT, FORMAT_VERSION, KNOWN_DISPOSITIONS, MANIFEST_FILE,
  READ_OPERATIONS, REALTIME_OPERATIONS, SERVED,
  TENANT_DECISION_FILE, WRITE_OPERATIONS, classifyOperation, compare, destinationFor, main,
  measureDestinations, parseBaseline, refineGlobalReference, refineRetired, summarise,
} from './tools-frontend-destination.mjs';
import { measureSurface } from './tools-base44-surface.mjs';
import { SCHEMA_ONLY, snakeCase } from './tools-entity-schema-plan.mjs';

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

/**
 * It fails closed on EVERY path out of the function, which is not what the
 * assertion above proves and is the gap a review found.
 *
 * Two early returns answer without consulting the disposition — `realtime`, and
 * a `SCHEMA_ONLY` entity — so both sat above the `switch` and its
 * `default: throw` was unreachable through either. A disposition that was
 * misspelled or had gone missing reported a clean bucket for exactly the eight
 * entities in the newest and least familiar one, while the same bad value threw
 * for every other entity in the tree. Nothing was lost on the day it was found,
 * because all eight really did read `preserved_paused` — which is why it needed a
 * test rather than a reading: it was a property that could lapse without any
 * figure moving.
 *
 * Each case is driven through a DIFFERENT exit, because one of them passing says
 * nothing about the others — that is how the first version came to be checked
 * and still be wrong.
 */
test('an unknown disposition is refused on every path, not only through the switch', () => {
  const schemaOnly = Object.keys(SCHEMA_ONLY)[0];
  assert.ok(schemaOnly, 'this test needs a SCHEMA_ONLY entity to route through that exit');
  for (const [disposition, operation, entity, exit] of [
    ['invented', 'list', null, 'the switch'],
    ['invented', 'list', schemaOnly, 'the SCHEMA_ONLY early return'],
    ['invented', REALTIME_OPERATIONS[0], null, 'the realtime early return'],
    ['invented', REALTIME_OPERATIONS[0], schemaOnly, 'both early returns at once'],
    [undefined, 'list', schemaOnly, 'a disposition that is absent rather than wrong'],
  ]) {
    assert.throws(() => destinationFor(disposition, operation, entity),
      /FRONTEND_DESTINATION_UNKNOWN_DISPOSITION/,
      `a bad disposition reached ${exit} without being refused`);
  }
  // And the two early returns still answer for a GOOD disposition, or the
  // refusal above would be passing by breaking them.
  assert.equal(destinationFor('preserved_paused', 'list', schemaOnly), 'no_access_contract');
  assert.equal(destinationFor('port', REALTIME_OPERATIONS[0], null), 'no_realtime_seam');
  // The switch's own default is unreachable now and keeps a distinct code, so a
  // disposition added to `KNOWN_DISPOSITIONS` and not to the switch is still a
  // refusal rather than an `undefined` destination.
  assert.ok(KNOWN_DISPOSITIONS.every(name => DESTINATIONS.includes(
    destinationFor(name, name === 'broker' ? 'list' : 'list', null))),
    'every known disposition must map to a declared destination');
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
  const report = compare(measureDestinations(repository), JSON.parse(baseline(169)));
  // Merged on 2026-10-08: the care-plan screens returned (+18 landable), the
  // risk and PDGM payment screens left (-7 landable, -15 unserved), and the
  // phone, PDF, feedback and report features came back (+7 landable, +2
  // unserved), and the admin, security, education and discharge screens came
  // back (+29 landable, +1 unserved), so that merge read 488, 292 and 196.
  // Each movement is recorded below on its own.
  //
  // 488 then became 452, 292 became 283 and 196 became 169 when the owner
  // turned the OASIS Center back on: its screens reach OASIS records through
  // the OASIS record broker and the scoped upload list instead of the
  // entities, and nine never-mounted duplicate OASIS components were deleted.
  // Thirty-six sites LEFT: twenty-seven unserved, every one on a
  // `preserved_paused` OASIS entity with no access contract, and nine
  // landable. A removal, so the baseline was lowered with it.
  //
  // The admin, security, education and discharge screens (measured on their
  // own branch as 452 to 482, 244 to 273 and 208 to 209) came back when the
  // owner turned the admin, security, education and discharge screens back on.
  // Thirty sites ARRIVED: twenty-nine are landable (most on carried entities,
  // nine more on the activity trail's retired logs) and one, Agency Analytics'
  // restored training section, reads a `hub` entity and so has no table here.
  // A population that grows is not a regression in what was decided, which is
  // why the baseline moved by exactly the one unserved site.
  //
  // The phone, PDF, feedback and report features (measured on their own
  // branch as 452 to 461, 244 to 251 and 208 to 210). Landable arrivals: the dashboard's
  // own NoteConversion read, logActivity's UserActivity append (activity
  // trail), NurseGoal's four goal operations, and the restored
  // ReferralFollowUp page's read (which is the 452->453 move recorded below,
  // reversed). Unserved arrivals: the texts tab's SmsMessage filter and update
  // and the scheduled queue's ScheduledSms filter (no_table +3), less the one
  // CallLog read the shared call-log hook removed (no_access_contract -1).
  //
  // 453 became 471 and 245 became 263 when the owner released the care-plan
  // screens on 2026-10-08 and their eighteen entity calls came back into
  // `src/`. Every one of them lands in the record store, so `unserved` held
  // still a third time: an arrival of landable sites, not a decision.
  //
  // 452 became 453 and 244 became 245 again when the owner's agency-access
  // panel (`src/components/admin/AgencyAccessPanel.jsx`) gained one landable
  // `Agency.list` site: a population ARRIVAL, so `unserved` held still once
  // more and only `record_store` moved.
  //
  // 453 became 452 and 245 became 244 when `src/pages/ReferralFollowUp.jsx` was
  // deleted and its route became a redirect. One site LEFT the population, and
  // it was a landable one, so both figures fell together and `unserved` did not
  // move at all — the mirror image of the matcher fix recorded below, where
  // eight landable sites arrived and `unserved` likewise held still. Neither is
  // progress: the only figure that moves when a decision is taken or a contract
  // ships is `unserved`, which is why it is the one with a baseline.
  //
  // 452 then became 430, 244 became 237 and 208 became 193 when the clinical
  // risk-prediction and PDGM payment features were removed from the frontend:
  // 22 sites left with the deleted screens, 7 landable and 15 unserved. That
  // IS a movement of `unserved`, and of the right kind — a removal rather than
  // a decision or a contract — so the baseline was lowered with it.
  //
  // 453 became 451 and 284 became 282 on 2026-10-09 when the fax receiving
  // switch (`src/components/admin/FaxReceivingToggle.jsx`) was removed: the
  // product owner decided the app receives no faxes, and the webhook no longer
  // honours the setting it wrote. Its AgencySettings create and update LEFT,
  // both landable, so `unserved` held still: a removal of landable sites, not
  // a decision or a contract.
  assert.equal(report.total, 451);
  assert.equal(report.served, 282);
  // 169 of 451. Stage J reads as "replace call sites tier by tier", which is a
  // refactor whose size is the count; 46% of them have no destination. The
  // percentage is the trap: it read 46% against 453 too, so the denominator
  // moved underneath it and the derived figure did not budge. 179 of the 193 reach
  // a domain the migration DECIDED not to carry and 14 do not — those are
  // writes to entities it carries read-only — which is a distinction this file
  // used to lose here and `tools-frontend-retired-inventory` now derives.
  //
  // 445 became 453 when the shared matcher learned to read a namespace bound
  // into an object literal, and every one of the eight is LANDABLE: `unserved`
  // did not move, and `record_store` absorbed all of them. So the blind spot
  // was hiding work rather than hiding decisions, which is the better of the
  // two ways for a census to be wrong and is not a reason to trust the next one.
  assert.equal(report.unserved, 169);
  assert.equal(report.served + report.unserved, report.total);
  //
  // `no_table` 193 split into 148 + 45 when D7's eight OASIS entities got
  // tables. Nothing moved between served and unserved, which is the property to
  // check rather than the two new figures: a table is not an access path, and
  // `no_access_contract` says so instead of letting the bucket keep a name whose
  // reason had gone. It empties one entity at a time as each contract ships.
  //
  // The split then moved again, to 119 + 74, when D7's six fax and phone
  // entities got tables in the same way. The movement is 29 sites and not the
  // 30 those six entities hold: `FaxLog` has 7, and the seventh is a
  // `subscribe` that lands in `no_realtime_seam`, which is a bucket of its own
  // and did not change. So derive this from the per-entity rollup rather than
  // by adding an entity's whole site count to the moving side.
  //
  // `no_access_contract` then fell from 74 to 59 and `record_store` from 234
  // to 227 when the risk-prediction and PDGM payment screens were deleted; the
  // 15 were all `preserved_paused` sites, which is why that disposition fell by
  // the same 15 below.
  //
  // It fell again, from 58 to 31, and `record_store` from 272 to 263, when
  // the OASIS Center moved onto its broker; `preserved_paused` fell by the
  // same 27 below, because every one of them was an OASIS entity.
  //
  // `record_store` then fell from 263 to 261 when the fax receiving switch's
  // two AgencySettings writes left (2026-10-09); no other bucket moved.
  assert.deepEqual(report.by_destination, {
    record_store: 261, broker_family: 7, activity_trail: 14,
    no_table: 123, no_access_contract: 31,
    broker_is_read_only: 9, global_reference_is_read_only: 5,
    no_realtime_seam: 1, export_archive_only: 0, undeclared: 0,
  });
  assert.equal(report.by_destination.no_table + report.by_destination.no_access_contract, 154);
  // The training domain alone is more call sites than the broker family serves
  // in total, and it is `hub` — a different destination entirely.
  assert.equal(report.by_disposition.hub, 121);
  assert.equal(report.by_disposition.preserved_paused, 34);
  assert.equal(report.within_baseline, true);
});

test('every unserved entity names why, so the decision has a subject', () => {
  const report = compare(measureDestinations(repository), JSON.parse(baseline(169)));
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
  assert.equal(compare(measured, JSON.parse(baseline(169))).regressed, false);
  assert.equal(compare(measured, JSON.parse(baseline(170))).regressed, false, 'below the ceiling passes');
  const tightened = compare(measured, JSON.parse(baseline(168)));
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
  const report = compare(measured, JSON.parse(baseline(169)));
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
    const report = compare(measured, JSON.parse(baseline(169)));
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
  assert.match(lines[0], /451 call sites, 282 can land, 169\/169 cannot/);
  assert.ok(lines.some(line => /no_table: 123/.test(line)));
  assert.ok(lines.some(line => /no_access_contract: 31/.test(line)));
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
