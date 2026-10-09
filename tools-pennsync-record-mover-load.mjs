/**
 * The record mover's loader. A LIBRARY: it takes an open database handle and
 * opens no connection of its own.
 *
 * Step 3 of `base44-full-exit/record-mover-design-2026-10-02.md`. It writes the
 * rows the planner produced into the record store's tables as they were: the
 * same id, the same dates, the same author, with the agency the planner mapped.
 * It runs as the administrator role the migrations use, which row-level
 * security does not bind, and it deliberately bypasses the per-feature contracts
 * (they mint new ids and authors). Because of that it checks what the contracts
 * would have, and it checks it BEFORE the first write.
 *
 * - **One transaction per wave.** A wave lands whole or leaves the store as it
 *   found it; earlier waves stay committed, and the receipt says which.
 * - **Idempotent, three ways.** A row absent is inserted. A row present and
 *   equal to the plan is left alone. A row present and different is updated only
 *   if it still equals what the previous run wrote (the receipt); if someone
 *   changed it on the new side it is reported as a `conflict` and never touched.
 *   Equality is decided INSIDE the database, over the row it actually holds, so
 *   no JavaScript type conversion can make two different rows look alike.
 * - **The payload is the plan.** The landing rows must reproduce the plan's own `rows_digest`
 *   and the plan's `digest`, row by row, before anything else happens; an approval therefore
 *   names exactly these rows and no others.
 * - **Rows are locked while compared.** The stored row is read `for update`, so an edit made
 *   on the new side between the comparison and the write cannot be overwritten.
 * - **Real names are gated.** Unless every patient is obviously invented, the
 *   run needs an approval naming this exact plan's digest. That is a tripwire on
 *   the patient table, not proof about every name-bearing column.
 * - **Nothing leaves in output but ids, hashes and codes.** An error is a fixed
 *   code plus the table and id; never a value, never SQL text.
 *
 * The receipt can be sealed with a key Kevin holds (AES-256-GCM); the key is
 * used and zeroed here and appears in no output.
 */
import { canonical } from './tools-pennsync-record-mover-plan.mjs';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

export const SCHEMA = 'pennsync_records';
export class LoadError extends Error {
  constructor(code, detail = {}) { super(code); this.code = code; Object.assign(this, detail); }
}
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const SYNTHETIC_NAME = /^(Fixture|Synthetic)\b/;
const q = (name) => `"${name}"`;
const HASH_SQL = "encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex')";

const sha = (v) => createHash('sha256').update(v).digest('hex');

/** The landing rows are the ones the plan describes, byte for byte. */
export function verifyPlan({ report, landing }) {
  const { digest, ...body } = report ?? {};
  if (typeof digest !== 'string' || typeof report.rows_digest !== 'string' || sha(canonical(body)) !== digest) throw new LoadError('plan_digest_invalid');
  const lines = [];
  for (const r of landing) {
    if (r.hash !== sha(canonical({ table: r.table, row: r.row }))) throw new LoadError('plan_does_not_match_payload', { table: r.table });
    lines.push(`${r.table}|${r.source_app_id}|${r.id}|${r.hash}`);
  }
  if (sha(lines.sort().join('\n')) !== report.rows_digest) throw new LoadError('plan_does_not_match_payload');
}

function checkInputs({ landing, tables, report, approval }) {
  if (!Array.isArray(landing) || !(tables instanceof Set) || typeof report?.digest !== 'string') throw new LoadError('load_configuration_invalid');
  const planDigest = report.digest;
  for (const r of landing) {
    if (!IDENT.test(r.table) || !tables.has(r.table)) throw new LoadError('table_not_allowed', { table: String(r.table).slice(0, 63).replace(/[^a-z0-9_]/g, '?') });
    if (typeof r.id !== 'string' || typeof r.source_app_id !== 'string' || r.row?.id !== r.id) throw new LoadError('row_invalid', { table: r.table });
  }
  verifyPlan({ report, landing });
  const names = landing.filter((r) => r.table === 'patient');
  const invented = names.every((r) => SYNTHETIC_NAME.test(r.row.first_name ?? ''));
  if (!invented && approval?.real_names_plan_digest !== planDigest) throw new LoadError('real_names_not_approved');
}

async function columnsOf(db, table, cache) {
  if (!cache.has(table)) {
    const { rows } = await db.query(
      'select column_name from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position', [SCHEMA, table]);
    if (!rows.length) throw new LoadError('table_not_found', { table });
    cache.set(table, rows.map((x) => x.column_name).filter((c) => c !== 'source_app_id' && c !== 'id'));
  }
  return cache.get(table);
}

/**
 * Apply planned rows. `waves` is a Map of entity to wave number (from the
 * planner's `loads`); `previous` is a Map of `table|app|id` to the db hash the
 * last run recorded. Returns a receipt of ids, hashes and outcomes only.
 */
export async function applyLanding({ db, landing, waves, tables, report, previous = new Map(), approval = null, dryRun = false }) {
  checkInputs({ landing, tables, report, approval });
  const planDigest = report.digest;
  const byWave = new Map();
  for (const r of landing) {
    const w = waves.get(r.entity);
    if (w === undefined) throw new LoadError('entity_without_wave', { table: r.table });
    if (!byWave.has(w)) byWave.set(w, []);
    byWave.get(w).push(r);
  }
  const cache = new Map();
  const entries = []; const committed = [];
  for (const w of [...byWave.keys()].sort((a, b) => a - b)) {
    const rows = byWave.get(w).sort((a, b) => `${a.table}|${a.source_app_id}|${a.id}` < `${b.table}|${b.source_app_id}|${b.id}` ? -1 : 1);
    const done = [];
    let current = null;
    await db.query('begin');
    try {
      for (const r of rows) {
        current = r;
        const T = `${q(SCHEMA)}.${q(r.table)}`; const payload = JSON.stringify(r.row);
        const planned = (await db.query(`select ${HASH_SQL} h from jsonb_populate_record(null::${T}, $1::jsonb) r`, [payload])).rows[0].h;
        const held = await db.query(`select ${HASH_SQL} h from ${T} r where r.source_app_id = $1 and r.id = $2 for update`, [r.source_app_id, r.id]);
        let outcome; let dbHash = planned;
        if (!held.rows.length) {
          await db.query(`insert into ${T} select * from jsonb_populate_record(null::${T}, $1::jsonb)`, [payload]);
          outcome = 'inserted';
        } else if (held.rows[0].h === planned) {
          outcome = 'unchanged';
        } else if (previous.get(`${r.table}|${r.source_app_id}|${r.id}`) === held.rows[0].h) {
          const cols = await columnsOf(db, r.table, cache);
          await db.query(`update ${T} t set ${cols.map((c) => `${q(c)} = n.${q(c)}`).join(', ')} from jsonb_populate_record(null::${T}, $1::jsonb) n where t.source_app_id = $2 and t.id = $3`, [payload, r.source_app_id, r.id]);
          outcome = 'updated';
        } else {
          outcome = 'conflict'; dbHash = held.rows[0].h;
        }
        done.push({ table: r.table, source_app_id: r.source_app_id, id: r.id, outcome, plan_hash: r.hash, db_hash: dbHash });
      }
      await db.query(dryRun ? 'rollback' : 'commit');
    } catch (e) {
      try { await db.query('rollback'); } catch { /* the session is already closed out */ }
      if (e instanceof LoadError) throw e;
      throw new LoadError('wave_refused', { wave: w, committed_waves: committed.slice(), table: current?.table, id: current?.id });
    }
    entries.push(...done); committed.push(w);
  }
  const counts = {};
  for (const e of entries) {
    const t = (counts[e.table] ??= { inserted: 0, unchanged: 0, updated: 0, conflict: 0 });
    t[e.outcome] += 1;
  }
  return { format: 'pennsync-record-mover-receipt', version: 1, plan_digest: planDigest, dry_run: dryRun, waves: [...committed], counts, entries };
}

/** The `previous` map for a re-run, from an earlier receipt. */
export function previousFrom(receipt) {
  return new Map(receipt.entries.filter((e) => e.outcome !== 'conflict').map((e) => [`${e.table}|${e.source_app_id}|${e.id}`, e.db_hash]));
}

// ------------------------------------------------------------------ receipt

const MAGIC = 'pennsync-sealed-mover-receipt';
const aad = (salt) => Buffer.from(JSON.stringify([MAGIC, 1, salt.toString('hex')]));
function derive(key, salt) { return Buffer.from(hkdfSync('sha256', key, salt, MAGIC, 32)); }

/** Seal a receipt with a 32-byte key. The key is not retained. */
export function sealReceipt(receipt, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new LoadError('invalid_key');
  const salt = randomBytes(16); const iv = randomBytes(12); const k = derive(key, salt);
  try {
    const c = createCipheriv('aes-256-gcm', k, iv); c.setAAD(aad(salt));
    const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(receipt))), c.final()]);
    return Buffer.concat([salt, iv, c.getAuthTag(), body]);
  } finally { k.fill(0); }
}

export function openReceipt(sealed, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(sealed) || sealed.length < 44) throw new LoadError('invalid_key');
  const salt = sealed.subarray(0, 16); const k = derive(key, salt);
  try {
    const d = createDecipheriv('aes-256-gcm', k, sealed.subarray(16, 28)); d.setAAD(aad(salt)); d.setAuthTag(sealed.subarray(28, 44));
    return JSON.parse(Buffer.concat([d.update(sealed.subarray(44)), d.final()]).toString('utf8'));
  } catch { throw new LoadError('receipt_unreadable'); } finally { k.fill(0); }
}

export const sha256 = sha;
