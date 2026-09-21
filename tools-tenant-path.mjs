#!/usr/bin/env node
/**
 * How each carried entity's owning agency is reached.
 *
 * `tools-entity-schema-plan.mjs` gives the 150 carried entities tables with
 * forced row level security and no policy. Writing those policies needs one
 * fact per table that the schema alone does not supply: which column proves
 * the row belongs to the agency asking for it. Only 15 entities carry
 * `agency_id` themselves, so the rest must reach a tenant through a reference,
 * or else be named as a decision. That gap is the tenant-isolation blocker the
 * release checklist describes; this turns it from an unbounded question into a
 * bounded list.
 *
 * The resolution is deliberately conservative about what counts as authority:
 *
 * - `Agency` is the tenant root; it is its own key.
 * - `agency_id` on a record the subject cannot edit is a `direct` key.
 * - `agency_id` on a self-editable profile is a `profile_claim`, never a key.
 *   A signed-in account can rewrite its own profile, so authorizing from it
 *   would let a caller choose its own tenant. This repository has already
 *   paused one endpoint for exactly that defect.
 * - A reference column resolves only through another entity that is itself
 *   `root`, `direct` or `reference`, AND only when the schema REQUIRES that
 *   column. A path through a profile claim or an actor column inherits its
 *   weakness and is not a path; a path the schema allows to be absent is not a
 *   path either, because a row with a null there is in no tenant and no policy
 *   can admit it — thirteen carried entities were in that state until D61
 *   measured it, and one of them was found the hard way, by porting a
 *   capability that writes such a row.
 * - An entity whose only tenancy signal is who touched the row is `actor`, and
 *   one with no signal at all is `unresolved`. Both need an owner's decision;
 *   neither is a key, because a person's agency changes over time while the
 *   row does not.
 *
 * It is offline and deterministic, reads only committed definitions, and
 * decides nothing: naming the shortest honest path is not approving it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import { CARRIED, DISPOSITION_FILE, ENTITY_DIRECTORY, TENANT_COLUMN } from './tools-entity-schema-plan.mjs';

export const FORMAT = 'pennsync-tenant-path';
export const FORMAT_VERSION = 1;
export const EXPECTATIONS_FILE = 'tools-tenant-path-expectations.json';
/** The column that names an agency directly; defined with the schema plan that emits it. */
export { TENANT_COLUMN };
/** The tenant root: it does not reference an agency, it is one. */
export const ROOT_ENTITY = 'Agency';
/**
 * Records whose subject can edit them. Their `agency_id` is a claim the caller
 * makes about itself, so it can describe a row but never authorize one.
 */
export const SELF_EDITABLE = Object.freeze(['User']);
/**
 * Columns naming the acting or owning account rather than a tenant: an action
 * attribution (`approved_by`, `created_by_user_id`, `updated_by_email`) or the
 * row's own user (`user_id`, `user_email`). A column naming some other person,
 * such as `provider_email` or `nurse_email`, is a subject of the record and is
 * deliberately not counted; nor is a display name, which identifies nobody.
 */
export const ACTOR_PATTERN = /(^|_)by(_user_id|_email|_id)?$|^user_(id|email)$|_user_email$/;
export const KINDS = Object.freeze([
  'root', 'direct', 'reference', 'binding', 'actor', 'profile_claim', 'unresolved']);
/** Kinds a reference may resolve through. */
export const RESOLVING_KINDS = Object.freeze(['root', 'direct', 'reference', 'binding']);
/**
 * Entities whose tenancy is carried by a table that points AT them, rather
 * than by a column they hold (D27).
 *
 * `Document` is the case that produced this kind and so far the only one. It
 * has no `agency_id`, so a path resolver following the columns the row holds
 * finds `patient_id` and reaches `Patient` — which reads as tenancy and is
 * not. A document bound to an agency and no patient, which is what a referral
 * document is before an intake becomes a patient, then belongs to nobody and
 * is invisible to everyone including an agency administrator.
 * `DocumentTenantBinding` is what actually says which agency a document is in;
 * the name says so, and both authorized-read originals read it for exactly
 * that while treating `document.patient_id` as a denormalized copy to
 * cross-check rather than to trust.
 *
 * DECLARED, never inferred. "Some carried table references me and has an
 * agency" is true of dozens of tables, and inferring from it would let any of
 * them authorize the row — including one a caller can write. Each entry is a
 * positive claim, and `buildPaths` re-checks every part of it against the
 * schemas: the source must be carried, must resolve to its own `agency_id`,
 * must actually carry the named column, and the entity itself must not have an
 * `agency_id` of its own to use instead.
 */
export const BINDING_TENANCY = Object.freeze({
  Document: Object.freeze({
    source: 'DocumentTenantBinding',
    via: 'document_id',
    because: 'D27. A document has no agency of its own; the binding carries it, '
      + 'and a document bound to an agency and no patient is otherwise invisible to everyone.',
  }),
});
/** Kinds that leave a table without a usable policy predicate. */
export const BLOCKING_KINDS = Object.freeze(['actor', 'profile_claim', 'unresolved']);

/** Compare entity names ignoring case and separators: `OASISAssessment` matches `oasis_assessment`. */
export const normalize = value => String(value).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();

export function readEntity(repository, name) {
  for (const extension of ['.jsonc', '.json']) {
    const path = join(repository, ENTITY_DIRECTORY, `${name}${extension}`);
    if (existsSync(path)) return JSON5.parse(readFileSync(path, 'utf8'));
  }
  throw new Error(`ENTITY_UNREADABLE:${name}`);
}

export function carriedEntities(repository) {
  const dispositions = JSON.parse(readFileSync(join(repository, DISPOSITION_FILE), 'utf8')).entities;
  return Object.keys(dispositions).filter(name => CARRIED.includes(dispositions[name])).sort();
}

export function isActorColumn(column) {
  return ACTOR_PATTERN.test(String(column));
}

/**
 * Reference columns, in the deterministic order a tie is broken: a column
 * `x_id` points at the carried entity whose name matches `x`, if one exists.
 */
export function referenceColumns(properties, byNormalized) {
  const references = [];
  for (const column of Object.keys(properties).sort()) {
    if (!column.endsWith('_id') || column === TENANT_COLUMN || isActorColumn(column)) continue;
    const target = byNormalized.get(normalize(column.slice(0, -3)));
    if (target) references.push({ column, target });
  }
  return references;
}

/**
 * Resolve the declared binding claims, before any reference hop.
 *
 * Before, because the whole point is that the reference path is the wrong
 * answer — `Document` would otherwise reach `Patient` through `patient_id`.
 * Every part of a claim is checked here rather than trusted, and one that does
 * not hold throws instead of falling back to the path it was written to
 * replace: a silent fallback would restore the defect the moment the claim
 * stopped being true, which is the one failure mode a declaration like this
 * has.
 */
export function applyBindingTenancy({ resolved, names, properties }, claims = BINDING_TENANCY) {
  for (const [name, claim] of Object.entries(claims)) {
    if (!names.includes(name)) throw new Error(`BINDING_TENANCY_NOT_CARRIED:${name}`);
    // An entity with an `agency_id` of its own is already resolved, and a
    // claim on it would replace a direct key with a join.
    if (resolved.has(name)) throw new Error(`BINDING_TENANCY_HAS_OWN_TENANT:${name}`);
    if (!names.includes(claim.source)) throw new Error(`BINDING_SOURCE_NOT_CARRIED:${name}`);
    const source = resolved.get(claim.source);
    // The source must carry its own agency. Anything else moves the question
    // one table along rather than answering it.
    if (!source || source.kind !== 'direct') throw new Error(`BINDING_SOURCE_NOT_DIRECT:${name}`);
    if (!Object.hasOwn(properties.get(claim.source) || {}, claim.via)) {
      throw new Error(`BINDING_SOURCE_COLUMN_MISSING:${name}:${claim.via}`);
    }
    resolved.set(name, {
      kind: 'binding', via: claim.via, target: claim.source, depth: source.depth + 1,
    });
  }
  return resolved;
}

export function buildPaths(repository) {
  const names = carriedEntities(repository);
  const byNormalized = new Map(names.map(name => [normalize(name), name]));
  const schemas = new Map(names.map(name => [name, readEntity(repository, name)]));
  const properties = new Map(names.map(name => [name, schemas.get(name).properties || {}]));
  // A column the schema does not require can be null, and a null reference is
  // not a tenancy — it is a row in no tenant at all. See `referenceColumns`.
  const required = new Map(names.map(name => [name, new Set(schemas.get(name).required || [])]));
  const resolved = new Map();

  for (const name of names) {
    const own = properties.get(name);
    if (name === ROOT_ENTITY) resolved.set(name, { kind: 'root', via: null, target: null, depth: 0 });
    else if (Object.hasOwn(own, TENANT_COLUMN)) {
      resolved.set(name, SELF_EDITABLE.includes(name)
        ? { kind: 'profile_claim', via: TENANT_COLUMN, target: null, depth: null }
        : { kind: 'direct', via: TENANT_COLUMN, target: null, depth: 1 });
    }
  }

  applyBindingTenancy({ resolved, names, properties });

  // Widen by one reference hop at a time so every path recorded is a shortest
  // one, and so a cycle simply never resolves instead of looping.
  for (let changed = true; changed;) {
    changed = false;
    for (const name of names) {
      if (resolved.has(name)) continue;
      const candidates = referenceColumns(properties.get(name), byNormalized)
        // The column must be one the schema REQUIRES. A reference the schema
        // allows to be absent leaves rows that no policy can admit, which is
        // the orphan class D61 measured and closed.
        .filter(reference => required.get(name).has(reference.column))
        .map(reference => ({ ...reference, resolvedTarget: resolved.get(reference.target) }))
        .filter(reference => reference.resolvedTarget && RESOLVING_KINDS.includes(reference.resolvedTarget.kind));
      if (!candidates.length) continue;
      candidates.sort((a, b) => a.resolvedTarget.depth - b.resolvedTarget.depth
        || (a.column < b.column ? -1 : 1));
      const best = candidates[0];
      resolved.set(name, { kind: 'reference', via: best.column, target: best.target, depth: best.resolvedTarget.depth + 1 });
      changed = true;
    }
  }

  for (const name of names) {
    if (resolved.has(name)) continue;
    const actor = Object.keys(properties.get(name)).sort().find(isActorColumn);
    resolved.set(name, actor
      ? { kind: 'actor', via: actor, target: null, depth: null }
      : { kind: 'unresolved', via: null, target: null, depth: null });
  }

  const entities = names.map(name => ({ entity: name, ...resolved.get(name) }));
  const counts = Object.fromEntries(KINDS.map(kind => [kind, entities.filter(entry => entry.kind === kind).length]));
  const depths = entities.map(entry => entry.depth).filter(depth => Number.isSafeInteger(depth));
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    // Naming a path is not approving it, and no policy is written anywhere.
    reviewed: false,
    policies_written: false,
    entities,
    totals: {
      carried: entities.length,
      ...counts,
      max_depth: depths.length ? Math.max(...depths) : 0,
      blocking: entities.filter(entry => BLOCKING_KINDS.includes(entry.kind)).length,
    },
  };
}

export function comparePaths(current, expectations) {
  const before = new Map(expectations.entities.map(entry => [entry.entity, entry]));
  const after = new Map(current.entities.map(entry => [entry.entity, entry]));
  const same = (a, b) => a.kind === b.kind && a.via === b.via && a.target === b.target && a.depth === b.depth;
  const added = [...after.keys()].filter(name => !before.has(name)).sort();
  const removed = [...before.keys()].filter(name => !after.has(name)).sort();
  const changed = [...after.keys()].filter(name => before.has(name) && !same(after.get(name), before.get(name))).sort();
  return { added, removed, changed, matches_expectations: !added.length && !removed.length && !changed.length };
}

export function parseExpectations(raw) {
  let expectations;
  try { expectations = JSON.parse(raw); } catch { throw new Error('PATHS_INVALID_JSON'); }
  if (!expectations || typeof expectations !== 'object' || Array.isArray(expectations)) throw new Error('PATHS_INVALID_SHAPE');
  if (expectations.format !== FORMAT || expectations.schema_version !== FORMAT_VERSION) throw new Error('PATHS_UNSUPPORTED_FORMAT');
  if (!Array.isArray(expectations.entities)) throw new Error('PATHS_INVALID_ENTITIES');
  for (const entry of expectations.entities) {
    if (typeof entry?.entity !== 'string' || !KINDS.includes(entry?.kind)) throw new Error('PATHS_INVALID_ENTITIES');
  }
  return expectations;
}

export function main(args = process.argv.slice(2), { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync } = {}) {
  if (args.some(argument => !['--json', '--summary', '--update', '--blocking'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let paths;
  try { paths = buildPaths(repository); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'ENTITY_SCHEMAS_UNAVAILABLE' })); return 2; }
  if (args.includes('--blocking')) {
    for (const entry of paths.entities.filter(item => BLOCKING_KINDS.includes(item.kind))) {
      log(`${entry.kind}\t${entry.entity}\t${entry.via || '-'}`);
    }
    return 0;
  }
  const expectationsPath = join(repository, EXPECTATIONS_FILE);
  if (args.includes('--update')) {
    write(expectationsPath, JSON.stringify(paths, null, 2) + '\n');
    log(JSON.stringify({ updated: EXPECTATIONS_FILE, totals: paths.totals }, null, 2));
    return 0;
  }
  let expectations;
  try { expectations = parseExpectations(readFileSync(expectationsPath, 'utf8')); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'PATHS_UNAVAILABLE' })); return 2; }
  const report = comparePaths(paths, expectations);
  if (args.includes('--summary')) {
    const { totals } = paths;
    log(`tenant paths ${report.matches_expectations ? 'unchanged' : 'CHANGED'}: ${totals.carried} carried; `
      + `root=${totals.root} direct=${totals.direct} reference=${totals.reference} (max depth ${totals.max_depth}); `
      + `blocking=${totals.blocking} (actor=${totals.actor} profile_claim=${totals.profile_claim} unresolved=${totals.unresolved}); `
      + `added=${report.added.length} removed=${report.removed.length} changed=${report.changed.length}`);
  } else {
    log(JSON.stringify({ ...report, totals: paths.totals }, null, 2));
  }
  return report.matches_expectations ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
