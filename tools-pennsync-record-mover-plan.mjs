#!/usr/bin/env node
/**
 * The record mover's planner. It WRITES NOTHING.
 *
 * Step 2 of `base44-full-exit/record-mover-design-2026-10-02.md`. It reads an
 * export (a sealed archive, or for rehearsal an unsealed supplied-export
 * directory whose collections may be JSON lines or CSV) and says what a loader
 * would do: which rows land, in which waves, which are set aside and why, which
 * are only sealed. It opens no database, no network, and creates no file; its
 * only output is one JSON document on stdout.
 *
 * Decisions it enforces (design, "Decisions 2026-10-02"):
 * - JSON lines and CSV are both accepted, and the `id` column is REQUIRED in
 *   either. Base44's own docs do not say a dashboard export carries ids, so a
 *   file without one is refused with `id_column_missing`, never guessed at.
 * - The retired app's records are sealed and NOT loaded. Only the live app's
 *   source is planned for loading; the legacy source is reported as sealed.
 * - The archive key is read on the operator's machine from the same two
 *   channels the archive tool uses and goes nowhere: not a log, not a file, not
 *   the report. A test feeds a canary key through every path and searches for it.
 *
 * What it will not do: repair a value. A row that breaks a target rule is
 * quarantined with the COLUMN named, never the value; a name, address or any
 * field value never appears in the output, only ids, codes and counts.
 *
 * The report carries `rows_digest`, a hash over every landing row's canonical
 * form, which the verifier will recompute with its own code. `keepRows` makes
 * the library return the shaped rows for the loader; the CLI never does.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_SOURCE_APPS, readKey, withVerifiedArchive } from './tools-pennsync-archive.mjs';
import { CARRIED, SYSTEM_COLUMNS, TENANT_COLUMN, planAll, readSchemas } from './tools-entity-schema-plan.mjs';

export const FORMAT = 'pennsync-record-mover-plan';
export const LIVE_APP = ARCHIVE_SOURCE_APPS.production;
/**
 * Platform fields the export carries that the record table deliberately does not:
 * the authority store holds the address (identity map), and the carried profile
 * has no name column. Reported apart from real unknowns, because they are expected.
 */
export const HELD_ELSEWHERE = Object.freeze({ User: ['email', 'full_name'] });
const sha = (v) => createHash('sha256').update(v).digest('hex');
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export class PlanError extends Error { constructor(code) { super(code); this.code = code; } }
const need = (ok, code) => { if (!ok) throw new PlanError(code); };

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------- target spec

/** What the record store will accept, read from the same plan the migration is generated from. */
export function loadTargetSpec(repository) {
  const { plans, excluded } = planAll(repository);
  const entities = new Map();
  const systemNames = new Set(SYSTEM_COLUMNS.map((c) => c.name));
  for (const plan of plans) {
    const columns = new Map();
    for (const c of SYSTEM_COLUMNS) columns.set(c.name, { name: c.name, property: c.name, type: c.type });
    for (const c of plan.definition.columns) {
      // A stamped agency column has no property of its own: the export producer adds
      // the source agency under the same name, and the loader replaces it with the
      // mapped target. Named here so that is accepted rather than reported unknown.
      columns.set(c.name, { name: c.name, property: c.property ?? (c.stamped ? c.name : null), type: c.type, stamped: !!c.stamped });
    }
    const byProperty = new Map();
    for (const c of columns.values()) if (c.property) byProperty.set(c.property, c);
    const enums = new Map(plan.definition.checks.map((k) => [k.column, new Set(k.values)]));
    entities.set(plan.entity, {
      entity: plan.entity, table: plan.table, disposition: plan.disposition, columns, byProperty, enums,
      tenantKey: plan.tenant_key, systemNames,
    });
  }
  const dispositions = JSON.parse(readFileSync(join(repository, 'tools-transition-disposition.json'), 'utf8')).entities;
  const known = new Set(readSchemas(repository).map(([name]) => name));
  return { entities, dispositions, excluded, known };
}

// ------------------------------------------------------------------------ csv

/** Strict RFC 4180: quoted fields, doubled quotes, CRLF or LF; ragged rows and duplicate headers refused. */
export function parseCsv(text) {
  need(typeof text === 'string', 'csv_invalid');
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = []; let row = []; let cell = ''; let quoted = false; let i = 0; let seen = false;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i += 1; continue; }
      cell += c; i += 1; continue;
    }
    if (c === '"') { need(cell === '', 'csv_invalid'); quoted = true; seen = true; i += 1; continue; }
    if (c === ',') { row.push(cell); cell = ''; seen = true; i += 1; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      i += 1;
      if (seen || cell !== '' || row.length) { row.push(cell); rows.push(row); }
      row = []; cell = ''; seen = false; continue;
    }
    cell += c; seen = true; i += 1;
  }
  need(!quoted, 'csv_invalid');
  if (seen || cell !== '' || row.length) { row.push(cell); rows.push(row); }
  need(rows.length > 0, 'csv_empty');
  const header = rows[0];
  need(new Set(header).size === header.length && header.every((h) => h !== ''), 'csv_header_invalid');
  need(header.includes('id'), 'id_column_missing');
  return rows.slice(1).map((r) => {
    need(r.length === header.length, 'csv_ragged_row');
    return Object.fromEntries(header.map((h, k) => [h, r[k]]));
  });
}

/** CSV cells are text: put them back into the types the target column holds. Empty means absent. */
export function typedCsvRow(raw, entitySpec) {
  const out = {};
  for (const [field, text] of Object.entries(raw)) {
    const column = entitySpec.byProperty.get(field);
    const type = column?.type ?? 'text';
    if (text === '') { out[field] = null; continue; }
    if (type === 'jsonb') { try { out[field] = JSON.parse(text); } catch { out[field] = { __unparsed: true }; } continue; }
    if (type === 'boolean') { out[field] = text === 'true' ? true : text === 'false' ? false : text; continue; }
    if (type === 'bigint') { out[field] = /^-?\d+$/.test(text) ? Number(text) : text; continue; }
    if (type === 'double precision') { out[field] = Number.isFinite(Number(text)) ? Number(text) : text; continue; }
    out[field] = text;
  }
  return out;
}

// ------------------------------------------------------------------ row checks

function typeRefused(type, value) {
  if (value === null || value === undefined) return false;
  switch (type) {
    case 'text': return typeof value !== 'string';
    case 'bigint': return !Number.isSafeInteger(value);
    case 'double precision': return typeof value !== 'number' || !Number.isFinite(value);
    case 'boolean': return typeof value !== 'boolean';
    case 'date': return typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value));
    case 'timestamptz': return typeof value !== 'string' || Number.isNaN(Date.parse(value));
    case 'jsonb': return object(value) && value.__unparsed === true;
    default: return false;
  }
}

/** Shape one source row for the target table, or say which column refuses it. */
export function shapeRow(entitySpec, source, appId, agencyTarget) {
  const row = { source_app_id: appId };
  const unknown = []; const refused = [];
  for (const [field, value] of Object.entries(source)) {
    const column = entitySpec.byProperty.get(field);
    if (!column) { unknown.push(field); continue; }
    if (column.name === 'source_app_id') { unknown.push(field); continue; }
    if (typeRefused(column.type, value)) { refused.push({ column: column.name, code: 'column_type_refused' }); continue; }
    const allowed = entitySpec.enums.get(column.name);
    if (allowed && value !== null && value !== undefined && !allowed.has(value)) { refused.push({ column: column.name, code: 'column_value_refused' }); continue; }
    row[column.name] = value ?? null;
  }
  if (entitySpec.tenantKey && agencyTarget !== undefined) row[TENANT_COLUMN] = agencyTarget;
  return { row, unknown, refused };
}

// ------------------------------------------------------------------- planning

const REASON = {
  retire: 'retired_archive_only',
  hub: 'hub_not_loaded',
  preserved_paused: 'paused_not_loaded',
};

function waves(loadEntities, references) {
  const depth = new Map(); const visiting = new Set();
  const visit = (e) => {
    if (depth.has(e)) return depth.get(e);
    need(!visiting.has(e), 'reference_cycle');
    visiting.add(e);
    let d = 0;
    // Meaning, not just declared links: everything is stamped by an agency, and
    // everything but the agency list and the people is authored by one of them.
    const deps = new Set(references.get(e) ?? []);
    if (e !== 'Agency') deps.add('Agency');
    if (e !== 'Agency' && e !== 'User') deps.add('User');
    for (const dep of deps) if (loadEntities.has(dep) && dep !== e) d = Math.max(d, visit(dep) + 1);
    visiting.delete(e); depth.set(e, d); return d;
  };
  for (const e of loadEntities) visit(e);
  return depth;
}

/**
 * `readRows(descriptor)` yields row objects for one collection (already typed).
 * `enrolled` is a Set of target subjects, or null when enrolment is not known.
 */
export async function planRecords({ rawPlan, readRows, spec, enrolled = null, keepRows = false }) {
  const plan = JSON.parse(Buffer.from(rawPlan).toString('utf8'));
  need(plan?.format === 'pennsync-supplied-export' && Array.isArray(plan.collections), 'plan_invalid');
  const agencyMap = new Map(); const subjectOf = new Map();
  for (const m of await readRows(plan.agencies)) agencyMap.set(`${m.source_app_id}|${m.agency_id}`, m.target_agency_id);
  for (const m of await readRows(plan.identities)) subjectOf.set(`${m.source_app_id}|${m.user_id}`, m.target_subject);

  const loads = []; const sealed = []; const quarantine = []; const findingCount = new Map();
  const landing = []; const references = new Map();
  const emailToUser = new Map();
  const finding = (app, entity, code, field) => {
    const k = JSON.stringify([app, entity, code, field ?? null]);
    findingCount.set(k, (findingCount.get(k) ?? 0) + 1);
  };

  // Users first: author checks need email -> user id.
  const cache = new Map();
  const rowsOf = async (d) => { if (!cache.has(d.path)) cache.set(d.path, await readRows(d)); return cache.get(d.path); };
  for (const d of plan.collections.filter((c) => c.entity === 'User')) {
    for (const u of await rowsOf(d)) if (typeof u.email === 'string') emailToUser.set(`${d.source_app_id}|${u.email.toLowerCase()}`, u.id);
  }

  for (const d of plan.collections) {
    const entitySpec = spec.entities.get(d.entity);
    const disposition = spec.dispositions[d.entity];
    let reason = null;
    if (d.source_app_id !== LIVE_APP) reason = 'legacy_source_sealed';
    else if (!disposition) reason = 'no_disposition';
    else if (REASON[disposition]) reason = REASON[disposition];
    else if (!CARRIED.includes(disposition) || !entitySpec) reason = 'paused_no_table';
    else if (!CARRIED.includes(entitySpec.disposition)) reason = 'paused_not_loaded';
    if (reason) { sealed.push({ source_app_id: d.source_app_id, entity: d.entity, rows: d.rows, reason }); continue; }

    references.set(d.entity, new Set(d.references.map((r) => r.entity)));
    const agencyPointer = d.scope?.kind === 'agency' ? d.scope.pointer.slice(1) : null;
    let landed = 0; let held = 0;
    for (const source of await rowsOf(d)) {
      need(typeof source.id === 'string' && source.id !== '', 'id_column_missing');
      let agencyTarget;
      if (d.entity === 'Agency') agencyTarget = agencyMap.get(`${d.source_app_id}|${source.id}`);
      else if (agencyPointer) agencyTarget = agencyMap.get(`${d.source_app_id}|${source[agencyPointer]}`);
      const hold = (code, column) => { held += 1; quarantine.push({ source_app_id: d.source_app_id, entity: d.entity, id: source.id, code, ...(column ? { column } : {}) }); };
      if ((d.entity === 'Agency' || agencyPointer) && agencyTarget === undefined) { hold('agency_unmapped'); continue; }
      const shaped = shapeRow(entitySpec, source, d.source_app_id, agencyTarget);
      for (const f of shaped.unknown) {
        finding(d.source_app_id, d.entity, HELD_ELSEWHERE[d.entity]?.includes(f) ? 'field_held_elsewhere' : 'field_not_in_target', f);
      }
      if (shaped.refused.length) { hold(shaped.refused[0].code, shaped.refused[0].column); continue; }
      if (typeof source.created_by === 'string' && enrolled) {
        const uid = emailToUser.get(`${d.source_app_id}|${source.created_by.toLowerCase()}`);
        const subject = uid ? subjectOf.get(`${d.source_app_id}|${uid}`) : undefined;
        if (!uid) finding(d.source_app_id, d.entity, 'author_unknown');
        else if (!subject || !enrolled.has(subject)) finding(d.source_app_id, d.entity, 'author_not_enrolled');
      }
      landed += 1;
      landing.push({ entity: d.entity, table: entitySpec.table, source_app_id: d.source_app_id, id: source.id, row: shaped.row, hash: sha(canonical({ table: entitySpec.table, row: shaped.row })) });
    }
    need(landed + held === d.rows, 'row_count');
    loads.push({ entity: d.entity, table: entitySpec.table, source_app_id: d.source_app_id, rows: d.rows, load: landed, quarantined: held });
  }

  const depth = waves(new Set(loads.map((l) => l.entity)), references);
  for (const l of loads) l.wave = depth.get(l.entity);
  loads.sort((a, b) => a.wave - b.wave || (a.entity < b.entity ? -1 : 1));
  sealed.sort((a, b) => (a.source_app_id + a.entity < b.source_app_id + b.entity ? -1 : 1));
  quarantine.sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  const findings = [...findingCount].map(([k, count]) => {
    const [source_app_id, entity, code, field] = JSON.parse(k);
    return { source_app_id, entity, code, ...(field ? { field } : {}), count };
  }).sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  const hashes = landing.map((r) => `${r.table}|${r.source_app_id}|${r.id}|${r.hash}`).sort();
  const body = {
    format: FORMAT, version: 1, archive_plan_sha256: sha(rawPlan),
    enrolment_checked: enrolled !== null,
    waves: [...new Set(loads.map((l) => l.wave))].length,
    loads, sealed_only: sealed, quarantine,
    findings: findings.filter((f) => f.code !== 'field_held_elsewhere'),
    held_elsewhere: findings.filter((f) => f.code === 'field_held_elsewhere').map(({ code, ...rest }) => rest),
    totals: {
      to_load: loads.reduce((n, l) => n + l.load, 0), quarantined: quarantine.length,
      sealed_only_rows: sealed.reduce((n, s) => n + s.rows, 0),
    },
    rows_digest: sha(hashes.join('\n')),
  };
  const report = { ...body, digest: sha(canonical(body)) };
  return keepRows ? { report, landing } : { report };
}

// ------------------------------------------------------------------- readers

async function* lines(chunks) {
  let rest = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of chunks) {
    rest += decoder.decode(chunk, { stream: true });
    let at;
    while ((at = rest.indexOf('\n')) >= 0) { yield rest.slice(0, at); rest = rest.slice(at + 1); }
  }
  rest += decoder.decode();
  if (rest.trim() !== '') yield rest;
}
async function jsonLinesRows(chunks) {
  const rows = [];
  for await (const line of lines(chunks)) {
    if (line.trim() === '') continue;
    let v; try { v = JSON.parse(line); } catch { throw new PlanError('json_invalid'); }
    need(object(v), 'json_invalid'); rows.push(v);
  }
  return rows;
}

/** Rehearsal reader: an unsealed supplied-export directory, JSON lines or CSV per collection. */
export function directoryReader(inputDir, spec) {
  const root = resolve(inputDir);
  return async (d) => {
    need(typeof d.path === 'string' && !d.path.includes('..') && !d.path.startsWith('/'), 'path_invalid');
    const full = join(root, d.path);
    if (d.path.endsWith('.csv')) {
      const entitySpec = spec.entities.get(d.entity);
      return parseCsv(await readFile(full, 'utf8')).map((r) => (entitySpec ? typedCsvRow(r, entitySpec) : r));
    }
    async function* chunks() { for await (const c of createReadStream(full)) yield c; }
    return jsonLinesRows(chunks());
  };
}

export async function planFromDirectory({ inputDir, spec, enrolled = null, keepRows = false }) {
  const rawPlan = await readFile(join(resolve(inputDir), 'plan.json'));
  return planRecords({ rawPlan, readRows: directoryReader(inputDir, spec), spec, enrolled, keepRows });
}

/** Sealed reader: the archive is verified end to end first, and holds JSON lines only. */
export async function planFromArchive({ archiveDir, key, spec, enrolled = null, keepRows = false }) {
  return withVerifiedArchive({ archiveDir: resolve(archiveDir), key }, async ({ rawPlan, read }) => {
    const readRows = (d) => jsonLinesRows(read(d.path));
    return planRecords({ rawPlan, readRows, spec, enrolled, keepRows });
  });
}

// ----------------------------------------------------------------------- cli

export async function runPlanCli({ env = process.env, write = console.log, error = console.error, repository = dirname(fileURLToPath(import.meta.url)) } = {}) {
  let key;
  try {
    const spec = loadTargetSpec(repository);
    let enrolled = null;
    if (env.PENNSYNC_PLAN_ENROLLED_FILE) enrolled = new Set(JSON.parse(await readFile(resolve(env.PENNSYNC_PLAN_ENROLLED_FILE), 'utf8')));
    let result;
    if (env.PENNSYNC_PLAN_INPUT_DIR) {
      need(!env.PENNSYNC_ARCHIVE_KEY_BASE64 && !env.PENNSYNC_ARCHIVE_KEY_FD, 'usage');
      result = await planFromDirectory({ inputDir: env.PENNSYNC_PLAN_INPUT_DIR, spec, enrolled });
    } else {
      need(typeof env.PENNSYNC_ARCHIVE_DIR === 'string' && env.PENNSYNC_ARCHIVE_DIR !== '', 'usage');
      key = readKey(env);
      result = await planFromArchive({ archiveDir: env.PENNSYNC_ARCHIVE_DIR, key, spec, enrolled });
    }
    write(JSON.stringify(result.report, null, 2));
    return 0;
  } catch (e) {
    // The code is a fixed word; no path, value, or key material is ever echoed.
    error(`Record plan failed: ${e instanceof PlanError ? e.code : 'inputs did not validate'}.`);
    return 1;
  } finally { delete env.PENNSYNC_ARCHIVE_KEY_BASE64; key?.fill(0); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runPlanCli();
