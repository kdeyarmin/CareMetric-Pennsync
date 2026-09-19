import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DISPOSITIONS, FORMAT, FORMAT_VERSION, checkCoverage, discoverCapabilities,
  discoverIntegrations, main, parseManifest,
} from './tools-transition-disposition.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const manifest = (patch = {}) => ({
  format: FORMAT, version: FORMAT_VERSION, review_state: 'proposed',
  functions: { alpha: 'port' }, entities: { Beta: 'broker' },
  workflows: { 'Gamma.jsonc': 'preserved_paused' }, integrations: { InvokeLLM: 'port' },
  ...patch,
});
const capabilities = (patch = {}) => ({
  functions: ['alpha'], entities: ['Beta'], workflows: ['Gamma.jsonc'], integrations: ['InvokeLLM'], ...patch,
});

test('every repository capability carries exactly one disposition', () => {
  // The committed manifest is the gate: a new function, entity, workflow or
  // Core integration fails this test until it is classified.
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const report = checkCoverage(discoverCapabilities(repository), parseManifest(raw));
  assert.deepEqual(report.missing_disposition, []);
  assert.deepEqual(report.unknown_capability, []);
  assert.equal(report.coverage_complete, true);
  assert.ok(report.families.functions.capabilities > 250);
  assert.ok(report.families.entities.capabilities > 250);
});

test('the committed manifest never reports itself as reviewed or authorized', () => {
  const report = main(['--summary'], { repository, log: () => {} });
  assert.equal(report, 0);
});

test('a capability without a disposition is reported as missing', () => {
  const report = checkCoverage(capabilities({ functions: ['alpha', 'delta'] }), manifest());
  assert.deepEqual(report.missing_disposition, ['functions:delta']);
  assert.equal(report.coverage_complete, false);
});

test('a manifest entry for a removed capability is reported as unknown', () => {
  const report = checkCoverage(capabilities({ entities: [] }), manifest());
  assert.deepEqual(report.unknown_capability, ['entities:Beta']);
  assert.equal(report.coverage_complete, false);
});

test('undecided entries block the census even when coverage is complete', () => {
  const report = checkCoverage(capabilities(), manifest({ functions: { alpha: 'undecided' } }));
  assert.equal(report.coverage_complete, true);
  assert.deepEqual(report.undecided, ['functions:alpha']);
  assert.equal(report.census_ready, false);
});

test('the census is ready only when owners accepted and nothing is undecided', () => {
  assert.equal(checkCoverage(capabilities(), manifest()).census_ready, false);
  assert.equal(checkCoverage(capabilities(), manifest({ review_state: 'accepted' })).census_ready, true);
  assert.equal(checkCoverage(capabilities(), manifest({
    review_state: 'accepted', entities: { Beta: 'undecided' },
  })).census_ready, false);
  // Repository coverage never implies hosted reconciliation or permission.
  const report = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }));
  assert.equal(report.hosted_inventory_reconciled, false);
  assert.equal(report.migration_authorized, false);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify(manifest({ format: 'other' })),
  wrongVersion: JSON.stringify(manifest({ version: 2 })),
  unknownField: JSON.stringify({ ...manifest(), extra: true }),
  invalidReviewState: JSON.stringify(manifest({ review_state: 'signed' })),
  invalidDisposition: JSON.stringify(manifest({ functions: { alpha: 'maybe' } })),
  familyNotObject: JSON.stringify(manifest({ entities: [] })),
})) {
  test(`manifest rejects ${name}`, () => assert.throws(() => parseManifest(raw)));
}

test('accepted dispositions are the exact reviewed set', () => {
  assert.deepEqual([...DISPOSITIONS].sort(), ['broker', 'hub', 'port', 'preserved_paused', 'retire', 'undecided']);
  for (const value of DISPOSITIONS) assert.doesNotThrow(() => parseManifest(JSON.stringify(manifest({ functions: { alpha: value } }))));
});

test('discovered integrations include every adapter the external runtime implements', () => {
  const discovered = discoverIntegrations(repository);
  for (const operation of ['InvokeLLM', 'ExtractDataFromUploadedFile', 'SendEmail',
    'UploadFile', 'UploadPrivateFile', 'CreateFileSignedUrl']) {
    assert.ok(discovered.includes(operation), `missing ${operation}`);
  }
  // Discovered from source, not a hand-kept list.
  assert.ok(discovered.includes('GenerateImage'));
});

test('the command line refuses unknown arguments and an unavailable manifest', () => {
  const lines = [];
  assert.equal(main(['--apply'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
  lines.length = 0;
  assert.equal(main([], { repository: resolve(repository, 'src'), log: value => lines.push(value) }), 2);
  assert.ok(JSON.parse(lines[0]).error);
});
