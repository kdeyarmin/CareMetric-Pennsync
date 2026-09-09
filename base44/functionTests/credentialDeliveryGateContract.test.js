import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const ROOT = new URL('../', import.meta.url);
const APP_URL = 'https://app.pennsync.example';
const OWNER_EMAIL = 'owner@example.com';
const DELIVERY_MUTATIONS = [
  'inviteUser',
  'updateUserPassword',
  'resendOtp',
  'sendEmail',
  'UserInvitation.create',
  'UserInvitation.update',
  'UserActivity.create',
  'DocumentPackage.updateMany',
  'DocumentPackageToken.create',
  'DocumentPackageToken.updateMany',
  'SignatureAuditEvent.create',
];

let moduleSequence = 0;

function adminUser(overrides = {}) {
  return {
    id: 'admin-1',
    email: OWNER_EMAIL,
    full_name: 'Platform Owner',
    role: 'admin',
    account_type: 'super_admin',
    agency_name: null,
    is_active: true,
    ...overrides,
  };
}

function targetUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'staff@example.com',
    full_name: 'Staff User',
    role: 'user',
    account_type: 'staff',
    agency_name: 'Agency One',
    is_active: true,
    is_approved: true,
    ...overrides,
  };
}

function fixture({ user = adminUser(), target = targetUser(), authError, clientError } = {}) {
  const calls = new Map();
  const bump = (name) => calls.set(name, (calls.get(name) || 0) + 1);
  const invitation = {
    id: 'invite-1',
    email: target.email,
    full_name: target.full_name,
    role: target.role,
    agency_name: target.agency_name,
    invited_by: OWNER_EMAIL,
    status: 'pending',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    resend_count: 0,
  };
  const client = {
    auth: {
      me: async () => {
        bump('auth.me');
        if (authError) throw authError;
        return user;
      },
      resendOtp: async () => { bump('resendOtp'); return { accepted: true }; },
      verifyOtp: async () => { bump('verifyOtp'); return { verified: true }; },
    },
    users: {
      inviteUser: async () => { bump('inviteUser'); return { accepted: true }; },
    },
    asServiceRole: {
      auth: {
        updateUserPassword: async () => { bump('updateUserPassword'); return { updated: true }; },
      },
      integrations: {
        Core: {
          SendEmail: async () => { bump('sendEmail'); return { accepted: true }; },
        },
      },
      entities: {
        User: {
          filter: async () => { bump('User.filter'); return [target]; },
          list: async () => { bump('User.list'); return []; },
          update: async () => { bump('User.update'); return { id: target.id }; },
        },
        UserInvitation: {
          filter: async () => { bump('UserInvitation.filter'); return [invitation]; },
          list: async () => { bump('UserInvitation.list'); return []; },
          create: async () => { bump('UserInvitation.create'); return { id: 'invite-new' }; },
          update: async () => { bump('UserInvitation.update'); return { id: invitation.id }; },
        },
        UserActivity: {
          create: async () => { bump('UserActivity.create'); return { id: 'activity-1' }; },
        },
      },
    },
  };
  return { calls, bump, client, invitation, clientError };
}

function callCount(runtime, name) {
  return runtime.calls.get(name) || 0;
}

function assertNoDeliveryMutations(runtime, label) {
  for (const name of DELIVERY_MUTATIONS) {
    assert.equal(callCount(runtime, name), 0, `${label}: ${name}`);
  }
}

function request(body, authorization = 'Bearer test-only-admin-session') {
  return new Request('https://functions.example.test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization === null ? {} : { Authorization: authorization }),
    },
    body: JSON.stringify(body),
  });
}

async function loadHandler(name, runtime, {
  release,
  enableSignerSource = false,
  stubSignerAuthority = false,
} = {}) {
  let source = await readFile(new URL(`functions/${name}/entry.ts`, ROOT), 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__credentialGateCreateClient;',
  );
  if (enableSignerSource) {
    source = source.replace(
      'const PUBLIC_SIGNATURE_RELEASE_ENABLED = false;',
      'const PUBLIC_SIGNATURE_RELEASE_ENABLED = true;',
    );
  }
  if (stubSignerAuthority) {
    source = source.replace(
      'const initialAuthority = await loadAuthority(base44, input.agencyId);',
      'const initialAuthority = await globalThis.__credentialGateLoadAuthority(base44, input.agencyId);',
    );
    source = source.replace(
      'const initialPackage = await loadPackageSnapshot(initialAuthority.entities, input);',
      'const initialPackage = await globalThis.__credentialGateLoadPackage(initialAuthority.entities, input);',
    );
  }

  let handler;
  const env = {
    APP_PUBLIC_URL: APP_URL,
    SUPER_ADMIN_EMAIL: OWNER_EMAIL,
    ...(release === undefined ? {} : { OUTBOUND_DELIVERY_RELEASE: release }),
  };
  globalThis.__credentialGateCreateClient = () => {
    runtime.bump('createClientFromRequest');
    if (runtime.clientError) throw runtime.clientError;
    return runtime.client;
  };
  globalThis.__credentialGateLoadAuthority = async () => runtime.signerAuthority;
  globalThis.__credentialGateLoadPackage = async () => runtime.signerPackage;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (key) => env[key] },
  };
  const compiled = transpileTs(source, { fileName: `${name}/entry.ts` }).outputText;
  const encoded = Buffer.from(compiled).toString('base64');
  await import(`data:text/javascript;base64,${encoded}#credential-gate-${moduleSequence++}`);
  assert.equal(typeof handler, 'function', name);
  return handler;
}

test('all canonical and recovery invitation routes reject non-POST methods before credential access', async () => {
  for (const baseName of ['userManagement', 'resendInvitation', 'createUserWithTempPassword']) {
    for (const name of [baseName, `${baseName}V2`]) {
      const runtime = fixture({ clientError: new Error('SDK must not run') });
      const handler = await loadHandler(name, runtime);
      for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const response = await handler({
          method,
          get headers() { assert.fail('unsupported method must not inspect credentials'); },
          json() { assert.fail('unsupported method must not parse input'); },
        });
        assert.equal(response.status, 405, `${name}:${method}`);
        assert.equal(response.headers.get('allow'), 'POST');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json()).code, 'METHOD_NOT_ALLOWED');
        assertNoDeliveryMutations(runtime, `${name}:${method}`);
      }
    }
  }
});

test('production recovery routes contain the exact canonical implementation, not a reduced substitute', async () => {
  for (const name of ['userManagement', 'resendInvitation', 'createUserWithTempPassword']) {
    const canonical = await readFile(new URL(`functions/${name}/entry.ts`, ROOT), 'utf8');
    const recovery = await readFile(new URL(`functions/${name}V2/entry.ts`, ROOT), 'utf8');
    const withoutRegistrationComment = recovery.replace(/\n\/\/ (?:Production|Sandbox) replacement endpoint: [^\n]+\s*$/, '');
    assert.equal(withoutRegistrationComment.trim(), canonical.trim(), `${name}V2 implementation drift`);
    const runtime = fixture({ clientError: new Error('SDK must not run without credentials') });
    const handler = await loadHandler(`${name}V2`, runtime);
    const response = await handler(new Request('https://functions.example.test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).code, 'AUTHENTICATION_REQUIRED');
    assertNoDeliveryMutations(runtime, name);
  }
});

const DIRECT_CASES = [
  {
    name: 'adminResetPassword',
    body: { userEmail: 'staff@example.com' },
    openCall: 'inviteUser',
  },
  {
    name: 'resetUserPassword',
    body: { userEmail: 'staff@example.com' },
    openCall: 'updateUserPassword',
  },
  {
    name: 'manageUserVerification',
    body: { action: 'resend', email: 'staff@example.com' },
    openCall: 'resendOtp',
  },
];

test('password recovery and OTP delivery paths fail closed with zero mutations', async () => {
  for (const testCase of DIRECT_CASES) {
    const runtime = fixture();
    const handler = await loadHandler(testCase.name, runtime);
    const response = await handler(request(testCase.body));
    assert.equal(response.status, 503, testCase.name);
    assert.deepEqual(await response.json(), {
      error: 'Outbound delivery is disabled in this environment.',
      code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
      channel: 'email',
      retryable: false,
    }, testCase.name);
    assert.equal(response.headers.get('cache-control'), 'no-store', testCase.name);
    assertNoDeliveryMutations(runtime, testCase.name);
  }
});

test('only the exact enabled-v1 sentinel reaches password recovery and OTP mocks', async () => {
  for (const testCase of DIRECT_CASES) {
    const runtime = fixture();
    const handler = await loadHandler(testCase.name, runtime, { release: 'enabled-v1' });
    const response = await handler(request(testCase.body));
    assert.equal(response.status, 200, testCase.name);
    assert.ok(callCount(runtime, testCase.openCall) > 0, `${testCase.name}: ${testCase.openCall}`);
  }

  const whitespace = fixture();
  const whitespaceHandler = await loadHandler('manageUserVerification', whitespace, {
    release: 'enabled-v1 ',
  });
  const whitespaceResponse = await whitespaceHandler(request({
    action: 'resend',
    email: 'staff@example.com',
  }));
  assert.equal(whitespaceResponse.status, 503);
  assert.equal(callCount(whitespace, 'resendOtp'), 0);
});

test('authorization still precedes the delivery pause response', async () => {
  for (const testCase of DIRECT_CASES) {
    const runtime = fixture({
      user: adminUser({ role: 'user', account_type: 'staff', email: 'caller@example.com' }),
    });
    const handler = await loadHandler(testCase.name, runtime);
    const response = await handler(request(testCase.body));
    assert.equal(response.status, 403, testCase.name);
    assertNoDeliveryMutations(runtime, testCase.name);
  }
});

test('manageUserVerification leaves OTP verification available while resend is paused', async () => {
  const runtime = fixture();
  const handler = await loadHandler('manageUserVerification', runtime);
  const response = await handler(request({
    action: 'verify',
    email: 'staff@example.com',
    otp: '123456',
  }));
  assert.equal(response.status, 200);
  assert.equal(callCount(runtime, 'verifyOtp'), 1);
  assert.equal(callCount(runtime, 'resendOtp'), 0);
});

const MANUAL_INVITATION_CASES = [
  {
    name: 'createUserWithTempPassword',
    body: { email: 'staff@example.com', full_name: 'Staff User', role: 'user' },
    openCall: 'inviteUser',
    initial: true,
  },
  {
    name: 'resendInvitation',
    body: { invitation_id: 'invite-1' },
    openCall: 'inviteUser',
  },
  {
    name: 'userManagement',
    body: { action: 'invite_user', email: 'staff@example.com', full_name: 'Staff User', role: 'user' },
    openCall: 'inviteUser',
    initial: true,
  },
  {
    name: 'userManagement',
    body: { action: 'resend_invitation', invitation_id: 'invite-1' },
    openCall: 'inviteUser',
  },
];

for (const testCase of MANUAL_INVITATION_CASES) {
  const label = testCase.body.action || testCase.name;
  test(`${label} rejects missing or malformed authorization before SDK construction or body parsing`, async () => {
    for (const authorization of [null, '', 'Basic test-only-token', 'Bearer', 'Bearer ', 'Bearer one two', 'Bearer one,two', 'bearer test-only-token']) {
      const runtime = fixture({ clientError: new Error('SDK construction must not run') });
      const handler = await loadHandler(testCase.name, runtime);
      const response = await handler(new Request('https://functions.example.test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization === null ? {} : { Authorization: authorization }),
          // A service credential cannot substitute for the user session.
          'Base44-Service-Authorization': 'Bearer test-only-service-session',
        },
        body: '{',
      }));
      assert.equal(response.status, 401, String(authorization));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED',
      });
      assert.equal(callCount(runtime, 'createClientFromRequest'), 0);
      assert.equal(callCount(runtime, 'auth.me'), 0);
      assertNoDeliveryMutations(runtime, label);
    }
  });

  test(`${label} preserves SDK configuration failures when a user Bearer token is present`, async () => {
    const runtime = fixture({ clientError: new Error('private SDK configuration details') });
    const handler = await loadHandler(testCase.name, runtime);
    const response = await handler(request(testCase.body));
    assert.equal(response.status, 500);
    assert.equal(callCount(runtime, 'createClientFromRequest'), 1);
    assert.equal(callCount(runtime, 'auth.me'), 0);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private SDK configuration details/);
    assertNoDeliveryMutations(runtime, label);
  });

  for (const [failure, options] of [
    ['missing session', { user: null }],
    ['SDK 401', { authError: Object.assign(new Error('private-auth-detail'), { status: 401 }) }],
    ['SDK 403', { authError: Object.assign(new Error('private-auth-detail'), { status: 403 }) }],
    ['wrapped HTTP 403', { authError: Object.assign(new Error('private-auth-detail'), { response: { status: 403 } }) }],
  ]) {
    test(`${label} reports ${failure} as authentication required before reads or delivery`, async () => {
      const runtime = fixture(options);
      const handler = await loadHandler(testCase.name, runtime);
      const response = await handler(request(testCase.body));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED',
      });
      assertNoDeliveryMutations(runtime, label);
      assert.equal(callCount(runtime, 'User.filter'), 0);
      assert.equal(callCount(runtime, 'UserInvitation.filter'), 0);
    });
  }

  test(`${label} does not misreport an authentication-service outage as a missing session`, async () => {
    const runtime = fixture({ authError: Object.assign(new Error('private-auth-detail'), { status: 503 }) });
    const handler = await loadHandler(testCase.name, runtime);
    const response = await handler(request(testCase.body));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.notEqual(body.code, 'AUTHENTICATION_REQUIRED');
    assert.doesNotMatch(JSON.stringify(body), /private-auth-detail/);
    assertNoDeliveryMutations(runtime, label);
  });

  test(`${label} permits a protected manual invitation while general delivery is paused`, async () => {
    const runtime = fixture();
    const handler = await loadHandler(testCase.name, runtime);
    const response = await handler(request(testCase.body));
    assert.equal(response.status, 200);
    assert.ok(callCount(runtime, testCase.openCall) > 0);
    assert.equal(callCount(runtime, 'updateUserPassword'), 0);
    assert.equal(callCount(runtime, 'resendOtp'), 0);
  });

  for (const [guard, user] of [
    ['ordinary user', adminUser({ role: 'user', account_type: 'staff' })],
    ['deactivated admin', adminUser({ is_active: false })],
    ['agency admin without an agency', adminUser({ account_type: 'agency_admin', agency_name: null })],
  ]) {
    test(`${label} still rejects ${guard} before any mutation while general delivery is paused`, async () => {
      const runtime = fixture({ user });
      const handler = await loadHandler(testCase.name, runtime);
      const response = await handler(request(testCase.body));
      assert.equal(response.status, 403);
      assertNoDeliveryMutations(runtime, label);
    });
  }

  if (testCase.initial) {
    test(`${label} keeps admin-role grants restricted to the protected owner while general delivery is paused`, async () => {
      const runtime = fixture({ user: adminUser({ email: 'other-admin@example.com' }) });
      const handler = await loadHandler(testCase.name, runtime);
      const response = await handler(request({ ...testCase.body, role: 'admin' }));
      assert.equal(response.status, 403);
      assertNoDeliveryMutations(runtime, label);
    });
  } else {
    test(`${label} still rejects another agency's invitation while general delivery is paused`, async () => {
      const runtime = fixture({
        user: adminUser({ account_type: 'agency_admin', agency_name: 'Agency Two' }),
      });
      const handler = await loadHandler(testCase.name, runtime);
      const response = await handler(request(testCase.body));
      assert.equal(response.status, 403);
      assertNoDeliveryMutations(runtime, label);
    });

    for (const status of ['accepted', 'cancelled']) {
      test(`${label} cannot reopen an ${status} invitation while general delivery is paused`, async () => {
        const runtime = fixture();
        runtime.invitation.status = status;
        const handler = await loadHandler(testCase.name, runtime);
        const response = await handler(request(testCase.body));
        assert.ok([400, 409].includes(response.status));
        assertNoDeliveryMutations(runtime, label);
      });
    }
  }
}

const USER_MANAGEMENT_DELIVERY_CASES = [
  {
    body: { action: 'reset_password', userEmail: 'staff@example.com' },
    openCall: 'updateUserPassword',
  },
];

test('userManagement keeps password recovery and expiry digests gated before mutations', async () => {
  for (const testCase of USER_MANAGEMENT_DELIVERY_CASES) {
    const closed = fixture();
    const closedHandler = await loadHandler('userManagement', closed);
    const closedResponse = await closedHandler(request(testCase.body));
    assert.equal(closedResponse.status, 503, testCase.body.action);
    assertNoDeliveryMutations(closed, testCase.body.action);

    const open = fixture();
    const openHandler = await loadHandler('userManagement', open, { release: 'enabled-v1' });
    const openResponse = await openHandler(request(testCase.body));
    assert.equal(openResponse.status, 200, testCase.body.action);
    assert.ok(callCount(open, testCase.openCall) > 0, `${testCase.body.action}: ${testCase.openCall}`);
  }

  const digestClosed = fixture();
  const digestHandler = await loadHandler('userManagement', digestClosed);
  const digestResponse = await digestHandler(request({ action: 'check_expired_invitations' }));
  assert.equal(digestResponse.status, 503);
  assert.equal(callCount(digestClosed, 'UserInvitation.filter'), 0);
  assertNoDeliveryMutations(digestClosed, 'check_expired_invitations');
});

test('userManagement non-delivery actions remain available while delivery is paused', async () => {
  const runtime = fixture();
  const handler = await loadHandler('userManagement', runtime);
  const response = await handler(request({ action: 'cancel_invitation', invitation_id: 'invite-1' }));
  assert.equal(response.status, 200);
  assert.equal(callCount(runtime, 'UserInvitation.update'), 1);
  assert.equal(callCount(runtime, 'sendEmail'), 0);
  assert.equal(callCount(runtime, 'inviteUser'), 0);
  assert.equal(callCount(runtime, 'updateUserPassword'), 0);
});

function signerRuntime({ user = adminUser() } = {}) {
  const runtime = fixture({ user });
  const entities = {
    DocumentPackageToken: {
      filter: async () => { runtime.bump('DocumentPackageToken.filter'); return []; },
      create: async () => { runtime.bump('DocumentPackageToken.create'); return { id: 'token-1' }; },
      updateMany: async () => { runtime.bump('DocumentPackageToken.updateMany'); return { success: true, updated: 1, has_more: false }; },
    },
    DocumentPackage: {
      updateMany: async () => {
        runtime.bump('DocumentPackage.updateMany');
        throw new Error('first token mutation reached');
      },
    },
    SignatureAuditEvent: {
      create: async () => { runtime.bump('SignatureAuditEvent.create'); return { id: 'audit-1' }; },
    },
  };
  runtime.signerAuthority = { entities, userId: user?.id || null, membership: null, snapshot: {} };
  runtime.signerPackage = {
    package: {
      token_issue_claimed_by: null,
      status: 'pending',
      authority_version: 1,
    },
  };
  return runtime;
}

const SIGNER_REQUEST = {
  agency_id: 'agency-1',
  package_id: 'package-1',
  signer_id: 'signer-1',
  request_id: 'request-1',
};

test('source-enabled signer issuance gates before token/provider mutation', async () => {
  const closed = signerRuntime();
  const closedHandler = await loadHandler('generateSignerToken', closed, {
    enableSignerSource: true,
    stubSignerAuthority: true,
  });
  const closedResponse = await closedHandler(request(SIGNER_REQUEST));
  assert.equal(closedResponse.status, 503);
  assert.equal(callCount(closed, 'DocumentPackageToken.filter'), 0);
  assertNoDeliveryMutations(closed, 'generateSignerToken');

  const open = signerRuntime();
  const openHandler = await loadHandler('generateSignerToken', open, {
    release: 'enabled-v1',
    enableSignerSource: true,
    stubSignerAuthority: true,
  });
  const openResponse = await openHandler(request(SIGNER_REQUEST));
  assert.equal(openResponse.status, 500);
  assert.equal(callCount(open, 'DocumentPackageToken.filter'), 2);
  assert.equal(callCount(open, 'DocumentPackage.updateMany'), 1);
  assert.equal(callCount(open, 'DocumentPackageToken.create'), 0);
  assert.equal(callCount(open, 'sendEmail'), 0);
});

test('source-enabled signer issuance preserves unauthenticated 401 before the delivery gate', async () => {
  const runtime = signerRuntime({ user: null });
  const handler = await loadHandler('generateSignerToken', runtime, { enableSignerSource: true });
  const response = await handler(request(SIGNER_REQUEST));
  assert.equal(response.status, 401);
  assertNoDeliveryMutations(runtime, 'generateSignerToken unauthorized');
});

test('all credential delivery handlers carry exactly one generated canonical marker', async () => {
  const names = [...DIRECT_CASES.map((item) => item.name), 'generateSignerToken', 'userManagement'];
  for (const name of names) {
    const source = await readFile(new URL(`functions/${name}/entry.ts`, ROOT), 'utf8');
    assert.equal((source.match(/BEGIN SHARED HELPER: outboundDeliveryGate/g) || []).length, 1, name);
    assert.equal((source.match(/END SHARED HELPER: outboundDeliveryGate/g) || []).length, 1, name);
  }
});
