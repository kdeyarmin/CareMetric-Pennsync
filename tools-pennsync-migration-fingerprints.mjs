#!/usr/bin/env node
/**
 * A pin over every committed migration's CONTENT, because the ledger has none
 * (D88).
 *
 * `tools-pennsync-migrate.mjs` decides what to apply by NAME:
 * `planMigration` reads `ledgerName(file)` and asks whether the deployment has
 * run it. That is deliberate and correct — the Supabase CLI stamps its own
 * versions, so the name is the only stable key the two sides share — but it
 * has a consequence nothing states: a file whose CONTENTS change after it has
 * been applied is skipped forever. The change reaches every fresh provision
 * and no existing store.
 *
 * `20260919170000_record_store.sql` is the file this bites, because AGENTS.md
 * tells you to regenerate it: change the entity definitions and re-run
 * `--write-migration`. D82 did exactly that, `check:entity-schema-plan`
 * compared the file with the generator and found them in step, every suite
 * passed, and the hosted staging store was left without the policy. The only
 * check that could see it runs on `main`, so the finding arrived after the
 * merge.
 *
 * So this makes the edit VISIBLE where it is made. It claims nothing about
 * what any particular deployment holds — that is a fact about the deployment,
 * and `hosted-store.test.mjs` is what reads it. It says only: this file's text
 * has changed since it was pinned, and a migration that has been merged has
 * very likely been applied somewhere, so say what an existing store is
 * supposed to do about it.
 *
 * The two cases are reported apart on purpose. A NEW migration is the ordinary
 * thing and wants one line of housekeeping. A CHANGED one is the alarm, and
 * the message names the rule rather than the fix, because the fix depends on
 * what changed: a forward migration carrying it (the catch-up D88 writes is
 * the worked example), or the honest answer that no deployment has run this
 * file yet.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIGRATION_DIRECTORY,
  RECORD_MIGRATION_DIRECTORY,
  readMigrations,
} from './tools-pennsync-provision.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PIN_FILE = 'services/authority-store/supabase/migration-fingerprints.json';

/** Every migration the provisioner would apply, keyed `<directory>/<file>`. */
export function fingerprints(repository = here) {
  const pinned = {};
  for (const migration of readMigrations(repository)) {
    const directory = migration.from === RECORD_MIGRATION_DIRECTORY ? 'record-migrations'
      : migration.from === MIGRATION_DIRECTORY ? 'migrations' : null;
    // Refused rather than defaulted: a third directory would otherwise collide
    // with one of these two under a name that looks deliberate.
    if (!directory) throw new Error(`FINGERPRINT_UNKNOWN_DIRECTORY: ${migration.from}`);
    pinned[`${directory}/${migration.name}`] =
      createHash('sha256').update(migration.sql).digest('hex');
  }
  return pinned;
}

/** What the pin says, as committed. */
export function readPin(repository = here) {
  return JSON.parse(readFileSync(resolve(repository, PIN_FILE), 'utf8'));
}

/**
 * The three findings, separately, because they mean different things.
 *
 * `changed` is the one this file exists for. `added` and `removed` are
 * housekeeping — though a removal is worth reading twice, since deleting an
 * applied migration leaves `MIGRATE_LEDGER_UNKNOWN` on every deployment that
 * ran it.
 */
export function diff(now, pin) {
  const added = Object.keys(now).filter(key => !(key in pin)).sort();
  const removed = Object.keys(pin).filter(key => !(key in now)).sort();
  const changed = Object.keys(now)
    .filter(key => key in pin && pin[key] !== now[key]).sort();
  return Object.freeze({ added, removed, changed, count: Object.keys(now).length });
}

/** The same three, over what is committed. */
export function compare(repository = here) {
  return diff(fingerprints(repository), readPin(repository));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--write')) {
    writeFileSync(resolve(here, PIN_FILE),
      `${JSON.stringify(fingerprints(), null, 2)}\n`);
    process.stdout.write(`pinned ${Object.keys(fingerprints()).length} migrations\n`);
  } else {
    const { added, removed, changed, count } = compare();
    for (const name of changed) process.stderr.write(`MIGRATION_CHANGED_AFTER_PIN: ${name}\n`);
    for (const name of added) process.stderr.write(`MIGRATION_NOT_PINNED: ${name}\n`);
    for (const name of removed) process.stderr.write(`MIGRATION_PIN_ORPHANED: ${name}\n`);
    if (added.length || removed.length || changed.length) process.exit(1);
    process.stdout.write(`migration fingerprints match: ${count} pinned\n`);
  }
}
