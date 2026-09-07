import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSON5 from 'json5';

const functionsRoot = new URL('../functions/', import.meta.url);

async function readEntry(name) {
  return readFile(new URL(`${name}/entry.ts`, functionsRoot), 'utf8');
}

test('scheduled and batch fax functions expose one reviewed, fail-closed implementation', async () => {
  const batch = await readEntry('sendBatchFax');
  assert.equal((batch.match(/Deno\.serve\s*\(/g) || []).length, 1);
  assert.doesNotMatch(batch, /FAX_TRANSMISSION_MIGRATION_PAUSED/);
  assert.match(batch, /action === 'dispatch_scheduled'/);
  assert.match(batch, /action === 'dispatch_retry'/);
  assert.match(batch, /verifyFaxInternalCapability/);
  assert.doesNotMatch(batch, /internal_secret:\s*Deno\.env|get\('INTERNAL_FN_SECRET'\)[\s\S]{0,120}functions\.invoke/);
  assert.match(batch, /getAuthorizedDocument/);
  assert.match(batch, /DocumentTenantBinding\.filter/);
  assert.match(batch, /CreateFileSignedUrl/);
  assert.match(batch, /TelecomDestinationBinding\.filter/);
  assert.match(batch, /provider:\s*'telnyx',\s*is_active:\s*true/);
  assert.match(batch, /batch_recipient_key/);
  assert.match(batch, /FaxLog\.updateMany/);
  assert.ok(batch.indexOf('entities.FaxLog.create(') < batch.indexOf("fetch('https://api.telnyx.com/v2/faxes'"));

  const automatic = await readEntry('autoRetryFailedFaxes');
  assert.equal((automatic.match(/Deno\.serve\s*\(/g) || []).length, 1);
  assert.doesNotMatch(automatic, /FAX_TRANSMISSION_MIGRATION_PAUSED/);
  assert.match(automatic, /strictAutomaticRetryCandidate/);
  assert.match(automatic, /provider_submission_state === 'accepted'/);
  assert.match(automatic, /provider_terminal_status === 'failed'/);
  assert.match(automatic, /row\.document_url == null/);
  assert.match(automatic, /FaxLog\.updateMany/);
  assert.match(automatic, /action:\s*'dispatch_retry'/);
  assert.match(automatic, /createFaxInternalCapability/);

  const scheduled = await readEntry('processScheduledFaxes');
  assert.equal((scheduled.match(/Deno\.serve\s*\(/g) || []).length, 1);
  assert.match(scheduled, /scheduledProvenanceIsComplete/);
  assert.match(scheduled, /ScheduledFax\.updateMany/);
  assert.match(scheduled, /reconcileStaleScheduledClaims/);
  assert.match(scheduled, /duplicate_schedule_key/);
  assert.match(scheduled, /action:\s*'dispatch_scheduled'/);
  assert.match(scheduled, /createFaxInternalCapability/);

  const priority = await readEntry('processScheduledFaxesByPriority');
  assert.equal((priority.match(/Deno\.serve\s*\(/g) || []).length, 1);
  assert.match(priority, /functions\.invoke\('processScheduledFaxes'/);
  assert.doesNotMatch(priority, /ScheduledFax\.(?:filter|create|update)|api\.telnyx\.com/);

  const retry = await readEntry('retryFailedFax');
  assert.equal((retry.match(/Deno\.serve\s*\(/g) || []).length, 1);
  const retryHandler = retry.slice(retry.lastIndexOf('Deno.serve'));
  assert.match(retryHandler, /functions\.invoke\('sendAuthorizedReferralFax'/);
  assert.match(retryHandler, /retry_fax_log_id:\s*faxLogId/);
  assert.doesNotMatch(retryHandler, /FaxLog\.(?:create|update|updateMany)|api\.telnyx\.com/);
});

test('ScheduledFax is inaccessible through direct SDK operations', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/ScheduledFax.jsonc', import.meta.url),
    'utf8',
  ));

  assert.equal(schema.name, 'ScheduledFax');
  assert.deepEqual(schema.rls, {
    read: false,
    create: false,
    update: false,
    delete: false,
  });
});

test('live fax reconciliation never releases an unproved replacement for another retry', async () => {
  const poller = await readEntry('pollFaxStatuses');
  assert.match(poller, /\{\s*retry_of_fax_log_id:\s*fax\.id\s*\}/);
  assert.match(poller, /provider_submission_state\s*===\s*'rejected'/);
  assert.match(poller, /const nextStatus = children\.length === 0 \|\| definitelyRejected \? 'failed' : 'retried'/);
  assert.match(poller, /entities\.FaxLog\.updateMany\s*\(/);
  assert.doesNotMatch(
    poller.slice(poller.indexOf('Deno.serve')),
    /entities\.User\s*\.\s*filter\s*\(/,
    'retry policy cannot be derived from mutable User agency fields',
  );
});

test('FaxLog records provider submission certainty and retry provenance', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/FaxLog.jsonc', import.meta.url),
    'utf8',
  ));
  assert.ok(schema.properties.status.enum.includes('submission_unknown'));
  assert.deepEqual(schema.properties.provider_submission_state.enum, [
    'pending',
    'accepted',
    'rejected',
    'indeterminate',
  ]);
  for (const field of [
    'provider_submission_attempt_id',
    'provider_accepted_at',
    'provider_terminal_status',
    'provider_terminal_at',
    'retry_of_fax_log_id',
    'retry_generation',
    'retry_claimed_by_user_id',
    'scheduled_fax_id',
    'batch_request_key',
    'batch_recipient_key',
    'document_binding_id',
    'document_content_sha256',
    'integration_secret_id',
    'integration_secret_updated_at',
    'fax_connection_id',
    'sender_telecom_binding_id',
  ]) {
    assert.ok(schema.properties[field], `${field} must remain declared`);
  }
});
