/**
 * What a migration ledger row can say about the text that was applied.
 *
 * D88 is the defect this answers at its origin. `planMigration` decides what
 * to apply from a migration's NAME — deliberately, because the Supabase CLI
 * stamps its own version when a migration is pushed and the name is the only
 * stable key the two sides share — and the row it writes carries `version` and
 * `name` and nothing else. So a file whose text changes after it has been
 * applied is skipped forever on every store that ran it and applied in full on
 * every store built afterwards, with nothing between the two that compares.
 * Every suite in this repository builds from nothing, which is the one case
 * the defect cannot appear in.
 *
 * `supabase_migrations.schema_migrations` already carries a `statements`
 * column. The ledger was never unable to record what a migration held; it was
 * being told nothing. This module is what tells it, and what reads it back.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO.
 *
 * It does not backfill a row that is already there. D88 set that aside for a
 * reason that re-measures as true: `migrationWithLedgerRow` inserts `version`
 * and `name` only, so for every migration this tooling has applied the ledger
 * holds no record of the text, and nothing in the store or the repository can
 * recover it — the row carries no time, and the fingerprint pin is a fact
 * about the tree rather than about any deployment. Writing the tree's CURRENT
 * text into those rows would assert something unobserved, and for the one file
 * this defect actually happened to it would record the edited text as though
 * it had been applied, erasing the evidence of the gap. Those rows are
 * `unrecorded` here, permanently, and `compareLedgerStatements` will not call
 * a ledger holding one of them verified.
 *
 * It does not replace the fingerprint pin. The pin answers "did this commit
 * change a file that was pinned", before a merge and with no database; this
 * answers "does this store hold what the tree says it ran", with a database
 * and no commit. D88 says keep both, and they are both still here.
 *
 * THE HAZARD D88 NAMED, AND WHAT ANSWERS IT. Populating the column faithfully
 * means splitting a migration into statements, which means a reader that
 * handles dollar-quoted bodies — every function in this store is one — and a
 * splitter that got it subtly wrong would write a plausible wrong answer into
 * the place the next person trusts. Two things answer it rather than one
 * promise. The split is taken from `executableText`, the reader the migrate
 * tool and the management transport already share, so there is no second
 * parser to drift; and the split is by OFFSET into the original text, with the
 * result checked to reconstruct it exactly. A split in the wrong place is then
 * still a faithful record of what ran, and a split that lost or duplicated a
 * byte is a refusal rather than a row.
 */
import { executableText } from './tools-pennsync-migrate-shape.mjs';

export const LEDGER_STATEMENTS_CONTRACT = 'cm.pennsync.ledger-statements.v1';

/**
 * The first element of every array this tooling writes.
 *
 * Provenance, because the ledger has two writers. Nine of hosted staging's
 * rows were pushed by the Supabase CLI, which populates `statements` in its
 * own shape; comparing one of those against this module's split would report
 * drift where there is none, which is the kind of false alarm that makes a
 * check worth ignoring. A row whose first element is not this marker is
 * reported as `foreign` and nothing is claimed about it.
 *
 * It is a SQL comment so that an array read by anything else is still a
 * sequence of harmless statements, and it carries a version so a later format
 * can be told apart rather than silently compared.
 */
export const LEDGER_STATEMENTS_MARKER = '-- pennsync:ledger-statements:v1';

/**
 * How much statement text one migration may add to the body that applies it.
 *
 * Recording the text doubles the request: the migration travels once as SQL
 * and once as a literal inside its own ledger row, and the management
 * transport sends the whole body in ONE request because the ledger row has to
 * commit inside the migration's transaction. The largest committed migration
 * is `20260919170000_record_store.sql` at about 463 KiB, which already works;
 * at about 926 KiB it is untested, and the endpoint's real ceiling is not
 * measurable from this repository.
 *
 * So this is a BOUND CHOSEN, not a limit measured, and it is written that way
 * on purpose. Over it, the migration still applies and its row is written
 * without statements, reported as skipped with its reason — the capability is
 * never traded for the record, and the degradation is visible in the result
 * rather than silent. Exactly one committed migration is over it; a test names
 * which, so the day a second one crosses is a failure rather than a surprise.
 */
export const LEDGER_STATEMENT_BUDGET = 262144;

export class LedgerStatementsError extends Error {
  constructor(code, detail) { super(code); this.name = 'LedgerStatementsError'; this.code = code; this.detail = detail; }
}
const refuse = (code, detail) => { throw new LedgerStatementsError(code, detail); };

/**
 * A migration's text, partitioned at its top-level statement boundaries.
 *
 * Every element is a slice of the original and the elements concatenate back
 * to it exactly, including the file's comment header and the blank lines
 * between statements — leading text belongs to the statement that follows it
 * and anything after the last `;` is appended to the statement before it, so
 * no element is made of comments alone.
 *
 * The exactness is asserted here rather than left to the caller, because the
 * whole value of the record is that it is the text that ran.
 */
export function splitStatements(sql) {
  const source = String(sql);
  const code = executableText(source);
  const statements = [];
  let start = 0;
  for (let at = 0; at < code.length; at += 1) {
    if (code[at] !== ';') continue;
    statements.push(source.slice(start, at + 1));
    start = at + 1;
  }
  if (start < source.length) {
    const tail = source.slice(start);
    if (statements.length) statements[statements.length - 1] += tail;
    else statements.push(tail);
  }
  if (!statements.length) statements.push(source);

  const rebuilt = statements.join('');
  if (rebuilt !== source) {
    // Cannot happen while the split is by offset, which is why it is checked:
    // it is the property the record's whole worth rests on, and a future edit
    // that trimmed an element would otherwise pass every other test here.
    refuse('LEDGER_SPLIT_UNFAITHFUL', { lost: source.length - rebuilt.length });
  }
  return Object.freeze(statements);
}

/** What goes in the column: the marker, then the migration's own statements. */
export function recordedStatements(sql) {
  return Object.freeze([LEDGER_STATEMENTS_MARKER, ...splitStatements(sql)]);
}

/** The text a row's statements say was applied, or null when it says nothing. */
export function recordedText(statements) {
  if (!Array.isArray(statements) || !statements.length) return null;
  if (statements[0] !== LEDGER_STATEMENTS_MARKER) return null;
  return statements.slice(1).join('');
}

/**
 * One statement as a SQL literal.
 *
 * Dollar-quoted rather than quote-doubled. Both are correct and a test that
 * replaced this with `''` doubling passed, so the reason is not safety: the
 * literal is a whole SQL statement travelling inside another SQL statement,
 * and a doubled body is unreadable in the one place an operator ever sees it,
 * a failed apply. What IS load-bearing is that the tag is checked absent from
 * the text rather than assumed absent — every function in this store is
 * dollar-quoted, and one of them naming this tag would otherwise close the
 * literal early. A text that defeats every candidate is refused.
 */
export function statementLiteral(statement) {
  const text = String(statement);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const tag = attempt === 0 ? '$pennsync$' : `$pennsync_${attempt}$`;
    if (!text.includes(tag)) return `${tag}${text}${tag}`;
  }
  refuse('LEDGER_STATEMENT_UNQUOTABLE', { length: text.length });
}

/** The whole column value as a SQL literal, or null when there is nothing to say. */
export function statementsLiteral(statements) {
  if (!Array.isArray(statements) || !statements.length) return 'null::text[]';
  return `array[${statements.map(statementLiteral).join(',\n    ')}]::text[]`;
}

/** Whether a migration's statements fit the budget above. */
export function withinStatementBudget(sql) {
  return String(sql).length <= LEDGER_STATEMENT_BUDGET;
}

/**
 * What a store's ledger says about the text it ran, per migration.
 *
 * Pure, so every verdict is provable without a database — the shape
 * `planMigration` is written in, for the same reason.
 *
 * `rows` are the ledger's own rows; `migrations` the repository's, as
 * `readMigrations` returns them. `ledgerName` is passed in rather than
 * imported so this module stays free of the migrate tool, which imports it.
 *
 * The verdict is the point. It is `verified` only when every row was recorded
 * by this tooling and every one of them matches; anything unrecorded or
 * foreign makes it `unverifiable`, never clean. D88's reason for deferring the
 * backfill is that answer: a store whose rows predate this says nothing, and
 * saying nothing has to read differently from saying yes.
 */
export function compareLedgerStatements({ migrations, rows, ledgerName }) {
  if (typeof ledgerName !== 'function') refuse('LEDGER_COMPARE_NAMER_REQUIRED');
  const byName = new Map();
  for (const migration of migrations ?? []) byName.set(ledgerName(migration.name), migration);

  const verified = [];
  const drifted = [];
  const unrecorded = [];
  const foreign = [];
  const unknown = [];
  for (const row of rows ?? []) {
    const migration = byName.get(row.name);
    if (!migration) { unknown.push(row.name); continue; }
    if (!Array.isArray(row.statements) || !row.statements.length) { unrecorded.push(row.name); continue; }
    if (row.statements[0] !== LEDGER_STATEMENTS_MARKER) { foreign.push(row.name); continue; }
    if (recordedText(row.statements) === migration.sql) verified.push(row.name);
    else drifted.push(row.name);
  }

  const verdict = drifted.length ? 'drifted'
    : (unrecorded.length || foreign.length || unknown.length) ? 'unverifiable'
      : 'verified';
  return Object.freeze({
    contract: LEDGER_STATEMENTS_CONTRACT,
    verdict,
    verified: verified.sort(),
    drifted: drifted.sort(),
    unrecorded: unrecorded.sort(),
    foreign: foreign.sort(),
    unknown: unknown.sort(),
  });
}
