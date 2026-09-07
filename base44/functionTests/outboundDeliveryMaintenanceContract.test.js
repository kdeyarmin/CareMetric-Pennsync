import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const ROOT = new URL('../', import.meta.url);
const RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE';
const RELEASE_VALUE = 'enabled-v1';
const OWNER_EMAIL = 'owner@example.test';
let moduleSequence = 0;

const ADMIN = {
  id: 'admin-1',
  email: OWNER_EMAIL,
  full_name: 'Platform Owner',
  role: 'admin',
  account_type: 'super_admin',
  is_active: true,
  is_verified: true,
};

const ASSIGNED_FUNCTIONS = [
  'checkExpiredInvitations',
  'dispatchScheduledSignatureReminders',
  'generateAIReport',
  'generatePatientHandout',
  'sendCredentialRenewalReminders',
  'sendPersonnelExpirationNotifications',
];

function request(body = {}, headers = {}) {
  return new Request('https://functions.example.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function pausedBody(channel = 'email') {
  return {
    error: 'Outbound delivery is disabled in this environment.',
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
    channel,
    retryable: false,
  };
}

function guardedClient(user = ADMIN) {
  const calls = [];
  const unexpected = (name) => async () => {
    calls.push(name);
    throw new Error(`${name} must be unreachable while delivery is paused`);
  };
  const entity = new Proxy({}, {
    get: (_target, name) => unexpected(`entity.${String(name)}`),
  });
  const entities = new Proxy({}, { get: () => entity });
  const sendEmail = unexpected('SendEmail');
  return {
    calls,
    client: {
      auth: {
        me: async () => {
          calls.push('auth.me');
          return user;
        },
      },
      integrations: { Core: { SendEmail: sendEmail } },
      asServiceRole: {
        entities,
        integrations: { Core: { SendEmail: sendEmail } },
      },
    },
  };
}

async function loadHandler(name, client, {
  release,
  enableSignatureDispatcher = false,
} = {}) {
  let source = await readFile(new URL(`functions/${name}/entry.ts`, ROOT), 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__maintenanceGateCreateClient;',
  );
  source = source.replace(
    /import\s+\{\s*jsPDF\s*\}\s+from\s+'npm:[^']+';?/,
    'const jsPDF = globalThis.__maintenanceGateJsPdf;',
  );
  if (enableSignatureDispatcher) {
    source = source
      .replace('const SIGNATURE_REMINDER_DISPATCH_ENABLED = false;',
        'const SIGNATURE_REMINDER_DISPATCH_ENABLED = true;')
      .replace('const SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN = false;',
        'const SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN = true;');
  }

  const env = {
    APP_PUBLIC_URL: 'https://app.pennsync.example',
    INTERNAL_FN_SECRET: 'scheduler-secret',
    SUPER_ADMIN_EMAIL: OWNER_EMAIL,
    ...(release === undefined ? {} : { [RELEASE_ENV]: release }),
  };
  let handler;
  globalThis.__maintenanceGateCreateClient = () => client;
  globalThis.__maintenanceGateJsPdf = class UnexpectedPdfConstruction {
    constructor() {
      throw new Error('PDF construction must be unreachable while email delivery is paused');
    }
  };
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (key) => env[key] },
  };
  const compiled = transpileTs(source, { fileName: `${name}/entry.ts` }).outputText;
  const encoded = Buffer.from(compiled).toString('base64');
  await import(`data:text/javascript;base64,${encoded}#maintenance-gate-${moduleSequence++}`);
  assert.equal(typeof handler, 'function', name);
  return handler;
}

test('assigned senders embed one canonical gate after authentication and before email', async () => {
  for (const name of ASSIGNED_FUNCTIONS) {
    const source = await readFile(new URL(`functions/${name}/entry.ts`, ROOT), 'utf8');
    const handler = source.slice(source.indexOf('Deno.serve'));
    const auth = handler.indexOf('.auth.me');
    const release = handler.indexOf('outboundDeliveryReleased()');
    const provider = source.indexOf('.SendEmail(');
    assert.equal(
      (source.match(/BEGIN SHARED HELPER: outboundDeliveryGate/g) || []).length,
      1,
      `${name}: generated gate marker`,
    );
    assert.notEqual(auth, -1, `${name}: authenticates`);
    assert.notEqual(release, -1, `${name}: checks release at runtime`);
    assert.notEqual(provider, -1, `${name}: email provider primitive exists`);
    assert.ok(auth < release, `${name}: authentication precedes the release decision`);
    assert.ok(source.indexOf('Deno.serve') + release < provider,
      `${name}: release decision precedes the email primitive`);
  }
});

test('report, handout, reminder, and source-enabled signature sends fail closed', async () => {
  const cases = [
    ['generateAIReport', {
      report_type: 'operational',
      recipients: ['recipient@example.test'],
    }, {}],
    ['generatePatientHandout', {
      condition: 'chf',
      patientName: 'Test Patient',
      patientEmail: 'patient@example.test',
      action: 'email',
    }, {}],
    ['dispatchScheduledSignatureReminders', {}, { enableSignatureDispatcher: true }],
  ];
  for (const [name, body, options] of cases) {
    const runtime = guardedClient();
    const handler = await loadHandler(name, runtime.client, options);
    const response = await handler(request(body));
    assert.equal(response.status, 503, name);
    assert.equal(response.headers.get('cache-control'), 'no-store', name);
    assert.deepEqual(await response.json(), pausedBody(), name);
    assert.deepEqual(runtime.calls, ['auth.me'], `${name}: no data, PDF, or provider work`);
  }

  const padded = guardedClient();
  const paddedHandler = await loadHandler('generateAIReport', padded.client, {
    release: ` ${RELEASE_VALUE} `,
  });
  const paddedResponse = await paddedHandler(request({
    report_type: 'operational',
    recipients: ['recipient@example.test'],
  }));
  assert.equal(paddedResponse.status, 503, 'padded release sentinel stays paused');
  assert.deepEqual(padded.calls, ['auth.me']);
});

test('credential renewal job reports a successful pause without claiming delivery', async () => {
  const runtime = guardedClient();
  const handler = await loadHandler('sendCredentialRenewalReminders', runtime.client);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    success: true,
    notifications_sent: 0,
    admin_digests_sent: 0,
    details: [],
    delivery_paused: true,
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
  });
  assert.deepEqual(runtime.calls, ['auth.me'], 'paused run does not read, claim, or send');
});

test('invitation expiry maintenance continues but reminder claims and sends stay paused', async () => {
  const updates = [];
  let userListCalls = 0;
  let emailCalls = 0;
  const expired = {
    id: 'invite-expired',
    email: 'expired@example.test',
    full_name: 'Expired Invite',
    status: 'pending',
    expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };
  const expiring = {
    id: 'invite-expiring',
    email: 'expiring@example.test',
    full_name: 'Expiring Invite',
    status: 'pending',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const client = {
    auth: { me: async () => ADMIN },
    asServiceRole: {
      entities: {
        UserInvitation: {
          filter: async (query) => query?.status === 'pending' ? [expired, expiring] : [],
          update: async (id, patch) => {
            updates.push({ id, patch: structuredClone(patch) });
            return { id, ...patch };
          },
        },
        User: {
          list: async () => { userListCalls += 1; return []; },
        },
      },
      integrations: {
        Core: { SendEmail: async () => { emailCalls += 1; } },
      },
    },
  };
  const handler = await loadHandler('checkExpiredInvitations', client);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    success: true,
    expired: 1,
    expiring_soon: 1,
    notifications_sent: 0,
    delivery_paused: true,
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
  });
  assert.deepEqual(updates, [{ id: expired.id, patch: { status: 'expired' } }]);
  assert.equal(userListCalls, 0, 'paused run does not enumerate digest recipients');
  assert.equal(emailCalls, 0);
});

test('personnel expiry status maintenance continues without sent-looking notifications', async () => {
  const updates = [];
  let notificationCreates = 0;
  let emailCalls = 0;
  const expiredDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const client = {
    auth: { me: async () => ADMIN },
    asServiceRole: {
      entities: {
        PersonnelCredential: {
          filter: async () => [{
            id: 'credential-expired',
            user_id: 'staff@example.test',
            user_name: 'Staff User',
            title: 'License',
            item_type: 'license',
            status: 'active',
            expiration_date: expiredDate,
            reminder_offsets_sent: [],
          }],
          update: async (id, patch) => {
            updates.push({ id, patch: structuredClone(patch) });
            return { id, ...patch };
          },
        },
        User: {
          list: async () => [{
            email: 'staff@example.test',
            full_name: 'Staff User',
            agency_name: 'Agency One',
          }],
        },
        Notification: {
          bulkCreate: async () => { notificationCreates += 1; },
        },
      },
      integrations: {
        Core: { SendEmail: async () => { emailCalls += 1; } },
      },
    },
  };
  const handler = await loadHandler('sendPersonnelExpirationNotifications', client);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    success: true,
    notifications_sent: 0,
    delivery_paused: true,
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
  });
  assert.deepEqual(updates, [{
    id: 'credential-expired',
    patch: { status: 'expired' },
  }]);
  assert.equal(notificationCreates, 0);
  assert.equal(emailCalls, 0);
});

test('authorization failures still win over the global release pause', async () => {
  const nonAdmin = { id: 'user-1', email: 'user@example.test', role: 'user', is_active: true };
  const cases = [
    ['checkExpiredInvitations', nonAdmin, 403, {}],
    ['generateAIReport', nonAdmin, 403, { report_type: 'operational', recipients: ['x@example.test'] }],
    ['generatePatientHandout', null, 401, { condition: 'chf', patientEmail: 'x@example.test', action: 'email' }],
    ['sendCredentialRenewalReminders', nonAdmin, 403, {}],
    ['sendPersonnelExpirationNotifications', nonAdmin, 403, {}],
  ];
  for (const [name, user, status, body] of cases) {
    const runtime = guardedClient(user);
    const handler = await loadHandler(name, runtime.client);
    const response = await handler(request(body));
    assert.equal(response.status, status, name);
    assert.deepEqual(runtime.calls, ['auth.me'], `${name}: unauthorized run has no effect`);
  }

  const signature = guardedClient(null);
  const signatureHandler = await loadHandler(
    'dispatchScheduledSignatureReminders',
    signature.client,
    { enableSignatureDispatcher: true },
  );
  const signatureResponse = await signatureHandler(request());
  assert.equal(signatureResponse.status, 401);
  assert.deepEqual(signature.calls, ['auth.me']);
});
