import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import JSON5 from 'json5';

const here = dirname(fileURLToPath(import.meta.url));
const readEntry = (name) => readFileSync(join(here, '..', 'functions', name, 'entry.ts'), 'utf8');

test('SmsMessage: a nurse reads their own texts and may only mark their own rows; writers stay server-side', () => {
  // Restored 2026-10-08 for the Phone Center inbox. Nobody creates or deletes
  // an SmsMessage from a browser; a nurse may update (mark read) only rows
  // addressed to them.
  const schema = JSON5.parse(readFileSync(join(here, '..', 'entities', 'SmsMessage.jsonc'), 'utf8'));
  assert.deepEqual(schema.rls, {
    read: {
      $or: [
        { 'data.nurse_email': '{{user.email}}' },
        { 'data.sent_by': '{{user.email}}' },
        { user_condition: { role: 'admin' } },
      ],
    },
    create: false,
    update: { 'data.nurse_email': '{{user.email}}' },
    delete: false,
  });
});

test('scheduled SMS workers apply the global outbound gate before SDK creation', () => {
  // dispatchScheduledSms lost its narrower pause when scheduled texting was
  // released (2026-10-08); redriveFailedSms keeps its own.
  assert.doesNotMatch(readEntry('dispatchScheduledSms'), /SCHEDULED_SMS_DISPATCH_PAUSED/);
  for (const [name, literal] of [
    ['dispatchScheduledSms', null],
    ['redriveFailedSms', 'const SMS_REDRIVE_MIGRATION_PAUSED = true;'],
  ]) {
    const source = readEntry(name);
    assert.match(source, /<<<BEGIN SHARED HELPER: outboundDeliveryGate/);
    if (literal) assert.ok(source.includes(literal), `${name} retains its narrower migration pause`);
    const handler = source.indexOf('Deno.serve(async (req) =>');
    const releaseGate = source.indexOf("if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('sms')", handler);
    const sdk = source.indexOf('createClientFromRequest(', handler);
    assert.ok(handler >= 0 && releaseGate > handler, `${name} handler and outbound gate must exist`);
    assert.ok(sdk > releaseGate, `${name} must fail closed before SDK creation and queue access`);
  }
});

test('redriveFailedSms is literally paused before SDK creation or service reads', () => {
  const source = readEntry('redriveFailedSms');
  assert.match(source, /const SMS_REDRIVE_MIGRATION_PAUSED = true;/);
  const handler = source.indexOf('Deno.serve(async (req) =>');
  const pause = source.indexOf('if (SMS_REDRIVE_MIGRATION_PAUSED)', handler);
  const sdk = source.indexOf('createClientFromRequest(', handler);
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
