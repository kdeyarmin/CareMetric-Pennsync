// Tests for the patient-facing telehealth capability-link helpers, including the
// hash-at-rest contract: hashJoinToken must produce the exact SHA-256 hex that
// the backend (createTelehealthToken / rotateTelehealthJoinToken) computes when
// validating or minting guest tokens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateJoinToken, buildPatientJoinLink, hashJoinToken } from './telehealthUtils.js';

test('generateJoinToken returns 48 hex chars (192 bits) and does not repeat', () => {
  const a = generateJoinToken();
  const b = generateJoinToken();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.match(b, /^[0-9a-f]{48}$/);
  assert.notEqual(a, b);
});

test('buildPatientJoinLink carries room and token, tolerating a trailing slash', () => {
  const link = buildPatientJoinLink('https://app.example.com/pennsync/', 'visit-1', 'tok123');
  assert.equal(link, 'https://app.example.com/pennsync/join?room=visit-1&t=tok123');
});

test('hashJoinToken matches the backend SHA-256 hex computation', async () => {
  const token = 'abc';
  const expected = createHash('sha256').update(token).digest('hex');
  assert.equal(await hashJoinToken(token), expected);
  // Known vector: sha256("abc")
  assert.equal(expected, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
