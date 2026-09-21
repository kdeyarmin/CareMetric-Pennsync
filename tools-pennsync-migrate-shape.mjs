/**
 * How a migration file's STATEMENTS are read, in one place.
 *
 * `migrationWithLedgerRow` needs it to find the closing `commit;` line, so the
 * ledger row lands inside the migration's own transaction. The management
 * transport needs it to refuse a body that would leave a transaction open.
 * Those are two questions about one thing, and asking them of two different
 * readings is how the answers drift.
 *
 * The reading itself is the correction this repository already paid for once:
 * shape is read as statements, not as the file's first and last characters.
 * Every migration opens with a `--` header, so a check anchored at the first
 * character refused all sixty-nine of them.
 *
 * It lives in its own module rather than in either tool because they import
 * each other otherwise — the migrate tool chooses this transport by URL, and
 * the transport reads shape the migrate tool's way.
 */

/** The non-blank, non-comment lines of `sql`, each with its index in the original. */
export function codeLines(sql) {
  return String(sql).split('\n')
    .map((line, index) => ({ line, index }))
    .filter(entry => entry.line.trim() !== '' && !/^\s*--/.test(entry.line));
}
