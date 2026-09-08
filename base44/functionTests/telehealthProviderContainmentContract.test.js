import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSON5 from 'json5';

const entryUrl = new URL('../functions/createTelehealthToken/entry.ts', import.meta.url);

test('createTelehealthToken is literally paused before SDK construction or provider access', async () => {
  const source = await readFile(entryUrl, 'utf8');

  assert.match(source, /const TELEHEALTH_PROVIDER_MIGRATION_PAUSED = true;/);

  const handler = source.slice(source.indexOf('Deno.serve'));
  const pauseGate = handler.indexOf('if (TELEHEALTH_PROVIDER_MIGRATION_PAUSED)');
  const clientCreation = handler.indexOf('createClientFromRequest(req)');
  const sessionRead = handler.indexOf('entities.TelehealthSession');
  const providerCall = handler.indexOf('findOrCreateRoom(');

  assert.notEqual(pauseGate, -1, 'the handler must check the literal pause');
  assert.notEqual(clientCreation, -1, 'the dormant SDK implementation must remain present');
  assert.notEqual(sessionRead, -1, 'the dormant session lookup must remain present');
  assert.notEqual(providerCall, -1, 'the dormant Telnyx implementation must remain present');
  assert.ok(pauseGate < clientCreation, 'the pause must precede SDK construction');
  assert.ok(pauseGate < sessionRead, 'the pause must precede service-role session reads');
  assert.ok(pauseGate < providerCall, 'the pause must precede provider calls');

  const responseSource = handler.slice(pauseGate, clientCreation);
  assert.match(responseSource, /code:\s*'telehealth_provider_migration_pending'/);
  assert.match(responseSource, /status:\s*503/);
});

test('TelehealthSession is inaccessible through direct SDK operations', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/TelehealthSession.jsonc', import.meta.url),
    'utf8',
  ));

  assert.equal(schema.name, 'TelehealthSession');
  assert.deepEqual(schema.rls, {
    read: false,
    create: false,
    update: false,
    delete: false,
  });
});
