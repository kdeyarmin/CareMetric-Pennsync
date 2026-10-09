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
 * run wrote. A row edited since is refused and reported, never deleted. A rollback
 * also never leaves a remaining row pointing at a row it deleted: a row the run
 * inserted is kept, and reported `kept_for_dependent`, as long as anything that stays
 * points at it, whether that is a receipt row the rollback keeps or a row created since
 * the run, which no receipt names and the rollback never touches. Rows a run only updated are
 * reported as not restorable, because a receipt holds hashes and not the values that
 * were replaced.
 *
 * Two limits on that promise. A reference is recognised by its column's name, by the
 * rule the verifier uses (`tools-pennsync-record-mover-references.mjs`), so a column
 * whose name does not name its table protects nothing. And the scan for new rows sees
 * what was committed when it ran: without foreign keys nothing stops another session
 * adding a dependent while the rollback is in flight, so run it with the store quiet.
 */
import { referenceTarget } from './tools-pennsync-record-mover-references.mjs';

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

/**
 * Every reference column of every carried table (a table with `source_app_id`) that
 * names a table in the receipt. Read from the catalog, not from `information_schema`,
 * which hides what the role may not read: a table this role cannot read then fails the
 * scan loudly instead of dropping out of it. Not limited to the allowed set, which
 * bounds what a rollback may DELETE; a row that points at a deleted row matters
 * wherever it is.
 */
async function referenceColumns(db, inReceipt) {
  const res = await db.query(`
    select c.relname t, a.attname col
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = $1 and c.relkind in ('r', 'p')
       and exists (select 1 from pg_catalog.pg_attribute s where s.attrelid = c.oid and s.attname = 'source_app_id' and not s.attisdropped)
     order by 1, 2`, [SCHEMA]);
  const out = [];
  for (const { t: table, col: column } of res.rows) {
    const target = referenceTarget(column, inReceipt);
    if (!target) continue;
    if (!IDENT.test(table)) throw new RollbackError('rollback_refused');
    out.push({ table, column, target });
  }
  return out;
}

/**
 * The receipt entries still marked `deleted` that a row which is NOT being deleted
 * points at: a receipt row that stays, or a row created since the run, which no receipt
 * names. Asked of the store itself, one reference column at a time, within one source
 * app, since an id is only unique within one.
 */
async function pointedAt({ db, references, ordered, outcomes, byKey }) {
  const doomed = new Map();
  for (const e of ordered) {
    if (outcomes.get(rowKey(e)) !== 'deleted') continue;
    const apps = doomed.get(e.table) ?? doomed.set(e.table, new Map()).get(e.table);
    (apps.get(e.source_app_id) ?? apps.set(e.source_app_id, []).get(e.source_app_id)).push(e.id);
  }
  const held = [];
  for (const { table, column, target } of references) {
    for (const [app, ids] of doomed.get(target) ?? []) {
      const going = doomed.get(table)?.get(app) ?? [];
      const res = await db.query(`select distinct r.${q(column)}::text ref from ${q(SCHEMA)}.${q(table)} r where r.source_app_id = $1 and r.${q(column)}::text = any($2::text[]) and not (r.id = any($3::text[]))`, [app, ids, going]);
      for (const { ref } of res.rows) held.push(byKey.get(`${target}|${app}|${ref}`));
    }
  }
  return held;
}

/**
 * `tableWaves` is a Map of table to wave (from the plan's `loads`); `tables` is the
 * allowed table set. With `dryRun` nothing is deleted and the outcomes are what a
 * real rollback would have done.
 *
 * The whole rollback is one transaction. The record store has no foreign keys, so a
 * row that stays must also keep every row it points at, or it is left dangling: such a
 * parent is reported `kept_for_dependent` and not deleted, and that holds transitively.
 * A row that stays is any row of a carried table this rollback is not deleting, so a
 * row created since the run, which no receipt names, counts as much as a receipt row
 * that is kept. A reference is a column the shared rule resolves to a table in the
 * receipt, matched within the same source app.
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
    for (const e of ordered) {
      const T = `${q(SCHEMA)}.${q(e.table)}`;
      const held = await db.query(`select ${HASH_SQL} h from ${T} r where r.source_app_id = $1 and r.id = $2 for update`, [e.source_app_id, e.id]);
      let outcome;
      if (e.outcome === 'updated') outcome = 'not_restorable';
      else if (e.outcome !== 'inserted') outcome = 'left_alone';
      else if (!held.rows.length) outcome = 'already_absent';
      else outcome = held.rows[0].h === e.db_hash ? 'deleted' : 'edited_since';
      outcomes.set(rowKey(e), outcome);
    }
    // Phase 2: whatever stays keeps what it points at, all the way up. The store is
    // asked rather than the receipt, so a row created since the run counts as much as a
    // receipt row that stays. A parent kept in one pass is a row that stays in the next,
    // which is what makes it transitive; each pass keeps at least one more entry, so the
    // passes end.
    const byKey = new Map(ordered.map((e) => [rowKey(e), e]));
    const references = await referenceColumns(db, inReceipt);
    for (let held; (held = await pointedAt({ db, references, ordered, outcomes, byKey })).length;) {
      for (const e of held) outcomes.set(rowKey(e), 'kept_for_dependent');
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
