import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileVisitReadiness } from './mobileVisitReadiness.js';

test('mobile visit readiness blocks missing cached patient context', () => {
  const result = buildMobileVisitReadiness({ patientCached: false, hasPatientContext: false, hasDraftNote: true });
  assert.equal(result.ready, false);
  assert.equal(result.severity, 'blocked');
  assert.equal(result.blockers.length, 2);
});

test('mobile visit readiness warns but allows work when offline with cached context', () => {
  const result = buildMobileVisitReadiness({ patientCached: true, hasPatientContext: true, hasDraftNote: true, isOnline: false, pendingSyncCount: 2 });
  assert.equal(result.ready, true);
  assert.equal(result.severity, 'warning');
  assert.equal(result.warnings.length, 2);
});

test('mobile visit readiness reports ready when required context is present', () => {
  const result = buildMobileVisitReadiness({ patientCached: true, hasPatientContext: true, hasDraftNote: true });
  assert.equal(result.severity, 'ready');
});
