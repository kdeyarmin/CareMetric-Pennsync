import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_STATEMENTS_MARKER, LEDGER_STATEMENT_BUDGET, LedgerStatementsError,
  compareLedgerStatements, recordedStatements, recordedText, splitStatements,
  statementLiteral, statementsLiteral, withinStatementBudget,
} from './tools-pennsync-ledger-statements.mjs';
import { ledgerName } from './tools-pennsync-migrate.mjs';
import { readMigrations } from './tools-pennsync-provision.mjs';

/**
 * The offline half of recording what a migration actually ran.
 *
 * The database half is `services/authority-store/tests/migrate.test.mjs`,
 * which drives a migration through a real ledger and back out through the
 * comparison — because a writer and a reader that only ever meet in one
 * process are two halves nothing has proved agree (D45).
 */
const REPOSITORY = new URL('.', import.meta.url).pathname;

const refusal = (run, code) => {
  let failure = null;
  try { run(); } catch (error) { failure = error; }
  assert.ok(failure instanceof LedgerStatementsError, `expected a LedgerStatementsError, got ${failure}`);
  assert.equal(failure.code, code);
  return failure;
};

test('a split reconstructs its migration exactly, for every committed one', () => {
  // The property the whole record rests on. Asserted over the real tree rather
  // than a fixture, because a fixture is where a splitter looks right.
  const migrations = readMigrations(REPOSITORY);
  assert.ok(migrations.length > 70, `expected the committed corpus, got ${migrations.length}`);
  for (const migration of migrations) {
    const statements = splitStatements(migration.sql);
    assert.equal(statements.join(''), migration.sql, migration.name);
    assert.ok(statements.length > 1, `${migration.name} should have more than one statement`);
    assert.equal(recordedText(recordedStatements(migration.sql)), migration.sql, migration.name);
  }
});

test('a dollar-quoted body is one statement, not one per plpgsql semicolon', () => {
  // The hazard D88 named. A reader that did not skip `$$ … $$` would cut a
  // function body into pieces at every statement inside it — still faithful on
  // reconstruction, and nonsense as a record of what ran.
  const sql = ['begin;',
    'create function f() returns int language plpgsql as $$',
    'begin;',
    '  perform 1; perform 2;',
    '  return 3;',
    'end $$;',
    'commit;', ''].join('\n');
  const statements = splitStatements(sql);
  assert.equal(statements.join(''), sql);
  assert.equal(statements.length, 3, 'begin, the function, commit');
  assert.match(statements[1], /perform 1; perform 2;/);
});

test('a semicolon inside a string, a comment or an identifier is not a boundary', () => {
  const sql = ["begin;",
    "insert into t (a) values ('one; two');",
    "-- a comment; with a semicolon",
    '/* and a block; one */',
    'create table "odd;name" ();',
    "commit;", ''].join('\n');
  const statements = splitStatements(sql);
  assert.equal(statements.join(''), sql);
  assert.equal(statements.length, 4, 'begin, the insert, the create, commit');
  // The comments belong to the statement that follows them, so no element is
  // comments alone and nothing is dropped.
  assert.match(statements[2], /-- a comment; with a semicolon/);
});

test('a file header belongs to the first statement and a trailing note to the last', () => {
  const sql = '-- header\n\nbegin;\nselect 1;\ncommit;\n-- trailing\n';
  const statements = splitStatements(sql);
  assert.equal(statements.join(''), sql);
  assert.match(statements[0], /^-- header\n\nbegin;$/);
  assert.match(statements.at(-1), /commit;\n-- trailing\n$/);
});

test('an empty migration is one empty statement rather than none', () => {
  assert.deepEqual([...splitStatements('')], ['']);
  assert.equal(splitStatements('').join(''), '');
});

test('a statement is quoted with a tag it does not contain', () => {
  // The literal travels inside the migration's own body, so getting this wrong
  // writes something nobody typed into a store.
  assert.equal(statementLiteral("select 'a''b';"), "$pennsync$select 'a''b';$pennsync$");
  const awkward = 'select $pennsync$x$pennsync$;';
  assert.equal(statementLiteral(awkward), `$pennsync_1$${awkward}$pennsync_1$`);
  const worse = ['$pennsync$', '$pennsync_1$', '$pennsync_2$'].join(' ');
  assert.match(statementLiteral(worse), /^\$pennsync_3\$/);
});

test('a text that defeats every candidate tag is refused rather than mangled', () => {
  const hostile = Array.from({ length: 64 }, (_, index) =>
    (index === 0 ? '$pennsync$' : `$pennsync_${index}$`)).join('');
  refusal(() => statementLiteral(hostile), 'LEDGER_STATEMENT_UNQUOTABLE');
});

test('an empty array is written as null rather than as an empty column value', () => {
  // `array[]` has no element type and an empty array is not the same claim as
  // "nothing was recorded"; the comparison reads null and empty alike as
  // unrecorded, so the literal says the simpler thing.
  assert.equal(statementsLiteral([]), 'null::text[]');
  assert.equal(statementsLiteral(null), 'null::text[]');
});

test('the marker is what tells this tooling rows from the CLI own', () => {
  const statements = recordedStatements('begin;\nselect 1;\ncommit;\n');
  assert.equal(statements[0], LEDGER_STATEMENTS_MARKER);
  // Nine of hosted staging's rows were written by the Supabase CLI in its own
  // shape. Reading one of those as ours would report drift where there is none.
  assert.equal(recordedText(['select 1;', 'select 2;']), null);
  assert.equal(recordedText([]), null);
  assert.equal(recordedText(null), null);
});

const migration = (name, sql) => ({ name: `20260101000000_${name}.sql`, sql });
const row = (name, statements) => ({ version: name, name, statements });

test('a row this tooling wrote and the tree agree, and a changed file does not', () => {
  const migrations = [migration('a', 'begin;\nselect 1;\ncommit;\n')];
  const recorded = recordedStatements(migrations[0].sql);
  assert.equal(
    compareLedgerStatements({ migrations, rows: [row('a', recorded)], ledgerName }).verdict,
    'verified');

  // D88's defect, seen for the first time: the file moved after it was applied.
  const edited = [{ ...migrations[0], sql: 'begin;\nselect 2;\ncommit;\n' }];
  const drift = compareLedgerStatements({ migrations: edited, rows: [row('a', recorded)], ledgerName });
  assert.equal(drift.verdict, 'drifted');
  assert.deepEqual(drift.drifted, ['a']);
});

test('a ledger holding one unrecorded row is never called verified', () => {
  // The rule D88 deferred the backfill for. Those rows cannot be made to say
  // anything true, so the verdict has to distinguish "nothing said" from "yes".
  const migrations = [migration('a', 'begin;\nselect 1;\ncommit;\n'), migration('b', 'begin;\nselect 2;\ncommit;\n')];
  const answer = compareLedgerStatements({
    migrations,
    rows: [row('a', recordedStatements(migrations[0].sql)), row('b', null)],
    ledgerName,
  });
  assert.equal(answer.verdict, 'unverifiable');
  assert.deepEqual(answer.verified, ['a']);
  assert.deepEqual(answer.unrecorded, ['b']);
});

test('a row another writer recorded is reported as foreign, never as drift', () => {
  const migrations = [migration('a', 'begin;\nselect 1;\ncommit;\n')];
  const answer = compareLedgerStatements({
    migrations, rows: [row('a', ['select 1;'])], ledgerName,
  });
  assert.equal(answer.verdict, 'unverifiable');
  assert.deepEqual(answer.foreign, ['a']);
  assert.deepEqual(answer.drifted, []);
});

test('a ledger name the repository does not have is reported rather than compared', () => {
  const answer = compareLedgerStatements({
    migrations: [], rows: [row('gone', null)], ledgerName,
  });
  assert.deepEqual(answer.unknown, ['gone']);
  assert.equal(answer.verdict, 'unverifiable');
});

test('drift outranks anything unsaid, so a real difference is never hidden by one', () => {
  const migrations = [migration('a', 'begin;\nselect 1;\ncommit;\n'), migration('b', 'begin;\nselect 2;\ncommit;\n')];
  const recorded = recordedStatements('begin;\nselect 99;\ncommit;\n');
  const answer = compareLedgerStatements({
    migrations, rows: [row('a', recorded), row('b', null)], ledgerName,
  });
  assert.equal(answer.verdict, 'drifted');
});

test('the comparison needs the namer rather than assuming one', () => {
  refusal(() => compareLedgerStatements({ migrations: [], rows: [] }), 'LEDGER_COMPARE_NAMER_REQUIRED');
});

test('exactly one committed migration is over the statement budget, and it is named', () => {
  // A bound chosen rather than a limit measured, so what matters is knowing
  // when a second migration crosses it — this fails that day instead of
  // quietly recording nothing for it.
  const over = readMigrations(REPOSITORY)
    .filter(candidate => !withinStatementBudget(candidate.sql))
    .map(candidate => candidate.name);
  assert.deepEqual(over, ['20260919170000_record_store.sql']);
  assert.ok(LEDGER_STATEMENT_BUDGET > 45_000,
    'every contract migration has to fit, or the record is the exception rather than the rule');
});
