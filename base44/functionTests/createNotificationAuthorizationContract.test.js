import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../functions/createNotification/entry.ts', import.meta.url),
  'utf8',
);

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
    'agency_id: scope.recipientMembership.agencyId',
    'recipient_user_id: recipient.id',
    'recipient_membership_id: scope.recipientMembership.id',
    'recipient_membership_version: scope.recipientMembership.version',
    'authority_version: 1',
    'version: 1',
  ]) assert.ok(source.includes(field), `missing secure notification field: ${field}`);
  assert.match(source, /agency_id: scope\.recipientMembership\.agencyId,[\s\S]*created_by: recipient\.email/);
});

test('notification requests are bounded and reject unsupported fields', () => {
  assert.match(source, /MAX_BODY_BYTES = 20_000/);
  assert.match(source, /Request contains unsupported fields/);
  assert.match(source, /req\.method !== 'POST'/);
  assert.match(source, /new TextEncoder\(\)\.encode\(raw\)\.byteLength/);
});
