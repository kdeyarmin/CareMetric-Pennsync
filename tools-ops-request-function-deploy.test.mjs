import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  main,
  validateFunctionDeployRequest,
} from './tools-ops-request-function-names.mjs';

const yaml = readFileSync(new URL('./.github/workflows/ops-request-function-deploy.yml', import.meta.url), 'utf8');
const request = readFileSync(new URL('./.github/ops/function-deploy-request', import.meta.url), 'utf8');

test('ops request workflow only dispatches the production function deploy on a main-path push', () => {
  const source = yaml.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.match(source, /on:\n  push:\n    branches: \[main\]/);
  assert.match(source, /\.github\/ops\/function-deploy-request/);
  assert.match(source, /gh workflow run deploy-production-functions\.yml/);
  assert.match(source, /-f "functions=\$funcs"/);
  assert.doesNotMatch(source, /BASE44_API_KEY|functions deploy|site deploy/);
  assert.match(source, /actions: write/);
  // Validation is the shared Node module — never an inverted shell grep.
  assert.match(source, /tools-ops-request-function-names\.mjs/);
  assert.doesNotMatch(source, /grep -Eqv/);
});

test('the checked-in deploy request names only tree functions (or all)', () => {
  const names = request.split(/\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(names.length > 0);
  if (names.length === 1 && names[0] === 'all') return;
  const selection = validateFunctionDeployRequest(names.join(' '));
  assert.equal(selection.ok, true, JSON.stringify(selection));
  for (const name of selection.names) {
    assert.ok(
      readFileSync(new URL(`./base44/functions/${name}/entry.ts`, import.meta.url), 'utf8').length > 0,
      name,
    );
  }
});

test('valid function lists pass; invalid tokens and empty input refuse', () => {
  assert.deepEqual(validateFunctionDeployRequest('sendFax managePhoneNumberPool'), {
    ok: true, code: null, names: ['sendFax', 'managePhoneNumberPool'],
  });
  assert.deepEqual(validateFunctionDeployRequest('all'), {
    ok: true, code: null, names: ['all'],
  });
  assert.equal(validateFunctionDeployRequest('').ok, false);
  assert.equal(validateFunctionDeployRequest('   ').code, 'OPS_FUNCTION_DEPLOY_REQUEST_EMPTY');
  assert.deepEqual(validateFunctionDeployRequest('sendFax --force'), {
    ok: false,
    code: 'OPS_FUNCTION_DEPLOY_REQUEST_INVALID',
    names: ['sendFax', '--force'],
    invalid: ['--force'],
  });
  assert.equal(validateFunctionDeployRequest('../secrets').ok, false);
  assert.equal(validateFunctionDeployRequest('$(id)').ok, false);
  const lines = [];
  assert.equal(main({ env: { REQUESTED_FUNCTIONS: 'sendFax' }, log: (l) => lines.push(l) }), 0);
  assert.equal(JSON.parse(lines[0]).ok, true);
  lines.length = 0;
  assert.equal(main({ env: { REQUESTED_FUNCTIONS: '--force' }, log: (l) => lines.push(l) }), 2);
  assert.equal(JSON.parse(lines[0]).code, 'OPS_FUNCTION_DEPLOY_REQUEST_INVALID');
});
