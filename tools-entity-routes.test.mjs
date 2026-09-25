import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HANDLER_NAMES } from './services/pennsync-api/handlers.mjs';
import { PORTED_FUNCTIONS } from './services/authority-client/client.mjs';
import { ENTITY_ROUTES, ROUTED_OPERATIONS, routeFor } from './src/lib/independentEntityRoutes.js';
import { measureRoutes } from './tools-entity-routes.mjs';
import { auditBrokerCeiling, brokerReadable, locatorPaths } from './tools-tenant-decision.mjs';
import { buildPaths, readEntity } from './tools-tenant-path.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));

/** A declaration that is correct in every way the gate checks. */
const sound = (overrides = {}) => Object.freeze({
  function: 'listAgencyRoster',
  projection: 'roster',
  reason: 'A reason long enough to say something about why this route is the successor.',
  request: () => ({}),
  response: (result) => result.entries,
  ...overrides,
});

test('the committed declarations pass', () => {
  const report = measureRoutes(repository);
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
  // The point of the report: how much of the landable surface is adopted.
  assert.ok(report.routed_sites > 0, 'a route that serves no call site is not progress');
  assert.equal(report.routed_sites + report.unrouted_sites, report.landable_sites);
});

test('every declared route names a handler reachable from the browser', () => {
  for (const key of ROUTED_OPERATIONS) {
    const route = ENTITY_ROUTES[key];
    assert.ok(Object.hasOwn(PORTED_FUNCTIONS, route.function), `${key} not in PORTED_FUNCTIONS`);
    assert.ok(HANDLER_NAMES.includes(route.function), `${key} not implemented by the service`);
  }
});

/**
 * Each case is a real way a declaration goes wrong, PLANTED and then checked to
 * produce its own refusal. A gate run only against a correct input has been
 * shown to stay quiet, which is not the same as biting.
 */
test('a wrong declaration is refused, one shape at a time', () => {
  const cases = [
    ['ENTITY_ROUTE_UNKNOWN_HANDLER', { 'User.list': sound({ function: 'noSuchHandler' }) }],
    ['ENTITY_ROUTE_UNREACHABLE_FUNCTION', { 'User.list': sound({ function: 'noSuchHandler' }) }],
    // An entity operation the frontend never performs: coverage that moves no
    // call site, and would keep reading as coverage after the screen went.
    ['ENTITY_ROUTE_NO_CALL_SITE', { 'User.somethingNobodyCalls': sound() }],
    ['ENTITY_ROUTE_REASON_TOO_SHORT', { 'User.list': sound({ reason: 'because' }) }],
    ['ENTITY_ROUTE_PROJECTION_MISSING', { 'User.list': sound({ projection: '' }) }],
  ];
  for (const [code, routes] of cases) {
    const report = measureRoutes(repository, routes);
    assert.equal(report.ok, false, `${code} was not refused`);
    assert.ok(report.problems.some(problem => problem.startsWith(`${code}:`)),
      `${code} missing from ${JSON.stringify(report.problems)}`);
  }
});

/**
 * A route over an entity the migration decided NOT to carry would claim the
 * owned store serves it. `TrainingCourse` is `hub`: 28 call sites, no table.
 */
test('a route over an entity with nowhere to land is refused', () => {
  const report = measureRoutes(repository, { 'TrainingCourse.list': sound() });
  assert.ok(report.problems.includes('ENTITY_ROUTE_UNSERVABLE:TrainingCourse.list'), report.problems);
});

test('routeFor answers only for a declared operation', () => {
  assert.equal(routeFor('User', 'list'), ENTITY_ROUTES['User.list']);
  assert.equal(routeFor('User', 'create'), null);
  assert.equal(routeFor('TrainingCourse', 'list'), null);
  // `routeFor` builds its key by concatenation, so a prototype name must not
  // resolve: `Object.hasOwn` is what keeps `constructor` from being a route.
  assert.equal(routeFor('Object', 'constructor'), null);
});

/**
 * The remainder's cost, measured rather than assumed.
 *
 * "Widen the generic family instead of writing a capability per entity" is the
 * obvious plan for the 206 call sites no route serves, and D16's ceiling
 * decides whether it can work. An answer of zero writes is a RESULT and not a
 * bug, so the test states which halves are real and which are merely
 * consistent.
 */
/**
 * The number this reports was wrong twice before it was right, both times
 * upward, and both times because the audit was asked less than the whole
 * question. First it applied only the read predicate (31 sites). Then it was
 * hand-run with an empty `locators` list, so the file-layer check could not
 * fire (25). The answer is 23, and `LibraryDocument` is the proof the gate now
 * asks the whole question: its schema plainly permits a read, so the predicate
 * alone admits it, and the ceiling refuses it for holding a file.
 *
 * The general rule is worth more than the number: a check run with one of its
 * inputs empty reports CLEAR for a reason that has nothing to do with the
 * thing being clear. So the gate builds its own inputs and nothing hand-runs
 * the audit.
 */
test('the ceiling is the whole audit, not the half of it that answers first', () => {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)));
  const paths = new Map(buildPaths(repository).entities.map(path => [path.entity, path]));
  const schema = readEntity(repository, 'LibraryDocument');
  assert.equal(brokerReadable(schema), true, 'the read predicate alone would admit it');
  const problems = auditBrokerCeiling({
    entity: 'LibraryDocument',
    schema,
    path: paths.get('LibraryDocument'),
    locators: locatorPaths(repository, 'LibraryDocument'),
  });
  assert.ok(problems.some(problem => problem.includes('can hold a file')), problems);
  // And with the locators left out — the way it was hand-run — it comes back
  // clear, which is exactly why no caller supplies them any more.
  assert.deepEqual(auditBrokerCeiling({
    entity: 'LibraryDocument', schema, path: paths.get('LibraryDocument'), locators: [],
  }), []);
});

test('what a wider generic family could reach is reported and adds up', () => {
  const report = measureRoutes(repository);
  assert.ok(report.unrouted_entities > 0);
  assert.equal(
    report.generic_family_reads + report.generic_family_writes + report.needs_named_capability,
    report.unrouted_sites,
    'every unrouted call site is in exactly one of the three');
  // Nothing here asserts a number that moves with the schemas. What it does
  // assert is that the measurement ran: a silent failure to read a schema
  // would report every site as needing a named capability.
  assert.ok(report.generic_family_reads > 0,
    'no read cleared the ceiling, which would mean the schemas were not read at all');
  assert.ok(report.generic_family_entities > 0
    && report.generic_family_entities < report.unrouted_entities,
  'the ceiling admits some entities and refuses others; all or none means it did not run');
});
