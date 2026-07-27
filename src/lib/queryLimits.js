/**
 * Row limits for Base44 entity reads.
 *
 * `Entity.list(sort, limit)` and `Entity.filter(query, sort, limit)` only send a
 * `limit` param when one is passed. Omit it and the SERVER picks the page size —
 * roughly 50 rows — and the SDK returns that truncated page with no flag, no
 * error, and no `hasMore`. Every caller that treats the result as "all of them"
 * is then quietly wrong once the agency grows past the default page:
 *
 *   - a compliance rule library that stops at 50 rules silently skips the rest,
 *     so a note is reported as PASSING against rules that were never evaluated;
 *   - an "active patients" census stops counting at 50;
 *   - a staff roster drops users, so their names render blank and they can't be
 *     picked as an assignee.
 *
 * So: any read whose result is treated as a complete set must pass a limit.
 * `ALL_ROWS` is deliberately far above any realistic single-agency dataset — it
 * means "don't paginate this", not "exactly this many". Reads that genuinely
 * want a page (recent-N widgets) should keep their own smaller, explicit limit.
 *
 * This is a ceiling, not real pagination: a dataset that ever approaches it
 * needs a paged/aggregated query instead. `entityReadLimits.test.js` enforces
 * that new collection reads keep passing a limit.
 */
export const ALL_ROWS = 5000;

/**
 * Cap for per-patient clinical history (visits, incidents, uploads, signatures).
 * Large enough for a multi-year episode, small enough to keep a chart snappy.
 */
export const PATIENT_HISTORY_ROWS = 1000;
