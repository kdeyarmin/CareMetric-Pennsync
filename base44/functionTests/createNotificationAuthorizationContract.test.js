import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const source = await readFile(
  new URL('../functions/createNotification/entry.ts', import.meta.url),
  'utf8',
);

async function loadHandler(client, env = new Map()) {
  const executable = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__createNotificationClient;',
  );
  const target = join(
    tmpdir(),
    `create_notification_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(target, transpileTs(executable).outputText);
  let handler;
  globalThis.__createNotificationClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => env.get(name) },
  };
  try {
    await import(`${pathToFileURL(target).href}?case=${Math.random()}`);
  } finally {
    await unlink(target).catch(() => {});
    delete globalThis.__createNotificationClient;
  }
  return handler;
}

function runtime(overrides = {}) {
  const clone = (value) => structuredClone(value);
  const state = {
    user: {
      id: 'user-a',
      email: 'recipient@example.test',
      role: 'user',
      is_active: true,
      ...overrides.user,
    },
    agency: {
      id: 'agency-a',
      agency_code: 'AGENCY_A',
      status: 'active',
    },
    membership: {
      id: 'membership-a',
      agency_id: 'agency-a',
      user_id: 'user-a',
      user_email_normalized: 'recipient@example.test',
      membership_key: 'agency-a:user-a',
      tenant_role: 'office_staff',
      status: 'active',
      version: 3,
      ...overrides.membership,
    },
    creates: [],
    emails: [],
    preferencesRead: false,
  };
  const client = {
    auth: { me: async () => clone(state.user) },
    asServiceRole: {
      entities: {
        User: {
          filter: async ({ email }) => email === state.user.email ? [clone(state.user)] : [],
        },
        AgencyMembership: {
          filter: async (query) => query.user_id === state.membership.user_id
            && query.status === 'active'
            && state.membership.status === 'active'
            ? [clone(state.membership)]
            : [],
        },
        Agency: {
          filter: async ({ id }) => id === state.agency.id ? [clone(state.agency)] : [],
        },
        NotificationPreference: {
          filter: async () => {
            if (!state.preferencesRead) {
              state.preferencesRead = true;
              overrides.afterPreferencesRead?.(state);
            }
            return [];
          },
        },
        AgencySettings: {
          filter: async ({ agency_code }) => agency_code === state.agency.agency_code
            ? [{ agency_code, business_hours_timezone: 'America/New_York' }]
            : [],
          list: async () => [],
        },
        Visit: { filter: async () => [] },
        Notification: {
          create: async (payload) => {
            state.creates.push(clone(payload));
            return { id: 'notification-a', ...clone(payload) };
          },
        },
      },
      integrations: {
        Core: {
          SendEmail: async (payload) => {
            state.emails.push(clone(payload));
            return { success: true };
          },
        },
      },
    },
  };
  return { client, state };
}

const request = () => new Request('http://local/createNotification', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    agency_id: 'agency-a',
    user_email: 'recipient@example.test',
    title: 'A current notification',
    message: 'The recipient has a current tenant membership.',
    type: 'info',
  }),
});

test('notification creation never authorizes from mutable custom User claims', () => {
  assert.doesNotMatch(source, /currentUser\.(?:account_type|agency_name)/);
  assert.doesNotMatch(source, /recipient\.(?:account_type|agency_name)/);
  assert.match(source, /AgencyMembership\.filter\(\{ user_id: user\.id, status: 'active' \}/);
  assert.match(source, /membership_key !== `\$\{agencyId\}:\$\{user\.id\}`/);
  assert.match(source, /ACTIVE_AGENCY_STATUSES\.has/);
});

test('notification links reject browser-normalized external-path escapes', () => {
  assert.match(source, /value\.startsWith\('\/\/'\)/);
  assert.match(source, /value\.includes\('\\\\'\)/);
  assert.match(source, /\[\\u0000-\\u001f\\u007f\]/);
});

test('created inbox rows carry exact tenant and recipient authority', () => {
  for (const field of [
    'agency_id: inAppScope.recipientMembership.agencyId',
    'recipient_user_id: recipient.id',
    'recipient_membership_id: inAppScope.recipientMembership.id',
    'recipient_membership_version: inAppScope.recipientMembership.version',
    'authority_version: 1',
    "authority_state: 'active'",
    'version: 1',
  ]) assert.ok(source.includes(field), `missing secure notification field: ${field}`);
  assert.match(source, /agency_id: scope\.recipientMembership\.agencyId,[\s\S]*created_by: recipient\.email/);
});

test('notification delivery revalidates exact membership authority at each side effect', () => {
  assert.match(source, /function sameMembershipSnapshot\([\s\S]*left\.id === right\.id[\s\S]*left\.version === right\.version/);
  assert.match(source, /function sameUserSnapshot\([\s\S]*left\.id === right\.id[\s\S]*left\.email === right\.email[\s\S]*left\.role === right\.role/);
  assert.match(source, /async function revalidateResolvedScope\([\s\S]*loadExactUser\(entities, caller\.email\)[\s\S]*loadExactUser\(entities, recipient\.email\)[\s\S]*await resolveScope\([\s\S]*Notification authority changed; retry/);
  assert.match(source, /if \(shouldCreateInApp\) \{[\s\S]*await revalidateResolvedScope\([\s\S]*await entities\.Notification\.create/);
  assert.match(source, /if \(emailPermittedNow && outboundDeliveryIsReleased\) \{[\s\S]*await revalidateResolvedScope\([\s\S]*integrations\.Core\.SendEmail/);
});

test('notification requests are bounded and reject unsupported fields', () => {
  assert.match(source, /MAX_BODY_BYTES = 20_000/);
  assert.match(source, /Request contains unsupported fields/);
  assert.match(source, /req\.method !== 'POST'/);
  assert.match(source, /new TextEncoder\(\)\.encode\(raw\)\.byteLength/);
});

test('created row explicitly carries active authority while outbound delivery is paused', async () => {
  const { client, state } = runtime();
  const handler = await loadHandler(client);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].authority_state, 'active');
  assert.equal(state.creates[0].recipient_membership_id, 'membership-a');
  assert.equal(state.creates[0].recipient_membership_version, 3);
  assert.equal(state.emails.length, 0);
  const body = await response.json();
  assert.equal(body.channels.in_app, true);
  assert.equal(body.channels.email, false);
  assert.equal(body.delivery_paused, true);
});

test('membership revision race aborts before creating an inbox row', async () => {
  const { client, state } = runtime({
    afterPreferencesRead: (currentState) => {
      currentState.membership.version = 4;
    },
  });
  const handler = await loadHandler(client);
  const response = await handler(request());
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Notification authority changed; retry');
  assert.equal(state.creates.length, 0);
  assert.equal(state.emails.length, 0);
});
