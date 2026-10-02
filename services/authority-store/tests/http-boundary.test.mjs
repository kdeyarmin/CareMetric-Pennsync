// Process-level negative tests: invalid targets must fail before CLI lifecycle calls.
// Real successful Auth/PostgREST traffic is tested separately in http-authority.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { deriveUnmigratedConfig, migrationsStillEnabled } from './http-local-stack.mjs';
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
    const owner = JSON.stringify({ version: 3, project: PROJECT, mode: 'migrated', workdir, daemon: 'unix:///local/first-daemon.sock' });
    await writeFile(marker, owner);
    const result = await invoke('stop');
    assert.equal(result.code, 1);
    assert.equal(result.stderr.trim(), 'LOCAL_DOCKER_OWNERSHIP_MISMATCH');
    assert.equal(result.stdout, '');
    assert.equal(await readFile(marker, 'utf8'), owner);
  });
});

test('a marker naming a mode or a workdir this file did not choose is refused', async () => {
  await fixture(async ({ env, invoke, marker, workdir, root }) => {
    // The second start mode adds one more KNOWN workdir and no ability to adopt a
    // stack started from anywhere else, so each of these must still be refused
    // before any CLI lifecycle call. `mode` is the new field, and a marker
    // without one is a marker from before this change.
    env.DOCKER_HOST = 'unix:///local/first-daemon.sock';
    for (const owner of [
      { version: 3, project: PROJECT, workdir },
      { version: 3, project: PROJECT, mode: 'invented', workdir },
      { version: 3, project: PROJECT, mode: 'unmigrated', workdir },
      { version: 3, project: PROJECT, mode: 'migrated', workdir: resolve(root, 'elsewhere') + sep },
      { version: 2, project: PROJECT, mode: 'migrated', workdir },
      // The two shapes that reach the lookup as a property name rather than a
      // mode. They were refused before `Object.hasOwn` too, but only because no
      // member of `Object.prototype` is a string, so the second comparison could
      // never be true. Pinned here so the guard's safety is its own.
      { version: 3, project: PROJECT, mode: 'constructor', workdir },
      { version: 3, project: PROJECT, mode: '__proto__', workdir },
    ]) {
      await writeFile(marker, JSON.stringify({ daemon: 'unix:///local/first-daemon.sock', ...owner }));
      const result = await invoke('stop');
      assert.equal(result.code, 1);
      assert.equal(result.stderr.trim(), 'LOCAL_STACK_OWNERSHIP_MISMATCH');
      assert.equal(result.stdout, '');
    }
  });
});

test('the unmigrated start checks the Docker endpoint before it derives anything', async () => {
  await fixture(async ({ invoke, root }) => {
    // The start still fails here -- the Docker endpoint is remote and the CLI
    // path does not exist -- so what this proves is the ORDER: nothing derives a
    // config before the endpoint check, and the repository's own file is never
    // edited in place.
    const before = await readFile(resolve(root, 'supabase/config.toml'), 'utf8');
    const result = await invoke('start-unmigrated');
    assert.equal(result.code, 1);
    assert.equal(result.stderr.trim(), 'LOCAL_DOCKER_ENDPOINT_REQUIRED');
    assert.equal(await readFile(resolve(root, 'supabase/config.toml'), 'utf8'), before);
    assert.equal(await access(resolve(root, 'supabase/.temp/unmigrated/supabase/config.toml'))
      .then(() => true, () => false), false);
    // A ratchet on the repository's own configuration, which is what makes the
    // second workdir necessary in the first place: migrations are ON here, so a
    // stack started from this file applies the store and pins it to staging.
    assert.equal(migrationsStillEnabled(before), true);
  });
});

test('the derived configuration disables migrations, or refuses to be derived', async () => {
  // THE DERIVE ITSELF, against planted files. Nothing executed it before: the
  // test above dies at the endpoint check, so `LOCAL_MIGRATIONS_DISABLE_FAILED`
  // could not be raised by any test here and the first execution of the derive
  // anywhere would have been a real CI job. Two defects were in it, each found by
  // running a table like this one rather than by reading the code -- a replace
  // without `/g` left a second `[db.migrations]` table enabled, and a character
  // class bounded by `[` stopped at the bracket inside an array value, so a key
  // after `schema_paths = []` was never seen. Both left migrations ON with no
  // refusal, which is the direction that does not announce itself.
  for (const [name, text, expected] of [
    ['the plain shape', '[db.migrations]\nenabled = true\n', '[db.migrations]\nenabled = false\n'],
    ['CRLF line endings', '[db.migrations]\r\nenabled = true\r\n', '[db.migrations]\r\nenabled = false\r\n'],
    ['no spaces around the equals', '[db.migrations]\nenabled=true\n', '[db.migrations]\nenabled=false\n'],
    ['a comment between header and key', '[db.migrations]\n# why\nenabled = true\n',
      '[db.migrations]\n# why\nenabled = false\n'],
    ['an array value before the key', '[db.migrations]\nschema_paths = []\nenabled = true\n',
      '[db.migrations]\nschema_paths = []\nenabled = false\n'],
    ['two tables of the same name', '[db.migrations]\nenabled = true\n[x]\ny=1\n[db.migrations]\nenabled = true\n',
      '[db.migrations]\nenabled = false\n[x]\ny=1\n[db.migrations]\nenabled = false\n'],
    ['a file already disabled', '[db.migrations]\nenabled = false\n', '[db.migrations]\nenabled = false\n'],
    ['the dotted spelling', '[db]\nmigrations.enabled = true\n', '[db]\nmigrations.enabled = false\n'],
    ['the fully dotted spelling', 'db.migrations.enabled = true\n', 'db.migrations.enabled = false\n'],
    ['an inline comment after the value', '[db.migrations]\nenabled = true # on\n',
      '[db.migrations]\nenabled = false # on\n'],
    ['a commented-out key', '[db.migrations]\n# enabled = true\n', '[db.migrations]\n# enabled = true\n'],
    // Another table's own `enabled` is not this key and must survive untouched; a
    // derive that disabled it would turn off the API the acceptance run needs.
    ['another table that also has enabled', '[db.migrations]\nenabled = true\n[api]\nenabled = true\n',
      '[db.migrations]\nenabled = false\n[api]\nenabled = true\n'],
  ]) {
    assert.equal(deriveUnmigratedConfig(text), expected, name);
    assert.equal(migrationsStillEnabled(expected), false, name);
  }
  // And a shape the derive cannot rewrite is a refusal rather than a quietly
  // migrated store. This is the only way to raise that code, so without it the
  // refusal the start flow depends on is asserted by nothing.
  assert.throws(() => deriveUnmigratedConfig('[db]\nmigrations = { enabled = true }\n'),
    /^Error: LOCAL_MIGRATIONS_DISABLE_FAILED$/);
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
  // D123. A SILENT child is its own reading, not the redacted one. Before the
  // split both answered `FAILED_OUTPUT_REDACTED`, so main's own unreproducible
  // failure at `00ae087b` could not be told from an unrecognised diagnostic —
  // and they point at different things, one a category to add and one a child
  // that died before printing. Against the single default the first three of
  // these assert `…NO_OUTPUT === …OUTPUT_REDACTED` and fail.
  assert.equal(start(''), 'LOCAL_CLI_START_FAILED_NO_OUTPUT');
  assert.equal(classifyToolFailure('supabase', ['start'], {}), 'LOCAL_CLI_START_FAILED_NO_OUTPUT');
  // Whitespace only is silence too: the module joins stdout and stderr with a
  // newline, so a child that printed nothing still yields "\n" and a literal
  // emptiness check would never fire.
  assert.equal(start('  ', '\n\t'), 'LOCAL_CLI_START_FAILED_NO_OUTPUT');
  // And the split must not swallow a better reading. Each of these is silent,
  // so each reaches the new default first and is then overridden — invert the
  // predicate to always-silent and these four keep passing, which is why the
  // three above are the ones that discriminate.
  assert.equal(classifyToolFailure('supabase', ['start'], { killed: true }),
    'LOCAL_CLI_START_TIMED_OUT');
  assert.equal(classifyToolFailure('supabase', ['start'], { code: 'ENOENT' }),
    'LOCAL_CLI_START_EXECUTABLE_NOT_FOUND');
  assert.equal(classifyToolFailure('docker', ['volume'], {}), 'LOCAL_DOCKER_VOLUMES_FAILED_NO_OUTPUT');
  assert.equal(classifyToolFailure('supabase', ['nonsense'], {}), 'LOCAL_TOOL_FAILED_NO_OUTPUT');
  // D141. Three classes a start really fails with, each planted as the tool
  // actually prints it rather than as the pattern spelled backwards. Before the
  // branches they all answer `FAILED_OUTPUT_REDACTED`, which is the assertion
  // that fails — and that matters more than usual here, because these branches
  // were added on an occurrence whose own text is unrecoverable, so a branch
  // nothing has been shown to reach would look exactly like one that works.
  assert.equal(start('Error response from daemon: driver failed programming external '
    + 'connectivity on endpoint supabase_db_pennsync: Bind for 0.0.0.0:54322 failed: '
    + 'port is already allocated'), 'LOCAL_CLI_START_PORT_TAKEN_DURING_START');
  assert.equal(start('listen tcp 0.0.0.0:54321: bind: address already in use'),
    'LOCAL_CLI_START_PORT_TAKEN_DURING_START');
  assert.equal(start('toomanyrequests: You have reached your pull rate limit. You may '
    + 'increase the limit by authenticating and upgrading'), 'LOCAL_CLI_START_IMAGE_UNAVAILABLE');
  assert.equal(start('failed to pull image public.ecr.aws/supabase/postgres:15.8.1: '
    + 'manifest unknown'), 'LOCAL_CLI_START_IMAGE_UNAVAILABLE');
  assert.equal(start('service supabase_db_pennsync is not healthy'),
    'LOCAL_CLI_START_SERVICE_UNHEALTHY');
  // Docker's own compose wording, which a bare `unhealthy` alternative used to
  // catch by accident and a narrowed one must still catch on purpose.
  assert.equal(start('dependency failed to start: container supabase_db_pennsync is unhealthy'),
    'LOCAL_CLI_START_SERVICE_UNHEALTHY');
  // AND THE NARROWING ITSELF, on Copilot's finding against this change. A bind
  // failure that is NOT an occupied port must fall through to the redacted
  // verdict rather than be named a taken port: naming a wrong cause confidently
  // is worse than naming none, and it is the too-wide half of the asymmetry this
  // branch's own comment describes. With the bare `bind: ` alternative restored
  // these two answer `PORT_TAKEN_DURING_START` and fail.
  assert.equal(start('listen tcp 0.0.0.0:54321: bind: permission denied'),
    'LOCAL_CLI_START_FAILED_OUTPUT_REDACTED');
  assert.equal(start('bind: cannot assign requested address'),
    'LOCAL_CLI_START_FAILED_OUTPUT_REDACTED');
  // AND THE ORDER, on Codex's finding against this change. A named migration
  // refusal is normally followed by its CONSEQUENCE, so a classifier that asks
  // about the consequence first reports it and hides the refusal — which is the
  // one fact this module exists to preserve. Same for a SQL fault whose text
  // happens to carry an infrastructure phrase. Move the three new branches back
  // above the migration and SQL checks and these three fail with
  // `SERVICE_UNHEALTHY` and `IMAGE_UNAVAILABLE` as actual.
  assert.equal(start('ERROR:  PENNSYNC_CALLER_MEMBERSHIP_REQUIRED\n'
    + 'container supabase_db_pennsync exited'),
  'LOCAL_CLI_START_MIGRATION_PENNSYNC_CALLER_MEMBERSHIP_REQUIRED');
  assert.equal(start('PENNSYNC_UNKNOWN_DEPLOYMENT_APP\ndependency failed to start: '
    + 'container supabase_db_pennsync is unhealthy'),
  'LOCAL_CLI_START_MIGRATION_PENNSYNC_UNKNOWN_DEPLOYMENT_APP');
  assert.equal(start('ERROR:  relation "x" does not exist\nSQLSTATE 42P01\nrate limit'),
    'LOCAL_CLI_START_SQL_REJECTED');
  // The order between them is load-bearing, not incidental: an image the runner
  // could not obtain ALSO leaves the service unstarted, so a message carrying
  // both must report the cause and not the consequence. Swap the two branches
  // and this one answers `SERVICE_UNHEALTHY` and fails.
  assert.equal(start('failed to pull image: manifest unknown\n'
    + 'container supabase_db_pennsync exited'), 'LOCAL_CLI_START_IMAGE_UNAVAILABLE');
  // And none of the three may carry a byte of what the tool said. The port case
  // is the one to check, because the daemon names the container and the port in
  // the same sentence the pattern matches on.
  for (const planted of ['Bind for 0.0.0.0:54322 failed: port is already allocated',
    'toomanyrequests: pull rate limit for supabase/postgres', 'supabase_db_pennsync is not healthy']) {
    assert.match(start(planted), /^LOCAL_CLI_START_[A-Z_]+$/);
  }
  // Categories that already existed still win over the new ones.
  assert.equal(start('ERROR: Cannot connect to the Docker daemon'), 'LOCAL_CLI_START_DAEMON_UNAVAILABLE');
  assert.equal(classifyToolFailure('supabase', ['start'], { stdout: 'ERROR: x', killed: true }),
    'LOCAL_CLI_START_TIMED_OUT');
});

/**
 * Every directory a migration failure can come out of. D110: this scan read
 * `record-migrations/` alone, which is the directory the codes it was written
 * for happened to live in, and the guard's subject is the CODE. The authority
 * migrations raise three of their own, and one of them —
 * `PENNSYNC_UNKNOWN_DEPLOYMENT_APP` — was outside the allowlist the whole time,
 * so an operator pinning a new deployment to a mistyped app id got the generic
 * redacted verdict. That is the same failure the scan was added to stop, in the
 * directory it did not read.
 */
const MIGRATION_DIRECTORIES = Object.freeze(['../supabase/migrations/', '../supabase/record-migrations/']);

/**
 * The `do $$ … $$` preconditions of one directory. A code raised inside a
 * CREATE FUNCTION body is a refusal answered to a caller at runtime, not a
 * migration failure, and naming one here would be wrong in the other direction
 * — the planted case below holds that line as well as this one.
 */
async function codesRaisedIn(directory) {
  const raised = new Set();
  for (const name of (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    for (const block of sql.matchAll(/\bdo \$\$([\s\S]*?)\$\$\s*;/g)) {
      for (const match of block[1].matchAll(/message\s*=\s*'(PENNSYNC_[A-Z_]+)'/g)) raised.add(match[1]);
    }
  }
  return raised;
}

/**
 * The classifier names a migration failure by its own code so a redacted CI
 * log still says what refused. That only works while the allowlist knows every
 * code the migrations can raise, and it stopped being true the moment the
 * broker and contract migrations added two of their own: a real
 * `PENNSYNC_RECORD_STORE_REQUIRED` fell back to the generic verdict, which is
 * precisely the diagnosis this was built to avoid. Read from the migrations
 * rather than maintained by hand, so the next one cannot slip either.
 */
test('every code the migrations raise is one the classifier can name', async () => {
  const { MIGRATION_CODES } = await import('./http-local-stack.mjs');
  const raised = new Set();
  for (const relative of MIGRATION_DIRECTORIES) {
    const found = await codesRaisedIn(new URL(relative, import.meta.url));
    // Per directory, not over the union: a renamed or moved directory would
    // otherwise scan nothing and pass on the other one's codes, which is this
    // guard's own defect arriving a second time.
    assert.ok(found.size > 0, `expected ${relative} to raise named codes`);
    for (const code of found) raised.add(code);
  }
  const unnamed = [...raised].filter(code => !MIGRATION_CODES.includes(code)).sort();
  assert.deepEqual(unnamed, [],
    'these codes would fall back to the generic redacted verdict; add them to MIGRATION_CODES');
  // A broker refusal is not a migration failure and must not be named as one:
  // those are answered to a caller at runtime, not printed in a CI log.
  assert.deepEqual(MIGRATION_CODES.filter(code => /BROKER|CONTRACT/.test(code)), []);
});

/**
 * The widened half, proved to bite rather than read correctly. A scan that
 * silently found nothing in the new directory would pass the test above on the
 * old directory's codes, so plant a code in a file shaped like an authority
 * migration and check it is both seen and reported unnamed. The second file
 * holds the other line: a code inside a CREATE FUNCTION body is a runtime
 * refusal and must stay invisible to this scan.
 */
test('a code planted in a migration is seen, and one inside a function body is not', async () => {
  const { MIGRATION_CODES } = await import('./http-local-stack.mjs');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, 'http-boundary-'));
  try {
    await writeFile(resolve(root, '20260926000000_planted_precondition.sql'),
      "begin;\ndo $$\nbegin\n  if false then\n"
      + "    raise exception using errcode='42501',message='PENNSYNC_PLANTED_PRECONDITION';\n"
      + '  end if;\nend $$;\ncommit;\n');
    await writeFile(resolve(root, '20260926000001_planted_runtime_refusal.sql'),
      'create function pennsync_private.planted() returns void language plpgsql as $fn$\nbegin\n'
      + "  raise exception using errcode='42501',message='PENNSYNC_PLANTED_RUNTIME_REFUSAL';\n"
      + 'end $fn$;\n');
    const found = await codesRaisedIn(pathToFileURL(root + sep));
    assert.deepEqual([...found].sort(), ['PENNSYNC_PLANTED_PRECONDITION']);
    assert.deepEqual([...found].filter(code => !MIGRATION_CODES.includes(code)),
      ['PENNSYNC_PLANTED_PRECONDITION'],
      'a planted code must be reported unnamed, or the allowlist check proves nothing');
  } finally {
    await removeOwnedFixture(root);
  }
});
