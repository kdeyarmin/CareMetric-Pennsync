/**
 * What merging owes an operator, and why each refusal is a refusal.
 *
 * The pure half is driven over pins. The half that matters is driven over REAL
 * git repositories built in a scratch directory, because the whole point of the
 * tool is to read a commit rather than a worktree, and a fixture cannot be wrong
 * about `git show` and `git ls-tree` the way a real commit can.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { LOCAL_ONLY_MIGRATIONS } from './tools-pennsync-migrate.mjs';
import {
  MIGRATION_DIRECTORY, RECORD_MIGRATION_DIRECTORY,
} from './tools-pennsync-provision.mjs';
import { PIN_FILE, fingerprints } from './tools-pennsync-migration-fingerprints.mjs';
import {
  APPLY_COMMAND, ApplySignalError, applySignal, measure, migrationNamesAt, readPinAt, report,
  runApplySignalCli,
} from './tools-pennsync-apply-signal.mjs';

const HELD_BACK = Object.keys(LOCAL_ONLY_MIGRATIONS)[0];

/** The refusal itself; `assert.throws` returns nothing to read a code off. */
function refusalFrom(run) {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof ApplySignalError, `not a refusal: ${err.stack}`);
    return err;
  }
  return assert.fail('expected a refusal and the call returned');
}

/** A repository shaped like this one: two migration directories and a pin. */
function scratchRepository() {
  const root = mkdtempSync(join(tmpdir(), 'pennsync-apply-signal-'));
  for (const directory of [MIGRATION_DIRECTORY, RECORD_MIGRATION_DIRECTORY]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  mkdirSync(join(root, dirname(PIN_FILE)), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');

  return {
    root,
    /** Write a migration, in either sequence. */
    migration(name, sql, { record = true } = {}) {
      writeFileSync(join(root, record ? RECORD_MIGRATION_DIRECTORY : MIGRATION_DIRECTORY, name), sql);
    },
    /** Re-pin from the files, the way `--write` does. */
    pin() {
      writeFileSync(join(root, PIN_FILE), `${JSON.stringify(fingerprints(root), null, 2)}\n`);
    },
    /** Pin something other than what is on disk. */
    pinAs(contents) {
      writeFileSync(join(root, PIN_FILE), `${JSON.stringify(contents, null, 2)}\n`);
    },
    commit(message) { git('add', '-A'); git('commit', '-q', '-m', message); },
  };
}

/**
 * One commit holding both sequences, pinned. Two record migrations, because git
 * does not track an empty directory and the withdrawal case below would
 * otherwise delete the sequence rather than a file in it.
 */
function baseline() {
  const repository = scratchRepository();
  repository.migration('20260101000000_authority_first.sql', 'select 1;', { record: false });
  repository.migration('20260102000000_record_first.sql', 'select 2;');
  repository.migration('20260102500000_record_other.sql', 'select 2.5;');
  repository.pin();
  repository.commit('baseline');
  return repository;
}

test('a change that adds a migration says how far behind it leaves a deployment', () => {
  const repository = baseline();
  repository.migration('20260103000000_record_second.sql', 'select 3;');
  repository.pin();
  repository.commit('add one');

  const signal = measure({ base: 'HEAD^', repository: repository.root });
  assert.deepEqual(signal.arriving, ['record-migrations/20260103000000_record_second.sql']);
  assert.equal(signal.behindBy, 1);
  assert.deepEqual(signal.editing, []);
  assert.deepEqual(signal.withdrawing, []);
});

test('a change that adds nothing owes nothing, and says so in one line', () => {
  const repository = baseline();
  writeFileSync(join(repository.root, 'README.md'), 'unrelated\n');
  repository.commit('no migration');

  const signal = measure({ base: 'HEAD^', repository: repository.root });
  assert.equal(signal.behindBy, 0);
  const { annotations, summary } = report(signal);
  assert.equal(annotations.length, 1);
  assert.match(annotations[0], /^::notice title=No apply owed::/);
  // The two cases must not collapse into one another: an owed apply names the
  // command, and a clean change must not, or the signal stops meaning anything.
  assert.ok(!summary.includes(APPLY_COMMAND));
});

test('an edit to an already-committed migration is reported apart from an addition', () => {
  const repository = baseline();
  repository.migration('20260102000000_record_first.sql', 'select 2; -- corrected\n');
  repository.pin();
  repository.commit('edit one');

  const signal = measure({ base: 'HEAD^', repository: repository.root });
  assert.deepEqual(signal.editing, ['record-migrations/20260102000000_record_first.sql']);
  assert.deepEqual(signal.arriving, []);
  // Reported as its own alarm, because the fix is a forward migration rather
  // than an apply of this file, which no existing store will ever run.
  const { annotations } = report(signal);
  assert.equal(annotations.length, 1);
  assert.match(annotations[0], /^::warning title=Applied migration edited::/);
  assert.match(annotations[0], /forward migration/);
});

test('a withdrawn migration names the refusal every deployment that ran it will give', () => {
  const repository = baseline();
  execFileSync('git', ['rm', '-q', join(RECORD_MIGRATION_DIRECTORY, '20260102000000_record_first.sql')],
    { cwd: repository.root });
  repository.pin();
  repository.commit('withdraw one');

  const signal = measure({ base: 'HEAD^', repository: repository.root });
  assert.deepEqual(signal.withdrawing, ['record-migrations/20260102000000_record_first.sql']);
  assert.match(report(signal).annotations[0], /MIGRATE_LEDGER_UNKNOWN/);
});

test('a migration held back from every deployment arrives and owes no apply', () => {
  // By NAME, from the migrate tool's own list rather than a copy: this is the
  // one file that is committed, pinned, and deliberately never applied, so
  // counting it would ask an operator for work no deployment wants.
  const repository = baseline();
  repository.migration(HELD_BACK, 'select 4;');
  repository.pin();
  repository.commit('add the held-back one');

  const signal = measure({ base: 'HEAD^', repository: repository.root });
  assert.deepEqual(signal.arriving, []);
  assert.equal(signal.behindBy, 0);
  assert.deepEqual(signal.heldBack.map(entry => entry.name), [`record-migrations/${HELD_BACK}`]);
  const { annotations, summary } = report(signal);
  assert.ok(annotations.some(line => line.startsWith('::notice title=Held back')));
  assert.ok(!summary.includes(APPLY_COMMAND), 'a held-back migration must not ask for an apply');
});

test('a pin that disagrees with the migration directory refuses rather than counting', () => {
  // The defect this repository keeps finding: a check that decides from one
  // representation and is quietly wrong when the thing arrives in another. The
  // pin is what the signal reads, so a migration added WITHOUT re-pinning must
  // not be reported as nothing arriving.
  const repository = baseline();
  repository.migration('20260103000000_record_unpinned.sql', 'select 5;');
  repository.commit('add one, forget the pin');

  const refusal = refusalFrom(() => measure({ base: 'HEAD^', repository: repository.root }));
  assert.equal(refusal.code, 'APPLY_SIGNAL_PIN_STALE');
  assert.deepEqual(refusal.detail.files, ['record-migrations/20260103000000_record_unpinned.sql']);
});

test('a base whose pin does not cover its own files refuses, because the count would understate', () => {
  // A file present at the base and missing from the base's pin makes the same
  // file at the head look new. Names are what `git ls-tree` can answer for a
  // commit, and this is the drift they are asked about.
  const repository = scratchRepository();
  repository.migration('20260101000000_authority_first.sql', 'select 1;', { record: false });
  repository.migration('20260102000000_record_first.sql', 'select 2;');
  repository.pinAs({ 'migrations/20260101000000_authority_first.sql': 'whatever' });
  repository.commit('base with an incomplete pin');
  repository.pin();
  repository.commit('re-pin');

  const refusal = refusalFrom(() => measure({ base: 'HEAD^', repository: repository.root }));
  assert.equal(refusal.code, 'APPLY_SIGNAL_BASE_PIN_INCOMPLETE');
  assert.deepEqual(refusal.detail.files, ['record-migrations/20260102000000_record_first.sql']);
});

test('a base ref that cannot be read is a refusal and never a quiet zero', () => {
  const repository = baseline();
  for (const base of ['no-such-ref', undefined]) {
    const refusal = refusalFrom(() => measure({ base, repository: repository.root }));
    assert.match(refusal.code, /^APPLY_SIGNAL_BASE_(UNREADABLE|MISSING)$/);
  }
});

test('the CLI exits 0 having reported, and non-zero having measured nothing', () => {
  const repository = baseline();
  repository.migration('20260103000000_record_second.sql', 'select 3;');
  repository.pin();
  repository.commit('add one');

  const written = [];
  const summaryFile = join(repository.root, 'summary.md');
  assert.equal(runApplySignalCli({
    argv: ['--base', 'HEAD^', '--summary', summaryFile],
    repository: repository.root, write: line => written.push(line), error: () => {},
  }), 0);
  assert.match(written.join('\n'), /^::warning title=Apply owed after merge::/);
  assert.match(readFileSync(summaryFile, 'utf8'), /node tools-pennsync-migrate\.mjs --apply/);

  const errors = [];
  assert.equal(runApplySignalCli({
    argv: [], repository: repository.root, write: () => {}, error: line => errors.push(line),
  }), 1);
  assert.match(errors[0], /^::error title=Apply signal not measured::APPLY_SIGNAL_BASE_MISSING/);
});

test('the pure signal is provable without a repository', () => {
  assert.deepEqual(applySignal({ base: { a: '1' }, head: { a: '1' } }),
    { contract: 'cm.pennsync.apply-signal.v1', arriving: [], editing: [], withdrawing: [], heldBack: [], behindBy: 0 });
  assert.deepEqual(applySignal({ base: { a: '1' }, head: { a: '1', b: '2' } }).arriving, ['b']);
  assert.deepEqual(applySignal({ base: { a: '1' }, head: { a: '9' } }).editing, ['a']);
  assert.deepEqual(applySignal({ base: { a: '1', z: '3' }, head: { a: '1' } }).withdrawing, ['z']);
  // An edit to a held-back file reaches no deployment either, so it raises no
  // alarm — proved over an injected list so the property is not read off the
  // one name the repository happens to hold.
  const localOnly = { 'held.sql': 'never applied anywhere' };
  const held = applySignal({
    base: { 'migrations/held.sql': '1' }, head: { 'migrations/held.sql': '9' }, localOnly,
  });
  assert.deepEqual(held.editing, []);
});

test('this repository, against itself, owes nothing and reads its own pin', () => {
  // Drives the real tree through the real readers. `HEAD` against `HEAD` is the
  // one base every checkout has, however shallow, and it proves the pin and the
  // directories agree here — the precondition every count above depends on.
  const signal = measure({ base: 'HEAD' });
  assert.equal(signal.behindBy, 0);
  assert.deepEqual(signal.editing, []);
  assert.deepEqual(signal.withdrawing, []);

  const pinned = Object.keys(readPinAt('HEAD'));
  assert.ok(pinned.length > 1);
  assert.deepEqual(migrationNamesAt('HEAD'), pinned.sort());
});

test('an annotation stays on one line, whatever the reason it quotes looks like', () => {
  // A workflow annotation is one LINE, and the held-back reason is written in
  // another file where nothing stops somebody wrapping it. A newline in the
  // middle truncates the annotation silently and spills the rest into the log.
  const localOnly = { 'held.sql': 'A reason that\nwraps\n  across lines.' };
  const signal = applySignal({ base: {}, head: { 'migrations/held.sql': '1' }, localOnly });
  const { annotations } = report(signal);
  const held = annotations.find(line => line.includes('Held back'));
  assert.ok(held, 'the held-back migration was not announced at all');
  assert.ok(!held.includes('\n'));
  assert.match(held, /A reason that wraps across lines\./);
});

test('a refusal from the migration readers is reported as a refusal to measure', () => {
  // `readMigrations` refuses a migration holding a lone carriage return, which
  // the head cross-check reaches through `fingerprints()`. That is not a count
  // of zero and must not read as one: without this the CLI exits on a raw stack
  // trace, which in a workflow log is the failure mode this tool exists to end.
  // Not re-pinned, because `pin()` reads the files through the same refusal:
  // the cross-check reaches `fingerprints()` before it compares anything, so
  // this is the shape a reader's refusal really arrives in.
  const repository = baseline();
  repository.migration('20260103000000_record_carriage.sql', 'select 1;\rselect 2;\n');
  repository.commit('a lone carriage return');

  const errors = [];
  assert.equal(runApplySignalCli({
    argv: ['--base', 'HEAD^'], repository: repository.root, write: () => {},
    error: line => errors.push(line),
  }), 1);
  assert.match(errors[0], /^::error title=Apply signal not measured::PROVISION_MIGRATION_CARRIAGE_RETURN/);
});

test('TEMPORARY DELIBERATE FAILURE — remove in the next commit', () => {
  // This test exists to measure one thing and is reverted immediately after.
  //
  // The workflow change in this pull request claims that `if: ${{ !cancelled() }}`
  // on steps two through eleven means a failing script no longer suppresses its
  // siblings. actionlint proves the expression is VALID, which is not its runtime
  // effect, and an argument from another workflow's `if: always()` teardown is an
  // analogy rather than a measurement. So this failure is planted in the FIRST
  // script (`test:pennsync-transfer`, the only script that runs this file) and the
  // run's log answers both halves: whether steps two through eleven ran anyway,
  // and whether the job still failed. A guard that reads correctly and does
  // nothing is the outcome worth ruling out.
  assert.equal('deliberate failure, measuring the step split', 'this assertion is meant to fail');
});
