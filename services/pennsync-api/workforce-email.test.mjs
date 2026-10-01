import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AUTHORITY_CONTRACT } from './authority.mjs';
import { createHandler } from './app.mjs';
import { HANDLERS, HANDLER_NAMES } from './handlers.mjs';
import { loadConfig } from './runtime.mjs';
import {
  DELIVERY_RELEASE_ENV,
  DELIVERY_RELEASE_VALUE,
  WORKFORCE_NOTICE_RELEASE_ENV,
  workforceNoticeDeliverable,
} from './outbound-delivery.mjs';

/**
 * The environment that opens the channel, in ONE place.
 *
 * Both switches, because these five need `PENNSYNC_API_DELIVERY` AND their own
 * `PENNSYNC_API_WORKFORCE_NOTICES`. Defined once so a harness cannot release
 * one and forget the other — three harnesses in this file build a released
 * deployment, and three copies of a two-flag environment is how one of them
 * ends up testing the paused path while claiming to test the released one.
 *
 * `notices` is a parameter so the adversarial table below can drive this with
 * every value that is NOT the release word, through the same code path a real
 * deployment uses.
 *
 * **`ABSENT` is a symbol and not `undefined`, and that is not fussiness.** The
 * first version of this helper used `notices === undefined` to mean "set
 * nothing", which cannot work: a default parameter is applied exactly when the
 * argument is `undefined`, so `releasedEnv(undefined)` returned the FULLY
 * RELEASED environment and the case labelled `absent` was silently testing the
 * opposite of what it claimed. The test below caught it. It is the same defect
 * the gate itself exists to prevent — an absent value falling into the open
 * case rather than the closed one — arriving in the harness written to prove
 * the gate, so the marker is a value no caller can produce by accident.
 */
const ABSENT = Symbol('the notices switch is set to nothing at all');
const releasedEnv = (notices = DELIVERY_RELEASE_VALUE) => ({
  [DELIVERY_RELEASE_ENV]: DELIVERY_RELEASE_VALUE,
  ...(notices === ABSENT ? {} : { [WORKFORCE_NOTICE_RELEASE_ENV]: notices }),
});
import {
  APPROVER_LIMIT,
  PAGE_BUDGET,
  agencyAdminRecipients,
  credentialRenewalMessage,
  notifyTimeOffCancelled,
  notifyTimeOffSubmitted,
  notifyTimeOffReviewed,
  notifyCredentialReviewed,
  notifyCredentialRenewal,
  credentialReviewedMessage,
  timeOffCancelledMessage,
  timeOffReviewedMessage,
  timeOffSubmittedMessage,
} from './workforce-email.mjs';

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
const REVIEW_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_time_off_review`;
const ROSTER_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_roster_list`;
const NOTIFY_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_notification_create`;

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
  delivery = false, notices = DELIVERY_RELEASE_VALUE,
  row = request(), roster = [() => rosterPage([])], mail = () => ({ ok: true }),
  mint = () => ({ ok: true }),
} = {}) => {
  const sent = [];
  const asked = [];
  const minted = [];
  const config = loadConfig(env(delivery ? releasedEnv(notices) : {}));
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
      if (target === NOTIFY_RPC) {
        const body = JSON.parse(init.body);
        minted.push(body.p_notification);
        return mint(body).ok
          ? Response.json({ success: true, notification_id: 'note-1', delivery_paused: true })
          : Response.json({ message: 'PENNSYNC_NOTIFICATION_RECIPIENT_FORBIDDEN' }, { status: 403 });
      }
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
  return { handler, sent, asked, minted };
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
  assert.deepEqual([...notifying].sort(), ['notifyCredentialRenewal', 'notifyCredentialReviewed',
    'notifyTimeOffCancelled', 'notifyTimeOffReviewed', 'notifyTimeOffSubmitted'],
    'the notices are the ones this file knows about — a new one fails here until it is covered');

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

/**
 * The review half. Its own deployment builder, because the capability is a
 * different name with different params and the recipient comes from the row
 * rather than from a roster — so nothing here shares `serve`'s roster stub, and
 * a reader can see that no roster read is expected.
 */
const REVIEW = 'reviewTimeOffRequest';
const reviewParams = { request_id: 'req-1', decision: 'approved', note: 'Enjoy it' };
const reviewed = (patch = {}) => request({
  status: 'approved', reviewed_by: 'manager@example.test',
  reviewer_name: 'manager@example.test', reviewed_at: '2026-09-30T12:00:00Z',
  review_notes: 'Enjoy it', ...patch,
});
const serveReview = ({
  delivery = false, notices = DELIVERY_RELEASE_VALUE,
  row = reviewed(), mail = () => ({ ok: true }),
} = {}) => {
  const sent = [];
  const rosterReads = [];
  const minted = [];
  const config = loadConfig(env({
    PENNSYNC_API_FUNCTIONS: REVIEW,
    ...(delivery ? releasedEnv(notices) : {}),
  }));
  const handler = createHandler(config, {
    fetcher: async (url, init) => {
      const target = String(url);
      if (target.startsWith(RUNTIME)) {
        const body = JSON.parse(init.body);
        sent.push(body);
        return mail(body).ok
          ? Response.json({ success: true, result: { accepted: true, delivered: false, provider: 'sendgrid' } })
          : Response.json({ error: 'PROVIDER_REFUSED' }, { status: 502 });
      }
      if (target === REVIEW_RPC) return Response.json({ success: true, request: row });
      if (target === NOTIFY_RPC) {
        minted.push(JSON.parse(init.body).p_notification);
        return Response.json({ success: true, notification_id: 'note-1', delivery_paused: true });
      }
      if (target === ROSTER_RPC) { rosterReads.push(1); return Response.json(rosterPage([])); }
      return Response.json(context('manager'));
    },
    records: () => () => { throw new Error('records must not be reached'); },
    audit: () => () => { throw new Error('audit must not be reached'); },
  });
  const post = () => new Request(`https://api.example.test/v1/functions/${REVIEW}`, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', params: reviewParams }),
  });
  return { handler, sent, rosterReads, minted, post };
};

test('the reviewed notice is registered the same way and needs no roster read', async () => {
  assert.equal(HANDLERS[REVIEW].needsIntegration, true);
  assert.equal(Object.hasOwn(HANDLERS[REVIEW], 'needsDelivery'), false);
  const { handler, sent, rosterReads, post } = serveReview({ delivery: true });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.request.id, 'req-1');
  assert.equal(answer.email, true);
  assert.equal(answer.delivery_paused, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.to, 'nurse@example.test', 'the employee on the row, not the caller');
  assert.deepEqual(rosterReads, [], 'nothing was asked of the roster');
});

test('a paused deployment records the decision and attempts no send', async () => {
  const { handler, sent, post } = serveReview({ delivery: false });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.request.status, 'approved', 'the decision is recorded');
  assert.equal(answer.delivery_paused, true);
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0);
});

test('a row with no employee address reports no paused delivery', async () => {
  const { handler, sent, post } = serveReview({
    delivery: false, row: reviewed({ employee_email: null }),
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.delivery_paused, false, 'there was no delivery to pause');
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0);
});

test('a provider refusal leaves the decision recorded', async () => {
  const { handler, post } = serveReview({ delivery: true, mail: () => ({ ok: false }) });
  const response = await handler(post());
  assert.equal(response.status, 200);
  const answer = await resultOf(response);
  assert.equal(answer.request.status, 'approved');
  assert.equal(answer.email, false);
});

test('the reviewed message reads the ROW, so it says what happened and not what was asked', () => {
  // The decision comes from the contract's stored `status`, not from the
  // caller's `decision` parameter. A message built from the request would
  // announce an approval for a contract that recorded a denial.
  const denied = timeOffReviewedMessage(reviewed({ status: 'denied', review_notes: 'Short staffed' }));
  assert.equal(denied.subject, 'Update on your time-off request');
  assert.match(denied.body, /was not approved/);
  assert.match(denied.body, /Short staffed/);
  assert.match(denied.body, /Note from reviewer/);

  const approved = timeOffReviewedMessage(reviewed());
  assert.equal(approved.subject, 'Your time off was approved');
  assert.match(approved.body, /Enjoy your time away/);

  const silent = timeOffReviewedMessage(reviewed({ review_notes: '   ' }));
  assert.doesNotMatch(silent.body, /Note from reviewer/,
    'a whitespace-only note prints no row, as the original trims before testing');
});

test('cancelTimeOffRequest carries both flags now that its field exists', () => {
  assert.equal(HANDLERS.cancelTimeOffRequest.needsIntegration, true);
  assert.equal(Object.hasOwn(HANDLERS.cancelTimeOffRequest, 'needsDelivery'), false);
});

/**
 * The credential pair. Two capabilities, two shapes, and the split is worth
 * naming: the REVIEW notice is addressed from the row the contract answered
 * with, so it needs no roster; the SUBMIT notice is addressed to the agency's
 * administrators through the roster and is sent only for a RENEWAL, which is a
 * condition over the caller's own parameters.
 */
const REVIEW_CRED = 'reviewPersonnelCredential';
const SUBMIT_CRED = 'submitPersonnelCredential';
const CRED_REVIEW_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_credential_review`;
const CRED_SUBMIT_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_credential_submit`;
/**
 * The row `credential_row` projects. `user_id` holds the owner's EMAIL — the
 * submit contract writes `caller_email()` there and both the ownership check
 * and the list predicate compare it with `lower(v_email)` — so it is the
 * store's own verified copy of the address, which is why no roster read is
 * expected on the review side.
 */
const credential = (patch = {}) => ({
  id: 'cred-1', user_id: 'nurse@example.test', user_name: 'nurse@example.test',
  item_type: 'license', title: 'RN License', issuing_organization: 'PA Board',
  credential_number: 'RN-1', issued_date: '2024-01-01', expiration_date: '2027-01-01',
  uploaded_file_name: 'rn.pdf', notes: null, status: 'approved',
  approved_by: 'admin@example.test', approved_at: '2026-09-30T12:00:00Z',
  rejection_reason: null, ...patch,
});

const serveCredential = ({
  name, rpc, params: callParams, delivery = false, notices = DELIVERY_RELEASE_VALUE,
  row = credential(),
  roster = [() => Response.json(rosterPage([]))], mail = () => ({ ok: true }), tenantRole = 'agency_admin',
}) => {
  const sent = [];
  const asked = [];
  const minted = [];
  const config = loadConfig(env({
    PENNSYNC_API_FUNCTIONS: name,
    ...(delivery ? releasedEnv(notices) : {}),
  }));
  const handler = createHandler(config, {
    fetcher: async (url, init) => {
      const target = String(url);
      if (target.startsWith(RUNTIME)) {
        const body = JSON.parse(init.body);
        sent.push(body);
        return mail(body).ok
          ? Response.json({ success: true, result: { accepted: true, delivered: false, provider: 'sendgrid' } })
          : Response.json({ error: 'PROVIDER_REFUSED' }, { status: 502 });
      }
      if (target === rpc) return Response.json({ success: true, credential: row });
      if (target === NOTIFY_RPC) {
        minted.push(JSON.parse(init.body).p_notification);
        return Response.json({ success: true, notification_id: 'note-1', delivery_paused: true });
      }
      if (target === ROSTER_RPC) {
        const body = JSON.parse(init.body);
        asked.push(body);
        return roster[Math.min(asked.length - 1, roster.length - 1)](body);
      }
      return Response.json(context(tenantRole));
    },
    records: () => () => { throw new Error('records must not be reached'); },
    audit: () => () => { throw new Error('audit must not be reached'); },
  });
  const post = () => new Request(`https://api.example.test/v1/functions/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', params: callParams }),
  });
  return { handler, sent, asked, minted, post };
};

const reviewCred = (patch = {}) => serveCredential({
  name: REVIEW_CRED, rpc: CRED_REVIEW_RPC,
  params: { credential_id: 'cred-1', action: 'approve', rejection_reason: null }, ...patch,
});
const submitCred = (patch = {}) => serveCredential({
  name: SUBMIT_CRED, rpc: CRED_SUBMIT_RPC,
  params: {
    credential_id: 'cred-1', renews_credential_id: 'cred-0',
    credential: { title: 'RN License', item_type: 'license', expiration_date: '2027-01-01' },
  },
  ...patch,
});

test('the credential notices carry the same two registry flags', () => {
  for (const name of [REVIEW_CRED, SUBMIT_CRED]) {
    assert.equal(HANDLERS[name].needsIntegration, true, `${name} reaches the runtime`);
    assert.equal(Object.hasOwn(HANDLERS[name], 'needsDelivery'), false,
      `${name}: the record work stands without delivery`);
  }
});

test('a reviewed credential mails the owner from the ROW and asks the roster nothing', async () => {
  const { handler, sent, asked, post } = reviewCred({ delivery: true });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.credential.id, 'cred-1');
  assert.equal(answer.email, true);
  assert.equal(answer.delivery_paused, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].operation, 'SendEmail');
  // The original sends `to: credential.user_id`, and that column holds the
  // address the submit contract verified. A port addressing the CALLER would
  // mail the reviewer their own decision.
  assert.equal(sent[0].params.to, 'nurse@example.test');
  assert.equal(sent[0].params.subject, 'Credential approved — RN License');
  // Through the HANDLER, not through the message builder. The builder's own
  // test passes an address in by hand, so it could not see that the sender was
  // reading a field the actor does not have — `actor.userEmail`, camelCase,
  // per `authority.mjs`'s frozen projection — and an undefined reviewer
  // renders an empty "Approved by" row rather than failing.
  assert.match(sent[0].params.body, /nurse@example\.test/, 'the owner is greeted');
  assert.match(sent[0].params.body, />Approved by<\/td>\s*<td[^>]*>[^<]*@/,
    'and the approver cell carries an address');
  assert.deepEqual(asked, [], 'nothing was asked of the roster');
});

test('a paused deployment records the credential decision and attempts no send', async () => {
  const { handler, sent, post } = reviewCred({ delivery: false });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.credential.status, 'approved', 'the compliance decision is recorded');
  assert.equal(answer.delivery_paused, true);
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0);
});

test('a credential with no owner address reports no paused delivery', async () => {
  // The original computes `deliveryPaused = !released` with no recipient test
  // at all, so an unaddressable row would claim a message was waiting on a
  // switch. The narrowing is deliberate and recorded in the module.
  const { handler, sent, post } = reviewCred({ delivery: false, row: credential({ user_id: null }) });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.delivery_paused, false, 'there was no delivery to pause');
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0);
});

test('a provider refusal leaves the credential decision recorded', async () => {
  const { handler, post } = reviewCred({ delivery: true, mail: () => ({ ok: false }) });
  const response = await handler(post());
  assert.equal(response.status, 200);
  const answer = await resultOf(response);
  assert.equal(answer.credential.status, 'approved');
  assert.equal(answer.email, false);
});

test('the reviewed credential message is two documents, not one with a branch', () => {
  const approved = credentialReviewedMessage(credential(), 'admin@example.test');
  assert.equal(approved.subject, 'Credential approved — RN License');
  assert.match(approved.body, /has been approved/);
  assert.match(approved.body, /2027-01-01/, 'the expiration is projected');
  assert.match(approved.body, /admin@example\.test/, 'and the approver');

  const revision = credentialReviewedMessage(
    credential({ status: 'rejected', rejection_reason: 'Illegible scan' }), 'admin@example.test');
  assert.equal(revision.subject, 'Credential needs revision — RN License');
  assert.match(revision.body, /Illegible scan/);
  // The revision notice projects neither, which is the original's shape: an
  // expiration on a document that was not accepted would read as accepted.
  assert.doesNotMatch(revision.body, /2027-01-01/);
  assert.doesNotMatch(revision.body, /admin@example\.test/);
});

test('a RENEWAL notifies the agency administrators through the roster', async () => {
  const { handler, sent, asked, post } = submitCred({
    delivery: true,
    roster: [() => Response.json(rosterPage([
      member('admin@example.test'),
      member('nurse@example.test', 'clinician'),
      member('stale@example.test', 'agency_admin', false),
    ]))],
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.email, true);
  assert.equal(answer.delivery_paused, false);
  assert.equal(asked.length, 1, 'the roster answered the question the User.list scan used to');
  // Only the active administrator. The non-admin and the inactive row are
  // filtered on the AUTHORITATIVE `tenant_role` and `is_active`, never on the
  // carried profile's self-editable labels (D23).
  assert.deepEqual(sent.map(body => body.params.to), ['admin@example.test']);
  assert.equal(sent[0].params.subject, 'Credential renewal submitted — RN License');
});

test('a FIRST submission notifies nobody and reports no paused delivery', async () => {
  // The condition is the original's — `renews_credential_id &&
  // renews_credential_id !== credential_id` — and it is read from the caller's
  // parameters, which is why no contract change was needed to evaluate it. A
  // port that notified on every submission would mail the administrators about
  // routine filings the original never mentions.
  for (const renews of [null, 'cred-1']) {
    const { handler, sent, asked, post } = submitCred({
      delivery: true,
      params: {
        credential_id: 'cred-1', renews_credential_id: renews,
        credential: { title: 'RN License', item_type: 'license', expiration_date: '2027-01-01' },
      },
    });
    const answer = await resultOf(await handler(post()));
    assert.equal(answer.email, false, `renews_credential_id ${renews}`);
    assert.equal(answer.delivery_paused, false, 'no send was ever eligible');
    assert.equal(sent.length, 0);
    assert.deepEqual(asked, [], 'and the roster is not read for a non-renewal');
  }
});

test('a paused deployment files the renewal, says so, and ATTEMPTS nothing', async () => {
  // The case a sabotage pass found missing. The only paused renewal test had an
  // EMPTY roster, so deleting the release branch altogether came back green:
  // with nobody to notify there is no send either way. An administrator has to
  // be present for the branch to be the thing under test.
  const { handler, sent, post } = submitCred({
    delivery: false,
    roster: [() => Response.json(rosterPage([member('admin@example.test')]))],
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.credential.id, 'cred-1', 'the filing is the capability and it happened');
  assert.equal(answer.delivery_paused, true, 'a recipient exists and the channel is off');
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0);
});

test('and the renewal never reaches the integration capability while paused', async () => {
  // The wire assertion above cannot see the branch deleted: `SendEmail` is not
  // in the brokered set while delivery is unreleased, so an unguarded send is
  // refused one layer in and swallowed by the best-effort catch. This replaces
  // the capability so the question is whether it was ASKED.
  const attempts = [];
  const config = loadConfig(env({ PENNSYNC_API_FUNCTIONS: SUBMIT_CRED }));
  const handler = createHandler(config, {
    fetcher: async (url) => {
      const target = String(url);
      if (target === CRED_SUBMIT_RPC) return Response.json({ success: true, credential: credential() });
      if (target === ROSTER_RPC) return Response.json(rosterPage([member('admin@example.test')]));
      return Response.json(context('agency_admin'));
    },
    integration: () => (operation) => {
      attempts.push(operation);
      throw new Error('INTEGRATION_OPERATION_NOT_BROKERED');
    },
    records: () => () => { throw new Error('records must not be reached'); },
    audit: () => () => { throw new Error('audit must not be reached'); },
  });
  const post = () => new Request(`https://api.example.test/v1/functions/${SUBMIT_CRED}`, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      agency_id: 'agency-a',
      params: {
        credential_id: 'cred-1', renews_credential_id: 'cred-0',
        credential: { title: 'RN License', item_type: 'license', expiration_date: '2027-01-01' },
      },
    }),
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.credential.id, 'cred-1');
  assert.equal(answer.delivery_paused, true);
  assert.deepEqual(attempts, [], 'the send was never asked for');
});

test('a renewal with no administrator reports no paused delivery', async () => {
  const { handler, sent, post } = submitCred({ delivery: false, roster: [() => Response.json(rosterPage([]))] });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.credential.id, 'cred-1', 'the filing is the capability and it happened');
  assert.equal(answer.delivery_paused, false, 'there was nobody to notify');
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0);
});

test('a roster failure leaves the credential filed', async () => {
  const { handler, post } = submitCred({
    delivery: true,
    roster: [() => Response.json({ error: 'ROSTER_UNAVAILABLE' }, { status: 502 })],
  });
  const response = await handler(post());
  assert.equal(response.status, 200);
  const answer = await resultOf(response);
  assert.equal(answer.credential.id, 'cred-1');
  assert.equal(answer.email, false);
});

test('the submitter is NOT excluded from the renewal fan-out', async () => {
  // The counter-case to the time-off fan-out, which excludes the caller. This
  // original excludes nobody, and an `agency_admin` renewing their own
  // credential is the case D40 created — D44's rule is that the other
  // administrators keep seeing it.
  const { handler, sent, post } = submitCred({
    delivery: true,
    roster: [() => Response.json(rosterPage([
      member('nurse@example.test'), member('admin@example.test'),
    ]))],
  });
  await handler(post());
  assert.deepEqual(sent.map(body => body.params.to).sort(),
    ['admin@example.test', 'nurse@example.test']);
});

test('the renewal message projects the new expiration and the employee', () => {
  const message = credentialRenewalMessage(credential());
  assert.equal(message.subject, 'Credential renewal submitted — RN License');
  assert.match(message.body, /nurse@example\.test/);
  assert.match(message.body, /2027-01-01/);
  assert.match(message.body, /Pending Credential Approvals/);
});

/**
 * The IN-APP row. These ports minted none, and the gap was invisible for the
 * reason worth keeping: a paused deployment answered `delivery_paused: true`,
 * which reads as "doing all it can", while the row the dashboard reads was
 * never written either. So the assertions that matter are the ones with
 * delivery UNRELEASED.
 */
test('a paused deployment still mints the approver row, because a row is not delivery-gated', async () => {
  const { handler, sent, minted } = serve({ delivery: false });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.delivery_paused, true);
  assert.equal(answer.email, false);
  assert.equal(sent.length, 0, 'no mail while the channel is off');
  // D51: the notification is a row, so it is written anyway. This is the whole
  // change — with the mint behind the release branch the assertion above would
  // still pass and the manager would still see nothing.
  assert.equal(minted.length, 1);
  assert.equal(minted[0].user_email, 'manager@example.test');
  assert.equal(minted[0].type, 'info');
  assert.equal(minted[0].title, 'New time-off request');
  assert.match(minted[0].message, /requested 3 day\(s\) of paid time off/);
  assert.equal(minted[0].action_url, '/TimeOff');
  assert.equal(minted[0].metadata.time_off_request_id, 'req-1');
});

test('the approver row goes to the same recipients as the mail, fallback included', async () => {
  const { handler, sent, minted } = serve({
    delivery: true, row: request({ manager_email: null }),
    roster: [() => Response.json(rosterPage([
      member('admin-one@example.test'), member('admin-two@example.test'),
    ]))],
  });
  await handler(post());
  // One row per approver, and the same list the send used. A port minting for
  // the named manager only would leave the fallback recipients out of the
  // dashboard while mailing them.
  assert.deepEqual(minted.map(n => n.user_email).sort(),
    ['admin-one@example.test', 'admin-two@example.test']);
  assert.deepEqual(sent.map(body => body.params.to).sort(),
    ['admin-one@example.test', 'admin-two@example.test']);
});

test('a row with no approver at all mints nothing', async () => {
  const { handler, minted } = serve({ delivery: true, row: request({ manager_email: null }) });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.delivery_paused, false);
  assert.deepEqual(minted, [], 'there is nobody to address');
});

test('a refused mint loses neither the other rows nor the mail', async () => {
  // The deliberate divergence, asserted rather than described. The originals
  // put the whole fan-out in one `Promise.all` inside the same `try` as the
  // send, so one refused row drops every row AND the email for an event that
  // really happened.
  const { handler, sent, minted } = serve({
    delivery: true, row: request({ manager_email: null }),
    roster: [() => Response.json(rosterPage([
      member('admin-one@example.test'), member('admin-two@example.test'),
    ]))],
    mint: body => ({ ok: body.p_notification.user_email !== 'admin-one@example.test' }),
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(minted.length, 2, 'both were attempted');
  assert.equal(answer.email, true, 'and the mail went out regardless');
  assert.equal(sent.length, 2);
  assert.equal(answer.request.id, 'req-1');
});

test('the reviewed row carries the decision in its TYPE, from the row', async () => {
  const approved = serveReview({ delivery: false });
  const first = await resultOf(await approved.handler(approved.post()));
  assert.equal(first.delivery_paused, true);
  assert.equal(approved.minted.length, 1);
  assert.equal(approved.minted[0].user_email, 'nurse@example.test');
  assert.equal(approved.minted[0].type, 'info');
  assert.equal(approved.minted[0].title, 'Time off approved');
  assert.equal(approved.minted[0].metadata.reviewed_by, 'manager@example.test');

  const denied = serveReview({ delivery: false, row: reviewed({ status: 'denied', review_notes: 'Short staffed' }) });
  await denied.handler(denied.post());
  // `compliance_alert` is NOT in the contract's non-admin allowlist, which is
  // why this path depends on the reviewer being an `agency_admin` or the
  // manager the request named — both of which the time-off contract pins.
  assert.equal(denied.minted[0].type, 'compliance_alert');
  assert.equal(denied.minted[0].title, 'Time off denied');
  assert.match(denied.minted[0].message, /was denied: Short staffed/);
});

test('a reviewed row with no employee address mints nothing', async () => {
  const { handler, minted, post } = serveReview({
    delivery: false, row: reviewed({ employee_email: null }),
  });
  await handler(post());
  assert.deepEqual(minted, []);
});

test('the two credential notices mint no row', async () => {
  // Their originals create none — measured, and asserted in
  // `base44/functionTests/pennsyncApiOriginalParity.test.js`, because D60 keeps
  // a test in this directory from reading a file outside it: the image is built
  // from this directory alone. The half that belongs here is that the ported
  // handlers mint nothing.
  const { handler, minted, post } = reviewCred({ delivery: true });
  await handler(post());
  assert.deepEqual(minted, []);
  const submit = submitCred({
    delivery: true,
    roster: [() => Response.json(rosterPage([member('admin@example.test')]))],
  });
  await submit.handler(submit.post());
  assert.deepEqual(submit.minted, [], 'not even on the renewal path that does mail');
});

/**
 * The withdrawal notice. It is the only one of the five whose eligibility the
 * store had to be changed to answer, so the assertions that matter are the ones
 * that turn on `previous_status` and nothing else.
 */
const CANCEL = 'cancelTimeOffRequest';
const CANCEL_RPC = `${TARGET}/rest/v1/rpc/pennsync_contract_time_off_cancel`;
const cancelled = (patch = {}) => request({ status: 'cancelled', ...patch });

const serveCancel = ({
  delivery = false, notices = DELIVERY_RELEASE_VALUE,
  row = cancelled(), previous = 'approved', mail = () => ({ ok: true }),
} = {}) => {
  const sent = [];
  const minted = [];
  const config = loadConfig(env({
    PENNSYNC_API_FUNCTIONS: CANCEL,
    ...(delivery ? releasedEnv(notices) : {}),
  }));
  const handler = createHandler(config, {
    fetcher: async (url, init) => {
      const target = String(url);
      if (target.startsWith(RUNTIME)) {
        const body = JSON.parse(init.body);
        sent.push(body);
        return mail(body).ok
          ? Response.json({ success: true, result: { accepted: true, delivered: false, provider: 'sendgrid' } })
          : Response.json({ error: 'PROVIDER_REFUSED' }, { status: 502 });
      }
      if (target === CANCEL_RPC) {
        // `previous` of null means the key is ABSENT from the answer, which is
        // what a deployment running the pre-migration contract sends. Passing
        // `undefined` would silently take this builder's default instead — the
        // trap that made the first draft of that test pass for the wrong
        // reason.
        return Response.json(previous === null
          ? { success: true, request: row }
          : { success: true, previous_status: previous, request: row });
      }
      if (target === NOTIFY_RPC) {
        minted.push(JSON.parse(init.body).p_notification);
        return Response.json({ success: true, notification_id: 'note-1', delivery_paused: true });
      }
      return Response.json(context('clinician'));
    },
    records: () => () => { throw new Error('records must not be reached'); },
    audit: () => () => { throw new Error('audit must not be reached'); },
  });
  const post = () => new Request(`https://api.example.test/v1/functions/${CANCEL}`, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', params: { request_id: 'req-1' } }),
  });
  return { handler, sent, minted, post };
};

test('a withdrawn APPROVED request tells the manager, in app and by mail', async () => {
  const { handler, sent, minted, post } = serveCancel({ delivery: true, previous: 'approved' });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.request.status, 'cancelled');
  assert.equal(answer.email, true);
  assert.equal(answer.delivery_paused, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.to, 'manager@example.test');
  assert.equal(sent[0].params.subject, 'Time off cancelled by nurse@example.test');
  assert.equal(minted.length, 1);
  assert.equal(minted[0].user_email, 'manager@example.test');
  // The original's, and the only notice of the five that is not `medium`.
  assert.equal(minted[0].priority, 'low');
  assert.equal(minted[0].action_label, 'View calendar');
});

test('a withdrawn PENDING request tells nobody, which is the whole condition', async () => {
  // The case the port could not evaluate before the forward migration: the row
  // reads `cancelled` in both, and only `previous_status` distinguishes them.
  // Wiring it without this would have mailed a manager about a request the
  // original never mentions.
  const { handler, sent, minted, post } = serveCancel({ delivery: true, previous: 'pending' });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.request.status, 'cancelled', 'the cancellation is recorded');
  assert.equal(answer.email, false);
  assert.equal(answer.delivery_paused, false, 'no send was ever eligible');
  assert.deepEqual(sent, []);
  assert.deepEqual(minted, [], 'and the row is gated on eligibility, unlike on delivery');
});

test('a manager cancelling the leave they approved is not told about it', async () => {
  // The original's third term. The row names the caller as its own approver,
  // which is the shape an `agency_admin` who is also the named manager hits.
  const { handler, sent, minted, post } = serveCancel({
    delivery: true, previous: 'approved',
    row: cancelled({ manager_email: 'nurse@example.test' }),
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.email, false);
  assert.equal(answer.delivery_paused, false);
  assert.deepEqual(sent, []);
  assert.deepEqual(minted, []);
});

test('and that comparison is case-insensitive, as the original is not', async () => {
  // Driven directly rather than through the handler, because the authority
  // envelope refuses a non-normalised caller address before a handler runs —
  // so the case this guards against cannot be reached from outside, and the
  // comparison is kept anyway because the addresses come from two sources.
  const attempts = [];
  const answer = await notifyTimeOffCancelled({
    request: cancelled({ manager_email: 'Manager@Example.test' }),
    previousStatus: 'approved',
    actor: { userEmail: 'manager@example.test' },
    config: { deliveryReleased: true },
    integration: () => { attempts.push('SendEmail'); return { accepted: true }; },
    contract: () => { attempts.push('createNotification'); return { success: true }; },
  });
  assert.equal(answer.email, false);
  assert.deepEqual(attempts, [], 'neither half was attempted');
});

test('a request with no manager named notifies nobody and pauses nothing', async () => {
  const { handler, sent, minted, post } = serveCancel({
    delivery: false, previous: 'approved', row: cancelled({ manager_email: null }),
  });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.delivery_paused, false, 'there was no delivery to pause');
  assert.deepEqual(sent, []);
  assert.deepEqual(minted, []);
});

test('a paused deployment still mints the withdrawal row and attempts no send', async () => {
  const { handler, sent, minted, post } = serveCancel({ delivery: false, previous: 'approved' });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.delivery_paused, true, 'a recipient exists and the channel is off');
  assert.equal(answer.email, false);
  assert.deepEqual(sent, []);
  assert.equal(minted.length, 1, 'the row is not delivery-gated (D51)');
});

test('a missing previous_status is treated as ineligible, not as approved', async () => {
  // Fails safe. A deployment running the contract from before the forward
  // migration answers without the key, and the alternative — assuming the
  // request had been approved — would mail a manager about a withdrawn pending
  // request on exactly the deployments that cannot tell.
  const { handler, sent, minted, post } = serveCancel({ delivery: true, previous: null });
  const answer = await resultOf(await handler(post()));
  assert.equal(answer.email, false);
  assert.deepEqual(sent, []);
  assert.deepEqual(minted, []);
});

test('the withdrawal message names the employee, the type and the dates', () => {
  const message = timeOffCancelledMessage(cancelled());
  assert.equal(message.subject, 'Time off cancelled by nurse@example.test');
  assert.match(message.body, /previously approved paid time off/);
  assert.match(message.body, /2026-10-05/);
  assert.match(message.body, /team calendar/);
});

/**
 * The five senders' own release gate, which is the thing that keeps them shut
 * while `PENNSYNC_API_DELIVERY` is open.
 *
 * `PENNSYNC_API_DELIVERY` was released for the two account emails and a live
 * `/readyz` read on 2026-10-01 reports it still true, so on the day these five
 * were written the ONLY thing between them and a real manager's inbox was a
 * deployment nobody had done yet. This block is what replaces that accident.
 *
 * **Every case drives `loadConfig`**, so what is proved is the whole chain from
 * the environment an operator sets to the branch in the sender — not a hand-made
 * config object, which would pass with the env read deleted.
 *
 * **The fake integration COUNTS CALLS and never throws.** Every one of the five
 * wraps its body in `catch {}`, so a throwing fake is swallowed and the answer
 * is identical whether the gate held or the send was attempted and failed. An
 * assertion both paths satisfy proves nothing, which is the whole defect this
 * gate exists to prevent, so the assertion is on the call count.
 */
const NOT_THE_RELEASE_WORD = Object.freeze([
  ['absent', ABSENT],
  ['empty', ''],
  ['the string true', 'true'],
  ['a boolean-ish 1', '1'],
  ['wrong case', 'enabled-V1'],
  ['shouted', 'ENABLED-V1'],
  ['a leading space', ' enabled-v1'],
  ['a trailing space', 'enabled-v1 '],
  ['explicitly disabled', 'disabled'],
  ['a later version nobody has defined', 'enabled-v2'],
  ["the OTHER switch's name", DELIVERY_RELEASE_ENV],
]);

test('the gate reads paused for every value that is not exactly the release word', () => {
  for (const [label, value] of NOT_THE_RELEASE_WORD) {
    const config = loadConfig(env(releasedEnv(value)));
    assert.equal(config.deliveryReleased, true, `${label}: delivery itself must be open`);
    assert.equal(config.workforceNoticesReleased, false, `${label}: must not read released`);
    assert.equal(workforceNoticeDeliverable(config), false, `${label}: must not be deliverable`);
  }
  // The positive control. Without it this test passes with the comparison
  // inverted, or with `releasedEnv` quietly setting nothing at all.
  const open = loadConfig(env(releasedEnv()));
  assert.equal(open.workforceNoticesReleased, true);
  assert.equal(workforceNoticeDeliverable(open), true);
});

test('the gate can never open a channel PENNSYNC_API_DELIVERY has left shut', () => {
  // It narrows and cannot widen: with delivery unset, the notices switch set to
  // the release word still reaches no provider.
  const config = loadConfig(env({ [WORKFORCE_NOTICE_RELEASE_ENV]: DELIVERY_RELEASE_VALUE }));
  assert.equal(config.deliveryReleased, false);
  assert.equal(config.workforceNoticesReleased, true);
  assert.equal(workforceNoticeDeliverable(config), false);
});

test('a config object missing the field entirely is paused rather than undefined', () => {
  // The shape a caller built before this flag existed. `?.` makes the absent
  // case the paused case rather than a case nobody thought about.
  assert.equal(workforceNoticeDeliverable({ deliveryReleased: true }), false);
  assert.equal(workforceNoticeDeliverable({}), false);
  assert.equal(workforceNoticeDeliverable(undefined), false);
  assert.equal(workforceNoticeDeliverable(null), false);
});

/** One agency administrator, so the roster-reading senders have a recipient. */
const rosterContract = () => async name => (name === 'listAgencyRoster'
  ? { entries: [{ tenant_role: 'agency_admin', is_active: true, email: 'admin@example.test' }], next: null }
  : {});
/** A RENEWAL, which is the only shape `notifyCredentialRenewal` notifies on. */
const renewalParams = () => ({ credential_id: 'cred-1', renews_credential_id: 'cred-0' });

/**
 * Each of the five, driven with a config and a call-counting integration.
 *
 * Every fixture here is deliberately one that WOULD send on a released
 * deployment — a designated manager, an addressable employee, an administrator
 * on the roster, a genuine renewal, a cancellation of an approved request by
 * somebody other than the manager. A fixture with no recipient would make every
 * assertion below pass for the wrong reason, which the control test proves this
 * table does not do.
 */
const FIVE_SENDERS = [
  ['notifyTimeOffSubmitted', (config, integration) => notifyTimeOffSubmitted({
    request: request(), actor: { userEmail: 'nurse@example.test' },
    config, integration, contract: rosterContract(),
  })],
  ['notifyTimeOffReviewed', (config, integration) => notifyTimeOffReviewed({
    request: reviewed(), config, integration, contract: rosterContract(),
  })],
  ['notifyCredentialReviewed', (config, integration) => notifyCredentialReviewed({
    credential: credential(), actor: { userEmail: 'admin@example.test' }, config, integration,
  })],
  ['notifyCredentialRenewal', (config, integration) => notifyCredentialRenewal({
    credential: credential(), params: renewalParams(),
    config, integration, contract: rosterContract(),
  })],
  ['notifyTimeOffCancelled', (config, integration) => notifyTimeOffCancelled({
    request: cancelled(), previousStatus: 'approved',
    actor: { userEmail: 'someone.else@example.test' },
    config, integration, contract: rosterContract(),
  })],
];

/** Counts and RESOLVES: a throwing fake is swallowed by each sender's `catch {}`. */
const countingIntegration = calls => async (operation, payload) => {
  calls.push({ operation, payload });
  return { ok: true };
};

test('NONE of the five reaches a provider while the notices switch is not released', async () => {
  for (const [label, value] of NOT_THE_RELEASE_WORD) {
    const config = loadConfig(env(releasedEnv(value)));
    for (const [name, drive] of FIVE_SENDERS) {
      const calls = [];
      const answer = await drive(config, countingIntegration(calls));
      assert.deepEqual(calls, [], `${name} reached a provider with the switch ${label}`);
      assert.equal(answer.email, false, `${name} claimed a send with the switch ${label}`);
    }
  }
});

test('and the same five DO send once both switches are the release word', async () => {
  // The control for the test above. Without it, a fixture that silently lost
  // its recipient would make every case there pass with the gate deleted —
  // which is this project's own recurring defect, not a hypothetical one.
  const config = loadConfig(env(releasedEnv()));
  for (const [name, drive] of FIVE_SENDERS) {
    const calls = [];
    const answer = await drive(config, countingIntegration(calls));
    assert.ok(calls.length > 0, `${name} sent nothing on a fully released deployment`);
    assert.ok(calls.every(call => call.operation === 'SendEmail'),
      `${name} asked for something other than SendEmail`);
    assert.equal(answer.email, true, `${name} did not report the send`);
    assert.equal(answer.delivery_paused, false, `${name} claimed a paused channel`);
  }
});

/**
 * A roster that never ends: every page answers a NEW cursor, so the walk runs
 * out of pages rather than out of entries. One administrator per page, which is
 * what makes the clipped set observable — `PAGE_BUDGET` pages of one.
 */
const endlessRoster = () => {
  let page = 0;
  return async name => {
    if (name !== 'listAgencyRoster') return {};
    page += 1;
    return {
      entries: [{ tenant_role: 'agency_admin', is_active: true, email: `admin${page}@example.test` }],
      next: `cursor-${page}`,
    };
  };
};

/** One page holding more administrators than the original's own ceiling. */
const crowdedRoster = () => async name => (name === 'listAgencyRoster'
  ? {
    entries: Array.from({ length: APPROVER_LIMIT + 1 }, (unused, index) => ({
      tenant_role: 'agency_admin', is_active: true, email: `admin${index}@example.test`,
    })),
    next: null,
  }
  : {});

test('a clipped fan-out SAYS it was clipped, and says which bound clipped it', async () => {
  // The defect this closes: both bounds under-sent and reported nothing, so a
  // renewal notice reaching three of five administrators was indistinguishable
  // from one reaching all five. Neither bound may refuse — the credential is
  // already recorded — so saying why the walk stopped is the only honest
  // option, and the two reasons are kept apart because one is the original's
  // stated rule and the other is this service's incapacity.
  const whole = await agencyAdminRecipients(rosterContract(), null);
  assert.deepEqual(whole, { recipients: ['admin@example.test'], truncated: null });

  const pages = await agencyAdminRecipients(endlessRoster(), null);
  assert.equal(pages.truncated, 'page_budget');
  assert.equal(pages.recipients.length, PAGE_BUDGET,
    'the walk should have read one administrator per page until the budget ran out');

  const crowd = await agencyAdminRecipients(crowdedRoster(), null);
  assert.equal(crowd.truncated, 'approver_limit');
  assert.equal(crowd.recipients.length, APPROVER_LIMIT,
    'the ceiling is the stated one and the set stops exactly there');
});

test('and the senders carry that answer out to their caller', async () => {
  const config = loadConfig(env(releasedEnv()));
  const integration = async () => ({ ok: true });

  // The renewal walks whenever it is eligible, so both bounds reach its answer.
  const clipped = await notifyCredentialRenewal({
    credential: credential(), params: renewalParams(),
    config, integration, contract: endlessRoster(),
  });
  assert.equal(clipped.recipients_truncated, 'page_budget');

  const capped = await notifyCredentialRenewal({
    credential: credential(), params: renewalParams(),
    config, integration, contract: crowdedRoster(),
  });
  assert.equal(capped.recipients_truncated, 'approver_limit');

  // A first submission is not eligible, so no walk happens and the set is whole
  // by virtue of there being nothing to look for. `null` and not `undefined`:
  // an absent key would read as a question nobody asked rather than as an
  // answer, which is the distinction this field exists to make.
  const notARenewal = await notifyCredentialRenewal({
    credential: credential(), params: { credential_id: 'cred-1', renews_credential_id: '' },
    config, integration, contract: endlessRoster(),
  });
  assert.equal(notARenewal.recipients_truncated, null);

  // The submit fan-out walks ONLY when the row named no approver, so the row's
  // own manager is a whole set without a page being read.
  const named = await notifyTimeOffSubmitted({
    request: request(), actor: { userEmail: 'nurse@example.test' },
    config, integration, contract: endlessRoster(),
  });
  assert.equal(named.recipients_truncated, null);

  const fellBack = await notifyTimeOffSubmitted({
    request: { ...request(), manager_email: '' },
    actor: { userEmail: 'nurse@example.test' },
    config, integration, contract: endlessRoster(),
  });
  assert.equal(fellBack.recipients_truncated, 'page_budget');
});

/**
 * The INVARIANT behind the D98 reading, pinned so a sixth sender cannot lose it.
 *
 * D98 exists because `sendAccountReadyEmail` is HANDED its recipient:
 * `params.email` is a caller parameter, so the roster walk in
 * `account-email.mjs` is the only thing between an agency administrator and any
 * address on the internet, and it refuses `RECIPIENT_NOT_IN_AGENCY`.
 *
 * None of the five here goes through that walk, and none needs to, because none
 * is handed an address. Three read a column a contract wrote — `manager_email`
 * resolved through `pennsync_private.agency_colleague` and stored as the
 * identity map's own `expected_email`, `employee_email` and
 * `personnel_credential.user_id` both written as `caller_email()` — and two ask
 * the roster. So the guarantee D98 establishes at SEND time in the service is
 * established here at WRITE time in SQL.
 *
 * That is a STRUCTURAL guarantee, which is exactly the kind that breaks in
 * silence: a sixth sender reading `params.email` would reintroduce the hole
 * with every existing test still green. The rule is therefore the thing
 * asserted — a sender that is GIVEN a recipient must go through
 * `agencyRecipient`; a sender that READS one a contract wrote need not, so long
 * as nothing rewrites that column afterwards.
 */
const SENDER_SOURCE = readFileSync(new URL('./workforce-email.mjs', import.meta.url), 'utf8');

test('no sender reads any caller-supplied parameter except the renewal condition', () => {
  // The whole module, deliberately: the point is that a NEW sender cannot
  // quietly start reading `params`, so scoping this to the five that exist
  // today would exempt the case it is written for.
  const read = new Set(
    [...SENDER_SOURCE.matchAll(/\bparams\s*\??\.\s*([A-Za-z_$][\w$]*)/g)].map(hit => hit[1]));
  // `renews_credential_id` against `credential_id` is the original's own
  // eligibility test and names no recipient. Nothing else may be read, and in
  // particular nothing that could BE an address.
  assert.deepEqual([...read].sort(), ['credential_id', 'renews_credential_id']);
});

test('and the handler wiring hands `params` to exactly one of the five', () => {
  // The other half of the same invariant: a sender cannot read what it is never
  // given, so the call sites are where a future change would have to widen the
  // reach first. Read from `handlers.mjs` rather than asserted about it.
  const handlers = readFileSync(new URL('./handlers.mjs', import.meta.url), 'utf8');
  const given = [];
  for (const name of [
    'notifyTimeOffSubmitted', 'notifyTimeOffReviewed', 'notifyCredentialReviewed',
    'notifyCredentialRenewal', 'notifyTimeOffCancelled',
  ]) {
    // The call's own argument object, up to the closing brace of the `await`.
    const call = handlers.match(new RegExp(`${name}\\(\\{([^}]*)\\}`));
    assert.ok(call, `${name} is not called in handlers.mjs at all`);
    if (/\bparams\b/.test(call[1])) given.push(name);
  }
  assert.deepEqual(given, ['notifyCredentialRenewal']);
});

test('a hostile address in the request reaches no provider', async () => {
  // The behavioural half. Every sender is driven on a fully released
  // deployment, with an attacker-controlled address planted in every field a
  // caller could plausibly reach — including the keys `account-email.mjs`
  // legitimately reads — and the assertion is that the provider never sees it.
  const HOSTILE = 'attacker@evil.test';
  const planted = row => ({
    ...row,
    email: HOSTILE, to: HOSTILE, recipient: HOSTILE, recipient_email: HOSTILE,
    user_email: HOSTILE, notify_email: HOSTILE, full_name: HOSTILE,
  });
  const hostileParams = {
    credential_id: 'cred-1', renews_credential_id: 'cred-0',
    email: HOSTILE, to: HOSTILE, recipient: HOSTILE, manager_email: HOSTILE,
    employee_email: HOSTILE, user_id: HOSTILE,
  };
  const config = loadConfig(env(releasedEnv()));
  const drives = [
    ['notifyTimeOffSubmitted', integration => notifyTimeOffSubmitted({
      request: planted(request()), params: hostileParams,
      actor: { userEmail: 'nurse@example.test' },
      config, integration, contract: rosterContract(),
    })],
    ['notifyTimeOffReviewed', integration => notifyTimeOffReviewed({
      request: planted(reviewed()), params: hostileParams,
      config, integration, contract: rosterContract(),
    })],
    ['notifyCredentialReviewed', integration => notifyCredentialReviewed({
      credential: planted(credential()), params: hostileParams,
      actor: { userEmail: 'admin@example.test' }, config, integration,
    })],
    ['notifyCredentialRenewal', integration => notifyCredentialRenewal({
      credential: planted(credential()), params: hostileParams,
      config, integration, contract: rosterContract(),
    })],
    ['notifyTimeOffCancelled', integration => notifyTimeOffCancelled({
      request: planted(cancelled()), params: hostileParams, previousStatus: 'approved',
      actor: { userEmail: 'someone.else@example.test' },
      config, integration, contract: rosterContract(),
    })],
  ];
  for (const [name, drive] of drives) {
    const calls = [];
    await drive(countingIntegration(calls));
    // A send must have happened, or the assertion below holds vacuously —
    // the same control the released-path test carries.
    assert.ok(calls.length > 0, `${name} sent nothing, so this proves nothing`);
    for (const call of calls) {
      assert.notEqual(call.payload.to, HOSTILE,
        `${name} sent a notice to an address its caller supplied`);
    }
    // And the body must not carry it either: a recipient is not the only way an
    // address leaks, and `full_name` is interpolated into one of these documents.
    for (const call of calls) {
      assert.ok(!String(call.payload.body ?? '').includes(HOSTILE),
        `${name} put a caller-supplied address in the message body`);
    }
  }
});
