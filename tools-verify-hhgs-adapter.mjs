// Inputs are extracted, official CMS packages. Uses public synthetic fixtures
// only; does not download, upload, authenticate, or access patient data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { CMS_HHGS_RELEASES_CY2026 } from './src/components/pdgm/cmsHhgsReleasesCy2026.js';
import { groupCmsClaims } from './services/hhgs-adapter/adapter.mjs';

try {
  const [javaExecutable, ...roots] = process.argv.slice(2);
  if (!javaExecutable || roots.length !== 3) {
    throw new Error('Usage: node tools-verify-hhgs-adapter.mjs <absolute-java17-path> <07.0.26-package-root> <07.1.26-package-root> <07.2.26-package-root>');
  }
  const jarPaths = {};
  const cases = [];
  CMS_HHGS_RELEASES_CY2026.forEach((release, releaseIndex) => {
    const root = resolve(roots[releaseIndex]);
    for (const [file, expected] of Object.entries(release.files)) {
      assert.equal(createHash('sha256').update(readFileSync(join(root, file))).digest('hex'), expected,
        `v${release.version} pinned artifact ${file}`);
    }
    jarPaths[release.version] = join(root, 'dist/HomeHealth.jar');
    for (const fixture of release.fixtures) {
      const text = readFileSync(join(root, fixture.path), 'utf8');
      const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
      assert.equal(lines.length, fixture.expectedRecords);
      lines.forEach((line, index) => {
        assert.ok(line.length >= 616);
        cases.push({ record: line.slice(0, 600), expected: line.slice(600, 616),
          label: `${release.version} ${fixture.path}:${index + 1}` });
      });
    }
  });
  // One mixed batch ensures the production adapter routes by date and restores
  // original order; April's March-31 fixture must use January's pinned JAR.
  const result = groupCmsClaims({ records: cases.map(c => c.record), javaExecutable, jarPaths });
  assert.equal(result.paymentAvailable, false);
  assert.equal(result.results.length, 310);
  cases.forEach((c, i) => assert.equal(result.results[i].raw, c.expected, c.label));
  // Exercise real process failures after the same immutable artifact checks.
  // Node is deliberately not a JVM and must not yield an accepted result.
  assert.throws(() => groupCmsClaims({ records: [cases[0].record], javaExecutable: process.execPath, jarPaths }),
    /^Error: hhgs_process_failed$/);
  assert.throws(() => groupCmsClaims({ records: [cases[0].record], javaExecutable, jarPaths, timeoutMs: 100 }),
    /^Error: hhgs_timeout$/);
  const counts = Object.fromEntries(CMS_HHGS_RELEASES_CY2026.map(r => [r.version, result.results.filter(x => x.version === r.version).length]));
  console.log(JSON.stringify({ matched: 310, total: 310, selectedVersions: counts,
    paymentAvailable: false, processFailureRejected: true, timeoutRejected: true,
    scope: 'offline-adapter CMS synthetic fixture parity' }));
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
