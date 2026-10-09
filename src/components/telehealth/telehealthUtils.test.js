// Tests for the patient-facing telehealth capability-link helpers, including the
// hash-at-rest contract: hashJoinToken must produce the exact SHA-256 hex that
// the backend (createTelehealthToken / rotateTelehealthJoinToken) computes when
// validating or minting guest tokens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  generateJoinToken, buildPatientJoinLink, hashJoinToken,
  tokenExpiryMs, tokenRefreshDelayMs, tokenRefreshRetryDelayMs, isDefinitiveTokenRefusal, createTokenRefresher,
  TOKEN_REFRESH_LEAD_MS, TOKEN_REFRESH_MIN_DELAY_MS,
} from './telehealthUtils.js';

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

// ---- in-visit token renewal ----
const T0 = Date.parse('2026-10-09T20:00:00Z');
const HOUR = 3600 * 1000;

test('tokenExpiryMs takes the earlier of the server expiry and receivedAt + ttl', () => {
  // A client clock running BEHIND the server makes token_expires_at look
  // later than it is; the ttl bound keeps the renewal inside the real life.
  assert.equal(tokenExpiryMs({ token_expires_at: '2026-10-09T21:10:00Z', token_ttl_secs: 3600 }, T0), T0 + HOUR);
  // A client clock running AHEAD makes the server expiry look earlier: renew early, which is harmless.
  assert.equal(tokenExpiryMs({ token_expires_at: '2026-10-09T20:50:00Z', token_ttl_secs: 3600 }, T0), T0 + 50 * 60 * 1000);
  // Old backend replies carry neither; createTelehealthToken has always minted an hour.
  assert.equal(tokenExpiryMs({ token: 'x' }, T0), T0 + HOUR);
  assert.equal(tokenExpiryMs({ token_expires_at: 'not a date', token_ttl_secs: 600 }, T0), T0 + 600 * 1000);
});

test('tokenRefreshDelayMs renews five minutes early, halfway for a short token, never immediately', () => {
  assert.equal(tokenRefreshDelayMs(T0 + HOUR, T0), HOUR - TOKEN_REFRESH_LEAD_MS);
  assert.equal(tokenRefreshDelayMs(T0 + 8 * 60 * 1000, T0), 4 * 60 * 1000);
  assert.equal(tokenRefreshDelayMs(T0 + 1000, T0), TOKEN_REFRESH_MIN_DELAY_MS);
  assert.equal(tokenRefreshDelayMs(T0 - 1000, T0), TOKEN_REFRESH_MIN_DELAY_MS);
  assert.equal(tokenRefreshDelayMs(NaN, T0), TOKEN_REFRESH_MIN_DELAY_MS);
});

test('tokenRefreshRetryDelayMs backs off, stays inside the token life, and stops at expiry', () => {
  assert.equal(tokenRefreshRetryDelayMs(T0 + HOUR, T0, 0), 5000);
  assert.equal(tokenRefreshRetryDelayMs(T0 + HOUR, T0, 2), 20000);
  assert.equal(tokenRefreshRetryDelayMs(T0 + HOUR, T0, 10), 60000);
  assert.equal(tokenRefreshRetryDelayMs(T0 + 8000, T0, 3), 4000);
  assert.equal(tokenRefreshRetryDelayMs(T0, T0, 0), null);
  assert.equal(tokenRefreshRetryDelayMs(NaN, T0, 0), null);
});

test('isDefinitiveTokenRefusal separates an ended visit from a blip', () => {
  for (const status of [400, 401, 403, 404, 409, 410]) assert.equal(isDefinitiveTokenRefusal({ status }), true, String(status));
  assert.equal(isDefinitiveTokenRefusal({ response: { status: 403 } }), true);
  assert.equal(isDefinitiveTokenRefusal({ code: 'PUBLIC_CAPABILITY_REALM_CLOSED' }), true);
  assert.equal(isDefinitiveTokenRefusal({ code: 'STALE_PUBLIC_CAPABILITY_OPERATION' }), true);
  for (const error of [{ status: 500 }, { status: 502 }, { status: 429 }, new Error('network'), undefined]) {
    assert.equal(isDefinitiveTokenRefusal(error), false);
  }
});

// A manual clock: timers fire only when the test advances time.
function manualClock(start = T0) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => [...timers.values()].map((t) => t.at - now),
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
      // Let the refresh/apply promise chain settle.
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
  };
}

test('the refresher renews before expiry, applies the token in place, and keeps going', async () => {
  const clock = manualClock();
  const applied = [];
  let calls = 0;
  const refresher = createTokenRefresher({
    refresh: async () => { calls += 1; return { token: `T${calls}`, token_ttl_secs: 3600 }; },
    apply: async (token) => { applied.push(token); },
    ...clock,
  });
  refresher.track({ token: 'T0', token_ttl_secs: 3600 }, T0);
  assert.deepEqual(clock.pending(), [HOUR - TOKEN_REFRESH_LEAD_MS]);
  await clock.advance(HOUR - TOKEN_REFRESH_LEAD_MS - 1);
  assert.equal(calls, 0, 'not before the lead time');
  await clock.advance(1);
  assert.deepEqual(applied, ['T1']);
  assert.deepEqual(clock.pending(), [HOUR - TOKEN_REFRESH_LEAD_MS], 'the next renewal is scheduled from the new token');
  await clock.advance(HOUR - TOKEN_REFRESH_LEAD_MS);
  assert.deepEqual(applied, ['T1', 'T2'], 'a visit past two hours keeps renewing');
  refresher.stop();
  assert.deepEqual(clock.pending(), []);
});

test('the refresher retries a transient failure and gives up on a definitive refusal', async () => {
  const clock = manualClock();
  const outcomes = [{ status: 502 }, { token: 'T1', token_ttl_secs: 3600 }, { status: 403 }];
  const applied = [];
  const gaveUp = [];
  const refresher = createTokenRefresher({
    refresh: async () => {
      const next = outcomes.shift();
      if (next.status) throw Object.assign(new Error('refused'), next);
      return next;
    },
    apply: async (token) => { applied.push(token); },
    onGiveUp: (error) => gaveUp.push(error.status),
    ...clock,
  });
  refresher.track({ token: 'T0', token_ttl_secs: 3600 }, T0);
  await clock.advance(HOUR - TOKEN_REFRESH_LEAD_MS);
  assert.deepEqual(clock.pending(), [5000], 'a 502 is retried after 5 s');
  await clock.advance(5000);
  assert.deepEqual(applied, ['T1']);
  await clock.advance(HOUR - TOKEN_REFRESH_LEAD_MS);
  assert.deepEqual(gaveUp, [403], 'an ended visit stops the renewals');
  assert.deepEqual(clock.pending(), []);
});

test('the refresher gives up once the token has expired, and a stopped refresher never applies', async () => {
  const clock = manualClock();
  const gaveUp = [];
  const refresher = createTokenRefresher({
    refresh: async () => { throw Object.assign(new Error('down'), { status: 503 }); },
    apply: async () => { throw new Error('must not apply'); },
    onGiveUp: () => gaveUp.push('gave up'),
    ...clock,
  });
  refresher.track({ token: 'T0', token_ttl_secs: 60 }, T0);
  for (let i = 0; i < 20 && gaveUp.length === 0; i += 1) await clock.advance(30_000);
  assert.deepEqual(gaveUp, ['gave up']);

  // Leaving the visit while a renewal is in flight: the late token is dropped.
  let resolveRefresh;
  const applied = [];
  const clock2 = manualClock();
  const late = createTokenRefresher({
    refresh: () => new Promise((resolve) => { resolveRefresh = resolve; }),
    apply: async (token) => { applied.push(token); },
    onGiveUp: () => { throw new Error('a stopped refresher reported'); },
    ...clock2,
  });
  late.track({ token: 'T0', token_ttl_secs: 3600 }, T0);
  await clock2.advance(HOUR - TOKEN_REFRESH_LEAD_MS);
  late.stop();
  resolveRefresh({ token: 'T1', token_ttl_secs: 3600 });
  await clock2.advance(0);
  assert.deepEqual(applied, []);
  assert.deepEqual(clock2.pending(), []);
});
