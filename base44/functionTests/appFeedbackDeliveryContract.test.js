import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// submitAppFeedback replaced a browser Core.SendEmail with a hard-coded
// recipient. These cases pin what moved to the server: the caller cannot pick
// the recipient, the shared outbound release gate decides whether anything is
// sent, and only signed-in staff (built-in admin or one active membership) may
// send at all.

const ENTRY_URL = new URL('../functions/submitAppFeedback/entry.ts', import.meta.url);

async function loadHandler(env) {
  let source = await readFile(ENTRY_URL, 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__feedbackMakeClient;',
  );
  const js = transpileTs(source).outputText;
  const tempPath = join(tmpdir(), `app-feedback-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(tempPath, js);
  let handler;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: (key) => env[key] } };
  try {
    await import(`${pathToFileURL(tempPath).href}?v=${Date.now()}`);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return handler;
}

function makeClient({ user, memberships = [], agencies = [] }) {
  const sent = [];
  const entities = {
    AgencyMembership: { filter: async () => memberships },
    Agency: { filter: async () => agencies },
  };
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities,
      integrations: { Core: { SendEmail: async (payload) => { sent.push(payload); return { ok: true }; } } },
    },
  };
  return { client, sent };
}

const NURSE = {
  id: 'user-1', email: 'nurse@example.test', role: 'user', full_name: 'Nora Nurse',
  is_active: true, disabled: false, is_service: false,
};
const MEMBERSHIP = {
  id: 'm-1', agency_id: 'agency-1', user_id: 'user-1', membership_key: 'agency-1:user-1',
  user_email_normalized: 'nurse@example.test', tenant_role: 'clinician', status: 'active', version: 1,
  created_by_user_id: 'admin-1', last_transition_by_user_id: 'admin-1',
  last_transition_by_email_normalized: 'admin@example.test', last_transition_at: '2026-09-01T00:00:00.000Z',
  last_transition_reason: 'Activated', activated_at: '2026-09-01T00:00:00.000Z',
  revoked_at: null, revocation_reason: null,
};
const AGENCY = { id: 'agency-1', agency_name: 'Penn Home Health', status: 'active' };
const RELEASED = {
  OUTBOUND_DELIVERY_RELEASE: 'enabled-v1',
  FEEDBACK_RECIPIENT_EMAIL: 'owner-feedback@example.test',
  SUPER_ADMIN_EMAIL: 'owner@example.test',
};

const post = (body) => new Request('https://app/functions/submitAppFeedback', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('submitAppFeedback sends to the configured owner, never to a caller-chosen address', async () => {
  const { client, sent } = makeClient({ user: NURSE, memberships: [MEMBERSHIP], agencies: [AGENCY] });
  globalThis.__feedbackMakeClient = () => client;
  const handler = await loadHandler(RELEASED);

  const smuggled = await handler(post({ feedback: 'hello', to: 'attacker@example.test' }));
  assert.equal(smuggled.status, 400, 'an extra field such as a recipient is refused');
  assert.equal(sent.length, 0);

  const response = await handler(post({ subject: 'Idea\r\nBcc: x@example.test', feedback: 'Please add dark mode.' }));
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner-feedback@example.test');
  assert.doesNotMatch(sent[0].subject, /[\r\n]/, 'a newline cannot reach the subject');
  assert.match(sent[0].body, /Please add dark mode\./);
  assert.match(sent[0].body, /nurse@example\.test/);
});

test('submitAppFeedback falls back to SUPER_ADMIN_EMAIL and refuses when no recipient is configured', async () => {
  const { client, sent } = makeClient({ user: NURSE, memberships: [MEMBERSHIP], agencies: [AGENCY] });
  globalThis.__feedbackMakeClient = () => client;
  const fallback = await loadHandler({ OUTBOUND_DELIVERY_RELEASE: 'enabled-v1', SUPER_ADMIN_EMAIL: 'Owner@Example.test ' });
  assert.equal((await fallback(post({ feedback: 'x' }))).status, 200);
  assert.equal(sent.at(-1).to, 'owner@example.test');

  const unconfigured = await loadHandler({ OUTBOUND_DELIVERY_RELEASE: 'enabled-v1' });
  const refused = await unconfigured(post({ feedback: 'x' }));
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).code, 'FEEDBACK_RECIPIENT_NOT_CONFIGURED');
  assert.equal(sent.length, 1);
});

test('submitAppFeedback sends nothing until outbound delivery is released', async () => {
  const { client, sent } = makeClient({ user: NURSE, memberships: [MEMBERSHIP], agencies: [AGENCY] });
  globalThis.__feedbackMakeClient = () => client;
  const handler = await loadHandler({ FEEDBACK_RECIPIENT_EMAIL: 'owner@example.test' });
  const response = await handler(post({ feedback: 'x' }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
  assert.equal(sent.length, 0);
});

test('submitAppFeedback admits only signed-in staff', async () => {
  const anonymous = makeClient({ user: null });
  globalThis.__feedbackMakeClient = () => anonymous.client;
  let handler = await loadHandler(RELEASED);
  assert.equal((await handler(post({ feedback: 'x' }))).status, 401);

  const noMembership = makeClient({ user: NURSE, memberships: [], agencies: [] });
  globalThis.__feedbackMakeClient = () => noMembership.client;
  handler = await loadHandler(RELEASED);
  assert.equal((await handler(post({ feedback: 'x' }))).status, 403);

  const deactivated = makeClient({ user: { ...NURSE, is_active: false }, memberships: [MEMBERSHIP], agencies: [AGENCY] });
  globalThis.__feedbackMakeClient = () => deactivated.client;
  handler = await loadHandler(RELEASED);
  assert.equal((await handler(post({ feedback: 'x' }))).status, 403);

  const getRequest = await handler(new Request('https://app/functions/submitAppFeedback'));
  assert.equal(getRequest.status, 405);
  for (const client of [anonymous, noMembership, deactivated]) assert.equal(client.sent.length, 0);
});

test('submitAppFeedback bounds the message and refuses an empty one', async () => {
  const { client, sent } = makeClient({ user: NURSE, memberships: [MEMBERSHIP], agencies: [AGENCY] });
  globalThis.__feedbackMakeClient = () => client;
  const handler = await loadHandler(RELEASED);
  assert.equal((await handler(post({ feedback: '   ' }))).status, 400);
  assert.equal((await handler(post({ feedback: 'x'.repeat(5001) }))).status, 400);
  assert.equal((await handler(post({ feedback: 'x', subject: 's'.repeat(201) }))).status, 400);
  assert.equal(sent.length, 0);
});
