#!/usr/bin/env node
/**
 * What tenant predicate each entity with no derivable tenant path gets.
 *
 * `tools-tenant-path.mjs` resolves how a carried entity reaches its agency and
 * names the ones it cannot resolve. Those are not a defect in the resolver:
 * the schema genuinely does not say who owns the row, so a person has to
 * decide, and the decision has to be written down where a gate can check it
 * rather than living in a reviewer's head.
 *
 * This file holds the checking. The deciding lives in the committed
 * `tools-tenant-decision.json`, which records one kind per entity and why.
 *
 * Four kinds, and the default is the restrictive one:
 *
 * - `self`     The row is the account's own (a preference, an attestation, a
 *              session). The predicate is the account, and no agency is
 *              involved, so an account changing agency cannot move the row.
 * - `agency`   The row belongs to one agency. `agency_id` is added before
 *              load, NOT NULL, and the predicate is the caller's membership.
 *              Anything not positively established as another kind lands here.
 * - `shared`   The table holds platform rows and agency rows together, marked
 *              by a boolean the schema already carries. Read admits the
 *              caller's agency and the platform agency; write admits only the
 *              caller's.
 * - `global`   Platform reference data: every row belongs to the platform
 *              agency, every authenticated caller may read it, and no tenant
 *              surface may write it.
 *
 * Why `actor` columns are never a predicate, which was the open question:
 * scoping a row by the acting account's CURRENT membership means that when a
 * person moves from agency A to agency B, every row they wrote at A becomes
 * visible to B and invisible to A. That is a disclosure in both directions,
 * and it happens silently at the moment a membership changes. So an actor
 * column either identifies the row's own subject — `user_id` or `user_email`,
 * which makes it `self` — or it is provenance, which makes the row `agency`
 * and gives it a real key. `created_by` says who acted, never whose row it is.
 *
 * The guards below can only REJECT a decision, never grant one. A `global`
 * entity that references a carried entity, carries an actor column or can hold
 * a file fails, because each is a way tenant data reaches a table every agency
 * reads. Being on the list is necessary and not sufficient.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BLOCKING_KINDS, SELF_EDITABLE, buildPaths, isActorColumn, normalize, readEntity } from './tools-tenant-path.mjs';
import { ENTITY_DIRECTORY, censusEntity } from './tools-file-reference-census.mjs';

export const FORMAT = 'pennsync-tenant-decision';
export const FORMAT_VERSION = 1;
export const DECISION_FILE = 'tools-tenant-decision.json';
/** The kinds a decision may take, restrictive first. */
export const KINDS = Object.freeze(['agency', 'self', 'shared', 'global']);
/** Kinds whose tables need `agency_id` added before load. */
export const STAMPED_KINDS = Object.freeze(['agency', 'shared']);
/**
 * A `self` subject names the row's own account and nothing else. `created_by`
 * and friends are provenance and are deliberately excluded: see the note above.
 */
export const SELF_SUBJECT = /^user_(id|email)$/;
/** Entities excluded from authorization entirely rather than decided. */
export const EXCLUDED = Object.freeze([...SELF_EDITABLE]);

const fieldsOf = schema => Object.keys(schema?.properties ?? {});
const typeOf = (schema, field) => schema?.properties?.[field]?.type;

/** Every field the file census says can hold an address, nested ones included. */
function locatorPaths(repository, entity) {
  for (const extension of ['.jsonc', '.json']) {
    const path = join(repository, ENTITY_DIRECTORY, `${entity}${extension}`);
    if (!existsSync(path)) continue;
    return censusEntity(entity, readFileSync(path, 'utf8'))
      .fields.filter(field => field.kind === 'locator').map(field => field.path);
  }
  return [];
}

export function readDecisions(repository) {
  const raw = JSON.parse(readFileSync(join(repository, DECISION_FILE), 'utf8'));
  if (raw.format !== FORMAT || raw.version !== FORMAT_VERSION) throw new Error('DECISION_FORMAT_UNKNOWN');
  return raw;
}

/**
 * Every carried entity name, so a reference guard can tell a tenant-bearing
 * reference from an ordinary string column.
 */
export function carriedIndex(paths) {
  return new Map(paths.map(path => [normalize(path.entity), path.entity]));
}

/** Reasons a single decision is not admissible. Empty means it stands. */
export function auditDecision({ entity, decision, schema, carried, locators }) {
  const problems = [];
  const fields = fieldsOf(schema);
  if (!KINDS.includes(decision?.kind)) return [`${entity}: kind must be one of ${KINDS.join(', ')}`];
  if (typeof decision.because !== 'string' || decision.because.trim().length < 20) {
    problems.push(`${entity}: needs a stated reason`);
  }

  if (decision.kind !== 'global' && decision.external_locators) {
    problems.push(`${entity}: external_locators only applies to a global table`);
  }

  if (decision.kind === 'self') {
    const subject = decision.subject;
    if (!fields.includes(subject)) problems.push(`${entity}: self subject ${subject} is not a column`);
    else if (!SELF_SUBJECT.test(subject)) {
      problems.push(`${entity}: self subject ${subject} is provenance, not the row's own account`);
    }
  }

  if (decision.kind === 'shared') {
    const flag = decision.platform_flag;
    if (!fields.includes(flag)) problems.push(`${entity}: platform flag ${flag} is not a column`);
    else if (typeOf(schema, flag) !== 'boolean') problems.push(`${entity}: platform flag ${flag} is not a boolean`);
  }

  if (decision.kind === 'global') {
    // Every way tenant data could reach a table that every agency reads.
    for (const field of fields) {
      if (isActorColumn(field)) problems.push(`${entity}: global table carries actor column ${field}`);
      const referenced = field.endsWith('_id') && carried.get(normalize(field.slice(0, -3)));
      if (referenced && referenced !== entity) {
        problems.push(`${entity}: global table references carried entity ${referenced} via ${field}`);
      }
    }
    // A locator in a table every agency reads is how an uploaded file leaks.
    // Reference data legitimately cites an outside address, so the exemption
    // is enumerated rather than assumed: each such field is named here, the
    // loader must prove its value is an absolute address outside our own
    // storage, and a locator added later fails until someone decides about it.
    const external = decision.external_locators ?? [];
    for (const field of locators) {
      if (!external.includes(field)) problems.push(`${entity}: global table can hold a file via ${field}`);
    }
    for (const field of external) {
      if (!locators.includes(field)) problems.push(`${entity}: external locator ${field} is not a locator`);
    }
  }
  return problems;
}

export function checkDecisions(repository = process.cwd()) {
  const root = resolve(repository);
  const paths = buildPaths(root).entities;
  const carried = carriedIndex(paths);
  const blocking = paths.filter(path => BLOCKING_KINDS.includes(path.kind) && !EXCLUDED.includes(path.entity));
  const record = readDecisions(root);
  const decided = record.entities ?? {};
  const problems = [];
  const counts = Object.fromEntries(KINDS.map(kind => [kind, 0]));

  for (const entity of Object.keys(decided)) {
    if (EXCLUDED.includes(entity)) problems.push(`${entity}: excluded from authorization, so it cannot carry a decision`);
    else if (!blocking.some(path => path.entity === entity)) {
      problems.push(`${entity}: has a decision but its tenant path already resolves`);
    }
  }

  for (const { entity } of blocking) {
    const decision = decided[entity];
    if (!decision) { problems.push(`${entity}: no tenant decision`); continue; }
    counts[decision.kind] = (counts[decision.kind] ?? 0) + 1;
    const schema = readEntity(root, entity);
    const locators = decision.kind === 'global' ? locatorPaths(root, entity) : [];
    problems.push(...auditDecision({ entity, decision, schema, carried, locators }));
  }

  const stamped = blocking
    .filter(({ entity }) => STAMPED_KINDS.includes(decided[entity]?.kind))
    .map(({ entity }) => entity).sort();
  return { blocking: blocking.length, counts, stamped, problems: problems.sort() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = checkDecisions(process.cwd());
  if (report.problems.length) {
    for (const problem of report.problems) console.error(`  ${problem}`);
    console.error(`tenant decisions: ${report.problems.length} problem(s)`);
    process.exit(1);
  }
  const shape = KINDS.map(kind => `${kind}=${report.counts[kind] ?? 0}`).join(' ');
  console.log(`tenant decisions complete: ${report.blocking} decided; ${shape}; ${report.stamped.length} tables take agency_id before load`);
}
