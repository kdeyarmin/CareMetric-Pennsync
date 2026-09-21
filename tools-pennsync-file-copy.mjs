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

export const COPY_CONTRACT = 'cm.pennsync.file-copy.v1';
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
 * WHO MAY OPEN A COPIED OBJECT — the question that stops every apply (D77).
 *
 * A mapping is keyed on the LOCATOR, so one upload referenced by three rows
 * becomes one owned handle. That is the property that stops two copies
 * drifting, and it is also what makes this the sharp end. The runtime that
 * would serve that handle, `services/integration-runtime/providers.mjs`, is
 * UPLOADER-OWNED: `fileRecord` admits a row only when `subject` equals the
 * caller's hashed subject, and the object path embeds that subject as well. Its
 * `id` is a primary key, so the same handle cannot be registered once per
 * reader. A migrated object has no uploader, so whichever subject the copy ran
 * as would be the only person who could ever open it, and every other
 * authorized caregiver would get `FILE_ACCESS_DENIED`.
 *
 * That model is right for what it was built for — a file a caller uploaded in
 * their own session — and wrong for a carried row whose readers are decided by
 * a contract. Changing it is a decision about the runtime's authorization, not
 * about this tool, so it is NOT taken here and NOT worked around: D56's rule is
 * "do not widen the allowlist to unblock yourself", and the same applies to an
 * ownership check.
 *
 * SO EVERY APPLY IS REFUSED, and the first version of this got it backwards in
 * a way worth recording. It took a `readerModel` from the operator, refused
 * `uploader_owned` by name and accepted `record_authorized` — which nothing
 * implements. The label was never checked against anything, so the accepted
 * value was the one that CANNOT be true, the refusal message named it, and an
 * operator following the error would type the word that let immutable rows be
 * written for handles nobody but one person could open. **Pre-allowing the name
 * of a model nobody has built is worse than no check: it reads as a control and
 * it is a hint.** An attestation a tool cannot verify is not a control either.
 *
 * `RUNTIME_READER_MODEL` is a fact about another service, so it is pinned here
 * and a test reads that service's own source to keep it honest — when the
 * runtime stops being uploader-owned, that test fails and this refusal is the
 * one line to delete. Until then `fileCopyRows` and `writeFileObjects` below
 * stay reachable, because the round trip they prove (the planner writes
 * `locator_key`, the resolver reads it) is what stops every future mapping
 * resolving to null.
 */
export const RUNTIME_READER_MODEL = 'uploader_owned';
export const REQUIRED_READER_MODEL = 'record_authorized';

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
    const locator = row.locator === undefined || row.locator === null ? null : row.locator;
    check(locator === null || typeof locator === 'string', 'FILE_COPY_EXPORT_INVALID');
    return { entity: row.entity, path: row.path, row_id: row.row_id ?? null, locator };
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
    if (mapped.has(key)) { note('already_mapped', reference); continue; }
    const existing = copies.get(key);
    if (existing) { existing.reference_count += 1; continue; }
    // Before the insert rather than after it. The two admit the same count —
    // measured, not assumed — and this way the bound is the condition rather
    // than something to work out from it.
    if (copies.size >= LIMITS.locators) throw new FileCopyError('FILE_COPY_TOO_MANY_LOCATORS');
    copies.set(key, { locator, locator_key: key, reference_count: 1 });
  }
  const ordered = [...copies.values()].sort((a, b) => (a.locator_key < b.locator_key ? -1 : 1));
  const plan = {
    contract: COPY_CONTRACT,
    app_id: appId,
    copies: ordered,
    skips,
    skipped_fields: [...skipped.values()]
      .sort((a, b) => (`${a.reason}${a.entity}${a.path}` < `${b.reason}${b.entity}${b.path}` ? -1 : 1)),
    // DISTINCT locators, where `skips.uncarried_entity` counts REFERENCES to
    // them. Reported beside the copy set and never merged into it: an
    // inventory is complete, a rewrite has nothing to rewrite for a table that
    // does not exist here.
    uncarried_locators: uncarriedLocators.size,
    // The census's own attestation, for the same reason it carries one: an
    // operator reads this artifact and acts on it, and has to be able to see
    // that computing it read no object and moved no byte.
    hosted_inventory_performed: false,
    object_bytes_read: 0,
    files_copied: 0,
  };
  plan.digest = sha(Buffer.from(JSON.stringify({
    contract: plan.contract, app_id: plan.app_id, copies: plan.copies,
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
 * Record the mappings for a copy that has already happened — REFUSED, always.
 *
 * This is the documented apply path, and it is the one place an operator would
 * enter. See `RUNTIME_READER_MODEL` above for the whole argument: the runtime
 * mints handles only its uploader can open, a migrated object has no uploader,
 * and a mapping is immutable, so recording one is a permanent row for bytes
 * every other authorized reader is refused.
 *
 * The body below is what runs when that is answered. Deleting the refusal is
 * the whole change; everything under it is already proved.
 */
export async function applyFileCopy(execute, plan, options) {
  // Before the plan is even read, so the reason is what the operator sees.
  check(RUNTIME_READER_MODEL === REQUIRED_READER_MODEL,
    'FILE_COPY_READER_MODEL_UNRESOLVED');
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
