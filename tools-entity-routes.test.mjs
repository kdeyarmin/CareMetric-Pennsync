import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HANDLER_NAMES } from './services/pennsync-api/handlers.mjs';
import { PORTED_FUNCTIONS } from './services/authority-client/client.mjs';
import { ARGUMENTS_UNSUPPORTED, ENTITY_ROUTES, ROUTED_OPERATIONS, routeFor }
  from './src/lib/independentEntityRoutes.js';
import { measureRoutes, servedSites } from './tools-entity-routes.mjs';
import { measureDestinations } from './tools-frontend-destination.mjs';
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

/**
 * The correction this tool most needed, kept as a test so it cannot come back.
 *
 * `routed_sites` used to count a call site as adopted when its
 * `Entity.operation` was DECLARED. It reported 36 for the staff roster, and
 * running those 36 calls' own arguments through the route refuses every one —
 * 31 ask for an order over a field the roster does not project, and the rest
 * asked for more rows than its ceiling. A number that can be produced without
 * running the thing is not a measurement of the thing.
 */
test('a site is adopted only when its own arguments survive the route', () => {
  const report = measureRoutes(repository);
  const calls = servedSites(repository, ENTITY_ROUTES, measureDestinations(repository).sites.length);
  assert.equal(report.routed_sites, calls.served.length);
  for (const call of calls.served) {
    // Re-run, because the count is only worth what the call proves.
    assert.doesNotThrow(() => ENTITY_ROUTES[call.key].request(...call.arguments), call.file);
  }
  // And the refused ones really do refuse, with the route's own code.
  for (const call of calls.refused) {
    assert.throws(() => ENTITY_ROUTES[call.key].request(...call.arguments),
      error => error.code === ARGUMENTS_UNSUPPORTED, call.file);
  }
  assert.ok(calls.refused.length > 0,
    'with nothing refused this test would pass without the distinction existing');
});

/**
 * A declaration nothing can use reads as adoption on the page and moves no
 * screen, which is what the roster route did for a day. `NO_CALL_SITE` says
 * the call is never made; this says it is made and cannot be served.
 */
test('a route no real call survives is refused, not counted', () => {
  const refusing = {
    'User.list': Object.freeze({
      ...ENTITY_ROUTES['User.list'],
      request: () => { const error = new Error(ARGUMENTS_UNSUPPORTED); error.code = ARGUMENTS_UNSUPPORTED; throw error; },
    }),
  };
  const report = measureRoutes(repository, refusing);
  assert.equal(report.ok, false);
  assert.ok(report.problems.includes('ENTITY_ROUTE_SERVES_NO_CALL:User.list'), report.problems);
  assert.equal(report.routed_sites, 0);
});

/**
 * The third state, and the reason it exists.
 *
 * The version of this gate that had two states failed the build for any route
 * whose call sites all pass a variable — `AgencySettings.create(payload)`,
 * `NoteConversion.create(fields)` — which is 84 of the frontend's writes and
 * every one of them servable by a contract. Not COUNTING an unproven route is
 * the correction and is asserted above; not PERMITTING one was a static check
 * deciding what the contract's own refusals decide against the real migration.
 *
 * `DocumentTemplate.create` is the real shape: a landable write whose only call
 * site passes a variable. Declared, it must pass and appear as unproved, and it
 * must not move the adopted count by one.
 */
test('a route whose every call site passes a variable is permitted, not counted', () => {
  const baseline = measureRoutes(repository);
  const routes = { ...ENTITY_ROUTES, 'DocumentTemplate.create': sound() };
  const report = measureRoutes(repository, routes);
  assert.deepEqual(report.problems, [], 'an unreadable call site is not a failure');
  assert.ok(report.unproved_routes.includes('DocumentTemplate.create'), report.unproved_routes);
  assert.equal(report.routed_sites, baseline.routed_sites,
    'an unproved route is not adoption');
  // And the distinction really is about READABILITY, not about writes: the
  // roster route has readable call sites, so it is proved rather than unproved.
  assert.ok(!report.unproved_routes.includes('User.list'));
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

/**
 * The counting bug batch D measured, kept as its own case.
 *
 * Served sites were counted one per CALL and removed from the remainder one
 * per FILE-AND-OPERATION, so a file calling the same operation twice with only
 * one served lost both from the remainder while one was counted — the three
 * generic-family buckets then summed one short of `unrouted_sites`. Latent
 * since the gate was rebuilt, and only reachable once a route existed over a
 * key one file calls twice.
 *
 * `src/pages/ReferralTriage.jsx` is that file: two `Task.create` calls, one
 * whose argument is readable and one whose is not. A route accepting anything
 * therefore serves exactly one of the two.
 */
test('a served site is removed from the remainder once, not per key', () => {
  const baseline = measureRoutes(repository);
  const routes = { ...ENTITY_ROUTES, 'Task.create': sound({ request: () => ({}) }) };
  const report = measureRoutes(repository, routes);
  assert.deepEqual(report.problems, []);

  const calls = servedSites(repository, routes, measureDestinations(repository).sites.length);
  const triage = calls.served.filter(call =>
    call.file === 'src/pages/ReferralTriage.jsx' && call.key === 'Task.create');
  assert.equal(triage.length, 1,
    'the case only exists while that file has one served call and one unreadable one');

  // The arithmetic the Set broke. Both halves, because either alone passes
  // with the other wrong.
  assert.equal(report.routed_sites + report.unrouted_sites, report.landable_sites);
  assert.equal(
    report.generic_family_reads + report.generic_family_writes + report.needs_named_capability,
    report.unrouted_sites,
    'the buckets sum short when a key is removed once for two served calls');
  assert.ok(report.routed_sites > baseline.routed_sites);
});
