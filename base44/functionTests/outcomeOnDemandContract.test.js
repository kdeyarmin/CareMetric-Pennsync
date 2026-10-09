import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// computeOutcomeMeasures — the on-demand outcome door released by the owner
// on 2026-10-08. It must authenticate before the body, admit only the
// built-in administrator or an active agency_admin/manager membership in the
// NAMED agency (never a profile field), and only then sign a one-agency
// capability for the secret-only worker.

const SOURCE_URL = new URL('../functions/computeOutcomeMeasures/entry.ts', import.meta.url);
const SECRET = 'scheduler-secret';
const AT = '2026-09-01T12:00:00.000Z';

function membership(userId, email, agencyId, tenantRole, status = 'active') {
  return {
    id: `membership-${userId}-${agencyId}`,
    membership_key: `${agencyId}:${userId}`,
    agency_id: agencyId,
    user_id: userId,
    user_email_normalized: email,
    tenant_role: tenantRole,
    status,
    version: 1,
    created_by_user_id: 'user-owner',
    last_transition_by_user_id: 'user-owner',
    last_transition_by_email_normalized: 'owner@example.com',
    last_transition_at: AT,
    last_transition_reason: 'Synthetic membership',
    activated_at: AT,
    revoked_at: null,
    revocation_reason: null,
  };
}

const manager = { id: 'user-manager', email: 'manager@example.com', role: 'user', is_active: true };
const clinician = { id: 'user-clinician', email: 'clinician@example.com', role: 'user', is_active: true };

async function loadHandler({
  user = manager,
  memberships = [membership(manager.id, manager.email, 'agency-1', 'manager')],
  agencies = [{ id: 'agency-1', status: 'active' }],
  secret = SECRET,
  invokeOutcome,
} = {}) {
  let source = await readFile(SOURCE_URL, 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__outcomeOnDemandClient;',
  );
  const temporary = join(tmpdir(), `outcome_on_demand_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporary, transpileTs(source).outputText);
  const calls = { membershipReads: 0, agencyReads: 0, invocations: [] };
  let handler;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (key) => (key === 'INTERNAL_FN_SECRET' ? secret : undefined) },
  };
  globalThis.__outcomeOnDemandClient = () => ({
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        AgencyMembership: {
          filter: async (query) => {
            calls.membershipReads += 1;
            return memberships.filter((row) => row.user_id === query.user_id);
          },
        },
        Agency: {
          filter: async (query) => {
            calls.agencyReads += 1;
            return agencies.filter((row) => row.id === query.id);
          },
        },
      },
      functions: {
        invoke: async (name, payload) => {
          calls.invocations.push({ name, payload: structuredClone(payload) });
          if (invokeOutcome) return invokeOutcome(name, payload);
          return {
            data: {
              success: true,
              agency_id: payload.agency_id,
              period_type: payload.period_type,
              period_start: payload.period_start,
              period_end: payload.period_end,
              idempotent_replay: false,
              outcome_computation_run_id: 'run-1',
              outcome_computation_attempt_id: 'attempt-1',
              publication_status: 'published',
              publication_mode: 'single_run_record_gate_v1',
              internal_detail: 'must not be returned',
            },
          };
        },
      },
    },
  });
  try {
    await import(`${pathToFileURL(temporary).href}?v=${Math.random()}`);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { handler, calls };
}

function post(body) {
  return new Request('http://local/computeOutcomeMeasures', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const window = {
  agency_id: 'agency-1',
  period_type: 'custom',
  period_start: '2026-07-01',
  period_end: '2026-09-30',
};

function expectedSignature(payload) {
  const proof = payload.dispatch_proof;
  return createHmac('sha256', SECRET).update(JSON.stringify([
    proof.version, payload.agency_id, payload.period_type, payload.period_start,
    payload.period_end, payload.benchmark ?? null, payload.idempotency_key,
    proof.issued_at, proof.nonce,
  ])).digest('hex');
}

test('an anonymous caller is refused before the body is read or anything is signed', async () => {
  const { handler, calls } = await loadHandler({ user: null });
  let bodyReads = 0;
  const request = post(window);
  const text = request.text.bind(request);
  request.text = async () => { bodyReads += 1; return text(); };
  const response = await handler(request);
  assert.equal(response.status, 401);
  assert.equal(bodyReads, 0);
  assert.equal(calls.membershipReads, 0);
  assert.deepEqual(calls.invocations, []);
});

test('a manager of the named agency gets one signed, one-agency worker request', async () => {
  const { handler, calls } = await loadHandler();
  const response = await handler(post(window));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(body.internal_detail, undefined, 'only the reviewed result fields are returned');
  assert.equal(calls.invocations.length, 1);
  const [{ name, payload }] = calls.invocations;
  assert.equal(name, 'computeOutcomeMeasuresV2');
  assert.deepEqual(Object.keys(payload).sort(), [
    'agency_id', 'dispatch_proof', 'idempotency_key', 'period_end', 'period_start', 'period_type',
  ]);
  assert.equal(payload.agency_id, 'agency-1');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(payload.idempotency_key, `on-demand-outcome:${today}:custom:2026-07-01:2026-09-30`);
  assert.match(payload.idempotency_key, /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/);
  assert.equal(payload.dispatch_proof.signature, expectedSignature(payload));
});

test('profile claims never authorize: a clinician, another agency, and a forged account_type are refused', async () => {
  for (const [label, options, status] of [
    ['clinician', {
      user: clinician,
      memberships: [membership(clinician.id, clinician.email, 'agency-1', 'clinician')],
    }, 403],
    ['manager elsewhere', {
      memberships: [membership(manager.id, manager.email, 'agency-2', 'manager')],
    }, 403],
    ['suspended manager', {
      memberships: [membership(manager.id, manager.email, 'agency-1', 'manager', 'suspended')],
    }, 403],
    ['forged profile', {
      user: { ...clinician, account_type: 'agency_admin', agency_id: 'agency-1', is_manager: true },
      memberships: [membership(clinician.id, clinician.email, 'agency-1', 'clinician')],
    }, 403],
    ['no membership', { memberships: [] }, 403],
    ['inactive agency', { agencies: [{ id: 'agency-1', status: 'suspended' }] }, 403],
  ]) {
    const { handler, calls } = await loadHandler(options);
    const response = await handler(post(window));
    assert.equal(response.status, status, label);
    assert.deepEqual(calls.invocations, [], `${label}: nothing signed or invoked`);
  }
});

test('the built-in administrator may compute for a named active agency', async () => {
  const { handler, calls } = await loadHandler({
    user: { id: 'user-admin', email: 'admin@example.com', role: 'admin', is_active: true },
    memberships: [],
  });
  const response = await handler(post(window));
  assert.equal(response.status, 200);
  assert.equal(calls.invocations.length, 1);
});

test('the window is validated before any membership lookup', async () => {
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  for (const body of [
    { ...window, period_end: future },
    { ...window, period_start: '2024-01-01' },
    { ...window, period_start: '2026-10-01', period_end: '2026-09-01' },
    { ...window, period_type: 'decade' },
    { ...window, benchmark: 80 },
    { ...window, agency_id: '$ne' },
  ]) {
    const { handler, calls } = await loadHandler();
    const response = await handler(post(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(calls.membershipReads, 0);
    assert.deepEqual(calls.invocations, []);
  }
});

test("the worker's refusal is passed through with its status, and a mismatched result is not reported as success", async () => {
  let fixture = await loadHandler({
    invokeOutcome: async () => {
      const error = new Error('Conflict');
      error.status = 409;
      error.data = { success: false, error: 'An outcome computation owns this window', retry_with_same_key: true };
      throw error;
    },
  });
  let response = await fixture.handler(post(window));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    success: false, error: 'An outcome computation owns this window', retry: true,
  });

  fixture = await loadHandler({
    invokeOutcome: async (_name, payload) => ({ data: { success: true, agency_id: 'agency-2', period_start: payload.period_start, period_end: payload.period_end } }),
  });
  response = await fixture.handler(post(window));
  assert.equal(response.status, 502);
});
