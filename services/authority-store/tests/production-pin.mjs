// Local-only boundary, same rule as `http-local-stack.mjs`: the stack's status
// output carries credentials and is NEVER forwarded. Only literals from
// `emittableProductionPin` below are ever printed.
//
// WHY THIS EXISTS: the production acceptance run needs a local store pinned to
// the PRODUCTION app id, and D11 makes that pin a generated IMMUTABLE constant
// decided once, in the first migration, from `pennsync.deployment_app_id`, and
// uneditable afterwards (`20260919090000_deployment_app_pin.sql`, which defaults
// to STAGING — the restrictive outcome, deliberately). A mis-pinned database is
// replaced, not corrected.
//
// WHY THE STORE IS BUILT HERE RATHER THAN BY THE CLI, which is the whole design
// and was arrived at by measurement rather than by reading. `supabase start`
// applies `supabase/migrations` itself, and FIVE runs of this job established
// that nothing a caller sets reaches the session it applies them in:
//
//   `PGOPTIONS` on the CLI's process is not inherited by it.
//   `ALTER ROLE ... SET` as the published `postgres` role answers SQLSTATE 42501,
//     insufficient_privilege — a custom parameter with no extension behind it is
//     a placeholder, and PostgreSQL will not let a non-superuser store one,
//     because it cannot check who may set it.
//   The same write as the stack's own superuser SUCCEEDS, and the store still
//     comes back pinned to staging.
//   Both stored scopes at once, role-wide (`setdatabase = 0`) and
//     database-scoped, leave NEITHER row in `pg_db_role_setting` after a
//     `db reset`, and an `ALTER SYSTEM` setting proved visible beforehand is not
//     read either.
//
// So `supabase db reset` leaves nothing behind in the cluster, and there is no
// hook between cluster creation and migration application that the CLI exposes.
// The store is therefore applied from HERE, in one session carrying the setting,
// onto a stack started with `[db.migrations]` disabled — which also keeps Auth and
// PostgREST live over it, which is what an acceptance run needs and what a second
// database on the side could never have given.
//
// This module asserts the FOUNDATION only. It signs nobody in and reads no
// business row; the acceptance run that stands on it is separate.
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { localStatus } from './http-local-stack.mjs';
import { applyRecordMigrations } from './record-migrations.mjs';
// The SAME splitter the migrate tooling records a ledger row with, never a
// second parser: it splits by offset into the original and the result is checked
// to reconstruct it exactly. Its module imports nothing but the shape reader, so
// it is reachable from this directory's isolated install.
import { splitStatements } from '../../../tools-pennsync-ledger-statements.mjs';

const fail = code => { throw new Error(code); };

export const PRODUCTION_APP = '694ec16e72e01b60d22f7cbf';
export const STAGING_APP = '6a9881683dc68a0bd54f1ef7';
/** The setting the pin migration reads once. Mirrors `tools-pennsync-provision.mjs`. */
export const PIN_SETTING = 'pennsync.deployment_app_id';
/** The authority half of the store, applied before the record half. */
export const AUTHORITY_MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);

/**
 * What may be printed when this module throws. Everything else becomes the
 * redacted verdict, because the stack's own output carries credentials. Tested
 * for the reason `emittable` is: this is where a diagnostic goes to die.
 *
 * The optional five-character suffix is a SQLSTATE and nothing else. An earlier
 * run of this job was spent on a bare code with no way to tell a privilege
 * refusal from a bad parameter name, because the message a redaction rule cannot
 * pass is also the message the author needs — and a SQLSTATE is five characters
 * from a fixed set defined by the standard, carrying no identifier, no URL and no
 * free text.
 */
export const emittableProductionPin = message =>
  /^(PRODUCTION_PIN_[A-Z_]+( [0-9A-Z]{5}){0,2}|LOCAL_[A-Z_]+( [0-9]{1,5})?)$/.test(message);

/**
 * A failing statement's SQLSTATE, and nothing else.
 *
 * An error with no code (a socket failure, a thrown string) adds nothing, which
 * keeps the bare code the empty case rather than a second meaning for one value.
 */
const withSqlstate = (code, error) =>
  fail(/^[0-9A-Z]{5}$/.test(error?.code ?? '') ? `${code} ${error.code}` : code);

/**
 * A client against the running stack's own database.
 *
 * `pg` is resolved from `services/authority-store`'s isolated install, which is
 * the only place it is a dependency — the same reason the suites here do it.
 */
function clientFor(databaseUrl) {
  const require = createRequire(import.meta.url);
  let pg;
  try { pg = require('pg'); } catch { fail('PRODUCTION_PIN_PG_UNAVAILABLE'); }
  const client = new pg.Client({ connectionString: databaseUrl, application_name: 'pennsync-production-pin' });
  // WHY A NO-OP LISTENER IS THE FIX RATHER THAN A SHRUG. When the socket dies
  // mid-query, `pg` rejects the in-flight query AND emits `'error'` on the
  // client. With nothing listening, that second half is an unhandled `'error'`
  // event, which node:test reports as the raw `Connection terminated
  // unexpectedly` before this module's catch can reach the rejection — so the
  // position and liveness code added to say WHICH file died, and whether the
  // server went with it, never printed once. The rejection carries the same
  // failure, and `withClient` classifies it; this listener only stops the
  // duplicate from pre-empting that.
  client.on('error', () => {});
  return client;
}

/** Connect, do one thing, always close. The code names which step failed. */
async function withClient(databaseUrl, code, body) {
  const client = clientFor(databaseUrl);
  try {
    await client.connect();
    return await body(client);
  } catch (error) {
    if (emittableProductionPin(error.message)) throw error;
    return withSqlstate(code, error);
  } finally { await client.end().catch(() => {}); }
}

/**
 * Build a production-pinned store on the running stack, and prove it.
 *
 * Returns only the pin values. The status object it reads carries the publishable
 * and secret keys and the database URL, so it never leaves here.
 */
export async function pinLocalStackToProduction() {
  const status = await localStatus();
  const databaseUrl = status.DB_URL;

  // The premise is GUARDED rather than assumed. If the stack were started with
  // migrations enabled, this function would already exist, the store would
  // already be pinned to staging, and applying the migrations below would fail
  // somewhere in the middle for reasons that read as a broken migration.
  await withClient(databaseUrl, 'PRODUCTION_PIN_EMPTY_READ_FAILED', async client => {
    const { rows } = await client.query(`select to_regprocedure(
      'pennsync_private.deployment_app_id()') is not null as pinned`);
    if (rows[0]?.pinned !== false) fail('PRODUCTION_PIN_STORE_ALREADY_APPLIED');
  });

  // ONE session for the setting and the whole store, because `set_config` with
  // `is_local` false is session-scoped: the `do` block that bakes the pin into an
  // IMMUTABLE function body has to run in the same session that carries it.
  // Bound rather than interpolated -- `set_config` is an ordinary function, unlike
  // the `ALTER ROLE` this replaces.
  // WHICH FILE, and whether the SERVER or only the SESSION went. A build failure
  // here is a bare code otherwise, and the first run of this design spent itself
  // on exactly that: `Connection terminated unexpectedly` names no file, and a
  // socket that closes with no error packet carries no SQLSTATE either, so the
  // two causes that need different fixes -- a backend that died and a session
  // that was killed under a server still running -- read identically. The
  // position is a stage letter and a four-digit index into that directory's own
  // sorted listing, which is five characters from a fixed set, like a SQLSTATE,
  // and names no file or statement.
  //
  // WHAT THE SQL ITSELF DOES, measured here rather than guessed at from CI: the
  // authority half and all of the record half apply cleanly, in that order and in
  // one session carrying this setting, onto a plain PostgreSQL 16 cluster with
  // `tests/bootstrap.sql`'s `auth` prelude in front of them — the authority half
  // in about 180 ms, the first record file (the generated store, the largest
  // single batch by far) in about 650 ms, the whole build in about 1.3 s. So a
  // build that dies at `R0000` inside the CLI's own container, at a wall time
  // consistent with that first file still running, is a fact about the container
  // rather than about the migration, which is why the step above reads the
  // server's log on failure instead of this module reporting more.
  const started = await withClient(databaseUrl, 'PRODUCTION_PIN_START_TIME_UNREADABLE',
    async client => (await client.query('select pg_postmaster_start_time() as at')).rows[0]?.at);
  let position = 'A0000';
  const at = (stage, index) => { position = `${stage}${String(index).padStart(4, '0')}`; };
  // WHAT THE CONTAINER'S OWN LOG SAID, which is why there is a second pass below
  // at all. The failure step added to this job reported
  // `server process (PID …) was terminated by signal 11: Segmentation fault`,
  // `oom_killed=false`, and the server reinitializing — a BACKEND CRASH inside
  // the CLI's bundled image while the first record file was in flight. The same
  // file applies in about 650 ms on a plain PostgreSQL 16 cluster here and has
  // been applied by the hosted Supabase project, so the SQL is not the thing that
  // crashes; a 480 KiB multi-statement string reaching that image is.
  //
  // So the batch is tried FIRST, because one string per file is the shape a
  // deployment uses (`tools-pennsync-migrate.mjs` sends each file whole), and the
  // split is a documented FALLBACK rather than the normal path. It is not silent:
  // a run that falls back prints which file it fell back on and how many
  // statements it took, and a split that dies too reports the statement's index,
  // which is the one thing the previous instrument could not say.
  let statementPosition = null;
  const splitApply = async (client, sql, index) => {
    const statements = splitStatements(sql);
    for (const [statement, text] of statements.entries()) {
      statementPosition = `S${String(statement).padStart(4, '0')}`;
      await client.query(text);
    }
    statementPosition = null;
    console.log(`PRODUCTION_PIN_BATCH_SPLIT_APPLIED R${String(index).padStart(4, '0')} `
      + `S${String(statements.length).padStart(4, '0')}`);
  };
  const build = async (client, { splitRecordFrom = null } = {}) => {
    const { rows } = await client.query('select set_config($1, $2, false) as value',
      [PIN_SETTING, PRODUCTION_APP]);
    if (rows[0]?.value !== PRODUCTION_APP) fail('PRODUCTION_PIN_SETTING_NOT_VISIBLE');
    if (splitRecordFrom === null) {
      const authority = (await readdir(AUTHORITY_MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
      for (const [index, name] of authority.entries()) {
        at('A', index);
        await client.query(await readFile(new URL(name, AUTHORITY_MIGRATIONS), 'utf8'));
      }
    }
    // The record half, in the order a deployment applies it, through the helper
    // that owns that order rather than a second copy of it — on the recovery pass
    // too, which SKIPS what already committed instead of reading the directory
    // itself. A crash rolls back the file that was in flight and nothing else.
    let record = 0;
    await applyRecordMigrations({
      exec: sql => {
        const index = record++;
        at('R', index);
        if (splitRecordFrom === null) return client.query(sql);
        if (index < splitRecordFrom) return Promise.resolve(null);
        return splitApply(client, sql, index);
      },
    });
  };
  try {
    await withClient(databaseUrl, 'PRODUCTION_PIN_STORE_BUILD_FAILED',
      client => build(client));
  } catch (error) {
    if (!emittableProductionPin(error.message)) throw error;
    // The server's own liveness, read on a NEW connection: if it answers with the
    // same start time the session was lost under a running server, and if the
    // time moved the backend went down and came back. Either way the position
    // goes out, because without it the next run starts where this one did.
    //
    // AND IT KEEPS THE BUILD'S OWN CODE. The first version replaced it with a
    // bare `PRODUCTION_PIN_SERVER_UNREACHABLE`, which threw away the SQLSTATE of
    // the statement that died in the one case where the author needs it most —
    // the run that produced this comment said only that a reconnect failed, so
    // whether the statement had answered at all was unknowable. The liveness
    // verdict is a SUFFIX on the build's code, never a substitute for it.
    //
    // THE RECONNECT IS BOUNDED RATHER THAN SINGLE. A crashed backend leaves the
    // server reinitializing, and a connection during recovery is refused with
    // `the database system is in recovery mode` — the log in this job shows two
    // other clients getting exactly that in the same second. A single attempt
    // therefore reported the server unreachable when it was coming back, which is
    // a different fault from the one that occurred.
    const liveness = async () => withClient(databaseUrl, 'PRODUCTION_PIN_START_TIME_UNREADABLE',
      async client => (await client.query('select pg_postmaster_start_time() as at')).rows[0]?.at);
    let after = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { after = await liveness(); break; } catch {
        await new Promise(resolve => { setTimeout(resolve, 1000); });
      }
    }
    if (after === null) {
      const [base, sqlstate] = error.message.split(' ');
      fail(`${base}_SERVER_UNREACHABLE${sqlstate ? ` ${sqlstate}` : ''} ${position}`);
    }
    // THE SECOND PASS, and only for the one failure it is about: a record file
    // that was in flight when the BACKEND went down, with no SQLSTATE of its own.
    // Anything that answered with a SQLSTATE is already diagnosed and is not
    // retried — a refusal does not become a different refusal when it is sent
    // twice, and retrying it would hide it behind the split's own outcome.
    // WHAT COUNTS AS THE BACKEND HAVING DIED, corrected by a run. The first
    // version of this required the postmaster's start time to have MOVED, and
    // `pg_postmaster_start_time()` does not move when a backend crashes: the
    // postmaster survives, reinitializes, and reports the same start time. The
    // run that proved it printed `signal 11: Segmentation fault` in the
    // container's log and `_SESSION_LOST` in this module's own verdict, so the
    // split pass never ran. A failure with no SQLSTATE is a session that died
    // without an error packet, which is the case either way — so the liveness
    // verdict says whether the POSTMASTER went, and it never says the backend
    // did not.
    const crashed = !error.message.includes(' ') && position.startsWith('R');
    let recovered = false;
    if (crashed) {
      const from = Number(position.slice(1));
      try {
        await withClient(databaseUrl, 'PRODUCTION_PIN_STORE_SPLIT_FAILED',
          client => build(client, { splitRecordFrom: from }));
        // It applied statement by statement. The store is built, so this falls
        // through to the same verification every run does — the pin still read
        // from a NEW session — and the printed line above says the batch was the
        // thing the container could not take.
        recovered = true;
      } catch (splitError) {
        if (!emittableProductionPin(splitError.message)) throw splitError;
        // WHICH STATEMENT, which is the thing the first instrument could not say.
        // The file's position is already in the code; the statement index goes
        // where the liveness verdict would have gone, because a split that died
        // has answered the liveness question by arriving here.
        const [base, sqlstate] = splitError.message.split(' ');
        fail(`${base}${sqlstate ? ` ${sqlstate}` : ''} `
          + `${statementPosition ?? position}`);
      }
    }
    // The liveness verdict is added ONLY where the failure carried no SQLSTATE,
    // and it distinguishes a POSTMASTER restart from a session that died under a
    // postmaster that is still the same one — NOT a live backend from a dead one,
    // which is what an earlier reading of it claimed.
    // A statement that failed and said why is already diagnosed, and replacing
    // its code with `_SESSION_LOST` would both lose the SQLSTATE and assert a
    // cause that is not the one that occurred -- the server is plainly fine if a
    // statement answered. The position goes on either way.
    if (!recovered) {
      const diagnosed = error.message.includes(' ');
      const kind = String(after) === String(started) ? 'SESSION_LOST' : 'SERVER_RESTARTED';
      fail(diagnosed ? `${error.message} ${position}` : `${error.message}_${kind} ${position}`);
    }
  }

  // A NEW session, because the pin is only worth anything if it is a property of
  // the STORE rather than of the session that built it.
  const pin = await readPin(databaseUrl);
  if (pin.app_id !== PRODUCTION_APP || pin.label !== 'production') fail('PRODUCTION_PIN_NOT_APPLIED');
  // `setting` rather than `default` is what distinguishes a pin that was CHOSEN
  // from one that merely happens to match.
  if (pin.source !== 'setting') fail('PRODUCTION_PIN_RECORDED_AS_DEFAULT');
  // The containment the pin exists for, read from the store rather than inferred
  // from the label.
  if (pin.admits_production !== true || pin.admits_staging !== false) fail('PRODUCTION_PIN_CONTAINMENT_WRONG');
  return Object.freeze({ app_id: pin.app_id, label: pin.label, source: pin.source });
}

/** The pin, read back from a session that did not set anything. */
const readPin = databaseUrl =>
  withClient(databaseUrl, 'PRODUCTION_PIN_READBACK_FAILED', async client => {
    const { rows } = await client.query(`select pennsync_private.deployment_app_id() as app_id,
      pennsync_private.deployment_label() as label,
      (select d.source from pennsync_private.deployment d) as source,
      pennsync_private.app_admitted($1) as admits_production,
      pennsync_private.app_admitted($2) as admits_staging`, [PRODUCTION_APP, STAGING_APP]);
    if (!rows[0]) fail('PRODUCTION_PIN_READBACK_EMPTY');
    return rows[0];
  });
