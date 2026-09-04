import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import {
  AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  AI_CONTENT_AGREEMENT_VERSION,
} from '../../src/lib/aiContentAgreement.js';

const MUTATORS = [
  'update',
  'updateMany',
  'bulkUpdate',
  'delete',
  'deleteMany',
  'bulkDelete',
  'upsert',
  'bulkUpsert',
];
const MUTATOR_PATTERN = MUTATORS.join('|');

const normalizeMemberAccess = (source) => source.replace(
  /\[\s*(['"])([$A-Z_a-z][$\w]*)\1\s*\]/g,
  '.$2',
);

function mutationFindings(rawSource) {
  const source = normalizeMemberAccess(rawSource);
  const findings = [];
  const direct = new RegExp(`\\bentities\\.UserActivity\\.(${MUTATOR_PATTERN})\\s*\\(`, 'g');
  for (const match of source.matchAll(direct)) findings.push(`direct ${match[1]}`);

  const entityAliases = new Set();
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([$A-Z_a-z][$\w]*)\s*=\s*[^;\n]*\bentities\.UserActivity\b/g,
  )) entityAliases.add(match[1]);
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s*\{\s*UserActivity(?:\s*:\s*([$A-Z_a-z][$\w]*))?\s*\}\s*=\s*[^;\n]*\bentities\b/g,
  )) entityAliases.add(match[1] || 'UserActivity');

  // Follow simple aliases so `const ledger = activity; ledger.update(...)`
  // cannot evade the direct member-expression guard.
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of source.matchAll(
      /\b(?:const|let|var)\s+([$A-Z_a-z][$\w]*)\s*=\s*([$A-Z_a-z][$\w]*)\s*[;\n]/g,
    )) {
      if (entityAliases.has(match[2]) && !entityAliases.has(match[1])) {
        entityAliases.add(match[1]);
        changed = true;
      }
    }
  }

  for (const alias of entityAliases) {
    const aliasMutation = new RegExp(`\\b${alias}\\.(${MUTATOR_PATTERN})\\s*\\(`, 'g');
    for (const match of source.matchAll(aliasMutation)) findings.push(`${alias} ${match[1]}`);
  }

  // Also catch destructured method aliases, including bracket-normalized input:
  // `const { updateMany: mutate } = base44.entities['UserActivity']; mutate(...)`.
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([^;\n]+)/g,
  )) {
    const rhs = match[2];
    const isActivity = /\bentities\.UserActivity\b/.test(rhs)
      || [...entityAliases].some((alias) => new RegExp(`\\b${alias}\\b`).test(rhs));
    if (!isActivity) continue;
    for (const member of match[1].split(',')) {
      const parts = member.trim().match(/^([$A-Z_a-z][$\w]*)(?:\s*:\s*([$A-Z_a-z][$\w]*))?$/);
      if (!parts || !MUTATORS.includes(parts[1])) continue;
      const localName = parts[2] || parts[1];
      if (new RegExp(`\\b${localName}\\s*\\(`).test(source)) {
        findings.push(`destructured ${parts[1]}`);
      }
    }
  }

  return findings;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(url));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(url);
  }
  return files;
}

async function loadAgreementBroker(client) {
  let source = await readFile(
    new URL('../functions/acceptAiContentAgreement/entry.ts', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
    'const createClientFromRequest = globalThis.__agreementBrokerClient;',
  );
  const file = join(
    tmpdir(),
    `agreement_broker_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  const previousDeno = globalThis.Deno;
  globalThis.__agreementBrokerClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__agreementBrokerClient;
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
  }
  return handler;
}

const agreementRequest = (body, method = 'POST') => new Request('http://local/accept-ai-content-agreement', {
  method,
  headers: { 'content-type': 'application/json', 'user-agent': 'test-agent' },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});

test('UserActivity is admin-readable but denies every direct SDK write', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/UserActivity.jsonc', import.meta.url),
    'utf8',
  ));

  assert.deepEqual(schema.rls, {
    read: {
      user_condition: {
        role: 'admin',
      },
    },
    create: false,
    update: false,
    delete: false,
  });
});

test('frontend cannot append UserActivity and backend appends use service role', async () => {
  const frontend = await sourceFiles(new URL('../../src/', import.meta.url));
  const backend = await sourceFiles(new URL('../functions/', import.meta.url));
  const browserCreates = [];
  const unprivilegedBackendCreates = [];

  for (const url of frontend) {
    const source = normalizeMemberAccess(await readFile(url, 'utf8'));
    if (/\bentities\.UserActivity\.create\s*\(/.test(source)) browserCreates.push(url.pathname);
  }
  for (const url of backend) {
    const source = normalizeMemberAccess(await readFile(url, 'utf8'));
    const allCreates = source.match(/\bentities\.UserActivity\.create\s*\(/g) || [];
    const serviceCreates = source.match(/\basServiceRole\.entities\.UserActivity\.create\s*\(/g) || [];
    if (allCreates.length !== serviceCreates.length) unprivilegedBackendCreates.push(url.pathname);
  }

  assert.deepEqual(browserCreates, []);
  assert.deepEqual(unprivilegedBackendCreates, []);
});

test('browser telemetry helpers are no-ops and meaningful events use purpose brokers', async () => {
  const activity = await readFile(
    new URL('../../src/components/utils/activityLogger.jsx', import.meta.url),
    'utf8',
  );
  const audit = await readFile(
    new URL('../../src/components/utils/auditLogger.jsx', import.meta.url),
    'utf8',
  );
  const layout = await readFile(
    new URL('../../src/components/Layout.jsx', import.meta.url),
    'utf8',
  );
  const agreement = await readFile(
    new URL('../../src/components/compliance/AIContentResponsibilityAgreement.jsx', import.meta.url),
    'utf8',
  );
  const trackLogin = await readFile(
    new URL('../functions/trackUserLogin/entry.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(activity, /@\/api\/base44Client|base44\.|entities\./);
  assert.doesNotMatch(audit, /@\/api\/base44Client|base44\.|entities\./);
  assert.doesNotMatch(layout, /trackUserLogin/);
  assert.doesNotMatch(layout, /entities\.UserActivity\.create/);
  assert.match(trackLogin, /status:\s*503/);
  assert.doesNotMatch(trackLogin, /createClientFromRequest|auth\.me|UserActivity|user-agent/i);
  assert.match(agreement, /acceptAiContentAgreement\(\{[\s\S]*accepted:\s*true/);
  assert.doesNotMatch(agreement, /base44|entities\.UserActivity|auth\.updateMe/);
});

test('source cannot mutate UserActivity through bulk, bracket, or aliased SDK access', async () => {
  const roots = [
    new URL('../../src/', import.meta.url),
    new URL('../functions/', import.meta.url),
  ];
  const violations = [];
  for (const root of roots) {
    for (const url of await sourceFiles(root)) {
      const findings = mutationFindings(await readFile(url, 'utf8'));
      if (findings.length) violations.push(`${url.pathname}: ${findings.join(', ')}`);
    }
  }
  assert.deepEqual(violations, []);

  // Prove the scanner itself covers the bypass spellings this contract guards.
  for (const sample of [
    `base44.entities.UserActivity.updateMany([]);`,
    `base44.entities['UserActivity']['bulkUpdate']([]);`,
    `const activity = base44.entities.UserActivity; activity.deleteMany([]);`,
    `const { UserActivity: ledger } = base44.entities; ledger['delete']('x');`,
    `const { update: mutate } = base44.entities['UserActivity']; mutate('x', {});`,
  ]) assert.notDeepEqual(mutationFindings(sample), [], sample);
});

test('AI agreement broker derives immutable authority after its canonical audit append', async () => {
  const calls = [];
  let audit;
  let authority;
  let actor = {
    id: 'user-1', email: 'Nurse@Example.test', full_name: 'Nurse One', is_active: true,
  };
  const client = {
    auth: { me: async () => actor },
    asServiceRole: { entities: {
      UserActivity: { create: async (payload) => {
        calls.push('audit');
        audit = payload;
        return { id: 'event-1' };
      }, filter: async () => {
        calls.push('audit-read');
        return [{ id: 'event-1', ...audit }];
      } },
      AIContentAgreementAttestation: {
        create: async (payload) => {
          calls.push('authority-create');
          authority = payload;
          return { id: 'attestation-1' };
        },
        filter: async (query) => {
          if (query.id) {
            calls.push('authority-read');
            return [{ id: 'attestation-1', ...authority }];
          }
          calls.push('authority-list');
          return [];
        },
      },
      User: { filter: async () => {
        calls.push('actor-read');
        return [actor];
      } },
    } },
  };
  const handler = await loadAgreementBroker(client);
  const response = await handler(agreementRequest({
    accepted: true,
    agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  }));
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    'actor-read', 'authority-list', 'audit', 'audit-read', 'actor-read',
    'authority-create', 'authority-read', 'actor-read',
  ]);
  assert.equal(audit.user_email, 'nurse@example.test');
  assert.equal(audit.user_name, 'Nurse One');
  assert.equal(audit.action, 'ai_content_agreement_accepted');
  assert.equal(audit.entity_type, 'User');
  assert.equal(audit.entity_id, 'user-1');
  assert.equal(audit.details.agreement_version, AI_CONTENT_AGREEMENT_VERSION);
  assert.deepEqual(audit.details.acknowledgments, AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS);
  assert.match(audit.details.accepted_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(authority, {
    user_id: 'user-1',
    user_email_normalized: 'nurse@example.test',
    agreement_version: AI_CONTENT_AGREEMENT_VERSION,
    accepted_at: audit.details.accepted_at,
    acknowledgments: AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
    audit_event_id: 'event-1',
  });
  assert.equal(json.attestation_id, 'attestation-1');
  assert.equal(json.accepted_at, audit.details.accepted_at);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('AI agreement broker rejects stale or unaudited acceptance before creating authority', async () => {
  let auditWrites = 0;
  let authorityWrites = 0;
  const client = {
    auth: { me: async () => ({ id: 'user-1', email: 'nurse@example.test', is_active: true }) },
    asServiceRole: { entities: {
      UserActivity: { create: async () => {
        auditWrites += 1;
        throw new Error('audit unavailable');
      } },
      AIContentAgreementAttestation: {
        filter: async () => [],
        create: async () => { authorityWrites += 1; return {}; },
      },
      User: {
        filter: async () => [{ id: 'user-1', email: 'nurse@example.test', is_active: true }],
      },
    } },
  };
  const handler = await loadAgreementBroker(client);

  const stale = await handler(agreementRequest({ accepted: true, agreement_version: 'stale' }));
  assert.equal(stale.status, 409);
  assert.equal(auditWrites, 0);
  assert.equal(authorityWrites, 0);

  const extraKey = await handler(agreementRequest({
    accepted: true,
    agreement_version: AI_CONTENT_AGREEMENT_VERSION,
    user_email: 'victim@example.test',
  }));
  assert.equal(extraKey.status, 400);
  assert.equal(auditWrites, 0);
  assert.equal(authorityWrites, 0);

  const failedAudit = await handler(agreementRequest({
    accepted: true,
    agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  }));
  assert.equal(failedAudit.status, 500);
  assert.equal(auditWrites, 1);
  assert.equal(authorityWrites, 0);
});

test('AI agreement broker is POST-only and rejects ineligible actors before service access', async () => {
  let authReads = 0;
  let serviceReads = 0;
  const client = {
    auth: { me: async () => {
      authReads += 1;
      return {
        id: 'user-1', email: 'service@example.test', is_active: true, is_service: true,
      };
    } },
    asServiceRole: { entities: {
      User: { filter: async () => { serviceReads += 1; return []; } },
      UserActivity: {
        create: async () => { serviceReads += 1; return {}; },
        filter: async () => { serviceReads += 1; return []; },
      },
      AIContentAgreementAttestation: {
        create: async () => { serviceReads += 1; return {}; },
        filter: async () => { serviceReads += 1; return []; },
      },
    } },
  };
  const handler = await loadAgreementBroker(client);

  const wrongMethod = await handler(agreementRequest(undefined, 'GET'));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal(authReads, 0);

  const blocked = await handler(agreementRequest({
    accepted: true,
    agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  }));
  assert.equal(blocked.status, 403);
  assert.equal(authReads, 1);
  assert.equal(serviceReads, 0);
});

test('AI agreement broker requires exact audit, authority, and actor readbacks', async () => {
  for (const scenario of [
    { name: 'missing audit id', createResult: {}, auditRows: [], expectedStatus: 409, expectedAuthorityWrites: 0 },
    {
      name: 'mismatched audit readback',
      createResult: { id: 'event-1' },
      auditRows: [{ id: 'event-1', action: 'spoofed' }],
      expectedStatus: 409,
      expectedAuthorityWrites: 0,
    },
    {
      name: 'missing authority id',
      createResult: { id: 'event-1' },
      expectedStatus: 409,
      authorityCreateResult: {},
      expectedAuthorityWrites: 1,
    },
    {
      name: 'mismatched authority readback',
      createResult: { id: 'event-1' },
      expectedStatus: 409,
      authorityRows: [{ id: 'attestation-1', agreement_version: '0.9' }],
      expectedAuthorityWrites: 1,
    },
    {
      name: 'actor disabled after audit',
      createResult: { id: 'event-1' },
      expectedStatus: 403,
      expectedAuthorityWrites: 0,
      disableOnSecondActorRead: true,
    },
  ]) {
    let actor = { id: 'user-1', email: 'nurse@example.test', full_name: 'Nurse', is_active: true };
    let actorReads = 0;
    let createdAudit;
    let createdAuthority;
    let authorityWrites = 0;
    const client = {
      auth: { me: async () => actor },
      asServiceRole: { entities: {
        UserActivity: {
          create: async (payload) => {
            createdAudit = payload;
            return scenario.createResult;
          },
          filter: async () => scenario.auditRows
            || [{ id: 'event-1', ...createdAudit }],
        },
        AIContentAgreementAttestation: {
          create: async (payload) => {
            authorityWrites += 1;
            createdAuthority = payload;
            return scenario.authorityCreateResult ?? { id: 'attestation-1' };
          },
          filter: async (query) => {
            if (!query.id) return [];
            return scenario.authorityRows
              || [{ id: 'attestation-1', ...createdAuthority }];
          },
        },
        User: {
          filter: async () => {
            actorReads += 1;
            if (scenario.disableOnSecondActorRead && actorReads === 2) {
              actor = { ...actor, disabled: true };
            }
            return [actor];
          },
        },
      } },
    };
    const handler = await loadAgreementBroker(client);
    const response = await handler(agreementRequest({
      accepted: true,
      agreement_version: AI_CONTENT_AGREEMENT_VERSION,
    }));
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.equal(authorityWrites, scenario.expectedAuthorityWrites, scenario.name);
  }
});
