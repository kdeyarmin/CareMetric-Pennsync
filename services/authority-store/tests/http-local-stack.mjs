// Local-only CLI boundary. CLI status/start output contains credentials: never forward it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, unlink, access, readdir, readlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const exec = promisify(execFile);
export const PROJECT = 'local-pennsync-authority';
export const API = 'http://127.0.0.1:54321';
export const workdir = fileURLToPath(new URL('../', import.meta.url));
const marker = new URL('../supabase/.temp/http-harness-owner.json', import.meta.url);
const CLI = process.env.PENNSYNC_SUPABASE_CLI || 'supabase';
const EXCLUDED = 'analytics,edge-runtime,functions,imgproxy,meta,realtime,studio,vector';
const fail = code => { throw new Error(code); };
/**
 * Error codes this repository's own migrations raise. A CLI start that fails
 * while applying one of them is otherwise indistinguishable from a broken
 * Docker daemon, because the CLI's output carries credentials and is never
 * forwarded. Only a literal from this list is ever emitted, so naming the
 * failure cannot leak anything the CLI printed.
 */
export const MIGRATION_CODES = Object.freeze([
  'PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED',
  'PENNSYNC_AUTHORITY_STORE_REQUIRED',
  'PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS',
  'PENNSYNC_RECORD_OWNER_MUST_NOT_LOGIN',
  'PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE',
  'PENNSYNC_RECORD_OWNER_NOT_CREATABLE',
  // Raised by the broker and contract migrations. Omitting them sent exactly
  // the failures these diagnostics were added for back to the generic redacted
  // verdict; `http-boundary.test.mjs` now reads the migrations and fails if a
  // code they raise is missing here.
  'PENNSYNC_RECORD_STORE_REQUIRED',
  'PENNSYNC_RECORD_OWNER_REQUIRED',
  // D33's contract refuses to apply to a store whose `chart_assignment` has no
  // lifecycle columns, because it would otherwise create functions that fail on
  // their first call rather than at migration time.
  'PENNSYNC_ASSIGNMENT_LIFECYCLE_REQUIRED',
  // D35's, for the same reason: a contract that would create functions failing
  // on their first call refuses to apply instead.
  'PENNSYNC_MEMBERSHIP_LIFECYCLE_REQUIRED',
  // A correction to a shipped contract refuses to apply where the contract it
  // corrects is absent: `create or replace` would otherwise CREATE it, leaving
  // a store whose library writes have no chart check and no complaint.
  'PENNSYNC_CLINICAL_LIBRARY_REQUIRED',
  // D37's: the first contract to depend on D25's trail refuses to apply to a
  // store that has none.
  'PENNSYNC_ACTIVITY_TRAIL_REQUIRED',
  // D40's credential review refuses to apply without the submission half it
  // shares a projection with.
  'PENNSYNC_CREDENTIAL_SUBMIT_REQUIRED',
  // D45's notification contract needs D34's `caller_membership`, because the
  // authority envelope it filters on is THIS store's membership.
  'PENNSYNC_CALLER_MEMBERSHIP_REQUIRED',
  // D110. Raised by an AUTHORITY migration rather than a record one, which is
  // why it sat outside this list while the scan above read one directory: the
  // deployment pin refuses an app id `known_app` does not carry, so an operator
  // who mistypes `pennsync.deployment_app_id` when pinning a new deployment
  // gets a named refusal instead of the generic redacted verdict.
  'PENNSYNC_UNKNOWN_DEPLOYMENT_APP',
  // The crossed-chart read control needs the capabilities it replaces. Named
  // CAPABILITIES rather than CONTRACTS because the assertion below this list
  // forbids a code reading as a broker or contract refusal, and those are
  // answered to a caller at runtime rather than printed in a CI log.
  'PENNSYNC_OPERATIONAL_CAPABILITIES_REQUIRED',
  // And it refuses outright to an administrator that does not bypass row-level
  // security, because its helper would then answer null for every chart and
  // the term reading it would keep every row — a control that applies cleanly
  // and does nothing.
  'PENNSYNC_CHART_AGENCY_ADMIN_MUST_BYPASS_RLS',
]);
let pinnedDaemon;
const localDaemon = value => typeof value === 'string' &&
  (/^unix:\/\/\/[^?#\s]+$/.test(value) || /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/.test(value));
export function classifyToolFailure(binary, args, error) {
  const phases = binary === CLI ? { '--version': 'CLI_VERSION', start: 'CLI_START', stop: 'CLI_STOP', status: 'CLI_STATUS' }
    : { context: 'DOCKER_CONTEXT', container: 'DOCKER_CONTAINERS', volume: 'DOCKER_VOLUMES' };
  const phase = phases[args[0]] || 'TOOL';
  // Match known diagnostic categories only. No child text, filename, URL, token,
  // command, numeric exit payload or error cause is included in the returned code.
  const output = `${error.stdout || ''}\n${error.stderr || ''}`;
  // D123. THE FALL-THROUGH IS NOT ALSO THE EMPTY CASE. `FAILED_OUTPUT_REDACTED`
  // used to receive both "matched none of the categories above" and "there was
  // nothing to match", and main's own unreproducible
  // `LOCAL_CLI_START_FAILED_OUTPUT_REDACTED` at `00ae087b` is what that cost: a
  // reader could not tell whether the CLI had said something this module does
  // not recognise, or had said nothing at all. They point at different things —
  // an unrecognised diagnostic is a category to add here, while a silent
  // non-zero exit is the runner or the child dying before it printed, which is
  // outside this repository entirely — and the silent reading is the one that
  // vanishes into the other. It stays inside the no-forwarding rule because
  // neither code carries a byte of what the child said.
  let reason = output.trim() === '' ? 'FAILED_NO_OUTPUT' : 'FAILED_OUTPUT_REDACTED';
  if (error.code === 'ENOENT') reason = 'EXECUTABLE_NOT_FOUND';
  else if (/supabase-go/i.test(output) && /not found|no such file|ENOENT|missing/i.test(output)) reason = 'DELEGATE_MISSING';
  else if (/failed to parse config|invalid config|decoding failed|toml:/i.test(output)) reason = 'CONFIG_INVALID';
  else if (/unknown flag|unknown command|unrecognized option/i.test(output)) reason = 'OPTION_UNSUPPORTED';
  else if (/cannot connect to the docker daemon|error during connect|is the docker daemon running/i.test(output)) reason = 'DAEMON_UNAVAILABLE';
  else if (/permission denied while trying to connect to the docker/i.test(output)) reason = 'DAEMON_PERMISSION_DENIED';
  else if (error.killed) reason = 'TIMED_OUT';
  // D141. THE FALL-THROUGH IS A QUEUE, AND THESE THREE WERE IN IT. D123 split
  // `FAILED_OUTPUT_REDACTED` from `FAILED_NO_OUTPUT` and said in as many words
  // that an unrecognised diagnostic is "a category to add here"; the plan
  // thread's `2e430717` then produced one, on a head that carries D123, so the
  // reading is trustworthy for the first time: the CLI printed something none
  // of the branches above name. What it printed is NOT recoverable -- the
  // no-forwarding rule means nothing captured it -- so these branches claim
  // nothing about THAT occurrence and are not offered as its cause. They are
  // the classes a `supabase start` demonstrably fails with that had no name,
  // so the NEXT one says which rather than falling through. Each pattern is
  // planted in `http-boundary.test.mjs`, because a branch nothing has been
  // shown to reach is indistinguishable from a branch that cannot be.
  //
  // A port taken between the pre-flight and the start is the one worth calling
  // out: the port series exists precisely because that window is real, and it
  // is attached to the error as `observed` at pre-flight time, which cannot
  // fire for a port that was free when it looked. Docker reports it from the
  // daemon, so it arrives HERE, and it read as unrecognised until now.
  // A bare `bind: ` alternative was here and is REMOVED, on Copilot's finding:
  // it matches `bind: permission denied` and `bind: cannot assign requested
  // address`, neither of which is a taken port, and naming a wrong cause
  // confidently is worse than falling through to the redacted verdict. That is
  // this branch's own asymmetry biting the branch that wrote it down — too wide
  // fails loudly, and this one failed loudly to a reviewer rather than in CI.
  else if (/port is already allocated|address already in use/i.test(output)) reason = 'PORT_TAKEN_DURING_START';
  // An image the runner could not obtain is not this repository's fault and is
  // worth separating from one it obtained and could not run: a registry rate
  // limit is the common shape on a shared runner and resolves itself, where a
  // missing manifest is a pin nobody can satisfy.
  else if (/toomanyrequests|rate limit|failed to pull|manifest unknown|manifest for .* not found|pull access denied/i.test(output)) reason = 'IMAGE_UNAVAILABLE';
  // And a container the daemon started and then judged unhealthy, which is the
  // shape a start takes when it gets far enough to wait on a service. It sits
  // after the two above because an unobtainable image also leaves a service
  // unstarted, and the earlier cause is the one to report.
  // Same narrowing here, for the same reason. A bare `unhealthy` alternative
  // matched the word anywhere in any diagnostic; `is unhealthy` is the shape
  // docker actually prints (`dependency failed to start: container X is
  // unhealthy`), and the container alternative takes one token rather than a
  // greedy `.*` that could span an unrelated clause on the same line.
  else if (/is not healthy|is unhealthy|service not healthy|health check failed|container [^\s]+ (?:exited|is not running)/i
    .test(output)) reason = 'SERVICE_UNHEALTHY';
  // A migration that raised one of our own codes says so by name. Nothing but a
  // literal above is emitted, so this stays inside the no-forwarding rule while
  // turning an unreadable start failure into the one fact worth knowing.
  else if (MIGRATION_CODES.some(code => output.includes(code))) {
    reason = `MIGRATION_${MIGRATION_CODES.find(code => output.includes(code))}`;
  }
  // Otherwise say at least whether the database rejected something, which
  // separates a SQL fault from a daemon or image fault without quoting either.
  else if (/^\s*ERROR:\s/mi.test(output) || /\bSQLSTATE\b/i.test(output)) reason = 'SQL_REJECTED';
  return `LOCAL_${phase}_${reason}`;
}
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
    fail(classifyToolFailure(binary, args, error));
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
export const PORT_ATTEMPTS = 6;
export const PORT_RETRY_MS = 1000;
const bindOnce = port => new Promise((done, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => server.close(done));
});
const TCP_STATES = Object.freeze({
  '01': 'ESTABLISHED', '02': 'SYN_SENT', '03': 'SYN_RECV', '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2', '06': 'TIME_WAIT', '07': 'CLOSE', '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK', '0A': 'LISTEN', '0B': 'CLOSING',
});
/**
 * Name the process holding a socket, WITHOUT reading `/proc/<pid>/cmdline`.
 * An argument vector can carry a database URL or an access token, and this
 * module's whole emit discipline is that nothing a subprocess printed is
 * forwarded. `comm` is the executable name and cannot carry either.
 */
const holderName = async inode => {
  if (inode === '0') return null;
  let pids;
  try { pids = (await readdir('/proc')).filter(entry => /^\d+$/.test(entry)); } catch { return null; }
  for (const pid of pids) {
    let fds;
    try { fds = await readdir(`/proc/${pid}/fd`); } catch { continue; } // another user's process
    for (const fd of fds) {
      let link;
      try { link = await readlink(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (link !== `socket:[${inode}]`) continue;
      try { return `${(await readFile(`/proc/${pid}/comm`, 'utf8')).trim()}(${pid})`; }
      catch { return `pid ${pid}`; }
    }
  }
  return null;
};
/**
 * Describe what is sitting on a local port, for the refusal below.
 *
 * Linux only, by reading `/proc/net/tcp{,6}` rather than shelling out: neither
 * `ss` nor `lsof` is guaranteed on a runner, and both of them print argument
 * vectors. It NEVER throws and NEVER reports a failure to look: a diagnostic
 * that can itself fail the pre-flight would be worse than no diagnostic, and a
 * developer running this on Windows or macOS gets the port and nothing else.
 */
export async function describePortHolder(port) {
  const wanted = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  const found = [];
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let rows;
    try { rows = (await readFile(table, 'utf8')).split('\n').slice(1); } catch { continue; }
    for (const row of rows) {
      const field = row.trim().split(/\s+/);
      if (!field[1]?.endsWith(wanted)) continue;
      const who = await holderName(field[9]);
      found.push(`${TCP_STATES[field[3]] || `state ${field[3]}`}${who ? ` held by ${who}` : ''}`);
    }
  }
  return found.length ? found.join('; ') : 'holder not visible from here';
}
/**
 * Refuse to start when one of the stack's ports is taken, so a collision is a
 * named refusal instead of a confusing CLI failure several minutes later.
 *
 * It RETRIES, and the reason is evidence rather than caution: this check failed
 * twice on otherwise idle CI runners and passed on the immediate re-run both
 * times, and it has since failed a third time, on `fe8dabb` on 2026-09-25.
 *
 * What the retry is NOT for: the comment here used to read that pattern as "a
 * port in TIME_WAIT", and TIME_WAIT cannot produce it. Measured on Node
 * 24.18.0, the version CI runs: plant a real TIME_WAIT socket on a port,
 * confirm it in `/proc/net/tcp`, and `server.listen()` on that port still
 * SUCCEEDS, because Node sets `SO_REUSEADDR`. Only a live socket raises
 * `EADDRINUSE`. So the window this retry buys covers one thing -- a process
 * that is still closing -- and the third failure spent all PORT_ATTEMPTS,
 * which that cannot explain.
 *
 * The cause it might be is unproved and deliberately not fixed here: 54320,
 * 54321, 54322 and 54324 all sit inside Linux's default ephemeral range
 * (32768-60999), so any OS-assigned port in the same job can land on one of
 * them. Do not reserve the ports until an occurrence NAMES one -- which is why
 * the refusal now carries the port and prints what held it. A port something
 * actually HOLDS stays held for all PORT_ATTEMPTS and still refuses, so the
 * guarantee is unchanged. Do not replace this with a single bind.
 *
 * THE HOLDER IS DESCRIBED AT EACH FAILURE, NEVER AFTER THE RETRIES (D112).
 * The first version of that diagnostic ran `describePortHolder` once, after the
 * last attempt, and the fourth occurrence is what showed why that is not the
 * same thing: `ac251b2` printed `Port 54322: TIME_WAIT` and then the refusal,
 * and the measurement above says TIME_WAIT cannot refuse a bind. Both readings
 * were right about different MOMENTS -- something live held the port through
 * ~5.6 s of retries and had closed into TIME_WAIT by the time it was
 * described. So the reader got a representation of a moment that was not the
 * failure, which is worse than no diagnostic: it looks like evidence, it reads
 * as a cause, and it makes an unmade decision (whether to reserve these ports)
 * look ready to make. A diagnostic belongs at the moment of failure.
 *
 * Every failed attempt is therefore described as it happens and kept, and the
 * whole series is printed on refusal, so a holder that changed across the
 * window is visible as a change rather than collapsed into its last state. The
 * bind's own `errno` code is carried too, allowlisted to `E`-prefixed letters:
 * it was discarded entirely before, so nothing could tell `EADDRINUSE` from an
 * `EACCES` or `EADDRNOTAVAIL` that would make this whole paragraph misdirected.
 *
 * The cost is one `/proc` walk per failed attempt instead of one per refusal,
 * paid only on a path that is already a second into failing. The series is also
 * attached to the error as `observed`, which `emittable` never prints -- only
 * `error.message` reaches an operator, and that stays the bare code and port.
 */
export async function unusedPort(port) {
  const observed = [];
  for (let attempt = 1; ; attempt += 1) {
    try {
      await bindOnce(port);
      return;
    } catch (error) {
      // Guarded although `describePortHolder` is written not to throw: a
      // diagnostic that replaced the refusal with the redacted verdict would
      // lose the port as well as the holder, which is the whole point of it.
      let holder = 'holder not described';
      try { holder = await describePortHolder(port); } catch { /* keep the refusal */ }
      const code = /^E[A-Z]{2,15}$/.test(error?.code || '') ? error.code : 'code not reported';
      observed.push(`attempt ${attempt} ${code}: ${holder}`);
      if (attempt >= PORT_ATTEMPTS) {
        for (const line of observed) process.stderr.write(`Port ${port}: ${line}\n`);
        const refusal = new Error(`LOCAL_PORT_ALREADY_IN_USE ${port}`);
        refusal.observed = observed;
        throw refusal;
      }
      await delay(PORT_RETRY_MS);
    }
  }
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
/**
 * What may be printed when `main` throws. Everything else becomes the redacted
 * verdict, because the CLI's own output carries credentials.
 *
 * It is EXPORTED so it can be tested, and it is tested because it is where a
 * diagnostic goes to die: `unusedPort` now throws
 * `LOCAL_PORT_ALREADY_IN_USE 54321`, and against the original
 * `^LOCAL_[A-Z_]+$` that message did not match, so the port this change exists
 * to surface would have been redacted away on the only path that prints it.
 * The trailing group is at most five digits and cannot carry a credential;
 * nothing else is widened.
 */
export const emittable = message =>
  /^(LOCAL_[A-Z_]+( [0-9]{1,5})?|LINKED_PROJECT_FORBIDDEN|EXPECTED_START_OR_STOP)$/.test(message);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(process.argv[2]); }
  catch (error) {
    const safe = emittable(error.message) ? error.message : 'LOCAL_STACK_FAILED_DETAILS_REDACTED';
    process.stderr.write(`${safe}\n`); process.exitCode = 1;
  }
}
