import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const ENTRY = new URL('../functions/autoApproveInvitedUser/entry.ts', import.meta.url);
let moduleSequence = 0;

async function loadHandler(client, { release } = {}) {
  const source = (await readFile(ENTRY, 'utf8')).replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__invitationExpiryCreateClient;',
  );
  const compiled = transpileTs(source, { fileName: 'autoApproveInvitedUser/entry.ts' }).outputText;
  const previousDeno = globalThis.Deno;
  const previousFactory = globalThis.__invitationExpiryCreateClient;
  let handler;
  const runtimeDeno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (name) => ({
        OUTBOUND_DELIVERY_RELEASE: release,
        APP_PUBLIC_URL: 'https://staging.example.test',
        INTERNAL_FN_SECRET: 'test-scheduler-secret',
      })[name],
    },
  };
  try {
    globalThis.Deno = runtimeDeno;
    globalThis.__invitationExpiryCreateClient = () => client;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#expiry-${moduleSequence++}`);
    assert.equal(typeof handler, 'function');
  } finally {
    globalThis.Deno = previousDeno;
    globalThis.__invitationExpiryCreateClient = previousFactory;
  }
  return async () => {
    const invocationDeno = globalThis.Deno;
    try {
      globalThis.Deno = runtimeDeno;
      return await handler(new Request('https://staging.example.test/approve', { method: 'POST' }));
    } finally {
      globalThis.Deno = invocationDeno;
    }
  };
}

function fixture({ expiresAt, userApproved = false, userVerified = false, onUserLookup, failExpiryWrite = false } = {}) {
  const calls = { invitationQueries: [], userQueries: [], userUpdates: [], invitationUpdates: [], emails: [] };
  const invitation = {
    id: 'invitation-1',
    email: 'invited@example.test',
    full_name: 'Invited User',
    role: 'user',
    care_scope: 'home_health',
    staff_role: 'nurse',
    status: 'pending',
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  };
  const client = {
    auth: { me: async () => ({ id: 'admin-1', role: 'admin', is_active: true }) },
    asServiceRole: {
      entities: {
        UserInvitation: {
          filter: async (...args) => {
            calls.invitationQueries.push(args);
            return [invitation];
          },
          update: async (...args) => {
            calls.invitationUpdates.push(args);
            if (failExpiryWrite && args[1].status === 'expired') throw new Error('write unavailable');
            return {};
          },
        },
        User: {
          filter: async (...args) => {
            calls.userQueries.push(args);
            onUserLookup?.();
            return [{
              id: 'user-1',
              email: invitation.email,
              is_approved: userApproved,
              is_verified: userVerified,
            }];
          },
          update: async (...args) => {
            calls.userUpdates.push(args);
            return {};
          },
        },
      },
      integrations: {
        Core: {
          SendEmail: async (payload) => {
            calls.emails.push(payload);
            return { success: true };
          },
        },
      },
    },
  };
  return { calls, client };
}

function assertSkippedWithoutApproval(calls, body) {
  assert.equal(body.approved, 0);
  assert.equal(body.skipped, 1);
  assert.equal(body.total, 1);
  assert.deepEqual(calls.userUpdates, []);
  assert.deepEqual(calls.invitationUpdates, [['invitation-1', { status: 'expired' }]]);
  assert.deepEqual(calls.emails, []);
}

for (const [label, expiresAt] of [
  ['past', new Date(NOW - 1).toISOString()],
  ['at the current instant', new Date(NOW).toISOString()],
  ['missing', undefined],
  ['null', null],
  ['unparseable', 'not-a-date'],
  ['wrong type', 2099],
]) {
  test(`${label} invitation expiry cannot grant access or send activation email`, async (t) => {
    t.mock.method(Date, 'now', () => NOW);
    const runtime = fixture({ expiresAt });
    const handler = await loadHandler(runtime.client, { release: 'enabled-v1' });
    const response = await handler();
    assert.equal(response.status, 200);
    assertSkippedWithoutApproval(runtime.calls, await response.json());
    assert.deepEqual(runtime.calls.userQueries, []);
  });
}

test('an invitation expiring during the user lookup cannot grant access', async (t) => {
  let currentTime = NOW;
  t.mock.method(Date, 'now', () => currentTime);
  const runtime = fixture({
    expiresAt: new Date(NOW + 1).toISOString(),
    onUserLookup: () => { currentTime = NOW + 1; },
  });
  const handler = await loadHandler(runtime.client);
  const response = await handler();
  assert.equal(response.status, 200);
  assertSkippedWithoutApproval(runtime.calls, await response.json());
  assert.equal(runtime.calls.userQueries.length, 1);
});

test('an expired invitation cannot be accepted for an already-approved verified user', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const runtime = fixture({
    expiresAt: new Date(NOW - 1).toISOString(),
    userApproved: true,
    userVerified: true,
  });
  const handler = await loadHandler(runtime.client);
  const response = await handler();
  assertSkippedWithoutApproval(runtime.calls, await response.json());
});

test('expiry maintenance failure does not fall through to approval', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const runtime = fixture({ expiresAt: new Date(NOW - 1).toISOString(), failExpiryWrite: true });
  const handler = await loadHandler(runtime.client);
  const response = await handler();
  assert.equal(response.status, 200);
  assertSkippedWithoutApproval(runtime.calls, await response.json());
  assert.deepEqual(runtime.calls.userQueries, []);
});

for (const [label, release] of [['paused', undefined], ['released', 'enabled-v1']]) {
  test(`a future invitation still approves while activation delivery is ${label}`, async (t) => {
    t.mock.method(Date, 'now', () => NOW);
    const runtime = fixture({ expiresAt: new Date(NOW + 60_000).toISOString() });
    const handler = await loadHandler(runtime.client, { release });
    const response = await handler();
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.approved, 1);
    assert.equal(body.skipped, 0);
    assert.equal(body.delivery_paused, !release);
    assert.deepEqual(runtime.calls.userUpdates, [['user-1', {
      is_approved: true,
      role: 'user',
      care_scope: 'home_health',
      staff_role: 'nurse',
    }]]);
    assert.equal(runtime.calls.invitationUpdates.length, 1);
    assert.equal(runtime.calls.invitationUpdates[0][1].status, 'accepted');
    assert.equal(runtime.calls.emails.length, release ? 1 : 0);
    if (!release) assert.equal(body.email, false);
  });
}
