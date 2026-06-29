import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildEntrySource, extractEmbeddedEngine } from '../../../tools-sync-dedupe-engine.mjs';

const ENTRY_URL = new URL('./entry.ts', import.meta.url);
const ENGINE_URL = new URL(
  '../../../src/components/patient/patientDuplicateUtils.js',
  import.meta.url
);

// The deduplicatePatients edge function runs on Deno and cannot import from
// src/, so the matching engine is embedded verbatim. These tests guarantee the
// embedded copy never silently drifts from the unit-tested source of truth.

test('embedded dedupe engine is in sync with patientDuplicateUtils.js', async () => {
  const current = await readFile(ENTRY_URL, 'utf8');
  const expected = await buildEntrySource();
  assert.equal(
    current,
    expected,
    'entry.ts is out of sync — run `npm run sync:dedupe-engine` to regenerate it'
  );
});

test('embedded engine matches the source module verbatim', async () => {
  const entry = await readFile(ENTRY_URL, 'utf8');
  const engine = (await readFile(ENGINE_URL, 'utf8')).trim();
  assert.equal(extractEmbeddedEngine(entry), engine);
});

test('entry.ts uses the shared engine exports it depends on', async () => {
  const entry = await readFile(ENTRY_URL, 'utf8');
  for (const symbol of ['findDuplicateGroups', 'normalizeName', 'REASON']) {
    assert.ok(entry.includes(symbol), `entry.ts should reference ${symbol}`);
  }
});
