#!/usr/bin/env node
/**
 * What merging a change asks an operator to APPLY, said before the merge.
 *
 * A merged migration is not an applied one, and nothing in this repository said
 * so at the moment somebody decided to merge. `planMigration` asks whether a
 * deployment has run a migration BY NAME and the ledger holds no content hash
 * (D88), so a committed file reaches every store built from nothing and no
 * store that already exists until an operator runs `--apply`. Every suite here
 * builds from nothing, which is the one case that cannot see it; the only thing
 * that reads a real store is `hosted-store.test.mjs`, gated on `refs/heads/main`
 * because it holds a hosted credential. So the consequence of merging was
 * structurally discoverable only after the merge, from a red main — which cost
 * a day on 2026-09-23.
 *
 * This says it on the pull request instead, and says it without a credential,
 * because the question does not need one: "does this change add a migration"
 * is a fact about the diff. It claims nothing about what any deployment holds.
 * That remains `hosted-store.test.mjs`'s half, and the two answers are
 * deliberately not merged — a prediction that quietly became a measurement is
 * how a green reading comes to stand for something nobody read.
 *
 * It is a SIGNAL and not a gate. The apply is an operator action on a machine
 * this repository cannot reach, so nothing here can be satisfied inside the
 * pull request, and a gate demanding it would stall every merge on one person.
 * The only non-zero exits are refusals to MEASURE, below.
 *
 * WHAT IT READS, and why it is the pin rather than the directory.
 * `migration-fingerprints.json` already carries every committed migration's
 * sha256 keyed `<directory>/<file>`, and `git show <base>:<pin>` reads one file
 * at the base commit — no worktree, no archive, no second copy of the
 * provisioner's ordering rules. The risk it brings is the house defect this
 * repository keeps finding: a check that decides from one representation and is
 * silently wrong when the same thing arrives in another. A pull request that
 * added a migration and did not re-pin would be reported here as adding
 * nothing, quietly, while `tools-pennsync-migration-fingerprints.test.mjs`
 * failed elsewhere for its own reasons. So the pin is cross-checked against the
 * migration directories on BOTH sides before anything is counted, and a
 * disagreement REFUSES rather than reporting a number: the head side against
 * the real files through `fingerprints()`, the base side by NAME through
 * `git ls-tree`, which is what a commit can be asked cheaply. Names only on the
 * base side is a deliberate limit and is stated where it is enforced.
 *
 * `LOCAL_ONLY_MIGRATIONS` is imported from the migrate tool rather than
 * re-listed: a migration deliberately held back from every deployment arrives
 * in the pin like any other and owes no apply. Naming it anyway, with the
 * reason, is the difference between a count somebody can check and a count they
 * have to trust.
 *
 * HOW THE BASE IS CHOSEN, by the caller. On a `pull_request` run the checkout is
 * the MERGE commit, so the working tree is the merged result and its first
 * parent is the base branch: comparing the two is literally "what would merging
 * do". On a push to `main` the same comparison against the previous commit is
 * "what did merging just do". The tool takes a ref and refuses one it cannot
 * read rather than defaulting to a name that may not exist in a shallow
 * checkout.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { basename, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOCAL_ONLY_MIGRATIONS } from './tools-pennsync-migrate.mjs';
import { MIGRATION_DIRECTORY, RECORD_MIGRATION_DIRECTORY } from './tools-pennsync-provision.mjs';
import { PIN_FILE, fingerprints, readPin } from './tools-pennsync-migration-fingerprints.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const APPLY_SIGNAL_CONTRACT = 'cm.pennsync.apply-signal.v1';

/** The apply, exactly as the plan document and AGENTS.md give it. */
export const APPLY_COMMAND = 'PENNSYNC_MIGRATE_DATABASE_URL=… node tools-pennsync-migrate.mjs --apply';

export class ApplySignalError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}
const refuse = (code, detail) => { throw new ApplySignalError(code, detail); };

/** git paths are always `/`; `join` is not on Windows. */
const slashes = path => path.split(sep).join('/');

/** The pin's own key for a migration file: `<directory>/<file>`. */
const pinKey = (directory, file) => `${basename(directory)}/${file}`;

function git(args, repository) {
  try {
    return execFileSync('git', args, {
      cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { failed: err };
  }
}

/** The committed pin as it stood at `ref`. */
export function readPinAt(ref, repository = here) {
  const text = git(['show', `${ref}:${PIN_FILE}`], repository);
  if (typeof text !== 'string') refuse('APPLY_SIGNAL_BASE_UNREADABLE', { ref, file: PIN_FILE });
  try {
    return JSON.parse(text);
  } catch (err) {
    refuse('APPLY_SIGNAL_BASE_PIN_UNPARSEABLE', { ref, message: err.message });
  }
}

/**
 * The migration files `ref` carries, as pin keys.
 *
 * `git ls-tree` answers this for a commit without a worktree. It gives NAMES,
 * which is what keeps the base side honest about the one drift that would
 * understate the count — a migration present at the base and missing from its
 * pin, so that the same file at the head looks new. It says nothing about the
 * base files' CONTENTS; an edit is caught by the hashes the pin does carry, and
 * a base whose pin recorded the wrong hash for a file it does list is the base's
 * own gate to fail, not this one's.
 */
export function migrationNamesAt(ref, repository = here) {
  const keys = [];
  for (const directory of [MIGRATION_DIRECTORY, RECORD_MIGRATION_DIRECTORY]) {
    const listed = git(['ls-tree', '-r', '--name-only', ref, '--', slashes(directory)], repository);
    if (typeof listed !== 'string') refuse('APPLY_SIGNAL_BASE_UNREADABLE', { ref, directory });
    for (const path of listed.split('\n')) {
      if (!path.endsWith('.sql')) continue;
      keys.push(pinKey(directory, path.slice(path.lastIndexOf('/') + 1)));
    }
  }
  return keys.sort();
}

/**
 * The four findings, over two pins.
 *
 * Pure, so every one of them is provable without a repository. `arriving` is
 * the count that matters and the only one an operator has to act on.
 */
export function applySignal({ base, head, localOnly = LOCAL_ONLY_MIGRATIONS }) {
  const heldBackReason = key => localOnly[key.slice(key.indexOf('/') + 1)];
  const appearing = Object.keys(head).filter(key => !(key in base)).sort();

  const arriving = appearing.filter(key => !heldBackReason(key));
  const heldBack = appearing.filter(heldBackReason)
    .map(name => ({ name, reason: heldBackReason(name) }));
  // An edit to a held-back file reaches no deployment either, so it is not an
  // alarm and is not reported as one.
  const editing = Object.keys(head)
    .filter(key => key in base && base[key] !== head[key] && !heldBackReason(key)).sort();
  const withdrawing = Object.keys(base).filter(key => !(key in head)).sort();

  return Object.freeze({
    contract: APPLY_SIGNAL_CONTRACT,
    arriving, editing, withdrawing, heldBack,
    behindBy: arriving.length,
  });
}

/**
 * The same, over this repository at `base`, with both pins cross-checked
 * against the files they claim to describe.
 */
export function measure({ base, repository = here }) {
  if (!base) refuse('APPLY_SIGNAL_BASE_MISSING');

  // The head side, against the real directories. A stale pin here would make
  // every count below wrong in the quiet direction, so it is refused and named.
  const tree = fingerprints(repository);
  const pin = readPin(repository);
  const stale = [...new Set([...Object.keys(tree), ...Object.keys(pin)])]
    .filter(key => tree[key] !== pin[key]).sort();
  if (stale.length) refuse('APPLY_SIGNAL_PIN_STALE', { files: stale });

  const basePin = readPinAt(base, repository);
  const unpinnedAtBase = migrationNamesAt(base, repository).filter(key => !(key in basePin));
  if (unpinnedAtBase.length) {
    refuse('APPLY_SIGNAL_BASE_PIN_INCOMPLETE', { ref: base, files: unpinnedAtBase });
  }

  return Object.freeze({ base, ...applySignal({ base: basePin, head: pin }) });
}

const bullets = names => names.map(name => `- \`${name}\``).join('\n');
/** An operator reads these lines; `1 migration(s)` reads like a placeholder. */
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/**
 * A workflow annotation is one LINE. A newline in the middle of one silently
 * truncates it and turns the rest into log noise, and one of these carries a
 * reason written in another file, where nothing stops somebody wrapping it.
 */
const oneLine = text => text.replace(/\s+/g, ' ').trim();

/**
 * What a reader sees: workflow annotations, and a summary block for the run.
 *
 * The two cases read differently on purpose. Nothing owed is one line, because
 * most changes owe nothing and a paragraph every time is how a signal stops
 * being read. Something owed names the files, the count, the red it will cause
 * on main and the command — the command because the last thing an operator
 * wants is to go and look it up, and the expected red because a failure nobody
 * predicted gets diagnosed from scratch, which is what this cost last time.
 */
export function report(signal) {
  const lines = [];
  const annotations = { push: line => lines.push(oneLine(line)) };
  const summary = ['## Migrations this change asks an operator to apply', ''];

  if (signal.arriving.length) {
    const arriving = signal.arriving.length;
    annotations.push('::warning title=Apply owed after merge::'
      + `${count(arriving, 'migration')} arrive${arriving === 1 ? 's' : ''} with this change. `
      + 'Merging applies nothing, so until an operator does, the hosted-store job on main '
      + `fails its ledger check by ${count(arriving, 'row')}.`);
    summary.push(`Merging this adds **${count(arriving, 'migration')}** that no existing `
      + 'deployment has run:',
      '', bullets(signal.arriving), '',
      'A merged migration is not an applied one: the ledger keys on a migration\'s NAME and'
      + ' holds no content hash, so a committed migration reaches every store built from nothing'
      + ' and no store that already exists. Until an operator applies it, the `hosted-store` job'
      + ' on `main`'
      + ` fails its ledger check by ${count(arriving, 'row')} — an expected red, not new drift.`, '',
      'The apply is an operator action and CI never does it:', '',
      '```', APPLY_COMMAND, '```', '',
      'The same command without `--apply` plans and applies nothing.', '');
  }

  if (signal.editing.length) {
    annotations.push('::warning title=Applied migration edited::'
      + `${count(signal.editing.length, 'committed migration')} change text. A store that already `
      + 'ran the file will never see the edit; ship a forward migration in the same change (D88).');
    summary.push('### An already-committed migration changes text', '',
      bullets(signal.editing), '',
      'This reaches every FRESH provision and no store that ran the file, because the ledger'
      + ' matches on the name. Ship a forward migration carrying the change'
      + ' (`tools-pennsync-record-catchup.mjs` is the worked example), or say in the change that'
      + ' no deployment has run this file yet.', '');
  }

  if (signal.withdrawing.length) {
    annotations.push('::warning title=Committed migration withdrawn::'
      + `${count(signal.withdrawing.length, 'migration')} removed. Every deployment that applied `
      + 'one refuses further migration with MIGRATE_LEDGER_UNKNOWN.');
    summary.push('### A committed migration is removed', '',
      bullets(signal.withdrawing), '',
      'A deployment that applied one of these now holds a ledger name the repository does not,'
      + ' and `planMigration` refuses it with `MIGRATE_LEDGER_UNKNOWN` rather than applying more.',
      '');
  }

  for (const { name, reason } of signal.heldBack) {
    annotations.push(`::notice title=Held back from every deployment::${name} arrives and owes no `
      + `apply. ${reason}`);
  }

  if (!signal.arriving.length && !signal.editing.length && !signal.withdrawing.length) {
    annotations.push('::notice title=No apply owed::This change adds no migration, edits none that '
      + 'have been committed and removes none, so it asks nothing of a deployment that exists.');
    summary.push('This change adds no migration, edits none that have been committed and removes'
      + ' none. It asks nothing of a deployment that already exists.', '');
  }

  return Object.freeze({ annotations: lines, summary: `${summary.join('\n')}\n` });
}

export function runApplySignalCli({
  argv = process.argv.slice(2), repository = here, write = console.log, error = console.error,
} = {}) {
  const valueOf = flag => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };

  let signal;
  try {
    signal = measure({ base: valueOf('--base'), repository });
  } catch (err) {
    if (!(err instanceof ApplySignalError)) throw err;
    // A refusal is the one non-zero exit: the signal was not measured, and a
    // tool that says nothing and exits 0 is indistinguishable from one that
    // measured and found nothing owed.
    error(`::error title=Apply signal not measured::${err.code} `
      + `${JSON.stringify(err.detail ?? {})}`);
    return 1;
  }

  const { annotations, summary } = report(signal);
  for (const line of annotations) write(line);
  const summaryFile = valueOf('--summary');
  if (summaryFile) appendFileSync(summaryFile, summary);
  return 0;
}

// Direct-invocation check through pathToFileURL: a hand-built `file://` string
// never matches a Windows backslash path or a percent-encoded one, and the CLI
// then exits 0 having silently done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runApplySignalCli();
}
