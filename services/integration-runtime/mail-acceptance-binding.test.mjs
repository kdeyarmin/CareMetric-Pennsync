import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runMailAcceptance } from './operator-mail-acceptance.mjs';
import { loadConfig } from './runtime.mjs';

const config = () => loadConfig({ SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
  INTEGRATIONS_HASH_KEY: '1'.repeat(64), INTEGRATIONS_ENCRYPTION_KEY: '2'.repeat(64), SENDGRID_API_KEY: 'synthetic',
  NOTIFICATION_FROM_EMAIL: 'sender@example.test', RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40) });

test('each exact sender/revision is independently validated; identical configuration replays without new sends', async () => {
  const rows = new Map(); const senders = [];
  const store = {
    async reserve(value) {
      const key = `${value.p_subject}:${value.p_request_id}`;
      const existing = rows.get(key);
      if (existing) return { id: existing.id, outcome: existing.hash === value.p_payload_hash ? existing.state : 'conflict', result: existing.result };
      const row = { id: randomUUID(), claim: value.p_claim, hash: value.p_payload_hash, state: 'pending' };
      rows.set(key, row); return { id: row.id, outcome: 'owned' };
    },
    async finish(value) {
      const row = [...rows.values()].find(item => item.id === value.p_id);
      if (!row || row.claim !== value.p_claim || row.state !== 'pending') return false;
      row.state = value.p_state; row.result = value.p_result; return true;
    },
  };
  const options = { authorization: 'explicit-mail-sandbox-v1', store, fetcher: async (_url, init) => {
    const payload = JSON.parse(init.body); assert.equal(payload.mail_settings.sandbox_mode.enable, true);
    senders.push(payload.from.email); return new Response(null, { status: 200 });
  } };
  for (const current of [config(), { ...config(), fromEmail: 'replacement@example.test' }, { ...config(), revision: 'b'.repeat(40) }]) {
    const first = await runMailAcceptance(current, options); const replay = await runMailAcceptance(current, options);
    assert.equal(first.passed, true); assert.equal(first.counts.sandboxRequests, 2);
    assert.equal(replay.passed, true); assert.equal(replay.counts.sandboxRequests, 0);
  }
  assert.equal(rows.size, 6); assert.equal(senders.length, 6);
  assert.deepEqual(senders, ['sender@example.test', 'sender@example.test', 'replacement@example.test', 'replacement@example.test', 'sender@example.test', 'sender@example.test']);
  assert.equal([...rows.keys()].some(key => key.includes('@') || key.includes('replacement')), false);
});
for (const revision of ['', undefined, 'unbound', 'main', 'a'.repeat(39)]) {
  test(`unbound revision ${String(revision)} cannot create acceptance records`, async () => {
    await assert.rejects(() => runMailAcceptance({ ...config(), revision }, {
      authorization: 'explicit-mail-sandbox-v1', store: { reserve: () => assert.fail('no reservation') },
      fetcher: () => assert.fail('no provider request'),
    }), error => error.code === 'MAIL_ACCEPTANCE_NOT_AUTHORIZED');
  });
}
