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
import { DISPOSITION_FILE } from './tools-entity-schema-plan.mjs';

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

/**
 * Every field name in the schema, nested ones included, as `a.b[].c` paths.
 *
 * The guards below have to see a reference wherever it lives. A carried
 * reference nested in an object or array is stored as JSONB by the schema
 * generator, so a top-level-only scan passes it and the global policy then
 * reads it out — which is the whole thing the guard exists to stop. This walks
 * the same shape `tools-file-reference-census.mjs` walks for locators.
 */
export function everyField(schema, prefix = '', depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 12) return [];
  if (schema.type === 'array' && schema.items) return everyField(schema.items, `${prefix}[]`, depth + 1);
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const found = [];
  for (const name of Object.keys(properties).sort()) {
    const path = prefix ? `${prefix}.${name}` : name;
    found.push({ path, name, schema: properties[name] });
    found.push(...everyField(properties[name], path, depth + 1));
  }
  return found;
}

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

/**
 * D2's ceiling on the `broker` disposition, checked against the schema.
 *
 * D2 reads: "a capability may only hold that disposition while it touches no
 * PHI and no authority decision." A `broker` entity is one a single reviewed
 * RPC family may serve generically, so that ceiling is the whole safety
 * argument — and it was assigned by reading names. Reading schemas instead
 * found `VerificationCode` holding a live six-digit code with an expiry,
 * `PDFIndex` holding `extracted_text` beside a `patient_id`, and `TeamNote`
 * holding free-text clinical notes reached through `Patient`.
 *
 * Like the `global` guard this mirrors, it can only REJECT, and an exemption is
 * enumerated per field with a reason rather than inferred. That matters because
 * the crude reading is wrong in both directions: `ServiceCode.code` is a
 * billing classification and `FeaturePackage.agency_code` an agency reference,
 * neither of them a credential.
 */
export const CLINICAL_TARGETS = Object.freeze(['Patient', 'Visit', 'Document', 'OASISAssessment', 'Referral', 'CarePlan']);
export const CLINICAL_SUBJECT = /^(patient|visit|document|oasis_assessment|referral|care_plan)_id$/;
export const CREDENTIAL_FIELD = /(^|_)(token|secret|password|api_key|apikey|credential|otp)($|_)/i;
/**
 * A `code` is a credential when it has a lifecycle, and a classification when
 * it does not. `VerificationCode.code` sits beside `expires_at`, `verified` and
 * `verified_at`, so reading it is redeeming somebody's second factor;
 * `ServiceCode.code` is a billing code and `FeaturePackage.agency_code` names
 * an agency. Matching on the name alone gets all three wrong, in both
 * directions, so the lifecycle is what decides.
 */
export const CODE_FIELD = /(^|_)code$/i;
export const REDEMPTION_MARKER = /^(expires_at|expired_at|verified|verified_at|used_at|redeemed_at|consumed_at)$/i;

export function auditBrokerCeiling({ entity, schema, path, locators, exempt = [] }) {
  const problems = [];
  const spared = new Set(exempt);
  if (path?.kind === 'reference' && CLINICAL_TARGETS.includes(path.target)) {
    problems.push(`${entity}: reaches tenancy through ${path.target}, so a generic broker would serve clinical rows`);
  }
  const all = everyField(schema);
  const redeemable = all.some(field => REDEMPTION_MARKER.test(field.name));
  for (const field of all) {
    if (CLINICAL_SUBJECT.test(field.name)) {
      problems.push(`${entity}: names a clinical subject in ${field.path}`);
    }
    const credential = CREDENTIAL_FIELD.test(field.name) || (redeemable && CODE_FIELD.test(field.name));
    if (credential && !spared.has(field.path)) {
      problems.push(`${entity}: carries a credential in ${field.path}`);
    }
  }
  for (const locator of locators) {
    if (!spared.has(locator)) problems.push(`${entity}: can hold a file in ${locator}`);
  }
  // An exemption that no longer matches anything is stale, and a stale
  // exemption is how a later field slips through under an old justification.
  const present = new Set([...all.map(field => field.path), ...locators]);
  for (const field of spared) {
    if (!present.has(field)) problems.push(`${entity}: exemption for ${field} matches no field`);
  }
  return problems;
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
    // Every way tenant data could reach a table that every agency reads. The
    // walk is over nested fields too: a reference buried in an object becomes
    // JSONB rather than a column, and a top-level scan would wave it through.
    for (const { path, name } of everyField(schema)) {
      if (isActorColumn(name)) problems.push(`${entity}: global table carries actor column ${path}`);
      const referenced = name.endsWith('_id') && carried.get(normalize(name.slice(0, -3)));
      if (referenced && referenced !== entity) {
        problems.push(`${entity}: global table references carried entity ${referenced} via ${path}`);
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

  // D2's ceiling, over every entity the manifest dispositions `broker` —
  // including those whose tenant path resolves, which carry no decision here.
  const dispositions = JSON.parse(readFileSync(join(root, DISPOSITION_FILE), 'utf8'));
  const exemptions = dispositions.broker_ceiling ?? {};
  const byEntity = new Map(paths.map(path => [path.entity, path]));
  const brokered = Object.keys(dispositions.entities)
    .filter(entity => dispositions.entities[entity] === 'broker').sort();
  for (const entity of brokered) {
    problems.push(...auditBrokerCeiling({
      entity,
      schema: readEntity(root, entity),
      path: byEntity.get(entity),
      locators: locatorPaths(root, entity),
      exempt: exemptions[entity]?.fields ?? [],
    }));
  }
  for (const entity of Object.keys(exemptions)) {
    if (!brokered.includes(entity)) problems.push(`${entity}: broker exemption but not dispositioned broker`);
    const reason = exemptions[entity]?.because;
    if (typeof reason !== 'string' || reason.trim().length < 20) {
      problems.push(`${entity}: broker exemption needs a reason someone can read`);
    }
  }

  const stamped = blocking
    .filter(({ entity }) => STAMPED_KINDS.includes(decided[entity]?.kind))
    .map(({ entity }) => entity).sort();
  return { blocking: blocking.length, counts, stamped, brokered: brokered.length, problems: problems.sort() };
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
