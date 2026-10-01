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
//      it is NOT stored inside the database that is about to be dropped;
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
 * What may be printed when this module throws. Everything else becomes the
 * redacted verdict, because the CLI's output carries credentials. Tested for the
 * reason `emittable` is: this is where a diagnostic goes to die.
 */
export const emittableProductionPin = message =>
  /^(PRODUCTION_PIN_[A-Z_]+|LOCAL_[A-Z_]+( [0-9]{1,5})?)$/.test(message);

async function cli(args, timeout = 12 * 60 * 1000) {
  try { await exec(CLI, args, { timeout, maxBuffer: 64 * 1024 * 1024 }); }
  catch { fail('PRODUCTION_PIN_CLI_FAILED_OUTPUT_REDACTED'); }
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

  // (1) Role-scoped so it survives the database being dropped. `set_config` on
  // the session would not: the migration runs in a session the CLI opens.
  const setter = clientFor(databaseUrl);
  try {
    try {
      await setter.connect();
      const { rows: before } = await setter.query(
        'select pennsync_private.deployment_label() as label');
      // Guards the premise rather than assuming it: if a CLI start ever stopped
      // applying our migrations, the reset below would be doing something else.
      if (before[0]?.label !== 'staging') fail('PRODUCTION_PIN_UNEXPECTED_INITIAL_PIN');
    } catch (error) {
      if (emittableProductionPin(error.message)) throw error;
      fail('PRODUCTION_PIN_INITIAL_READ_FAILED');
    }
    // `ALTER ROLE` is a utility statement, so it takes NO parameter placeholder:
    // `set ... = $1` is a syntax error, which is what the first run of this job
    // reported. The value is this module's own constant rather than anything a
    // caller supplies, and it is re-checked against the app-id shape here so
    // that interpolating it cannot become a way to inject one.
    if (!/^[a-f0-9]{24}$/.test(PRODUCTION_APP)) fail('PRODUCTION_PIN_APP_MALFORMED');
    try {
      await setter.query(`alter role postgres set ${PIN_SETTING} = '${PRODUCTION_APP}'`);
    } catch (error) {
      if (emittableProductionPin(error.message)) throw error;
      fail('PRODUCTION_PIN_SETTING_WRITE_FAILED');
    }
  } finally { await setter.end().catch(() => {}); }

  // (2) Recreates the database and re-applies the migrations.
  await cli([ 'db', 'reset', '--workdir', workdir ]);

  // (3) A NEW session, because a role setting only reaches sessions opened
  // after it and this is the whole point of the sequence.
  const reader = clientFor(databaseUrl);
  try {
    await reader.connect();
    const { rows } = await reader.query(`select pennsync_private.deployment_app_id() as app_id,
      pennsync_private.deployment_label() as label,
      (select d.source from pennsync_private.deployment d) as source,
      pennsync_private.app_admitted($1) as admits_production,
      pennsync_private.app_admitted($2) as admits_staging`, [PRODUCTION_APP, STAGING_APP]);
    const pin = rows[0];
    if (pin?.app_id !== PRODUCTION_APP || pin.label !== 'production') fail('PRODUCTION_PIN_NOT_APPLIED');
    // `setting` rather than `default` is what distinguishes a pin that was
    // CHOSEN from one that merely happens to match.
    if (pin.source !== 'setting') fail('PRODUCTION_PIN_RECORDED_AS_DEFAULT');
    // The containment the pin exists for, read from the store rather than
    // inferred from the label.
    if (pin.admits_production !== true || pin.admits_staging !== false) fail('PRODUCTION_PIN_CONTAINMENT_WRONG');
    return Object.freeze({ app_id: pin.app_id, label: pin.label, source: pin.source });
  } catch (error) {
    if (emittableProductionPin(error.message)) throw error;
    fail('PRODUCTION_PIN_READBACK_FAILED');
  } finally { await reader.end().catch(() => {}); }
}
