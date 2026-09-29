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
 * A route can be counted as serving a call it cannot serve. That was this
 * tool's own defect: it checked that `Entity.operation` was declared and
 * reported 36 adopted call sites where running the arguments serves none. So
 * every site is run. What running cannot decide is a call whose argument is a
 * variable, and that is a THIRD state rather than a failure — declared,
 * permitted, not counted — because a payload's fields are refused by the
 * contract against the real migration, which is a better check than this one
 * and not this one's to pre-empt.
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
import { callArguments } from './tools-entity-call-arguments.mjs';

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
 * Whether each call site's OWN ARGUMENTS survive its route, one call at a time.
 *
 * This is the correction the tool most needed. It used to count a site as
 * routed when `Entity.operation` was DECLARED, and reported 36 adopted call
 * sites for the roster — of which, run, **zero** succeeded: 31 ask the staff
 * list to sort by `created_date` or `full_name`, which the roster contract
 * projects neither of, and the other 5 asked for more rows than its ceiling.
 * The rule this file states is "a route is a claim about a call site that
 * exists", and checking only that the site exists is the shallower half of it:
 * a route has to be able to SERVE the call, and the only way to know is to run
 * the call's arguments through it.
 *
 * Fails CLOSED in both directions. An argument the reader cannot resolve makes
 * the site unserved rather than assumed fine, and a `request` that throws
 * anything at all — not only the route's own refusal — is a site this cannot
 * claim.
 */
export function servedSites(repository, routes, expected) {
  const calls = callArguments(repository);
  // The two scans share the ratchet's walker and matcher, so a difference in
  // the totals means one of them has started reading a different population —
  // refused rather than reconciled, because whichever is right the number
  // would be describing something nobody chose.
  if (calls.length !== expected) {
    throw new Error(`ENTITY_ROUTE_CALL_SCAN_DISAGREES:${calls.length}:${expected}`);
  }
  const served = [];
  const refused = [];
  const unreadable = [];
  for (const call of calls) {
    const key = `${call.entity}.${call.operation}`;
    if (!Object.hasOwn(routes, key)) continue;
    if (call.arguments === null) { unreadable.push({ ...call, key }); continue; }
    try {
      routes[key].request(...call.arguments);
      served.push({ ...call, key });
    } catch (error) { refused.push({ ...call, key, because: error.detail ?? error.code ?? 'threw' }); }
  }
  return { served, refused, unreadable };
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

  const calls = servedSites(repository, routes, measured.sites.length);
  // A route nobody's arguments survive is the failure this whole correction is
  // about: it reads as adoption on the page, moves no screen, and would go on
  // reading as adoption forever. `NO_CALL_SITE` says the call is not made;
  // this says it is made and cannot be served.
  //
  // There are THREE states here and the first version of this loop had two,
  // which is a worse defect than the one it fixed. "Proved" and "refused" are
  // not the whole space: a call site whose argument is a variable —
  // `AgencySettings.create(payload)` — cannot be run through a route at all, and
  // treating that as "cannot be served" fails the build for 84 of the
  // frontend's writes, every one of which a contract is perfectly able to serve.
  // Refusing to COUNT an unproven route is the correction and stands. Refusing
  // to PERMIT one is a static check deciding a question that belongs to the
  // contract's own refusals, tested against the real migration at runtime.
  //
  // So a key fails only when a readable call site exists and none of them
  // survives, and a key whose every call site is unreadable is declared,
  // permitted, and reported as UNPROVED. It is never counted as adopted, and the
  // summary prints it, because an unproven route that nobody can see is how a
  // declaration comes to read as coverage again.
  const unproved = [];
  for (const key of Object.keys(routes).sort()) {
    if (!performed.has(key)) continue;
    const served = calls.served.some(call => call.key === key);
    const readable = served || calls.refused.some(call => call.key === key);
    if (readable && !served) problems.push(`ENTITY_ROUTE_SERVES_NO_CALL:${key}`);
    if (!readable) unproved.push(key);
  }
  // Removing the served sites from the remainder is a MULTISET operation, and
  // a Set here was a per-key answer standing in for a per-call one — the same
  // defect this gate was rebuilt to fix, arriving one layer out in the
  // arithmetic. `src/pages/ReferralTriage.jsx` calls `Task.create` twice, one
  // readable and one not, so a route over that key serves 1 and a Set dropped
  // 2: the three generic-family buckets then summed one short of
  // `unrouted_sites` and the gate failed its own test. Counting SERVED per
  // call and REMOVING per key cannot both be right.
  //
  // Which of a file's interchangeable sites is removed does not matter — the
  // remainder is read for its entity and operation only — but how MANY does.
  const servedPerKey = new Map();
  for (const call of calls.served) {
    const key = `${call.file}\u0000${call.key}`;
    servedPerKey.set(key, (servedPerKey.get(key) ?? 0) + 1);
  }
  const remaining = landable.filter(site => {
    const key = `${site.file}\u0000${site.entity}.${site.operation}`;
    const left = servedPerKey.get(key) ?? 0;
    if (left === 0) return true;
    servedPerKey.set(key, left - 1);
    return false;
  });
  const routedSites = calls.served.length;

  return {
    ...genericFamilyReach(repository, remaining),
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    routes: Object.keys(routes).length,
    landable_sites: landable.length,
    // Sites whose OWN arguments the declared route accepts. Never the number
    // of declarations, and never the number of sites a declaration covers.
    routed_sites: routedSites,
    declared_but_refused: calls.refused.length,
    declared_but_unreadable: calls.unreadable.length,
    // Declared and permitted, with no call site whose arguments this can run.
    // Not adoption: these sites stay in `unrouted_sites`.
    unproved_routes: Object.freeze([...unproved]),
    refusals: Object.freeze(calls.refused
      .map(call => `${call.key}:${call.because}`)
      .filter((value, index, all) => all.indexOf(value) === index).sort()),
    unrouted_sites: landable.length - routedSites,
    problems: problems.sort(),
    ok: problems.length === 0,
  };
}

/**
 * Everything the tool PRINTS, as the lines it prints, in order.
 *
 * Exported for the reason `portQueueLine` is: a page quoting this reading goes
 * stale silently and the only thing that can notice is a test comparing the
 * page against the tool. But `portQueueLine`'s shape does not transfer, and
 * finding out why is what this is. AGENTS.md carries that one line verbatim,
 * while the plan's Stage J paragraph carries a REFLOWED paraphrase of this
 * output — rewrapped, blockquoted, backticked, em-dashes where the tool has
 * line breaks. So a check asking whether the page contains the line would fail
 * on a page that is perfectly correct, and the obvious fix for that, comparing
 * the two with the prose normalised, is a SECOND representation of the reading:
 * the house defect, arriving inside the pin written to catch it.
 *
 * So the export is the printer rather than a sentence. A page that wants to be
 * checkable carries this output verbatim and reflows only the prose around it,
 * and there is exactly one place the wording lives. `main` logs these lines and
 * formats nothing itself, because a second copy here would be the same defect
 * one layer down.
 *
 * Every line carries figures, which is why they are all here and not just the
 * first: the three below it are the ones a reader would draw the first
 * version of this tool's wrong conclusion from.
 */
/**
 * What a RISE in each printed figure means.
 *
 * Every figure here moves under more than one cause, and the causes do not
 * agree about whether the news is good. `declared_but_refused` went from six
 * to nine while three routes were being declared correctly, and a reader
 * meeting that number cold would have read three new broken screens. The
 * reason this is worth a structure rather than a paragraph is the eventual
 * reader: a figure that moves the wrong way is the one that gets quoted to an
 * owner as a health number, and it would be read backwards.
 *
 * The class of claim this fixes, so a later figure's author can tell whether
 * theirs needs a line: an ARTEFACT WHOSE MEANING CANNOT BE READ OFF ITS OWN
 * DESCRIPTION. `declared_but_refused` is named accurately and still misleads,
 * because the name says what the figure counts and not which way it moves when
 * the work goes well. The sibling case is a suite whose titles name a rule it
 * checks on one entry point of three — every description agreeing, and the
 * agreement being the thing that hides it. If a new figure's name tells a
 * reader what it counts but not what a rise means, it needs a line here.
 *
 * `progress` is what a rise means when the repository got better, `regression`
 * when it got worse, and `instrument` when nothing in the product moved and
 * only this tool's reach changed. A figure whose `instrument` is not `null`
 * cannot be compared across two heads without checking that the scan is the
 * same on both.
 *
 * A third case exists beside those three and is the sharpest of them: a figure
 * whose direction is readable only while something else is true. `progress`
 * here may carry a `precondition` naming that condition, because a cause that
 * has quietly stopped being possible is a direction note asserting something
 * false about every future reading. Three entries below carry one, and all
 * three say the same thing — a rise can be a route arriving only while keys
 * with call sites remain undeclared. When Stage J finishes there are none, and
 * on that day a rise in `declared_but_refused` becomes unambiguously a
 * regression with nothing in the figure to show that its meaning changed. A
 * test asserts each precondition still HOLDS on this tree, so the day it stops
 * holding is a red rather than a quiet reinterpretation.
 *
 * The shape came from a sibling case outside this tool, where a printed total
 * can only rise while a store is behind and starts being ambiguous the moment
 * it is not. Same species: the world makes one of the causes unavailable, and
 * nothing in the number says so.
 *
 * MEASURED, not reasoned, wherever it says so: the entries marked `measured`
 * were established by running `measureRoutes` with a planted route object —
 * which is what that parameter exists for — and reading which figures moved.
 * The entries marked `derived` are read off the code path named in the text
 * and have no planted case, because the cause is a change to another tool.
 */
export const FIGURE_DIRECTIONS = Object.freeze({
  routes: Object.freeze({
    evidence: 'measured',
    progress: 'a route was declared. This is the only figure that counts the '
      + 'route table rather than the frontend, so nothing a screen does moves it.',
    regression: null,
    instrument: null,
  }),
  landable_sites: Object.freeze({
    evidence: 'derived',
    progress: 'an entity\'s disposition changed so its call sites now have '
      + 'somewhere to land. A rise here RAISES `unrouted_sites` by the same '
      + 'amount until routes catch up, so adoption looks further away because '
      + 'more of the work became possible.',
    regression: 'a screen added entity calls nobody has routed.',
    instrument: 'the shared walker or matcher in tools-frontend-destination.mjs '
      + 'started seeing sites it did not see before. `servedSites` refuses '
      + 'outright when the two scans disagree, so this cannot drift quietly — '
      + 'but it CAN move for an instrument reason on a single head.',
  }),
  routed_sites: Object.freeze({
    evidence: 'measured',
    progress: 'a declared route now serves call sites it did not serve. '
      + 'Measured: declaring one route whose request accepts the arguments took '
      + 'this from 145 to 157 and `unrouted_sites` from 100 to 88.',
    regression: 'a route stopped accepting arguments a screen still passes, or '
      + 'the screen changed what it passes.',
    instrument: 'a call site became readable that was not, moving it out of '
      + '`declared_but_unreadable`. Nothing in the product changed.',
  }),
  unrouted_sites: Object.freeze({
    evidence: 'measured',
    progress: null,
    regression: 'sites that could land still have no route serving them. But '
      + 'read `landable_sites` first: this is a SUBTRACTION, so it also rises '
      + 'whenever more sites become landable, which is progress.',
    instrument: 'inherited whole from `landable_sites` and `routed_sites`.',
  }),
  declared_but_refused: Object.freeze({
    evidence: 'measured',
    progress: 'a key that was previously SKIPPED became declared. `servedSites` '
      + 'passes over an undeclared key entirely, so a site is invisible until a '
      + 'route claims it and only then can be counted as refused. Measured: '
      + 'declaring one refusing route over an undeclared key took this from 9 '
      + 'to 21 with `landable_sites`, `routed_sites` and `unrouted_sites` all '
      + 'unchanged. A rise here is usually a route arriving, not a screen '
      + 'breaking.',
    precondition: 'keys with landable call sites remain undeclared',
    regression: 'a route already serving a key stopped accepting some of its '
      + 'sites. A route that refuses ALL of a key\'s readable sites does not '
      + 'reach this figure at all — it fails the build as '
      + 'ENTITY_ROUTE_SERVES_NO_CALL — so what lands here is always a partial.',
    instrument: 'a site became readable and its declared route refuses it; it '
      + 'moves out of `declared_but_unreadable` into this.',
  }),
  declared_but_unreadable: Object.freeze({
    evidence: 'derived',
    progress: 'a key became declared whose call sites pass variables. Same '
      + 'skipping rule as `declared_but_refused`: undeclared keys are not '
      + 'counted anywhere.',
    precondition: 'keys with landable call sites remain undeclared',
    regression: 'a screen replaced literal arguments with a variable. Not a '
      + 'defect — the contract\'s own refusals check those calls — but this '
      + 'tool can no longer say anything about them.',
    instrument: 'this FALLS when tools-entity-call-arguments.mjs learns to '
      + 'resolve an argument it could not, which moves the site into '
      + '`routed_sites` or `declared_but_refused`. So a fall here is not '
      + 'adoption and the rise it causes elsewhere is not either.',
  }),
  unproved_routes: Object.freeze({
    evidence: 'derived',
    progress: 'a route was declared whose every call site passes a variable. '
      + 'Declared and permitted, never counted as adopted.',
    precondition: 'keys with landable call sites remain undeclared',
    regression: null,
    instrument: 'falls when the argument reader resolves one of that key\'s '
      + 'sites, which decides the route either way without anybody editing it.',
  }),
  refusals: Object.freeze({
    evidence: 'derived',
    progress: 'a new DISTINCT reason appeared, so this counts kinds of refusal '
      + 'and not sites. It can stay flat while `declared_but_refused` moves by '
      + 'twelve, and it can rise while that figure falls.',
    regression: 'same, from the other side.',
    instrument: null,
  }),
  unrouted_entities: Object.freeze({
    evidence: 'derived',
    progress: null,
    regression: 'entities with unserved sites. Moves with `unrouted_sites` and '
      + 'carries its ambiguity: a disposition that makes an entity landable '
      + 'raises this.',
    instrument: 'inherited from `landable_sites`.',
  }),
  generic_family_entities: Object.freeze({
    evidence: 'derived',
    progress: null,
    regression: null,
    instrument: 'this and the three figures below it answer what a WIDER '
      + 'family could reach, so they move when an entity SCHEMA changes — '
      + 'neither progress nor regression in this tool\'s terms, and a rise is '
      + 'an input to a decision rather than a result.',
  }),
  generic_family_reads: Object.freeze({
    evidence: 'derived',
    progress: null,
    regression: null,
    instrument: 'an `rls` block started plainly permitting a read, or the '
      + 'ceiling audit changed. Never a statement that anything was built.',
  }),
  generic_family_writes: Object.freeze({
    evidence: 'derived',
    progress: null,
    regression: null,
    instrument: 'as above. It has been 0 since D16\'s ceiling was applied '
      + 'whole, and a rise wants reading against the ceiling rather than '
      + 'celebrating.',
  }),
  needs_named_capability: Object.freeze({
    evidence: 'derived',
    progress: null,
    regression: 'the remainder that no widening can serve. Rises with '
      + '`unrouted_sites` and inherits its ambiguity exactly.',
    instrument: 'inherited from `landable_sites`.',
  }),
  problems: Object.freeze({
    evidence: 'measured',
    progress: null,
    regression: 'the gate failed. This is the one figure with no benign cause: '
      + 'non-zero is non-zero, and `ok` is its restatement.',
    instrument: null,
  }),
});

/**
 * The figures that are NOT measurements, named rather than pattern-matched.
 *
 * A test crosses `FIGURE_DIRECTIONS` against the report in both directions and
 * fails on a figure with no direction, so a figure added later cannot arrive
 * undocumented. That check needs to know what is deliberately exempt, and a
 * rule like "skip anything not a number" would silently exempt the next
 * figure that happens to be a string.
 */
export const NOT_A_MEASUREMENT = Object.freeze(['format', 'schema_version', 'ok']);

export function summaryLines(report) {
  const lines = [
    `entity routes: ${report.routes} declared, `
      + `${report.routed_sites}/${report.landable_sites} landable call sites SERVED, `
      + `${report.unrouted_sites} still to adopt`,
    // Printed rather than left in the JSON: these are call sites a route was
    // written for and cannot serve, which is the number the tool used to
    // report as adoption. A reader who sees only the first line would draw the
    // same wrong conclusion the first version of this tool did.
    // The parenthesis holds `refusals`, which is the only figure in
    // FIGURE_DIRECTIONS whose count is never printed as a number: what a
    // reader meets is the LIST, sitting immediately after a total it does not
    // decompose. Four reasons beside nine sites reads as four of the nine,
    // and it is neither — one reason can account for every site or for one.
    // Its direction entry says they move independently; this is where a
    // reader would need to know it. `unproved_routes` is the same kind of
    // value and is NOT in that position: its own `.length` prints directly in
    // front of its list, so the number and the names are one quantity.
    `  ${report.declared_but_refused} of those are sites a declared route REFUSES`
      + `${report.refusals.length ? ` (${report.refusals.join(', ')})` : ''}`
      + `, and ${report.declared_but_unreadable} pass arguments this cannot read`,
  ];
  // Conditional, as the printed output has always had it: a build with no
  // unproved route says nothing rather than saying zero, and a page pinning
  // this output carries the line exactly when the tool does.
  if (report.unproved_routes.length) {
    lines.push(`  ${report.unproved_routes.length} route(s) are declared but UNPROVED — every call site passes a `
      + `variable, so the contract's own refusals are what checks them: ${report.unproved_routes.join(', ')}`);
  }
  lines.push(`  of those ${report.unrouted_sites}, across ${report.unrouted_entities} entities: `
    + `a wider generic family could serve ${report.generic_family_reads} reads and `
    + `${report.generic_family_writes} writes above D16's ceiling; `
    + `${report.needs_named_capability} need a named capability`);
  return lines;
}

/**
 * The direction notes as lines. Exported and deliberately NOT wired to a flag.
 *
 * This tool prints exactly what it printed before: AGENTS.md carries one of
 * those lines verbatim and a test compares the page against `summaryLines`, so
 * putting a direction into a printed line would break the pin that exists to
 * stop the page drifting — a second copy of the wording, which is the house
 * defect this whole structure is against. An audit that introduced one would
 * be an odd audit.
 *
 * So the printer exists, is tested, and has no caller in `main`. Giving the
 * terminal reader the direction is a SECOND change: it has to move AGENTS.md's
 * pin and the plan's reflowed paraphrase together, and whether it is worth
 * doing is answerable only once somebody knows how many figures there are and
 * how many of them actually move the wrong way. Derived from this structure
 * rather than counted by hand: fourteen figures, nine where a rise has more
 * than one cause, seven where a rise can be progress, and five where one rise
 * can be either progress or regression depending on what moved. A test pins
 * those four counts, so the sentence cannot go stale while the structure does
 * not.
 */
export function directionLines(directions = FIGURE_DIRECTIONS) {
  const lines = ['what a RISE in each figure means:'];
  for (const [figure, note] of Object.entries(directions)) {
    lines.push(`  ${figure} (${note.evidence})`);
    for (const cause of ['progress', 'regression', 'instrument']) {
      if (note[cause]) lines.push(`    ${cause}: ${note[cause]}`);
    }
  }
  return lines;
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
  else log(summaryLines(report).join('\n'));
  if (!report.ok) for (const problem of report.problems) error(problem);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv));
}

export { main };
