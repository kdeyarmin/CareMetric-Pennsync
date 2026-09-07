import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const TARGETS = [
  'adminResetPassword',
  'autoApproveInvitedUser',
  'createNotification',
  'createUserWithTempPassword',
  'generateFollowUpPortalToken',
  'resetUserPassword',
  'userManagement',
];

async function loadResolver(functionName, values) {
  const source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  const match = source.match(/function getAppBaseUrl\(\) \{[\s\S]*?^\}/m);
  assert.ok(match, `${functionName} must define getAppBaseUrl`);
  const Deno = { env: { get: (name) => values[name] } };
  const resolver = new Function(
    'Deno',
    `"use strict"; class PublicError extends Error { constructor(status, message) { super(message); this.status = status; } } ${match[0]}; return getAppBaseUrl;`,
  )(Deno);
  return { resolver, source, helper: match[0] };
}

for (const functionName of TARGETS) {
  test(`${functionName} requires one exact HTTPS APP_PUBLIC_URL origin`, async () => {
    const valid = await loadResolver(functionName, {
      APP_PUBLIC_URL: '  https://staging.example.test/  ',
      APP_URL: 'https://legacy.example.test',
    });
    assert.equal(valid.resolver(), 'https://staging.example.test');
    assert.doesNotMatch(valid.helper, /Deno\.env\.get\('APP_URL'\)/);
    assert.doesNotMatch(valid.source, /https:\/\/caremetricai\.base44\.app/);

    for (const appPublicUrl of [
      undefined,
      '   ',
      'not-a-url',
      'http://staging.example.test',
      'https://user:password@staging.example.test',
      'https://staging.example.test/app',
      'https://staging.example.test?environment=staging',
      'https://staging.example.test/#fragment',
    ]) {
      const { resolver } = await loadResolver(functionName, {
        APP_PUBLIC_URL: appPublicUrl,
        APP_URL: 'https://legacy.example.test',
      });
      assert.throws(
        () => resolver(),
        /(?:APP_PUBLIC_URL (?:is required|must be an absolute HTTPS origin)|Public provider portal URL is not configured)/,
        String(appPublicUrl),
      );
    }
  });
}

test('APP_PUBLIC_URL is resolved before each affected outbound side effect', async () => {
  const expectations = [
    ['adminResetPassword', 'const appUrl = getAppBaseUrl();', 'await base44.users.inviteUser('],
    ['autoApproveInvitedUser', 'const appUrl = getAppBaseUrl();', '// Process invitations sequentially'],
    ['createNotification', 'appBase = input.actionUrl ? getAppBaseUrl() : null;', 'await entities.Notification.create('],
    ['createUserWithTempPassword', 'const appUrl = getAppBaseUrl();', 'await base44.users.inviteUser('],
    ['generateFollowUpPortalToken', 'const portalOrigin = getAppBaseUrl();', 'base44 = createClientFromRequest(req);'],
    ['resetUserPassword', 'const appUrl = getAppBaseUrl();', 'await base44.asServiceRole.auth.updateUserPassword('],
    ['userManagement', 'const signupUrl = getAppBaseUrl();', 'const invitation = await base44.asServiceRole.entities.UserInvitation.create('],
  ];

  for (const [functionName, resolveMarker, effectMarker] of expectations) {
    const source = await readFile(
      new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
      'utf8',
    );
    const resolveIndex = source.indexOf(resolveMarker);
    const effectIndex = source.indexOf(effectMarker);
    assert.notEqual(resolveIndex, -1, `${functionName}: missing resolver marker`);
    assert.notEqual(effectIndex, -1, `${functionName}: missing effect marker`);
    assert.ok(resolveIndex < effectIndex, `${functionName}: public origin must be resolved first`);
  }
});

test('createNotification reports only channels it actually delivered', async () => {
  const source = await readFile(
    new URL('../functions/createNotification/entry.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /let emailSent = false;/);
  assert.match(source, /await base44\.asServiceRole\.integrations\.Core\.SendEmail\([\s\S]*?emailSent = true;/);
  assert.match(source, /email: emailSent,/);
  assert.match(source, /push: false,/);
  assert.doesNotMatch(source, /email: shouldSendEmail,/);
});

test('provider follow-up link rejects missing origin before constructing an SDK client', async () => {
  const source = await readFile(
    new URL('../functions/generateFollowUpPortalToken/entry.ts', import.meta.url),
    'utf8',
  );
  const rewritten = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = (...args) => globalThis.__publicOriginClientFactory(...args);',
  );
  const temporaryModule = join(
    tmpdir(),
    `followup_public_origin_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(rewritten).outputText);

  let handler;
  let clientConstructions = 0;
  globalThis.__publicOriginClientFactory = () => {
    clientConstructions += 1;
    throw new Error('SDK construction must not happen without APP_PUBLIC_URL');
  };
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: () => undefined },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }

  const response = await handler(new Request('https://functions.example.test/generateFollowUpPortalToken', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://caremetricai.base44.app',
    },
    body: JSON.stringify({ agency_id: 'agency-a', referral_id: 'referral-a' }),
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Public provider portal URL is not configured' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(clientConstructions, 0);
  assert.doesNotMatch(source, /Deno\.env\.get\('APP_URL'\)|headers\.get\('origin'\)|caremetricai\.base44\.app/);
});
