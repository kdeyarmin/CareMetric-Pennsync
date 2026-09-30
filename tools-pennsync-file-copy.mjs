#!/usr/bin/env node
/**
 * The copy D56 names, planned (D77).
 *
 * D56 measured what the file-bound capabilities wait on and named three
 * things: the inventory, the copy into the private bucket under a SHA-256
 * manifest, and the `file_url` -> `cmfile:` compatibility layer.
 * `tools-file-reference-census.mjs` is the first, `20260920520000_file_locator_map.sql`
 * is the third, and this plans the second.
 *
 * **It copies nothing.** Like the census it contacts no app, reads no record
 * and downloads no object; like `tools-pennsync-assignment-backfill.mjs` it
 * plans from an export an operator produces, reports what it would do, and
 * applies only a plan whose digest matches what was reviewed. The copy itself
 * needs a live Base44 app and a live bucket, which is an operator's job and
 * not a command line's.
 *
 * **The asymmetry that decides every judgement here** is the backfill's, and
 * it is sharper for files. A copy that DROPS a file is a support ticket:
 * somebody opens a document and it is not there, and they say so. A copy that
 * maps a locator to the WRONG BYTES is a disclosure, and nobody reports it,
 * because the row looks right to the person now reading another patient's
 * document. So every ambiguity skips, and every skip is named rather than
 * counted.
 *
 * That is also why the mapping is immutable in the database: a plan that
 * mapped a locator wrongly cannot be corrected in place, so this refuses to
 * plan a second destination for a locator that already has one.
 *
 * **What it plans, and what it deliberately does not.** The census lists 66
 * locator fields across 58 entities. Only 34 of them, across 27 entities, are
 * on entities that get a TABLE in the record store — the other 32 are on
 * entities dispositioned `hub`, `preserved_paused` or `retire`, which have no
 * row here to re-point. An INVENTORY should be complete, because you look at
 * everything before deciding; a COPY-AND-REWRITE has nothing to rewrite for
 * those. The plan reports both numbers and refuses to conflate them.
 *
 * No diagnostic carries a patient id, a name or an address. A locator is named
 * in the plan because the operator has to copy it, and its digest is the
 * manifest; nothing else about the row travels.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * v2 because the export's shape changed in a way a v1 export cannot satisfy:
 * every reference now names the AGENCY of the row it came from. Under D224's
 * reader model a copied object is bound to a tenant, so a plan that did not
 * know the tenant could not say what to mint, and accepting a v1 export would
 * mean guessing it.
 */
export const COPY_CONTRACT = 'cm.pennsync.file-copy.v2';
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
export const LIMITS = Object.freeze({ references: 500000, locators: 200000, mapped: 200000 });
/** The same write lock every authority mutation takes, so this serialises with them. */
export const APP_LOCK = Object.freeze([168344, 20260918]);
/**
 * The hosts the Base44 originals' shared SSRF guard admits, which is what a
 * carried `file_url` can point at. A locator outside them is not a Base44
 * storage object and this tool has no business copying it.
 */
export const STORAGE_HOSTS = Object.freeze(['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io']);
/** An entity whose disposition gives it no table in the record store. */
export const UNCARRIED_DISPOSITIONS = Object.freeze(['retire', 'hub', 'preserved_paused']);

/**
 * WHO MAY OPEN A COPIED OBJECT — the question that stopped every apply (D77),
 * answered.
 *
 * A mapping is keyed on the LOCATOR, so one upload referenced by three rows
 * becomes one owned handle. That is the property that stops two copies
 * drifting, and it was also what made this the sharp end. The runtime that
 * serves that handle, `services/integration-runtime/providers.mjs`, WAS
 * uploader-owned: `fileRecord` admitted a row only when `subject` equalled the
 * caller's hashed subject, and the object path embedded that subject too. A
 * migrated object has no uploader, so whichever subject the copy ran as would
 * have been the only person who could ever open it, and every other authorized
 * caregiver would have got `FILE_ACCESS_DENIED`.
 *
 * That model is right for what it was built for — a file a caller uploaded in
 * their own session — and wrong for a carried row whose readers are decided by
 * a contract. Migration `006_record_owned_files.sql` makes the ownership a
 * property of the ROW rather than a property of the service: an object is
 * `subject`-owned, exactly as before and by default, or `record`-owned, bound
 * to an AGENCY, readable by an active membership of it.
 *
 * **The protection that had to survive, and did**: a handle is not a bearer
 * capability. The agency a record-owned read is admitted under is the one the
 * runtime resolved for itself from the caller's own bearer through live
 * authority — never something the caller asserts — so a leaked `cmfile:` UUID
 * still buys its holder nothing.
 *
 * What the runtime deliberately does NOT answer is the chart. It cannot ask
 * `caller_assigned_patients` without the record store, and giving it that store
 * is the widening D56's rule forbids. So the split is that the runtime
 * authorizes the TENANT and the calling contract authorizes the CHART, and
 * every path to these bytes runs through such a contract first.
 *
 * SO AN APPLY IS NO LONGER REFUSED FOR THIS REASON, and the shape of the old
 * refusal is worth keeping in mind rather than deleting. Its first version took
 * a `readerModel` from the operator, refused `uploader_owned` by name and
 * accepted `record_authorized` — which nothing implemented. The label was never
 * checked against anything, so the accepted value was the one that COULD NOT be
 * true, the refusal message named it, and an operator following the error would
 * have typed the word that let immutable rows be written for handles nobody but
 * one person could open. **Pre-allowing the name of a model nobody has built is
 * worse than no check: it reads as a control and it is a hint.**
 *
 * `RUNTIME_READER_MODEL` is still a fact about another service rather than an
 * attestation, so it stays pinned here and a test still reads that service's
 * own source to keep it honest.
 *
 * **These two DISAGREE again, and that is a measurement rather than a
 * regression.** The tenant/chart split shipped in SQL, and then the assumption
 * under its read half turned out not to hold: the runtime authenticates a USER
 * and not `pennsync-api`, which forwards the caller's own bearer and nothing
 * else, so an agency-wide predicate would have made a leaked handle plus the
 * holder's own bearer enough for any member of that agency. The runtime's read
 * therefore stays uploader-owned and its mint refuses, so no record-owned
 * object can be minted or read — which means this apply must refuse, because
 * what it would record is immutable mappings to handles nothing serves.
 *
 * What closes it is a caller-authenticated read, and that is a decision about
 * the boundary between two services rather than a change to this tool. The
 * test below reads the runtime's own source, so the day that read exists this
 * pin fails and is corrected deliberately instead of drifting open.
 */
export const RUNTIME_READER_MODEL = 'uploader_owned';
export const REQUIRED_READER_MODEL = 'record_authorized';

/**
 * The apply's reader-model refusal, as a function so it can be DRIVEN.
 *
 * The two constants DISAGREE today, so this refuses every apply for real, and
 * the case that cannot arise is the passing one. That inverts which half owes a
 * synthetic case and does not remove the obligation: the test drives the
 * agreeing pair here rather than trusting that a gate nothing exercises would
 * let a legitimate apply through. `OWNER_HELD` is the same rule from the other
 * side — empty since the owner emptied it, with every check over it driven from
 * a synthetic hold, because a guard that cannot fire has not been shown to
 * work. Both directions were found by mutation: replacing this comparison with
 * `true` left every suite green while the pins agreed, and with `false` while
 * they disagree.
 *
 * It takes its two values as ARGUMENTS and is not injectable, which is the
 * distinction that matters. A first version of this let `options` supply the
 * predicate so a test could hand it one that refuses — and `options` is the
 * OPERATOR's input, so that put a `() => true` bypass of this very control in
 * the exported apply. That is D77's own finding wearing a new shape: a caller
 * may not supply anything about the reader model, an attestation included, and
 * least of all the function that decides it. The test drives THIS instead, and
 * the apply calls it with the module's own pins and nothing else.
 */
export function assertReaderModel(runtime, required) {
  check(runtime === required, 'FILE_COPY_READER_MODEL_UNRESOLVED');
}

/** Why one reference produced no copy. Reported, never silent. */
export const SKIPS = Object.freeze([
  'blank',                  // the field is absent or empty on that row
  'already_owned',          // a `cmfile:` handle: written after cutover, nothing to copy
  'already_mapped',         // the store already maps it, so a re-run is idempotent
  'not_a_storage_locator',  // not an http(s) URL on a Base44 storage host
  'unknown_entity',         // not in the census at all
  'uncarried_entity',       // no table in the record store: nothing here to re-point
  'unknown_field',          // a path the census does not list as a locator for that entity
]);

const APP = /^[a-f0-9]{24}$/;
/** The tenant id shape `cm_integration_file_record_owned` binds an object to. */
const AGENCY = /^[A-Za-z0-9_-]{1,128}$/;
const KEY = /^[0-9a-f]{64}$/;
const FILE_URI = /^cmfile:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LOCATOR = 4096;

export class FileCopyError extends Error {
  constructor(code) { super(code); this.name = 'FileCopyError'; this.code = code; }
}
const check = (value, code = 'FILE_COPY_EXPORT_INVALID') => { if (!value) throw new FileCopyError(code); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const sha = value => createHash('sha256').update(value).digest('hex');
/** The key the database computes, so a plan cannot disagree with the table. */
export const locatorKey = locator => sha(Buffer.from(String(locator), 'utf8'));

/**
 * Whether a locator addresses Base44 storage.
 *
 * Deliberately the same host set the originals' `isSafeFetchUrl` admits, and
 * deliberately NOT a looser one: a locator this does not recognise is reported
 * rather than copied, because a tool that guesses what an unfamiliar string
 * points at is a tool that fetches somewhere it was not asked to.
 */
export function isStorageLocator(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_LOCATOR) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  return STORAGE_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * The census, reduced to "which locator paths does this entity have".
 *
 * Read from the committed expectations rather than recomputed, for the reason
 * the census file itself gives: it is the reviewed list, and a new
 * file-bearing field has to appear in a diff before it can appear here.
 */
export function locatorPaths(census) {
  check(isObject(census) && isObject(census.entities), 'FILE_COPY_CENSUS_INVALID');
  const paths = new Map();
  for (const [entity, fields] of Object.entries(census.entities)) {
    if (!Array.isArray(fields)) continue;
    const locators = fields.filter(field => isObject(field) && field.kind === 'locator')
      .map(field => field.path);
    if (locators.length) paths.set(entity, new Set(locators));
  }
  return paths;
}

/**
 * Read an export into the shape this tool plans from.
 *
 * One list decides anything: `references`, which is what an operator's query
 * over the census's paths produces — the entity, the row it came from, the
 * path within it, and the locator. `mapped` carries the keys the store already
 * holds so a second run plans nothing it already did.
 *
 * Only the fields that decide something are read. A reference's row id is kept
 * because the report has to say how many rows a missing object would affect,
 * and nothing else about the row is carried: a tool that never reads a name
 * cannot leak one.
 */
export function readExport(raw) {
  check(typeof raw === 'string' && raw.length <= MAX_EXPORT_BYTES, 'FILE_COPY_EXPORT_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new FileCopyError('FILE_COPY_EXPORT_INVALID_JSON'); }
  check(isObject(parsed));
  check(parsed.contract === COPY_CONTRACT, 'FILE_COPY_EXPORT_CONTRACT_MISMATCH');
  check(typeof parsed.app_id === 'string' && APP.test(parsed.app_id));
  check(Array.isArray(parsed.references) && parsed.references.length <= LIMITS.references);
  const mapped = parsed.mapped === undefined ? [] : parsed.mapped;
  check(Array.isArray(mapped) && mapped.length <= LIMITS.mapped);
  for (const key of mapped) check(typeof key === 'string' && KEY.test(key));
  const references = parsed.references.map(row => {
    check(isObject(row));
    check(typeof row.entity === 'string' && row.entity.length > 0 && row.entity.length <= 200);
    check(typeof row.path === 'string' && row.path.length > 0 && row.path.length <= 400);
    check(row.row_id === undefined || (typeof row.row_id === 'string' && row.row_id.length <= 200));
    // Required, and shaped like the tenant ids the runtime binds to. A
    // reference with no agency cannot say what to mint the object under, and a
    // missing one must not read as a locator that simply has no tenant.
    check(typeof row.agency_id === 'string' && AGENCY.test(row.agency_id),
      'FILE_COPY_EXPORT_AGENCY_REQUIRED');
    const locator = row.locator === undefined || row.locator === null ? null : row.locator;
    check(locator === null || typeof locator === 'string', 'FILE_COPY_EXPORT_INVALID');
    return { entity: row.entity, path: row.path, row_id: row.row_id ?? null,
      agency_id: row.agency_id, locator };
  });
  return { app_id: parsed.app_id, references, mapped: new Set(mapped) };
}

/**
 * Plan the copy.
 *
 * Deduplicates by LOCATOR rather than by reference, because a locator is an
 * address for bytes and more than one row legitimately holds the same one — a
 * `Document`, the `DocumentVersion` under it and a `Referral` naming the same
 * upload are three paths to one object. Copying it three times would make two
 * of the copies able to drift.
 */
export function planFileCopy({ app_id: appId, references, mapped }, census, manifest) {
  const paths = locatorPaths(census);
  const dispositions = isObject(manifest) && isObject(manifest.entities) ? manifest.entities : {};
  const copies = new Map();
  const skips = Object.fromEntries(SKIPS.map(reason => [reason, 0]));
  // Counted per FIELD, not just per reason: "this field skipped four thousand
  // times" and "this field skipped once" are different findings, and a list
  // that names the field without saying how often leaves an operator to guess.
  const skipped = new Map();
  const uncarriedLocators = new Set();
  // Locators the store already maps, by key, with the agencies THIS export
  // reaches them from. They produce no copy; they are tracked so a mapped
  // locator cannot escape the cross-agency check.
  const mappedAgencies = new Map();
  const note = (reason, reference) => {
    skips[reason] += 1;
    // The entity and path, never the row id: a skip report says which FIELD is
    // affected and how often, which is what an operator acts on.
    const id = `${reason}:${reference.entity}:${reference.path}`;
    const entry = skipped.get(id);
    if (entry) { entry.references += 1; return; }
    skipped.set(id, { reason, entity: reference.entity, path: reference.path, references: 1 });
  };
  for (const reference of references) {
    const fields = paths.get(reference.entity);
    if (!fields) { note('unknown_entity', reference); continue; }
    if (!fields.has(reference.path)) { note('unknown_field', reference); continue; }
    const locator = reference.locator;
    if (typeof locator !== 'string' || locator === '') { note('blank', reference); continue; }
    if (FILE_URI.test(locator)) { note('already_owned', reference); continue; }
    // The carried check comes AFTER the shape checks so an unfamiliar path on
    // a paused entity is still reported as unfamiliar: a census the schemas
    // have outgrown is a finding whatever the disposition says.
    if (UNCARRIED_DISPOSITIONS.includes(dispositions[reference.entity])) {
      uncarriedLocators.add(locator);
      note('uncarried_entity', reference);
      continue;
    }
    if (!isStorageLocator(locator)) { note('not_a_storage_locator', reference); continue; }
    const key = locatorKey(locator);
    if (mapped.has(key)) {
      note('already_mapped', reference);
      // The agencies are accumulated even though no copy will be made, because
      // this branch used to run BEFORE the accumulation below and so hid the
      // very case the cross-agency escalation exists to catch: a locator
      // mapped on an earlier run and referenced from a second agency on this
      // one was reported `already_mapped` and the apply proceeded. Running the
      // copy twice defeated the refusal, which is worse than not having it.
      const seen = mappedAgencies.get(key)
        || { locator, locator_key: key, reference_count: 0, agencies: new Set(), fields: new Set() };
      seen.reference_count += 1;
      seen.agencies.add(reference.agency_id);
      seen.fields.add(`${reference.entity}:${reference.path}`);
      mappedAgencies.set(key, seen);
      continue;
    }
    const existing = copies.get(key);
    if (existing) {
      existing.reference_count += 1;
      existing.agencies.add(reference.agency_id);
      // Named by FIELD, never by row, exactly as a skip is: an operator acts on
      // the field, and a row id here would put a clinical subject in the plan.
      existing.fields.add(`${reference.entity}:${reference.path}`);
      continue;
    }
    // Before the insert rather than after it. The two admit the same count —
    // measured, not assumed — and this way the bound is the condition rather
    // than something to work out from it.
    if (copies.size >= LIMITS.locators) throw new FileCopyError('FILE_COPY_TOO_MANY_LOCATORS');
    copies.set(key, { locator, locator_key: key, reference_count: 1,
      agencies: new Set([reference.agency_id]),
      fields: new Set([`${reference.entity}:${reference.path}`]) });
  }
  /*
   * A locator reached from more than one agency is MEASURED and ESCALATED, not
   * quietly dropped (D224).
   *
   * Keying on the locator means one upload becomes one owned handle, and under
   * the reader model that handle is bound to a single tenant — so a locator two
   * agencies reference today cannot be served to both. Dropping it silently
   * would make a file unreachable from one of the agencies that reaches it now,
   * which is somebody noticing the product doing less. So it is reported with
   * the fields that reach it, and `applyFileCopy` refuses while any exists.
   *
   * Whether the real data contains any is a question this tool answers and this
   * source cannot: it is a property of an operator's export.
   */
  const ordered = [];
  const crossAgency = [];
  for (const copy of [...copies.values()].sort((a, b) => (a.locator_key < b.locator_key ? -1 : 1))) {
    const agencies = [...copy.agencies].sort();
    const entry = { locator: copy.locator, locator_key: copy.locator_key,
      reference_count: copy.reference_count };
    if (agencies.length === 1) { ordered.push({ ...entry, agency_id: agencies[0] }); continue; }
    crossAgency.push({ ...entry, agencies, fields: [...copy.fields].sort() });
  }
  /*
   * The same escalation over locators the store ALREADY maps, which no copy
   * would touch. Two cases and they are not equally severe, so they are
   * reported apart rather than as one number.
   *
   * More than one agency in THIS export is the cross-agency case outright: one
   * handle binds to one tenant, so whichever tenant the existing mapping names,
   * it cannot serve the other. It joins `cross_agency` and the apply refuses.
   *
   * Exactly one agency here cannot be CONFIRMED, because a mapping is keyed on
   * the locator and `pennsync_private.file_object` stores no agency, so there
   * is nothing to compare this export's agency against. That is reported and
   * does not refuse: a binding that disagrees resolves to a handle the runtime
   * will not open, which is a loud refusal rather than a disclosure, and
   * refusing here instead would block every legitimate second run. Giving
   * `file_object` an agency column is what would settle it, and that is a
   * forward record migration rather than a change to this tool.
   */
  let mappedTenantUnverified = 0;
  for (const seen of [...mappedAgencies.values()].sort((a, b) => (a.locator_key < b.locator_key ? -1 : 1))) {
    const agencies = [...seen.agencies].sort();
    if (agencies.length === 1) { mappedTenantUnverified += 1; continue; }
    crossAgency.push({ locator: seen.locator, locator_key: seen.locator_key,
      reference_count: seen.reference_count, agencies, fields: [...seen.fields].sort(),
      already_mapped: true });
  }
  crossAgency.sort((a, b) => (a.locator_key < b.locator_key ? -1 : 1));
  const plan = {
    contract: COPY_CONTRACT,
    app_id: appId,
    copies: ordered,
    cross_agency: crossAgency,
    skips,
    skipped_fields: [...skipped.values()]
      .sort((a, b) => (`${a.reason}${a.entity}${a.path}` < `${b.reason}${b.entity}${b.path}` ? -1 : 1)),
    // DISTINCT locators, where `skips.uncarried_entity` counts REFERENCES to
    // them. Reported beside the copy set and never merged into it: an
    // inventory is complete, a rewrite has nothing to rewrite for a table that
    // does not exist here.
    uncarried_locators: uncarriedLocators.size,
    // Mapped locators whose stored tenant this plan cannot compare with the
    // agency reaching them here. Counted, never merged into a skip total: a
    // skip says no copy is needed and this says one fact about it is unknown.
    mapped_tenant_unverified: mappedTenantUnverified,
    // The census's own attestation, for the same reason it carries one: an
    // operator reads this artifact and acts on it, and has to be able to see
    // that computing it read no object and moved no byte.
    hosted_inventory_performed: false,
    object_bytes_read: 0,
    files_copied: 0,
  };
  // `cross_agency` is inside the digest: the reviewed plan is the whole
  // answer, and a plan that grew one between review and apply is not the plan
  // that was reviewed.
  plan.digest = sha(Buffer.from(JSON.stringify({
    contract: plan.contract, app_id: plan.app_id, copies: plan.copies,
    cross_agency: plan.cross_agency,
  }), 'utf8'));
  return plan;
}

export function summarize(plan) {
  const skipped = Object.values(plan.skips).reduce((total, value) => total + value, 0);
  return {
    contract: plan.contract,
    app_id: plan.app_id,
    to_copy: plan.copies.length,
    references_covered: plan.copies.reduce((total, copy) => total + copy.reference_count, 0),
    skipped,
    skips: plan.skips,
    uncarried_locators: plan.uncarried_locators,
    // The measurement D224 turns on. Zero means the tenant binding costs
    // nothing; anything else is a decision nobody has taken.
    cross_agency_locators: plan.cross_agency.length,
    digest: plan.digest,
  };
}

/**
 * The rows a copy's results would become, validated.
 *
 * `results` is what the operator's copy produced, keyed by locator: the owned
 * handle, the digest of the bytes it wrote, and their size. This builds the
 * mapping rows and nothing else — it does not fetch, and it cannot verify that
 * the digest describes the bytes, because it never sees them. What it CAN do,
 * and does, is refuse a result whose shape could not address anything, and
 * refuse to proceed on a plan that is not the one reviewed.
 */
export function fileCopyRows(plan, { actorId, expectedDigest, copyRun, results }) {
  check(isObject(plan) && plan.contract === COPY_CONTRACT, 'FILE_COPY_PLAN_INVALID');
  check(typeof actorId === 'string' && UUID.test(actorId), 'FILE_COPY_ACTOR_INVALID');
  check(typeof copyRun === 'string' && copyRun.length > 0 && copyRun.length <= 200,
    'FILE_COPY_RUN_INVALID');
  check(plan.digest === expectedDigest, 'FILE_COPY_PLAN_DIGEST_MISMATCH');
  check(isObject(results), 'FILE_COPY_RESULTS_INVALID');
  const rows = [];
  for (const copy of plan.copies) {
    const result = results[copy.locator];
    // A locator the copy did not produce is DROPPED, not guessed at. That is
    // the safe half of the asymmetry: it stays unmapped, the capability
    // refuses, and somebody says the document is missing.
    if (result === undefined) continue;
    check(isObject(result), 'FILE_COPY_RESULTS_INVALID');
    check(typeof result.file_uri === 'string' && FILE_URI.test(result.file_uri),
      'FILE_COPY_RESULT_URI_INVALID');
    check(typeof result.content_sha256 === 'string' && KEY.test(result.content_sha256),
      'FILE_COPY_RESULT_DIGEST_INVALID');
    check(Number.isSafeInteger(result.byte_size) && result.byte_size >= 0,
      'FILE_COPY_RESULT_SIZE_INVALID');
    // The agency the object had to be minted under travels in the plan and is
    // checked against what the operator's copy reports, because a handle minted
    // in the wrong tenant is readable by the wrong agency and by nobody in the
    // right one — and the mapping that recorded it would be immutable.
    check(result.agency_id === copy.agency_id, 'FILE_COPY_RESULT_AGENCY_MISMATCH');
    rows.push([plan.app_id, copy.locator_key, copy.locator, result.file_uri,
      result.content_sha256, result.byte_size, copyRun, actorId]);
  }
  return rows;
}

/**
 * Write the mapping rows, which is a transaction and a lock and nothing else.
 *
 * Separated from `applyFileCopy` because it is the PRIMITIVE rather than the
 * capability: it decides nothing about whether a copy may be recorded, and the
 * round-trip test needs the planner's own `locator_key` to travel through the
 * real insert rather than through a second one written beside it.
 */
export async function writeFileObjects(execute, rows) {
  // ONE transaction, as `applyBackfill` already does — and the lock is the
  // reason rather than a nicety. `pg_advisory_xact_lock` is an XACT lock: with
  // `execute` being a plain client's query function, each statement would be
  // its own transaction, so the lock would release the moment the SELECT
  // returned and every insert would commit independently. A later failure
  // would then leave earlier mappings committed — and a mapping is IMMUTABLE,
  // so a partially applied plan is precisely the state that cannot be
  // corrected in place.
  await execute('begin');
  let recorded = 0;
  try {
    await execute('select pg_advisory_xact_lock($1,$2)', APP_LOCK);
    for (const row of rows) {
      // No `on conflict`: the table's primary key is the refusal, and a
      // locator that already has a destination must not quietly get a second
      // one.
      await execute(`insert into pennsync_private.file_object(app_id,locator_key,locator,
        file_uri,content_sha256,byte_size,copy_run,recorded_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`, row);
      recorded += 1;
    }
    await execute('commit');
  } catch (error) {
    await execute('rollback').catch(() => {});
    throw error;
  }
  return recorded;
}

/**
 * Record the mappings for a copy that has already happened.
 *
 * This is the documented apply path and the one place an operator would enter.
 * D77 refused every call here, because the runtime minted handles only their
 * uploader could open and a migrated object has no uploader. D224 answered
 * that: `RUNTIME_READER_MODEL` above carries the argument, and the runtime now
 * binds a record-owned object to an agency rather than to a person.
 *
 * One refusal remains, and it is an open QUESTION rather than a settled
 * property of the design. A locator reached from more than one agency cannot be
 * one owned handle both agencies read, so mapping it would make the file
 * unreachable from one of them — a thing somebody notices. Whether any such
 * locator exists is a fact about the data, which this refusal measures at the
 * moment an operator has it rather than assuming either way. It names them so
 * the answer can be taken by whoever owns that call; it does not drop them, and
 * it does not decide it.
 */
/**
 * The cross-agency refusal, as a function for the reason `assertReaderModel` is
 * one: so it can be DRIVEN rather than read.
 *
 * It used to be two inline `check` lines in the apply, reached through it by
 * three tests. That was fine while the apply proceeded, and stopped being fine
 * the moment the reader-model pins were made to disagree deliberately: the
 * apply then refuses before this is ever evaluated, so every test that reached
 * it through the apply began passing on the WRONG refusal — the code matched
 * and the assertion was about something else. Mutation says it plainly: delete
 * the `cross_agency.length` line and those three tests stay green, because the
 * refusal they now observe comes from the line above it.
 *
 * So the gate a refusing apply hides is hoisted out and asserted directly. The
 * general shape is worth keeping: when a check is placed in front of another,
 * the tests behind it stop proving what they say, and nothing goes red.
 */
export function assertPlanApplicable(plan) {
  check(isObject(plan) && Array.isArray(plan.cross_agency), 'FILE_COPY_PLAN_INVALID');
  check(plan.cross_agency.length === 0, 'FILE_COPY_CROSS_AGENCY_LOCATOR_UNDECIDED');
}

export async function applyFileCopy(execute, plan, options) {
  // Before the plan is read in detail, so the reason is what the operator sees.
  // The module's own pins and nothing from `options`, which is operator input.
  assertReaderModel(RUNTIME_READER_MODEL, REQUIRED_READER_MODEL);
  assertPlanApplicable(plan);
  const rows = fileCopyRows(plan, options);
  const recorded = await writeFileObjects(execute, rows);
  return { recorded, planned: plan.copies.length, dropped: plan.copies.length - rows.length };
}

export async function main(args = process.argv.slice(2), { log = console.log, read = readFile } = {}) {
  const [exportPath] = args.filter(argument => !argument.startsWith('--'));
  if (!exportPath || args.some(a => a.startsWith('--') && a !== '--json')) {
    log(JSON.stringify({ error: 'FILE_COPY_USAGE' }));
    return 2;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  try {
    const census = JSON.parse(readFileSync(join(root, 'tools-file-reference-census-expectations.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(root, 'tools-transition-disposition.json'), 'utf8'));
    const plan = planFileCopy(readExport(await read(exportPath, 'utf8')), census, manifest);
    log(JSON.stringify(args.includes('--json') ? plan : summarize(plan), null, 2));
    return 0;
  } catch (error) {
    log(JSON.stringify({ error: error?.code || 'FILE_COPY_FAILED' }));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then(code => { process.exitCode = code; });
}
