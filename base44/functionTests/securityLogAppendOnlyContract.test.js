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

test('SecurityLog is admin-readable but all direct SDK mutations are denied', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/SecurityLog.jsonc', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.rls, {
    read: { user_condition: { role: 'admin' } },
    create: false,
    update: false,
    delete: false,
  });
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
