#!/usr/bin/env node
/**
 * The record mover's agency-stamping step. It runs BEFORE sealing.
 *
 * Step 2b of `base44-full-exit/record-mover-design-2026-10-02.md`. 85 of the
 * carried tables have their agency stamped by the store because the Base44
 * schema names none, and 62 more have no agency column and reach theirs through
 * a parent. A Base44 export of those entities therefore carries no agency, and
 * the archive tool (unchanged) refuses a tenant record without one. This step
 * adds it, from the same export files, so it also serves the CSV route.
 *
 * It never guesses. Each entity has a rule in
 * `tools-pennsync-record-mover-agency-rules.json`, a reviewed file and not code:
 *
 *   declared    the row carries its own agency; checked against the agency map
 *   parent      the agency of the row it points at (a column and an entity, or
 *               the document binding table); `fallback: "constant"` lets a row
 *               whose parent column is EMPTY take the single agency
 *   constant    the whole export is one agency; valid only when the agency map
 *               names exactly one agency for that source app, else every row is held
 *   agency_list the agency list itself
 *   owner/none  not agency data (per-person rows, global reference tables)
 *
 * It never derives an agency from who created or touched a row: a person's
 * agency changes over time and the row does not. A row whose agency cannot be
 * derived is HELD, in a separate directory, and reported by entity and code,
 * never by value. It is not sealed, because the archive cannot hold it.
 *
 * This is the only mover step that writes files: a NEW output directory, created
 * exclusively. Rules are checked against the schema plan by `deriveRules`, and a
 * test fails if the committed file and the derivation disagree.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANT_COLUMN, planAll } from './tools-entity-schema-plan.mjs';
import { BINDING_TENANCY, buildPaths, normalize, readEntity, referenceColumns } from './tools-tenant-path.mjs';
import { directoryReader, loadTargetSpec, PlanError } from './tools-pennsync-record-mover-plan.mjs';

export const RULES_FILE = 'tools-pennsync-record-mover-agency-rules.json';
export const RULES_FORMAT = 'pennsync-record-mover-agency-rules';
export const RULES = Object.freeze(['declared', 'parent', 'constant', 'agency_list', 'owner', 'none']);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const need = (ok, code) => { if (!ok) throw new PlanError(code); };

/** The rules the schema plan implies. The committed file must equal this. */
export function deriveRules(repository) {
  const { plans } = planAll(repository);
  const paths = new Map(buildPaths(repository).entities.map((e) => [e.entity, e]));
  const decisions = JSON.parse(readFileSync(join(repository, 'tools-tenant-decision.json'), 'utf8')).entities ?? {};
  const byNormalized = new Map(plans.map((p) => [normalize(p.entity), p.entity]));
  const entities = {};
  for (const plan of plans) {
    const name = plan.entity;
    const column = plan.definition.columns.find((c) => c.name === TENANT_COLUMN);
    const decision = decisions[name]?.kind ?? null;
    const path = paths.get(name);
    if (name === 'Agency') entities[name] = { rule: 'agency_list' };
    else if (BINDING_TENANCY[name]) entities[name] = { rule: 'parent', binding: BINDING_TENANCY[name].source, column: BINDING_TENANCY[name].via };
    // Decisions first: User declares an agency_id that is a self-editable label (D23)
    // and must never be read as authority, so its decision outranks its column.
    else if (decision === 'global') entities[name] = { rule: 'none', reason: 'global reference data is written by migration and never moved from Base44 (D83)' };
    else if (decision === 'roster') entities[name] = { rule: 'none', reason: 'membership in the authority store decides who is on the roster (D23)' };
    else if (decision === 'self') entities[name] = { rule: 'owner', reason: 'a per-person row; its owner is the person\'s mapped subject, not an agency (D13)' };
    else if (column && !column.stamped) entities[name] = { rule: 'declared' };
    else if (!column && path?.kind === 'reference') entities[name] = { rule: 'parent', column: path.via, parent: path.target };
    else if (column?.stamped) {
      const refs = referenceColumns(readEntity(repository, name).properties ?? {}, byNormalized);
      const chosen = refs.find((r) => r.column === plan.chart_subject) ?? refs[0];
      entities[name] = chosen ? { rule: 'parent', column: chosen.column, parent: chosen.target, fallback: 'constant' } : { rule: 'constant' };
    } else throw new Error(`NO_AGENCY_RULE:${name}`);
  }
  return { format: RULES_FORMAT, version: 1, entities: Object.fromEntries(Object.entries(entities).sort(([a], [b]) => (a < b ? -1 : 1))) };
}

export function readRules(repository) {
  const rules = JSON.parse(readFileSync(join(repository, RULES_FILE), 'utf8'));
  need(rules.format === RULES_FORMAT && rules.version === 1 && rules.entities, 'rules_invalid');
  for (const r of Object.values(rules.entities)) need(RULES.includes(r.rule), 'rules_invalid');
  return rules;
}

/**
 * Stamp one collection. `lookup` maps `app|Entity|id` to the source agency id of
 * rows already resolved; `agencies` is the source agency ids the map names for
 * this source app. Returns the rows to seal and the rows held.
 */
export function stampCollection({ entity, rule, rows, appId, agencies, lookup, bindingKeys = new Map() }) {
  const stamped = []; const held = [];
  const hold = (row, code) => held.push({ row, code });
  const only = agencies.length === 1 ? agencies[0] : null;
  for (const row of rows) {
    need(typeof row.id === 'string' && row.id !== '', 'id_column_missing');
    let agency = null; let code = null;
    const given = typeof row[TENANT_COLUMN] === 'string' && row[TENANT_COLUMN] !== '' ? row[TENANT_COLUMN] : null;
    if (rule.rule === 'agency_list') agency = row.id;
    else if (rule.rule === 'declared') { agency = given; if (!agency) code = 'agency_missing'; }
    else if (rule.rule === 'constant') { agency = only; if (!agency) code = 'constant_ambiguous'; }
    else if (rule.rule === 'parent') {
      // A binding rule asks the binding table about THIS row's id; any other
      // parent rule asks the row it points at.
      const parentId = rule.binding ? row.id : row[rule.column];
      if (typeof parentId === 'string' && parentId !== '') {
        const bound = rule.binding ? `${appId}|${rule.binding}#${rule.column}|${parentId}` : `${appId}|${rule.parent}|${parentId}`;
        agency = lookup.get(bound) ?? null;
        if (!agency) code = 'parent_missing';
      } else if (rule.fallback === 'constant') { agency = only; if (!agency) code = 'constant_ambiguous'; }
      else code = 'parent_empty';
    } else { stamped.push(row); continue; }
    if (!code && !agencies.includes(agency)) code = 'agency_unknown';
    // A stamped column that disagrees with the derivation is a defect, not an absence.
    if (!code && given && rule.rule !== 'declared' && given !== agency) code = 'agency_conflict';
    if (code) { hold(row, code); continue; }
    lookup.set(`${appId}|${entity}|${row.id}`, agency);
    const via = bindingKeys.get(entity);
    if (via && typeof row[via] === 'string') lookup.set(`${appId}|${entity}#${via}|${row[via]}`, agency);
    stamped.push(rule.rule === 'agency_list' ? row : { ...row, [TENANT_COLUMN]: agency });
  }
  return { stamped, held };
}

function order(entities, rules) {
  const depth = new Map(); const seen = new Set();
  const visit = (e) => {
    if (depth.has(e)) return depth.get(e);
    need(!seen.has(e), 'reference_cycle'); seen.add(e);
    const r = rules[e]; let d = 0;
    for (const dep of [r?.rule === 'parent' ? (r.binding ?? r.parent) : null].filter(Boolean)) {
      if (entities.has(dep) && dep !== e) d = Math.max(d, visit(dep) + 1);
    }
    seen.delete(e); depth.set(e, d); return d;
  };
  for (const e of entities) visit(e);
  return [...entities].sort((a, b) => depth.get(a) - depth.get(b) || (a < b ? -1 : 1));
}

const jsonl = (rows) => (rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : '');

/** Read a supplied-export directory and write a stamped copy beside it. `outputDir` must not exist. */
export async function stampExportDirectory({ inputDir, outputDir, rules, spec }) {
  const plan = JSON.parse(await readFile(join(resolve(inputDir), 'plan.json'), 'utf8'));
  const read = directoryReader(inputDir, spec);
  // Every input is checked against the descriptor the export declared before it is used,
  // so a changed or truncated file cannot be re-described and sealed as if it were the original.
  const verify = async (d) => {
    const raw = await readFile(join(resolve(inputDir), d.path));
    need(d.sha256 === sha(raw) && d.bytes === raw.length, 'input_descriptor_mismatch');
    return raw;
  };
  for (const d of [plan.identities, plan.agencies, ...plan.files, ...plan.collections]) await verify(d);
  const agencyRows = await read(plan.agencies);
  const agencies = new Map();
  for (const m of agencyRows) { const l = agencies.get(m.source_app_id) ?? []; l.push(m.agency_id); agencies.set(m.source_app_id, l); }
  // The output holds unencrypted records until it is sealed: owner-only, like the archive paths.
  await mkdir(resolve(outputDir), { mode: 0o700 });
  await mkdir(join(resolve(outputDir), 'held'), { mode: 0o700 });
  const out = resolve(outputDir);
  const put = (path, data) => writeFile(path, data, { flag: 'wx', mode: 0o600 });
  const bindingKeys = new Map(Object.values(rules.entities).filter((r) => r.binding).map((r) => [r.binding, r.column]));
  const lookup = new Map(); const report = []; const next = structuredClone(plan);
  const byApp = new Map();
  for (const c of plan.collections) { const l = byApp.get(c.source_app_id) ?? []; l.push(c); byApp.set(c.source_app_id, l); }
  for (const [appId, collections] of byApp) {
    const names = new Map(collections.map((c) => [c.entity, c]));
    for (const entity of order(new Set(names.keys()), rules.entities)) {
      const c = names.get(entity);
      const rule = rules.entities[entity];
      need(rule, 'rule_missing');
      const { stamped, held } = stampCollection({ entity, rule, rows: await read(c), appId, agencies: agencies.get(appId) ?? [], lookup, bindingKeys });
      const target = next.collections.find((x) => x.source_app_id === appId && x.entity === entity);
      const tenant = ['declared', 'parent', 'constant'].includes(rule.rule);
      const path = c.path.replace(/\.csv$/, '.jsonl');
      const text = jsonl(stamped);
      await put(join(out, path), text);
      Object.assign(target, { path, bytes: Buffer.byteLength(text), sha256: sha(text), rows: stamped.length });
      if (tenant && !c.fields.includes(TENANT_COLUMN)) target.fields = [...c.fields, TENANT_COLUMN];
      if (tenant) target.scope = { kind: 'agency', pointer: `/${TENANT_COLUMN}` };
      if (held.length) await put(join(out, 'held', path), jsonl(held.map((h) => h.row)));
      const codes = {};
      for (const h of held) codes[h.code] = (codes[h.code] ?? 0) + 1;
      report.push({ source_app_id: appId, entity, rule: rule.rule, stamped: stamped.length, held: held.length, ...(held.length ? { held_codes: codes } : {}) });
    }
  }
  for (const d of [plan.identities, plan.agencies, ...plan.files]) await put(join(out, d.path), await verify(d));
  await put(join(out, 'plan.json'), JSON.stringify(next, null, 2));
  return { report, held_total: report.reduce((n, r) => n + r.held, 0) };
}

export async function runStampCli({ env = process.env, write = console.log, error = console.error, repository = dirname(fileURLToPath(import.meta.url)) } = {}) {
  try {
    need(env.PENNSYNC_STAMP_INPUT_DIR && env.PENNSYNC_STAMP_OUTPUT_DIR, 'usage');
    const result = await stampExportDirectory({ inputDir: env.PENNSYNC_STAMP_INPUT_DIR, outputDir: env.PENNSYNC_STAMP_OUTPUT_DIR, rules: readRules(repository), spec: loadTargetSpec(repository) });
    write(JSON.stringify(result, null, 2)); return 0;
  } catch (e) {
    error(`Agency stamping failed: ${e instanceof PlanError ? e.code : 'inputs did not validate'}.`); return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repository = dirname(fileURLToPath(import.meta.url));
  if (process.argv[2] === '--write-rules') {
    await writeFile(join(repository, RULES_FILE), `${JSON.stringify(deriveRules(repository), null, 2)}\n`);
    console.log(JSON.stringify({ written: RULES_FILE }));
  } else process.exitCode = await runStampCli();
}
