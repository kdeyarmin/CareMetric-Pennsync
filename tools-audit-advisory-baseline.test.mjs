import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BASELINE_PATH,
  SEVERITY_ORDER,
  advisoryKey,
  diffAgainstBaseline,
  parseAudit,
  readBaseline,
  rebuildBaseline,
  severityRank,
} from './tools-audit-advisory-baseline.mjs';

// These tests never run `pnpm audit`: the advisory database is remote and moves,
// so a suite that asked it anything would fail for reasons unrelated to the
// code. The network half is the `check:audit-advisories` script's job. What is
// proved here is that the comparison bites — every finding kind is planted, and
// the clean case is asserted too, because a comparison that failed on everything
// would pass each sabotage test for the wrong reason.

const AUDIT = {
  advisories: {
    '1': {
      id: 1,
      github_advisory_id: 'GHSA-aaaa-aaaa-aaaa',
      module_name: 'left-pad',
      severity: 'moderate',
      title: 'left-pad pads left',
      patched_versions: '>=2.0.0',
      findings: [{ paths: ['.>left-pad'] }],
    },
  },
};

const BASELINE = {
  advisories: [
    {
      ghsa: 'GHSA-aaaa-aaaa-aaaa',
      module: 'left-pad',
      severity: 'moderate',
      paths: ['.>left-pad'],
      reason: 'Accepted because this is a fixture and the reason must be long enough.',
      recordedAt: '2026-10-01',
    },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const kinds = (report) => report.findings.map((f) => f.kind).sort();

test('a finding set matching the baseline passes', () => {
  const report = diffAgainstBaseline(parseAudit(AUDIT), BASELINE);
  assert.equal(report.passed, true, 'the clean case must pass, or every sabotage below proves nothing');
  assert.deepEqual(report.findings, []);
  assert.equal(report.found, 1);
  assert.equal(report.baselined, 1);
});

test('an advisory absent from the baseline fails as new', () => {
  const audit = clone(AUDIT);
  audit.advisories['2'] = {
    id: 2,
    github_advisory_id: 'GHSA-bbbb-bbbb-bbbb',
    module_name: 'right-pad',
    severity: 'high',
    title: 'right-pad pads right',
    patched_versions: '>=3.0.0',
    findings: [{ paths: ['.>right-pad'] }],
  };
  const report = diffAgainstBaseline(parseAudit(audit), BASELINE);
  assert.equal(report.passed, false);
  assert.deepEqual(kinds(report), ['new']);
  assert.equal(report.findings[0].key, 'GHSA-bbbb-bbbb-bbbb right-pad');
});

test('the same GHSA against a second package fails as new rather than matching', () => {
  // Identity is GHSA plus package. Keying on the GHSA alone would let a second
  // affected package arrive silently under an entry recorded for the first.
  const audit = clone(AUDIT);
  audit.advisories['2'] = {
    ...clone(AUDIT.advisories['1']),
    id: 2,
    module_name: 'left-pad-extra',
    findings: [{ paths: ['.>left-pad-extra'] }],
  };
  const report = diffAgainstBaseline(parseAudit(audit), BASELINE);
  assert.equal(report.passed, false);
  assert.deepEqual(kinds(report), ['new']);
  assert.equal(report.findings[0].key, 'GHSA-aaaa-aaaa-aaaa left-pad-extra');
});

test('a severity that rose fails as escalated, and one that fell does not', () => {
  const worse = clone(AUDIT);
  worse.advisories['1'].severity = 'critical';
  const escalated = diffAgainstBaseline(parseAudit(worse), BASELINE);
  assert.equal(escalated.passed, false);
  assert.deepEqual(kinds(escalated), ['escalated']);
  assert.match(escalated.findings[0].detail, /moderate to critical/);

  const better = clone(AUDIT);
  better.advisories['1'].severity = 'low';
  const softened = diffAgainstBaseline(parseAudit(better), BASELINE);
  assert.equal(softened.passed, true, 'a severity that fell is not a regression');
});

test('a new dependency path fails as widened', () => {
  const audit = clone(AUDIT);
  audit.advisories['1'].findings = [{ paths: ['.>left-pad', '.>some-dep>left-pad'] }];
  const report = diffAgainstBaseline(parseAudit(audit), BASELINE);
  assert.equal(report.passed, false);
  assert.deepEqual(kinds(report), ['widened']);
  assert.match(report.findings[0].detail, /\.>some-dep>left-pad/);
});

test('a baseline path the audit no longer reports fails as a stale path', () => {
  const baseline = clone(BASELINE);
  baseline.advisories[0].paths = ['.>left-pad', '.>gone>left-pad'];
  const report = diffAgainstBaseline(parseAudit(AUDIT), baseline);
  assert.equal(report.passed, false);
  assert.deepEqual(kinds(report), ['stale_path']);
  assert.match(report.findings[0].detail, /\.>gone>left-pad/);
});

test('a baselined advisory the audit no longer reports fails as stale', () => {
  const baseline = clone(BASELINE);
  baseline.advisories.push({
    ghsa: 'GHSA-cccc-cccc-cccc',
    module: 'fixed-pad',
    severity: 'high',
    paths: ['.>fixed-pad'],
    reason: 'A resolved advisory nobody removed from the baseline file.',
    recordedAt: '2026-10-01',
  });
  const report = diffAgainstBaseline(parseAudit(AUDIT), baseline);
  assert.equal(report.passed, false);
  assert.deepEqual(kinds(report), ['stale']);
  assert.equal(report.findings[0].key, 'GHSA-cccc-cccc-cccc fixed-pad');
});

test('a baseline entry with no reason, or a token one, fails as unexplained', () => {
  for (const reason of [undefined, '', '   ', 'known issue']) {
    const baseline = clone(BASELINE);
    baseline.advisories[0].reason = reason;
    const report = diffAgainstBaseline(parseAudit(AUDIT), baseline);
    assert.equal(report.passed, false, `reason ${JSON.stringify(reason)} must not be accepted`);
    assert.deepEqual(kinds(report), ['unexplained']);
  }
});

test('an audit payload with no advisories object is refused, not read as clean', () => {
  // The whole point of the tool is that a quiet pass is the failure mode, so a
  // payload shape it does not understand must raise rather than yield nothing.
  for (const payload of [{}, { advisories: null }, '{"foo":1}', 'null']) {
    assert.throws(() => parseAudit(payload), /no `advisories` object/);
  }
  // An audit that genuinely found nothing is still a legitimate empty set.
  assert.deepEqual(parseAudit({ advisories: {} }), []);
});

test('an unknown severity is refused rather than ranked by default', () => {
  assert.throws(() => severityRank('spicy'), /unknown severity/);
  const audit = clone(AUDIT);
  audit.advisories['1'].severity = 'spicy';
  assert.throws(() => parseAudit(audit), /unknown severity/);
  assert.deepEqual(SEVERITY_ORDER, ['info', 'low', 'moderate', 'high', 'critical']);
});

test('an advisory with no GHSA id falls back to its registry id rather than being dropped', () => {
  const audit = { advisories: { '7': { id: 7, module_name: 'x', severity: 'low', findings: [] } } };
  assert.equal(parseAudit(audit)[0].ghsa, 'pnpm-7');
  assert.throws(
    () => parseAudit({ advisories: { a: { module_name: 'x', severity: 'low', findings: [] } } }),
    /no github_advisory_id/,
  );
});

test('rebuildBaseline carries forward an existing reason and leaves a new one blank', () => {
  const audit = clone(AUDIT);
  audit.advisories['2'] = {
    id: 2,
    github_advisory_id: 'GHSA-bbbb-bbbb-bbbb',
    module_name: 'right-pad',
    severity: 'high',
    title: 't',
    patched_versions: null,
    findings: [{ paths: ['.>right-pad'] }],
  };
  const next = rebuildBaseline(parseAudit(audit), BASELINE, '2026-12-25');
  const byKey = new Map(next.advisories.map((a) => [advisoryKey(a), a]));
  assert.equal(byKey.get('GHSA-aaaa-aaaa-aaaa left-pad').reason, BASELINE.advisories[0].reason);
  assert.equal(byKey.get('GHSA-aaaa-aaaa-aaaa left-pad').recordedAt, '2026-10-01');
  assert.equal(byKey.get('GHSA-bbbb-bbbb-bbbb right-pad').reason, '');
  assert.equal(byKey.get('GHSA-bbbb-bbbb-bbbb right-pad').recordedAt, '2026-12-25');
  // A rebuild must not launder a blank reason into a pass.
  assert.equal(diffAgainstBaseline(parseAudit(audit), next).passed, false);
});

test('the committed baseline is well formed and every entry carries a reason and a date', () => {
  const baseline = readBaseline();
  assert.ok(baseline.advisories.length > 0, 'an empty baseline means nothing is pinned');
  const keys = new Set();
  for (const entry of baseline.advisories) {
    const key = advisoryKey(entry);
    assert.ok(!keys.has(key), `duplicate baseline entry ${key}`);
    keys.add(key);
    assert.match(entry.ghsa, /^(GHSA-[0-9a-z-]+|pnpm-\d+)$/, `${key}: implausible advisory id`);
    assert.ok(entry.module, `${key}: no module`);
    severityRank(entry.severity);
    assert.ok(Array.isArray(entry.paths) && entry.paths.length > 0, `${key}: no dependency paths`);
    assert.ok(
      typeof entry.reason === 'string' && entry.reason.trim().length >= 20,
      `${key}: a baselined advisory needs a stated reason`,
    );
    assert.match(entry.recordedAt, /^\d{4}-\d{2}-\d{2}$/, `${key}: no recordedAt date`);
  }
  // The file is regenerated by --write, so a trailing newline and two-space
  // indentation are what a re-record produces; a hand edit that drifts from that
  // shows up as a diff nobody intended.
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  assert.equal(raw, `${JSON.stringify(baseline, null, 2)}\n`, 'baseline is not in --write format');
});

test('the committed baseline passes against itself, and fails when sabotaged', () => {
  // Drives the real file through the real comparison with the audit stubbed out
  // of the way: the found set is reconstructed from the baseline's own entries.
  const baseline = readBaseline();
  const asFound = baseline.advisories.map((entry) => ({
    ghsa: entry.ghsa,
    module: entry.module,
    severity: entry.severity,
    title: entry.title || '',
    patchedVersions: entry.patchedVersions || null,
    paths: [...entry.paths].sort(),
  }));
  assert.equal(diffAgainstBaseline(asFound, baseline).passed, true);

  const escalated = clone(asFound);
  escalated[0].severity = 'critical';
  assert.equal(diffAgainstBaseline(escalated, baseline).passed, false);

  const extra = [
    ...asFound,
    { ghsa: 'GHSA-zzzz-zzzz-zzzz', module: 'planted', severity: 'high', title: '', patchedVersions: null, paths: ['.>planted'] },
  ];
  assert.equal(diffAgainstBaseline(extra, baseline).passed, false);

  assert.equal(diffAgainstBaseline(asFound.slice(1), baseline).passed, false, 'a removed advisory must fail as stale');
});
