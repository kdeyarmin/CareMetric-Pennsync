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
  const started = await withClient(databaseUrl, 'PRODUCTION_PIN_START_TIME_UNREADABLE',
    async client => (await client.query('select pg_postmaster_start_time() as at')).rows[0]?.at);
  let position = 'A0000';
  const at = (stage, index) => { position = `${stage}${String(index).padStart(4, '0')}`; };
  try {
    await withClient(databaseUrl, 'PRODUCTION_PIN_STORE_BUILD_FAILED', async client => {
      const { rows } = await client.query('select set_config($1, $2, false) as value',
        [PIN_SETTING, PRODUCTION_APP]);
      if (rows[0]?.value !== PRODUCTION_APP) fail('PRODUCTION_PIN_SETTING_NOT_VISIBLE');
      const authority = (await readdir(AUTHORITY_MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
      for (const [index, name] of authority.entries()) {
        at('A', index);
        await client.query(await readFile(new URL(name, AUTHORITY_MIGRATIONS), 'utf8'));
      }
      // The record half, in the order a deployment applies it, through the helper
      // that owns that order rather than a second copy of it.
      let record = 0;
      await applyRecordMigrations({ exec: sql => { at('R', record++); return client.query(sql); } });
    });
  } catch (error) {
    if (!emittableProductionPin(error.message)) throw error;
    // The server's own liveness, read on a NEW connection: if it answers with the
    // same start time the session was lost under a running server, and if the
    // time moved the backend went down and came back. Either way the position
    // goes out, because without it the next run starts where this one did.
    let after = null;
    try {
      after = await withClient(databaseUrl, 'PRODUCTION_PIN_START_TIME_UNREADABLE',
        async client => (await client.query('select pg_postmaster_start_time() as at')).rows[0]?.at);
    } catch { fail(`PRODUCTION_PIN_SERVER_UNREACHABLE ${position}`); }
    // The liveness verdict is added ONLY where the failure carried no SQLSTATE.
    // A statement that failed and said why is already diagnosed, and replacing
    // its code with `_SESSION_LOST` would both lose the SQLSTATE and assert a
    // cause that is not the one that occurred -- the server is plainly fine if a
    // statement answered. The position goes on either way.
    const diagnosed = error.message.includes(' ');
    const kind = String(after) === String(started) ? 'SESSION_LOST' : 'SERVER_RESTARTED';
    fail(diagnosed ? `${error.message} ${position}` : `${error.message}_${kind} ${position}`);
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
