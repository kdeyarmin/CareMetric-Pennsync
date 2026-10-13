import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
});

test('the checked-in deploy request names only tree functions (or all)', () => {
  const names = request.split(/\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(names.length > 0);
  if (names.length === 1 && names[0] === 'all') return;
  for (const name of names) {
    assert.match(name, /^[A-Za-z][A-Za-z0-9_-]{0,99}$/);
    assert.ok(
      readFileSync(new URL(`./base44/functions/${name}/entry.ts`, import.meta.url), 'utf8').length > 0,
      name,
    );
  }
});
