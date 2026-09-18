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
  finally {
    // Resolve and check the owned temporary directory before recursive cleanup.
    if (!resolve(root).startsWith(resolve(base) + sep + 'http-boundary-')) throw new Error('UNSAFE_TEST_CLEANUP');
    await rm(root, { recursive: true });
  }
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
