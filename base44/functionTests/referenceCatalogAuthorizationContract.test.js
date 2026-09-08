import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

async function loadFunction(name, client) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
    'const createClientFromRequest = globalThis.__referenceCatalogClient;',
  );
  const file = join(tmpdir(), `reference_catalog_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__referenceCatalogClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
  }
  return handler;
}

function request(body = {}) {
  return new Request('http://local/reference-catalog', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('Competency and PolicyLibrary deny every direct entity operation', async () => {
  for (const name of ['Competency', 'PolicyLibrary']) {
    const schema = JSON5.parse(await readFile(new URL(`../entities/${name}.jsonc`, import.meta.url), 'utf8'));
    assert.deepEqual(schema.rls, {
      create: false,
      read: false,
      update: false,
      delete: false,
    });
  }
});

test('the browser uses brokers instead of direct reference entity reads', async () => {
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
    for (const entity of ['Competency', 'PolicyLibrary']) {
      if (new RegExp(`base44\\.entities\\.${entity}\\b`).test(source)) {
        violations.push(`${file.pathname}: ${entity}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('competency broker requires an authenticated active user and rejects operator input before reads', async () => {
  for (const user of [null, { email: 'offboarded@example.test', role: 'user', is_active: false }]) {
    let reads = 0;
    const client = {
      auth: { me: async () => user },
      asServiceRole: { entities: { Competency: { filter: async () => { reads += 1; return []; } } } },
    };
    const handler = await loadFunction('listCompetencies', client);
    const response = await handler(request());
    assert.equal(response.status, user ? 403 : 401);
    assert.equal(reads, 0);
  }

  let reads = 0;
  const client = {
    auth: { me: async () => ({ email: 'nurse@example.test', role: 'user', is_active: true }) },
    asServiceRole: { entities: { Competency: { filter: async () => { reads += 1; return []; } } } },
  };
  const handler = await loadFunction('listCompetencies', client);
  const response = await handler(request({ role_target: { $ne: null } }));
  assert.equal(response.status, 400);
  assert.equal(reads, 0);
});

test('competency broker rechecks active status and requested filters after service-role reads', async () => {
  const queries = [];
  const client = {
    auth: { me: async () => ({ email: 'nurse@example.test', role: 'user', is_active: true }) },
    asServiceRole: { entities: { Competency: { filter: async (...args) => {
      queries.push(args);
      return [
        { id: 'match', name: 'Hand hygiene', role_target: ['RN', 'LPN'], category: 'safety', frequency: 'annual', active: true },
        { id: 'wrong-role', name: 'Billing', role_target: ['billing'], category: 'safety', frequency: 'annual', active: true },
        { id: 'inactive-leak', name: 'Retired', role_target: ['RN'], category: 'safety', frequency: 'annual', active: false },
      ];
    } } } },
  };
  const handler = await loadFunction('listCompetencies', client);
  const response = await handler(request({ role_target: 'rn', category: 'safety', frequency: 'annual' }));
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(queries[0], [{ active: true }, 'name', 5000]);
  assert.deepEqual(json.competencies.map((row) => row.id), ['match']);
  assert.deepEqual(json.competencies[0].role_target, ['RN', 'LPN']);
});

test('policy broker exposes active rows to users but full catalog only to protected built-in admins', async () => {
  let regularReads = 0;
  const regularClient = {
    auth: { me: async () => ({
      email: 'attacker@example.test', role: 'user', account_type: 'super_admin', is_active: true,
    }) },
    asServiceRole: { entities: { PolicyLibrary: {
      filter: async () => { regularReads += 1; return []; },
      list: async () => { regularReads += 1; return []; },
    } } },
  };
  const regularHandler = await loadFunction('listPolicyLibrary', regularClient);
  const forbidden = await regularHandler(request({ mode: 'all' }));
  assert.equal(forbidden.status, 403);
  assert.equal(regularReads, 0);

  const filterCalls = [];
  regularClient.asServiceRole.entities.PolicyLibrary.filter = async (...args) => {
    filterCalls.push(args);
    return [
      { id: 'active', title: 'Active', status: 'active', category: 'clinical' },
      { id: 'draft-leak', title: 'Draft', status: 'draft', category: 'clinical' },
    ];
  };
  const activeResponse = await regularHandler(request({ mode: 'active' }));
  const activeJson = await activeResponse.json();
  assert.equal(activeResponse.status, 200);
  assert.deepEqual(filterCalls[0], [{ status: 'active' }, 'title', 200]);
  assert.deepEqual(activeJson.policies.map((row) => row.id), ['active']);

  let listCalls = 0;
  const adminClient = {
    auth: { me: async () => ({ email: 'admin@example.test', role: 'admin', is_active: true }) },
    asServiceRole: { entities: { PolicyLibrary: { list: async () => {
      listCalls += 1;
      return [
        { id: 'active', title: 'Active', status: 'active' },
        { id: 'draft', title: 'Draft', status: 'draft' },
        { id: 'archived', title: 'Archived', status: 'archived' },
      ];
    } } } },
  };
  const adminHandler = await loadFunction('listPolicyLibrary', adminClient);
  const allResponse = await adminHandler(request({ mode: 'all' }));
  const allJson = await allResponse.json();
  assert.equal(allResponse.status, 200);
  assert.equal(listCalls, 1);
  assert.deepEqual(allJson.policies.map((row) => row.id), ['active', 'draft', 'archived']);
});

test('policy broker rejects anonymous, deactivated, and malformed-mode requests before reads', async () => {
  for (const [user, body, status] of [
    [null, {}, 401],
    [{ email: 'offboarded@example.test', role: 'admin', is_active: false }, { mode: 'all' }, 403],
    [{ email: 'user@example.test', role: 'user', is_active: true }, { mode: { $ne: null } }, 400],
  ]) {
    let reads = 0;
    const client = {
      auth: { me: async () => user },
      asServiceRole: { entities: { PolicyLibrary: {
        list: async () => { reads += 1; return []; },
        filter: async () => { reads += 1; return []; },
      } } },
    };
    const handler = await loadFunction('listPolicyLibrary', client);
    const response = await handler(request(body));
    assert.equal(response.status, status);
    assert.equal(reads, 0);
  }
});
