import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import { loadFunctionEntry } from './functionEntryLoader.js';
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
const IDENTIFIER = '[$A-Z_a-z][$\\w]*';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeMemberAccess = (source) => source.replace(
  /\[\s*(['"])([$A-Z_a-z][$\w]*)\1\s*\]/g,
  '.$2',
);

function possibleStaticStrings(expression, constants = new Map()) {
  const parts = expression.trim().split(/\s*\+\s*/);
  let values = [''];
  for (const part of parts) {
    const literal = part.match(/^(['"`])([^'"`]*)\1$/);
    let partValues;
    if (literal) {
      partValues = [literal[2]];
    } else if (new RegExp(`^${IDENTIFIER}$`).test(part) && constants.has(part)) {
      partValues = [...constants.get(part)];
    } else {
      return [];
    }
    const next = [];
    for (const prefix of values) {
      for (const suffix of partValues) {
        next.push(prefix + suffix);
        if (next.length >= 64) break;
      }
      if (next.length >= 64) break;
    }
    values = next;
  }
  return values;
}

function normalizeEntityMemberAccess(rawSource, entityName) {
  let source = normalizeMemberAccess(rawSource)
    .replace(/\?\.\s*(?=\[)/g, '')
    .replace(/\?\.\s*/g, '.');
  const staticKeys = new Map();
  const declaration = new RegExp(
    `\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*([^;\\n]+)`,
    'g',
  );
  const declarations = [...source.matchAll(declaration)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of declarations) {
      const values = possibleStaticStrings(match[2], staticKeys);
      if (!values.length) continue;
      const known = staticKeys.get(match[1]) || new Set();
      for (const value of values) {
        if (!known.has(value)) {
          known.add(value);
          changed = true;
        }
      }
      staticKeys.set(match[1], known);
    }
  }
  for (const [key, values] of staticKeys) {
    if (!values.has(entityName)) continue;
    source = source.replace(
      new RegExp(`\\[\\s*${escapeRegExp(key)}\\s*\\]`, 'g'),
      `.${entityName}`,
    );
  }
  source = source.replace(/\[\s*([^\]\n]+)\s*\]/g, (whole, expression) => (
    possibleStaticStrings(expression, staticKeys).includes(entityName)
      ? `.${entityName}`
      : whole
  ));
  return source;
}

function entityHandleFindings(rawSource, entityName) {
  const source = normalizeEntityMemberAccess(rawSource, entityName);
  const findings = [];
  const entityAliases = new Set();

  for (const match of source.matchAll(new RegExp(
    `\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*[^;\\n]*\\.entities\\b`,
    'g',
  ))) entityAliases.add(match[1]);
  for (const match of source.matchAll(new RegExp(
    `\\b(?:const|let|var)\\s*\\{[^}]*\\bentities(?:\\s*:\\s*(${IDENTIFIER}))?[^}]*\\}\\s*=`,
    'g',
  ))) entityAliases.add(match[1] || 'entities');

  let changed = true;
  while (changed) {
    changed = false;
    for (const match of source.matchAll(new RegExp(
      `\\b(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*(${IDENTIFIER})\\s*(?:;|\\n)`,
      'g',
    ))) {
      if (entityAliases.has(match[2]) && !entityAliases.has(match[1])) {
        entityAliases.add(match[1]);
        changed = true;
      }
    }
  }

  const escapedEntity = escapeRegExp(entityName);
  for (const match of source.matchAll(new RegExp(`\\bentities\\.${escapedEntity}\\b`, 'g'))) {
    findings.push(match[0]);
  }
  for (const alias of entityAliases) {
    const escapedAlias = escapeRegExp(alias);
    for (const match of source.matchAll(new RegExp(`\\b${escapedAlias}\\.${escapedEntity}\\b`, 'g'))) {
      findings.push(match[0]);
    }
    for (const match of source.matchAll(new RegExp(
      `\\b(?:const|let|var)\\s*\\{[^}]*\\b${escapedEntity}(?:\\s*:\\s*${IDENTIFIER})?[^}]*\\}\\s*=\\s*${escapedAlias}\\b`,
      'g',
    ))) findings.push(match[0]);
  }
  for (const match of source.matchAll(new RegExp(
    `\\b(?:const|let|var)\\s*\\{[^}]*\\b${escapedEntity}(?:\\s*:\\s*${IDENTIFIER})?[^}]*\\}\\s*=\\s*[^;\\n]*\\.entities\\b`,
    'g',
  ))) findings.push(match[0]);
  for (const match of source.matchAll(new RegExp(
    `\\b(?:const|let|var)\\s*\\{[^{}]*\\bentities\\s*:\\s*\\{[^{}]*\\b${escapedEntity}(?:\\s*:\\s*${IDENTIFIER})?[^{}]*\\}[^{}]*\\}\\s*=`,
    'g',
  ))) findings.push(match[0]);

  return [...new Set(findings)];
}

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
  return loadFunctionEntry(
    new URL('../functions/acceptAiContentAgreement/entry.ts', import.meta.url),
    { client },
  );
}

const agreementRequest = (body, method = 'POST') => new Request('http://local/accept-ai-content-agreement', {
  method,
  headers: { 'content-type': 'application/json', 'user-agent': 'test-agent' },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});

test('UserActivity is append-only: callers append their own events, and the creator or an admin reads', async () => {
  // Owner decision 2026-10-08: browser activity is recorded again. A caller may
  // create only a row naming themselves, nobody may update or delete a row,
  // and the direct read is the row's creator or the built-in admin (the
  // reviewed security views). An agency administrator reads through
  // getUserActivityLog, which scopes to their own agency's members.
  const schema = JSON5.parse(await readFile(
    new URL('../entities/UserActivity.jsonc', import.meta.url),
    'utf8',
  ));

  assert.deepEqual(schema.rls, {
    read: {
      $or: [
        { created_by: '{{user.email}}' },
        { user_condition: { role: 'admin' } },
      ],
    },
    create: { 'data.user_email': '{{user.email}}' },
    update: false,
    delete: false,
  });
});

test('browser source reads UserActivity history through the scoped broker or the reviewed admin views', async () => {
  // The only write handle is the append in activityLogger.jsx. The full-log
  // reads are the four reviewed security views, each gated on the built-in
  // administrator account; every other read goes through getUserActivityLog.
  const ACTIVITY_LOGGER = '/src/components/utils/activityLogger.jsx';
  const ADMIN_READERS = [
    'src/components/security/AIAuditAnalyzer.jsx',
    'src/components/security/BreachDetectionSystem.jsx',
    'src/components/security/SecurityAnomalyDetector.jsx',
    'src/components/security/SecurityLogTabs.jsx',
  ];
  const readers = new Set();
  const violations = [];
  for (const url of await sourceFiles(new URL('../../src/', import.meta.url))) {
    const source = await readFile(url, 'utf8');
    const handles = entityHandleFindings(source, 'UserActivity');
    if (url.pathname.endsWith(ACTIVITY_LOGGER)) {
      const normalized = normalizeMemberAccess(source);
      const uses = normalized.match(/\bentities\.UserActivity\.[A-Za-z]+/g) || [];
      if (uses.length !== 1 || uses[0] !== 'entities.UserActivity.create') {
        violations.push(`${url.pathname}: ${uses.join(', ')}`);
      }
      continue;
    }
    const relative = url.pathname.slice(url.pathname.indexOf('/src/') + 1);
    if (handles.length && ADMIN_READERS.includes(relative)) readers.add(relative);
    else if (handles.length) violations.push(`${url.pathname}: ${handles.join(', ')}`);
  }
  assert.deepEqual(violations, []);
  assert.deepEqual([...readers].sort(), ADMIN_READERS);
  for (const reader of readers) {
    const source = await readFile(new URL(`../../${reader}`, import.meta.url), 'utf8');
    assert.match(source, /isAdminLike\(/, `${reader} must gate the full-log read on the administrator account`);
  }

  // Both restored readers build a pinned client, rebuild the caller's claims
  // from the service-owned membership, and never read the self-editable
  // agency_name as authority.
  for (const name of ['getUserActivityLog', 'analyzeNursePerformance']) {
    const source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
    const handler = source.slice(source.indexOf('Deno.serve('));
    assert.match(handler, /createClientFromRequest\(userScopedClientRequest\(req, PENNSYNC_PRODUCTION_APP_ID\)\)/, name);
    assert.match(handler, /await withTrustedClaims\(base44, await base44\.auth\.me\(\)\)/, name);
    assert.doesNotMatch(source.replace(/\/\/ <<<BEGIN SHARED HELPER: trustedCallerClaims[\s\S]*?<<<END SHARED HELPER: trustedCallerClaims>>>/, ''),
      /\bagency_name\b/, `${name} never scopes by agency_name`);
    assert.match(source, /user\.role === 'user' && user\.account_type === 'agency_admin'/, name);
  }

  const unavailable = await readFile(
    new URL('../../src/components/security/UserActivityUnavailable.jsx', import.meta.url),
    'utf8',
  );
  assert.match(unavailable, /must not be interpreted as zero events or an all-clear result/);

  // runSecurityAudit runs again (owner decision, 2026-10-08): it authorizes the
  // built-in administrator or a service-owned agency_admin membership before
  // any cohort read, and scopes an agency administrator to their agency.
  const audit = await readFile(
    new URL('../functions/runSecurityAudit/entry.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(audit, /SECURITY_AUDIT_PAUSED/);
  assert.match(audit, /createClientFromRequest\(userScopedClientRequest\(req, PENNSYNC_PRODUCTION_APP_ID\)\)/);
  assert.ok(
    audit.indexOf('const authority = await auditAuthority(base44, user)')
      < audit.indexOf('cohort = await loadCohort(base44, authority)'),
    'runSecurityAudit must authorize before reading its cohort',
  );
  assert.match(audit, /claims\.account_type === 'agency_admin' && claimIdentifier\(claims\.agency_id\)/);
  assert.match(audit, /entities\.Patient\.filter\(\{ agency_id: authority\.agencyId \}/);

  const personalized = await readFile(
    new URL('../functions/generatePersonalizedTraining/entry.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(personalized, /entities\.UserActivity/);

});

test('UserActivity handle scanner covers aliases, destructuring, optional chains, and computed keys', () => {
  for (const sample of [
    `base44?.entities?.UserActivity?.list?.();`,
    `const { UserActivity: ledger } = base44.entities; ledger.filter({});`,
    `const entityName = 'User' + 'Activity'; base44.entities[entityName].get('x');`,
    `base44.entities['User' + "Activity"].filter({});`,
    `const suffix = 'Activity'; const entityName = 'User' + suffix; base44.entities[entityName];`,
    `const models = base44['entities']; const ledger = models?.[\`UserActivity\`];`,
    `const { entities: models } = base44; const { UserActivity } = models;`,
    `const { entities: { UserActivity: ledger } } = base44; ledger.list();`,
  ]) {
    assert.notDeepEqual(entityHandleFindings(sample, 'UserActivity'), [], sample);
  }

  assert.deepEqual(entityHandleFindings(`
    const label = 'UserActivity';
    renderUnavailable(label);
    base44.entities.SecurityLog.list();
  `, 'UserActivity'), []);
});

test('the browser appends UserActivity only from activityLogger and backend appends use service role', async () => {
  const frontend = await sourceFiles(new URL('../../src/', import.meta.url));
  const backend = await sourceFiles(new URL('../functions/', import.meta.url));
  const browserCreates = [];
  const unprivilegedBackendCreates = [];

  for (const url of frontend) {
    const source = normalizeMemberAccess(await readFile(url, 'utf8'));
    if (/\bentities\.UserActivity\.create\s*\(/.test(source)
      && !url.pathname.endsWith('/src/components/utils/activityLogger.jsx')) browserCreates.push(url.pathname);
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

test('browser telemetry appends only the caller\'s own minimized events; meaningful events use purpose brokers', async () => {
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

  // activityLogger appends one row per event, naming the caller from
  // auth (which the RLS create rule also requires), with minimized details.
  const append = activity.slice(activity.indexOf('base44.entities.UserActivity.create('));
  assert.match(append, /^base44\.entities\.UserActivity\.create\(\{\s*user_email: email,/);
  assert.match(activity, /const caller = await loadCurrentCaller\(\);/);
  assert.match(append, /details: minimizeActivityDetails\(source\)/);
  assert.equal((activity.match(/entities\./g) || []).length, 1);
  assert.match(activity, /export const logError = async \(_errorMessage, _errorDetails = \{\}\) => undefined;/);
  assert.doesNotMatch(audit, /@\/api\/base44Client|base44\.|entities\./);
  // Login tracking is back (owner decision, 2026-10-08), as a server-stamped
  // record of the caller's own sign-in. The shell asks once per tab session
  // through loginTelemetry.js, the only browser caller; trackUserLogin names
  // the person from the session and stores no user agent or address.
  assert.doesNotMatch(layout, /trackUserLogin/);
  assert.match(layout, /recordLoginOnce\(\{ id: loginTelemetryUserId \}\)/);
  assert.doesNotMatch(layout, /entities\.UserActivity\.create/);
  const loginTelemetry = await readFile(new URL('../../src/lib/loginTelemetry.js', import.meta.url), 'utf8');
  assert.match(loginTelemetry, /invoke\('trackUserLogin', device \? \{ device_type: device \} : \{\}\)/);
  for (const url of await sourceFiles(new URL('../../src/', import.meta.url))) {
    if (url.pathname.endsWith('/src/lib/loginTelemetry.js')) continue;
    assert.doesNotMatch(await readFile(url, 'utf8'), /['"]trackUserLogin['"]/, `${url.pathname} must not invoke trackUserLogin`);
  }
  const loginHandler = trackLogin.slice(trackLogin.indexOf('Deno.serve('));
  assert.match(loginHandler, /createClientFromRequest\(userScopedClientRequest\(req, PENNSYNC_PRODUCTION_APP_ID\)\)/);
  assert.match(loginHandler, /if \(isDeactivatedUser\(user\)\) return DEACTIVATED_USER_RESPONSE\(\);/);
  assert.match(loginHandler, /user_email: email,/);
  assert.match(loginHandler, /login_time: loginTime,/);
  assert.doesNotMatch(trackLogin, /user-agent|user_agent|ip_address|x-forwarded-for/i);
  assert.ok(
    loginHandler.indexOf('base44.auth.me()') < loginHandler.indexOf('req.json()'),
    'trackUserLogin identifies the caller before it reads the body',
  );
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

async function loadLoginTracker(client) {
  let source = await readFile(new URL('../functions/trackUserLogin/entry.ts', import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
    'const createClientFromRequest = globalThis.__loginTrackerClient;',
  );
  const file = join(tmpdir(), `login_tracker_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  const previousDeno = globalThis.Deno;
  globalThis.__loginTrackerClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: () => undefined } };
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__loginTrackerClient;
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
  }
  return handler;
}

function loginClient({ me, priorLogins = [], readFails = false } = {}) {
  const calls = [];
  const writes = [];
  const client = {
    auth: { me: async () => { calls.push('auth.me'); return me; } },
    asServiceRole: { entities: { UserActivity: {
      filter: async (query) => {
        calls.push(['filter', query]);
        if (readFails) throw new Error('store unavailable');
        return priorLogins;
      },
      create: async (row) => { calls.push('create'); writes.push(row); return { id: 'activity-1', ...row }; },
    } } },
  };
  return { client, calls, writes };
}

const loginRequest = (body, method = 'POST') => new Request('http://local/track-user-login', {
  method,
  headers: {
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (fingerprint)',
    'x-forwarded-for': '203.0.113.9',
  },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});

test('trackUserLogin records only the caller\'s own sign-in, server-stamped, without a fingerprint', async () => {
  const nurse = { id: 'u1', email: 'Nurse@Example.test', full_name: 'Nurse One', role: 'user', is_active: true };

  const recorded = loginClient({ me: nurse });
  const response = await (await loadLoginTracker(recorded.client))(loginRequest({ device_type: 'mobile' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, recorded: true, activity_id: 'activity-1' });
  assert.equal(recorded.writes.length, 1);
  const [row] = recorded.writes;
  assert.equal(row.user_email, 'nurse@example.test', 'the person comes from the session, normalized');
  assert.equal(row.action, 'login');
  assert.equal(row.device_type, 'mobile');
  assert.match(row.details.login_time, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Math.abs(Date.parse(row.details.login_time) - Date.now()) < 60_000, 'the time is the server clock');
  assert.equal(row.details.user_role, 'user');
  for (const forbidden of ['user_agent', 'ip_address']) {
    assert.equal(Object.hasOwn(row, forbidden), false, `${forbidden} is never stored`);
  }
  assert.doesNotMatch(JSON.stringify(row), /Mozilla|fingerprint|203\.0\.113/);

  // A body naming someone else (or carrying any other key) is refused before
  // any read or write.
  for (const body of [
    { user_email: 'victim@example.test' },
    { device_type: 'desktop', login_time: '2020-01-01T00:00:00.000Z' },
    { device_type: 'Mozilla/5.0' },
  ]) {
    const refused = loginClient({ me: nurse });
    const result = await (await loadLoginTracker(refused.client))(loginRequest(body));
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(refused.writes.length, 0);
    assert.equal(refused.calls.some((call) => Array.isArray(call)), false, 'no history read for a refused body');
  }

  // Replay inside the half hour records nothing.
  const recent = loginClient({ me: nurse, priorLogins: [{ id: 'old', created_date: new Date(Date.now() - 60_000).toISOString() }] });
  const replay = await (await loadLoginTracker(recent.client))(loginRequest({}));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { success: true, recorded: false });
  assert.equal(recent.writes.length, 0);
  assert.deepEqual(recent.calls[1], ['filter', { user_email: 'nurse@example.test', action: 'login' }]);

  // An older sign-in does not suppress a new one.
  const stale = loginClient({ me: nurse, priorLogins: [{ id: 'old', created_date: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }] });
  assert.equal((await (await loadLoginTracker(stale.client))(loginRequest({}))).status, 200);
  assert.equal(stale.writes.length, 1);

  // History that cannot be read writes nothing rather than flooding the trail.
  const unreadable = loginClient({ me: nurse, readFails: true });
  assert.equal((await (await loadLoginTracker(unreadable.client))(loginRequest({}))).status, 503);
  assert.equal(unreadable.writes.length, 0);

  // No session, a deactivated account, a service identity and a GET all stop
  // before any service-role access.
  for (const [me, status, method] of [
    [null, 401, 'POST'],
    [{ ...nurse, is_active: false }, 403, 'POST'],
    [{ ...nurse, is_service: true }, 403, 'POST'],
    [nurse, 405, 'GET'],
  ]) {
    const denied = loginClient({ me });
    const result = await (await loadLoginTracker(denied.client))(loginRequest({}, method));
    assert.equal(result.status, status);
    assert.equal(denied.writes.length, 0);
    assert.equal(denied.calls.some((call) => Array.isArray(call)), false);
  }
});
