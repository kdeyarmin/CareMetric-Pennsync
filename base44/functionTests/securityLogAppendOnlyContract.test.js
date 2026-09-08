import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import JSON5 from 'json5';

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(url));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(url);
  }
  return files;
}

const IDENTIFIER = '[$A-Z_a-z][$\\w]*';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

function normalizeSecurityMemberAccess(rawSource) {
  let source = rawSource
    .replace(/\?\.\s*(?=\[)/g, '')
    .replace(/\?\.\s*/g, '.')
    .replace(/\[\s*(['"`])([$A-Z_a-z][$\w]*)\1\s*\]/g, '.$2');

  // Resolve a deliberately small and reviewable set of static computed keys.
  // Dynamic keys are not acceptable browser authority either, but these are
  // the common disguises a source contract must prove it recognizes.
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
    if (!values.has('SecurityLog')) continue;
    source = source.replace(
      new RegExp(`\\[\\s*${escapeRegExp(key)}\\s*\\]`, 'g'),
      '.SecurityLog',
    );
  }
  source = source.replace(/\[\s*([^\]\n]+)\s*\]/g, (whole, expression) => (
    possibleStaticStrings(expression, staticKeys).includes('SecurityLog')
      ? '.SecurityLog'
      : whole
  ));
  return source;
}

function securityLogHandleFindings(rawSource) {
  const source = normalizeSecurityMemberAccess(rawSource);
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

  // Follow simple container aliases (`const models = entities`) as well.
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

  for (const match of source.matchAll(/\bentities\.SecurityLog\b/g)) {
    findings.push(match[0]);
  }
  for (const alias of entityAliases) {
    const escaped = escapeRegExp(alias);
    for (const match of source.matchAll(new RegExp(`\\b${escaped}\\.SecurityLog\\b`, 'g'))) {
      findings.push(match[0]);
    }
    for (const match of source.matchAll(new RegExp(
      `\\b(?:const|let|var)\\s*\\{[^}]*\\bSecurityLog(?:\\s*:\\s*${IDENTIFIER})?[^}]*\\}\\s*=\\s*${escaped}\\b`,
      'g',
    ))) findings.push(match[0]);
  }

  // A direct entities expression can also be destructured without ever
  // spelling `.SecurityLog` as a member access.
  for (const match of source.matchAll(new RegExp(
    `\\b(?:const|let|var)\\s*\\{[^}]*\\bSecurityLog(?:\\s*:\\s*${IDENTIFIER})?[^}]*\\}\\s*=\\s*[^;\\n]*\\.entities\\b`,
    'g',
  ))) findings.push(match[0]);
  for (const match of source.matchAll(new RegExp(
    `\\b(?:const|let|var)\\s*\\{[^{}]*\\bentities\\s*:\\s*\\{[^{}]*\\bSecurityLog(?:\\s*:\\s*${IDENTIFIER})?[^{}]*\\}[^{}]*\\}\\s*=`,
    'g',
  ))) findings.push(match[0]);

  return [...new Set(findings)];
}

function securityLogPayloads(source) {
  const marker = '.entities.SecurityLog.create(';
  const payloads = [];
  let cursor = 0;
  while ((cursor = source.indexOf(marker, cursor)) !== -1) {
    const start = source.indexOf('{', cursor + marker.length);
    assert.notEqual(start, -1, 'SecurityLog.create must receive an object literal');
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') depth -= 1;
      if (depth === 0) { end = i; break; }
    }
    assert.notEqual(end, -1, 'SecurityLog payload must have balanced braces');
    payloads.push(source.slice(start, end + 1));
    cursor = end + 1;
  }
  return payloads;
}

test('SecurityLog denies every direct SDK operation', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/SecurityLog.jsonc', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.rls, {
    read: false,
    create: false,
    update: false,
    delete: false,
  });
});

test('browser source cannot obtain a SecurityLog entity handle', async () => {
  const violations = [];
  for (const url of await sourceFiles(new URL('../../src/', import.meta.url))) {
    const source = await readFile(url, 'utf8');
    const findings = securityLogHandleFindings(source, url.pathname);
    if (findings.length) violations.push(`${url.pathname}: ${findings.join(', ')}`);
  }
  assert.deepEqual(violations, []);

  const unavailable = await readFile(
    new URL('../../src/components/security/SecurityLogUnavailable.jsx', import.meta.url),
    'utf8',
  );
  assert.match(unavailable, /immutable agency provenance/);
  assert.match(unavailable, /tenant-authorized server broker/);
  assert.match(unavailable, /No zero-event or all-clear conclusion/);
});

test('SecurityLog handle scanner covers aliases, destructuring, optional chains, and computed keys', () => {
  for (const sample of [
    `base44?.entities?.SecurityLog?.list?.();`,
    `const { SecurityLog: ledger } = base44.entities; ledger.filter({});`,
    `const entityName = 'Security' + 'Log'; base44.entities[entityName].get('x');`,
    `base44.entities['Security' + "Log"].filter({});`,
    `const suffix = 'Log'; const entityName = 'Security' + suffix; base44.entities[entityName];`,
    `const models = base44['entities']; const ledger = models?.[\`SecurityLog\`];`,
    `const { entities: models } = base44; const { SecurityLog } = models;`,
    `const { entities: { SecurityLog: ledger } } = base44; ledger.list();`,
    `const { list } = base44.entities['SecurityLog']; list();`,
  ]) {
    assert.notDeepEqual(securityLogHandleFindings(sample), [], sample);
  }

  assert.deepEqual(securityLogHandleFindings(`
    const label = 'SecurityLog';
    renderUnavailable(label);
    base44.entities.UserActivity.list();
  `), []);
});

test('security compliance UI uses bound identity and pauses provenance-free global histories', async () => {
  const compliance = await readFile(
    new URL('../../src/components/hub-tabs/SecurityCompliance.jsx', import.meta.url),
    'utf8',
  );
  const documentation = await readFile(
    new URL('../../src/components/security/SecurityDocumentation.jsx', import.meta.url),
    'utf8',
  );

  assert.match(compliance, /useAuth\(\)/);
  assert.doesNotMatch(compliance, /base44\.auth\.me|entities(?:\.|\[['"])(?:SecurityLog|UserActivity)/);
  assert.match(compliance, /<SecurityLogUnavailable\s*\/>/);
  assert.match(compliance, /<UserActivityUnavailable\s*\/>/);
  assert.doesNotMatch(compliance, /No (?:security events|audit logs)/i);
  assert.match(compliance, /buildSecurityComplianceReport\(\{[\s\S]*assessedChecks/);
  assert.match(compliance, /evidenceType:\s*'platform_attestation',[^\n]*status:\s*'attested'/);
  assert.doesNotMatch(compliance, /checks:\s*complianceChecks/);

  assert.match(documentation, /Coverage is not attested by this view/);
  assert.match(documentation, /not a compliance certification/);
  assert.doesNotMatch(documentation, /Complete Audit Trail|All security-relevant actions are logged/);
});

test('browser source cannot create or mutate SecurityLog', async () => {
  const violations = [];
  for (const url of await sourceFiles(new URL('../../src/', import.meta.url))) {
    const source = await readFile(url, 'utf8');
    if (/\.entities\.SecurityLog\.(?:create|update|delete|updateMany|deleteMany)\s*\(/.test(source)) {
      violations.push(url.pathname);
    }
  }
  assert.deepEqual(violations, []);

  const helper = await readFile(new URL('../../src/components/utils/security.jsx', import.meta.url), 'utf8');
  const breach = await readFile(
    new URL('../../src/components/security/BreachDetectionSystem.jsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(helper, /@\/api\/base44Client|SecurityLog\.create/);
  assert.doesNotMatch(breach, /SecurityLog\.create/);
});

test('backend SecurityLog appends use service-role authority', async () => {
  const violations = [];
  for (const url of await sourceFiles(new URL('../functions/', import.meta.url))) {
    const source = await readFile(url, 'utf8');
    if (/\bbase44\.entities\.SecurityLog\.create\s*\(/.test(source)) {
      violations.push(`${url.pathname}: direct client create`);
    }
    const withoutDirectServiceCreates = source.replace(
      /\bbase44\.asServiceRole\.entities\.SecurityLog\.create\s*\(/g,
      'serviceSecurityLogCreate(',
    );
    if (/\bentities\.SecurityLog\.create\s*\(/.test(withoutDirectServiceCreates)
      && !/\b(?:const|let)\s+entities\s*=\s*base44\.asServiceRole\.entities\b/.test(source)) {
      violations.push(`${url.pathname}: unproven entities alias`);
    }
  }
  assert.deepEqual(violations, []);
});

test('privileged SecurityLog payloads exclude known endpoint, secret, and tenant-name leaks', async () => {
  const forbiddenKeys = [
    'phone_e164',
    'to_number',
    'from_number',
    'api_key',
    'api_key_last_four',
    'target_email',
    'agency_name',
    'message_body',
    'clinical_narrative',
    'mrn',
  ];
  const violations = [];
  for (const url of await sourceFiles(new URL('../functions/', import.meta.url))) {
    const source = await readFile(url, 'utf8');
    for (const payload of securityLogPayloads(source)) {
      for (const key of forbiddenKeys) {
        if (new RegExp(`\\b${key}\\s*:`).test(payload)) {
          violations.push(`${url.pathname}: ${key}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);

  const chartExport = await readFile(
    new URL('../functions/generatePatientChartPDF/entry.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(chartExport, /cf-connecting-ip|x-forwarded-for/);
  assert.match(chartExport, /ip_address:\s*'server-side'/);
});
