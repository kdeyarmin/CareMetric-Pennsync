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
  const last = new Map(receipt.entries.filter((e) => e.outcome !== 'conflict').map((e) => [rowKey(e), e]));
  const now = new Set(landing.map(rowKey));
  const delta = { added: [], changed: [], unchanged: [], removed_from_source: [] };
  for (const r of landing) {
    const before = last.get(rowKey(r));
    const entry = { table: r.table, source_app_id: r.source_app_id, id: r.id };
    if (!before) delta.added.push(entry);
    else if (before.plan_hash === r.hash) delta.unchanged.push(entry);
    else delta.changed.push(entry);
  }
  for (const [k, e] of last) if (!now.has(k)) delta.removed_from_source.push({ table: e.table, source_app_id: e.source_app_id, id: e.id });
  const counts = Object.fromEntries(Object.entries(delta).map(([name, list]) => [name, list.length]));
  return { ...delta, counts };
}

/**
 * `tableWaves` is a Map of table to wave (from the plan's `loads`); `tables` is the
 * allowed table set. With `dryRun` nothing is deleted and the outcomes are what a
 * real rollback would have done.
 */
export async function rollbackRun({ db, receipt, tableWaves, tables, dryRun = false }) {
  if (receipt?.format !== 'pennsync-record-mover-receipt' || !Array.isArray(receipt.entries) || !(tables instanceof Set) || !(tableWaves instanceof Map)) {
    throw new RollbackError('rollback_configuration_invalid');
  }
  for (const e of receipt.entries) {
    if (!IDENT.test(e.table) || !tables.has(e.table)) throw new RollbackError('table_not_allowed', { table: String(e.table).slice(0, 63).replace(/[^a-z0-9_]/g, '?') });
    if (!tableWaves.has(e.table)) throw new RollbackError('table_without_wave', { table: e.table });
  }
  const byWave = new Map();
  for (const e of receipt.entries) {
    const w = tableWaves.get(e.table);
    if (!byWave.has(w)) byWave.set(w, []);
    byWave.get(w).push(e);
  }
  const outcomes = []; const done = [];
  for (const w of [...byWave.keys()].sort((a, b) => b - a)) {
    const batch = [];
    await db.query('begin');
    try {
      for (const e of byWave.get(w).sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : 1))) {
        const base = { table: e.table, source_app_id: e.source_app_id, id: e.id };
        if (e.outcome === 'updated') { batch.push({ ...base, outcome: 'not_restorable' }); continue; }
        if (e.outcome !== 'inserted') { batch.push({ ...base, outcome: 'left_alone' }); continue; }
        const T = `${q(SCHEMA)}.${q(e.table)}`;
        const held = await db.query(`select ${HASH_SQL} h from ${T} r where r.source_app_id = $1 and r.id = $2 for update`, [e.source_app_id, e.id]);
        if (!held.rows.length) batch.push({ ...base, outcome: 'already_absent' });
        else if (held.rows[0].h !== e.db_hash) batch.push({ ...base, outcome: 'edited_since' });
        else {
          await db.query(`delete from ${T} where source_app_id = $1 and id = $2`, [e.source_app_id, e.id]);
          batch.push({ ...base, outcome: 'deleted' });
        }
      }
      await db.query(dryRun ? 'rollback' : 'commit');
    } catch {
      try { await db.query('rollback'); } catch { /* already closed out */ }
      throw new RollbackError('rollback_wave_refused', { wave: w, rolled_back_waves: done.slice() });
    }
    outcomes.push(...batch); done.push(w);
  }
  const counts = {};
  for (const o of outcomes) {
    const t = (counts[o.table] ??= {});
    t[o.outcome] = (t[o.outcome] ?? 0) + 1;
  }
  return { format: 'pennsync-record-mover-rollback', version: 1, plan_digest: receipt.plan_digest, dry_run: dryRun, counts, entries: outcomes };
}
