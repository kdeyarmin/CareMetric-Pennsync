import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSON5 from 'json5';

const functionsRoot = new URL('../functions/', import.meta.url);

async function readEntry(name) {
  return readFile(new URL(`${name}/entry.ts`, functionsRoot), 'utf8');
}

test('every adjacent fax transmitter pauses before SDK construction', async () => {
  const names = [
    'sendBatchFax',
    'retryFailedFax',
    'autoRetryFailedFaxes',
    'processScheduledFaxes',
    'processScheduledFaxesByPriority',
  ];

  for (const name of names) {
    const source = await readEntry(name);
    assert.match(
      source,
      /const FAX_TRANSMISSION_MIGRATION_PAUSED = true;/,
      `${name} pause must be literal and fail-closed`,
    );

    const handler = source.slice(source.indexOf('Deno.serve'));
    const pauseGate = handler.indexOf('if (FAX_TRANSMISSION_MIGRATION_PAUSED)');
    const clientCreation = handler.indexOf('createClientFromRequest(req)');
    assert.notEqual(pauseGate, -1, `${name} must check the pause in its handler`);
    assert.notEqual(clientCreation, -1, `${name} must retain its dormant implementation`);
    assert.ok(
      pauseGate < clientCreation,
      `${name} must return from its pause gate before SDK construction or any hosted read/write`,
    );

    const pauseResponse = handler.slice(pauseGate, clientCreation);
    assert.match(pauseResponse, /code:\s*'fax_authority_migration_pending'/);
    assert.match(pauseResponse, /status:\s*503/);
  }
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
