import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const source = (await readFile(new URL('../functions/userManagement/entry.ts', import.meta.url), 'utf8'))
  .replace(/import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/, '');
const compiled = transpileTs(source, { fileName: 'userManagement/entry.ts' }).outputText;
const owner = { id: 'owner', email: 'owner@example.test', role: 'admin', is_active: true };
const payloads = {
  invite_user: { email: 'invitee@example.test', full_name: 'Test Invitee', role: 'user' },
  resend_invitation: { invitation_id: 'invitation-1' },
};

function fixture({ sendFails = false, stampFails = false, stampCommitsThenFails = false, auditFails = false, released = true, user = owner } = {}) {
  const state = {
    calls: [],
    audits: [],
    row: {
      id: 'invitation-1', email: 'invitee@example.test', full_name: 'Test Invitee',
      status: 'pending', role: 'user', expires_at: '2020-01-01T00:00:00.000Z',
      last_sent_at: '2019-12-25T00:00:00.000Z', resend_count: 2,
    },
  };
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        UserInvitation: {
          filter: async () => [state.row],
          create: async (data) => {
            state.calls.push('create');
            state.row = { id: 'invitation-1', ...data };
            return state.row;
          },
          update: async (id, data) => {
            state.calls.push('stamp');
            assert.equal(id, 'invitation-1');
            if (stampFails) throw new Error('private-provider-detail');
            state.row = { ...state.row, ...data };
            if (stampCommitsThenFails) throw new Error('private-provider-detail');
            return state.row;
          },
        },
        UserActivity: { create: async (data) => {
          state.calls.push('audit');
          state.audits.push(data);
          if (auditFails) throw new Error('private-provider-detail');
          return { id: 'activity-1' };
        } },
      },
      integrations: { Core: { SendEmail: async () => {
        state.calls.push('send');
        if (sendFails) throw new Error('private-provider-detail');
        return { accepted: true };
      } } },
    },
  };
  let handler;
  const env = {
    APP_PUBLIC_URL: 'https://staging.example.test',
    SUPER_ADMIN_EMAIL: owner.email,
    OUTBOUND_DELIVERY_RELEASE: released ? 'enabled-v1' : undefined,
  };
  new Function('createClientFromRequest', 'Deno', 'console', compiled)(
    () => client,
    { serve: (value) => { handler = value; }, env: { get: (key) => env[key] } },
    { error: () => {} },
  );
  return {
    state,
    invoke: async (action) => {
      const response = await handler(new Request('https://staging.example.test', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payloads[action] }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('initial email error preserves the pending invitation without claiming or stamping a send', async () => {
  const runtime = fixture({ sendFails: true });
  const result = await runtime.invoke('invite_user');
  assert.equal(result.status, 502);
  assert.equal(result.body.success, false);
  assert.equal(result.body.code, 'INVITATION_EMAIL_UNCONFIRMED');
  assert.equal(result.body.invitation_id, runtime.state.row.id);
  assert.equal(result.body.delivery_status, 'unconfirmed');
  assert.equal(runtime.state.row.status, 'pending');
  assert.equal(Object.hasOwn(runtime.state.row, 'last_sent_at'), false);
  assert.deepEqual(runtime.state.calls, ['create', 'send']);
  assert.doesNotMatch(JSON.stringify(result.body), /private-provider-detail/);
});

test('resend email error leaves expiry, sent time and resend count unchanged', async () => {
  const runtime = fixture({ sendFails: true });
  const before = { ...runtime.state.row };
  const result = await runtime.invoke('resend_invitation');
  assert.equal(result.status, 502);
  assert.equal(result.body.success, false);
  assert.equal(result.body.code, 'INVITATION_EMAIL_UNCONFIRMED');
  assert.equal(result.body.invitation_id, before.id);
  assert.equal(result.body.delivery_status, 'unconfirmed');
  assert.match(result.body.error, /[Cc]heck.*before resending/);
  assert.deepEqual(runtime.state.row, before);
  assert.deepEqual(runtime.state.calls, ['send']);
  assert.doesNotMatch(JSON.stringify(result.body), /private-provider-detail/);
});

for (const action of Object.keys(payloads)) {
  test(`${action} records a send only after the provider accepts it`, async () => {
    const runtime = fixture();
    const result = await runtime.invoke(action);
    assert.equal(result.status, 200);
    assert.equal(result.body.delivery_status, 'submitted');
    assert.deepEqual(result.body.warnings, []);
    assert.deepEqual(runtime.state.calls, action === 'invite_user'
      ? ['create', 'send', 'stamp', 'audit'] : ['send', 'stamp', 'audit']);
    assert.ok(Date.parse(runtime.state.row.last_sent_at) > Date.parse('2020-01-01'));
    if (action === 'resend_invitation') {
      assert.equal(result.body.delivery_metadata_status, 'saved');
      assert.equal(result.body.new_expires_at, runtime.state.row.expires_at);
      assert.equal(runtime.state.audits[0].details.delivery_metadata_status, 'saved');
      assert.equal(runtime.state.audits[0].details.new_expires_at, runtime.state.row.expires_at);
      assert.equal(runtime.state.audits[0].details.resend_count, runtime.state.row.resend_count);
    }
  });

  for (const failure of ['stampFails', 'auditFails']) {
    test(`${action} reports ${failure} after submission without claiming a send failure`, async () => {
      const runtime = fixture({ [failure]: true });
      const result = await runtime.invoke(action);
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
      assert.equal(result.body.delivery_status, 'submitted');
      assert.deepEqual(result.body.warnings, [failure === 'stampFails'
        ? 'DELIVERY_METADATA_UNCONFIRMED' : 'DELIVERY_AUDIT_UNCONFIRMED']);
      assert.match(result.body.message, /record saves could not be confirmed/);
      assert.equal(runtime.state.calls.filter((call) => call === 'send').length, 1);
      if (failure === 'stampFails' && action === 'resend_invitation') {
        assert.equal(result.body.new_expires_at, null);
        assert.equal(result.body.delivery_metadata_status, 'unconfirmed');
        assert.equal(runtime.state.row.resend_count, 2);
        assert.equal(runtime.state.audits[0].details.resend_count, null);
        assert.equal(runtime.state.audits[0].details.new_expires_at, null);
        assert.equal(runtime.state.audits[0].details.delivery_metadata_status, 'unconfirmed');
      }
      assert.doesNotMatch(JSON.stringify(result.body), /private-provider-detail/);
    });
  }

  test(`${action} keeps the paused gate ahead of every write and send`, async () => {
    const runtime = fixture({ released: false });
    const result = await runtime.invoke(action);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
    assert.deepEqual(runtime.state.calls, []);
  });

  test(`${action} does not let an ordinary user send or mutate invitations`, async () => {
    const runtime = fixture({ user: { ...owner, role: 'user' } });
    const result = await runtime.invoke(action);
    assert.equal(result.status, 403);
    assert.deepEqual(runtime.state.calls, []);
  });
}

test('resend stamp that commits before throwing leaves effective metadata unconfirmed', async () => {
  const runtime = fixture({ stampCommitsThenFails: true });
  const originalExpiry = runtime.state.row.expires_at;
  const result = await runtime.invoke('resend_invitation');

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.delivery_status, 'submitted');
  assert.deepEqual(result.body.warnings, ['DELIVERY_METADATA_UNCONFIRMED']);
  assert.equal(result.body.delivery_metadata_status, 'unconfirmed');
  assert.equal(result.body.new_expires_at, null);
  assert.notEqual(runtime.state.row.expires_at, originalExpiry);
  assert.equal(runtime.state.row.resend_count, 3);
  assert.equal(runtime.state.audits[0].details.delivery_metadata_status, 'unconfirmed');
  assert.equal(runtime.state.audits[0].details.new_expires_at, null);
  assert.equal(runtime.state.audits[0].details.resend_count, null);
  assert.deepEqual(runtime.state.calls, ['send', 'stamp', 'audit']);
  assert.doesNotMatch(JSON.stringify(result.body), /private-provider-detail/);
});
