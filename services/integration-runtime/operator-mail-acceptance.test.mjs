import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from './runtime.mjs';
import { main, runMailAcceptance, MAIL_FIXTURE } from './operator-mail-acceptance.mjs';

const config = () => loadConfig({ SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
  INTEGRATIONS_HASH_KEY: '1'.repeat(64), INTEGRATIONS_ENCRYPTION_KEY: '2'.repeat(64), SENDGRID_API_KEY: 'synthetic',
  NOTIFICATION_FROM_EMAIL: 'sender@example.test', RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40) });
function store() {
  const rows = new Map();
  return {
    async reserve(value) {
      const key = `${value.p_subject}:${value.p_request_id}`;
      const old = rows.get(key);
      if (old) return { id: old.id, outcome: old.hash !== value.p_payload_hash ? 'conflict' : old.state, result: old.result };
      const row = { id: randomUUID(), claim: value.p_claim, hash: value.p_payload_hash, state: 'pending' };
      rows.set(key, row); return { id: row.id, outcome: 'owned' };
    },
    async finish(value) {
      const row = [...rows.values()].find(item => item.id === value.p_id);
      if (!row || row.claim !== value.p_claim || row.state !== 'pending') return false;
      row.state = value.p_state; row.result = value.p_result; return true;
    }, rows,
  };
}
for (const patch of [{ released: true }, { browserReleased: true }, { operations: ['SendEmail'] },
  { browserOperations: ['SendEmail'] }, { sendgridKey: '' }, { configured: false }]) {
  test(`operator mail test refuses unsafe ${Object.keys(patch)[0]} without any request`, async () => {
    await assert.rejects(() => runMailAcceptance({ ...config(), ...patch }, { authorization: 'explicit-mail-sandbox-v1',
      fetcher: () => assert.fail('no request') }), error => error.code === 'MAIL_ACCEPTANCE_NOT_AUTHORIZED');
  });
}
test('missing private confirmation refuses before store creation or any provider operation', async () => {
  await assert.rejects(() => runMailAcceptance(config(), { fetcher: () => assert.fail('no request') }),
    error => error.code === 'MAIL_ACCEPTANCE_NOT_AUTHORIZED');
});
test('actual payload path tests both content types and replays fixed receipts without duplicate sends', async () => {
  const state = store(); const requests = [];
  const options = { authorization: 'explicit-mail-sandbox-v1', store: state, fetcher: async (url, init) => {
    requests.push({ url, init }); const value = JSON.parse(init.body);
    assert.equal(url, 'https://api.sendgrid.com/v3/mail/send'); assert.equal(init.redirect, 'error');
    assert.deepEqual(value.personalizations, [{ to: [{ email: 'acceptance@example.invalid' }] }]);
    assert.equal(value.mail_settings.sandbox_mode.enable, true); assert.equal(value.from.email, 'sender@example.test');
    assert.equal(value.from.name, 'PennSync by CareMetric');
    return new Response(null, { status: 200 });
  } };
  const report = await runMailAcceptance(config(), options);
  assert.equal(report.passed, true); assert.equal(report.actualDelivery, false); assert.equal(report.trafficCutover, false);
  assert.deepEqual(report.counts, { sandboxRequests: 2, stateRequests: 0, modelRequests: 0, base44Requests: 0, deliveries: 0 });
  assert.equal(JSON.parse(requests[1].init.body).content[0].value, MAIL_FIXTURE.body);
  const replay = await runMailAcceptance(config(), options);
  assert.equal(replay.passed, true); assert.equal(replay.counts.sandboxRequests, 0); assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(report).includes('sender@example.test'), false);
  assert.equal(JSON.stringify(report).includes(MAIL_FIXTURE.body), false);
});
test('a production acceptance status is not mistaken for sandbox success', async () => {
  const state = store();
  await assert.rejects(() => runMailAcceptance(config(), { authorization: 'explicit-mail-sandbox-v1', store: state,
    fetcher: async () => new Response(null, { status: 202 }) }), error => error.code === 'MAIL_SANDBOX_NOT_VALIDATED');
  assert.equal([...state.rows.values()][0].state, 'uncertain');
});
test('normal HTTP server has no route or import for the operator mail procedure', () => {
  for (const file of ['server.mjs', 'app.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /operator-mail-acceptance|runMailAcceptance|INTEGRATIONS_MAIL_ACCEPTANCE/);
  }
});
test('CLI requires exact flag and redacts failures instead of printing credentials', async () => {
  const reports = [];
  assert.equal(await main([], {}, value => reports.push(value)), 2);
  assert.equal(await main(['--execute-mail-sandbox-v1'], {}, value => reports.push(value)), 1);
  assert.equal(reports.at(-1).code, 'MAIL_ACCEPTANCE_NOT_AUTHORIZED');
  assert.equal(reports.at(-1).actualDelivery, false);
});
