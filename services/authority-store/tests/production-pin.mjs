// Local-only CLI boundary, same rule as `http-local-stack.mjs`: CLI and status
// output carries credentials and is NEVER forwarded. Only literals from
// `emittableProductionPin` below are ever printed.
//
// WHY THIS EXISTS, and why it is a separate module rather than a third action on
// `http-local-stack.mjs`: the production acceptance run needs a local store
// pinned to the PRODUCTION app id, and D11 makes that pin a generated IMMUTABLE
// constant decided once, before the first migration runs, and uneditable
// afterwards (`20260919090000_deployment_app_pin.sql`). `supabase start` applies
// `supabase/migrations` itself, with `[db.migrations] enabled = true`, and the
// pin block defaults to STAGING when the setting is unset — the restrictive
// outcome, deliberately. So a stack the CLI started is already pinned to staging
// and cannot be corrected: a mis-pinned database is replaced, not edited.
//
// The route taken here is the one that needs no second project directory and no
// change to the shared `config.toml` that every staging job depends on:
//
//   1. set the pin setting on the ROLE rather than on the database, which puts a
//      row in `pg_db_role_setting` with `setdatabase = 0` — cluster-scoped, so
//      it is NOT stored inside the database that is about to be dropped. The
//      write is made as the stack's SUPERUSER, because storing a custom
//      placeholder parameter on a role or a database is a superuser-only write
//      and a local stack's `postgres` is not one; the function below records the
//      two routes that were measured not to work, and why;
//   2. `supabase db reset`, which recreates the database and re-applies the
//      migrations, so the pin block runs again and now reads the setting;
//   3. read `deployment_app_id()` and `deployment_label()` back FROM A NEW
//      SESSION and refuse unless they say production.
//
// Step 3 is `tools-pennsync-provision.mjs`'s step 4 and earns its keep for the
// same reason: a setting write that did not stick leaves the store pinned to
// staging — the DEFAULT — and nothing downstream would say so. A production
// acceptance run against a staging-pinned store would pass its sign-in and
// prove nothing about containment, which is the failure direction that does not
// announce itself.
//
// This module asserts the FOUNDATION only. It signs nobody in and reads no
// business row; the acceptance run that stands on it is separate.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { localStatus, workdir } from './http-local-stack.mjs';

const exec = promisify(execFile);
const CLI = process.env.PENNSYNC_SUPABASE_CLI || 'supabase';
const fail = code => { throw new Error(code); };

export const PRODUCTION_APP = '694ec16e72e01b60d22f7cbf';
export const STAGING_APP = '6a9881683dc68a0bd54f1ef7';
/** The setting the pin migration reads once. Mirrors `tools-pennsync-provision.mjs`. */
export const PIN_SETTING = 'pennsync.deployment_app_id';
/**
 * The local stack's superuser.
 *
 * Needed because storing a placeholder parameter on a role is a superuser-only
 * write, and the role `supabase status` publishes is not one. Local stacks only:
 * nothing hosted is ever reached from here.
 */
export const SUPERUSER = 'supabase_admin';

/**
 * What may be printed when this module throws. Everything else becomes the
 * redacted verdict, because the CLI's output carries credentials. Tested for the
 * reason `emittable` is: this is where a diagnostic goes to die.
 */
export const emittableProductionPin = message =>
  /^(PRODUCTION_PIN_[A-Z_]+( [0-9A-Z]{5})?|LOCAL_[A-Z_]+( [0-9]{1,5})?)$/.test(message);

/**
 * A failing statement's SQLSTATE, and nothing else.
 *
 * The first run of this job spent its whole diagnosis on
 * `PRODUCTION_PIN_SETTING_WRITE_FAILED` with no way to tell a privilege refusal
 * from a bad parameter name, because the message a redaction rule cannot pass is
 * also the message the author needs. A SQLSTATE is five characters from a fixed
 * set defined by the standard — it carries no identifier, no URL and no free
 * text — so it is the one part of a driver error that is safe to print, and
 * `emittableProductionPin` admits exactly that shape and no more.
 *
 * An error with no code (a socket failure, a thrown string) adds nothing, which
 * keeps the bare code the empty case rather than a second meaning for one value.
 */
const withSqlstate = (code, error) =>
  fail(/^[0-9A-Z]{5}$/.test(error?.code ?? '') ? `${code} ${error.code}` : code);

async function cli(args, { timeout = 12 * 60 * 1000, env } = {}) {
  try {
    await exec(CLI, args, { timeout, maxBuffer: 64 * 1024 * 1024, env: env ?? process.env });
  } catch { fail('PRODUCTION_PIN_CLI_FAILED_OUTPUT_REDACTED'); }
}

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
  return new pg.Client({ connectionString: databaseUrl, application_name: 'pennsync-production-pin' });
}

/**
 * Apply the setting and re-migrate, then prove the result.
 *
 * Returns only the two pin values. The status object it reads carries the
 * publishable and secret keys and the database URL, so it never leaves here.
 */
export async function pinLocalStackToProduction() {
  const status = await localStatus();
  const databaseUrl = status.DB_URL;

  // The initial state is GUARDED rather than assumed: if a CLI start ever
  // stopped applying our migrations, every reset below would be doing something
  // other than what this module claims.
  await withClient(databaseUrl, 'PRODUCTION_PIN_INITIAL_READ_FAILED', async client => {
    const { rows } = await client.query('select pennsync_private.deployment_label() as label');
    if (rows[0]?.label !== 'staging') fail('PRODUCTION_PIN_UNEXPECTED_INITIAL_PIN');
  });

  // Interpolated rather than bound, because `ALTER ROLE` is a utility statement
  // and takes no parameter placeholder -- `set ... = $1` is a syntax error,
  // which is what the first run of this job reported. The value is this module's
  // own constant rather than anything a caller supplies, and it is re-checked
  // against the app-id shape so that interpolating it cannot become a way to
  // pass something else.
  if (!/^[a-f0-9]{24}$/.test(PRODUCTION_APP)) fail('PRODUCTION_PIN_APP_MALFORMED');

  // ONE ROUTE, and the two that were MEASURED not to work are recorded here
  // rather than retried, because each costs a full reset per run:
  //
  //   `PGOPTIONS` on the CLI's own process, so the migration would run in a
  //     session that already carried the setting. It reached nothing: the reset
  //     completed and the store came back pinned to staging, so whatever opens
  //     the migration connection does not inherit this process's environment.
  //   `ALTER ROLE ... SET` as the role `supabase status` publishes -- `postgres`
  //     -- which answered SQLSTATE 42501, insufficient_privilege. A custom
  //     parameter with no extension behind it is a placeholder, and PostgreSQL
  //     will not let a non-superuser store one on a role or a database because it
  //     cannot check who may set it. A local stack's `postgres` is not a
  //     superuser.
  //
  // So the write is made by the stack's own SUPERUSER, `supabase_admin`, reached
  // by taking the published URL and changing only its user. The password is the
  // stack's, derived from its own status rather than written down here, and this
  // is a throwaway local cluster either way. Role-scoped rather than
  // database-scoped so it survives the reset dropping the database, and it is
  // left behind deliberately: the job owns this stack and stops it at the end.
  const superuserUrl = new URL(databaseUrl);
  superuserUrl.username = SUPERUSER;
  await withClient(superuserUrl.href, 'PRODUCTION_PIN_SETTING_WRITE_FAILED', client =>
    client.query(`alter role postgres set ${PIN_SETTING} = '${PRODUCTION_APP}'`));

  // Recreates the database and re-applies the migrations, so the pin block runs
  // again -- this time in a session that reads the setting.
  await cli(['db', 'reset', '--workdir', workdir]);

  // A NEW session: a role setting only reaches sessions opened after it, which
  // is the whole point of the sequence.
  const pin = await readPin(databaseUrl);
  if (pin.label !== 'production') fail('PRODUCTION_PIN_NOT_APPLIED');
  return describe(pin, 'superuser-role-setting');
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
 * The pin, from a NEW session.
 *
 * A new connection is the whole point of the sequence in the role-setting case:
 * a role setting only reaches sessions opened after it.
 */
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

/** The checks that make a production label mean containment, not just a string. */
function describe(pin, via) {
  if (pin.app_id !== PRODUCTION_APP) fail('PRODUCTION_PIN_NOT_APPLIED');
  // `setting` rather than `default` is what distinguishes a pin that was CHOSEN
  // from one that merely happens to match.
  if (pin.source !== 'setting') fail('PRODUCTION_PIN_RECORDED_AS_DEFAULT');
  // The containment the pin exists for, read from the store rather than
  // inferred from the label.
  if (pin.admits_production !== true || pin.admits_staging !== false) fail('PRODUCTION_PIN_CONTAINMENT_WRONG');
  return Object.freeze({ app_id: pin.app_id, label: pin.label, source: pin.source, via });
}
