import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMailPayload, emailAddress, validateMailParams } from './mail-contract.mjs';
import { createProviders, validateParams } from './providers.mjs';
import { createHandler } from './app.mjs';
import { loadConfig } from './runtime.mjs';

const params = { to: 'synthetic@example.test', subject: 'Synthetic status', body: 'Approved <not an HTML choice>' };
const html = '<!doctype html><html><body><table role="presentation"><tr><td style="color:#213a76">A &amp; B</td></tr></table><a href="https://app.caremetricai.com/privacy">Open PennSync</a></body></html>';
const config = { sendgridKey: 'synthetic-key', fromEmail: 'sender@example.test' };
const output = (values = params, options) => buildMailPayload(values, config.fromEmail, options);

test('legacy plain-text requests keep the exact original provider representation', () => {
  assert.deepEqual(output(), {
    personalizations: [{ to: [{ email: params.to }] }], from: { email: config.fromEmail },
    subject: params.subject, content: [{ type: 'text/plain', value: params.body }],
    tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
  });
  assert.equal(output({ ...params, body: html }).content[0].type, 'text/plain');
});
test('explicit rich email preserves template markup, URLs, UTF-8 and sender display name', () => {
  const values = { ...params, body: html + '<p>José — review № 2</p>', content_type: 'text/html', from_name: 'PennSync by CareMetric' };
  const before = JSON.stringify(values); const result = output(values);
  assert.equal(result.content[0].type, 'text/html'); assert.equal(result.content[0].value, values.body);
  assert.deepEqual(result.from, { email: config.fromEmail, name: values.from_name });
  assert.equal(JSON.stringify(values), before);
  assert.equal(Object.hasOwn(result, 'mail_settings'), false);
});
test('multiple recipients remain individually bounded and normalized', () => {
  assert.deepEqual(output({ ...params, to: [' first@example.test ', 'second@example.test'] }).personalizations[0].to,
    [{ email: 'first@example.test' }, { email: 'second@example.test' }]);
  assert.equal(emailAddress(' Person@example.test '), 'Person@example.test');
});
for (const [name, patch] of Object.entries({ unknownType: { content_type: 'application/xml' }, undefinedType: { content_type: undefined },
  nullType: { content_type: null }, headerType: { content_type: 'text/html\r\nX: bad' }, missingBody: { body: '' },
  nullName: { from_name: null }, emptyName: { from_name: '' }, paddedName: { from_name: ' fake ' },
  headerName: { from_name: 'PennSync\nBcc: other@example.test' }, tabs: { from_name: 'Penn\tSync' },
  longName: { from_name: 'a'.repeat(101) }, headerSubject: { subject: 'approved\r\nBcc: another' },
  noRecipients: { to: [] }, tooMany: { to: Array(11).fill(params.to) }, badRecipient: { to: 'Name <who@example.test>' },
  externalFrom: { from: 'unapproved@example.test' }, attachments: { attachments: [] },
  disableTrackingProtection: { tracking_settings: {} }, forceSandbox: { mail_settings: { sandbox_mode: { enable: true } } } })) {
  test(`unsupported or forged ${name} is rejected before any provider call`, async () => {
    let calls = 0; const provide = createProviders(config, {}, () => { calls++; assert.fail('unexpected provider call'); });
    assert.throws(() => validateMailParams({ ...params, ...patch }));
    await assert.rejects(() => provide('SendEmail', { ...params, ...patch }, {}));
    assert.equal(calls, 0);
  });
}
for (const body of ['x'.repeat(100001), 'binary\0payload']) {
  test('email body remains bounded and control-character checked', () => assert.throws(() => output({ ...params, body })));
}
test('production provider submits the exact HTML payload and reports acceptance, not delivery', async () => {
  const value = { ...params, body: html, content_type: 'text/html', from_name: 'PennSync by CareMetric' };
  let calls = 0;
  const provide = createProviders(config, {}, async (url, options) => {
    calls++; assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), output(value));
    assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
    return new Response(null, { status: 202 });
  });
  assert.deepEqual(await provide('SendEmail', value, {}), { accepted: true, delivered: false, provider: 'sendgrid' });
  assert.equal(calls, 1);
});
for (const status of [200, 400, 401, 429, 500]) {
  test(`non-production acceptance status ${status} never claims sent or delivered`, async () => {
    const provide = createProviders(config, {}, async () => new Response('secret provider diagnostic', { status }));
    await assert.rejects(() => provide('SendEmail', { ...params, content_type: 'text/html' }, {}),
      error => error.code === 'EMAIL_NOT_ACCEPTED' && !error.message.includes('secret'));
  });
}
test('the operator sandbox uses the identical builder with exactly one added sandbox field', () => {
  for (const content_type of ['text/plain', 'text/html']) {
    const value = { ...params, content_type, from_name: 'PennSync by CareMetric' };
    const production = output(value); const sandbox = output(value, { sandbox: true });
    assert.deepEqual(sandbox.mail_settings, { sandbox_mode: { enable: true } });
    delete sandbox.mail_settings; assert.deepEqual(sandbox, production);
  }
  assert.throws(() => output(params, { sandbox: 'false' }));
});
test('HTML support does not bypass runtime release or existing sender-role requirements', async () => {
  const complete = { ...loadConfig({ INTEGRATIONS_ALLOWED_OPERATIONS: 'SendEmail',
    INTEGRATIONS_RELEASE: 'enabled-v1', SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic', INTEGRATIONS_HASH_KEY: '1'.repeat(64), INTEGRATIONS_ENCRYPTION_KEY: '2'.repeat(64),
    SENDGRID_API_KEY: 'synthetic', NOTIFICATION_FROM_EMAIL: config.fromEmail }), ...config };
  const request = () => new Request('https://runtime.invalid/v1/integrations', { method: 'POST',
    headers: { authorization: 'Bearer synthetic-session-token-value', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', request_id: 'mail-request', operation: 'SendEmail', params: { ...params, content_type: 'text/html', body: html } }) });
  let writes = 0, sends = 0;
  const dependencies = { authority: async () => ({ subject: 'a'.repeat(64), snapshot: 'staff', canEmail: false }),
    store: { reserve() { writes++; assert.fail('must not reserve'); } }, provider: () => { sends++; assert.fail('must not send'); } };
  const denied = await createHandler(complete, dependencies)(request());
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'EMAIL_ROLE_REQUIRED');
  const paused = await createHandler({ ...complete, released: false }, dependencies)(request());
  assert.equal(paused.status, 503); assert.equal(writes, 0); assert.equal(sends, 0);
});
test('server rejects a caller-supplied sender address even with a display name', () => {
  const value = { ...params, from_name: 'PennSync by CareMetric', from_email: 'forged@example.test' };
  assert.throws(() => validateParams('SendEmail', value, config));
});
