// Process-level negative tests: invalid targets must fail before CLI lifecycle calls.
// Real successful Auth/PostgREST traffic is tested separately in http-authority.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const exec = promisify(execFile);
const base = fileURLToPath(new URL('../supabase/.temp/', import.meta.url));
const PROJECT = 'local-pennsync-authority';
function removeOwnedFixture(root) {
  // Resolve and check the owned temporary directory before recursive cleanup.
  if (!resolve(root).startsWith(resolve(base) + sep + 'http-boundary-')) throw new Error('UNSAFE_TEST_CLEANUP');
  return rm(root, { recursive: true });
}
async function fixture(run) {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, 'http-boundary-'));
  const workdir = root + sep;
  await mkdir(resolve(root, 'tests'));
  await mkdir(resolve(root, 'supabase/.temp'), { recursive: true });
  await copyFile(new URL('./http-local-stack.mjs', import.meta.url), resolve(root, 'tests/http-local-stack.mjs'));
  await copyFile(new URL('../supabase/config.toml', import.meta.url), resolve(root, 'supabase/config.toml'));
  const marker = resolve(root, 'supabase/.temp/http-harness-owner.json');
  const env = { ...process.env, PENNSYNC_SUPABASE_CLI: resolve(root, 'must-never-execute-missing-cli'),
    DOCKER_HOST: 'tcp://remote.invalid:2376' };
  delete env.DOCKER_CONTEXT;
  const invoke = async action => {
    try {
      const result = await exec(process.execPath, [resolve(root, 'tests/http-local-stack.mjs'), action],
        { env, timeout: 10000, windowsHide: true });
      return { code: 0, ...result };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  try { await run({ root, workdir, marker, env, invoke }); }
  finally { await removeOwnedFixture(root); }
}

test('remote Docker hosts are refused before any CLI start or ownership claim', async () => {
  await fixture(async ({ env, invoke, marker }) => {
    for (const endpoint of ['tcp://remote.invalid:2376', 'ssh://remote.invalid', 'unix://remote.invalid/docker.sock', 'npipe:////remote/pipe/docker_engine']) {
      env.DOCKER_HOST = endpoint;
      const result = await invoke('start');
      assert.equal(result.code, 1);
      assert.equal(result.stderr.trim(), 'LOCAL_DOCKER_ENDPOINT_REQUIRED');
      assert.equal(result.stdout, '');
      assert.equal(await access(marker).then(() => true, () => false), false);
    }
  });
});

test('changed daemon ownership prevents stop before the lifecycle CLI can execute', async () => {
  await fixture(async ({ env, invoke, marker, workdir }) => {
    env.DOCKER_HOST = 'unix:///local/second-daemon.sock';
    const owner = JSON.stringify({ version: 2, project: PROJECT, workdir, daemon: 'unix:///local/first-daemon.sock' });
    await writeFile(marker, owner);
    const result = await invoke('stop');
    assert.equal(result.code, 1);
    assert.equal(result.stderr.trim(), 'LOCAL_DOCKER_OWNERSHIP_MISMATCH');
    assert.equal(result.stdout, '');
    assert.equal(await readFile(marker, 'utf8'), owner);
  });
});

test('no ownership marker makes stop a no-op even with a nonlocal Docker environment', async () => {
  await fixture(async ({ invoke }) => {
    const result = await invoke('stop');
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^No stack owned by this harness; cleanup made no changes\./);
  });
});

test('a start that fails applying a migration is named, and nothing else is forwarded', async () => {
  const { MIGRATION_CODES, classifyToolFailure } = await import('./http-local-stack.mjs');
  const start = (stdout, stderr = '') => classifyToolFailure('supabase', ['start'], { stdout, stderr });

  // The failure this exists for: before it, a migration raising one of our own
  // codes was reported the same way as a missing Docker daemon.
  for (const code of MIGRATION_CODES) {
    assert.equal(start(`psql:migration.sql:53: ERROR:  ${code}`), `LOCAL_CLI_START_MIGRATION_${code}`);
  }
  // A SQL fault we have no name for still separates from a daemon fault.
  assert.equal(start('ERROR:  relation "x" already exists'), 'LOCAL_CLI_START_SQL_REJECTED');
  assert.equal(start('failed: SQLSTATE 42501'), 'LOCAL_CLI_START_SQL_REJECTED');

  // Nothing the CLI printed is forwarded: only literals this module declares.
  const secret = 'service_role_key=eyJhbGciOiJIUzI1NiJ9.SECRET';
  const classified = start(`ERROR:  permission denied\n${secret}\nanon key sb_secret_abc`);
  assert.doesNotMatch(classified, /SECRET|eyJ|sb_secret|permission denied/);
  assert.match(classified, /^LOCAL_CLI_START_[A-Z_]+$/);
  // An unrecognized failure keeps the original redacted verdict.
  assert.equal(start('something went wrong'), 'LOCAL_CLI_START_FAILED_OUTPUT_REDACTED');
  // Categories that already existed still win over the new ones.
  assert.equal(start('ERROR: Cannot connect to the Docker daemon'), 'LOCAL_CLI_START_DAEMON_UNAVAILABLE');
  assert.equal(classifyToolFailure('supabase', ['start'], { stdout: 'ERROR: x', killed: true }),
    'LOCAL_CLI_START_TIMED_OUT');
});
