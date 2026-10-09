import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PRODUCTION_APP_ID } from './tools-production-publish-preflight.mjs';
import { main, selectFunctions } from './tools-production-function-selection.mjs';

const root = new URL('.', import.meta.url).pathname;

test('"all" and an empty request deploy every function and name none', () => {
  for (const requested of ['all', 'ALL', '  ', '', undefined]) {
    assert.deepEqual(selectFunctions(requested, { root }), { ok: true, mode: 'all', names: [] });
  }
});

test('named functions must each exist in the tree, deduplicated', () => {
  assert.deepEqual(selectFunctions('listMyMessages sendMessage,listMyMessages', { root }),
    { ok: true, mode: 'named', names: ['listMyMessages', 'sendMessage'] });
  assert.deepEqual(selectFunctions('listMyMessages notAFunction', { root }),
    { ok: false, code: 'UNKNOWN_FUNCTION', missing: ['notAFunction'] });
});

test('a request cannot smuggle a CLI option or a path into the deploy command', () => {
  for (const requested of ['--force', 'listMyMessages --force', '../secrets', 'a/b', '$(id)', '-y']) {
    const selection = selectFunctions(requested, { root });
    assert.equal(selection.ok, false, requested);
    assert.equal(selection.code, 'INVALID_FUNCTION_NAME', requested);
  }
});

test('the CLI entry refuses with exit 2 and prints only the decision', () => {
  const lines = [];
  assert.equal(main({ env: { REQUESTED_FUNCTIONS: '--force' }, log: (line) => lines.push(line), root }), 2);
  assert.equal(JSON.parse(lines[0]).code, 'INVALID_FUNCTION_NAME');
  lines.length = 0;
  assert.equal(main({ env: { REQUESTED_FUNCTIONS: 'all' }, log: (line) => lines.push(line), root }), 0);
  assert.deepEqual(JSON.parse(lines[0]), { ok: true, mode: 'all', names: [] });
});

test('the function deployment stays manual, production-protected, functions-only, published and verified', () => {
  const yaml = readFileSync(new URL('./.github/workflows/deploy-production-functions.yml', import.meta.url), 'utf8');
  const source = yaml.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.match(source, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(source, /^  (push|pull_request|schedule|workflow_run):/m);
  assert.match(source, /if: github\.repository == 'kdeyarmin\/CareMetric-Pennsync' && github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /environment: production/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /persist-credentials: false/);
  assert.ok(source.includes('--app-id ' + PRODUCTION_APP_ID));
  // Pushes functions only: never the site, entities, auth, agents or
  // connectors, and never --force, which deletes remote functions absent from
  // the tree. The site is restored by the separate site-only publication.
  assert.match(source, /--json functions deploy "\$\{names\[@\]\}"/);
  assert.doesNotMatch(source, /site deploy|entities push|auth push|agents push|connectors push|\bdeploy -y\b|--force/);
  // The requested names reach the shell only through the validating selector.
  assert.doesNotMatch(source, /run:[^\n]*\$\{\{ inputs\./);
  assert.match(source, /REQUESTED_FUNCTIONS: \$\{\{ inputs\.functions \}\}/);
  // Order: preflight, selection and full validation before the CLI; an access
  // check before the deploy; live verification after it.
  const at = (needle) => {
    const index = source.indexOf(needle);
    assert.ok(index >= 0, needle);
    return index;
  };
  assert.ok(at('node tools-production-publish-preflight.mjs') < at('base44-functions-cli'));
  assert.ok(at('node tools-production-function-selection.mjs') < at('base44-functions-cli'));
  assert.ok(at('pnpm test') < at('--json functions deploy'));
  assert.ok(at('--json functions list') < at('--json functions deploy'));
  assert.ok(at('--json functions deploy') < at('node tools-live-function-sync.mjs'));
  assert.match(source.slice(at('--json functions list'), at('--json functions deploy')), /BASE44_PRODUCTION_ACCESS_CHECK_FAILED[\s\S]*exit 2/);
  // A deploy lands in the preview deployment, so the app is published before
  // anything is verified, and a failed publish stops the run.
  const publish = `/api/apps/${PRODUCTION_APP_ID}/deploy`;
  assert.ok(at('--json functions deploy') < at(publish));
  assert.ok(at(publish) < at('node tools-live-function-sync.mjs'));
  assert.match(source.slice(at(publish)), /BASE44_APP_PUBLISH_FAILED[\s\S]*?exit 2/);
  assert.doesNotMatch(source, /echo[^\n]*BASE44_API_KEY/);
  // Either persistent credential works: the CLI is handed a personal access
  // token before its first call, and the publish sends a workspace key as
  // api_key and anything else as Bearer (Base44 refuses a token in api_key).
  assert.ok(at('node tools-base44-cli-credential.mjs') < at('--json functions list'));
  assert.match(source, /trap 'rm -f "\$HOME\/\.base44\/auth\/auth\.json"' EXIT\n\s*node tools-base44-cli-credential\.mjs/);
  // The publish uses the same trimmed value the preflight accepted.
  const trim = 'key="$(node -e \'process.stdout.write(String(process.env.BASE44_API_KEY || "").trim())\')"';
  assert.ok(at(trim) < at('case "$key" in'));
  const header = source.slice(at('case "$key" in'), at(publish));
  assert.match(header, /b44k_\*\) auth_header="api_key: \$\{key\}" ;;/);
  assert.match(header, /\*\) auth_header="Authorization: Bearer \$\{key\}" ;;/);
  assert.match(header, /-H "\$auth_header"/);
  assert.doesNotMatch(source.slice(at(trim), at(publish)), /auth_header="[^"]*\$\{BASE44_API_KEY\}/);
  // Publishing rebuilds the site from config, so the exact build is restored
  // through the site-only publication after verification, and whenever the
  // publish succeeded: a failed verification must not leave the rebuilt site.
  assert.ok(at('node tools-live-function-sync.mjs') < at('gh workflow run publish-production-frontend.yml'));
  assert.match(source.slice(at('Publish the app so production serves'), at(publish)), /^ {8}id: publish$/m);
  assert.match(source.slice(at('Dispatch the site-only publication'), at('gh workflow run publish-production-frontend.yml')),
    /^ {8}if: \$\{\{ !cancelled\(\) && steps\.publish\.outcome == 'success' \}\}$/m);
  assert.match(source, /^ {2}actions: write$/m);
  assert.doesNotMatch(source, /path:.*base44-(?:access-check|functions-receipt|functions\.log)/);
});
