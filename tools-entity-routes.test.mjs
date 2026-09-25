import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HANDLER_NAMES } from './services/pennsync-api/handlers.mjs';
import { PORTED_FUNCTIONS } from './services/authority-client/client.mjs';
import { ENTITY_ROUTES, ROUTED_OPERATIONS, routeFor } from './src/lib/independentEntityRoutes.js';
import { measureRoutes } from './tools-entity-routes.mjs';

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
