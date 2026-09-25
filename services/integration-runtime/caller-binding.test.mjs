import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BROWSER_CONTRACT, bindingFromContext, requireExpectedCaller, validateCallerBinding } from './caller-binding.mjs';
import { createHandler } from './app.mjs';
import { authorize, loadConfig, publicReadiness } from './runtime.mjs';
import { fail } from './safety.mjs';

// Only invented identities and injected stores/providers. No real network, data or billing.
const revision = 'a'.repeat(40);
const member = () => ({ user_id: 'user-a', agency_id: 'agency-a', membership_id: 'member-a',
  membership_version: 1, tenant_role: 'clinician', is_platform_owner: false });
const owner = () => ({ user_id: 'owner-a', agency_id: null, membership_id: null,
  membership_version: null, tenant_role: 'platform_owner', is_platform_owner: true });
const fullContext = binding => ({ ...binding, user_email: 'synthetic@example.test',
  agency: binding.agency_id ? { id: binding.agency_id, status: 'active' } : null,
  membership_key: binding.is_platform_owner ? null : `${binding.agency_id}:${binding.user_id}`,
  membership_status: binding.is_platform_owner ? null : 'active' });
const cfg = (patch = {}) => ({ ...loadConfig({
  SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  INTEGRATIONS_ENCRYPTION_KEY: '1'.repeat(64), INTEGRATIONS_HASH_KEY: '2'.repeat(64),
  INTEGRATIONS_RELEASE: 'enabled-v1', INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM,SendEmail',
  // SendEmail stays on the SERVICE list and off the browser one: a browser
  // send is refused outright (BROWSER_FORBIDDEN_OPERATIONS), so a fixture
  // naming it here would no longer load.
  INTEGRATIONS_BROWSER_RELEASE: 'enabled-v2', INTEGRATIONS_BROWSER_OPERATIONS: 'InvokeLLM',
  ANTHROPIC_API_KEY: 'synthetic-only', SENDGRID_API_KEY: 'synthetic-only', NOTIFICATION_FROM_EMAIL: 'synthetic@example.test',
  RAILWAY_GIT_COMMIT_SHA: revision,
}), ...patch });
const input = (binding = member()) => ({ contract: BROWSER_CONTRACT, revision, binding, agency_id: binding.agency_id,
  request_id: '11111111-1111-4111-8111-111111111111', operation: 'InvokeLLM', params: { prompt: 'invented acceptance input' } });
const req = (value, path = '/v2/integrations') => new Request(`https://runtime.example.test${path}`, {
  method: 'POST', headers: { authorization: 'Bearer synthetic-session-token-value', 'content-type': 'application/json' }, body: JSON.stringify(value),
});
function harness({ live = member(), driftAt = Infinity, denyAt = Infinity, drift = { membership_version: 2 }, providerFailure = false, config = cfg(), sharedRows = new Map() } = {}) {
  let reads = 0, calls = 0, reservations = 0; const rows = sharedRows;
  const authority = async () => {
    reads++;
    if (reads >= denyAt) fail(403, 'AUTHENTICATION_REJECTED');
    const binding = reads >= driftAt ? { ...live, ...drift } : live;
    return { subject: 'b'.repeat(64), snapshot: JSON.stringify(binding), binding,
      canEmail: binding.is_platform_owner || ['agency_admin', 'manager'].includes(binding.tenant_role) };
  };
  const store = {
    async reserve(body) {
      reservations++;
      const key = `${body.p_subject}:${body.p_operation}:${body.p_request_id}`;
      const old = rows.get(key);
      if (old) return { id: old.id, outcome: old.hash === body.p_payload_hash ? old.state : 'conflict', result: old.result };
      const row = { id: randomUUID(), claim: body.p_claim, hash: body.p_payload_hash, state: 'pending', result: null };
      rows.set(key, row); return { id: row.id, outcome: 'owned' };
    },
    async finish(body) {
      const row = [...rows.values()].find(value => value.id === body.p_id);
      if (!row || row.claim !== body.p_claim || row.state !== 'pending') return false;
      row.state = body.p_state; row.result = body.p_result; return true;
    },
  };
  const provider = async () => { calls++; if (providerFailure) throw new Error('synthetic secret provider text'); return 'invented answer'; };
  return { handler: createHandler(config, { authority, store, provider }), rows,
    counts: () => ({ reads, calls, reservations }) };
}

test('binding is a frozen exact expectation and never accepts an extra permission grant', () => {
  assert.deepEqual(validateCallerBinding(member()), member()); assert.ok(Object.isFrozen(validateCallerBinding(owner())));
  assert.deepEqual(bindingFromContext(fullContext(member())), member());
  assert.deepEqual(requireExpectedCaller(member(), member()), member());
  assert.throws(() => validateCallerBinding({ ...member(), canEmail: true }));
  assert.throws(() => requireExpectedCaller(null, member()), e => e.status === 403 && e.code === 'CALLER_BINDING_UNAVAILABLE');
});
for (const [name, patch] of Object.entries({ zeroVersion: { membership_version: 0 }, stringVersion: { membership_version: '1' },
  fractionalVersion: { membership_version: 1.5 }, arrayId: { user_id: ['user-a'] }, forgedRole: { tenant_role: 'super_admin' },
  stringOwner: { is_platform_owner: 'true' }, nullAgency: { agency_id: null }, missingMember: { membership_id: null } })) {
  test(`invalid ${name} cannot become a caller binding`, () => assert.throws(() => validateCallerBinding({ ...member(), ...patch })));
}
for (const patch of [{ agency_id: 'agency-a' }, { membership_id: 'member-a' }, { membership_version: 1 }, { tenant_role: 'agency_admin' }]) {
  test(`global owner refuses inconsistent ${Object.keys(patch)[0]}`, () => assert.throws(() => validateCallerBinding({ ...owner(), ...patch })));
}
test('v2 validates independent live authority and echoes the exact operation, request and revision', async () => {
  const h = harness(); const body = input(); const response = await h.handler(req(body)); const value = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(value, { success: true, result: 'invented answer', execution: 'external', base44ExecutionDependency: true,
    contract: BROWSER_CONTRACT, app_id: cfg().appId, revision, request_id: body.request_id, operation: body.operation });
  assert.deepEqual(h.counts(), { reads: 3, calls: 1, reservations: 1 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});
for (const field of ['user_id', 'agency_id', 'membership_id', 'membership_version', 'tenant_role', 'is_platform_owner']) {
  test(`different live ${field} never receives a reservation or provider result`, async () => {
    const drift = { [field]: field === 'membership_version' ? 2 : field === 'is_platform_owner' ? true : `${member()[field]}-different` };
    const h = harness({ driftAt: 1, drift }); const result = await h.handler(req(input()));
    assert.equal(result.status, 403); assert.equal((await result.json()).success, false);
    assert.deepEqual(h.counts(), { reads: 1, calls: 0, reservations: 0 });
  });
}
for (const driftAt of [2, 3]) {
  test(`authority drift at phase ${driftAt} cannot authorize disclosure or extra work`, async () => {
    const h = harness({ driftAt }); const result = await h.handler(req(input()));
    assert.equal(result.status, 403); assert.equal((await result.json()).error, 'CALLER_BINDING_CHANGED');
    assert.equal(h.counts().calls, driftAt === 2 ? 0 : 1);
    assert.equal([...h.rows.values()][0].state, driftAt === 2 ? 'failed' : 'completed');
    const replay = await h.handler(req(input())); assert.equal(replay.status, 403);
    assert.equal(h.counts().calls, driftAt === 2 ? 0 : 1);
  });
}
test('completed v2 request is replayed once only under freshly matching current authority', async () => {
  const h = harness(); const first = await h.handler(req(input())); const second = await h.handler(req(input()));
  assert.equal(first.status, 200); assert.equal(second.status, 200); assert.deepEqual(await first.json(), await second.json());
  assert.deepEqual(h.counts(), { reads: 5, calls: 1, reservations: 2 });
});
test('provider uncertainty is redacted, durable and cannot be billed again using the same request', async () => {
  const h = harness({ providerFailure: true }); const first = await h.handler(req(input())); const value = await first.json();
  assert.equal(first.status, 503); assert.equal(value.retryable, false); assert.equal(JSON.stringify(value).includes('secret'), false);
  const second = await h.handler(req(input())); assert.equal(second.status, 409); assert.equal(h.counts().calls, 1);
});
for (const patch of [{ revision: 'b'.repeat(40) }, { revision: null }, { contract: 'cm.integrations.v1' },
  { agency_id: 'foreign' }, { binding: undefined }, { backend: 'https://foreign.example.test' }, { request_id: ['forged'] }, { request_id: 'not-a-uuid' }]) {
  test(`malformed or stale browser envelope ${Object.keys(patch)[0]} is rejected before provider work`, async () => {
    const h = harness(); const response = await h.handler(req({ ...input(), ...patch }));
    assert.ok([400, 409].includes(response.status)); assert.equal(h.counts().calls, 0); assert.equal(h.counts().reservations, 0);
  });
}
test('paused or unbound deployment stops before auth, body decoding or provider access', async () => {
  for (const config of [cfg({ released: false }), cfg({ configured: false }), cfg({ revision: 'unbound' })]) {
    const h = harness({ config });
    const request = new Request('https://runtime.example.test/v2/integrations', { method: 'POST', body: '{malformed' });
    const response = await h.handler(request); assert.equal(response.status, 503);
    assert.deepEqual(h.counts(), { reads: 0, calls: 0, reservations: 0 });
  }
});
test('v1 response contract is preserved without accepting v2 caller expectations', async () => {
  const h = harness(); const value = input(); delete value.contract; delete value.binding; delete value.revision;
  const response = await h.handler(req(value, '/v1/integrations')); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, result: 'invented answer', execution: 'external', base44ExecutionDependency: true });
  assert.equal((await h.handler(req(input(), '/v1/integrations'))).status, 400);
});
test('a claimed platform owner is not accepted as a substitute for a current member identity', async () => {
  const h = harness(); const response = await h.handler(req(input(owner()))); assert.equal(response.status, 403);
  assert.equal(h.counts().calls, 0); assert.equal(h.counts().reservations, 0);
});
test('global owner no-agency request is independently authorized by the fixed protected broker', async () => {
  let seen;
  const actor = await authorize(cfg(), req(input(owner())), null, async (url, options) => {
    seen = { url, options }; return Response.json({ tenant_context: fullContext(owner()) });
  });
  assert.deepEqual(actor.binding, owner()); assert.equal(actor.canEmail, true);
  assert.equal(seen.url, `https://base44.app/api/apps/${cfg().appId}/functions/getMyTenantContext`);
  assert.deepEqual(JSON.parse(seen.options.body), {}); assert.equal(seen.options.redirect, 'error');
  assert.deepEqual(Object.keys(seen.options.headers).sort(), ['Authorization', 'Content-Type', 'X-App-Id']);
});
for (const patch of [{ is_platform_owner: false }, { membership_status: 'active' }, { membership_key: 'forged' },
  { agency: { id: 'foreign', status: 'active' } }, { user_id: ['owner-a'] }, { user_email: 'MixedCase@example.test' }]) {
  test(`global owner live ${Object.keys(patch)[0]} inconsistency is denied`, async () => {
    await assert.rejects(() => authorize(cfg(), req(input(owner())), null, async () => Response.json({ tenant_context: { ...fullContext(owner()), ...patch } })), e => e.status === 403);
  });
}
test('missing or foreign agency and a null-scoped ordinary member cannot gain global authority', async () => {
  for (const agency of [undefined, ['agency-a'], {}, 'foreign', null]) {
    await assert.rejects(() => authorize(cfg(), req(input()), agency, async () => Response.json({ tenant_context: fullContext(member()) })), e => [400, 403].includes(e.status));
  }
});
test('scoped v1 owner preserves legacy behavior but has no forged browser-wide binding', async () => {
  const scoped = { ...fullContext(owner()), agency_id: 'agency-a', agency: { id: 'agency-a', status: 'active' } };
  const actor = await authorize(cfg(), req(input()), 'agency-a', async () => Response.json({ tenant_context: scoped }));
  assert.equal(actor.canEmail, true); assert.equal(actor.binding, null);
});
test('readiness explicitly discloses the remaining Base44 execution and absent cutover evidence', () => {
  const readiness = publicReadiness(cfg()); assert.equal(readiness.base44ExecutionDependency, true);
  assert.equal(readiness.trafficCutoverVerified, false); assert.equal(readiness.browserContract, BROWSER_CONTRACT);
  assert.equal(readiness.browserRevisionBound, true);
});


for (const patch of [{ browserReleased: false }, { browserReleased: undefined }, { browserOperations: [] }, { browserOperations: undefined }]) {
  test(`v1-only release does not expose v2 when ${Object.keys(patch)[0]} is absent`, async () => {
    const h = harness({ config: cfg(patch) });
    const response = await h.handler(req(input()));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'BROWSER_INTEGRATIONS_NOT_RELEASED');
    assert.deepEqual(h.counts(), { reads: 0, calls: 0, reservations: 0 });
    const legacy = input(); delete legacy.contract; delete legacy.binding; delete legacy.revision;
    assert.equal((await h.handler(req(legacy, '/v1/integrations'))).status, 200);
  });
}
test('v2 cannot execute a legacy-approved operation absent from the browser allowlist', async () => {
  const h = harness({ config: cfg({ browserOperations: ['SendEmail'] }) });
  const response = await h.handler(req(input())); assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'BROWSER_OPERATION_NOT_RELEASED');
  assert.deepEqual(h.counts(), { reads: 0, calls: 0, reservations: 0 });
});
test('browser operations are explicit, duplicate-free subsets of the general operation list', () => {
  // Deliberately NOT `SendEmail`: it is refused by its own rule below, so using
  // it here would let this subset test pass for the wrong reason — which is
  // exactly what happened while `SendEmail` was off the service list, where a
  // reader took this line as proof that mail could never be a browser operation.
  for (const selected of ['InvokeLLM,InvokeLLM', 'GenerateImage', 'UploadFile']) {
    assert.throws(() => loadConfig({ INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM', INTEGRATIONS_BROWSER_OPERATIONS: selected }));
  }
  const plain = loadConfig({ INTEGRATIONS_RELEASE: 'enabled-v1', INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM' });
  assert.equal(plain.browserReleased, false); assert.deepEqual(plain.browserOperations, []);
  assert.equal(publicReadiness(plain).browserReady, false);
});
for (const agency_id of [null, undefined, [], {}]) {
  test(`v1 rejects global/malformed agency ${JSON.stringify(agency_id)} even for a live owner`, async () => {
    const h = harness({ live: owner() });
    const value = input(owner()); delete value.contract; delete value.binding; delete value.revision; value.agency_id = agency_id;
    const response = await h.handler(req(value, '/v1/integrations')); assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'AGENCY_REQUIRED'); assert.deepEqual(h.counts(), { reads: 0, calls: 0, reservations: 0 });
  });
}
for (const patch of [{ membership_version: 2 }, { tenant_role: 'manager' }, { membership_id: 'replacement-member' }]) {
  test(`receipt cannot be rebranded after current ${Object.keys(patch)[0]} changes`, async () => {
    const rows = new Map(); const first = harness({ sharedRows: rows });
    assert.equal((await first.handler(req(input()))).status, 200);
    const current = { ...member(), ...patch }; const next = harness({ sharedRows: rows, live: current });
    const response = await next.handler(req(input(current))); assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'OPERATION_RECONCILIATION_REQUIRED');
    assert.equal(next.counts().calls, 0); assert.equal(rows.size, 1);
  });
}
test('receipt from a previous deployed revision conflicts rather than being labeled current', async () => {
  const rows = new Map(); const first = harness({ sharedRows: rows });
  assert.equal((await first.handler(req(input()))).status, 200);
  const next = harness({ sharedRows: rows, config: cfg({ revision: 'b'.repeat(40) }) });
  const response = await next.handler(req({ ...input(), revision: 'b'.repeat(40) })); assert.equal(response.status, 409);
  assert.equal(next.counts().calls, 0); assert.equal(rows.size, 1);
});
test('v1 and v2 receipts with the same request UUID cannot be confused', async () => {
  for (const legacyFirst of [false, true]) {
    const rows = new Map(); const h = harness({ sharedRows: rows });
    const legacy = input(); delete legacy.contract; delete legacy.binding; delete legacy.revision;
    const requests = legacyFirst ? [req(legacy, '/v1/integrations'), req(input())] : [req(input()), req(legacy, '/v1/integrations')];
    assert.equal((await h.handler(requests[0])).status, 200);
    assert.equal((await h.handler(requests[1])).status, 409); assert.equal(h.counts().calls, 1); assert.equal(rows.size, 1);
  }
});

// An outbound send is refused to the browser route by a rule of its own, not by
// the subset ceiling. While `SendEmail` was off `INTEGRATIONS_ALLOWED_OPERATIONS`
// the ceiling refused it for free; putting it on the service list to release the
// account emails turned that structural refusal into two settings being unset.
// A browser send would also reach the provider WITHOUT the recipient binding the
// business API applies, so it is refused here rather than configured away.
const forbiddenEnv = (patch = {}) => ({
  SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
  INTEGRATIONS_ENCRYPTION_KEY: '1'.repeat(64), INTEGRATIONS_HASH_KEY: '2'.repeat(64),
  INTEGRATIONS_RELEASE: 'enabled-v1', INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM,SendEmail',
  INTEGRATIONS_BROWSER_RELEASE: 'enabled-v2', INTEGRATIONS_BROWSER_OPERATIONS: 'InvokeLLM',
  ANTHROPIC_API_KEY: 'synthetic-only', SENDGRID_API_KEY: 'synthetic-only',
  NOTIFICATION_FROM_EMAIL: 'synthetic@example.test', RAILWAY_GIT_COMMIT_SHA: revision, ...patch });

test('a released service operation can still be forbidden to the browser, and SendEmail is', () => {
  // The service list carries SendEmail, so the subset ceiling admits it: any
  // refusal here is the forbidden rule and nothing else.
  assert.throws(() => loadConfig(forbiddenEnv({ INTEGRATIONS_BROWSER_OPERATIONS: 'InvokeLLM,SendEmail' })),
    error => error.message === 'BROWSER_FORBIDDEN_OPERATION');
  assert.throws(() => loadConfig(forbiddenEnv({ INTEGRATIONS_BROWSER_OPERATIONS: 'SendEmail' })),
    error => error.message === 'BROWSER_FORBIDDEN_OPERATION');
  // The contrast: another operation on both lists is not refused, so the rule is
  // about this operation rather than about a browser list having two names.
  const fine = loadConfig(forbiddenEnv({ INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM,UploadFile',
    INTEGRATIONS_BROWSER_OPERATIONS: 'InvokeLLM,UploadFile' }));
  assert.deepEqual(fine.browserOperations, ['InvokeLLM', 'UploadFile']);
  // And the released service side is untouched: mail still serves /v1.
  assert.deepEqual(loadConfig(forbiddenEnv()).operations, ['InvokeLLM', 'SendEmail']);
});

const mailParams = { to: 'recipient@example.test', subject: 'Synthetic', body: 'Synthetic test' };
const mailInput = (binding = member()) => ({ ...input(binding), operation: 'SendEmail', params: mailParams });

test('a browser SendEmail is refused at dispatch even if a config was built without loadConfig', async () => {
  // loadConfig can no longer produce this config, so the request-level check is
  // what makes the refusal a property of the REQUEST rather than of the
  // environment. A hand-built config is the only way to reach it.
  const h = harness({ live: { ...member(), tenant_role: 'agency_admin' },
    config: cfg({ operations: ['InvokeLLM', 'SendEmail'], browserOperations: ['InvokeLLM', 'SendEmail'] }) });
  const response = await h.handler(req(mailInput({ ...member(), tenant_role: 'agency_admin' })));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'BROWSER_FORBIDDEN_OPERATION');
  assert.deepEqual(h.counts(), { reads: 0, calls: 0, reservations: 0 });
});

test('the same SendEmail request still serves on the legacy server route', async () => {
  // The exclusion must not have switched off the mail release it was written
  // beside: a refusal on both routes would pass the test above for free.
  const h = harness({ live: { ...member(), tenant_role: 'agency_admin' },
    config: cfg({ operations: ['InvokeLLM', 'SendEmail'], browserOperations: ['InvokeLLM'] }) });
  const legacy = mailInput({ ...member(), tenant_role: 'agency_admin' });
  delete legacy.contract; delete legacy.binding; delete legacy.revision;
  const response = await h.handler(req(legacy, '/v1/integrations'));
  assert.equal(response.status, 200);
  assert.equal(h.counts().calls, 1);
});
