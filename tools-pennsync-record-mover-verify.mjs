import { createHash } from 'node:crypto';

/**
 * The record mover's verifier.
 *
 * Written apart from the loader on purpose and importing nothing from it: it never
 * uses the loader's hash, its upsert, or its idea of equality, so a defect shared
 * by both halves has nowhere to hide. It reads the planned rows on one side and
 * the database on the other and prints counts, table names, ids and reason codes
 * only: never a name, an address or any other value.
 *
 * The six checks, each named for what it protects:
 *   counts       every planned row is in its table, and nothing planned is missing
 *   content      each stored row says what the plan said it should (JS derivation
 *                against what the database itself renders with to_jsonb)
 *   links        every `<entity>_id` reference resolves, inside the same agency
 *   visibility   through the real policies, an agency's people see its rows and
 *                not another agency's (needs identities, given by the rehearsal)
 *   quarantine   every source row is loaded or set aside, never both, never neither
 *   files        sealed file bytes against the digests their descriptors declare
 */

const SCHEMA = 'pennsync_records';
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const q = (name) => `"${name}"`;
const sha = (v) => createHash('sha256').update(v).digest('hex');
const STAMP = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/;

function ident(name) {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new Error('verify_identifier_invalid');
  return name;
}

/** Compare one planned value with one stored value. Dates compare as instants. */
export function sameValue(planned, stored) {
  if (planned === null || planned === undefined) return stored === null || stored === undefined;
  if (stored === null || stored === undefined) return false;
  if (typeof planned === 'string' && typeof stored === 'string') {
    if (planned === stored) return true;
    if (STAMP.test(planned) && STAMP.test(stored)) {
      const a = Date.parse(planned); const b = Date.parse(stored);
      return Number.isFinite(a) && a === b;
    }
    return false;
  }
  if (typeof planned === 'number' || typeof stored === 'number') return Number(planned) === Number(stored);
  if (Array.isArray(planned)) {
    return Array.isArray(stored) && planned.length === stored.length && planned.every((v, i) => sameValue(v, stored[i]));
  }
  if (typeof planned === 'object') {
    if (typeof stored !== 'object' || Array.isArray(stored)) return false;
    const keys = new Set([...Object.keys(planned), ...Object.keys(stored)]);
    for (const k of keys) if (!sameValue(planned[k], stored[k])) return false;
    return true;
  }
  return planned === stored;
}

const key = (table, app, id) => `${table}|${app}|${id}`;

async function storedRows(db, table) {
  const { rows } = await db.query(`select to_jsonb(r) as j from ${q(SCHEMA)}.${q(ident(table))} r`);
  return rows.map((x) => (typeof x.j === 'string' ? JSON.parse(x.j) : x.j));
}

/** 1 and 2: counts, then field-by-field content for every planned column. */
export async function checkCountsAndContent({ db, landing }) {
  const byTable = new Map();
  for (const r of landing) {
    if (!byTable.has(r.table)) byTable.set(r.table, []);
    byTable.get(r.table).push(r);
  }
  const counts = {}; const content = { rows_compared: 0, mismatched: [] };
  for (const [table, planned] of byTable) {
    const stored = new Map((await storedRows(db, table)).map((j) => [key(table, j.source_app_id, j.id), j]));
    const apps = new Set(planned.map((p) => p.source_app_id));
    const present = planned.filter((p) => stored.has(key(table, p.source_app_id, p.id)));
    const extra = [...stored.values()].filter((j) => apps.has(j.source_app_id)).length - present.length;
    counts[table] = {
      planned: planned.length, present: present.length,
      missing: planned.length - present.length, unplanned_present: extra,
    };
    for (const p of present) {
      const j = stored.get(key(table, p.source_app_id, p.id));
      const columns = Object.keys(p.row).filter((c) => !sameValue(p.row[c], j[c]));
      content.rows_compared += 1;
      if (columns.length) content.mismatched.push({ table, id: p.id, columns: columns.sort() });
    }
  }
  return {
    counts,
    counts_ok: Object.values(counts).every((c) => c.missing === 0),
    content: { ...content, ok: content.mismatched.length === 0 },
  };
}

/**
 * 3: every `<name>_id` column that names another planned table must hold the id of a
 * row that exists there and, where both tables carry an agency, in the same one.
 * Pass `links` to name them yourself; otherwise they are inferred from column names.
 */
export function inferLinks(landing) {
  const tables = new Set(landing.map((r) => r.table));
  const found = new Map();
  for (const r of landing) {
    for (const column of Object.keys(r.row)) {
      const m = /^([a-z][a-z0-9_]*)_id$/.exec(column);
      if (m && tables.has(m[1]) && m[1] !== r.table && column !== 'agency_id') found.set(`${r.table}.${column}`, { table: r.table, column, target: m[1] });
    }
  }
  return [...found.values()].sort((a, b) => (`${a.table}.${a.column}` < `${b.table}.${b.column}` ? -1 : 1));
}

export async function checkLinks({ db, landing, links = inferLinks(landing) }) {
  const out = [];
  for (const link of links) {
    ident(link.table); ident(link.column); ident(link.target);
    const stored = await storedRows(db, link.table);
    const targets = new Map((await storedRows(db, link.target)).map((j) => [`${j.source_app_id}|${j.id}`, j]));
    let checked = 0; let dangling = 0; let cross_agency = 0;
    for (const j of stored) {
      if (j[link.column] === null || j[link.column] === undefined || j[link.column] === '') continue;
      checked += 1;
      const t = targets.get(`${j.source_app_id}|${j[link.column]}`);
      if (!t) dangling += 1;
      else if (j.agency_id != null && t.agency_id != null && j.agency_id !== t.agency_id) cross_agency += 1;
    }
    out.push({ ...link, checked, dangling, cross_agency });
  }
  return { links: { items: out, ok: out.every((l) => l.dangling === 0 && l.cross_agency === 0) } };
}

/**
 * 4: sign in as each identity (a caller supplies the claims; the rehearsal seeds
 * the identities) and read the agency-keyed tables through the real policies.
 * `identities` is [{ label, agency_id, claims }]. The store's callers run as the
 * `authenticated` role, which the rehearsal must be allowed to use.
 */
export async function checkVisibility({ db, landing, identities, tables }) {
  const agencyKeyed = [...new Set(landing.filter((r) => Object.hasOwn(r.row, 'agency_id') && tables.includes(r.table)).map((r) => r.table))];
  const planned = new Map();
  for (const r of landing) {
    if (!agencyKeyed.includes(r.table)) continue;
    if (!planned.has(r.table)) planned.set(r.table, []);
    planned.get(r.table).push(r);
  }
  const results = [];
  for (const who of identities) {
    for (const table of agencyKeyed) {
      const own = planned.get(table).filter((r) => r.row.agency_id === who.agency_id).map((r) => r.id).sort();
      const others = new Set(planned.get(table).filter((r) => r.row.agency_id !== who.agency_id).map((r) => r.id));
      let seen;
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.claims)]);
        await db.exec('set local role authenticated');
        seen = (await db.query(`select id from ${q(SCHEMA)}.${q(table)}`)).rows.map((x) => x.id);
      } finally { await db.exec('rollback'); }
      results.push({
        identity: who.label, table, expected: own.length,
        missing: own.filter((id) => !seen.includes(id)).length,
        leaked: seen.filter((id) => others.has(id)).length,
      });
    }
  }
  return { visibility: results, ok: results.every((r) => r.missing === 0 && r.leaked === 0) };
}

/**
 * 5: the plan's own arithmetic, then the source. `sourceIds` is an optional Map of
 * entity to every source row id the archive holds, read by the caller from the
 * export; with it, loaded plus quarantined must equal the source exactly.
 */
export async function checkQuarantine({ db, report, landing, tables = new Map(), sourceIds = null }) {
  const problems = [];
  const loadedBy = new Map(); const heldBy = new Map();
  for (const r of landing) { if (!loadedBy.has(r.entity)) loadedBy.set(r.entity, new Set()); loadedBy.get(r.entity).add(r.id); }
  for (const h of report.quarantine) { if (!heldBy.has(h.entity)) heldBy.set(h.entity, new Set()); heldBy.get(h.entity).add(h.id); }
  for (const l of report.loads) {
    const loaded = loadedBy.get(l.entity) ?? new Set(); const held = heldBy.get(l.entity) ?? new Set();
    if (loaded.size !== l.load) problems.push({ entity: l.entity, code: 'loaded_count_differs' });
    if (held.size !== l.quarantined) problems.push({ entity: l.entity, code: 'quarantined_count_differs' });
    if (l.load + l.quarantined !== l.rows) problems.push({ entity: l.entity, code: 'rows_not_accounted_for' });
    for (const id of held) if (loaded.has(id)) problems.push({ entity: l.entity, code: 'both_loaded_and_quarantined' });
    if (sourceIds) {
      const source = sourceIds.get(l.entity) ?? new Set();
      for (const id of source) if (!loaded.has(id) && !held.has(id)) problems.push({ entity: l.entity, code: 'source_row_unaccounted' });
      for (const id of [...loaded, ...held]) if (!source.has(id)) problems.push({ entity: l.entity, code: 'row_not_in_source' });
    }
    // A set-aside row must not have reached the store.
    const table = tables.get(l.entity) ?? l.table;
    if (held.size && table) {
      const present = new Set((await storedRows(db, table)).map((j) => j.id));
      for (const id of held) if (present.has(id)) problems.push({ entity: l.entity, code: 'quarantined_row_in_store' });
    }
  }
  return { quarantine: { problems, ok: problems.length === 0 } };
}

/** 6: each declared file's bytes against its declared sha256 and size. */
export function checkFiles({ files }) {
  const problems = files.filter((f) => sha(f.bytes) !== f.sha256 || f.bytes.length !== f.size).map((f) => ({ file: f.name, code: 'file_digest_differs' }));
  return { files: { checked: files.length, problems, ok: problems.length === 0 } };
}

export async function verifyRun({ db, report, landing, tables, identities = null, links, sourceIds = null, files = null }) {
  const names = new Map(report.loads.map((l) => [l.entity, l.table]));
  const out = {
    format: 'pennsync-record-mover-verification', version: 1, plan_digest: report.digest,
    ...(await checkCountsAndContent({ db, landing })),
    ...(await checkLinks({ db, landing, links })),
    ...(await checkQuarantine({ db, report, landing, tables: names, sourceIds })),
    visibility: identities ? await checkVisibility({ db, landing, identities, tables: [...tables] }) : { skipped: 'no_identities_given', ok: null },
    files: files ? checkFiles({ files }).files : { skipped: 'no_files_given', ok: null },
  };
  out.ok = [out.counts_ok, out.content.ok, out.links.ok, out.quarantine.ok, out.visibility.ok, out.files.ok].every((v) => v !== false);
  return out;
}
