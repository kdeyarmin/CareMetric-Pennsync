import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

/**
 * Load a temporary function module. Existing authorization regression tests
 * explicitly exercise dormant code by flipping only the static pause literal;
 * the raw-entry checkpoint test below never performs that rewrite.
 */
async function loadHandler(functionName, client, superAdminEmail = '', {
  exerciseDormantAuthorization = true,
} = {}) {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  if (exerciseDormantAuthorization) {
    const activeSource = source.replace(
      'const SECURE_MESSAGE_DOMAIN_PAUSED = true;',
      'const SECURE_MESSAGE_DOMAIN_PAUSED = false;',
    );
    assert.notEqual(
      activeSource,
      source,
      `${functionName} must retain the literal secure-message pause checkpoint`,
    );
    source = activeSource;
  }
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    `const createClientFromRequest = (...args) => {
      globalThis.__messageBrokerClientCalls.push(args);
      return globalThis.__messageBrokerClient;
    };`,
  );
  const output = transpileTs(source).outputText;
  const temporaryModule = join(
    tmpdir(),
    `message_broker_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, output);
  let handler;
  globalThis.__messageBrokerClient = client;
  const clientCalls = [];
  globalThis.__messageBrokerClientCalls = clientCalls;
  globalThis.Deno = {
    env: { get: (name) => name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined },
    serve: (candidate) => { handler = candidate; },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  handler.__clientCalls = clientCalls;
  return handler;
}

const request = (body) => ({ json: async () => body });

const MESSAGE_DOMAIN_FUNCTIONS = [
  'sendMessage',
  'markMessageRead',
  'summarizeMessageThread',
  'generateMessageSuggestions',
  'messagingAssistant',
  'notifyUrgentMessage',
];

async function productionBrowserSources(directory = new URL('../../src/', import.meta.url)) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) {
      sources.push(...await productionBrowserSources(entryUrl));
      continue;
    }
    if (!/\.(?:js|jsx|ts|tsx)$/.test(entry.name)
      || /(?:\.test|\.spec)\.(?:js|jsx|ts|tsx)$/.test(entry.name)) {
      continue;
    }
    sources.push({ path: entryUrl.pathname, source: await readFile(entryUrl, 'utf8') });
  }
  return sources;
}

test('raw secure-message entries pause before touching a poison request or client', async () => {
  const poisonRequest = new Proxy({}, {
    get(_target, property) {
      throw new Error(`paused handler touched request.${String(property)}`);
    },
  });

  for (const functionName of MESSAGE_DOMAIN_FUNCTIONS) {
    const handler = await loadHandler(functionName, null, '', {
      exerciseDormantAuthorization: false,
    });
    const response = await handler(poisonRequest);

    assert.equal(response.status, 503, functionName);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', functionName);
    assert.deepEqual(await response.json(), {
      error: 'Secure messaging is temporarily unavailable',
      code: 'secure_message_tenant_broker_required',
    }, functionName);
    assert.equal(handler.__clientCalls.length, 0, `${functionName} created an SDK client`);
  }
});

function makeClient({ user, users = [], patients = [], referrals = [], messages = [] }) {
  const state = {
    user,
    users: users.map((row) => ({ ...row })),
    patients: patients.map((row) => ({ ...row })),
    referrals: referrals.map((row) => ({ ...row })),
    messages: messages.map((row) => ({ ...row })),
    creates: [],
    updates: [],
  };
  const filter = (rows, query) => rows.filter((row) =>
    Object.entries(query).every(([key, value]) => row[key] === value));
  const entity = (key) => ({ filter: async (query) => filter(state[key], query) });
  const messageEntity = {
    filter: async (query) => filter(state.messages, query),
    create: async (record) => {
      state.creates.push(record);
      const created = { id: `message-${state.messages.length + 1}`, ...record };
      state.messages.push(created);
      return created;
    },
    updateMany: async (query, operations) => {
      state.updates.push({ query, operations });
      const matches = filter(state.messages, query);
      for (const row of matches) {
        for (const [field, value] of Object.entries(operations.$addToSet || {})) {
          const current = Array.isArray(row[field]) ? row[field] : [];
          if (!current.includes(value)) row[field] = [...current, value];
        }
        Object.assign(row, operations.$set || {});
      }
      return { success: true, updated: matches.length, has_more: false };
    },
  };
  const entities = {
    User: entity('users'),
    Patient: entity('patients'),
    Referral: entity('referrals'),
    Message: messageEntity,
  };
  return {
    client: { auth: { me: async () => state.user }, asServiceRole: { entities } },
    state,
  };
}

const sender = {
  email: 'sender@example.com',
  full_name: 'Real Sender',
  role: 'user',
  is_active: true,
};
const recipient = {
  email: 'recipient@example.com',
  role: 'user',
  is_active: true,
};
const authorizedPatient = {
  id: 'patient-1',
  created_by: sender.email,
  assigned_nurses: [sender.email, recipient.email],
};

test('sendMessage normalizes an anonymous hosted auth rejection before service-role access', async () => {
  const fixture = makeClient({ user: null });
  fixture.client.auth.me = async () => {
    throw new Error('not authenticated');
  };
  let serviceRoleTouched = false;
  Object.defineProperty(fixture.client, 'asServiceRole', {
    get() {
      serviceRoleTouched = true;
      throw new Error('must not access service role');
    },
  });
  const handler = await loadHandler('sendMessage', fixture.client);
  const response = await handler(request({}));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  assert.equal(serviceRoleTouched, false);
});

test('sendMessage derives identity and creates an immutable participant message', async () => {
  const { client, state } = makeClient({
    user: sender,
    users: [recipient],
    patients: [authorizedPatient],
  });
  const handler = await loadHandler('sendMessage', client);
  const response = await handler(request({
    recipients: [recipient.email, recipient.email],
    patient_id: authorizedPatient.id,
    subject: ' Care update ',
    message_text: ' Patient is stable. ',
    priority: 'high',
    sender_email: 'attacker@example.com',
    sender_name: 'Spoofed',
    read_by: ['attacker@example.com'],
    agency_id: 'forged-agency',
  }));
  const created = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.creates.length, 1);
  assert.equal(created.sender_email, sender.email);
  assert.equal(created.sender_name, sender.full_name);
  assert.equal(created.created_by, sender.email);
  assert.deepEqual(created.recipients, [recipient.email]);
  assert.deepEqual(created.read_by, [sender.email]);
  assert.equal(created.subject, 'Care update');
  assert.equal(created.message_text, 'Patient is stable.');
  assert.equal(created.is_read, false);
  assert.equal(Object.hasOwn(created, 'agency_id'), false);
});

test('forged account and agency claims cannot authorize a context-free recipient', async () => {
  const forged = {
    ...sender,
    role: 'admin',
    account_type: 'super_admin',
    agency_id: 'agency-1',
    agency_name: 'Agency One',
  };
  const sameClaim = { ...recipient, agency_id: 'agency-1', agency_name: 'Agency One' };
  const { client, state } = makeClient({ user: forged, users: [sameClaim] });
  const handler = await loadHandler('sendMessage', client, 'real-owner@example.com');
  const response = await handler(request({
    recipients: [recipient.email],
    message_text: 'Must not cross the boundary',
  }));

  assert.equal(response.status, 403);
  assert.equal(state.creates.length, 0);
  assert.deepEqual(await response.json(), { error: 'One or more recipients are unavailable' });
});

test('only the configured protected superadmin can send without a linked context', async () => {
  const owner = { ...sender, role: 'admin', email: 'owner@example.com' };
  const { client, state } = makeClient({ user: owner, users: [recipient] });
  const handler = await loadHandler('sendMessage', client, owner.email.toUpperCase());
  const response = await handler(request({
    recipients: [recipient.email],
    message_text: 'Platform message',
  }));

  assert.equal(response.status, 200);
  assert.equal(state.creates.length, 1);
});

test('forged agency fields cannot grant patient access', async () => {
  const forged = {
    ...sender,
    role: 'admin',
    agency_id: 'agency-1',
    agency_name: 'Agency One',
  };
  const patient = {
    id: 'foreign-patient',
    agency_id: 'agency-1',
    agency_name: 'Agency One',
    created_by: 'owner@example.com',
    assigned_nurses: [recipient.email],
  };
  const { client, state } = makeClient({ user: forged, users: [recipient], patients: [patient] });
  const handler = await loadHandler('sendMessage', client, 'real-owner@example.com');
  const response = await handler(request({
    recipients: [recipient.email],
    patient_id: patient.id,
    message_text: 'Foreign chart content',
  }));

  assert.equal(response.status, 403);
  assert.equal(state.creates.length, 0);
});

test('resource authorization rechecks exact IDs when backend filters return the wrong row', async () => {
  const cases = [
    {
      entity: 'Patient',
      returned: { ...authorizedPatient, id: 'wrong-patient' },
      payload: { patient_id: 'requested-patient' },
      expectedError: 'Patient not found',
    },
    {
      entity: 'Referral',
      returned: { id: 'wrong-referral', created_by: sender.email, assigned_to: recipient.email },
      payload: { related_event_type: 'referral', related_event_id: 'requested-referral' },
      expectedError: 'Referral not found',
    },
  ];

  for (const item of cases) {
    const fixture = makeClient({ user: sender, users: [recipient] });
    fixture.client.asServiceRole.entities[item.entity].filter = async () => [item.returned];
    const handler = await loadHandler('sendMessage', fixture.client);
    const response = await handler(request({
      recipients: [recipient.email],
      message_text: 'Must not use the wrong row',
      ...item.payload,
    }));
    assert.equal(response.status, 404, item.entity);
    assert.deepEqual(await response.json(), { error: item.expectedError }, item.entity);
    assert.equal(fixture.state.creates.length, 0, item.entity);
  }
});

test('sendMessage accepts only attachment URLs derived from an authorized referral', async () => {
  const storedUrl = 'https://files.example.com/referral.pdf';
  const fixture = makeClient({
    user: sender,
    users: [recipient],
    patients: [authorizedPatient],
    referrals: [{
      id: 'referral-1',
      patient_id: authorizedPatient.id,
      created_by: sender.email,
      assigned_to: recipient.email,
      document_url: storedUrl,
    }],
  });
  const handler = await loadHandler('sendMessage', fixture.client);
  let response = await handler(request({
    recipients: [recipient.email],
    message_text: 'Attached referral',
    patient_id: authorizedPatient.id,
    related_event_type: 'referral',
    related_event_id: 'referral-1',
    attachments: [storedUrl],
  }));
  const created = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(created.attachments, [storedUrl]);

  response = await handler(request({
    recipients: [recipient.email],
    message_text: 'Wrong attachment',
    patient_id: authorizedPatient.id,
    related_event_type: 'referral',
    related_event_id: 'referral-1',
    attachments: ['https://files.example.com/foreign.pdf'],
  }));
  assert.equal(response.status, 400);
  assert.equal(fixture.state.creates.length, 1);
});

test('sendMessage blocks an unrelated caller from injecting into a thread', async () => {
  const fixture = makeClient({
    user: sender,
    users: [recipient],
    messages: [{
      id: 'thread-1',
      sender_email: 'other@example.com',
      recipients: [recipient.email],
      message_text: 'Existing private thread',
    }],
  });
  const handler = await loadHandler('sendMessage', fixture.client);
  const response = await handler(request({
    recipients: [recipient.email],
    message_text: 'Thread injection',
    thread_id: 'thread-1',
  }));

  assert.equal(response.status, 403);
  assert.equal(fixture.state.creates.length, 0);
});

test('thread authorization rechecks exact IDs when backend filters return unrelated rows', async () => {
  const fixture = makeClient({ user: sender, users: [recipient] });
  fixture.client.asServiceRole.entities.Message.filter = async () => [{
    id: 'other-root',
    thread_id: 'other-thread',
    sender_email: sender.email,
    recipients: [recipient.email],
  }];
  const handler = await loadHandler('sendMessage', fixture.client);
  const response = await handler(request({
    recipients: [recipient.email],
    message_text: 'Must not inherit unrelated participants',
    thread_id: 'requested-thread',
  }));

  assert.equal(response.status, 403);
  assert.equal(fixture.state.creates.length, 0);
});

test('markMessageRead confirms and reads back each update before reporting success', async () => {
  const other = { ...recipient, email: 'other@example.com' };
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email, other.email],
    read_by: [sender.email],
    is_read: false,
    message_text: 'Immutable content',
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const handler = await loadHandler('markMessageRead', fixture.client);
  let response = await handler(request({ id: message.id }));

  assert.equal(response.status, 200);
  assert.deepEqual(fixture.state.updates[0], {
    query: { id: message.id },
    operations: { $addToSet: { read_by: recipient.email } },
  });
  assert.deepEqual(fixture.state.messages[0].read_by, [sender.email, recipient.email]);
  assert.equal(fixture.state.messages[0].is_read, false);
  assert.equal(fixture.state.messages[0].message_text, 'Immutable content');

  fixture.state.user = other;
  response = await handler(request({ id: message.id }));
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.state.messages[0].read_by, [sender.email, recipient.email, other.email]);
  assert.equal(fixture.state.messages[0].is_read, true);
  assert.deepEqual(fixture.state.updates.at(-1), {
    query: { id: message.id },
    operations: { $set: { is_read: true } },
  });
});

test('markMessageRead returns an already-read retry without issuing a write', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email, 'other@example.com'],
    read_by: [sender.email, recipient.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), message);
  assert.equal(fixture.state.updates.length, 0);
});

test('markMessageRead reconciles an updated:0 read-state result from exact persisted state', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email, 'other@example.com'],
    read_by: [sender.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const entity = fixture.client.asServiceRole.entities.Message;
  entity.updateMany = async (query, operations) => {
    fixture.state.updates.push({ query, operations });
    fixture.state.messages[0].read_by.push(recipient.email);
    return { success: true, updated: 0, has_more: false };
  };
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).read_by, [sender.email, recipient.email]);
  assert.equal(fixture.state.updates.length, 1);
});

test('markMessageRead reconciles an updated:0 completion result after an already-read retry', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email],
    read_by: [sender.email, recipient.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const entity = fixture.client.asServiceRole.entities.Message;
  entity.updateMany = async (query, operations) => {
    fixture.state.updates.push({ query, operations });
    fixture.state.messages[0].is_read = true;
    return { success: true, updated: 0, has_more: false };
  };
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).is_read, true);
  assert.deepEqual(fixture.state.updates, [{
    query: { id: message.id },
    operations: { $set: { is_read: true } },
  }]);
});

test('markMessageRead fails closed on invalid or unreconciled updateMany outcomes', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email],
    read_by: [sender.email],
    is_read: false,
  };
  const outcomes = [
    null,
    { success: false, updated: 1, has_more: false },
    { success: true, updated: 0, has_more: false },
    { success: true, updated: 2, has_more: false },
    { success: true, updated: 1, has_more: true },
  ];

  for (const outcome of outcomes) {
    const fixture = makeClient({ user: recipient, messages: [message] });
    fixture.client.asServiceRole.entities.Message.updateMany = async () => outcome;
    const handler = await loadHandler('markMessageRead', fixture.client);
    const response = await handler(request({ id: message.id }));

    assert.equal(response.status, 500, JSON.stringify(outcome));
    assert.deepEqual(
      await response.json(),
      { error: 'Failed to mark message read' },
      JSON.stringify(outcome),
    );
    assert.deepEqual(fixture.state.messages[0].read_by, [sender.email], JSON.stringify(outcome));
    assert.equal(fixture.state.messages[0].is_read, false, JSON.stringify(outcome));
  }
});

test('markMessageRead rejects an updated:0 result with an ambiguous exact readback', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email, 'other@example.com'],
    read_by: [sender.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const entity = fixture.client.asServiceRole.entities.Message;
  const originalFilter = entity.filter;
  let reads = 0;
  entity.filter = async (...args) => {
    reads += 1;
    if (reads === 1) return originalFilter(...args);
    const persisted = { ...fixture.state.messages[0], read_by: [sender.email, recipient.email] };
    return [persisted, { ...persisted }];
  };
  entity.updateMany = async (query, operations) => {
    fixture.state.updates.push({ query, operations });
    return { success: true, updated: 0, has_more: false };
  };
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to mark message read' });
  assert.equal(fixture.state.updates.length, 1);
});

test('markMessageRead rejects a confirmed update without an exact persisted readback', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email, 'other@example.com'],
    read_by: [sender.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const entity = fixture.client.asServiceRole.entities.Message;
  const originalFilter = entity.filter;
  let reads = 0;
  entity.filter = async (...args) => {
    reads += 1;
    if (reads === 2) return [];
    return originalFilter(...args);
  };
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to mark message read' });
  assert.deepEqual(fixture.state.messages[0].read_by, [sender.email, recipient.email]);
});

test('markMessageRead rejects an exact result when the read-state write was not persisted', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email],
    read_by: [sender.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  fixture.client.asServiceRole.entities.Message.updateMany = async () => ({
    success: true,
    updated: 1,
    has_more: false,
  });
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to mark message read' });
  assert.deepEqual(fixture.state.messages[0].read_by, [sender.email]);
  assert.equal(fixture.state.messages[0].is_read, false);
});

test('markMessageRead reads back completion instead of synthesizing is_read success', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email],
    read_by: [sender.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const entity = fixture.client.asServiceRole.entities.Message;
  const originalUpdateMany = entity.updateMany;
  let writes = 0;
  entity.updateMany = async (query, operations) => {
    writes += 1;
    if (writes === 1) return originalUpdateMany(query, operations);
    fixture.state.updates.push({ query, operations });
    return { success: true, updated: 1, has_more: false };
  };
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to mark message read' });
  assert.deepEqual(fixture.state.messages[0].read_by, [sender.email, recipient.email]);
  assert.equal(fixture.state.messages[0].is_read, false);
  assert.equal(writes, 2);
});

test('markMessageRead authorizes before taking the already-read retry shortcut', async () => {
  const outsider = { ...sender, email: 'outsider@example.com' };
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email],
    read_by: [sender.email, outsider.email],
    is_read: false,
  };
  const fixture = makeClient({ user: outsider, messages: [message] });
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Forbidden' });
  assert.equal(fixture.state.updates.length, 0);
});

test('markMessageRead rejects authorization drift in the exact update readback', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email, 'other@example.com'],
    read_by: [sender.email],
    is_read: false,
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  const entity = fixture.client.asServiceRole.entities.Message;
  const originalFilter = entity.filter;
  let reads = 0;
  entity.filter = async (...args) => {
    reads += 1;
    if (reads === 1) return originalFilter(...args);
    return [{
      ...fixture.state.messages[0],
      sender_email: 'other-sender@example.com',
      recipients: ['other@example.com'],
    }];
  };
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to mark message read' });
});

test('markMessageRead accepts id only and rejects non-participants', async () => {
  const outsider = { ...sender, email: 'outsider@example.com' };
  const fixture = makeClient({
    user: outsider,
    messages: [{
      id: 'message-1',
      sender_email: sender.email,
      recipients: [recipient.email],
      read_by: [sender.email],
    }],
  });
  const handler = await loadHandler('markMessageRead', fixture.client);

  const extraField = await handler(request({ id: 'message-1', read_by: [outsider.email] }));
  assert.equal(extraField.status, 400);
  const forbidden = await handler(request({ id: 'message-1' }));
  assert.equal(forbidden.status, 403);
  assert.equal(fixture.state.updates.length, 0);
});

test('markMessageRead rejects an ambiguous initial exact-ID read before writing', async () => {
  const message = {
    id: 'message-1',
    sender_email: sender.email,
    recipients: [recipient.email],
    read_by: [sender.email],
  };
  const fixture = makeClient({ user: recipient, messages: [message] });
  fixture.client.asServiceRole.entities.Message.filter = async () => [message, { ...message }];
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: message.id }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to mark message read' });
  assert.equal(fixture.state.updates.length, 0);
});

test('markMessageRead rechecks the exact ID returned by the service filter', async () => {
  const fixture = makeClient({ user: recipient });
  fixture.client.asServiceRole.entities.Message.filter = async () => [{
    id: 'different-message',
    sender_email: sender.email,
    recipients: [recipient.email],
  }];
  const handler = await loadHandler('markMessageRead', fixture.client);
  const response = await handler(request({ id: 'requested-message' }));

  assert.equal(response.status, 404);
  assert.equal(fixture.state.updates.length, 0);
});

test('Message schema and all production browser source remain fail-closed', async () => {
  const schemaText = await readFile(new URL('../entities/Message.jsonc', import.meta.url), 'utf8');
  const schema = JSON5.parse(schemaText);
  assert.equal(schema.rls.read, false);
  assert.equal(schema.rls.create, false);
  assert.equal(schema.rls.update, false);
  assert.equal(schema.rls.delete, false);

  const brokerNames = MESSAGE_DOMAIN_FUNCTIONS.join('|');
  const forbidden = [
    /entities\s*(?:\?\.|\.)\s*Message\b/,
    /entities\s*(?:\?\.)?\s*\[\s*['"]Message['"]\s*\]/,
    /\{[^}\n]*\bMessage(?:\s*:\s*[$\w]+)?[^}\n]*\}\s*=\s*[^;\n]*\bentities\b/,
    /\{\s*entities\s*:\s*\{[^}\n]*\bMessage\b/,
    /\bMessage\s*(?:\?\.|\.)\s*(?:list|filter|get|create|update|delete|updateMany|deleteMany|bulkCreate)\s*\(/,
    new RegExp(`functions\\s*(?:\\?\\.|\\.)\\s*invoke\\s*\\(\\s*['"](?:${brokerNames})['"]`),
    new RegExp(`functions\\s*(?:\\?\\.|\\.)\\s*(?:${brokerNames})\\s*\\(`),
    new RegExp(`(?:from|import\\s*\\()\\s*['"][^'"]*(?:${brokerNames})[^'"]*['"]`),
  ];
  const violations = [];
  for (const { path, source } of await productionBrowserSources()) {
    for (const pattern of forbidden) {
      if (pattern.test(source)) violations.push(`${path}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, [], `Browser Message bypasses:\n${violations.join('\n')}`);
});
