import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_ONLY_MIGRATIONS, MIGRATE_CONTRACT, MigrateError, PIN_MIGRATION,
  applyMigrations, ledgerName, ledgerVersion, migrationWithLedgerRow, planMigration,
  readAppliedNames, runMigrateCli,
} from './tools-pennsync-migrate.mjs';
import {
  MIGRATION_DIRECTORY, ProvisionError, RECORD_MIGRATION_DIRECTORY, readMigrations,
} from './tools-pennsync-provision.mjs';

/**
 * The offline half of migrating a store that already exists: everything
 * decidable without a database.
 *
 * The database half lives in `services/authority-store/tests/migrate.test.mjs`
 * and drives the real committed migrations through PGlite. These are the
 * refusals that have to hold before a connection is ever opened — a ledger
 * that cannot be matched, a sequence with a hole in it, a deliberate omission
 * quietly becoming an accident.
 */
const REPOSITORY = new URL('.', import.meta.url).pathname;

const migration = (name, from) => ({ name, from, sql: `-- ${name}\n` });
const authority = name => migration(name, MIGRATION_DIRECTORY);
const record = name => migration(name, RECORD_MIGRATION_DIRECTORY);

/** Runs a synchronous call expected to refuse, and hands back the refusal. */
const refusal = (run, code) => {
  let failure = null;
  try { run(); } catch (error) { failure = error; }
  assert.ok(failure instanceof MigrateError, `expected a MigrateError, got ${failure}`);
  assert.equal(failure.code, code);
  return failure;
};

/**
 * A validator for `assert.rejects`, which requires exactly `true` — a truthy
 * object is not enough and silently passes anything.
 */
const rejectsWith = code => error => {
  assert.ok(error instanceof MigrateError, `expected a MigrateError, got ${error}`);
  assert.equal(error.code, code);
  return true;
};

test('a ledger name is the file name without its version, because the two sides do not share one', () => {
  assert.equal(ledgerName('20260918015112_independent_staging_authority.sql'), 'independent_staging_authority');
  // The WHOLE stem, because the timestamp prefix is not unique and `version`
  // is the ledger's primary key: two pairs of committed migrations share a
  // prefix, one from each directory.
  assert.equal(ledgerVersion('20260918015112_independent_staging_authority.sql'),
    '20260918015112_independent_staging_authority');
  assert.notEqual(ledgerVersion('20260920180000_chart_assignment_lifecycle.sql'),
    ledgerVersion('20260920180000_contract_assignment.sql'));
});

test('nothing pending when the ledger already names every migration', () => {
  const migrations = [authority('001_a.sql'), record('002_b.sql')];
  const plan = planMigration({ migrations, applied: ['a', 'b'] });
  assert.equal(plan.contract, MIGRATE_CONTRACT);
  assert.deepEqual(plan.pending, []);
  assert.deepEqual(plan.applied, ['001_a.sql', '002_b.sql']);
});

test('pending keeps the provisioner order: every authority migration before any record one', () => {
  const migrations = [authority('001_a.sql'), authority('002_b.sql'), record('000_c.sql')];
  const plan = planMigration({ migrations, applied: [] });
  // `000_c` sorts first by name and must still come last: these are two
  // sequences, and every record policy is written against `pennsync_private`.
  assert.deepEqual(plan.pending, ['001_a.sql', '002_b.sql', '000_c.sql']);
});

test('a hole in a directory is refused rather than repaired', () => {
  const migrations = [authority('001_a.sql'), authority('002_b.sql'), authority('003_c.sql')];
  // `b` never ran and `c` did, so applying `b` now would run it against a
  // schema `c` has already changed.
  const failure = refusal(() => planMigration({ migrations, applied: ['a', 'c'] }), 'MIGRATE_OUT_OF_ORDER');
  assert.equal(failure.detail.applied, '003_c.sql');
  assert.equal(failure.detail.after, '002_b.sql');
});

test('a hole in one directory is not created by the other being behind', () => {
  // Every authority migration applied, no record migration applied: ordinary,
  // and exactly the hosted staging project's shape.
  const migrations = [authority('001_a.sql'), record('002_b.sql'), record('003_c.sql')];
  const plan = planMigration({ migrations, applied: ['a'] });
  assert.deepEqual(plan.pending, ['002_b.sql', '003_c.sql']);
});

test('a ledger naming something the repository does not have is refused', () => {
  const failure = refusal(
    () => planMigration({ migrations: [authority('001_a.sql')], applied: ['a', 'from_another_tree'] }),
    'MIGRATE_LEDGER_UNKNOWN');
  assert.deepEqual(failure.detail.names, ['from_another_tree']);
});

test('two files sharing a ledger name are refused, because "has this run" would have no answer', () => {
  const migrations = [authority('001_shared.sql'), record('002_shared.sql')];
  const failure = refusal(() => planMigration({ migrations, applied: [] }), 'MIGRATE_NAME_COLLISION');
  assert.equal(failure.detail.name, 'shared');
});

test('the committed migrations carry no ledger-name collision', () => {
  // The guard above is worth nothing if the real tree already violates it.
  const plan = planMigration({ migrations: readMigrations(REPOSITORY), applied: [] });
  assert.ok(plan.pending.length > 60, `expected the whole tree pending, got ${plan.pending.length}`);
});

test('a local-only migration is skipped with its reason and never pends', () => {
  const [file] = Object.keys(LOCAL_ONLY_MIGRATIONS);
  const plan = planMigration({ migrations: readMigrations(REPOSITORY), applied: [] });
  assert.ok(!plan.pending.includes(file), `${file} must never be planned for a deployment`);
  const skipped = plan.skipped.find(entry => entry.name === file);
  assert.ok(skipped, `${file} must be reported as skipped rather than silently dropped`);
  // An entry here is a decision, so it owes a reason somebody can read rather
  // than a placeholder.
  assert.ok(skipped.reason.length > 40, `${file} is held back without a stated reason`);
});

test('every local-only migration names a file that exists, so a stale entry cannot hide one', () => {
  const onDisk = new Set(readdirSync(join(REPOSITORY, MIGRATION_DIRECTORY))
    .concat(readdirSync(join(REPOSITORY, RECORD_MIGRATION_DIRECTORY))));
  for (const file of Object.keys(LOCAL_ONLY_MIGRATIONS)) {
    assert.ok(onDisk.has(file), `${file} is held back but no longer exists`);
  }
});

test('the local-only set is exactly what the hosted staging project is missing below its high-water mark', () => {
  // The nine names the hosted project actually holds, read from it on
  // 2026-09-21. Everything in the authority directory dated at or before the
  // last of them either IS one of them or is deliberately held back — which
  // is what makes the omission a decision rather than drift.
  const hosted = new Set(['independent_staging_authority', 'synthetic_s4_create_subset',
    'synthetic_s3_manual_referral', 's4_ecmascript_blank_note', 'current_visit_documentation',
    'current_patient_context', 'current_visit_schedule', 'referral_patient_selection',
    'current_referral_list']);
  const authorityFiles = readdirSync(join(REPOSITORY, MIGRATION_DIRECTORY)).sort();
  const highWater = authorityFiles.filter(file => hosted.has(ledgerName(file))).pop();
  const belowMark = authorityFiles.filter(file => file <= highWater);
  const unexplained = belowMark
    .filter(file => !hosted.has(ledgerName(file)) && !LOCAL_ONLY_MIGRATIONS[file]);
  assert.deepEqual(unexplained, [],
    'a migration older than the hosted high-water mark that is neither applied nor explained');
});

test('the ledger row commits inside the migration own transaction', () => {
  // Applying the migration and then inserting the row as a second statement
  // left a window: a crash between them leaves the migration applied and
  // unrecorded, and the next run sees a SUFFIX rather than a hole — so
  // MIGRATE_OUT_OF_ORDER never fires and a non-idempotent migration re-runs.
  // An earlier comment here claimed the order check caught that. It did not.
  const sql = migrationWithLedgerRow({
    name: '20260919114500_enrollment_receipt.sql',
    from: MIGRATION_DIRECTORY,
    sql: '-- header\nbegin;\ncreate table t ();\ncommit;\n',
  });
  const lines = sql.trimEnd().split('\n');
  assert.match(lines.at(-1), /^commit;$/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  // The row is before the commit, so both land in one transaction.
  assert.ok(sql.indexOf('insert into supabase_migrations') < sql.lastIndexOf('commit;'));
  assert.match(sql, /values \('20260919114500_enrollment_receipt', 'enrollment_receipt'\)/);
});

test('a leading comment header does not make a migration look untransactional', () => {
  // The first version anchored the check at the file's very start and refused
  // all sixty-nine migrations, because every one opens with a `--` header.
  const sql = migrationWithLedgerRow({
    name: '001_a.sql', from: MIGRATION_DIRECTORY,
    sql: '-- one\n-- two\n\nbegin;\nselect 1;\ncommit;\n-- trailing note\n',
  });
  assert.match(sql, /insert into supabase_migrations/);
});

test('a migration that manages no transaction is refused rather than appended to', () => {
  // Appending to a file that commits differently would put the row outside any
  // transaction and restore the bug silently, so this fails closed.
  for (const body of ['create table t ();\n', 'begin;\ncreate table t ();\n', 'create table t ();\ncommit;\n']) {
    refusal(() => migrationWithLedgerRow({ name: '001_a.sql', from: MIGRATION_DIRECTORY, sql: body }),
      'MIGRATE_MIGRATION_NOT_TRANSACTIONAL');
  }
});

test('a name that cannot be interpolated safely is refused', () => {
  refusal(() => migrationWithLedgerRow({
    name: "001_a'; drop table x; --.sql", from: MIGRATION_DIRECTORY, sql: 'begin;\nselect 1;\ncommit;\n',
  }), 'MIGRATE_MIGRATION_NAME_UNUSABLE');
});

test('every committed migration accepts the ledger row', () => {
  // The guard above is worth nothing if the real tree cannot satisfy it.
  const migrations = readMigrations(REPOSITORY);
  for (const migration of migrations) {
    assert.match(migrationWithLedgerRow(migration), /insert into supabase_migrations/, migration.name);
  }
  assert.ok(migrations.length > 60);
});

test('a database with no store is sent to the provisioner rather than migrated', async () => {
  const db = { query: async () => ({ rows: [{ count: 0 }] }) };
  await assert.rejects(() => applyMigrations({ db, repository: REPOSITORY }),
    rejectsWith('MIGRATE_STORE_ABSENT'));
});

/** The nine migrations the hosted staging project actually holds. */
const HOSTED_STAGING = Object.freeze(['independent_staging_authority', 'synthetic_s4_create_subset',
  'synthetic_s3_manual_referral', 's4_ecmascript_blank_note', 'current_visit_documentation',
  'current_patient_context', 'current_visit_schedule', 'referral_patient_selection',
  'current_referral_list']);

/** A database answering the shape `applyMigrations` asks about. */
const storeDb = ({ hasPin, applied }) => ({
  query: async sql => {
    // `pg_proc` FIRST: the pin-existence query joins `pg_namespace` too, so a
    // mock that tested for that string first answered it with the store check's
    // own count and reported a pin that was not there.
    if (sql.includes('pg_proc')) return { rows: [{ count: hasPin ? 1 : 0 }] };
    if (sql.includes('pg_namespace')) return { rows: [{ count: 1 }] };
    if (sql.includes('information_schema.tables')) return { rows: [{ count: 1 }] };
    if (sql.includes('schema_migrations')) {
      return { rows: applied.map(name => ({ version: name, name })) };
    }
    if (sql.includes('deployment_app_id')) {
      return { rows: [{ app_id: '6a9881683dc68a0bd54f1ef7', label: 'staging', source: 'setting' }] };
    }
    throw new Error(`unexpected statement: ${sql}`);
  },
  session: async () => { throw new Error('a plan must open no session'); },
});

test('a store whose pin migration has already run but has no pin is refused', async () => {
  // Genuinely half-provisioned: the migration that creates the pin is recorded
  // as applied and the function is not there. The ledger has to be a valid
  // PREFIX to reach that check — applying the pin alone is a hole, and the
  // order check fires first and rightly.
  await assert.rejects(() => applyMigrations({
    db: storeDb({ hasPin: false, applied: [...HOSTED_STAGING, PIN_MIGRATION] }),
    repository: REPOSITORY,
  }), rejectsWith('MIGRATE_STORE_PARTIALLY_PROVISIONED'));
});

test('the legacy store this tool exists for is accepted, pin still pending', async () => {
  // The hosted staging shape: the first nine authority migrations and no pin,
  // because `deployment_app_pin` is the FIRST thing pending. Refusing this was
  // refusing the tool's own target, and the fixture hid it by provisioning
  // with every authority migration.
  const result = await applyMigrations({
    db: storeDb({ hasPin: false, applied: HOSTED_STAGING }),
    repository: REPOSITORY,
  });
  assert.equal(result.mutated, false);
  assert.equal(result.deployment, null, 'there is no pin to report yet');
  assert.equal(result.deployment_pin_pending, true);
  assert.equal(ledgerName(result.pending[0]), PIN_MIGRATION, 'the pin is what runs first');
});

test('a ledger that is absent stops the run rather than being guessed at', async () => {
  const db = { query: async sql => {
    if (sql.includes('pg_namespace')) return { rows: [{ count: 1 }] };
    if (sql.includes('pg_proc')) return { rows: [{ count: 1 }] };
    if (sql.includes('deployment_app_id')) {
      return { rows: [{ app_id: '6a9881683dc68a0bd54f1ef7', label: 'staging', source: 'setting' }] };
    }
    return { rows: [{ count: 0 }] };
  } };
  await assert.rejects(() => applyMigrations({ db, repository: REPOSITORY }),
    rejectsWith('MIGRATE_LEDGER_MISSING'));
});

test('a ledger row with no name stops the run, because a version is not an identity', async () => {
  const db = { query: async sql => {
    if (sql.includes('information_schema.tables')) return { rows: [{ count: 1 }] };
    if (sql.includes('schema_migrations')) return { rows: [{ version: '20260918070751', name: null }] };
    return { rows: [{ count: 1 }] };
  } };
  await assert.rejects(() => readAppliedNames(db), rejectsWith('MIGRATE_LEDGER_UNNAMED'));
});

test('planning mutates nothing and says so', async () => {
  const applied = ['independent_staging_authority', 'synthetic_s4_create_subset',
    'synthetic_s3_manual_referral', 's4_ecmascript_blank_note', 'current_visit_documentation',
    'current_patient_context', 'current_visit_schedule', 'referral_patient_selection',
    'current_referral_list'];
  let sessions = 0;
  const db = {
    query: async sql => {
      if (sql.includes('pg_namespace')) return { rows: [{ count: 1 }] };
      if (sql.includes('pg_proc')) return { rows: [{ count: 1 }] };
      if (sql.includes('deployment_app_id')) {
        return { rows: [{ app_id: '6a9881683dc68a0bd54f1ef7', label: 'staging', source: 'setting' }] };
      }
      if (sql.includes('information_schema.tables')) return { rows: [{ count: 1 }] };
      if (sql.includes('schema_migrations')) {
        return { rows: applied.map(name => ({ version: '1', name })) };
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
    session: async () => { sessions += 1; },
  };
  const result = await applyMigrations({ db, repository: REPOSITORY });
  assert.equal(result.mutated, false);
  assert.equal(sessions, 0, 'a plan must open no session');
  assert.equal(result.deployment.label, 'staging');
  assert.equal(result.already_applied, applied.length);
  // The five authority migrations the hosted project is behind, then every
  // record migration. This is the number the plan document reports.
  assert.ok(result.pending.length >= 59, `expected the hosted gap, got ${result.pending.length}`);
  assert.equal(result.pending[0], '20260919090000_deployment_app_pin.sql');
});

test('the CLI refuses with a code and never echoes the connection string', async () => {
  const errors = [];
  const code = await runMigrateCli({
    env: { PENNSYNC_MIGRATE_DATABASE_URL: 'postgresql://user:secret@host/db' },
    argv: [],
    write: () => {},
    error: line => errors.push(line),
    connect: async () => { throw new MigrateError('MIGRATE_CONNECT_REFUSED'); },
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(errors[0]).error, 'MIGRATE_CONNECT_REFUSED');
  assert.ok(!errors.join('\n').includes('secret'), 'a diagnostic must not carry the credential');
});

test('the CLI needs a target before it opens anything', async () => {
  const errors = [];
  let opened = false;
  const code = await runMigrateCli({
    env: {},
    argv: ['--apply'],
    write: () => {},
    error: line => errors.push(line),
    connect: async () => { opened = true; },
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(errors[0]).error, 'MIGRATE_TARGET_REQUIRED');
  assert.equal(opened, false);
});

/**
 * Line endings, which are content here rather than formatting.
 *
 * Postgres stores a function's body verbatim and the hosted comparison reads
 * `md5(prosrc)`, so a migration applied with CRLF builds a store that differs
 * from every store built here — in every function it created — while the
 * ledger, which keys on the file NAME, records both as the same migration.
 * Four migrations applied from a Windows checkout on 2026-09-23 did exactly
 * that to eight function bodies.
 *
 * This is invisible to a suite that writes and compares on one machine, which
 * is why the cases below MAKE a CRLF checkout rather than waiting for one.
 */
const crlfCheckout = migrations => {
  const root = mkdtempSync(join(tmpdir(), 'pennsync-crlf-'));
  for (const relative of [MIGRATION_DIRECTORY, RECORD_MIGRATION_DIRECTORY]) {
    cpSync(join(REPOSITORY, relative), join(root, relative), { recursive: true });
  }
  for (const { name, from } of migrations) {
    const path = join(root, from, name);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  }
  return root;
};

test('a migration read from a CRLF checkout is byte-for-byte the committed one', () => {
  const committed = readMigrations(REPOSITORY);
  const root = crlfCheckout(committed);

  // Every file, not a sample: the defect is per-function, so one unconverted
  // migration is one store that differs and nothing that says so.
  const raw = readFileSync(join(root, committed[0].from, committed[0].name), 'utf8');
  assert.ok(raw.includes('\r\n'), 'the fixture must really be a CRLF checkout');

  const read = readMigrations(root);
  assert.equal(read.length, committed.length);
  for (const [index, entry] of read.entries()) {
    assert.equal(entry.name, committed[index].name);
    assert.equal(entry.sql, committed[index].sql, `${entry.name} differs from the committed file`);
  }
});

test('no committed migration carries a carriage return of its own', () => {
  // Read the FILE, not `readMigrations`: the reader strips `\r\n`, so a
  // committed file full of them would pass a check made on its answer while
  // the thing this asserts — that the repository holds LF — was false. A first
  // draft did read the answer, and planting CRLF in a committed migration left
  // it green.
  //
  // While this holds, the refusal below can only mean an edited working tree,
  // and the normalization above can only be undoing what a checkout did.
  for (const { name, from } of readMigrations(REPOSITORY)) {
    const raw = readFileSync(join(REPOSITORY, from, name), 'utf8');
    assert.ok(!raw.includes('\r'), `${name} carries a carriage return`);
  }
});

test('a carriage return that is not a line ending is refused, never stripped', () => {
  const committed = readMigrations(REPOSITORY);
  const root = crlfCheckout([]);
  const victim = committed[0];
  const path = join(root, victim.from, victim.name);
  writeFileSync(path, `${readFileSync(path, 'utf8')}\r-- a lone carriage return\n`);

  let failure = null;
  try { readMigrations(root); } catch (error) { failure = error; }
  assert.ok(failure instanceof ProvisionError, `expected a ProvisionError, got ${failure}`);
  assert.equal(failure.code, 'PROVISION_MIGRATION_CARRIAGE_RETURN');
  assert.ok(failure.detail.endsWith(victim.name), 'the refusal names the file');
});

test('.gitattributes pins LF, so a new checkout cannot reintroduce this', () => {
  // The reader above repairs a checkout that already exists; this is what stops
  // the next one from needing repair. Deleting the line fails here.
  const attributes = readFileSync(join(REPOSITORY, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
});
