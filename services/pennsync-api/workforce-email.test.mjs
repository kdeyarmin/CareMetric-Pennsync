import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AUTHORITY_CONTRACT } from './authority.mjs';
import { createHandler } from './app.mjs';
import { HANDLERS, HANDLER_NAMES } from './handlers.mjs';
import { loadConfig } from './runtime.mjs';
import { DELIVERY_RELEASE_ENV, DELIVERY_RELEASE_VALUE } from './outbound-delivery.mjs';
import { timeOffSubmittedMessage } from './workforce-email.mjs';

/**
 * The approver notice for `submitTimeOffRequest`, end to end.
 *
 * The send goes through the REAL integration capability and the roster read
 * through the REAL contract capability, for `account-email.test.mjs`'s reason:
 * what actually stops a message leaving is `SendEmail`'s absence from the
 * brokered set, and a stub would pass with the gate deleted.
 *
 * What this file is mostly about is the half that is NOT account-email's. There
 * the send is the capability, so a paused deployment refuses. Here the record
 * work is the capability and the notice is a side effect, so a paused
 * deployment must still create the request — and the assertions that matter are
 * the ones proving the request survives every way the notice can fail.
 */
const NAME = 'submitTimeOffRequest';
const KEY = 'sb_publishable_synthetic-acceptance-key';
const TARGET = 'https://xxtyweswohkvgkprimwa.supabase.co';
const RUNTIME = 'https://pennsync-integrations-production.up.railway.app';
const SUBMIT_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_time_off_submit`;
const ROSTER_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_roster_list`;

const env = (patch = {}) => ({
  PENNSYNC_API_RELEASE: 'enabled-v1',
  PENNSYNC_API_APP_ID: '694ec16e72e01b60d22f7cbf',
  PENNSYNC_API_FUNCTIONS: NAME,
  PENNSYNC_API_AUTHORITY_URL: TARGET,
  PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY: KEY,
  PENNSYNC_API_INTEGRATIONS_URL: RUNTIME,
  RAILWAY_GIT_COMMIT_SHA: 'e'.repeat(40),
  ...patch,
});
const context = (tenantRole = 'clinician') => ({
  contract: AUTHORITY_CONTRACT, app_id: '694ec16e72e01b60d22f7cbf',
  auth_user_id: '99999999-8888-4777-8666-555555555555', staging: true, synthetic: true,
  user_id: 'user-a', user_email: 'nurse@example.test', identity_version: 1,
  is_platform_owner: false, agency_id: 'agency-a', membership_id: 'member-a',
  membership_key: 'agency-a:user-a', membership_version: 1, membership_status: 'active',
  tenant_role: tenantRole, agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
});
const params = {
  request_type: 'paid_time_off', start_date: '2026-10-05', end_date: '2026-10-07',
  half_day: false, reason: 'Family visit', coverage: 'Jo covers Tuesday',
  manager_email: 'MANAGER@example.test',
};
const post = () => new Request(`https://api.example.test/v1/functions/${NAME}`, {
  method: 'POST',
  headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
  body: JSON.stringify({ agency_id: 'agency-a', params }),
});
/**
 * The row the contract answers with. `manager_email` is the address the STORE
 * resolved through `agency_colleague`, deliberately in a different case from
 * the request's, so an assertion on what reaches the provider can tell the
 * store's copy from the caller's string.
 */
const request = (patch = {}) => ({
  id: 'req-1', employee_email: 'nurse@example.test', employee_name: 'nurse@example.test',
  manager_email: 'manager@example.test', manager_name: 'manager@example.test',
  request_type: 'paid_time_off', start_date: '2026-10-05', end_date: '2026-10-07',
  half_day: false, total_days: 3, reason: 'Family visit', coverage: 'Jo covers Tuesday',
  status: 'pending', ...patch,
});
/**
 * The handler's own answer. `createHandler` wraps it in the service envelope
 * (`{ success, result, execution }`), so `success` at the top level is the
 * envelope's and every assertion about the capability reads `result`.
 */
const resultOf = async response => (await response.json()).result;
const rosterPage = (entries, next = null) => ({ entries, next });
const member = (email, tenant_role = 'agency_admin', is_active = true) => ({
  id: email.padStart(24, '0').slice(0, 24), email, tenant_role, is_active,
});

/**
 * One deployment. `delivery` off is what a deployment does today; `roster` and
 * `mail` are the two dependencies the notice has, each able to fail the way the
 * real one can.
 */
const serve = ({
  delivery = false, row = request(), roster = [() => rosterPage([])], mail = () => ({ ok: true }),
} = {}) => {
  const sent = [];
  const asked = [];
  const config = loadConfig(env(delivery ? { [DELIVERY_RELEASE_ENV]: DELIVERY_RELEASE_VALUE } : {}));
  const handler = createHandler(config, {
    fetcher: async (url, init) => {
      const target = String(url);
      if (target.startsWith(RUNTIME)) {
        const body = JSON.parse(init.body);
        sent.push(body);
        const answer = mail(body);
        if (answer.ok) {
          return Response.json({ success: true, result: { accepted: true, delivered: false, provider: 'sendgrid' } });
        }
        return Response.json({ error: 'PROVIDER_REFUSED' }, { status: 502 });
      }
      if (target === SUBMIT_RPC) return Response.json({ success: true, request: row });
      if (target === ROSTER_RPC) {
        const body = JSON.parse(init.body);
        asked.push(body);
        const page = roster[Math.min(asked.length - 1, roster.length - 1)];
        return page(body);
      }
      return Response.json(context());
    },
    records: () => () => { throw new Error('records must not be reached'); },
    audit: () => () => { throw new Error('audit must not be reached'); },
  });
  return { handler, sent, asked };
};

test('the registry flags say the runtime is reached and the record work stands without delivery', () => {
  assert.ok(HANDLER_NAMES.includes(NAME));
  // D92's half: the flag follows the destructuring, and `handle` takes
  // `integration` now.
  assert.equal(HANDLERS[NAME].needsIntegration, true);
  // And the half that is this shape's own. `needsDelivery` would make a
  // deployment that releases time off report NOT ready with delivery unset —
  // while the capability is creating requests exactly as it does today. Absent
  // rather than false, because that is how every other handler here declines a
  // flag.
  assert.equal(Object.hasOwn(HANDLERS[NAME], 'needsDelivery'), false);
});

test('a paused deployment records the request, reaches no provider, and says so', async () => {
  const { handler, sent } = serve({ delivery: false });
  const response = await handler(post());
  assert.equal(response.status, 200);
  const answer = await resultOf(response);
  assert.equal(answer.success, true);
  assert.equal(answer.request.id, 'req-1', 'the record work is the capability and it happened');
  assert.equal(answer.delivery_paused, true, 'a recipient exists and the channel is off');
  assert.equal(answer.email, false);
  // The wire is empty — but read the next test before trusting this line for
  // more than it says. Sabotage proved it BLIND to the branch being deleted:
  // `SendEmail` is not in the brokered set while delivery is unreleased, so an
  // unguarded send is refused inside the integration capability, never reaches
  // the fetcher, and is swallowed by the same catch that makes the notice
  // best-effort. Two guards in series, and this assertion cannot see the first
  // one fail. The comment that stood here claimed it could.
  assert.equal(sent.length, 0, 'nothing is put on the wire while delivery is unreleased');
});

test('a paused deployment does not even ATTEMPT the operation', async () => {
  // What the wire assertion above cannot see. The capability is replaced by one
  // that records the attempt and then throws the way the real one does, so the
  // question asked is whether the branch was taken rather than whether the
  // brokered set caught it afterwards.
  const attempts = [];
  const config = loadConfig(env());
  const handler = createHandler(config, {
    fetcher: async (url) => (String(url) === SUBMIT_RPC
      ? Response.json({ success: true, request: request() })
      : Response.json(context())),
    integration: () => (operation) => {
      attempts.push(operation);
      throw new Error('INTEGRATION_OPERATION_NOT_BROKERED');
    },
    records: () => () => { throw new Error('records must not be reached'); },
    audit: () => () => { throw new Error('audit must not be reached'); },
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.request.id, 'req-1');
  assert.equal(answer.delivery_paused, true);
  assert.equal(answer.email, false);
  assert.deepEqual(attempts, [], 'the send was never asked for');
});

test('a released deployment sends once, to the address the STORE resolved', async () => {
  const { handler, sent } = serve({ delivery: true });
  const response = await handler(post());
  assert.equal(response.status, 200);
  const answer = await resultOf(response);
  assert.equal(answer.delivery_paused, false);
  assert.equal(answer.email, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].operation, 'SendEmail');
  assert.equal(sent[0].agency_id, 'agency-a');
  // The caller asked for `MANAGER@example.test`; what leaves is the store's
  // own copy, which is the address `agency_colleague` verified. A port that
  // passed the request's string through would put the caller's text on the
  // wire, and the two differ here only in case so that this can be asserted.
  assert.equal(sent[0].params.to, 'manager@example.test');
  assert.notEqual(sent[0].params.to, params.manager_email);
  // The runtime's `validateMailParams` is `exactObject` over these five keys.
  assert.deepEqual(Object.keys(sent[0].params).sort(),
    ['body', 'content_type', 'from_name', 'subject', 'to']);
  assert.equal(sent[0].params.subject, 'Time-off request from nurse@example.test');
});

test('with no manager designated the agency administrators are the recipients', async () => {
  const { handler, sent, asked } = serve({
    delivery: true,
    row: request({ manager_email: null, manager_name: null }),
    roster: [() => Response.json(rosterPage([
      member('admin-one@example.test'),
      // Not an administrator: the original notifies approvers, not everybody.
      member('clinician@example.test', 'clinician'),
      // An administrator whose membership is not active.
      member('former-admin@example.test', 'agency_admin', false),
      // The submitter, who is an administrator here. The original excludes the
      // caller and so does this.
      member('nurse@example.test'),
      member('admin-two@example.test'),
    ]))],
  });
  const response = await handler(post());
  assert.equal(response.status, 200);
  const answer = await resultOf(response);
  assert.equal(answer.delivery_paused, false);
  assert.equal(answer.email, true);
  assert.equal(asked.length, 1, 'the roster was read, against the agency the request names');
  assert.equal(asked[0].p_agency, 'agency-a');
  assert.deepEqual(sent.map(call => call.params.to).sort(),
    ['admin-one@example.test', 'admin-two@example.test']);
});

test('a request nobody would be notified about reports delivery_paused FALSE', async () => {
  // The parity point, and the behaviour the flat `true` got wrong. The original
  // computes `recipients.length > 0 && !released`, so with no manager and no
  // administrator there was no delivery to pause — and answering `true` told a
  // caller a message was waiting on a switch when none existed.
  const { handler, sent } = serve({
    delivery: false,
    row: request({ manager_email: null, manager_name: null }),
    roster: [() => Response.json(rosterPage([member('nurse@example.test')]))],
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.request.id, 'req-1');
  assert.equal(answer.delivery_paused, false);
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0);
});

test('a provider refusing every address does not fail a request that exists', async () => {
  const { handler, sent } = serve({ delivery: true, mail: () => ({ ok: false }) });
  const response = await handler(post());
  assert.equal(response.status, 200, 'best-effort, as every original is');
  const answer = await resultOf(response);
  assert.equal(answer.request.id, 'req-1');
  assert.equal(answer.email, false, 'nothing was accepted');
  assert.equal(answer.delivery_paused, false, 'the channel was open; the provider refused');
  assert.equal(sent.length, 1);
});

test('one refused address does not stop the others, and email means any was accepted', async () => {
  const { handler, sent } = serve({
    delivery: true,
    row: request({ manager_email: null, manager_name: null }),
    roster: [() => Response.json(rosterPage([
      member('admin-one@example.test'), member('admin-two@example.test'),
    ]))],
    mail: body => ({ ok: body.params.to !== 'admin-one@example.test' }),
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(sent.length, 2, 'both were attempted');
  assert.equal(answer.email, true, 'some(Boolean), as the original has it');
});

test('a roster read that fails leaves the request recorded and claims nothing', async () => {
  const { handler, sent } = serve({
    delivery: true,
    row: request({ manager_email: null, manager_name: null }),
    roster: [() => Response.json({ message: 'boom' }, { status: 500 })],
  });
  const response = await handler(post());
  assert.equal(response.status, 200);
  const answer = await resultOf(response);
  assert.equal(answer.request.id, 'req-1');
  assert.equal(answer.email, false);
  // Nothing about the agency was established, so nothing is asserted: the walk
  // threw before any recipient existed, which is the original's own state when
  // `workforceApproverRecipients` throws.
  assert.equal(answer.delivery_paused, false);
  assert.equal(sent.length, 0);
});

test('the roster walk ends on a repeated cursor rather than spinning', async () => {
  let reads = 0;
  const { handler, asked } = serve({
    delivery: true,
    row: request({ manager_email: null, manager_name: null }),
    roster: [() => { reads += 1; return Response.json(rosterPage([member('admin@example.test')], 'same-cursor')); }],
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.email, true);
  // Two reads: the first returns a cursor, the second returns the same one and
  // the walk stops. A contract answering its own input would otherwise page to
  // the budget.
  assert.equal(reads, 2, 'the repeated cursor ended it');
  assert.equal(asked.length, 2);
});

test('the message is the original field for field, and an absent field prints no row', () => {
  const full = timeOffSubmittedMessage(request());
  assert.equal(full.subject, 'Time-off request from nurse@example.test');
  assert.match(full.body, /New time-off request from nurse@example\.test/);
  assert.match(full.body, /paid time off/, 'the type is printed with its underscores replaced');
  assert.match(full.body, /2026-10-05/);
  assert.match(full.body, /Family visit/);
  assert.match(full.body, /Jo covers Tuesday/);
  assert.match(full.body, /Review it in PennSync under Time Off/);
  assert.equal(full.summary, '3 day(s) of paid time off (2026-10-05 → 2026-10-07)');

  const bare = timeOffSubmittedMessage(request({ reason: null, coverage: null }));
  assert.doesNotMatch(bare.body, /Reason/, 'a request with no reason prints no Reason row');
  assert.doesNotMatch(bare.body, /Coverage/);
  assert.match(bare.body, /Business days/, 'and the unconditional rows are still there');
});

test('the message escapes what a caller wrote', () => {
  const message = timeOffSubmittedMessage(request({ reason: '<script>alert(1)</script>' }));
  assert.doesNotMatch(message.body, /<script>/);
  assert.match(message.body, /&lt;script&gt;/);
});

test('a module that sends a side-effect notice declares the runtime and not delivery', () => {
  // The cross-check for THIS shape, and the reason it is separate from
  // `account-email.test.mjs`'s: that one ties `needsDelivery` to calling
  // `requireDeliveryReleased`, which a side-effect sender must not call. Left
  // unwritten, a notice could reach the runtime with no flag at all — a
  // deployment reporting ready with no runtime configured — or carry
  // `needsDelivery` and take a whole wave's readiness with it.
  const dir = new URL('.', import.meta.url);
  const notifying = new Set();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.mjs') || file.endsWith('.test.mjs')) continue;
    const source = readFileSync(new URL(file, dir), 'utf8');
    if (!/deliverNotices\s*\(/.test(source) || file === 'workforce-email.mjs') continue;
    for (const match of source.matchAll(/export async function ([A-Za-z][A-Za-z0-9]*)/g)) {
      notifying.add(match[1]);
    }
  }
  const exported = readFileSync(new URL('workforce-email.mjs', dir), 'utf8');
  for (const match of exported.matchAll(/export async function (notify[A-Za-z0-9]*)/g)) {
    notifying.add(match[1]);
  }
  assert.deepEqual([...notifying].sort(), ['notifyTimeOffSubmitted'],
    'the notices are the ones this file knows about');

  const registry = readFileSync(new URL('handlers.mjs', dir), 'utf8');
  const start = registry.indexOf('export const HANDLERS');
  const body = registry.slice(start);
  const blocks = [...body.matchAll(/\n {2}([A-Za-z][A-Za-z0-9]*): Object\.freeze\(\{/g)];
  blocks.forEach((entry, index) => {
    const block = body.slice(entry.index, blocks[index + 1]?.index ?? body.length);
    const notifies = [...notifying].some(name => block.includes(`${name}(`));
    if (!notifies) return;
    assert.match(block, /needsIntegration:\s*true/,
      `${entry[1]}: a handler that sends a notice reaches the runtime`);
    assert.doesNotMatch(block, /needsDelivery:\s*true/,
      `${entry[1]}: its record work stands without delivery, so the wave must not require it`);
  });
});
