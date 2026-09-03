import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

async function loadFunction(name, { client, env = {} }) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source
    .replace(
      /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
      'const createClientFromRequest = globalThis.__certificateCacheClient;',
    )
    .replace(
      /import\s+\{\s*jsPDF\s*\}\s+from\s+'npm:jspdf@[^']*';?/,
      'const jsPDF = class {};',
    );
  const file = join(tmpdir(), `certificate_cache_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__certificateCacheClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (key) => env[key] },
  };
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
  }
  return handler;
}

function request(body = {}, headers = {}) {
  return new Request('http://local/certificate-cache', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('CertificatePacketCache denies every direct entity operation', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/CertificatePacketCache.jsonc', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.rls, {
    create: false,
    read: false,
    update: false,
    delete: false,
  });
});

test('service-only inventory entities have no direct browser SDK access', async () => {
  const serviceOnly = [
    'CertificatePacketCache',
    'PDGMCaseMix',
    'SkillBadge',
    'SupplyItem',
    'SupplyLowStockAlert',
    'SupplyPrediction',
    'SupplyUsageLog',
  ];
  const sourceRoot = new URL('../../src/', import.meta.url);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await walk(url);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(url);
    }
  }
  await walk(sourceRoot);
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const entity of serviceOnly) {
      if (new RegExp(`base44\\.entities\\.${entity}\\b`).test(source)) {
        violations.push(`${file.pathname}: ${entity}`);
      }
    }
  }
  assert.deepEqual(violations, []);

  const badgeFunction = await readFile(
    new URL('../functions/awardBadgeOnCompletion/entry.ts', import.meta.url),
    'utf8',
  );
  assert.match(badgeFunction, /asServiceRole\.entities\.SkillBadge\.filter/);
  assert.doesNotMatch(badgeFunction, /(?<!asServiceRole\.)entities\.SkillBadge\.filter/);
});

test('self-editable super-admin and agency claims cannot export another employee packet', async () => {
  const calls = { cacheReads: 0, userReads: 0, certificateReads: 0 };
  const client = {
    auth: { me: async () => ({
      email: 'attacker@example.test',
      role: 'user',
      account_type: 'super_admin',
      agency_name: 'Victim Agency',
      is_active: true,
    }) },
    asServiceRole: { entities: {
      CertificatePacketCache: { filter: async () => { calls.cacheReads += 1; return []; } },
      User: { filter: async () => { calls.userReads += 1; return []; } },
      TrainingCertificate: { filter: async () => { calls.certificateReads += 1; return []; } },
    } },
  };
  const handler = await loadFunction('generateAndCacheCertificatePacket', {
    client,
    env: { SUPER_ADMIN_EMAIL: 'owner@example.test' },
  });
  const response = await handler(request({ employeeId: 'victim@example.test' }));
  assert.equal(response.status, 403);
  assert.deepEqual(calls, { cacheReads: 0, userReads: 0, certificateReads: 0 });
});

test('anonymous packet requests return 401 when Base44 auth.me rejects', async () => {
  const client = {
    auth: { me: async () => { throw new Error('You must be logged in'); } },
  };
  const handler = await loadFunction('generateAndCacheCertificatePacket', { client });
  const response = await handler(request({ employeeId: 'victim@example.test' }));
  assert.equal(response.status, 401);
});

test('operator-shaped certificate IDs and malformed dates fail before privileged reads', async () => {
  for (const body of [
    { employeeId: 'nurse@example.test', certificateIds: [{ $ne: null }] },
    { employeeId: 'nurse@example.test', dateRangeStart: { $gte: '1900-01-01' } },
    { employeeId: 'nurse@example.test', dateRangeStart: '2026-09-30', dateRangeEnd: '2026-09-01' },
  ]) {
    let privilegedReads = 0;
    const client = {
      auth: { me: async () => ({ email: 'nurse@example.test', role: 'user', is_active: true }) },
      asServiceRole: { entities: {
        CertificatePacketCache: { filter: async () => { privilegedReads += 1; return []; } },
        TrainingCertificate: { filter: async () => { privilegedReads += 1; return []; } },
      } },
    };
    const handler = await loadFunction('generateAndCacheCertificatePacket', { client });
    const response = await handler(request(body));
    assert.equal(response.status, 400);
    assert.equal(privilegedReads, 0);
  }
});

test('self-service cache lookup rejects leaked foreign rows and updates only the exact owner row', async () => {
  const updates = [];
  const cacheQueries = [];
  const client = {
    auth: { me: async () => ({ email: 'nurse@example.test', role: 'user', is_active: true }) },
    asServiceRole: { entities: {
      CertificatePacketCache: {
        filter: async (query) => {
          cacheQueries.push(query);
          return [
          {
            id: 'foreign', user_id: 'other@example.test', file_uri: 'private://foreign',
            generated_at: '2026-09-03T00:00:00.000Z', expires_at: '2099-09-03T00:00:00.000Z',
          },
          {
            id: 'own', user_id: 'nurse@example.test', file_uri: 'private://own',
            generated_at: '2026-09-03T00:00:00.000Z', expires_at: '2099-09-03T00:00:00.000Z',
            download_count: 2,
          },
        ];
        },
        update: async (id, payload) => { updates.push({ id, payload }); return { id }; },
      },
      User: { filter: async () => { throw new Error('self-service must not list users'); } },
      TrainingCertificate: { filter: async () => { throw new Error('cache hit must not list certificates'); } },
    } },
    integrations: { Core: {
      CreateFileSignedUrl: async ({ file_uri }) => ({ signed_url: `signed:${file_uri}` }),
    } },
  };
  const handler = await loadFunction('generateAndCacheCertificatePacket', { client });
  const response = await handler(request({ employeeId: 'NURSE@example.test' }));
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.download_url, 'signed:private://own');
  assert.equal(cacheQueries[0].user_id, 'nurse@example.test');
  assert.deepEqual(updates.map((update) => update.id), ['own']);
  assert.equal(updates[0].payload.download_count, 3);
});

test('cache cleanup rejects mutable platform claims before any privileged read', async () => {
  let reads = 0;
  const client = {
    auth: { me: async () => ({
      email: 'attacker@example.test', role: 'user', account_type: 'super_admin', is_active: true,
    }) },
    asServiceRole: { entities: { CertificatePacketCache: {
      filter: async () => { reads += 1; return []; },
    } } },
  };
  const handler = await loadFunction('cleanupExpiredCertificateCache', {
    client,
    env: { SUPER_ADMIN_EMAIL: 'owner@example.test', INTERNAL_FN_SECRET: 'scheduler-secret' },
  });
  const response = await handler(request());
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});

test('anonymous cleanup returns 403 when Base44 auth.me rejects', async () => {
  const client = {
    auth: { me: async () => { throw new Error('You must be logged in'); } },
  };
  const handler = await loadFunction('cleanupExpiredCertificateCache', { client });
  const response = await handler(request());
  assert.equal(response.status, 403);
});

test('cache cleanup accepts the server-held secret and deletes only returned expired rows', async () => {
  const deleted = [];
  const client = {
    auth: { me: async () => null },
    asServiceRole: { entities: { CertificatePacketCache: {
      filter: async () => [{ id: 'expired-1' }, { id: 'expired-2' }],
      delete: async (id) => { deleted.push(id); },
    } } },
  };
  const handler = await loadFunction('cleanupExpiredCertificateCache', {
    client,
    env: { INTERNAL_FN_SECRET: 'scheduler-secret' },
  });
  const response = await handler(request({}, { 'x-internal-secret': 'scheduler-secret' }));
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.deleted_count, 2);
  assert.deepEqual(deleted, ['expired-1', 'expired-2']);
});
