import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPublishingAccess, main, PRODUCTION_APP_ID } from './tools-production-publish-preflight.mjs';

const SHA = 'a'.repeat(40);
const KEY = 'b44k_SYNTHETIC_TEST_ONLY_NOT_A_REAL_SECRET';
const CONTEXT = {
  GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'kdeyarmin/CareMetric-Pennsync',
  GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: SHA,
};
const VALID = { ...CONTEXT, BASE44_API_KEY: KEY };

test('missing publishing key stops locally without artifact access or any login', () => {
  const output = [];
  const code = main([], { env: CONTEXT, log: (s) => output.push(JSON.parse(s)), inventory() { assert.fail(); } });
  assert.equal(code, 2);
  assert.equal(output[0].code, 'BASE44_PUBLISH_KEY_REQUIRED');
  assert.equal(output[0].deployment_attempted, false);
  assert.equal(output[0].login_attempted, false);
});

test('expiring access/refresh tokens never substitute for a persistent publishing key', () => {
  assert.equal(checkPublishingAccess({ ...CONTEXT, BASE44_ACCESS_TOKEN: 'SYNTHETIC_TOKEN',
    BASE44_REFRESH_TOKEN: 'SYNTHETIC_REFRESH' }).allowed, false);
});

for (const [field, value] of [
  ['GITHUB_ACTIONS', 'false'], ['GITHUB_REPOSITORY', 'another/repo'],
  ['GITHUB_REF', 'refs/heads/staging'], ['GITHUB_EVENT_NAME', 'pull_request'],
  ['GITHUB_EVENT_NAME', 'push'], ['GITHUB_SHA', 'main'],
]) {
  test(`unexpected ${field}=${value} cannot authorize publication`, () => {
    assert.equal(checkPublishingAccess({ ...VALID, [field]: value }).allowed, false);
  });
}

test('credential presence is not reported as validated authentication or publication', () => {
  const result = checkPublishingAccess(VALID);
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'CREDENTIAL_INPUT_PRESENT_NOT_YET_VALIDATED');
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test('empty, malformed, or multiline keys fail before Base44 is invoked', () => {
  for (const key of ['', 'b44k_', '  ', 'sk-SYNTHETIC', 'b44k_SYNTHETIC\nOTHER']) {
    assert.equal(checkPublishingAccess({ ...CONTEXT, BASE44_API_KEY: key }).allowed, false);
  }
});

test('preflight emits no credential values, even for rejected inputs', () => {
  for (const value of [KEY, 'INVALID_PRIVATE_TEST_VALUE']) {
    const output = [];
    main([], { env: { ...CONTEXT, BASE44_API_KEY: value }, log: (s) => output.push(s) });
    assert.equal(output.join('').includes(value), false);
  }
});

test('artifact must belong to the exact workflow commit', () => {
  const log = () => {};
  const inventory = () => ({ entry: '/assets/index-HASH-' + SHA + '.js', entry_sha256: 'f'.repeat(64), assets: [1] });
  assert.equal(main(['--artifact'], { env: VALID, inventory, log }), 0);
  assert.equal(main(['--artifact'], { env: { ...VALID, GITHUB_SHA: 'b'.repeat(40) }, inventory, log }), 2);
  assert.equal(main(['--artifact'], { env: VALID, inventory() { throw new Error('PRIVATE_TEST_VALUE'); }, log }), 2);
});

test('unrecognized CLI arguments cannot bypass access checks', () => {
  assert.equal(main(['--force'], { env: VALID, log() {}, inventory() { assert.fail(); } }), 2);
});

test('workflow stays manual, production-protected, site-only and sequential', () => {
  const yaml = readFileSync(new URL('./.github/workflows/publish-production-frontend.yml', import.meta.url), 'utf8');
  const source = yaml.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.match(source, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(source, /^  (push|pull_request|schedule|workflow_run):/m);
  assert.match(source, /environment: production/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /site deploy --yes --no-build/);
  assert.doesNotMatch(source, /(?:entities push|functions deploy|auth push|connectors push)/);
  assert.ok(source.includes('--app-id ' + PRODUCTION_APP_ID));
  assert.ok(source.indexOf('node tools-production-publish-preflight.mjs') < source.indexOf('base44-publish-cli'));
  assert.ok(source.indexOf('pnpm test') < source.indexOf('site deploy'));
  assert.ok(source.indexOf('site deploy') < source.indexOf('node tools-live-frontend-sync.mjs'));
  assert.match(source, /path: \$\{\{ runner.temp \}\}\/pennsync-publication-verification.json/);
  assert.doesNotMatch(source, /path:.*base44-(?:whoami|access-check|site-receipt|site\.log)/);
});

test('workspace-key acknowledgement is not mistaken for authenticated production access', () => {
  const yaml = readFileSync(new URL('./.github/workflows/publish-production-frontend.yml', import.meta.url), 'utf8');
  const source = yaml.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(source, /\bwhoami\b/);
  assert.match(source, /\$cli" --app-id 694ec16e72e01b60d22f7cbf\s*\\\n\s*--json functions list/);
  const probe = source.indexOf('--json functions list');
  const upload = source.indexOf('--json site deploy');
  assert.ok(probe > 0 && probe < upload);
  const refusalBoundary = source.slice(probe, upload);
  assert.match(refusalBoundary, /BASE44_PRODUCTION_ACCESS_CHECK_FAILED/);
  assert.match(refusalBoundary, /exit 2\s+fi/);
  assert.match(refusalBoundary, /base44-access-check\.json/);
  assert.doesNotMatch(source, /(?:cat|tee)\s+[^\n]*base44-access-check/);
});
