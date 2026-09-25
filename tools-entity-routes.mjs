#!/usr/bin/env node
/**
 * Every declared entity route names a shipped handler and a real call site.
 *
 * `src/lib/independentEntityRoutes.js` is the only place the frontend's entity
 * calls reach the owned store, so a wrong declaration there is the whole of
 * Stage J's correctness. Two things can go wrong silently and this refuses
 * both.
 *
 * A route can name a handler the service does not serve. `PORTED_FUNCTIONS` is
 * what the authority client will call and `HANDLER_NAMES` is what the service
 * implements; a route has to be in both, and checking one is how a name that
 * exists in the registry but is unreachable from the browser passes.
 *
 * A route can name an entity operation the frontend never performs. That reads
 * as coverage and is not: it moves no call site, and it would keep reading as
 * coverage after the screen it was written for was deleted. So each route is
 * crossed against the destination gate's own measurement of `src/` — the same
 * walker and matcher the surface ratchet uses, so the three tools cannot
 * disagree about what a call site is.
 *
 * It also reports how far Stage J has got, which is the number this repository
 * had no way to state: routed call sites out of the ones that CAN land. It is
 * a report rather than a ratchet, because the count moves per adopted screen
 * and a baseline file would need re-writing on every one of them.
 *
 * Deterministic and offline.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HANDLER_NAMES } from './services/pennsync-api/handlers.mjs';
import { PORTED_FUNCTIONS } from './services/authority-client/client.mjs';
import { ENTITY_ROUTES } from './src/lib/independentEntityRoutes.js';
import { READ_OPERATIONS, SERVED, measureDestinations } from './tools-frontend-destination.mjs';
import { auditBrokerCeiling, brokerWritable, locatorPaths } from './tools-tenant-decision.mjs';
import { buildPaths, readEntity } from './tools-tenant-path.mjs';

export const FORMAT = 'pennsync-entity-routes';
export const FORMAT_VERSION = 1;
/** A route's `reason` has to say something; a placeholder is not a reason. */
export const MINIMUM_REASON = 20;


/**
 * What a WIDER generic family could reach, for the call sites no route serves.
 *
 * The obvious plan for the unrouted remainder is "widen the broker family
 * rather than write a named capability per entity", and it is worth knowing
 * before anybody starts whether that plan has a ceiling. D16's is the schema's
 * own `rls` block: a generic family may serve a read only where the schema
 * plainly permits one, and a write only where it plainly permits every write —
 * a condition is an authority decision the family cannot evaluate.
 *
 * So this applies that same test, reusing `tools-tenant-decision.mjs`'s own
 * audit rather than a second reading of the block, and reports how many of the
 * unrouted call sites are above it. It gates nothing: it is the input to a
 * decision about what the remainder costs, and a number that moves as schemas
 * change should not fail a build.
 *
 * It runs the WHOLE of `auditBrokerCeiling`, not the read predicate alone, and
 * the difference is not academic. A first version asked only whether the
 * schema permits a read, reported 31 reads, and that number went out as the
 * size of a buildable slice. The ceiling also refuses an entity that names a
 * clinical subject, carries a credential, can hold a file, or reaches tenancy
 * through a clinical entity — and two of the twelve entities behind those 31
 * fail exactly there: `PDFTemplate` names a `document_id`, `AgencySettings`
 * carries a credential digest. The real slice is 25 across 10 entities. A
 * bound reported as an answer is how a plan gets sized against work that
 * cannot be done, so this reports what the ceiling reports.
 */
function genericFamilyReach(repository, unrouted) {
  let reads = 0;
  let writes = 0;
  // Built once: the tenant path is one of the ceiling's inputs, and rebuilding
  // it per entity would read every schema in the tree for each of forty.
  const byEntity = new Map(buildPaths(repository).entities.map(path => [path.entity, path]));
  const clears = new Map();
  const schemas = new Map();
  for (const site of unrouted) {
    if (!clears.has(site.entity)) {
      let schema = null;
      try { schema = readEntity(repository, site.entity); } catch { schema = null; }
      schemas.set(site.entity, schema);
      // No exemption is passed. `broker_ceiling` exemptions are per entity in
      // the manifest and only exist for entities already dispositioned
      // `broker`; granting one to an entity nobody has decided about would be
      // this tool inventing the decision it is trying to measure.
      clears.set(site.entity, schema !== null && auditBrokerCeiling({
        entity: site.entity,
        schema,
        path: byEntity.get(site.entity),
        locators: locatorPaths(repository, site.entity),
      }).length === 0);
    }
    if (!clears.get(site.entity)) continue;
    if (READ_OPERATIONS.includes(site.operation)) reads += 1;
    else if (brokerWritable(schemas.get(site.entity))) writes += 1;
  }
  return {
    unrouted_entities: schemas.size,
    generic_family_entities: [...clears.values()].filter(Boolean).length,
    generic_family_reads: reads,
    generic_family_writes: writes,
    needs_named_capability: unrouted.length - reads - writes,
  };
}

/**
 * `routes` is a parameter so a test can PLANT a wrong declaration and watch
 * this refuse it. A guard that has only ever been run against a correct input
 * has not been shown to bite.
 */
export function measureRoutes(repository, routes = ENTITY_ROUTES) {
  const measured = measureDestinations(repository);
  const landable = measured.sites.filter(site => SERVED.includes(site.destination));
  const performed = new Set(measured.sites.map(site => `${site.entity}.${site.operation}`));

  const problems = [];
  for (const key of Object.keys(routes).sort()) {
    const route = routes[key];
    if (!Object.hasOwn(PORTED_FUNCTIONS, route.function)) {
      problems.push(`ENTITY_ROUTE_UNREACHABLE_FUNCTION:${key}:${route.function}`);
    }
    if (!HANDLER_NAMES.includes(route.function)) {
      problems.push(`ENTITY_ROUTE_UNKNOWN_HANDLER:${key}:${route.function}`);
    }
    if (!performed.has(key)) problems.push(`ENTITY_ROUTE_NO_CALL_SITE:${key}`);
    if (typeof route.reason !== 'string' || route.reason.trim().length < MINIMUM_REASON) {
      problems.push(`ENTITY_ROUTE_REASON_TOO_SHORT:${key}`);
    }
    if (typeof route.projection !== 'string' || route.projection === '') {
      problems.push(`ENTITY_ROUTE_PROJECTION_MISSING:${key}`);
    }
    // A route over a call site with nowhere to land would claim the store
    // serves an entity the migration decided not to carry.
    const sites = landable.filter(site => `${site.entity}.${site.operation}` === key);
    if (performed.has(key) && sites.length === 0) problems.push(`ENTITY_ROUTE_UNSERVABLE:${key}`);
  }

  const routedSites = landable.filter(
    site => Object.hasOwn(routes, `${site.entity}.${site.operation}`)).length;

  return {
    ...genericFamilyReach(repository,
      landable.filter(site => !Object.hasOwn(routes, `${site.entity}.${site.operation}`))),
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    routes: Object.keys(routes).length,
    landable_sites: landable.length,
    routed_sites: routedSites,
    unrouted_sites: landable.length - routedSites,
    problems: problems.sort(),
    ok: problems.length === 0,
  };
}

function main(argv, log = console.log, error = console.error) {
  const args = argv.slice(2);
  if (args.some(argument => !['--json', '--summary'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  const repository = resolve(dirname(fileURLToPath(import.meta.url)));
  const report = measureRoutes(repository);
  if (args.includes('--json')) log(JSON.stringify(report, null, 2));
  else {
    log(`entity routes: ${report.routes} declared, `
      + `${report.routed_sites}/${report.landable_sites} landable call sites routed, `
      + `${report.unrouted_sites} still to adopt`);
    log(`  of those ${report.unrouted_sites}, across ${report.unrouted_entities} entities: `
      + `a wider generic family could serve ${report.generic_family_reads} reads and `
      + `${report.generic_family_writes} writes above D16's ceiling; `
      + `${report.needs_named_capability} need a named capability`);
  }
  if (!report.ok) for (const problem of report.problems) error(problem);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv));
}

export { main };
