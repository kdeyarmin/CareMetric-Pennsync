import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccessTokenTrust } from './accessTokenTrust.js';

const trusted = (host) => host === 'app.base44.app' || host.endsWith('.base44.app');

const base = (overrides = {}) =>
  evaluateAccessTokenTrust({
    urlState: null,
    plantedState: null,
    referrer: '',
    hasExistingToken: false,
    isTrustedBackendHost: trusted,
    pageHost: 'app.pennysync.example',
    ...overrides,
  });

test('matching planted auth_state accepts even with empty referrer', () => {
  assert.equal(
    base({ urlState: 'abc', plantedState: 'abc', referrer: '', hasExistingToken: false }),
    'accept',
  );
});

test('mismatched planted auth_state rejects when url carries state', () => {
  assert.equal(
    base({ urlState: 'evil', plantedState: 'good', referrer: '', hasExistingToken: false }),
    'reject',
  );
});

test('mismatched planted auth_state rejects when a session already exists', () => {
  assert.equal(
    base({ urlState: null, plantedState: 'good', referrer: '', hasExistingToken: true }),
    'reject',
  );
});

test('empty referrer with existing session rejects (logged-in fixation)', () => {
  assert.equal(base({ referrer: '', hasExistingToken: true }), 'reject');
});

test('empty referrer logged-out without planted state is pending (not silent accept)', () => {
  assert.equal(base({ referrer: '', hasExistingToken: false }), 'pending');
});

test('same-origin referrer accepts', () => {
  assert.equal(
    base({
      referrer: 'https://app.pennysync.example/dashboard',
      hasExistingToken: false,
    }),
    'accept',
  );
});

test('trusted Base44 referrer accepts', () => {
  assert.equal(
    base({
      referrer: 'https://app.base44.app/login',
      hasExistingToken: true,
    }),
    'accept',
  );
});

test('foreign referrer logged-out is pending, not accept', () => {
  assert.equal(
    base({
      referrer: 'https://evil.example/phish',
      hasExistingToken: false,
    }),
    'pending',
  );
});

test('foreign referrer logged-in rejects', () => {
  assert.equal(
    base({
      referrer: 'https://evil.example/phish',
      hasExistingToken: true,
    }),
    'reject',
  );
});
