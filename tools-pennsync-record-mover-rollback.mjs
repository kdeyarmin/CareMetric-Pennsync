/**
 * The record mover's delta report and rollback.
 *
 * `planDelta` says, before a catch-up run, what the new plan would do compared with
 * what the last run left: rows to add, rows whose source changed, rows already
 * right, and rows the source no longer has. A row the source no longer has is
 * REPORTED and never deleted by a load; removing it is a rollback or a decision.
 *
 * `rollbackRun` undoes a run from its receipt: it deletes the rows the run
 * inserted, newest wave first, and only where the stored row still equals what the
 * run wrote. A row edited since is refused and reported, never deleted. Rows a run
 * only updated are reported as not restorable, because a receipt holds hashes and
 * not the values that were replaced.
 */

const SCHEMA = 'pennsync_records';
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const q = (name) => `"${name}"`;
const HASH_SQL = "encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex')";

export class RollbackError extends Error {
  constructor(code, detail = {}) { super(code); this.code = code; Object.assign(this, detail); }
}

const rowKey = (r) => `${r.table}|${r.source_app_id}|${r.id}`;

/** Compare a new plan's rows with the rows of the last receipt. Hashes and ids only. */
export function planDelta({ landing, receipt }) {
  // Every entry is compared, conflicts included: a conflicted row is still the previous
  // plan's row, and the next load meets the row that conflicted rather than inserting it.
  const last = new Map(receipt.entries.map((e) => [rowKey(e), e]));
  const now = new Set(landing.map(rowKey));
  const delta = { added: [], changed: [], unchanged: [], conflicted: [], removed_from_source: [] };
  for (const r of landing) {
    const before = last.get(rowKey(r));
    const entry = { table: r.table, source_app_id: r.source_app_id, id: r.id };
    if (!before) delta.added.push(entry);
    else if (before.outcome === 'conflict') delta.conflicted.push({ ...entry, plan_changed: before.plan_hash !== r.hash });
    else if (before.plan_hash === r.hash) delta.unchanged.push(entry);
    else delta.changed.push(entry);
  }
  for (const [k, e] of last) if (!now.has(k)) delta.removed_from_source.push({ table: e.table, source_app_id: e.source_app_id, id: e.id });
  const counts = Object.fromEntries(Object.entries(delta).map(([name, list]) => [name, list.length]));
  return { ...delta, counts };
}

const REFERENCE_PREFIXES = ['target_', 'related_', 'parent_', 'source_', 'linked_', 'primary_', 'referring_', 'original_'];

/** The table a `*_id` column names, allowing the same prefixes the verifier strips; only tables in the receipt count. */
function referencedTable(column, inReceipt) {
  const m = /^([a-z][a-z0-9_]*)_id$/.exec(column);
  if (!m) return null;
  if (inReceipt.has(m[1])) return m[1];
  for (const p of REFERENCE_PREFIXES) if (m[1].startsWith(p) && inReceipt.has(m[1].slice(p.length))) return m[1].slice(p.length);
  return null;
}

/** Every `*_id` column of the allowed tables, by table. */
async function referenceColumns(db, tables) {
  const res = await db.query(`select table_name t, column_name c from information_schema.columns where table_schema = $1 and table_name = any($2::text[]) and column_name like '%\\_id' order by 1, 2`, [SCHEMA, [...tables]]);
  const out = new Map();
  for (const r of res.rows) (out.get(r.t) ?? out.set(r.t, []).get(r.t)).push(r.c);
  return out;
}

/** Rows no receipt entry covers that point at a row this rollback is still going to delete. */
async function newDependents({ db, refColumns, ordered, outcomes, byKey, inReceipt }) {
  const doomed = new Map();
  for (const e of ordered) if (outcomes.get(rowKey(e)) === 'deleted') {
    const k = `${e.table}|${e.source_app_id}`;
    (doomed.get(k) ?? doomed.set(k, []).get(k)).push(e.id);
  }
  const found = [];
  const seen = new Set();
  for (const [table, columns] of refColumns) {
    for (const column of columns) {
      const target = referencedTable(column, inReceipt);
      if (!target) continue;
      for (const [k, ids] of doomed) {
        const [t, app] = k.split('|');
        if (t !== target) continue;
        const res = await db.query(`select to_jsonb(r) j from ${q(SCHEMA)}.${q(table)} r where r.source_app_id = $1 and r.${q(column)}::text = any($2::text[]) for update`, [app, ids]);
        for (const r of res.rows) {
          const row = typeof r.j === 'string' ? JSON.parse(r.j) : r.j;
          const own = byKey.get(`${table}|${app}|${row.id}`);
          if (own && outcomes.get(rowKey(own)) === 'deleted') continue; // goes with the run, children first
          const parent = byKey.get(`${target}|${app}|${row[column]}`);
          const sig = `${table}|${app}|${row.id}|${rowKey(parent)}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          found.push({ source_app_id: app, row, parent });
        }
      }
    }
  }
  return found;
}

/**
 * `tableWaves` is a Map of table to wave (from the plan's `loads`); `tables` is the
 * allowed table set. With `dryRun` nothing is deleted and the outcomes are what a
 * real rollback would have done.
 *
 * The whole rollback is one transaction. The record store has no foreign keys, so a
 * row that is kept (edited since the run) must also keep every row it points at, or
 * the kept row is left dangling: a parent is reported `kept_for_dependent` and not
 * deleted, and that holds transitively. A dependency is any `<table>_id` column (with the
 * verifier's reference prefixes allowed) that names another table in the receipt, on a
 * receipt row or on a row created since the run: a new dependent keeps its parent too.
 */
export async function rollbackRun({ db, receipt, tableWaves, tables, dryRun = false }) {
  if (receipt?.format !== 'pennsync-record-mover-receipt' || !Array.isArray(receipt.entries) || !(tables instanceof Set) || !(tableWaves instanceof Map)) {
    throw new RollbackError('rollback_configuration_invalid');
  }
  // A loader dry run records rows as inserted that were never written, with the hashes they would have had.
  if (receipt.dry_run === true) throw new RollbackError('receipt_is_dry_run');
  for (const e of receipt.entries) {
    if (!IDENT.test(e.table) || !tables.has(e.table)) throw new RollbackError('table_not_allowed', { table: String(e.table).slice(0, 63).replace(/[^a-z0-9_]/g, '?') });
    if (!tableWaves.has(e.table)) throw new RollbackError('table_without_wave', { table: e.table });
  }
  const inReceipt = new Set(receipt.entries.map((e) => e.table));
  const ordered = [...receipt.entries].sort((a, b) => tableWaves.get(b.table) - tableWaves.get(a.table) || (rowKey(a) < rowKey(b) ? -1 : 1));
  const outcomes = new Map();
  await db.query('begin');
  try {
    // Phase 1: classify every entry, locking the rows it may delete.
    const stored = new Map();
    for (const e of ordered) {
      const T = `${q(SCHEMA)}.${q(e.table)}`;
      const held = await db.query(`select ${HASH_SQL} h, to_jsonb(r) j from ${T} r where r.source_app_id = $1 and r.id = $2 for update`, [e.source_app_id, e.id]);
      stored.set(rowKey(e), held.rows[0] ? (typeof held.rows[0].j === 'string' ? JSON.parse(held.rows[0].j) : held.rows[0].j) : null);
      let outcome;
      if (e.outcome === 'updated') outcome = 'not_restorable';
      else if (e.outcome !== 'inserted') outcome = 'left_alone';
      else if (!held.rows.length) outcome = 'already_absent';
      else outcome = held.rows[0].h === e.db_hash ? 'deleted' : 'edited_since';
      outcomes.set(rowKey(e), outcome);
    }
    // Phase 2: whatever stays keeps what it points at, all the way up. Stayers are
    // receipt rows that will not be deleted AND rows created since the run that point
    // at a row about to be deleted (they are in no receipt, and nothing else stops them
    // dangling).
    const byKey = new Map(ordered.map((e) => [rowKey(e), e]));
    const refColumns = await referenceColumns(db, tables);
    const queue = ordered.filter((e) => ['edited_since', 'not_restorable', 'left_alone'].includes(outcomes.get(rowKey(e))) && stored.get(rowKey(e))).map((e) => ({ source_app_id: e.source_app_id, row: stored.get(rowKey(e)) }));
    const settle = () => {
      while (queue.length) {
        const { source_app_id, row } = queue.pop();
        for (const [column, value] of Object.entries(row)) {
          const target = referencedTable(column, inReceipt);
          if (!target || typeof value !== 'string' || value === '') continue;
          const parent = byKey.get(`${target}|${source_app_id}|${value}`);
          if (parent && outcomes.get(rowKey(parent)) === 'deleted') {
            outcomes.set(rowKey(parent), 'kept_for_dependent');
            queue.push({ source_app_id: parent.source_app_id, row: stored.get(rowKey(parent)) });
          }
        }
      }
    };
    settle();
    for (;;) {
      const found = await newDependents({ db, refColumns, ordered, outcomes, byKey, inReceipt });
      if (!found.length) break;
      for (const d of found) { d.parent && outcomes.set(rowKey(d.parent), 'kept_for_dependent'); }
      for (const d of found) queue.push({ source_app_id: d.source_app_id, row: d.row });
      for (const d of found) queue.push({ source_app_id: d.parent.source_app_id, row: stored.get(rowKey(d.parent)) });
      settle();
    }
    // Phase 3: delete what is still marked, children first.
    for (const e of ordered) {
      if (outcomes.get(rowKey(e)) === 'deleted') {
        await db.query(`delete from ${q(SCHEMA)}.${q(e.table)} where source_app_id = $1 and id = $2`, [e.source_app_id, e.id]);
      }
    }
    await db.query(dryRun ? 'rollback' : 'commit');
  } catch (e) {
    try { await db.query('rollback'); } catch { /* already closed out */ }
    if (e instanceof RollbackError) throw e;
    throw new RollbackError('rollback_refused');
  }
  const entries = ordered.map((e) => ({ table: e.table, source_app_id: e.source_app_id, id: e.id, outcome: outcomes.get(rowKey(e)) }));
  const counts = {};
  for (const o of entries) {
    const t = (counts[o.table] ??= {});
    t[o.outcome] = (t[o.outcome] ?? 0) + 1;
  }
  return { format: 'pennsync-record-mover-rollback', version: 1, plan_digest: receipt.plan_digest, dry_run: dryRun, counts, entries };
}
