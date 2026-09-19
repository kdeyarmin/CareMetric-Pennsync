import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTATIONS_FILE, FORMAT, FORMAT_VERSION, KINDS,
  buildCensus, censusEntity, classifyField, compareCensus, main, parseExpectations,
} from './tools-file-reference-census.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const expectations = () => parseExpectations(readFileSync(resolve(repository, EXPECTATIONS_FILE), 'utf8'));

test('every entity schema parses, so no file field can be missed by a parse failure', () => {
  const census = buildCensus(repository);
  assert.equal(census.totals.unreadable, 0);
  assert.equal(census.totals.entities, 253);
  assert.ok(census.totals.locator_fields > 50);
});

test('the committed census still matches the schemas', () => {
  const report = compareCensus(buildCensus(repository), expectations());
  assert.deepEqual(report.added, [], 'A new file-bearing field appeared. Classify it and update the census.');
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.reclassified, []);
  assert.equal(report.matches_expectations, true);
});

test('the census finds real locators and excludes fields that address nothing stored', () => {
  const census = buildCensus(repository);
  const locators = new Set();
  for (const [entity, fields] of Object.entries(census.entities)) {
    for (const field of fields) if (field.kind === 'locator') locators.add(`${entity}.${field.path}`);
  }
  for (const reference of ['Document.file_url', 'PatientDocument.file_url', 'DocumentRecord.previous_versions[].file_url']) {
    assert.ok(locators.has(reference), `expected locator ${reference}`);
  }
  // A boolean flag and an in-app destination are not stored objects.
  assert.equal(locators.has('EmbedConfig.allow_download'), false);
  assert.equal(locators.has('Notification.action_url'), false);
  // Nested and array paths are reachable, not just top-level fields.
  assert.ok([...locators].some(reference => reference.includes('[]')));
});

test('a description containing a URL does not corrupt the schema it belongs to', () => {
  // The naive comment stripper this tool replaced turned "https://x" into a
  // parse failure, which silently dropped every field in the entity.
  const raw = `{
    // leading comment
    "name": "Probe",
    "type": "object",
    "properties": {
      "file_url": { "type": "string", "description": "See https://docs.example.test/path for the format" },
      "note": { "type": "string" }, /* trailing block */
    }
  }`;
  const result = censusEntity('Probe', raw);
  assert.equal(result.unreadable, false);
  assert.deepEqual(result.fields, [{ path: 'file_url', kind: 'locator', type: 'string' }]);
});

test('classification separates locators, descriptors and everything else', () => {
  assert.equal(classifyField('file_url', { type: 'string' }), 'locator');
  assert.equal(classifyField('document_urls', { type: 'array', items: { type: 'string' } }), 'locator');
  assert.equal(classifyField('avatar', { type: 'string', format: 'uri' }), 'locator');
  assert.equal(classifyField('file_name', { type: 'string' }), 'descriptor');
  assert.equal(classifyField('file_size', { type: 'number' }), 'descriptor');
  assert.equal(classifyField('mime_type', { type: 'string' }), 'descriptor');
  // Not addresses of stored bytes.
  assert.equal(classifyField('allow_download', { type: 'boolean' }), null);
  assert.equal(classifyField('page_url', { type: 'number' }), null);
  assert.equal(classifyField('callback_url', { type: 'string' }), null);
  assert.equal(classifyField('action_url', { type: 'string' }), null);
  assert.equal(classifyField('patient_id', { type: 'string' }), null);
  assert.equal(classifyField('', { type: 'string' }), null);
  assert.equal(classifyField('document_ids', { type: 'array', items: { type: 'object' } }), null);
});

test('census changes are reported by kind so a reclassification cannot pass silently', () => {
  const census = { entities: { Probe: [{ path: 'file_url', kind: 'locator', type: 'string' }] }, totals: {} };
  const recorded = { entities: { Probe: [{ path: 'file_url', kind: 'descriptor' }] } };
  const report = compareCensus(census, recorded);
  assert.deepEqual(report.reclassified, [{ reference: 'Probe.file_url', was: 'descriptor', now: 'locator' }]);
  assert.equal(report.matches_expectations, false);

  const added = compareCensus(census, { entities: {} });
  assert.deepEqual(added.added, ['Probe.file_url']);
  const removed = compareCensus({ entities: {}, totals: {} }, recorded);
  assert.deepEqual(removed.removed, ['Probe.file_url']);
});

test('the census never claims to have inventoried or copied anything', () => {
  const census = buildCensus(repository);
  assert.equal(census.hosted_inventory_performed, false);
  assert.equal(census.object_bytes_read, 0);
  assert.equal(census.files_copied, 0);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify({ format: 'other', schema_version: FORMAT_VERSION, entities: {} }),
  wrongVersion: JSON.stringify({ format: FORMAT, schema_version: 2, entities: {} }),
  entitiesNotObject: JSON.stringify({ format: FORMAT, schema_version: FORMAT_VERSION, entities: [] }),
  fieldNotArray: JSON.stringify({ format: FORMAT, schema_version: FORMAT_VERSION, entities: { Probe: {} } }),
  invalidKind: JSON.stringify({ format: FORMAT, schema_version: FORMAT_VERSION, entities: { Probe: [{ path: 'a', kind: 'maybe' }] } }),
})) {
  test(`expectations reject ${name}`, () => assert.throws(() => parseExpectations(raw)));
}

test('the recorded kinds are exactly the reviewed set', () => {
  assert.deepEqual([...KINDS].sort(), ['descriptor', 'locator']);
});

test('the command line reports, updates explicitly and refuses unknown arguments', () => {
  const lines = [];
  assert.equal(main(['--summary'], { repository, log: value => lines.push(value) }), 0);
  assert.match(lines[0], /file references unchanged/);
  lines.length = 0;
  assert.equal(main(['--apply'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
  lines.length = 0;
  let written = null;
  assert.equal(main(['--update'], { repository, log: value => lines.push(value), write: (path, body) => { written = { path, body }; } }), 0);
  assert.ok(written.path.endsWith(EXPECTATIONS_FILE));
  assert.equal(parseExpectations(written.body).format, FORMAT);
  lines.length = 0;
  assert.equal(main([], { repository: resolve(repository, 'src'), log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'ENTITY_SCHEMAS_UNAVAILABLE');
});
