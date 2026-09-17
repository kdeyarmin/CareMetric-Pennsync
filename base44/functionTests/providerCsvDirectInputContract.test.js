import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// Synthetic directory fixtures, actual transpiled handler, no network/provider access.
const source = readFileSync(new URL('../functions/importProvidersCsv/entry.ts', import.meta.url), 'utf8')
  .replace(/import \{ createClientFromRequest \} from 'npm:@base44\/sdk@[^']+';/, 'const createClientFromRequest = () => sdk;');
const csv = 'Physician Name,Title,Fax Number,Work Number,NPI,Specialty\r\n"Smith, Jane",MD,(814) 555-0123,814-555-0987,1234567890,Family Medicine';
const admin = { id: 'admin-fixture', email: 'admin@example.test', role: 'admin', is_active: true };

function harness({ user = admin, existing = [], download = () => new Response(csv) } = {}) {
  let handler; let directoryReads = 0; const writes = []; const downloads = [];
  const sdk = {
    auth: { async me() { return user; } },
    asServiceRole: { entities: {
      AgencyMembership: { async filter() { return []; } },
      Physician: {
        async list() { directoryReads++; return structuredClone(existing); },
        async create(data) { writes.push({ operation: 'create', data: structuredClone(data) }); return { id: 'synthetic-created' }; },
        async update(id, data) { writes.push({ operation: 'update', id, data: structuredClone(data) }); return { id }; },
      },
    } },
  };
  Object.defineProperty(sdk, 'integrations', { get() { assert.fail('Paid integration attempted'); } });
  Object.defineProperty(sdk.asServiceRole, 'integrations', { get() { assert.fail('Paid service integration attempted'); } });
  runInNewContext(transpileTs(source).outputText, { sdk, Response, TextEncoder, console: { error() {} },
    URL, setTimeout: callback => { callback(); return 0; }, Deno: { serve: value => { handler = value; } },
    fetch: async (url, options) => { downloads.push({ url, options }); return download(url, options); },
  }, { timeout: 1000 });
  return {
    async call(input) {
      const response = await handler(new Request('https://test.invalid/importProvidersCsv', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      }));
      return { status: response.status, body: await response.json() };
    },
    async malformed() {
      const response = await handler(new Request('https://test.invalid/importProvidersCsv', { method: 'POST', body: '{bad' }));
      return { status: response.status, body: await response.json() };
    },
    writes, downloads, reads: () => directoryReads,
  };
}

test('direct provider CSV performs the original authorized import without any storage download or Core integration', async () => {
  const h = harness(); const result = await h.call({ csv_text: csv });
  assert.equal(result.status, 200); assert.equal(result.body.success, true);
  assert.equal(result.body.created_providers, 1); assert.equal(result.body.updated_providers, 0);
  assert.equal(h.downloads.length, 0); assert.equal(h.reads(), 1);
  assert.equal(h.writes[0].data.full_name, 'Jane Smith');
  assert.equal(h.writes[0].data.fax_number, '8145550123');
  assert.equal(h.writes[0].data.npi_number, '1234567890');
});
test('direct and existing hosted-file input retain identical directory semantics', async () => {
  const existing = [{ id: 'existing-npi', npi_number: '1234567890', full_name: 'Jane Smith', fax_number: '8145550123' }];
  const direct = harness({ existing }); const legacy = harness({ existing });
  assert.deepEqual(await direct.call({ csv_text: csv }), await legacy.call({ file_url: 'https://base44.io/files/fixture.csv' }));
  assert.deepEqual(direct.writes, legacy.writes); assert.equal(direct.downloads.length, 0); assert.equal(legacy.downloads.length, 1);
  assert.equal(legacy.downloads[0].options.redirect, 'manual');
});
for (const input of [{}, [], null, { csv_text: csv, file_url: 'https://base44.io/files/fixture.csv' },
  { csv_text: null }, { csv_text: false }, { csv_text: [] }, { csv_text: {} }, { csv_text: '' }, { csv_text: ' \n\t ' },
  { file_url: {} }, { file_url: 'https://unapproved.example.test/fixture.csv' }]) {
  test(`invalid direct/legacy source ${JSON.stringify(input).slice(0, 90)} cannot read or modify the directory`, async () => {
    const h = harness(); assert.equal((await h.call(input)).status, 400);
    assert.equal(h.downloads.length, 0); assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
  });
}
test('invalid JSON is a clear input error rather than a successful empty import', async () => {
  const h = harness(); assert.equal((await h.malformed()).status, 400); assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
});
for (const user of [null, { ...admin, is_active: false }, { id: 'employee', email: 'staff@example.test', role: 'user', account_type: 'agency_admin', is_manager: true }]) {
  test(`unauthenticated, deactivated or editable-profile admin cannot use direct CSV access (${user?.id || 'anonymous'})`, async () => {
    const h = harness({ user }); assert.equal((await h.call({ csv_text: csv })).status, 403);
    assert.equal(h.downloads.length, 0); assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
  });
}
test('the direct source preserves the 10 MiB byte limit, not just a UTF-16 string length limit', async () => {
  for (const text of ['x'.repeat(10 * 1024 * 1024 + 1), 'Ω'.repeat(5 * 1024 * 1024 + 1)]) {
    const h = harness(); const result = await h.call({ csv_text: text });
    assert.equal(result.status, 413); assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
  }
});
test('legacy redirect safety is unchanged and no disallowed destination is requested', async () => {
  const h = harness({ download: () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/private' } }) });
  assert.equal((await h.call({ file_url: 'https://base44.io/files/fixture.csv' })).status, 400);
  assert.equal(h.downloads.length, 1); assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
});
test('header-only CSV retains the prior empty-file error and never writes data', async () => {
  const h = harness(); assert.equal((await h.call({ csv_text: 'physician_name,fax_number' })).status, 400);
  assert.equal(h.reads(), 0); assert.equal(h.writes.length, 0);
});
