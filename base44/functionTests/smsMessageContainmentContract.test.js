import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import JSON5 from 'json5';

const here = dirname(fileURLToPath(import.meta.url));
const readEntry = (name) => readFileSync(join(here, '..', 'functions', name, 'entry.ts'), 'utf8');

test('SmsMessage direct access is fully service-only', () => {
  const schema = JSON5.parse(readFileSync(join(here, '..', 'entities', 'SmsMessage.jsonc'), 'utf8'));
  assert.deepEqual(schema.rls, {
    read: false,
    create: false,
    update: false,
    delete: false,
  });
});

test('redriveFailedSms is literally paused before SDK creation or service reads', () => {
  const source = readEntry('redriveFailedSms');
  assert.match(source, /const SMS_REDRIVE_MIGRATION_PAUSED = true;/);
  const handler = source.indexOf('Deno.serve(async (req) =>');
  const pause = source.indexOf('if (SMS_REDRIVE_MIGRATION_PAUSED)', handler);
  const sdk = source.indexOf('createClientFromRequest(req)', handler);
  const messageRead = source.indexOf('entities.SmsMessage', handler);
  assert.ok(handler >= 0 && pause > handler, 'handler and pause gate must exist');
  assert.ok(sdk > pause, 'pause gate must precede SDK creation');
  assert.ok(messageRead > pause, 'pause gate must precede service-role message reads');
  assert.match(source.slice(pause, sdk), /status:\s*503/);
});

test('the protected-owner send broker alone performs SmsMessage bookkeeping', () => {
  const source = readEntry('sendSms');
  const handler = source.slice(source.indexOf('Deno.serve'));
  const ownerGate = handler.indexOf('!isProtectedSuperAdmin(user)');
  const create = handler.indexOf('base44.asServiceRole.entities.SmsMessage.create');
  assert.ok(ownerGate >= 0 && create > ownerGate, 'protected-owner authorization must precede the write');
  assert.doesNotMatch(
    handler,
    /base44\.entities\.SmsMessage\.(?:create|update|delete)/,
    'direct caller-scoped SmsMessage mutations are disabled by entity RLS',
  );
  assert.ok(
    (handler.match(/base44\.asServiceRole\.entities\.SmsMessage\.update/g) || []).length >= 2,
    'provider success and failure reconciliation must remain service-owned',
  );
});
