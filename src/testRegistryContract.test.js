import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Contract: every node:test file is actually referenced by a test script.
 *
 * The `test:*` scripts in package.json are hand-maintained file lists, so a new
 * `*.test.js` runs locally when you invoke it directly, passes review, and then
 * never executes in CI again — the suite reports green while the file is inert.
 * Five files had drifted this way before this guard existed, three of them
 * added by the same PR that introduced them.
 *
 * `.test.jsx` is excluded: those are component tests, collected by vitest
 * (`test:components`) via glob rather than an explicit list.
 */

const ROOTS = ['src', 'base44'];

function collectNodeTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectNodeTests(p));
    else if (/\.test\.js$/.test(entry)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

test('every node:test file is wired into a package.json test script', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const registry = Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith('test:'))
    .map(([, body]) => body)
    .join(' ');

  const orphans = ROOTS
    .flatMap((root) => collectNodeTests(join(process.cwd(), root)))
    .map((abs) => abs.slice(process.cwd().length + 1))
    .filter((rel) => !registry.includes(rel))
    .sort();

  assert.deepEqual(
    orphans,
    [],
    'These test files never run in CI. Add them to a test:* script in '
      + 'package.json (test:utils is the usual home):\n  '
      + orphans.join('\n  '),
  );
});
