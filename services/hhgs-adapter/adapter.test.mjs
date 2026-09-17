import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { groupCmsClaims, javaEnvironment, parseOutcome, readArtifactSnapshot, readOutcomes, validateClaims } from './adapter.mjs';

const record = (date = '20260101') => ' '.repeat(24) + date + ' '.repeat(568);
const replace = (value, index, text) => value.slice(0, index) + text + value.slice(index + text.length);

test('uses claim-from date at the exact official columns and every release boundary', () => {
  const dates = ['20260101', '20260331', '20260401', '20260930', '20261001', '20261231'];
  assert.deepEqual(validateClaims(dates.map(record)).map(c => c.release.version),
    ['07.0.26', '07.0.26', '07.1.26', '07.1.26', '07.2.26', '07.2.26']);
  assert.equal(validateClaims([replace(record(), 349, '20261001')])[0].release.version, '07.0.26');
});

for (const date of ['        ', '20260229', '20260431', '20251301', '20251231', '20270101', '2026A101']) {
  test(`rejects unsupported or invalid claim-from date ${JSON.stringify(date)}`, () => {
    assert.throws(() => validateClaims([record(date)]), /^Error: hhgs_unsupported_claim_date$/);
  });
}

test('requires complete fixed-width ASCII input, without embedded outputs or controls', () => {
  for (const input of [null, {}, record().slice(1), record() + ' ', record() + '07.0.261AA110000',
    replace(record(), 0, '\n'), replace(record(), 0, '\r'), replace(record(), 0, '\t'),
    replace(record(), 0, '\0'), replace(record(), 0, 'é'), replace(record(), 0, '\x7f')]) {
    assert.throws(() => validateClaims([input]), /^Error: hhgs_invalid_record$/);
  }
});

test('rejects report, skip and unknown action flags', () => {
  for (const action of ['D', 'Y', 'S', 'd', 'y', 's', '0']) {
    assert.throws(() => validateClaims([replace(record(), 599, action)]), /hhgs_action_flag_forbidden/);
  }
});

test('bounds batches and rejects sparse inputs', () => {
  for (const input of [undefined, {}, [], Array(1001).fill(record())]) {
    assert.throws(() => validateClaims(input), /hhgs_invalid_batch/);
  }
  assert.throws(() => validateClaims(Array(2)), /hhgs_invalid_record/);
  assert.equal(validateClaims(Array(1000).fill(record())).length, 1000);
});

test('keeps CMS validity and return codes separate from payment availability', () => {
  assert.deepEqual(parseOutcome('07.0.261AA110000', '07.0.26'), {
    version: '07.0.26', hipps: '1AA11', validityFlag: '00', returnCode: '00', raw: '07.0.261AA110000',
  });
  assert.equal(parseOutcome('07.0.26000000603', '07.0.26').returnCode, '03');
  assert.equal(parseOutcome('07.0.261AA111500', '07.0.26').validityFlag, '15');
});

test('rejects wrong release and unsupported versions', () => {
  assert.throws(() => parseOutcome('07.2.261AA110000', '07.0.26'), /hhgs_version_mismatch/);
  assert.throws(() => parseOutcome('08.0.271AA110000', '08.0.27'), /hhgs_version_mismatch/);
});

test('rejects malformed, fatal and contradictory CMS outcomes', () => {
  for (const raw of ['', null, '07.0.261AA110000\n', '07.0.261AA110050', '07.0.26000000000',
    '07.0.261AA110001', '07.0.26ZZZZZ0000', '07.0.261AA119900', '07.0.26000000006']) {
    assert.throws(() => parseOutcome(raw, '07.0.26'), /hhgs_invalid_output/);
  }
});

test('requires a complete bounded response, never partial results or echoed input', () => {
  const result = '07.0.261AA110000';
  assert.equal(readOutcomes(`${result}\r\n${result}\r\n`, 2, '07.0.26').length, 2);
  for (const output of [result, `${result}\n\n`, `${result}\n`, `${record()}${result}\n${result}\n`]) {
    assert.throws(() => readOutcomes(output, 2, '07.0.26'), /hhgs_(invalid_output|output_count_mismatch)/);
  }
});

test('removes inherited JVM agents, classpaths, loader hooks and credentials', () => {
  assert.deepEqual(javaEnvironment({ SystemRoot: 'C:\\Windows', TEMP: '/tmp', PATH: '/bin',
    JAVA_TOOL_OPTIONS: 'agent', JDK_JAVA_OPTIONS: 'agent', _JAVA_OPTIONS: 'agent',
    CLASSPATH: '/untrusted', LD_PRELOAD: '/untrusted', AWS_SECRET_ACCESS_KEY: 'secret' }),
  { SystemRoot: 'C:\\Windows', TEMP: '/tmp' });
});

test('validates the whole batch before consulting local configuration', () => {
  assert.throws(() => groupCmsClaims({ records: [record(), 'private marker'] }), /^Error: hhgs_invalid_record$/);
  for (const timeoutMs of [0, 99, 60001, Infinity, '60000']) {
    assert.throws(() => groupCmsClaims({ records: [record()], javaExecutable: process.execPath, timeoutMs }), /hhgs_invalid_configuration/);
  }
  assert.throws(() => groupCmsClaims({ records: [record()], javaExecutable: 'java' }), /hhgs_invalid_configuration/);
});

test('malformed options never escape the fixed adapter error boundary', () => {
  for (const options of [null, [], 'private options', 1, false]) {
    assert.throws(() => groupCmsClaims(options), /^Error: hhgs_invalid_configuration$/);
  }
});

test('refuses missing or tampered CMS code before executing a child', () => {
  const root = mkdtempSync(join(tmpdir(), 'hhgs-test-'));
  try {
    const jar = join(root, 'private-marker.jar');
    const options = { records: [record()], javaExecutable: process.execPath };
    assert.throws(() => groupCmsClaims(options), /^Error: hhgs_missing_artifact$/);
    assert.throws(() => groupCmsClaims({ ...options, jarPaths: { '07.0.26': jar } }), /^Error: hhgs_execution_failed$/);
    writeFileSync(jar, 'not CMS');
    assert.throws(() => groupCmsClaims({ ...options, jarPaths: { '07.0.26': jar } }), /^Error: hhgs_artifact_hash_mismatch$/);
    assert.throws(() => groupCmsClaims({ ...options, jarPaths: { '07.0.26': root } }), /^Error: hhgs_(invalid_artifact|execution_failed)$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('artifact reads stay bounded to the open file even if it grows after inspection', t => {
  const root = mkdtempSync(join(tmpdir(), 'hhgs-growth-test-'));
  const jar = join(root, 'artifact.jar');
  const actualStat = fs.fstatSync;
  const actualRead = fs.readSync;
  try {
    writeFileSync(jar, 'CMS');
    assert.equal(readArtifactSnapshot(jar).toString(), 'CMS');
    t.mock.method(fs, 'fstatSync', descriptor => {
      const metadata = actualStat(descriptor);
      writeFileSync(jar, 'A'.repeat(1024));
      return metadata;
    });
    let requested = 0;
    t.mock.method(fs, 'readSync', (...args) => {
      requested += args[3];
      return actualRead(...args);
    });
    assert.throws(() => readArtifactSnapshot(jar), /^Error: hhgs_invalid_artifact$/);
    assert.equal(requested, 4, 'only original size plus one byte may be requested');
  } finally {
    t.mock.restoreAll();
    rmSync(root, { recursive: true, force: true });
  }
});
