// Two tests, deliberately separable by name, mirroring
// `actual-app-acceptance.test.mjs`: the first needs no stack and runs before one
// exists, the second needs the running stack and is a workflow step of its own.
//
// What this proves is the FOUNDATION for a production-mode acceptance run, not
// the run: that a local store can be pinned to the production app id at all.
// Nothing here signs anybody in, and nothing reads a business row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AUTHORITY_MIGRATIONS, PIN_SETTING, PRODUCTION_APP, STAGING_APP, emittableProductionPin,
  pinLocalStackToProduction,
} from './production-pin.mjs';
import { KNOWN_APPS, PIN_SETTING as PROVISION_PIN_SETTING } from '../../../tools-pennsync-provision.mjs';

test('production pin constants agree with the provisioning tool and the migration', async () => {
  // Three copies of these values exist and none of them may drift: the
  // provisioning tool's allowlist, this module's, and the migration's own seed
  // rows. The migration is the one that decides, so it is read rather than
  // trusted.
  assert.equal(PIN_SETTING, PROVISION_PIN_SETTING);
  assert.equal(KNOWN_APPS[PRODUCTION_APP], 'production');
  assert.equal(KNOWN_APPS[STAGING_APP], 'staging');
  const sql = await readFile(new URL('20260919090000_deployment_app_pin.sql', AUTHORITY_MIGRATIONS), 'utf8');
  const seeded = Object.fromEntries([...sql.matchAll(/\('([a-f0-9]{24})',\s*'(staging|production)'\)/g)]
    .map(([, app, label]) => [app, label]));
  assert.deepEqual(seeded, { [STAGING_APP]: 'staging', [PRODUCTION_APP]: 'production' });
  // The default is staging, and that it is the RESTRICTIVE outcome is the
  // reason the sequence in `production-pin.mjs` is needed at all. If this ever
  // became production, a forgotten setting would silently produce a production
  // store and the whole sequence would be pointless.
  assert.match(sql, new RegExp(`coalesce\\(v_requested, '${STAGING_APP}'\\)`));
});

test('production pin diagnostics can be printed without carrying CLI output', () => {
  for (const message of ['PRODUCTION_PIN_NOT_APPLIED', 'PRODUCTION_PIN_CLI_FAILED_OUTPUT_REDACTED',
    'PRODUCTION_PIN_RECORDED_AS_DEFAULT', 'PRODUCTION_PIN_CONTAINMENT_WRONG',
    'PRODUCTION_PIN_NOT_APPLIED_SETTING_PRESENT', 'PRODUCTION_PIN_NOT_APPLIED_NO_SETTING',
    'PRODUCTION_PIN_STORE_ALREADY_APPLIED', 'PRODUCTION_PIN_STORE_BUILD_FAILED',
    'PRODUCTION_PIN_EMPTY_READ_FAILED', 'PRODUCTION_PIN_SETTING_NOT_VISIBLE',
    'PRODUCTION_PIN_UNEXPECTED_INITIAL_PIN', 'PRODUCTION_PIN_INITIAL_READ_FAILED',
    'LOCAL_TARGET_MISMATCH', 'LOCAL_PORT_ALREADY_IN_USE 54321',
    // A SQLSTATE and nothing else. Five characters from a fixed set, so it
    // names which refusal a statement hit without carrying any of the text
    // around it.
    'PRODUCTION_PIN_SETTING_WRITE_FAILED 42501', 'PRODUCTION_PIN_READBACK_FAILED 42P01',
    // A position, in the same alphabet as a SQLSTATE: a stage letter and an index
    // into that directory's own sorted listing, so it says WHICH file without
    // naming one. A diagnosed failure carries both its SQLSTATE and the position.
    'PRODUCTION_PIN_STORE_BUILD_FAILED_SESSION_LOST R0000',
    'PRODUCTION_PIN_STORE_BUILD_FAILED_SERVER_RESTARTED A0012',
    'PRODUCTION_PIN_SERVER_UNREACHABLE R0003',
    'PRODUCTION_PIN_STORE_BUILD_FAILED 42501 R0001']) {
    assert.equal(emittableProductionPin(message), true);
  }
  // Anything that could carry a credential, a URL, a command or free text must
  // NOT be emittable. `sb_secret_` and a JWT are the two shapes the stack's own
  // output actually contains.
  for (const message of ['failed to connect to postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'sb_secret_abcdefghijklmnop', 'eyJhbGciOi.eyJzdWIi.signature', 'production_pin_not_applied',
    'PRODUCTION_PIN_FAILED: supabase db reset said no', 'LOCAL_PORT_ALREADY_IN_USE 543210',
    'Error: PRODUCTION_PIN_NOT_APPLIED',
    // Not a SQLSTATE: too long, too short, lower case, or a message where one
    // would go. The suffix admits five characters of a fixed alphabet and
    // nothing that could carry an identifier or a sentence.
    'PRODUCTION_PIN_SETTING_WRITE_FAILED 42501X', 'PRODUCTION_PIN_SETTING_WRITE_FAILED 4250',
    'PRODUCTION_PIN_SETTING_WRITE_FAILED 42p01', 'PRODUCTION_PIN_SETTING_WRITE_FAILED postgres',
    'PRODUCTION_PIN_SETTING_WRITE_FAILED 42501 postgres',
    // Three tokens is a message growing a place for free text; two is the most
    // this ever needs, a SQLSTATE and a position.
    'PRODUCTION_PIN_STORE_BUILD_FAILED 42501 R0001 postgres',
    'PRODUCTION_PIN_STORE_BUILD_FAILED 42501 R0001 42P01']) {
    assert.equal(emittableProductionPin(message), false);
  }
});

test('a local stack can be pinned to the production app and refuses the staging app',
  { timeout: 20 * 60 * 1000 }, async () => {
    const pin = await pinLocalStackToProduction();
    // `source` being `setting` rather than `default` is what makes a production
    // label mean a pin that was CHOSEN rather than one that happens to match --
    // five earlier runs of this job all produced the default, each for a
    // different reason the module records.
    assert.deepEqual(pin, { app_id: PRODUCTION_APP, label: 'production', source: 'setting' });
  });
