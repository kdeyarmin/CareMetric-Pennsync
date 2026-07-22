import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_ACCESSIBILITY_SMOKE_ROUTES, validateAccessibilitySmokeRoute } from './accessibilitySmokeMatrix.js';

test('public accessibility smoke matrix covers known no-token routes', () => {
  const routes = PUBLIC_ACCESSIBILITY_SMOKE_ROUTES.map((r) => r.route).sort();
  assert.deepEqual(routes, ['/followup', '/join', '/privacy', '/signer']);
});

test('each accessibility smoke route has enough metadata for a future axe/browser runner', () => {
  for (const route of PUBLIC_ACCESSIBILITY_SMOKE_ROUTES) {
    assert.equal(validateAccessibilitySmokeRoute(route).valid, true, route.route);
    assert.ok(route.requiredChecks.includes('main-landmark'));
  }
});
