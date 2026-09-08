import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSON5 from 'json5';

const readFunction = (name) => readFile(
  new URL(`../functions/${name}/entry.ts`, import.meta.url),
  'utf8',
);

function assertOrderedBefore(source, needles, boundary, label) {
  const boundaryIndex = source.indexOf(boundary);
  assert.notEqual(boundaryIndex, -1, `${label}: missing boundary ${boundary}`);

  for (const needle of needles) {
    const index = source.indexOf(needle);
    assert.notEqual(index, -1, `${label}: missing authorization gate ${needle}`);
    assert.ok(index < boundaryIndex, `${label}: ${needle} must run before the service-role FaxLog write`);
  }
}

test('sendFax elevates only FaxLog writes after its authorization and destination gates', async () => {
  const source = await readFunction('sendFax');
  const serviceWrites = source.match(
    /base44\.asServiceRole\.entities\.FaxLog\.(?:create|update)\s*\(/g,
  ) || [];

  assert.equal(serviceWrites.length, 4, 'all four sendFax FaxLog writes use the service role');
  assert.doesNotMatch(
    source,
    /base44\.entities\.FaxLog\.(?:create|update)\s*\(/,
    'sendFax must not rely on caller RLS for authorized FaxLog writes',
  );
  assertOrderedBefore(source, [
    "if (!user) return Response.json({ error: 'Unauthorized' }",
    'if (!isSafeFetchUrl(file_url))',
    'if (!destAllowed.allowed)',
    'if (!apiKey || !faxConnectionId)',
    'if (!fromNumber)',
  ], 'base44.asServiceRole.entities.FaxLog.create(', 'sendFax');
});

test('retryFailedFax delegates to the reviewed referral broker and never writes FaxLog', async () => {
  const source = await readFunction('retryFailedFax');
  const handler = source.slice(source.lastIndexOf('Deno.serve'));
  const serviceWrites = source.match(
    /base44\.asServiceRole\.entities\.FaxLog\.(?:create|update)\s*\(/g,
  ) || [];

  assert.equal(serviceWrites.length, 0);
  assert.doesNotMatch(source, /(?:base44\.)?entities\.FaxLog\.(?:create|update|updateMany)\s*\(/);
  assert.match(handler, /base44\.functions\.invoke\('sendAuthorizedReferralFax',\s*\{/);
  assert.match(handler, /retry_fax_log_id:\s*faxLogId/);
  assert.doesNotMatch(handler, /document_url|file_url|api\.telnyx\.com/);
});

test('FaxLog browser access is sender-read-only and all writes require a backend workflow', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/FaxLog.jsonc', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.rls, {
    read: { 'data.sent_by': '{{user.email}}' },
    create: false,
    update: false,
    delete: false,
  });
});

test('FaxContact browser access requires both immutable creator and matching owner field', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/FaxContact.jsonc', import.meta.url),
    'utf8',
  ));
  const ownerRule = {
    $and: [
      { created_by: '{{user.email}}' },
      { 'data.user_email': '{{user.email}}' },
    ],
  };
  for (const operation of ['create', 'read', 'update', 'delete']) {
    assert.deepEqual(schema.rls[operation], ownerRule, operation);
  }

  const addressBook = await readFile(
    new URL('../../src/components/fax/FaxAddressBook.jsx', import.meta.url),
    'utf8',
  );
  const contactsTab = await readFile(
    new URL('../../src/components/hub-tabs/FaxContacts.jsx', import.meta.url),
    'utf8',
  );
  for (const [name, source] of [['FaxAddressBook', addressBook], ['FaxContacts', contactsTab]]) {
    assert.match(source, /user_email:\s*currentUser\?\.email/, `${name} must stamp its owner`);
    assert.match(source, /if \(!currentUser\?\.email\)/, `${name} must fail closed without identity`);
  }
});

test('FaxTemplate browser access is pinned to its immutable creator', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/FaxTemplate.jsonc', import.meta.url),
    'utf8',
  ));
  const ownerRule = { created_by: '{{user.email}}' };
  for (const operation of ['create', 'read', 'update', 'delete']) {
    assert.deepEqual(schema.rls[operation], ownerRule, operation);
  }
});
