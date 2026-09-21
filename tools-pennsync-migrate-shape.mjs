/**
 * How a migration file's STATEMENTS are read, in one place.
 *
 * `migrationWithLedgerRow` needs it to find the closing `commit;` line, so the
 * ledger row lands inside the migration's own transaction. The management
 * transport needs it twice over: to refuse a body that would not be exactly one
 * transaction, and to decide whether a body can change the database. Those are
 * questions about one thing, and asking them of different readings is how the
 * answers drift.
 *
 * The reading is the correction this repository already paid for once: shape is
 * read as statements, not as the file's first and last characters. Every
 * migration opens with a `--` header, so a check anchored at the first
 * character refused all sixty-nine of them.
 *
 * It lives in its own module rather than in either tool because they import
 * each other otherwise — the migrate tool chooses a transport by URL, and the
 * transport reads shape the migrate tool's way.
 */

/** The non-blank, non-comment lines of `sql`, each with its index in the original. */
export function codeLines(sql) {
  return String(sql).split('\n')
    .map((line, index) => ({ line, index }))
    .filter(entry => entry.line.trim() !== '' && !/^\s*--/.test(entry.line));
}

/**
 * `sql` with everything that is not executable text blanked out, offsets kept.
 *
 * Dollar quoting is the reason this exists rather than a regular expression:
 * every contract in this store is a plpgsql body, and a plpgsql block opens
 * with the word `begin` and closes with `end`. A scan that did not skip
 * `$$ … $$` would read hundreds of block openers as transaction boundaries and
 * refuse every migration in the repository.
 */
export function executableText(sql) {
  const source = String(sql);
  const out = new Array(source.length).fill(' ');
  const keep = (from, to) => { for (let at = from; at < to; at += 1) out[at] = source[at]; };
  let at = 0;
  while (at < source.length) {
    if (source.startsWith('--', at)) {
      const end = source.indexOf('\n', at);
      at = end < 0 ? source.length : end;
    } else if (source.startsWith('/*', at)) {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
    } else if (source[at] === "'") {
      let end = at + 1;
      while (end < source.length) {
        if (source[end] === "'") {
          if (source[end + 1] === "'") { end += 2; continue; }   // an escaped quote
          break;
        }
        end += 1;
      }
      at = end + 1;
    } else if (source[at] === '"') {
      const end = source.indexOf('"', at + 1);
      at = end < 0 ? source.length : end + 1;
    } else {
      // `$tag$ … $tag$`, where the tag may be empty. Matched at the position so
      // a bare `$1` placeholder or a `$` inside an operator is not mistaken
      // for an opener.
      const opener = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(at));
      if (opener) {
        const tag = opener[0];
        const end = source.indexOf(tag, at + tag.length);
        at = end < 0 ? source.length : end + tag.length;
      } else {
        keep(at, at + 1);
        at += 1;
      }
    }
  }
  return out.join('');
}

/** The TOP-LEVEL transaction-control statements, in order: `begin`, `commit`, `rollback`. */
export function transactionControl(sql) {
  return [...executableText(sql).matchAll(/\b(begin|commit|rollback)\s*;/gi)]
    .map(match => match[1].toLowerCase());
}

/**
 * The leading keyword of every top-level statement, lowercased.
 *
 * Used to decide whether a body can change the database, which is a question
 * that has to fail CLOSED: a statement this cannot classify is a write.
 */
export function statementVerbs(sql) {
  return executableText(sql).split(';')
    .map(statement => /^\s*([A-Za-z]+)/.exec(statement)?.[1]?.toLowerCase())
    .filter(Boolean);
}

/**
 * Statements that cannot change the database, so a failed request may be sent
 * again.
 *
 * Deliberately short, and `with` is deliberately absent: a common table
 * expression may carry `insert`, `update`, `delete` or `merge`, so admitting
 * the keyword would admit a write. Nothing in the migrate tool uses one.
 */
export const READ_ONLY_VERBS = Object.freeze(['select', 'show', 'explain', 'table', 'values', 'begin', 'commit']);

/** True only when every statement in `sql` is provably read-only. */
export function isReadOnly(sql) {
  const verbs = statementVerbs(sql);
  return verbs.length > 0 && verbs.every(verb => READ_ONLY_VERBS.includes(verb));
}
