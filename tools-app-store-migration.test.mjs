import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';

// Migration-specific baseline: last production release before external work.
// Never regenerate this value just to make an unexpected native change pass.
// An intentional native release needs separate review and device acceptance.
const BASELINE = '1ff6018cbd94d89c98dea9a95f9e48f340faf249';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const paths = output => output.split('\0').filter(Boolean).sort();

test('all existing iOS wrapper and packaged public assets are byte-preserved', () => {
  const baseline = paths(git('ls-tree', '-r', '-z', '--name-only', BASELINE, '--', 'ios', 'public'));
  const current = paths(git('ls-files', '-z', '--', 'ios', 'public'));
  assert.equal(baseline.length, 25, 'Review baseline inventory changes explicitly.');
  assert.deepEqual(current, baseline, 'Native/public files were added, removed or renamed.');
  for (const path of baseline) {
    assert.equal(lstatSync(path).isFile(), true, `${path} must remain a regular file`);
    // hash-object without -w only reads the bytes. No filters or large binary
    // stdout buffers are involved, and no new Git object or artifact is written.
    const original = git('rev-parse', `${BASELINE}:${path}`).trim();
    const currentHash = git('hash-object', '--no-filters', '--', path).trim();
    assert.equal(currentHash, original, `${path} differs from the preserved production asset`);
  }
});

test('the established app identities and hosted iOS entry remain exact', () => {
  const project = readFileSync('ios/project.yml', 'utf8');
  const shell = readFileSync('ios/PennSync/WebViewController.swift', 'utf8');
  const invitation = readFileSync('base44/functions/createUserWithTempPassword/entry.ts', 'utf8');
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: com\.caremetric\.ai\s/);
  assert.ok(shell.includes('https://caremetricai.base44.app/'));
  assert.ok(invitation.includes('play.google.com/store/apps/details?id=com.caremetic.ai'));
  assert.ok(invitation.includes('6757097720'));
});

// This does not inspect an uploaded IPA/AAB/APK or an App Store/Play Console
// release. It proves the listed repository assets/identities were preserved,
// not that every installed app still works after a future backend cutover.
