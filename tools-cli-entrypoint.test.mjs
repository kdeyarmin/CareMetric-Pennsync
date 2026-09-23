/**
 * Every CLI in this repository decides whether it was invoked directly by
 * comparing `import.meta.url` against `process.argv[1]`. Those two describe the
 * same file in two different REPRESENTATIONS, and a comparison written for one
 * of them is silently wrong when the other arrives:
 *
 *   argv[1]          C:\repo\tools-pennsync-migrate.mjs   (Windows)
 *                    /repo/a b/tools-pennsync-migrate.mjs (a space, anywhere)
 *   import.meta.url  file:///C:/repo/tools-pennsync-migrate.mjs
 *                    file:///repo/a%20b/tools-pennsync-migrate.mjs
 *
 * A hand-built `file://${process.argv[1]}` matches neither, and the failure has
 * no symptom: the guard is false, the module loads its exports and nothing
 * else, and the process exits 0 having printed nothing — which reads exactly
 * like a successful run with no work to do. `tools-pennsync-migrate.mjs` was
 * reported that way from a Windows checkout. It planned nothing, applied
 * nothing, and said so by saying nothing.
 *
 * Either real conversion is correct and both are in use here:
 * `pathToFileURL(argv[1]).href === import.meta.url` compares two URLs, and
 * `resolve(argv[1]) === fileURLToPath(import.meta.url)` compares two paths.
 * What is never correct is pasting one representation into the other's syntax.
 *
 * Two of these had already been corrected in place, each with a comment
 * explaining the defect, and ten more were never swept — which is why this is a
 * test rather than a habit.
 *
 * The scan is the half that covers Windows, which cannot be run here. The two
 * executions below are what keep the scan honest: one puts a real CLI behind a
 * path that needs percent-encoding, the same mismatch in a shape this platform
 * CAN produce, and the other proves a guard still lets the module be imported
 * when there is no argv[1] at all to convert.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname);
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage', 'playwright-report']);

/** Every source file in the repository, minus what is not ours to fix. */
function sourceFiles(directory = ROOT, found = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(mjs|js|jsx)$/.test(entry)) found.push(path);
  }
  return found;
}

/** Lines of code that decide direct invocation, with file and line number. */
function entryPointGuards() {
  const guards = [];
  for (const path of sourceFiles()) {
    if (path === join(ROOT, 'tools-cli-entrypoint.test.mjs')) continue;
    const text = readFileSync(path, 'utf8');
    if (!text.includes('process.argv[1]')) continue;
    text.split('\n').forEach((line, index) => {
      if (!line.includes('process.argv[1]') || !line.includes('import.meta.url')) return;
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      guards.push({ file: path.slice(ROOT.length + 1), line: index + 1, text: line });
    });
  }
  return guards;
}

test('no direct-invocation check pastes a path into URL syntax', () => {
  const guards = entryPointGuards();
  // Fail closed: a rename that emptied this scan would leave it passing forever.
  assert.ok(guards.length >= 35,
    `expected this repository's CLI guards to be found, saw ${guards.length} (43 when this was written)`);

  const handBuilt = guards.filter(guard => /`file:\/\//.test(guard.text));
  assert.deepEqual(handBuilt.map(g => `${g.file}:${g.line}`), [],
    'a hand-built file:// string never matches a Windows or percent-encoded path');

  const unconverted = guards.filter(guard =>
    !guard.text.includes('pathToFileURL(') && !guard.text.includes('fileURLToPath('));
  assert.deepEqual(unconverted.map(g => `${g.file}:${g.line}`), [],
    'a guard must convert one representation into the other, not compare them raw');
});

test('a module holding a guard still imports when there is no argv[1]', () => {
  // `pathToFileURL(undefined)` and `resolve(undefined)` both throw, so a guard
  // that converts before testing for presence kills every test that imports the
  // module — the opposite failure, and just as quiet, since it happens at load.
  const modules = [...new Set(entryPointGuards().map(guard => guard.file))].sort();
  assert.ok(modules.length >= 35, `saw only ${modules.length} modules with a guard`);

  const script = modules
    .map(file => `await import(${JSON.stringify(join(ROOT, file))});`)
    .join('\n');
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
});

test('a CLI behind a percent-encoded path still runs', () => {
  // `tools-pennsync-hosted-gate.mjs` is the one that can be moved on its own:
  // its header says node builtins only, so a copy of the single file runs. With
  // nothing configured it stands down, which is visible output AND a distinct
  // exit code — the "did nothing, exited 0" failure cannot imitate either.
  const scratch = mkdtempSync(join(tmpdir(), 'pennsync-entrypoint-'));
  const awkward = join(scratch, 'a directory with spaces');
  mkdirSync(awkward);
  const copied = join(awkward, 'tools-pennsync-hosted-gate.mjs');
  copyFileSync(join(ROOT, 'tools-pennsync-hosted-gate.mjs'), copied);

  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [copied], {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: '', PENNSYNC_HOSTED_PROJECT_REF: '' },
    });
  } catch (err) {
    status = err.status;
    stdout = err.stdout ?? '';
  }

  assert.match(stdout, /::notice title=Hosted store not measured::/,
    'the CLI produced no output at all, which is exactly what the defect looks like');
  assert.notEqual(status, 0, 'a stand-down is a distinct exit code, not a silent success');
});
