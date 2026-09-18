// Local-only CLI boundary. CLI status/start output contains credentials: never forward it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const exec = promisify(execFile);
export const PROJECT = 'local-pennsync-authority';
export const API = 'http://127.0.0.1:54321';
export const workdir = fileURLToPath(new URL('../', import.meta.url));
const marker = new URL('../supabase/.temp/http-harness-owner.json', import.meta.url);
const CLI = process.env.PENNSYNC_SUPABASE_CLI || 'supabase';
const EXCLUDED = 'analytics,edge-runtime,functions,imgproxy,meta,realtime,storage,studio,vector';
const fail = code => { throw new Error(code); };
let pinnedDaemon;
const localDaemon = value => typeof value === 'string' &&
  (/^unix:\/\/\/[^?#\s]+$/.test(value) || /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/.test(value));
async function captured(binary, args, timeout = 120000) {
  try {
    const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' };
    if (pinnedDaemon) {
      env.DOCKER_HOST = pinnedDaemon;
      delete env.DOCKER_CONTEXT; delete env.DOCKER_TLS; delete env.DOCKER_TLS_VERIFY; delete env.DOCKER_CERT_PATH;
    }
    return (await exec(binary, args, { cwd: workdir, timeout, maxBuffer: 16 * 1024 * 1024,
      windowsHide: true, env })).stdout;
  } catch (error) {
    // Do not include the child error, message, command output, env or cause.
    fail(error.code === 'ENOENT' ? 'LOCAL_TOOL_NOT_FOUND' : 'LOCAL_TOOL_FAILED_OUTPUT_REDACTED');
  }
}
async function resolveLocalDaemon() {
  // Context inspection reads local CLI metadata, not the remote daemon. Docker's
  // DOCKER_CONTEXT override takes precedence over DOCKER_HOST.
  let endpoint;
  if (process.env.DOCKER_CONTEXT || !process.env.DOCKER_HOST) {
    let contexts;
    try { contexts = JSON.parse(await captured('docker', ['context', 'inspect',
      ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : [])])); }
    catch { fail('LOCAL_DOCKER_CONTEXT_UNAVAILABLE'); }
    if (contexts.length !== 1) fail('LOCAL_DOCKER_CONTEXT_INVALID');
    endpoint = contexts[0]?.Endpoints?.docker?.Host;
  } else endpoint = process.env.DOCKER_HOST;
  if (!localDaemon(endpoint)) fail('LOCAL_DOCKER_ENDPOINT_REQUIRED');
  return endpoint;
}
async function localConfig() {
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  if (!config.includes(`project_id = "${PROJECT}"`) || !config.includes('schemas = ["public"]')) fail('LOCAL_CONFIG_MISMATCH');
  for (const name of ['project-ref', 'linked-project-id']) {
    const exists = await access(new URL(`../supabase/.temp/${name}`, import.meta.url)).then(() => true, () => false);
    if (exists) fail('LINKED_PROJECT_FORBIDDEN');
  }
}
export async function assertOwnedStack() {
  await localConfig();
  let owner;
  try { owner = JSON.parse(await readFile(marker, 'utf8')); } catch { fail('LOCAL_STACK_OWNERSHIP_REQUIRED'); }
  if (owner.project !== PROJECT || owner.workdir !== workdir || owner.version !== 2
    || !localDaemon(owner.daemon)) fail('LOCAL_STACK_OWNERSHIP_MISMATCH');
  if (await resolveLocalDaemon() !== owner.daemon) fail('LOCAL_DOCKER_OWNERSHIP_MISMATCH');
  pinnedDaemon = owner.daemon;
}
export async function localStatus() {
  await assertOwnedStack();
  let status;
  try { status = JSON.parse(await captured(CLI, ['status', '--workdir', workdir, '-o', 'json'])); }
  catch { fail('LOCAL_STATUS_UNAVAILABLE_OUTPUT_REDACTED'); }
  let db;
  try { db = new URL(status.DB_URL); } catch { fail('LOCAL_DATABASE_TARGET_INVALID'); }
  if (status.API_URL !== API || db.protocol !== 'postgresql:' || db.hostname !== '127.0.0.1'
    || db.port !== '54322' || db.pathname !== '/postgres' || db.username !== 'postgres'
    || db.search || db.hash) fail('LOCAL_TARGET_MISMATCH');
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(status.PUBLISHABLE_KEY || '')
    || !/^sb_secret_[A-Za-z0-9_-]{10,200}$/.test(status.SECRET_KEY || '')) fail('LOCAL_MODERN_KEYS_REQUIRED');
  return status; // Callers must keep this object in memory, never report it.
}
async function unusedPort(port) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('LOCAL_PORT_ALREADY_IN_USE')));
    server.listen(port, '127.0.0.1', () => server.close(done));
  });
}
async function main(action) {
  await localConfig();
  if (action === 'start') {
    pinnedDaemon = await resolveLocalDaemon();
    if ((await captured(CLI, ['--version'])).trim() !== '2.109.1') fail('LOCAL_CLI_VERSION_MISMATCH');
    // Refuse to adopt or destroy a stack or volumes that predate this harness.
    for (const type of ['container', 'volume']) {
      const found = await captured('docker', [type, 'ls', ...(type === 'container' ? ['-a'] : []),
        '--filter', `label=com.supabase.cli.project=${PROJECT}`, '--quiet']);
      if (found.trim()) fail('LOCAL_PROJECT_ALREADY_EXISTS');
    }
    const marked = await access(marker).then(() => true, () => false);
    if (marked) fail('LOCAL_STACK_MARKER_EXISTS_USE_SCOPED_STOP');
    for (const port of [54321, 54322, 54324]) await unusedPort(port);
    await mkdir(new URL('../supabase/.temp/', import.meta.url), { recursive: true });
    await writeFile(marker, JSON.stringify({ version: 2, project: PROJECT, workdir, daemon: pinnedDaemon }), { flag: 'wx' });
    // Keep the ownership marker on failure so `stop` can clean only this attempted stack.
    await captured(CLI, ['start', '--workdir', workdir, '--exclude', EXCLUDED], 12 * 60 * 1000);
    await localStatus();
    process.stdout.write('Owned local Supabase Auth/PostgREST stack ready; credentials suppressed.\n');
  } else if (action === 'stop') {
    if (!await access(marker).then(() => true, () => false)) {
      process.stdout.write('No stack owned by this harness; cleanup made no changes.\n'); return;
    }
    await assertOwnedStack();
    await captured(CLI, ['stop', '--workdir', workdir, '--project-id', PROJECT, '--no-backup']);
    await unlink(marker);
    process.stdout.write('Owned local stack stopped; its disposable data volumes removed.\n');
  } else fail('EXPECTED_START_OR_STOP');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv[2]); }
  catch (error) {
    const safe = /^(LOCAL_[A-Z_]+|LINKED_PROJECT_FORBIDDEN|EXPECTED_START_OR_STOP)$/.test(error.message) ? error.message : 'LOCAL_STACK_FAILED_DETAILS_REDACTED';
    process.stderr.write(`${safe}\n`); process.exitCode = 1;
  }
}
