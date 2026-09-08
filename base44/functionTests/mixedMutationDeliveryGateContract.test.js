import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const FUNCTIONS_ROOT = new URL('../functions/', import.meta.url);
const MIXED_EMAIL_FLOWS = [
  'autoApproveInvitedUser',
  'cancelTimeOffRequest',
  'createNotification',
  'onUserSignup',
  'reviewPersonnelCredential',
  'reviewTimeOffRequest',
  'reviewTimesheet',
  'submitPersonnelCredential',
  'submitStateReportableIncident',
  'submitTimeOffRequest',
  'submitTimesheet',
];

let moduleSequence = 0;

async function readEntry(name) {
  return readFile(new URL(`${name}/entry.ts`, FUNCTIONS_ROOT), 'utf8');
}

async function loadHandler(name, client, { release, fetchImpl } = {}) {
  let source = await readEntry(name);
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__mixedMutationCreateClient;',
  );
  const compiled = transpileTs(source, { fileName: `${name}/entry.ts` }).outputText;
  const encoded = Buffer.from(compiled).toString('base64');
  const previousDeno = globalThis.Deno;
  const previousFactory = globalThis.__mixedMutationCreateClient;
  const previousFetch = globalThis.fetch;
  let handler;
  const runtimeDeno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (name) => name === 'OUTBOUND_DELIVERY_RELEASE' ? release : undefined,
    },
  };
  try {
    globalThis.__mixedMutationCreateClient = () => client;
    globalThis.Deno = runtimeDeno;
    if (fetchImpl) globalThis.fetch = fetchImpl;
    await import(`data:text/javascript;base64,${encoded}#mixed-mutation-${moduleSequence++}`);
    assert.equal(typeof handler, 'function', name);
    const loadedHandler = handler;
    return async (...args) => {
      const invocationDeno = globalThis.Deno;
      const invocationFetch = globalThis.fetch;
      try {
        globalThis.Deno = runtimeDeno;
        if (fetchImpl) globalThis.fetch = fetchImpl;
        return await loadedHandler(...args);
      } finally {
        globalThis.Deno = invocationDeno;
        globalThis.fetch = invocationFetch;
      }
    };
  } finally {
    globalThis.Deno = previousDeno;
    globalThis.__mixedMutationCreateClient = previousFactory;
    globalThis.fetch = previousFetch;
  }
}

test('mixed mutation flows embed and use the canonical gate without returning its 503 response', async () => {
  for (const name of MIXED_EMAIL_FLOWS) {
    const source = await readEntry(name);
    const handler = source.slice(source.indexOf('Deno.serve'));
    assert.equal(
      (source.match(/<<<BEGIN SHARED HELPER: outboundDeliveryGate/g) || []).length,
      1,
      `${name}: canonical helper is embedded once`,
    );
    assert.match(handler, /outboundDeliveryReleased\(\)/, `${name}: runtime gate is used`);
    assert.match(handler, /delivery_paused/, `${name}: paused delivery is reported`);
    assert.doesNotMatch(
      handler,
      /outboundDeliveryPausedResponse\(/,
      `${name}: completed primary mutations must not be replaced by a 503`,
    );
  }
});

function signupClient({ invited }) {
  const calls = {
    configReads: 0,
    fetches: [],
    emails: [],
    userUpdates: [],
    invitationUpdates: [],
    activities: [],
  };
  const email = invited ? 'invited@example.test' : 'uninvited@example.test';
  const signupUser = {
    id: 'user-1',
    email,
    full_name: invited ? 'Invited User' : 'Uninvited User',
  };
  const storedUser = {
    ...signupUser,
    is_approved: !invited,
    is_verified: false,
    otp_code: null,
    otp_expires_at: null,
  };
  const invitation = {
    id: 'invitation-1',
    email,
    full_name: 'Invited User',
    role: 'user',
    staff_role: 'nurse',
    status: 'pending',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    invited_by: 'admin@example.test',
  };
  const client = {
    getConfig: () => {
      calls.configReads += 1;
      throw new Error('paused OTP resend must not resolve provider configuration');
    },
    asServiceRole: {
      integrations: {
        Core: {
          SendEmail: async (payload) => {
            calls.emails.push(payload);
            return { success: true };
          },
        },
      },
      entities: {
        UserInvitation: {
          filter: async () => invited ? [invitation] : [],
          update: async (...args) => {
            calls.invitationUpdates.push(args);
            return {};
          },
        },
        User: {
          filter: async () => [storedUser],
          update: async (...args) => {
            calls.userUpdates.push(args);
            return {};
          },
          list: async () => [{
            id: 'admin-1',
            email: 'admin@example.test',
            full_name: 'Admin',
            role: 'admin',
          }],
        },
        UserActivity: {
          create: async (row) => {
            calls.activities.push(row);
            return { id: `activity-${calls.activities.length}` };
          },
        },
        LearningPlan: { filter: async () => [] },
      },
    },
  };
  return { calls, client, signupUser };
}

test('paused resend-OTP keeps invited approval and audit but performs no human delivery', async () => {
  const runtime = signupClient({ invited: true });
  const handler = await loadHandler('onUserSignup', runtime.client, {
    fetchImpl: async (...args) => {
      runtime.calls.fetches.push(args);
      throw new Error('paused OTP resend must not call fetch');
    },
  });
  const response = await handler({ json: async () => ({ user: runtime.signupUser }) });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.auto_approved, true);
  assert.equal(body.auth_verified, false);
  assert.equal(body.email, false);
  assert.equal(body.delivery_paused, true);
  assert.ok(runtime.calls.userUpdates.some(([, row]) => row.is_approved === true));
  assert.ok(runtime.calls.activities.some((row) => row.action === 'user_signup_auto_approved'));
  assert.deepEqual(runtime.calls.invitationUpdates, []);
  assert.deepEqual(runtime.calls.emails, []);
  assert.deepEqual(runtime.calls.fetches, []);
  assert.equal(runtime.calls.configReads, 0);
});

test('paused blocked-signup fanout preserves denial and audit without claiming admins were alerted', async () => {
  const runtime = signupClient({ invited: false });
  const handler = await loadHandler('onUserSignup', runtime.client, {
    fetchImpl: async (...args) => {
      runtime.calls.fetches.push(args);
      throw new Error('blocked signup must not call fetch');
    },
  });
  const response = await handler({ json: async () => ({ user: runtime.signupUser }) });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.blocked, true);
  assert.equal(body.email, false);
  assert.equal(body.delivery_paused, true);
  assert.doesNotMatch(body.message, /alerted|sent/i);
  assert.ok(runtime.calls.userUpdates.some(([, row]) => row.is_approved === false));
  assert.ok(runtime.calls.activities.some((row) => row.action === 'uninvited_signup_blocked'));
  assert.deepEqual(runtime.calls.emails, []);
  assert.deepEqual(runtime.calls.fetches, []);
});

test('paused time-off review preserves the decision and in-app notification', async () => {
  const calls = { updates: [], notifications: [], emails: [] };
  const client = {
    auth: {
      me: async () => ({
        id: 'admin-1',
        email: 'reviewer@example.test',
        full_name: 'Reviewer',
        role: 'admin',
        account_type: 'super_admin',
        is_active: true,
      }),
    },
    asServiceRole: {
      entities: {
        TimeOffRequest: {
          get: async () => ({
            id: 'request-1',
            employee_email: 'employee@example.test',
            employee_name: 'Employee',
            request_type: 'vacation',
            start_date: '2026-09-14',
            end_date: '2026-09-15',
            status: 'pending',
          }),
          update: async (...args) => {
            calls.updates.push(args);
            return { id: 'request-1', status: args[1].status };
          },
        },
        Notification: {
          create: async (row) => {
            calls.notifications.push(row);
            return { id: 'notification-1', ...row };
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
  const handler = await loadHandler('reviewTimeOffRequest', client);
  const response = await handler({
    json: async () => ({ request_id: 'request-1', decision: 'approved' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.email, false);
  assert.equal(body.delivery_paused, true);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0][1].status, 'approved');
  assert.equal(calls.notifications.length, 1);
  assert.deepEqual(calls.emails, []);
});
