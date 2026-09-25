#!/usr/bin/env node
/**
 * Where each frontend entity call site can land after the exit.
 *
 * The surface ratchet counts how much Base44 coupling is left and says nothing
 * about where it is going. Stage J is written as "replace call sites tier by
 * tier", which reads as a refactor whose size is the count. It is not: a call
 * site can only be repointed if the owned store has somewhere to put it, and
 * for a large share of them it does not — by decision, not by omission.
 *
 * So this crosses every production call site against the entity's disposition
 * and reports the two populations separately. The count was never the
 * question; the destination is.
 *
 * WHAT `store_can_hold` DOES NOT MEAN. It means the record store has a table
 * for that entity, or the generic broker family serves that read, or D25's
 * trail is the successor. It does NOT mean a ported capability covers the
 * operation — that is a narrower question this tool deliberately does not
 * answer, because answering it by inference is how a bucket comes to claim
 * more than it measured. `pnpm run check:transition-disposition` owns it.
 *
 * Deterministic and offline. It reads `src/` through the ratchet's own walker
 * and matcher so the two totals cannot diverge; `tools-base44-surface.test.mjs`
 * and this tool's suite assert they agree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITY_CALL, sourceFiles } from './tools-base44-surface.mjs';

export const FORMAT = 'pennsync-frontend-destination';
export const FORMAT_VERSION = 1;
export const BASELINE_FILE = 'tools-frontend-destination-expectations.json';
export const MANIFEST_FILE = 'tools-transition-disposition.json';

/**
 * Every operation the frontend performs, classified by what the owned store
 * would need in order to serve it.
 *
 * Unknown operations FAIL rather than defaulting. A new one is either a read
 * the broker family might serve or a write it refuses, and guessing which is
 * the difference between "this is fine" and "this silently cannot work".
 */
export const READ_OPERATIONS = Object.freeze(['list', 'filter', 'get']);
export const WRITE_OPERATIONS = Object.freeze(['create', 'update', 'delete', 'bulkCreate', 'bulkUpdate']);
/**
 * Realtime has no seam in the owned store at all — not a table question, so it
 * is never `store_can_hold` however the entity is dispositioned.
 */
export const REALTIME_OPERATIONS = Object.freeze(['subscribe', 'unsubscribe']);

/** D25's three retired log tables, whose successor is the activity trail. */
export const AUDITED_ENTITIES = Object.freeze(['SecurityLog', 'SystemLog', 'UserActivity']);

/**
 * `undeclared` is a call site whose entity has no disposition at all. It is a
 * row like any other rather than a site the measurement skips, so the totals
 * still describe every call site the ratchet counted when the run is failing
 * for exactly this reason — a first version dropped it, and the report then
 * understated both the total and the unserved count in the one state where
 * somebody would read them closely.
 */
export const DESTINATIONS = Object.freeze([
  'record_store', 'broker_family', 'activity_trail',
  'no_table', 'broker_is_read_only', 'global_reference_is_read_only',
  'no_realtime_seam', 'export_archive_only', 'undeclared',
]);
/** Where the tenant decisions say which entities are D83 reference data. */
export const TENANT_DECISION_FILE = 'tools-tenant-decision.json';
/** The destinations that mean a call site has somewhere to go. */
export const SERVED = Object.freeze(['record_store', 'broker_family', 'activity_trail']);

export function classifyOperation(operation) {
  if (READ_OPERATIONS.includes(operation)) return 'read';
  if (WRITE_OPERATIONS.includes(operation)) return 'write';
  if (REALTIME_OPERATIONS.includes(operation)) return 'realtime';
  return null;
}

/**
 * Where one call site lands. `disposition` is the entity's, from the manifest.
 *
 * The broker split is the finding this tool exists to make visible: the family
 * serves its three entities READ-ONLY (D2's ceiling, re-checked per schema by
 * D22), so a `create` on a brokered entity has no destination even though the
 * entity is "served".
 */
export function destinationFor(disposition, operation) {
  const kind = classifyOperation(operation);
  if (!kind) throw new Error(`FRONTEND_DESTINATION_UNKNOWN_OPERATION:${operation}`);
  if (kind === 'realtime') return 'no_realtime_seam';
  switch (disposition) {
    case 'port':
      return 'record_store';
    case 'broker':
      return kind === 'read' ? 'broker_family' : 'broker_is_read_only';
    case 'retire':
      return 'export_archive_only';
    case 'hub':
    case 'preserved_paused':
      return 'no_table';
    default:
      throw new Error(`FRONTEND_DESTINATION_UNKNOWN_DISPOSITION:${disposition}`);
  }
}

/**
 * A write to a D83 GLOBAL reference table has no destination either, and this
 * is the second reading of the same kind as the broker split above: the entity
 * is `port`, the table exists, and the call still cannot land.
 *
 * D83 says a `global` reference table is written by migration and never at run
 * time, and the store implements that — all eight have one read policy and
 * grant no caller role anything, which the suite reads out of the emitted SQL
 * rather than taking on trust. **The refusal is the GRANT, not the policy**:
 * `authenticated` never reaches a policy on these tables, so the error is
 * `permission denied for table`. That distinction is not cosmetic, because a
 * definer contract owned by the record owner COULD write them — "no write
 * path" is a decision D83 takes, not a wall the schema builds, so if D83 is
 * ever revisited these five sites become servable without a schema change.
 *
 * Until then, counting them as landable says the store can take a write it
 * refuses, which is exactly the overstatement this tool exists to prevent.
 */
export function refineGlobalReference(destination, operation, isGlobalReference) {
  return destination === 'record_store' && isGlobalReference
    && classifyOperation(operation) === 'write'
    ? 'global_reference_is_read_only' : destination;
}

/** The trail is a successor for a RETIRED LOG table and for nothing else. */
export function refineRetired(destination, entity) {
  return destination === 'export_archive_only' && AUDITED_ENTITIES.includes(entity)
    ? 'activity_trail' : destination;
}

export function measureDestinations(repository) {
  const manifest = JSON.parse(readFileSync(join(repository, MANIFEST_FILE), 'utf8'));
  const entities = manifest.entities || {};
  const decisions = JSON.parse(readFileSync(join(repository, TENANT_DECISION_FILE), 'utf8'));
  const globalReference = new Set(Object.entries(decisions.entities || {})
    .filter(([, decision]) => (decision && decision.kind) === 'global')
    .map(([entity]) => entity));
  const sites = [];
  const undeclared = new Set();
  for (const file of sourceFiles(join(repository, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(ENTITY_CALL)) {
      const entity = match[1];
      // The shared matcher ends at the dot, so the operation is the identifier
      // straight after it. Every call site the matcher counted is accounted
      // for, so this tool's total cannot disagree with the ratchet's: a site
      // whose entity has no disposition is a row with destination `undeclared`
      // (and fails the gate), and one whose operation is unknown — including
      // no identifier at all — fails the whole measurement in `destinationFor`
      // rather than being skipped.
      const tail = text.slice(match.index + match[0].length).match(/^\s*([a-zA-Z][A-Za-z0-9_]*)/);
      const operation = tail ? tail[1] : '';
      const disposition = entities[entity] ?? null;
      if (!disposition) undeclared.add(entity);
      sites.push({
        file: relative(repository, file),
        entity,
        operation,
        disposition,
        destination: disposition
          ? refineGlobalReference(
            refineRetired(destinationFor(disposition, operation), entity),
            operation, globalReference.has(entity))
          : 'undeclared',
      });
    }
  }
  return { sites, undeclared: [...undeclared].sort() };
}

export function summarise(measured) {
  const byDestination = Object.fromEntries(DESTINATIONS.map(name => [name, 0]));
  const byDisposition = {};
  const unservedEntities = {};
  for (const site of measured.sites) {
    byDestination[site.destination] += 1;
    byDisposition[site.disposition] = (byDisposition[site.disposition] || 0) + 1;
    if (!SERVED.includes(site.destination)) {
      const entry = unservedEntities[site.entity] ??= { disposition: site.disposition, destination: site.destination, sites: 0 };
      entry.sites += 1;
    }
  }
  const served = SERVED.reduce((total, name) => total + byDestination[name], 0);
  return {
    total: measured.sites.length,
    served,
    unserved: measured.sites.length - served,
    by_destination: byDestination,
    by_disposition: byDisposition,
    unserved_entities: Object.fromEntries(
      Object.entries(unservedEntities).sort((a, b) => b[1].sites - a[1].sites || (a[0] < b[0] ? -1 : 1))),
  };
}

export function parseBaseline(raw) {
  let baseline;
  try { baseline = JSON.parse(raw); } catch { throw new Error('BASELINE_INVALID_JSON'); }
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) throw new Error('BASELINE_INVALID_SHAPE');
  if (baseline.format !== FORMAT || baseline.version !== FORMAT_VERSION) throw new Error('BASELINE_UNSUPPORTED_FORMAT');
  if (!Number.isSafeInteger(baseline.maximum_unserved) || baseline.maximum_unserved < 0) {
    throw new Error('BASELINE_INVALID_MAXIMUM');
  }
  return baseline;
}

export function compare(measured, baseline) {
  const summary = summarise(measured);
  // Ratchets one way, like the surface baseline beside it: a new call site
  // reaching a domain with no destination is a build failure, and lowering the
  // number has to appear in a reviewed diff.
  const regressed = summary.unserved > baseline.maximum_unserved;
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    ...summary,
    maximum_unserved: baseline.maximum_unserved,
    undeclared_entities: measured.undeclared,
    within_baseline: !regressed && measured.undeclared.length === 0,
    regressed,
  };
}

export function main(args = process.argv.slice(2), {
  repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync,
} = {}) {
  if (args.some(argument => !['--json', '--summary', '--update'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let measured;
  try { measured = measureDestinations(repository); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'MEASUREMENT_FAILED' })); return 2; }
  const baselinePath = join(repository, BASELINE_FILE);
  if (args.includes('--update')) {
    const summary = summarise(measured);
    write(baselinePath, `${JSON.stringify({
      format: FORMAT, version: FORMAT_VERSION, maximum_unserved: summary.unserved,
    }, null, 2)}\n`);
    log(JSON.stringify({ updated: relative(repository, baselinePath), maximum_unserved: summary.unserved }, null, 2));
    return 0;
  }
  let baseline;
  try { baseline = parseBaseline(readFileSync(baselinePath, 'utf8')); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'BASELINE_UNAVAILABLE' })); return 2; }
  const report = compare(measured, baseline);
  if (args.includes('--summary')) {
    log(`frontend destinations ${report.within_baseline ? 'within baseline' : 'REGRESSED'}: `
      + `${report.total} call sites, ${report.served} can land, `
      + `${report.unserved}/${report.maximum_unserved} cannot`);
    for (const [name, count] of Object.entries(report.by_destination)) {
      if (count && !SERVED.includes(name)) log(`  ${name}: ${count}`);
    }
  } else {
    log(JSON.stringify(report, null, 2));
  }
  return report.within_baseline ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
