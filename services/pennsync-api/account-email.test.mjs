import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AUTHORITY_CONTRACT } from './authority.mjs';
import { createHandler } from './app.mjs';
import { HANDLERS, HANDLER_NAMES } from './handlers.mjs';
import { loadConfig, publicReadiness } from './runtime.mjs';
import { BROKERED_OPERATIONS, brokeredOperations } from './integrations.mjs';
import {
  DELIVERY_OPERATIONS, DELIVERY_RELEASE_ENV, DELIVERY_RELEASE_VALUE, deliveryReleased,
} from './outbound-delivery.mjs';

/**
 * The two account emails end to end, which for these two is the whole of them.
 *
 * D86 ported the caller gate and the pause and nothing else. D97 serves the send
 * behind `PENNSYNC_API_DELIVERY`, so there are now TWO deployments to prove and
 * the paused one matters most: every assertion this file made before the send
 * existed is kept unchanged, and `untouchable` still says the handler reaches
 * nothing on its way to either refusal. A capability whose only work is a send is
 * only honest while paused if it cannot send, and that is asserted rather than
 * commented.
 *
 * The released half is proved through the REAL integration capability rather than
 * a stub, because the thing that actually stopped a message leaving was never the
 * `fail` line in the sender: it was `SendEmail`'s absence from the brokered set.
 * A stub would have passed with the gate deleted.
 */
const KEY = 'sb_publishable_synthetic-acceptance-key';
const TARGET = 'https://xxtyweswohkvgkprimwa.supabase.co';
const NAMES = ['sendAccountReadyEmail', 'sendWelcomeEmail'];
const env = (patch = {}) => ({
  PENNSYNC_API_RELEASE: 'enabled-v1',
  PENNSYNC_API_APP_ID: '694ec16e72e01b60d22f7cbf',
  PENNSYNC_API_FUNCTIONS: NAMES.join(','),
  PENNSYNC_API_AUTHORITY_URL: TARGET,
  PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY: KEY,
  RAILWAY_GIT_COMMIT_SHA: 'e'.repeat(40),
  ...patch,
});
const context = (tenantRole = 'agency_admin') => ({
  contract: AUTHORITY_CONTRACT, app_id: '694ec16e72e01b60d22f7cbf',
  auth_user_id: '99999999-8888-4777-8666-555555555555', staging: true, synthetic: true,
  user_id: 'user-a', user_email: 'synthetic@example.test', identity_version: 1,
  is_platform_owner: false, agency_id: 'agency-a', membership_id: 'member-a',
  membership_key: 'agency-a:user-a', membership_version: 1, membership_status: 'active',
  tenant_role: tenantRole, agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
});
const post = (name, params) =>
  new Request(`https://api.example.test/v1/functions/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', params }),
  });
const RUNTIME = 'https://pennsync-integrations-production.up.railway.app';
const untouchable = (name) => () => () => { throw new Error(`${name} must not be reached`); };
const serve = (tenantRole) => createHandler(loadConfig(env()), {
  fetcher: async () => Response.json(context(tenantRole)),
  integration: untouchable('integration'), records: untouchable('records'),
  contract: untouchable('contract'), audit: untouchable('audit'),
});
const body = {
  sendAccountReadyEmail: { email: 'colleague@example.test', full_name: 'A Colleague' },
  sendWelcomeEmail: {
    email: 'colleague@example.test', full_name: 'A Colleague', temporary_password: 'not-a-real-secret',
  },
};

test('both are registered as JSON handlers that reach the integration runtime', () => {
  for (const name of NAMES) {
    assert.ok(HANDLER_NAMES.includes(name), `${name} is registered`);
    assert.notEqual(HANDLERS[name].binary, true);
    // This assertion is the inverse of the one it replaces, and the inversion is
    // the change. While the send was paused these two were honestly read-only and
    // the flag was correctly false; a sender that can send needs the runtime to
    // report ready, and the ladder must place it in the integration wave rather
    // than in the read-only one. D92's gate cross-checks the flag against whether
    // `handle` takes `integration`, so this is the flag's own half.
    assert.equal(HANDLERS[name].needsIntegration, true, `${name} needs the runtime`);
  }
});

test('the gate reads exactly one string, untrimmed', () => {
  assert.equal(DELIVERY_RELEASE_VALUE, 'enabled-v1');
  assert.equal(deliveryReleased({ [DELIVERY_RELEASE_ENV]: DELIVERY_RELEASE_VALUE }), true);
  // Every near miss reads paused. A gate that trimmed would let a stray space in
  // an operator's paste open a channel that sends to real people, which is the
  // discipline `PENNSYNC_API_RELEASE` already follows for the same reason.
  for (const value of ['', ' enabled-v1', 'enabled-v1 ', 'enabled-V1', 'ENABLED-V1', 'disabled',
    'enabled-v2', 'true', '1']) {
    assert.equal(deliveryReleased({ [DELIVERY_RELEASE_ENV]: value }), false, JSON.stringify(value));
  }
  assert.equal(deliveryReleased({}), false);
});

test('SendEmail is brokered only while delivery is released', () => {
  // The ratchet is untouched: a reader of `BROKERED_OPERATIONS` still sees exactly
  // what an unreleased deployment may ask the runtime for, which is D56's point.
  assert.deepEqual([...BROKERED_OPERATIONS], ['InvokeLLM', 'ExtractDataFromUploadedFile']);
  assert.deepEqual([...DELIVERY_OPERATIONS], ['SendEmail']);
  assert.equal(brokeredOperations({ deliveryReleased: false }).includes('SendEmail'), false);
  assert.equal(brokeredOperations({}).includes('SendEmail'), false);
  assert.equal(brokeredOperations(undefined).includes('SendEmail'), false);
  assert.equal(brokeredOperations({ deliveryReleased: true }).includes('SendEmail'), true);
  // And nothing else arrives with it.
  assert.deepEqual(brokeredOperations({ deliveryReleased: true }),
    ['InvokeLLM', 'ExtractDataFromUploadedFile', 'SendEmail']);
});

test('releasing delivery is refused without a runtime, and is published when it holds', () => {
  assert.throws(() => loadConfig(env({ [DELIVERY_RELEASE_ENV]: DELIVERY_RELEASE_VALUE })),
    /INCOMPLETE_DELIVERY_CONFIGURATION/);
  assert.equal(publicReadiness(loadConfig(env())).deliveryReleased, false);
  const open = loadConfig(env({
    [DELIVERY_RELEASE_ENV]: DELIVERY_RELEASE_VALUE, PENNSYNC_API_INTEGRATIONS_URL: RUNTIME,
  }));
  assert.equal(open.deliveryReleased, true);
  // Readable from outside the service, because every other release state in this
  // project is checked by probing the deployment rather than by reading a plan.
  assert.equal(publicReadiness(open).deliveryReleased, true);
});

test('an admin is told the channel is off, and nothing was reached on the way', async () => {
  for (const name of NAMES) {
    const response = await serve('agency_admin')(post(name, body[name]));
    assert.equal(response.status, 503, name);
    assert.deepEqual(await response.json(),
      { success: false, error: 'OUTBOUND_DELIVERY_RELEASE_PAUSED', retryable: false }, name);
  }
});

test('a caller who is not an admin is refused first, exactly as the originals refuse them', async () => {
  // Order, not just outcome. Both originals authorize BEFORE consulting the
  // outbound gate, so a paused deployment still answers a non-admin 403 rather
  // than telling them the channel is off — which would say the request would
  // have been accepted once released.
  for (const name of NAMES) {
    for (const role of ['clinician', 'manager', 'office_staff', 'social_worker', 'spiritual_care']) {
      const response = await serve(role)(post(name, body[name]));
      assert.equal(response.status, 403, `${name} as ${role}`);
      assert.equal((await response.json()).error, 'ADMIN_REQUIRED', `${name} as ${role}`);
    }
  }
});

test('an unknown parameter is refused before the caller is even considered', async () => {
  // The service's own discipline rather than the original's: an unknown key is
  // refused, never ignored. It runs first because a body this service cannot
  // account for is not a request it should reason about at all.
  for (const name of NAMES) {
    const response = await serve('agency_admin')(post(name, { ...body[name], cc: 'someone@example.test' }));
    assert.equal(response.status, 400, name);
    assert.equal((await response.json()).error, 'INVALID_PARAMS', name);
  }
  // And the two do not share a parameter list: the welcome message carries a
  // temporary password and the account-ready notice must not be handed one.
  const leaked = await serve('agency_admin')(post('sendAccountReadyEmail', body.sendWelcomeEmail));
  assert.equal(leaked.status, 400);
  assert.equal((await leaked.json()).error, 'INVALID_PARAMS');
});

/**
 * A released deployment, driven through the REAL integration capability. The
 * fetcher answers the authority context for the authority URL and the runtime's
 * own success envelope for the integration URL, and records every request, so a
 * test can say not only what came back but whether the network was reached.
 */
const ROSTER_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_roster_list`;
/** One roster page, in `contract_roster_list`'s own envelope. */
const rosterPage = (emails, next = null) => ({
  entries: emails.map((email, index) => ({ id: `${index}`.padStart(24, '0'), email, is_active: true })),
  next,
});
const releasedServe = (tenantRole = 'agency_admin', { broker = true, roster = [() => rosterPage(['colleague@example.test'])] } = {}) => {
  const sent = [];
  const asked = [];
  const config = loadConfig(env({
    PENNSYNC_API_INTEGRATIONS_URL: RUNTIME,
    ...(broker ? { [DELIVERY_RELEASE_ENV]: DELIVERY_RELEASE_VALUE } : {}),
  }));
  const handler = createHandler(config, {
    fetcher: async (url, init) => {
      if (String(url).startsWith(RUNTIME)) {
        sent.push({ url: String(url), body: JSON.parse(init.body) });
        return Response.json({ success: true, result: { accepted: true, delivered: false, provider: 'sendgrid' } });
      }
      // The roster read goes through the REAL contract capability, for the
      // reason the send goes through the real integration one: a stub would
      // pass with the binding deleted.
      if (String(url) === ROSTER_RPC) {
        const body = JSON.parse(init.body);
        asked.push(body);
        const page = roster[Math.min(asked.length - 1, roster.length - 1)];
        return Response.json(page(body));
      }
      return Response.json(context(tenantRole));
    },
    records: untouchable('records'), audit: untouchable('audit'),
  });
  return { handler, sent, asked };
};

test('a released deployment sends each message, and the runtime sees one call per request', async () => {
  for (const name of NAMES) {
    const { handler, sent } = releasedServe();
    const response = await handler(post(name, body[name]));
    assert.equal(response.status, 200, name);
    const answer = await response.json();
    assert.equal(answer.success, true, name);
    assert.equal(sent.length, 1, `${name} makes exactly one brokered call`);
    assert.equal(sent[0].url, `${RUNTIME}/v1/integrations`);
    assert.equal(sent[0].body.operation, 'SendEmail', name);
    assert.equal(sent[0].body.agency_id, 'agency-a', name);
    // The runtime's `validateMailParams` is `exactObject` over these five keys, so
    // a sixth would be refused there rather than here. Pinned by name because the
    // two services are deployed separately and this is their shared contract.
    assert.deepEqual(Object.keys(sent[0].body.params).sort(),
      ['body', 'content_type', 'from_name', 'subject', 'to'], name);
    assert.equal(sent[0].body.params.content_type, 'text/html', name);
    assert.equal(sent[0].body.params.to, body[name].email, name);
  }
});

test('the recipient is resolved against the caller own agency, and the roster is asked for it', async () => {
  for (const name of NAMES) {
    const { handler, sent, asked } = releasedServe();
    const response = await handler(post(name, body[name]));
    assert.equal(response.status, 200, name);
    // The read happened, against the agency the request names and no other.
    assert.equal(asked.length, 1, `${name} asked the roster once`);
    assert.equal(asked[0].p_agency, 'agency-a', name);
    assert.equal(sent[0].body.params.to, 'colleague@example.test', name);
  }
});

test('an address nobody in the agency holds is refused, and nothing is sent', async () => {
  // D98. The finding this closes: `requireSender` asks who the caller is, and
  // with an unbound `email` these two are a branded relay to any address — the
  // welcome notice with a working temporary password in it.
  for (const name of NAMES) {
    for (const roster of [
      [() => rosterPage([])],
      [() => rosterPage(['someone.else@example.test'])],
      [() => rosterPage(['colleague@example.test.attacker.example'])],
      [() => rosterPage(['not-outsider@example.test'])],
    ]) {
      const { handler, sent } = releasedServe('agency_admin', { roster });
      const response = await handler(post(name, { ...body[name], email: 'outsider@example.test' }));
      assert.equal(response.status, 403, name);
      assert.equal((await response.json()).error, 'RECIPIENT_NOT_IN_AGENCY', name);
      assert.equal(sent.length, 0, `${name} put a message on the wire for an outsider`);
    }
  }
});

test('a match that is merely contained in a roster address is not a match', async () => {
  // Oriented deliberately, and the first draft of the test above was NOT: it
  // asked for `outsider@…` against a roster holding `colleague@…`, which no
  // comparison would accept, so swapping the equality for `includes` passed it.
  // Here the roster holds a LONGER address that contains the requested one, so a
  // substring comparison answers yes and mails somebody who was never asked for.
  for (const name of NAMES) {
    const { handler, sent } = releasedServe('agency_admin',
      { roster: [() => rosterPage(['xcolleague@example.test'])] });
    const response = await handler(post(name, { ...body[name], email: 'colleague@example.test' }));
    assert.equal(response.status, 403, name);
    assert.equal((await response.json()).error, 'RECIPIENT_NOT_IN_AGENCY', name);
    assert.equal(sent.length, 0, `${name} mailed a different roster member`);
  }
});

test('the roster copy of the address is what reaches the provider and the message', async () => {
  // Not the caller's string. They differ only in case, and taking the store's
  // copy means the provider sees an address this store vouches for.
  for (const name of NAMES) {
    const { handler, sent } = releasedServe('agency_admin',
      { roster: [() => rosterPage(['Colleague@Example.test'])] });
    const response = await handler(post(name, { ...body[name], email: 'colleague@EXAMPLE.test' }));
    assert.equal(response.status, 200, name);
    assert.equal(sent[0].body.params.to, 'Colleague@Example.test', name);
    assert.ok(sent[0].body.params.body.includes('Colleague@Example.test'), `${name} body`);
    assert.ok(!sent[0].body.params.body.includes('colleague@EXAMPLE.test'), `${name} body keeps the caller string`);
  }
});

test('a recipient on a later roster page is found, and the walk cannot spin', async () => {
  // Bounded the way `generateUserRosterPDF`'s walk is. The third page repeats
  // its own cursor, which is the shape that would spin if `next === after` did
  // not break.
  const { handler, sent, asked } = releasedServe('agency_admin', {
    roster: [
      () => rosterPage(['a@example.test'], 'cursor-1'),
      () => rosterPage(['colleague@example.test'], 'cursor-2'),
    ],
  });
  const response = await handler(post('sendWelcomeEmail', body.sendWelcomeEmail));
  assert.equal(response.status, 200);
  assert.equal(asked.length, 2, 'the second page was asked for with the first cursor');
  assert.equal(asked[1].p_after, 'cursor-1');
  assert.equal(sent.length, 1);

  const spin = releasedServe('agency_admin', {
    roster: [() => rosterPage(['a@example.test'], 'cursor-1'), body => rosterPage(['b@example.test'], body.p_after)],
  });
  const refused = await spin.handler(post('sendWelcomeEmail', body.sendWelcomeEmail));
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'RECIPIENT_NOT_IN_AGENCY');
  assert.equal(spin.asked.length, 2, 'a cursor equal to its own input stopped the walk');
  assert.equal(spin.sent.length, 0);
});

test('a paused deployment resolves no recipient, so it cannot be asked who is in an agency', async () => {
  // `serve` hands the handler a `contract` that throws if it is reached, so this
  // is asserted by the harness rather than by reading the order. A 503 that had
  // read the roster first would be an oracle: an admin of one agency could ask
  // whether an address belongs to it without any channel being open.
  for (const name of NAMES) {
    const response = await serve('agency_admin')(post(name, body[name]));
    assert.equal(response.status, 503, name);
    assert.equal((await response.json()).error, 'OUTBOUND_DELIVERY_RELEASE_PAUSED', name);
  }
});

test('readiness refuses a released sender while delivery is unset, and says which', async () => {
  // D98's second half. Without this a rollout probe passes while every send
  // answers 503 — the shape `integrationsRequired` already guards one layer down.
  const paused = publicReadiness(loadConfig(env({ PENNSYNC_API_INTEGRATIONS_URL: RUNTIME })));
  assert.equal(paused.deliveryRequired, true, 'a released sender needs delivery');
  assert.equal(paused.deliveryReleased, false);
  assert.equal(paused.ready, false, 'a service that refuses every send is not ready');

  const released = publicReadiness(loadConfig(env({
    PENNSYNC_API_INTEGRATIONS_URL: RUNTIME, [DELIVERY_RELEASE_ENV]: DELIVERY_RELEASE_VALUE,
  })));
  assert.equal(released.deliveryRequired, true);
  assert.equal(released.ready, true, 'with both switches on it serves');

  // And a release that contains no sender is unaffected, which is what keeps
  // this from reading as a service-wide requirement.
  const other = publicReadiness(loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'validatePatientData' })));
  assert.equal(other.deliveryRequired, false);
  assert.equal(other.deliveryReleased, false);
  assert.equal(other.ready, true);
});

test('the registry flag and the module that gates agree, in both directions', () => {
  // D92's cross-check for the other switch. A handler that gates without the
  // flag is a deployment that reports ready and sends nothing; a handler with
  // the flag and no gate is a name in a wave whose promise it breaks.
  const dir = new URL('.', import.meta.url);
  const gating = new Set();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.mjs') || file.endsWith('.test.mjs')) continue;
    const source = readFileSync(new URL(file, dir), 'utf8');
    if (!/requireDeliveryReleased\s*\(/.test(source) || file === 'outbound-delivery.mjs') continue;
    for (const match of source.matchAll(/export async function ([A-Za-z][A-Za-z0-9]*)/g)) gating.add(match[1]);
  }
  assert.deepEqual([...gating].sort(), [...NAMES].sort(), 'the gating senders are the two known ones');

  const registry = readFileSync(new URL('handlers.mjs', dir), 'utf8');
  const start = registry.indexOf('export const HANDLERS');
  const blocks = [...registry.slice(start).matchAll(/\n {2}([A-Za-z][A-Za-z0-9]*): Object\.freeze\(\{/g)];
  const body = registry.slice(start);
  blocks.forEach((entry, index) => {
    const block = body.slice(entry.index, blocks[index + 1]?.index ?? body.length);
    const flagged = /needsDelivery:\s*true/.test(block);
    const gates = [...gating].some(name => block.includes(`${name}(`));
    assert.equal(flagged, gates, `${entry[1]}: needsDelivery must match whether it gates delivery`);
  });
});

test('a released deployment still refuses a caller who may not send, and sends nothing', async () => {
  for (const name of NAMES) {
    for (const role of ['clinician', 'manager', 'office_staff', 'social_worker', 'spiritual_care']) {
      const { handler, sent } = releasedServe(role);
      const response = await handler(post(name, body[name]));
      assert.equal(response.status, 403, `${name} as ${role}`);
      assert.equal((await response.json()).error, 'ADMIN_REQUIRED', `${name} as ${role}`);
      // The network is the assertion. A release that authorized after rendering
      // would have put the message on the wire before refusing the caller.
      assert.equal(sent.length, 0, `${name} as ${role} reached the runtime`);
    }
  }
});

test('the field checks run only on a released deployment, and nothing is sent when one fails', async () => {
  // Carried from the originals, which validate AFTER the pause. So a paused
  // deployment cannot be used to probe which fields a sender wants — the 503 above
  // already proves that for a well-formed body, and this proves it for a bad one.
  for (const [name, patch, code] of [
    ['sendAccountReadyEmail', { email: 'not-an-address' }, 'EMAIL_REQUIRED'],
    ['sendAccountReadyEmail', { email: '' }, 'EMAIL_REQUIRED'],
    ['sendAccountReadyEmail', { email: `a@b.co\nbcc: c@d.co` }, 'EMAIL_REQUIRED'],
    ['sendAccountReadyEmail', { full_name: '' }, 'FULL_NAME_REQUIRED'],
    ['sendAccountReadyEmail', { full_name: '   ' }, 'FULL_NAME_REQUIRED'],
    ['sendAccountReadyEmail', { full_name: 'x'.repeat(201) }, 'FULL_NAME_REQUIRED'],
    ['sendWelcomeEmail', { temporary_password: '' }, 'TEMPORARY_PASSWORD_REQUIRED'],
    ['sendWelcomeEmail', { full_name: null }, 'FULL_NAME_REQUIRED'],
  ]) {
    const paused = await serve('agency_admin')(post(name, { ...body[name], ...patch }));
    assert.equal(paused.status, 503, `${name} paused with ${JSON.stringify(patch)}`);
    assert.equal((await paused.json()).error, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
    const { handler, sent } = releasedServe();
    const response = await handler(post(name, { ...body[name], ...patch }));
    assert.equal(response.status, 400, `${name} with ${JSON.stringify(patch)}`);
    assert.equal((await response.json()).error, code, `${name} with ${JSON.stringify(patch)}`);
    assert.equal(sent.length, 0, 'a refused body reached the runtime');
  }
});

test('with the runtime configured but delivery unreleased, the broker refuses the operation', async () => {
  // The belt the sender's own 503 is the braces for. Two independent things have
  // to give for a message to leave, and this is the one a stub would have hidden:
  // with `requireDeliveryReleased` deleted the sender would reach the capability
  // and the capability would still refuse `SendEmail` as not brokered.
  for (const name of NAMES) {
    const { handler, sent } = releasedServe('agency_admin', { broker: false });
    const response = await handler(post(name, body[name]));
    assert.equal(response.status, 503, name);
    assert.equal((await response.json()).error, 'OUTBOUND_DELIVERY_RELEASE_PAUSED', name);
    assert.equal(sent.length, 0, name);
  }
});
