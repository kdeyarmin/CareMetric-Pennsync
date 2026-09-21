import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_CODES, AUDIT_LIST_CODES, AUDIT_RPC, MAX_ACTION, MAX_DETAIL_BYTES, SUBJECT_KINDS, auditCapability,
} from './audit.mjs';
import { AUTHORITY_TARGETS } from './authority.mjs';

/**
 * The service's path to the activity trail.
 *
 * The trail's own guarantees are proved against a real database in
 * `activity-audit.test.mjs` — that it cannot be rewritten, that the actor is
 * stamped, that reading it needs an administrator. Nothing here substitutes for
 * that. What these cases fix is that the service sends what the contract
 * declares, refuses what it already knows is wrong, and never tells a handler
 * that something was recorded when it was not.
 */
const TARGET = AUTHORITY_TARGETS[1];
const KEY = 'sb_publishable_synthetic0000000000';
const BEARER = 'Bearer synthetic.caller.token';
const ID = '9f2b1c4d5e6f7a8b9c0d1e2f';
const config = () => ({ authorityUrl: TARGET, authorityKey: KEY });
const request = (authorization = BEARER) =>
  new Request('https://api.example/v1/functions/probe', { headers: authorization ? { authorization } : {} });
const capability = (overrides = {}, fetcher) => auditCapability({
  config: { ...config(), ...overrides.config },
  req: overrides.req ?? request(),
  agencyId: 'agencyId' in overrides ? overrides.agencyId : 'agency-a',
}, fetcher);
const answers = (value, status = 200) => () => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } });
const rejects = (promise, code) => assert.rejects(promise, error => error?.code === code, `expected ${code}`);

test('an entry carries the caller own bearer to the fixed RPC', async () => {
  let seen = null;
  const fetcher = async (url, init) => { seen = { url, init }; return answers(ID)(); };
  assert.equal(await capability({}, fetcher)('patient.viewed',
    { subject: { kind: 'patient', id: 'patient-a1' }, detail: { note: 'chart opened' } }), ID);
  assert.equal(seen.url, `${TARGET}/rest/v1/rpc/${AUDIT_RPC}`);
  assert.equal(seen.init.headers.Authorization, BEARER);
  assert.equal(seen.init.redirect, 'error');
  assert.deepEqual(JSON.parse(seen.init.body), {
    p_agency: 'agency-a', p_action: 'patient.viewed',
    p_subject_kind: 'patient', p_subject_id: 'patient-a1', p_detail: { note: 'chart opened' },
  });
  // No actor is sent. A handler cannot attribute its action to somebody else,
  // because it has no field in which to try.
  assert.ok(!Object.keys(JSON.parse(seen.init.body)).some(key => /actor|user|email/.test(key)));
});

test('an entry with no subject or detail is still a valid entry', async () => {
  let seen = null;
  const fetcher = async (url, init) => { seen = JSON.parse(init.body); return answers(ID)(); };
  await capability({}, fetcher)('session.started');
  assert.deepEqual(seen, { p_agency: 'agency-a', p_action: 'session.started',
    p_subject_kind: null, p_subject_id: null, p_detail: null });
});

test('a malformed entry never becomes a request', async () => {
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  const audit = capability({}, fetcher);
  for (const action of [null, '', 42, {}, 'x'.repeat(MAX_ACTION + 1)]) {
    await rejects(audit(action), 'AUDIT_ACTION_INVALID');
  }
  // A subject is a pair drawn from the declared kinds, or it is nothing.
  for (const subject of [{ kind: 'patient' }, { id: 'patient-a1' }, { kind: 'nope', id: 'x' },
    { kind: 'patient', id: '' }, { kind: 'patient', id: 'has spaces' }, 'patient', []]) {
    await rejects(audit('x.y', { subject }), 'AUDIT_SUBJECT_INVALID');
  }
  for (const detail of ['text', 42, []]) {
    await rejects(audit('x.y', { detail }), 'AUDIT_DETAIL_INVALID');
  }
  // Refused before the round trip, and refused rather than truncated — the
  // contract refuses it too, so a handler learns early rather than differently.
  await rejects(audit('x.y', { detail: { blob: 'x'.repeat(MAX_DETAIL_BYTES) } }), 'AUDIT_DETAIL_TOO_LARGE');
});

test('a misconfigured or unauthenticated service records nothing', async () => {
  const fetcher = async () => { throw new Error('the store must not have been called'); };
  for (const override of [{ authorityUrl: '' }, { authorityUrl: 'https://elsewhere.example' },
    { authorityKey: '' }, { authorityKey: 'service_role_key' }]) {
    await rejects(capability({ config: override }, fetcher)('x.y'), 'AUTHORITY_NOT_CONFIGURED');
  }
  await rejects(capability({ req: request('') }, fetcher)('x.y'), 'AUTHENTICATION_REQUIRED');
  for (const agencyId of ['', null, 'has spaces', 42]) {
    await rejects(capability({ agencyId }, fetcher)('x.y'), 'AGENCY_REQUIRED');
  }
});

test('a handler is never told something was recorded when it was not', async () => {
  // The contract answers the row id. Anything else means no row exists, and
  // reporting success would leave a capability believing it had audited.
  for (const body of [null, '', 42, {}, [], 'not an id!', { id: ID }]) {
    await rejects(capability({}, answers(body))('x.y'), 'AUDIT_UNREADABLE');
  }
  await rejects(capability({}, () => new Response('not json', { status: 200 }))('x.y'), 'AUDIT_UNREADABLE');
  await rejects(capability({}, () => { throw new TypeError('network'); })('x.y'), 'AUDIT_UNREACHABLE');
  for (const code of AUDIT_CODES) {
    await rejects(capability({}, answers({ message: code }, 400))('x.y'), code);
  }
  for (const body of [{ message: 'permission denied for table activity_audit' }, { message: null }, 'a string']) {
    await rejects(capability({}, answers(body, 400))('x.y'), 'AUDIT_REFUSED');
  }
});

test('the capability hands out a function, never the token that authorizes it', () => {
  const audit = capability({});
  assert.equal(typeof audit, 'function');
  assert.deepEqual(Object.keys(audit), []);
  assert.ok(!JSON.stringify(Object.getOwnPropertyDescriptors(audit)).includes('synthetic.caller.token'));
  assert.ok(!String(audit).includes(KEY));
});
