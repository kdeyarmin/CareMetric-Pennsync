import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_ACCESSIBILITY_SMOKE_ROUTES,
  AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES,
  ALL_ACCESSIBILITY_SMOKE_ROUTES,
  validateAccessibilitySmokeRoute,
  publicAccessibilityRoutes,
  authenticatedAccessibilityRoutes,
} from './accessibilitySmokeMatrix.js';

test('public accessibility smoke matrix covers known no-token routes', () => {
  const routes = PUBLIC_ACCESSIBILITY_SMOKE_ROUTES.map((r) => r.route).sort();
  assert.deepEqual(routes, ['/followup', '/join', '/privacy', '/signer']);
});

test('each accessibility smoke route has enough metadata for axe/browser runners', () => {
  for (const route of ALL_ACCESSIBILITY_SMOKE_ROUTES) {
    const result = validateAccessibilitySmokeRoute(route);
    assert.equal(result.valid, true, `${route.route}: ${result.missing.join(', ')}`);
    assert.ok(route.requiredChecks.includes('main-landmark') || route.requiredChecks.includes('document-title'));
  }
});

test('public vs authenticated helpers partition the matrix', () => {
  assert.equal(publicAccessibilityRoutes().length, 4);
  assert.ok(authenticatedAccessibilityRoutes().length >= 4);
  assert.ok(authenticatedAccessibilityRoutes().every((r) => r.requiresAuth === true));
  assert.ok(publicAccessibilityRoutes().every((r) => r.requiresAuth === false));
});

test('authenticated routes document role and expected state for LR-02', () => {
  for (const route of AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES) {
    assert.ok(['nurse', 'admin'].includes(route.role), route.route);
    assert.ok(route.expectedState);
  }
});
