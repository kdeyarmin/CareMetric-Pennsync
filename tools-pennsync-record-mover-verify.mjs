import { createHash } from 'node:crypto';
import { referenceTarget } from './tools-pennsync-record-mover-references.mjs';

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

/**
 * Compare one planned value with one stored value. Dates compare as instants.
 *
 * Types are compared, never coerced: the planner only lands a number in a numeric
 * column and a string in a text one, and `to_jsonb` hands both back with the same
 * JSON type, so a number equals only a number. Coercing (`Number("")` is 0,
 * `Number([])` is 0, `Number("0x10")` is 16) would report a wrong stored value as
 * content-equal, which is the one thing this check exists to catch.
 */
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
  if (typeof planned === 'number' || typeof stored === 'number') return typeof planned === 'number' && typeof stored === 'number' && planned === stored;
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

/** The plan's own canonical form, restated here so this module needs nothing from the planner. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** 0: the rows being checked are the rows the plan describes: every row hash, the aggregate digest and the report digest are recomputed here. */
export function checkPlanBinding({ report, landing }) {
  const problems = [];
  const { digest, ...body } = report ?? {};
  if (typeof digest !== 'string' || sha(canonical(body)) !== digest) problems.push({ code: 'report_digest_differs' });
  const lines = [];
  for (const r of landing) {
    if (r.hash !== sha(canonical({ table: r.table, row: r.row }))) problems.push({ code: 'row_hash_differs', table: r.table, id: r.id });
    lines.push(`${r.table}|${r.source_app_id}|${r.id}|${r.hash}`);
  }
  if (sha(lines.sort().join('\n')) !== report?.rows_digest) problems.push({ code: 'rows_digest_differs' });
  return { plan: { problems, ok: problems.length === 0 } };
}

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
 * Pass `links` to name them yourself (the archive plan names the target ENTITY of a
 * reference, not its column, so the column is inferred from the name by the rule the
 * rollback also uses, in `tools-pennsync-record-mover-references.mjs`, which removes the
 * usual `target_` / `related_` style prefixes); the result says which it used.
 */
export function inferLinks(landing) {
  const tables = new Set(landing.map((r) => r.table));
  const found = new Map();
  for (const r of landing) {
    for (const column of Object.keys(r.row)) {
      const target = referenceTarget(column, tables);
      if (target) found.set(`${r.table}.${column}`, { table: r.table, column, target });
    }
  }
  return [...found.values()].sort((a, b) => (`${a.table}.${a.column}` < `${b.table}.${b.column}` ? -1 : 1));
}

export async function checkLinks({ db, landing, links = null }) {
  const inferred = links === null;
  links ??= inferLinks(landing);
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
  return { links: { inferred, items: out, ok: out.every((l) => l.dangling === 0 && l.cross_agency === 0) } };
}

/**
 * 4: sign in as each identity (a caller supplies the claims; the rehearsal seeds the
 * identities) and read EVERY planned table through the real policies. A row's agency
 * is its own `agency_id`, or, where it has none, the agency of a row it links to or
 * that links to it (a document reaches its agency through its binding row, a visit
 * through its patient). A row whose agency cannot be worked out is `unclassified`:
 * it is read, never judged, and the table is listed so the result cannot read as
 * complete. `identities` is [{ label, agency_id, claims }]; the store's callers run as
 * the `authenticated` role.
 */
export async function checkVisibility({ db, landing, identities, tables, links = inferLinks(landing) }) {
  const planned = landing.filter((r) => tables.includes(r.table));
  const agencyOf = new Map(planned.map((r) => [key(r.table, r.source_app_id, r.id), r.row.agency_id ?? null]));
  const edges = [];
  for (const link of links) {
    for (const r of planned) {
      if (r.table !== link.table || !r.row[link.column]) continue;
      const parent = key(link.target, r.source_app_id, r.row[link.column]);
      if (agencyOf.has(parent)) edges.push([key(r.table, r.source_app_id, r.id), parent]);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [child, parent] of edges) {
      if (agencyOf.get(child) && !agencyOf.get(parent)) { agencyOf.set(parent, agencyOf.get(child)); changed = true; }
      else if (agencyOf.get(parent) && !agencyOf.get(child)) { agencyOf.set(child, agencyOf.get(parent)); changed = true; }
    }
  }
  const byTable = new Map();
  for (const r of planned) {
    if (!byTable.has(r.table)) byTable.set(r.table, []);
    byTable.get(r.table).push({ id: r.id, agency: agencyOf.get(key(r.table, r.source_app_id, r.id)) });
  }
  const results = [];
  for (const who of identities) {
    for (const [table, rows] of byTable) {
      const own = rows.filter((x) => x.agency === who.agency_id).map((x) => x.id).sort();
      const others = new Set(rows.filter((x) => x.agency && x.agency !== who.agency_id).map((x) => x.id));
      let seen;
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.claims)]);
        await db.exec('set local role authenticated');
        seen = (await db.query(`select id from ${q(SCHEMA)}.${q(ident(table))}`)).rows.map((x) => x.id);
      } finally { await db.exec('rollback'); }
      results.push({
        identity: who.label, table, expected: own.length,
        missing: own.filter((id) => !seen.includes(id)).length,
        leaked: seen.filter((id) => others.has(id)).length,
      });
    }
  }
  const unclassified = [...byTable].filter(([, rows]) => rows.some((x) => !x.agency)).map(([table]) => table).sort();
  return { visibility: { visibility: results, unclassified_tables: unclassified, ok: results.every((r) => r.missing === 0 && r.leaked === 0) } };
}

/**
 * 5: the plan's own arithmetic, then the source. `sourceIds` is an optional Map of
 * entity to every source row id the archive holds, read by the caller from the
 * export; with it, loaded plus quarantined must equal the source exactly.
 */
export async function checkQuarantine({ db, report, landing, tables = new Map(), sourceIds = null }) {
  const problems = [];
  const loadedBy = new Map(); const heldBy = new Map();
  const ident2 = (app, id) => `${app}|${id}`;
  for (const r of landing) { if (!loadedBy.has(r.entity)) loadedBy.set(r.entity, new Set()); loadedBy.get(r.entity).add(ident2(r.source_app_id, r.id)); }
  for (const h of report.quarantine) { if (!heldBy.has(h.entity)) heldBy.set(h.entity, new Set()); heldBy.get(h.entity).add(ident2(h.source_app_id, h.id)); }
  for (const l of report.loads) {
    const loaded = loadedBy.get(l.entity) ?? new Set(); const held = heldBy.get(l.entity) ?? new Set();
    if (loaded.size !== l.load) problems.push({ entity: l.entity, code: 'loaded_count_differs' });
    if (held.size !== l.quarantined) problems.push({ entity: l.entity, code: 'quarantined_count_differs' });
    if (l.load + l.quarantined !== l.rows) problems.push({ entity: l.entity, code: 'rows_not_accounted_for' });
    for (const id of held) if (loaded.has(id)) problems.push({ entity: l.entity, code: 'both_loaded_and_quarantined' });
    if (sourceIds) {
      // sourceIds holds `source_app_id|id` strings per entity.
      const source = sourceIds.get(l.entity) ?? new Set();
      for (const id of source) if (!loaded.has(id) && !held.has(id)) problems.push({ entity: l.entity, code: 'source_row_unaccounted' });
      for (const id of [...loaded, ...held]) if (!source.has(id)) problems.push({ entity: l.entity, code: 'row_not_in_source' });
    }
    // A set-aside row must not have reached the store.
    const table = tables.get(l.entity) ?? l.table;
    if (held.size && table) {
      const present = new Set((await storedRows(db, table)).map((j) => ident2(j.source_app_id, j.id)));
      for (const id of held) if (present.has(id)) problems.push({ entity: l.entity, code: 'quarantined_row_in_store' });
    }
  }
  return { quarantine: { problems, ok: problems.length === 0 } };
}

/** 6: each declared file's bytes against its declared sha256 and size. Files are named by position and digest, never by name: a name can carry a person's. */
export function checkFiles({ files }) {
  const problems = [];
  files.forEach((f, index) => {
    if (sha(f.bytes) !== f.sha256 || f.bytes.length !== f.size) problems.push({ file_index: index, declared_sha256: String(f.sha256).slice(0, 12), code: 'file_digest_differs' });
  });
  return { files: { checked: files.length, problems, ok: problems.length === 0 } };
}

/**
 * `ok` means every check ran and passed. A check that was not given what it needs is
 * `skipped`, and a skipped check is not a pass: `ok` stays false and `incomplete` says
 * which. To leave one out on purpose, name it in `skip`; the waiver is recorded.
 * `acknowledgeUnclassified` names tables whose rows have no agency to judge them by
 * (for example the roster table, which the store tenants through memberships).
 */
export async function verifyRun({ db, report, landing, tables, identities = null, links = null, sourceIds = null, files = null, skip = [], acknowledgeUnclassified = [] }) {
  const names = new Map(report.loads.map((l) => [l.entity, l.table]));
  const out = {
    format: 'pennsync-record-mover-verification', version: 1, plan_digest: report.digest,
    ...checkPlanBinding({ report, landing }),
    ...(await checkCountsAndContent({ db, landing })),
    ...(await checkLinks({ db, landing, links })),
    ...(await checkQuarantine({ db, report, landing, tables: names, sourceIds })),
  };
  out.visibility = identities
    ? (await checkVisibility({ db, landing, identities, tables: [...tables], links: links ?? inferLinks(landing) })).visibility
    : { skipped: 'no_identities_given', ok: null };
  out.files = files ? checkFiles({ files }).files : { skipped: 'no_files_given', ok: null };
  const loose = out.visibility.unclassified_tables?.filter((t) => !acknowledgeUnclassified.includes(t)) ?? [];
  const incomplete = [];
  if (out.visibility.ok === null && !skip.includes('visibility')) incomplete.push('visibility');
  if (out.files.ok === null && !skip.includes('files')) incomplete.push('files');
  if (loose.length) incomplete.push('visibility_unclassified_tables');
  if (!sourceIds && !skip.includes('source')) incomplete.push('source');
  out.skipped_on_purpose = skip;
  out.incomplete = incomplete;
  out.ok = incomplete.length === 0 && [out.plan.ok, out.counts_ok, out.content.ok, out.links.ok, out.quarantine.ok, out.visibility.ok, out.files.ok].every((v) => v !== false);
  return out;
}
