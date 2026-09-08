import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

async function loadHandler(client, env = new Map()) {
  let source = await readFile(
    new URL('../functions/manageMyNotifications/entry.ts', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__notificationBrokerClient;',
  );
  const target = join(
    tmpdir(),
    `notification_broker_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(source).outputText);
  let handler;
  globalThis.__notificationBrokerClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => env.get(name) },
  };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
    delete globalThis.__notificationBrokerClient;
  }
  return handler;
}

const request = (body) => new Request('http://local/manageMyNotifications', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function runtime(overrides = {}) {
  const clone = (value) => structuredClone(value);
  const user = {
    id: 'user-a',
    email: 'recipient@example.test',
    role: 'user',
    is_active: true,
    is_verified: true,
    ...overrides.user,
  };
  const agency = { id: 'agency-a', status: 'active', ...overrides.agency };
  const membership = {
    id: 'membership-a',
    agency_id: 'agency-a',
    user_id: 'user-a',
    membership_key: 'agency-a:user-a',
    user_email_normalized: 'recipient@example.test',
    tenant_role: 'office_staff',
    status: 'active',
    version: 3,
    ...overrides.membership,
  };
  const notification = {
    id: 'notification-a',
    agency_id: 'agency-a',
    dedupe_key: 'referral-stale:agency-a:referral-a:1',
    recipient_user_id: 'user-a',
    recipient_membership_id: 'membership-a',
    recipient_membership_version: 3,
    authority_version: 1,
    authority_state: 'active',
    version: 1,
    user_email: 'recipient@example.test',
    title: 'Provider follow-up request unanswered',
    message: 'A provider information request has had no response for 4+ days.',
    type: 'info',
    priority: 'high',
    created_date: '2026-09-06T00:00:00.000Z',
    is_read: false,
    dismissed: false,
    action_url: '/ReferralFollowUp?id=referral-a',
    ...overrides.notification,
  };
  const state = {
    agencies: [agency],
    memberships: overrides.memberships || [membership],
    notifications: overrides.notifications || [notification],
    filters: [],
    updates: [],
    membershipReads: 0,
    notificationReads: 0,
  };
  const matches = (row, query) => Object.entries(query || {})
    .every(([key, value]) => row?.[key] === value);
  const filter = (entity, rows, query) => {
    state.filters.push({ entity, query: clone(query) });
    return clone(rows.filter((row) => matches(row, query)));
  };
  const client = {
    auth: { me: async () => clone(user) },
    asServiceRole: { entities: {
      Agency: {
        filter: async (query) => filter('Agency', state.agencies, query),
      },
      AgencyMembership: {
        filter: async (query) => {
          const rows = filter('AgencyMembership', state.memberships, query);
          state.membershipReads += 1;
          overrides.afterMembershipFilter?.(state, state.membershipReads);
          return rows;
        },
      },
      Notification: {
        filter: async (query) => {
          const rows = filter('Notification', state.notifications, query);
          state.notificationReads += 1;
          overrides.afterNotificationFilter?.(state, state.notificationReads);
          return rows;
        },
        updateMany: async (query, operations) => {
          state.updates.push({ query: clone(query), operations: clone(operations) });
          let updated = 0;
          for (const row of state.notifications) {
            if (!matches(row, query)) continue;
            if (operations.$set) Object.assign(row, clone(operations.$set));
            if (operations.$inc) {
              for (const [key, amount] of Object.entries(operations.$inc)) {
                row[key] = Number(row[key] || 0) + amount;
              }
            }
            updated += 1;
          }
          overrides.afterNotificationUpdate?.(state);
          return { success: true, updated, has_more: false };
        },
      },
    } },
  };
  return { client, state };
}

test('Notification denies direct browser CRUD and carries secure recipient authority fields', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/Notification.jsonc', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.rls, {
    read: false,
    create: false,
    update: false,
    delete: false,
  });
  for (const field of [
    'agency_id', 'recipient_user_id', 'recipient_membership_id',
    'recipient_membership_version', 'authority_version', 'authority_state',
    'version', 'dismissed_at',
  ]) assert.ok(schema.properties[field], field);
  assert.deepEqual(schema.properties.authority_state.enum, ['active', 'invalidated']);
  assert.equal(schema.properties.authority_state.default, 'active');
});

test('browser Notification access is broker-only and the center is tenant-bound', async () => {
  const violations = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await walk(url);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
        const source = await readFile(url, 'utf8');
        if (/base44\.entities\.Notification\b/.test(source)) violations.push(url.pathname);
      }
    }
  }
  await walk(new URL('../../src/', import.meta.url));
  assert.deepEqual(violations, []);
  const layout = await readFile(new URL('../../src/components/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /<NotificationCenter[\s\S]*agencyId=\{tenantContext\.agency_id\}/);
  assert.match(layout, /const notificationsAvailable = Boolean\([\s\S]*tenantContext\?\.membership_id[\s\S]*tenantContext\?\.is_platform_owner === false/);
  assert.match(layout, /disabled=\{!notificationsAvailable\}/);
  assert.match(layout, /notificationCenterOpen && notificationsAvailable/);
});

test('membership-free protected platform owner has no Notification entity access', async () => {
  const { client, state } = runtime({
    user: { role: 'admin' },
    memberships: [],
  });
  const handler = await loadHandler(
    client,
    new Map([['SUPER_ADMIN_EMAIL', 'recipient@example.test']]),
  );
  const response = await handler(request({ action: 'list', agency_id: 'agency-a' }));
  assert.equal(response.status, 403);
  assert.equal(state.filters.some(({ entity }) => entity === 'Notification'), false);
  assert.equal(state.updates.length, 0);
});

test('every authority-v1 Notification producer explicitly stamps active state', async () => {
  const producers = [
    'createNotification',
    'checkStaleFollowUpRequests',
    'handleTelnyxStatusWebhook',
    'pollFaxStatuses',
    'processInboundFaxes',
    'submitFollowUpResponse',
  ];
  for (const producer of producers) {
    const source = await readFile(
      new URL(`../functions/${producer}/entry.ts`, import.meta.url),
      'utf8',
    );
    assert.match(
      source,
      /recipient_membership_version:[^\n]+\n\s*authority_version: 1,\n\s*authority_state: 'active',/,
      producer,
    );
    if (producer !== 'createNotification') {
      assert.match(source, /row\??\.authority_state ===/, `${producer} reconciliation`);
    }
  }
});

test('recipient list is tenant/user/membership-bound and returns no workflow state', async () => {
  const { client, state } = runtime();
  const handler = await loadHandler(client);
  const response = await handler(request({ action: 'list', agency_id: 'agency-a' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.complete, true);
  assert.equal(body.notifications.length, 1);
  assert.equal(body.notifications[0].id, 'notification-a');
  assert.equal(body.notifications[0].version, 1);
  assert.equal(Object.hasOwn(body.notifications[0], 'dedupe_key'), false);
  assert.equal(Object.hasOwn(body.notifications[0], 'recipient_user_id'), false);
  assert.ok(state.filters.some(({ entity, query }) => entity === 'Notification'
    && query.agency_id === 'agency-a'
    && query.recipient_user_id === 'user-a'
    && query.recipient_membership_id === 'membership-a'
    && query.recipient_membership_version === 3
    && query.user_email === 'recipient@example.test'
    && query.authority_version === 1
    && query.authority_state === 'active'
    && query.dismissed === false));
});

test('recipient list remains bounded and reports when additional rows exist', async () => {
  const notifications = Array.from({ length: 101 }, (_, index) => ({
    ...runtime().state.notifications[0],
    id: `notification-${index}`,
  }));
  const { client } = runtime({ notifications });
  const handler = await loadHandler(client);
  const response = await handler(request({ action: 'list', agency_id: 'agency-a' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.notifications.length, 100);
  assert.equal(body.complete, false);
});

test('foreign tenant access is rejected before any Notification read or mutation', async () => {
  const { client, state } = runtime();
  const handler = await loadHandler(client);
  const response = await handler(request({ action: 'list', agency_id: 'agency-b' }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(state.filters.some(({ entity }) => entity === 'Notification'), false);
  assert.equal(state.updates.length, 0);
});

test('recipient list excludes stale membership revisions individually', async () => {
  const stale = runtime().state.notifications[0];
  const current = {
    ...stale,
    id: 'notification-current',
    recipient_membership_version: 4,
  };
  const { client, state } = runtime({
    membership: { version: 4 },
    notifications: [stale, current],
  });
  const handler = await loadHandler(client);
  const response = await handler(request({ action: 'list', agency_id: 'agency-a' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.notifications.map((row) => row.id), ['notification-current']);
  assert.ok(state.filters.some(({ entity, query }) => entity === 'Notification'
    && query.recipient_membership_id === 'membership-a'
    && query.recipient_membership_version === 4));
  assert.equal(state.updates.length, 0);
});

test('recipient list excludes invalidated authority rows individually', async () => {
  const active = runtime().state.notifications[0];
  const invalidated = {
    ...active,
    id: 'notification-invalidated',
    authority_state: 'invalidated',
  };
  const { client } = runtime({ notifications: [invalidated, active] });
  const handler = await loadHandler(client);
  const response = await handler(request({ action: 'list', agency_id: 'agency-a' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.notifications.map((row) => row.id), ['notification-a']);
});

test('list revalidates authority before projecting queried rows', async () => {
  const { client, state } = runtime({
    afterNotificationFilter: (currentState, readCount) => {
      if (readCount === 1) currentState.memberships[0].version = 4;
    },
  });
  const handler = await loadHandler(client);
  const response = await handler(request({ action: 'list', agency_id: 'agency-a' }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Notification recipient authority changed');
  assert.equal(state.updates.length, 0);
});

test('list revalidates authority after projecting queried rows', async () => {
  const { client, state } = runtime({
    afterMembershipFilter: (currentState, readCount) => {
      if (readCount === 3) currentState.memberships[0].version = 4;
    },
  });
  const handler = await loadHandler(client);
  const response = await handler(request({ action: 'list', agency_id: 'agency-a' }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Notification recipient authority changed');
  assert.equal(state.membershipReads, 4);
  assert.equal(state.updates.length, 0);
});

test('mark_read conditionally changes only recipient state and preserves workflow fields', async () => {
  const { client, state } = runtime();
  const before = structuredClone(state.notifications[0]);
  const handler = await loadHandler(client);
  const response = await handler(request({
    action: 'mark_read',
    agency_id: 'agency-a',
    notification_id: 'notification-a',
    expected_version: 1,
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.notification.is_read, true);
  assert.equal(body.notification.version, 2);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].query.recipient_membership_id, 'membership-a');
  assert.equal(state.updates[0].query.recipient_membership_version, 3);
  assert.equal(state.updates[0].query.authority_state, 'active');
  assert.deepEqual(state.updates[0].operations.$inc, { version: 1 });
  assert.deepEqual(Object.keys(state.updates[0].operations.$set).sort(), ['is_read', 'read_at']);
  for (const key of [
    'agency_id', 'dedupe_key', 'recipient_user_id', 'recipient_membership_id',
    'recipient_membership_version', 'authority_version', 'authority_state',
    'user_email', 'title',
    'message', 'type', 'priority', 'action_url',
  ]) assert.deepEqual(state.notifications[0][key], before[key], key);
});

test('dismiss is a conditional soft transition and never deletes workflow evidence', async () => {
  const { client, state } = runtime();
  const handler = await loadHandler(client);
  const response = await handler(request({
    action: 'dismiss',
    agency_id: 'agency-a',
    notification_id: 'notification-a',
    expected_version: 1,
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.notification.dismissed, true);
  assert.equal(body.notification.is_read, true);
  assert.equal(body.notification.version, 2);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.updates.length, 1);
  assert.deepEqual(
    Object.keys(state.updates[0].operations.$set).sort(),
    ['dismissed', 'dismissed_at', 'is_read', 'read_at'],
  );
});

test('stale or forged mutation versions cannot overwrite recipient state', async () => {
  const { client, state } = runtime({ notification: { version: 2 } });
  const handler = await loadHandler(client);
  const response = await handler(request({
    action: 'mark_read',
    agency_id: 'agency-a',
    notification_id: 'notification-a',
    expected_version: 1,
  }));
  assert.equal(response.status, 409);
  assert.equal(state.updates.length, 0);
});

test('mutation revalidates changed authority immediately before update', async () => {
  const { client, state } = runtime({
    afterNotificationFilter: (currentState, readCount) => {
      if (readCount === 1) currentState.memberships[0].status = 'revoked';
    },
  });
  const handler = await loadHandler(client);
  const response = await handler(request({
    action: 'mark_read',
    agency_id: 'agency-a',
    notification_id: 'notification-a',
    expected_version: 1,
  }));
  assert.equal(response.status, 403);
  assert.equal(state.updates.length, 0);
  assert.equal(state.notifications[0].is_read, false);
});

test('mutation revalidates authority immediately after update', async () => {
  const { client, state } = runtime({
    afterNotificationUpdate: (currentState) => {
      currentState.memberships[0].status = 'revoked';
    },
  });
  const handler = await loadHandler(client);
  const response = await handler(request({
    action: 'mark_read',
    agency_id: 'agency-a',
    notification_id: 'notification-a',
    expected_version: 1,
  }));
  assert.equal(response.status, 403);
  assert.equal(state.updates.length, 1);
  assert.equal(state.notifications[0].is_read, true);
  assert.equal(state.notifications[0].version, 2);
});
