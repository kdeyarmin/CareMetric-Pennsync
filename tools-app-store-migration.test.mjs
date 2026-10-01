import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';

// Migration-specific baseline: last production release before external work.
// Never regenerate this value just to make an unexpected native change pass.
// An intentional native release needs separate review and device acceptance.
const BASELINE = '1ff6018cbd94d89c98dea9a95f9e48f340faf249';

// The reviewed exemptions, and the shape matters. The point of the baseline is
// that no native file changes WITHOUT a reviewer seeing it — not that none ever
// changes, which would make the hosting move unimplementable. So an intended
// change is enumerated here with its reason, and the entry is checked from both
// sides: a file here that still matches the baseline FAILS, because a stale
// exemption is a standing claim that something was reviewed when it no longer
// is. Adding a name here is the reviewed act, and the positive assertions in
// the test below it say what the new content must be.
//
// Bumping BASELINE instead would do none of this: it would make the whole
// directory agree with itself again and prove nothing about what moved.
const REVIEWED_NATIVE_CHANGES = Object.freeze({
  'ios/PennSync/WebViewController.swift':
    'D3 step two: the shell loads https://app.caremetricai.com/ instead of the Base44 subdomain, '
    + 'so a later hosting move is a DNS change rather than a second App Store release.',
  'ios/PennSync/Info.plist':
    'WKAppBoundDomains gains caremetricai.com for that origin and KEEPS both Base44 domains, '
    + 'so one binary works either side of the move while sign-in is still Base44 hosted.',
  'ios/README.md':
    'Documents the two changes above and the transitional domain set.',
});

// execFileSync's default maxBuffer is 1 MiB; keep this in step with the same
// helper in tools-decision-register.test.mjs, where a register that crossed a
// megabyte made every base read die with ENOBUFS.
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const paths = output => output.split('\0').filter(Boolean).sort();

test('every native and packaged public asset is byte-preserved, or enumerated with a reason', () => {
  const baseline = paths(git('ls-tree', '-r', '-z', '--name-only', BASELINE, '--', 'ios', 'public'));
  const current = paths(git('ls-files', '-z', '--', 'ios', 'public'));
  assert.equal(baseline.length, 25, 'Review baseline inventory changes explicitly.');
  assert.deepEqual(current, baseline, 'Native/public files were added, removed or renamed.');
  // An exemption naming a file outside the pinned set proves nothing and hides
  // a typo as a pass.
  for (const path of Object.keys(REVIEWED_NATIVE_CHANGES)) {
    assert.ok(baseline.includes(path), `${path} is exempted but is not a pinned native file`);
    assert.ok(REVIEWED_NATIVE_CHANGES[path].length >= 40, `${path} needs a real reason, not a label`);
  }
  for (const path of baseline) {
    assert.equal(lstatSync(path).isFile(), true, `${path} must remain a regular file`);
    // hash-object without -w only reads the bytes. No filters or large binary
    // stdout buffers are involved, and no new Git object or artifact is written.
    const original = git('rev-parse', `${BASELINE}:${path}`).trim();
    const currentHash = git('hash-object', '--no-filters', '--', path).trim();
    if (Object.hasOwn(REVIEWED_NATIVE_CHANGES, path)) {
      assert.notEqual(currentHash, original,
        `${path} is exempted but matches the baseline — remove the stale exemption`);
      continue;
    }
    assert.equal(currentHash, original, `${path} differs from the preserved production asset`);
  }
});

test('the established app identities remain exact', () => {
  const project = readFileSync('ios/project.yml', 'utf8');
  const invitation = readFileSync('base44/functions/createUserWithTempPassword/entry.ts', 'utf8');
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: com\.caremetric\.ai\s/);
  // Store LISTING links, not the hosted app origin — they are unaffected by a
  // hosting move and must not drift with one. `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md`
  // listed this file as something the domain move has to edit; measured on
  // 2026-10-01 it holds no app origin at all, only these two store URLs.
  assert.ok(invitation.includes('play.google.com/store/apps/details?id=com.caremetic.ai'));
  assert.ok(invitation.includes('6757097720'));
  assert.ok(!invitation.includes('caremetricai.base44.app'));
  assert.ok(!invitation.includes('app.caremetricai.com'));
});

test('the transitional build loads the custom domain and keeps it reachable', () => {
  const shell = readFileSync('ios/PennSync/WebViewController.swift', 'utf8');
  const plist = readFileSync('ios/PennSync/Info.plist', 'utf8');
  const appBound = [...plist.matchAll(/<key>WKAppBoundDomains<\/key>\s*<array>([\s\S]*?)<\/array>/g)];
  assert.equal(appBound.length, 1, 'exactly one WKAppBoundDomains array');
  const domains = [...appBound[0][1].matchAll(/<string>([^<]+)<\/string>/g)].map(m => m[1]);

  // The one origin the shell loads, and the only one it may load.
  const origins = [...shell.matchAll(/URL\(string: "(https:\/\/[^"]+)"\)!/g)].map(m => m[1]);
  assert.deepEqual(origins, ['https://app.caremetricai.com/']);

  // The invariant that makes the binary work at all: `appURL`'s host must be
  // covered by the app-bound list, or main-frame navigation to it is blocked
  // and the app opens to nothing. Bare entries cover subdomains, so this is a
  // suffix check at a dot boundary — never a substring one.
  const host = new URL(origins[0]).hostname;
  assert.ok(domains.some(domain => host === domain || host.endsWith(`.${domain}`)),
    `${host} is not covered by WKAppBoundDomains ${JSON.stringify(domains)}`);

  // Both Base44 domains stay while sign-in is Base44's: `/login` on the app
  // origin is a Base44-served page, and its flow can navigate the main frame to
  // a base44.app address. Removing them is a later, separate release.
  assert.deepEqual(domains, ['caremetricai.com', 'base44.app', 'base44.com']);
  // Ten is WebKit's limit; nothing here is near it, and the transitional set
  // existing at all depends on there being room for both sides.
  assert.ok(domains.length <= 10);
});

test('the shell still registers no service worker for app-bound limits to restrict', () => {
  // App-Bound Domains DO restrict service workers, which is why the plan's iOS
  // analysis turns on the frontend registering none. `src/lib/hostedPaths.spec.js`
  // asserts the frontend side; this asserts the wrapper has not grown an
  // injection path of its own, which app-bound limits also restrict.
  const shell = readFileSync('ios/PennSync/WebViewController.swift', 'utf8');
  assert.ok(shell.includes('limitsNavigationsToAppBoundDomains = true'));
  for (const api of ['WKUserScript', 'evaluateJavaScript', 'userContentController']) {
    assert.ok(!shell.includes(api), `${api} is restricted on app-bound domains`);
  }
});

// This does not inspect an uploaded IPA/AAB/APK or an App Store/Play Console
// release. It proves the listed repository assets/identities were preserved or
// deliberately changed, not that every installed app still works after a future
// backend cutover.
