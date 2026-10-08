import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HANDLER_NAMES } from './services/pennsync-api/handlers.mjs';
import { PORTED_FUNCTIONS } from './services/authority-client/client.mjs';
import { ARGUMENTS_UNSUPPORTED, ENTITY_ROUTES, ROUTED_OPERATIONS, routeFor }
  from './src/lib/independentEntityRoutes.js';
import { FIGURE_DIRECTIONS, MINIMUM_REASON, NOT_A_MEASUREMENT, directionLines, main, measureRoutes,
  servedSites, summaryLines }
  from './tools-entity-routes.mjs';
import { callArguments } from './tools-entity-call-arguments.mjs';
import { READ_OPERATIONS, SERVED, measureDestinations } from './tools-frontend-destination.mjs';
import { auditBrokerCeiling, brokerReadable, locatorPaths } from './tools-tenant-decision.mjs';
import { buildPaths, readEntity } from './tools-tenant-path.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));

/** A declaration that is correct in every way the gate checks. */
const sound = (overrides = {}) => Object.freeze({
  function: 'listAgencyRoster',
  projection: 'roster',
  reason: 'A reason long enough to say something about why this route is the successor.',
  request: () => ({}),
  response: (result) => result.entries,
  ...overrides,
});

test('the committed declarations pass', () => {
  const report = measureRoutes(repository);
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
  // The point of the report: how much of the landable surface is adopted.
  assert.ok(report.routed_sites > 0, 'a route that serves no call site is not progress');
  assert.equal(report.routed_sites + report.unrouted_sites, report.landable_sites);
});

/**
 * The correction this tool most needed, kept as a test so it cannot come back.
 *
 * `routed_sites` used to count a call site as adopted when its
 * `Entity.operation` was DECLARED. It reported 36 for the staff roster, and
 * running those 36 calls' own arguments through the route refuses every one —
 * 31 ask for an order over a field the roster does not project, and the rest
 * asked for more rows than its ceiling. A number that can be produced without
 * running the thing is not a measurement of the thing.
 */
test('a site is adopted only when its own arguments survive the route', () => {
  const report = measureRoutes(repository);
  const calls = servedSites(repository, ENTITY_ROUTES, measureDestinations(repository).sites.length);
  assert.equal(report.routed_sites, calls.served.length);
  for (const call of calls.served) {
    // Re-run, because the count is only worth what the call proves.
    assert.doesNotThrow(() => ENTITY_ROUTES[call.key].request(...call.arguments), call.file);
  }
  // And the refused ones really do refuse, with the route's own code.
  for (const call of calls.refused) {
    assert.throws(() => ENTITY_ROUTES[call.key].request(...call.arguments),
      error => error.code === ARGUMENTS_UNSUPPORTED, call.file);
  }
  assert.ok(calls.refused.length > 0,
    'with nothing refused this test would pass without the distinction existing');
});

/**
 * A declaration nothing can use reads as adoption on the page and moves no
 * screen, which is what the roster route did for a day. `NO_CALL_SITE` says
 * the call is never made; this says it is made and cannot be served.
 */
test('a route no real call survives is refused, not counted', () => {
  const refusing = {
    'User.list': Object.freeze({
      ...ENTITY_ROUTES['User.list'],
      request: () => { const error = new Error(ARGUMENTS_UNSUPPORTED); error.code = ARGUMENTS_UNSUPPORTED; throw error; },
    }),
  };
  const report = measureRoutes(repository, refusing);
  assert.equal(report.ok, false);
  assert.ok(report.problems.includes('ENTITY_ROUTE_SERVES_NO_CALL:User.list'), report.problems);
  assert.equal(report.routed_sites, 0);
});

/**
 * The third state, and the reason it exists.
 *
 * The version of this gate that had two states failed the build for any route
 * whose call sites all pass a variable — `AgencySettings.create(payload)`,
 * `NoteConversion.create(fields)` — which is 84 of the frontend's writes and
 * every one of them servable by a contract. Not COUNTING an unproven route is
 * the correction and is asserted above; not PERMITTING one was a static check
 * deciding what the contract's own refusals decide against the real migration.
 *
 * `DocumentTemplate.create` is the real shape: a landable write whose only call
 * site passes a variable. Declared, it must pass and appear as unproved, and it
 * must not move the adopted count by one.
 */
test('a route whose every call site passes a variable is permitted, not counted', () => {
  const baseline = measureRoutes(repository);
  const routes = { ...ENTITY_ROUTES, 'DocumentTemplate.create': sound() };
  const report = measureRoutes(repository, routes);
  assert.deepEqual(report.problems, [], 'an unreadable call site is not a failure');
  assert.ok(report.unproved_routes.includes('DocumentTemplate.create'), report.unproved_routes);
  assert.equal(report.routed_sites, baseline.routed_sites,
    'an unproved route is not adoption');
  // And the distinction really is about READABILITY, not about writes: the
  // roster route has readable call sites, so it is proved rather than unproved.
  assert.ok(!report.unproved_routes.includes('User.list'));
});

test('every declared route names a handler reachable from the browser', () => {
  for (const key of ROUTED_OPERATIONS) {
    const route = ENTITY_ROUTES[key];
    assert.ok(Object.hasOwn(PORTED_FUNCTIONS, route.function), `${key} not in PORTED_FUNCTIONS`);
    assert.ok(HANDLER_NAMES.includes(route.function), `${key} not implemented by the service`);
  }
});

/**
 * Each case is a real way a declaration goes wrong, PLANTED and then checked to
 * produce its own refusal. A gate run only against a correct input has been
 * shown to stay quiet, which is not the same as biting.
 */
test('a wrong declaration is refused, one shape at a time', () => {
  const cases = [
    ['ENTITY_ROUTE_UNKNOWN_HANDLER', { 'User.list': sound({ function: 'noSuchHandler' }) }],
    ['ENTITY_ROUTE_UNREACHABLE_FUNCTION', { 'User.list': sound({ function: 'noSuchHandler' }) }],
    // An entity operation the frontend never performs: coverage that moves no
    // call site, and would keep reading as coverage after the screen went.
    ['ENTITY_ROUTE_NO_CALL_SITE', { 'User.somethingNobodyCalls': sound() }],
    ['ENTITY_ROUTE_REASON_TOO_SHORT', { 'User.list': sound({ reason: 'because' }) }],
    ['ENTITY_ROUTE_PROJECTION_MISSING', { 'User.list': sound({ projection: '' }) }],
  ];
  for (const [code, routes] of cases) {
    const report = measureRoutes(repository, routes);
    assert.equal(report.ok, false, `${code} was not refused`);
    assert.ok(report.problems.some(problem => problem.startsWith(`${code}:`)),
      `${code} missing from ${JSON.stringify(report.problems)}`);
  }
});

/**
 * A route over an entity the migration decided NOT to carry would claim the
 * owned store serves it. `TrainingCourse` is `hub`: 28 call sites, no table.
 */
test('a route over an entity with nowhere to land is refused', () => {
  const report = measureRoutes(repository, { 'TrainingCourse.list': sound() });
  assert.ok(report.problems.includes('ENTITY_ROUTE_UNSERVABLE:TrainingCourse.list'), report.problems);
});

test('routeFor answers only for a declared operation', () => {
  assert.equal(routeFor('User', 'list'), ENTITY_ROUTES['User.list']);
  assert.equal(routeFor('User', 'create'), null);
  assert.equal(routeFor('TrainingCourse', 'list'), null);
  // `routeFor` builds its key by concatenation, so a prototype name must not
  // resolve: `Object.hasOwn` is what keeps `constructor` from being a route.
  assert.equal(routeFor('Object', 'constructor'), null);
});

/**
 * The remainder's cost, measured rather than assumed.
 *
 * "Widen the generic family instead of writing a capability per entity" is the
 * obvious plan for the 206 call sites no route serves, and D16's ceiling
 * decides whether it can work. An answer of zero writes is a RESULT and not a
 * bug, so the test states which halves are real and which are merely
 * consistent.
 */
/**
 * The number this reports was wrong twice before it was right, both times
 * upward, and both times because the audit was asked less than the whole
 * question. First it applied only the read predicate (31 sites). Then it was
 * hand-run with an empty `locators` list, so the file-layer check could not
 * fire (25). The answer is 23, and `LibraryDocument` is the proof the gate now
 * asks the whole question: its schema plainly permits a read, so the predicate
 * alone admits it, and the ceiling refuses it for holding a file.
 *
 * The general rule is worth more than the number: a check run with one of its
 * inputs empty reports CLEAR for a reason that has nothing to do with the
 * thing being clear. So the gate builds its own inputs and nothing hand-runs
 * the audit.
 */
test('the ceiling is the whole audit, not the half of it that answers first', () => {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)));
  const paths = new Map(buildPaths(repository).entities.map(path => [path.entity, path]));
  const schema = readEntity(repository, 'LibraryDocument');
  assert.equal(brokerReadable(schema), true, 'the read predicate alone would admit it');
  const problems = auditBrokerCeiling({
    entity: 'LibraryDocument',
    schema,
    path: paths.get('LibraryDocument'),
    locators: locatorPaths(repository, 'LibraryDocument'),
  });
  assert.ok(problems.some(problem => problem.includes('can hold a file')), problems);
  // And with the locators left out — the way it was hand-run — it comes back
  // clear, which is exactly why no caller supplies them any more.
  assert.deepEqual(auditBrokerCeiling({
    entity: 'LibraryDocument', schema, path: paths.get('LibraryDocument'), locators: [],
  }), []);
});

test('what a wider generic family could reach is reported and adds up', () => {
  const report = measureRoutes(repository);
  assert.ok(report.unrouted_entities > 0);
  assert.equal(
    report.generic_family_reads + report.generic_family_writes + report.needs_named_capability,
    report.unrouted_sites,
    'every unrouted call site is in exactly one of the three');
  // Nothing here asserts a number that moves with the schemas. What it does
  // assert is that the measurement ran: a silent failure to read a schema
  // would report every site as needing a named capability.
  assert.ok(report.generic_family_reads > 0,
    'no read cleared the ceiling, which would mean the schemas were not read at all');
  assert.ok(report.generic_family_entities > 0
    && report.generic_family_entities < report.unrouted_entities,
  'the ceiling admits some entities and refuses others; all or none means it did not run');
});

/**
 * The counting bug batch D measured, kept as its own case.
 *
 * Served sites were counted one per CALL and removed from the remainder one
 * per FILE-AND-OPERATION, so a file calling the same operation twice with only
 * one served lost both from the remainder while one was counted — the three
 * generic-family buckets then summed one short of `unrouted_sites`. Latent
 * since the gate was rebuilt, and only reachable once a route existed over a
 * key one file calls twice.
 *
 * The case needs a file that calls one operation twice with one argument
 * readable and one not, so a route accepting anything serves exactly one of the
 * two. `src/pages/ReferralTriage.jsx`'s two `Task.create` calls were that file,
 * and the plant NAMED that key — which made the test a hostage of the route:
 * declaring `Task.create` put it in the baseline, `routed_sites > baseline`
 * stopped holding, and the hold was recorded in another batch's file with the
 * remedy "name a key no batch declares". Repointing it moves that wall one
 * route along and the next thread hits it with no record of why.
 *
 * So the plant is DERIVED, and the derivation is the point rather than a
 * tidy-up: whatever undeclared landable pair the tree currently has in that
 * shape supplies it, and a tree with none REFUSES rather than skipping — which
 * is the honest failure, because the case would then be unreachable and a green
 * test claiming to measure it would be measuring nothing.
 *
 * It also no longer carries the coverage alone. Declaring the clinical-library
 * writes put two DECLARED pairs into this shape — both of
 * `ClinicalLibraryManager.jsx`'s `update` calls — so the committed report
 * exercises the multiset subtraction with no plant at all, and the bucket-sum
 * assertion in `what a wider generic family could reach is reported and adds
 * up` fails by exactly two if the Set comes back. That was measured by
 * restoring the Set and watching THREE tests fail, not assumed: this one, that
 * one, and the plan-document pin.
 */
/**
 * The fixture is HARVESTED from the tree, so the tree can run out of it.
 *
 * It did. This filtered to an UNDECLARED landable key, because the baseline it
 * compares against was the committed routes and a key already in them cannot
 * raise `routed_sites` by being declared again. Every key of the right shape
 * has since been declared -- `AdrAuditCase.update` was the last, in the
 * compliance write routes -- and the test refused rather than skipping, which
 * is the behaviour that made this visible at all.
 *
 * The fix is to stop requiring the key to be undeclared and to build the
 * BASELINE without it instead: the property under test is that a served site
 * leaves the remainder once rather than once per key, and nothing in it cares
 * whether the committed routes happen to declare that key today. A fixture
 * whose availability depends on which ports have shipped is a test that goes
 * quiet on a schedule nobody chose.
 *
 * What is NOT relaxed is landability. A route over a key with nowhere to land
 * raises `ENTITY_ROUTE_UNSERVABLE`, which the assertion on `problems` below
 * would catch -- and the two remaining candidates of this shape,
 * `FaxTemplate.update` and `LearningPlanCourse.create`, are exactly that case.
 */
test('a served site is removed from the remainder once, not per key', () => {
  const landable = new Set(measureDestinations(repository).sites
    .filter(site => SERVED.includes(site.destination))
    .map(site => `${site.entity}.${site.operation}`));
  const grouped = new Map();
  for (const call of callArguments(repository)) {
    const pair = `${call.file}\u0000${call.entity}.${call.operation}`;
    if (!grouped.has(pair)) grouped.set(pair, []);
    grouped.get(pair).push(call);
  }
  // Sorted so the chosen pair is a property of the tree and not of map order:
  // a test that measures a different case on two runs of one commit is not one
  // case proved, it is two cases each proved half the time.
  const candidates = [...grouped]
    .map(([pair, calls]) => {
      const [file, key] = pair.split('\u0000');
      return { file, key, readable: calls.filter(call => call.arguments !== null).length,
        total: calls.length };
    })
    .filter(candidate => landable.has(candidate.key)
      && candidate.readable === 1 && candidate.total > candidate.readable)
    .sort((left, right) => (left.key + left.file).localeCompare(right.key + right.file));
  assert.ok(candidates.length > 0,
    'no landable key has one readable call and one unreadable one in a single\n'
    + '  file, so the case this test exists for cannot be reached on this tree. It is a\n'
    + '  REFUSAL rather than a skip: the multiset subtraction is still exercised by the\n'
    + '  committed report, whose bucket sum falls short if a Set comes back, but the\n'
    + '  planted half of the proof is gone and something has to say so.');
  const chosen = candidates[0];

  // Measured WITHOUT the chosen key, so declaring it below is a real change
  // whether or not the committed routes already carry it.
  const without = { ...ENTITY_ROUTES };
  delete without[chosen.key];
  const baseline = measureRoutes(repository, without);

  const routes = { ...without, [chosen.key]: sound({ request: () => ({}) }) };
  const report = measureRoutes(repository, routes);
  assert.deepEqual(report.problems, []);

  const calls = servedSites(repository, routes, measureDestinations(repository).sites.length);
  const doubled = calls.served.filter(call =>
    call.file === chosen.file && call.key === chosen.key);
  assert.equal(doubled.length, 1,
    `${chosen.file} must have one served call and one unreadable one for ${chosen.key}`);

  // The arithmetic the Set broke. Both halves, because either alone passes
  // with the other wrong.
  assert.equal(report.routed_sites + report.unrouted_sites, report.landable_sites);
  assert.equal(
    report.generic_family_reads + report.generic_family_writes + report.needs_named_capability,
    report.unrouted_sites,
    'the buckets sum short when a key is removed once for two served calls');
  assert.ok(report.routed_sites > baseline.routed_sites);
});

test('the exported summary is what the tool prints, not a second copy', () => {
  // The export exists so a page carrying this reading can be compared against
  // the tool. That comparison is worth nothing if `main` formats its own copy,
  // so this asserts the one property the pin rests on: there is a single
  // wording, and both callers get it.
  const printed = [];
  const code = main(['node', 'tools-entity-routes.mjs'], line => printed.push(line), () => {});
  assert.equal(code, 0);
  assert.equal(printed.join('\n'), summaryLines(measureRoutes(repository)).join('\n'));
  // And it still carries the figures, so a version returning a constant —
  // which satisfies the equality above — fails here.
  assert.match(printed.join('\n'),
    /^entity routes: \d+ declared, \d+\/\d+ landable call sites SERVED, \d+ still to adopt\n/);
  assert.match(printed.join('\n'), /\d+ need a named capability$/);
});

test('the unproved line is there exactly when there is an unproved route', () => {
  // A page pinning this output carries the line when the tool prints it and
  // not otherwise, so the condition is part of the contract rather than a
  // formatting detail. Driven from a synthetic report because the committed
  // tree's own state would only ever exercise one of the two branches.
  const report = {
    routes: 3, routed_sites: 4, landable_sites: 5, unrouted_sites: 1,
    declared_but_refused: 0, declared_but_unreadable: 0, refusals: [],
    unrouted_entities: 1, generic_family_reads: 0, generic_family_writes: 0,
    needs_named_capability: 1, unproved_routes: [],
  };
  assert.equal(summaryLines(report).length, 3);
  assert.equal(summaryLines({ ...report, unproved_routes: ['Visit.list'] }).length, 4);
  assert.match(summaryLines({ ...report, unproved_routes: ['Visit.list'] })[2], /UNPROVED.*Visit\.list/);
});

const PLAN = 'docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md';

/**
 * The figures that have actually drifted, by the name the report gives them.
 * Not every number in the report: `generic_family_reads` and its siblings are
 * single digits, which cannot be told from ordinary prose by value, and that
 * limit is recorded rather than worked around — see the prose test below.
 */
const PINNED_FIGURES = [
  'routes', 'routed_sites', 'landable_sites', 'unrouted_sites', 'needs_named_capability',
];

function fencedBlocks(page) {
  const blocks = [];
  let open = null;
  for (const line of page.split('\n')) {
    if (line.startsWith('```')) {
      if (open === null) open = [];
      else { blocks.push(open.join('\n')); open = null; }
      continue;
    }
    if (open !== null) open.push(line);
  }
  return blocks;
}

/**
 * Stage J's prose about the pinned block, with fenced blocks removed: from the
 * end of the block to the next heading of any level.
 *
 * BOTH ends are measured rather than convenient, and both for the same reason:
 * Stage J describes two instruments, and the other one's figures are prose
 * here. Above the block are the destination gate's landable count and a
 * Base44-surface count of function invocations; below it, before the boundary
 * was there, was a paragraph reading "roughly 9 top-level destinations and
 * about 33 hollowed-out pages", which failed a correct page the day `routes`
 * reached 33. Spelling that one out would have been a relaxation dressed as a
 * fix, and an allowlist is how a check comes to vouch for prose it stopped
 * reading. So the page gained a `####` heading where the destination gate's
 * material starts, and this region ends there — a boundary a reader can see,
 * rather than one only this test knows about.
 *
 * What that buys and what it costs: everything between the block and that
 * heading is read, and nothing below it is. A route-gate total put below the
 * heading escapes, which is why the heading's own paragraph says which gate
 * each side belongs to.
 */
function proseAfterPinnedBlock(page, firstLine) {
  const lines = page.split('\n');
  const start = lines.indexOf(firstLine);
  if (start < 0) return null;
  const close = lines.findIndex((line, index) => index > start && line.startsWith('```'));
  const end = lines.findIndex((line, index) => index > close && /^#{1,6} /.test(line));
  const kept = [];
  let fence = false;
  for (const line of lines.slice(close + 1, end < 0 ? lines.length : end)) {
    if (line.startsWith('```')) { fence = !fence; continue; }
    if (!fence) kept.push(line);
  }
  return kept.join('\n');
}

test('the go-live plan carries this tree\'s entity-route reading verbatim', () => {
  const page = readFileSync(resolve(repository, PLAN), 'utf8');
  const printed = summaryLines(measureRoutes(repository)).join('\n');
  const readings = fencedBlocks(page).filter(block => block.startsWith('entity routes: '));

  // TWO assertions rather than one, because they are two different failures
  // and the first one is the dangerous shape. A check that looked for a block
  // and compared only if it found one would pass by finding nothing, which is
  // the instrument-always-returns-true failure inside the check written to
  // stop it. So the absence of the reading is its own assertion.
  assert.ok(readings.length > 0,
    `${PLAN} no longer carries an entity-route reading in a fenced block at all.\n`
    + '  It is the page a reader uses to decide where the finish line is; without\n'
    + '  the block this test vouches for nothing.');

  assert.ok(readings.includes(printed),
    `${PLAN} does not carry THIS tree's entity-route reading.\n`
    + `  measured here:\n${printed}\n`
    + `  the page carries:\n${readings.join('\n  ---\n')}\n`
    + '  Run `pnpm run check:entity-routes` and replace the current block with its\n'
    + '  output, in the SAME change as whatever moved the figures. Do not rewrap it:\n'
    + '  this page used to paraphrase the reading, and a comparison that normalised\n'
    + '  the prose first would be a second representation of the same thing, which is\n'
    + '  the defect this gate exists to catch. The dated #294 block above it is a\n'
    + '  record of that head and is deliberately not maintained.');
});

/**
 * The rule is no TOTAL from the block, not no number at all, and the
 * difference is the one thing on the page worth protecting.
 *
 * Stage J has to be able to say that a remainder fell by five because D83
 * reclassified five reads and nothing was adopted, and that it fell by nine
 * because nine screens adopted routes. Those two moves look identical in the
 * numbers and mean opposite things, and the sentence distinguishing them is
 * the only thing stopping a falling remainder from reading as progress it is
 * not. Forbidding every numeral would delete it and the page would become MORE
 * misleading by passing.
 *
 * So a move is stated as its SIZE and its CAUSE, and the total it produced is
 * left to the block. A delta is not a figure the block carries, so it survives
 * this check on its own; a dated reading of an earlier head is a record and
 * lives inside a fence, which this region skips. The residual risk is a delta
 * that happens to equal a pinned total — the coincident-figures trap — and the
 * remedy is the one already in the message below: spell it as a word.
 */
test('no earlier reading sits below the measured one', () => {
  const page = readFileSync(resolve(repository, PLAN), 'utf8');
  const report = measureRoutes(repository);
  const firstLine = summaryLines(report)[0];

  /*
   * WHAT THIS CHECKS, AND — MORE IMPORTANTLY — WHAT IT DOES NOT.
   *
   * It checks one ordering: the measured reading is the last `entity routes:`
   * fence on the page, so a record of an earlier head never sits below the
   * current one. That is a real mistake and worth holding.
   *
   * IT DOES NOT CATCH THE DEFECT IT WAS WRITTEN FOR, and saying so here is the
   * point of the comment. Twice in one day, in this section, an inserted block
   * landed between an EARLIER block and the prose explaining it, leaving a
   * paragraph that opens "The move above ..." describing the block above the
   * block above it — a paragraph reporting another paragraph's numbers, which
   * is worse than a missing explanation because it reads like an explanation.
   * Both times every assertion in this file passed.
   *
   * This assertion was written to close that and was then PLANTED with the
   * real broken layout, which it passed: in both the broken and the fixed page
   * the fences run 69, 64, 74, because only the PROSE moved. An assertion true
   * of both cannot distinguish them. It is kept, with its claim cut back to
   * what it measures, rather than deleted — but nothing here covers the
   * orphaned-prose defect, and a reader must not take a green run as evidence
   * that the section reads coherently.
   *
   * The sibling check below cannot cover it either: it reads the prose AFTER
   * the measured block, and prose orphaned BEHIND an inserted block is not in
   * that region. Closing this properly needs an assertion about which fence a
   * backward-referencing paragraph describes, which is a claim about meaning
   * rather than about order, and nobody has built one. Until then the control
   * is reading the rendered section after any edit that moves a block — which
   * is what found it both times, and is not something to rely on a third.
   */
  const fences = [...page.matchAll(/^entity routes: .*$/gm)].map(match => match[0]);
  assert.ok(fences.length > 0, `${PLAN} carries no entity-route reading at all`);
  assert.equal(fences.at(-1), firstLine,
    `${PLAN}: an earlier reading sits below the measured one.\n`
    + `  last on the page: ${fences.at(-1)}\n`
    + `  measured now:     ${firstLine}\n`
    + '  Earlier readings are RECORDS of a head and belong ABOVE the current one.\n'
    + '  Append a new reading at the end of the section and demote the previous\n'
    + '  one in place. NOTE: passing this says nothing about whether each block\n'
    + '  still sits with its own prose — see this test\'s comment.');
});

test('the prose after that block points at it and restates none of its figures', () => {
  const page = readFileSync(resolve(repository, PLAN), 'utf8');
  const report = measureRoutes(repository);
  const firstLine = summaryLines(report)[0];

  // The region below is found by the FIRST line equal to the block's first
  // line, so a verbatim duplicate of that line anywhere EARLIER in the page
  // moves this check onto prose it was not written for — prose which restates
  // none of these figures, so it passes. Planted, that reads fifteen green and
  // a blind check, which is indistinguishable from a page that is fine. The
  // absence case is the assertion below and keeps its own message, because a
  // duplicated block and a missing one are different mistakes with different
  // remedies and one message cannot name both.
  const copies = page.split('\n').filter(line => line === firstLine).length;
  assert.ok(copies <= 1,
    `${PLAN} carries the pinned block's first line ${copies} times.\n`
    + '  The prose region checked below starts at the FIRST one, so a second copy\n'
    + '  silently relocates this check to some other part of the page and it stops\n'
    + '  reading Stage J at all. Keep exactly one copy of the measured block; a\n'
    + '  reading of an earlier head is a record and must differ from it.');

  const prose = proseAfterPinnedBlock(page, firstLine);
  assert.ok(prose !== null, `${PLAN} does not carry the pinned block's first line`);

  for (const figure of PINNED_FIGURES) {
    const value = report[figure];
    // A numeral in this document is a figure — small numbers are spelled out
    // ("four entities", "nine sites") — so this stays honest as `unrouted_sites`
    // falls toward single digits, which is the direction we want it to fall.
    // What changes when a figure goes small is the MESSAGE and never the check:
    // a magnitude threshold would be the relaxation, written in advance, and a
    // check that silently stops reading one of its five inputs is the
    // instrument that always returns true.
    const restated = new RegExp(String.raw`(?<![-\w#.])${value}(?![-\w.])`, 'g');
    const found = [...prose.matchAll(restated)];
    assert.equal(found.length, 0,
      `${PLAN}: Stage J's prose restates \`${figure}\` (${value}) ${found.length} time(s).\n`
      + `  first here: ...${prose.slice(Math.max(0, found[0]?.index - 70), found[0]?.index + 40).replace(/\n/g, ' ')}...\n`
      + '  The measured figures live in the pinned block; the prose points at it and\n'
      + '  restates none of them, because a sentence beside a checked block is prose\n'
      + '  this test does not read and a green check is a claim about the whole page.\n'
      + '  A MOVE is still sayable: give its size and its cause and leave the total it\n'
      + '  produced to the block, because a remainder falling by five because five\n'
      + '  reads were reclassified and falling by nine because nine screens adopted\n'
      + '  routes are the same arithmetic and opposite news. A reading of an EARLIER\n'
      + '  head is a record, not a restatement, and belongs in a fence, which this\n'
      + '  region skips.\n'
      + (value < 10
        ? '  This figure is now a single digit. If the match is ordinary prose rather\n'
          + '  than a restated figure, spell the number as a word, as the rest of this\n'
          + '  page does. If it is the figure, move it inside the block.\n'
        : ''));
  }
});

/**
 * Every `screenRead` route's declared answer key against the SQL its contract
 * actually returns — the one layer the gate cannot see.
 *
 * The gate runs a declaration's `request` against each call site's arguments
 * and never exercises `response`, which the page beside this file records as a
 * live defect once already: a route declared over `contract_alert_list` passed
 * the gate and would have refused every real call, because the helper read
 * `result.entries` as a constant and that contract answers `alerts`. Making the
 * key a parameter stopped the constant being inherited by copying. It does not
 * stop the parameter being WRONG, and nothing between the route and the store
 * renames anything: the handler returns `contract(...)` untouched.
 *
 * THE FAILURE MODE THIS TEST IS SHAPED AROUND IS ITS OWN. A first version
 * extracted each contract's body with a non-greedy match to `$contract$;` and
 * reported `contract_clinical_event_list` as declaring `events` where the SQL
 * answered `entries` — a live refusal on every chart-timeline read, apparently.
 * It was the extractor: that body was never isolated at all, and the keys the
 * comparison saw belonged to another function. The corrected extractor says the
 * SQL answers `events` and the route is right.
 *
 * So a body that cannot be found FAILS rather than being skipped, which is the
 * assertion that would have caught it. D95's rule arriving from the other side:
 * a case that comes back BLIND is not a finding, and a case that comes back
 * POSITIVE from an unvalidated extractor is not one either.
 */
const RECORD_MIGRATIONS = 'services/authority-store/supabase/record-migrations/';

function contractBodies() {
  const directory = resolve(repository, RECORD_MIGRATIONS);
  const sql = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => readFileSync(resolve(directory, name), 'utf8')).join('\n');
  const bodies = new Map();
  const marks = [...sql.matchAll(/create (?:or replace )?function "pennsync_records"\.([a-z_]+)\(/g)];
  for (const [index, mark] of marks.entries()) {
    bodies.set(mark[1], sql.slice(mark.index, marks[index + 1]?.index ?? sql.length));
  }
  return bodies;
}

/**
 * The keys a contract's own `return jsonb_build_object(...)` statements name.
 *
 * Parenthesis-counted rather than window-matched. A version bounding the
 * argument list to 400 characters found nothing at all in `contract_alert_list`
 * — whose answer wraps a `coalesce((select …))` far longer than that — and
 * reported an EMPTY key set, which the comparison then read as "this route's
 * key is not among the ones returned". That is the same extractor failure
 * twice in one afternoon, and the second time it accused the very route the
 * check was written for.
 *
 * Keys are taken at depth one only, so a nested `jsonb_build_object` inside a
 * projection does not contribute its fields to the outer answer.
 */
function answeredKeys(body) {
  const keys = new Set();
  const opener = /return jsonb_build_object\(/g;
  for (let start = opener.exec(body); start; start = opener.exec(body)) {
    let depth = 1;
    let index = start.index + start[0].length;
    let head = index;
    for (; index < body.length && depth > 0; index += 1) {
      const character = body[index];
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 1) {
        const argument = body.slice(head, index).trim();
        const literal = argument.match(/^'([a-z_]+)'$/);
        if (literal) keys.add(literal[1]);
        head = index + 1;
      }
    }
  }
  return keys;
}

/**
 * Each screen read's declared answer key, default sort and contract.
 *
 * Read per `screenRead(` CALL rather than by a fixed property order. A first
 * version matched `answerKey` followed by `entity` followed by `function` on
 * consecutive lines, which is the shape seven of the nine calls happen to use —
 * and the two it missed are both `PatientAlert`, which is the pair the whole
 * check exists for, because `contract_alert_list` answering `alerts` is the
 * live defect that made the key a parameter in the first place. It passed a
 * floor of seven while blind to the two routes that motivated it.
 *
 * So the count is DERIVED from the file's own `answerKey:` occurrences rather
 * than typed, for the same reason a registry sentinel should count exported
 * names rather than carry a number: a check whose population is a literal
 * cannot notice its population changing.
 */
function declaredAnswerKeys() {
  const routes = readFileSync(resolve(repository, 'src/lib/independentEntityRoutes.js'), 'utf8');
  const contracts = readFileSync(resolve(repository, 'services/pennsync-api/record-contracts.mjs'), 'utf8');
  const declared = [];
  const calls = [...routes.matchAll(/screenRead\(\{/g)];
  for (const [index, call] of calls.entries()) {
    const body = routes.slice(call.index, calls[index + 1]?.index ?? routes.length);
    const field = name => body.match(new RegExp(`\\n\\s*${name}:\\s*'(-?[A-Za-z_]+)'`))?.[1] ?? null;
    const answerKey = field('answerKey');
    if (answerKey === null) continue;
    const capability = field('function');
    const rpc = capability && contracts.match(
      new RegExp(`\\n  ${capability}: Object\\.freeze\\(\\{[\\s\\S]{0,400}?rpc: '([a-z_]+)'`));
    declared.push({
      answerKey,
      entity: field('entity'),
      capability,
      order: field('order'),
      rpc: rpc ? rpc[1].replace(/^pennsync_/, '') : null,
    });
  }
  return { declared, answerKeyCount: [...routes.matchAll(/\n\s*answerKey:/g)].length };
}

test('every declared answer key is one its contract actually returns', () => {
  const bodies = contractBodies();
  const { declared, answerKeyCount } = declaredAnswerKeys();
  // NOT a floor, and not a number typed here. Every `answerKey:` in the route
  // file must have been extracted, so a declaration this reader cannot parse
  // fails instead of quietly leaving its route unmeasured. A floor of seven
  // passed while the two `PatientAlert` routes were invisible.
  assert.equal(declared.length, answerKeyCount,
    `the route file declares ${answerKeyCount} answer keys and this reader found `
    + `${declared.length}.\n  A route it cannot parse is a route it does not check, `
    + 'which is indistinguishable\n  from a route that agrees.');

  for (const route of declared) {
    assert.ok(route.rpc,
      `${route.entity}.${route.capability} reaches no contract entry in record-contracts.mjs`);
    const body = bodies.get(route.rpc);
    // A MISSING body fails. It does not skip, and it is not "no disagreement
    // found" — that reading is what made the first version of this test report
    // a defect that was not there.
    assert.ok(body,
      `no SQL body found for \`${route.rpc}\` (${route.entity}.${route.capability}).\n`
      + '  This is a failure of the extractor above, not evidence about the route.\n'
      + '  Fix the extraction before reading anything else this test says.');
    const answered = answeredKeys(body);
    assert.ok(answered.has(route.answerKey),
      `${route.entity}.${route.capability} declares answerKey \`${route.answerKey}\`,\n`
      + `  but \`${route.rpc}\` returns ${JSON.stringify([...answered])}.\n`
      + '  Nothing renames it in between — the handler returns `contract(...)` untouched —\n'
      + '  so this route is counted SERVED and refuses the store\'s real answer on every call.');
  }

  // AN EMPTY DISAGREEMENT SET IS NOT EVIDENCE (D174). Drive a key the contract
  // does not answer through the same comparison and require it to be caught.
  const sample = bodies.get(declared[0].rpc);
  assert.ok(sample, 'the plant needs a body the extractor found');
  assert.equal(answeredKeys(sample).has('rows_that_no_contract_answers'), false);
});

/**
 * Every screen read's declared default sort against the `order by` its
 * contract actually runs.
 *
 * The route's `order` is what the SPA believes it is getting, and the contract
 * decides what it gets. A disagreement is silent in a way the answer-key one is
 * not: a wrong key REFUSES and somebody notices, while a wrong sort returns the
 * right rows in the wrong order and looks like data. That asymmetry is why this
 * is worth a check of its own rather than a line in the one above.
 *
 * The FIRST `order by` in the body is the one compared, because that is the
 * query whose rows become the answer; a later one belongs to a sibling
 * function's projection. A body with none FAILS rather than skipping, for the
 * reason the extractor above now fails on a missing body: not-found is a
 * statement about the instrument, never about the route.
 */
test('every declared default sort is the one its contract runs', () => {
  const bodies = contractBodies();
  const { declared } = declaredAnswerKeys();
  const sorted = declared.filter(route => route.order !== null);
  // Derived, not typed, for the reason the count above is: a route dropping its
  // `order` should shrink this population visibly rather than quietly.
  assert.equal(sorted.length, declared.length - 1,
    `${declared.length - sorted.length} screen reads declare no default sort.\n`
    + '  Exactly one is expected to (the unfiltered OCR list). If that changed,\n'
    + '  say so here rather than letting the population move silently.');

  for (const route of sorted) {
    const body = bodies.get(route.rpc);
    assert.ok(body, `no SQL body for \`${route.rpc}\`; fix the extractor, not the route`);
    const clause = body.match(/order by ([^\n]+)/i);
    assert.ok(clause,
      `\`${route.rpc}\` runs no \`order by\` at all, yet `
      + `${route.entity}.${route.capability} declares \`${route.order}\`.\n`
      + '  Read the SQL before believing this: an absent clause here has twice been\n'
      + '  the extractor rather than the contract.');
    const field = route.order.replace(/^-/, '');
    const descending = route.order.startsWith('-');
    assert.ok(clause[1].includes(`"${field}"`),
      `${route.entity}.${route.capability} declares \`${route.order}\`, but `
      + `\`${route.rpc}\` orders by:\n    ${clause[1]}`);
    assert.equal(/\bdesc\b/i.test(clause[1]), descending,
      `${route.entity}.${route.capability} declares \`${route.order}\` `
      + `(${descending ? 'descending' : 'ascending'}), but \`${route.rpc}\` orders by:\n`
      + `    ${clause[1]}\n`
      + '  Rows come back in the opposite order and nothing refuses, which is the\n'
      + '  whole reason this is checked separately from the answer key.');
  }
});

/**
 * The remainder is a PARTITION, and the page's prose about it carries numbers
 * the pinned block does not.
 *
 * Those three counts describe three different kinds of work — a route that
 * refuses, a site the scan cannot read, and a site nobody has routed — and the
 * audit's whole argument is that they must not be added together. Prose stating
 * them is prose that rots, so it is checked here: the identity first, because a
 * partition that does not add up is a second answer to a question the gate
 * already answers, and then the page.
 */
test('the landable sites partition exactly, and the audit prose carries the parts', () => {
  const report = measureRoutes(repository);
  const routes = ENTITY_ROUTES;
  const destinations = measureDestinations(repository);
  const { served, refused, unreadable } = servedSites(repository, routes, destinations.sites.length);

  // Cross-checked against the tool's own figures BEFORE anything is read off
  // them, so this cannot become a quietly different second measurement.
  assert.equal(served.length, report.routed_sites);
  assert.equal(refused.length, report.declared_but_refused);
  assert.equal(unreadable.length, report.declared_but_unreadable);

  const declared = new Set(Object.keys(routes));
  const landable = destinations.sites.filter(site => SERVED.includes(site.destination));
  const noRoute = landable.filter(site => !declared.has(`${site.entity}.${site.operation}`));
  assert.equal(served.length + refused.length + unreadable.length + noRoute.length, landable.length,
    'the four parts do not add to the landable total, so at least one site is in\n'
    + '  two parts or in none. Fix the partition before reading any of its counts.');
  assert.equal(landable.length, report.landable_sites);

  const page = readFileSync(resolve(repository, PLAN), 'utf8');
  // A lookup table rather than a claim, which is what decides the resolution:
  // every use is `spelled[count]` guarded by `assert.ok(word)`, so a MISSING
  // entry fails and an extra one is inert. The union is therefore the safe side
  // and a re-derived minimal map is the risky one — which is the opposite of the
  // rule for a figure, and the reason this comment says which kind it is.
  //
  // Measured on each merge result rather than argued, and the union turned out
  // to be NECESSARY BUT NOT SUFFICIENT — which is the sharper form of the rule
  // and the reason to keep the map wide. Each side carries the spellings its own
  // partition needed and neither carries the other's, so neither side alone
  // passes. But the merged partition is a value NEITHER SIDE EVER HELD: both
  // branches lower the refused count independently, so the merge lands BELOW
  // both. A resolution that merely picked a side, or even unioned the two, still
  // fails — the entry has to be added because the figure was re-measured.
  //
  // This has now happened on TWO CONSECUTIVE merges, which is what makes it a
  // property of the slot order rather than an accident: the timesheet merge
  // produced FIVE and the leave merge FOUR, neither held by either of its two
  // sides. So `4` and `5` are both here, and the next such merge will need its
  // own entry for the same reason. Do not prune this map back to what the
  // current tree uses — the guard is `assert.ok(word)`, so a pruned map fails
  // the next merge and a wide one costs nothing.
  const spelled = { 4: 'Four', 5: 'Five', 6: 'Six', 8: 'Eight', 9: 'Nine',
    14: 'Fourteen',
    17: 'Seventeen', 21: 'Twenty-one', 22: 'Twenty-two', 25: 'Twenty-five',
    26: 'Twenty-six', 29: 'Twenty-nine', 33: 'Thirty-three', 34: 'Thirty-four',
    50: 'Fifty', 54: 'Fifty-four', 56: 'Fifty-six', 60: 'Sixty' };
  for (const [count, word] of [[refused.length, spelled[refused.length]],
    [unreadable.length, spelled[unreadable.length]], [noRoute.length, spelled[noRoute.length]]]) {
    assert.ok(word,
      `the partition moved to ${count} and this test has no spelling for it.\n`
      + '  Update the audit prose and this list together; a count the page states\n'
      + '  and nothing checks is the defect this whole section is about.');
    assert.ok(page.includes(word),
      `${PLAN} does not say "${word}" — the audit prose states the partition in\n`
      + `  words and this part is now ${count}. Update the prose.`);
  }
});

/**
 * The audit bullet states four QUOTIENTS as well as those three counts, and
 * until now nothing checked them.
 *
 * **A quotient can hold while both its terms move.** 15/12 and 20/16 are both
 * 1.25, so a ratio pinned on its own is satisfied by a population that has
 * changed underneath it — which is the exact failure the bullet's own closing
 * paragraph records happening to it once already, when the provider directory's
 * three writes moved every figure and one percentage came out unchanged. So the
 * integer PAIR is asserted first and the quotient is DERIVED from that pair
 * here; the quotient never stands alone as the evidence.
 *
 * The ratio is formatted from the integers rather than parsed out of the page,
 * because `1.25` in prose admits anything in [1.245, 1.255) and a comparison
 * that accepts a band is not pinning a measurement.
 *
 * Two things about the page's spelling, so a later reader does not write a
 * matcher for the wrong form: the three partition COUNTS are spelled as words
 * (`Forty-four`), and these four ratios are written as DIGITS (`2.59`). A
 * matcher built for either form is silent about the other, which is why the
 * test above and this one read the page differently on purpose.
 *
 * The read/write split is `READ_OPERATIONS`, IMPORTED rather than retyped as
 * three strings. A hand-written split that agrees with the tool over today's
 * population is not the tool's split — the remainder's operations happen to be
 * only `create, delete, filter, list, update` today, so several wrong splits
 * would agree with this one and stop agreeing the moment a `subscribe` or a
 * `schema` site lands in it.
 *
 * And this pin FAILS on every pull request that declares a route, by design.
 * That is the point: the bullet has gone stale three times, and its instruction
 * is to re-derive the whole thing rather than adjust the number that obviously
 * changed. One caution when it does fail — the remainder's two ratios are over
 * a REMAINDER, so they move whenever anything LEAVES it, in whichever direction
 * the departure was thinner or fatter than what stayed. A ratio rising there is
 * not evidence that the remaining work got harder.
 */
test('the audit bullet\'s four ratios are derived from integer pairs the test also asserts', () => {
  const routes = ENTITY_ROUTES;
  const destinations = measureDestinations(repository);
  const { served } = servedSites(repository, routes, destinations.sites.length);
  const declared = new Set(Object.keys(routes));
  const landable = destinations.sites.filter(site => SERVED.includes(site.destination));
  const noRoute = landable.filter(site => !declared.has(`${site.entity}.${site.operation}`));

  const split = (sites) => {
    const keys = (subset) => new Set(subset.map(site => `${site.entity}.${site.operation}`)).size;
    const reads = sites.filter(site => READ_OPERATIONS.includes(site.operation));
    const writes = sites.filter(site => !READ_OPERATIONS.includes(site.operation));
    return {
      readSites: reads.length, readKeys: keys(reads),
      writeSites: writes.length, writeKeys: keys(writes),
    };
  };
  const servedSplit = split(served);
  const remainder = split(noRoute);

  // The PAIRS first. Each of these four is what the corresponding ratio below
  // is computed from, so a population that moved without moving its quotient
  // fails here rather than passing silently one line further down.
  assert.deepEqual(servedSplit, { readSites: 132, readKeys: 50, writeSites: 31, writeKeys: 25 },
    'the served pool moved. Re-derive the WHOLE bullet — both of its ratios and\n'
    + '  the sentence about past waves — rather than editing the figure that moved.');
  assert.deepEqual(remainder, { readSites: 14, readKeys: 11, writeSites: 3, writeKeys: 3 },
    'the unrouted remainder moved. Re-derive the WHOLE bullet; its ratios are\n'
    + '  over a remainder, so they move when anything LEAVES it too.');

  // The page is hard-wrapped, so a literal search for a phrase spanning a line
  // break returns a confident false negative. Collapse the whitespace first.
  const page = readFileSync(resolve(repository, PLAN), 'utf8').replace(/\s+/gu, ' ');
  const ratio = (sites, keys) => (sites / keys).toFixed(2);
  const servedRead = ratio(servedSplit.readSites, servedSplit.readKeys);
  const servedWrite = ratio(servedSplit.writeSites, servedSplit.writeKeys);
  const poolRead = ratio(remainder.readSites, remainder.readKeys);
  const poolWrite = ratio(remainder.writeSites, remainder.writeKeys);

  // Each figure is matched WITH THE WORDS THAT GIVE IT ITS ROLE, not on its own.
  // A first version of this check asked only whether the page contained the
  // string, and sabotage showed it did not bite: `1.61` also appears in the
  // paragraph recording that the figure ROSE to it, so the page went on
  // satisfying the check with the sentence that states it edited away. A digit
  // string found somewhere in 280 KB is not the page stating a measurement.
  for (const [label, phrase] of [
    ['the served pool\'s two ratios',
      `a read key there carries ${servedRead} call sites and a write key ${servedWrite},`],
    ['the remainder\'s two ratios',
      `a read key covers ${poolRead} sites and a write key ${poolWrite},`],
  ]) {
    assert.ok(page.includes(phrase),
      `${PLAN} no longer states ${label} as this tree measures them. Expected the\n`
      + `  sentence to read: "${phrase}"\n`
      + '  These are written as DIGITS, unlike the partition counts above, which are\n'
      + '  words. Re-derive the bullet; do not adjust the one figure that moved.');
  }

  // The remainder's key total is stated too, and it is the sum of the two key
  // counts rather than a fifth measurement — asserted so it cannot drift away
  // from the pair it is built from.
  assert.equal(remainder.readKeys + remainder.writeKeys, 14);
  assert.ok(page.includes('over fourteen entity and'),
    `${PLAN} no longer states the remainder's key total as fourteen`);
});

test('every figure the tool reports says which way it moves, and nothing else does', () => {
  const report = measureRoutes(repository);
  const reported = Object.keys(report).filter(key => !NOT_A_MEASUREMENT.includes(key));
  // Both directions, so neither half can drift: a figure added to the report
  // with no direction fails here, and a direction for a figure that no longer
  // exists fails here too. A rule like "skip anything that is not a number"
  // would have exempted the next string-valued figure silently, which is why
  // the exemptions are NAMED.
  assert.deepEqual(
    reported.slice().sort(),
    Object.keys(FIGURE_DIRECTIONS).slice().sort(),
    'a reported figure has no direction note, or a direction note names a figure the report does not carry',
  );
  for (const name of NOT_A_MEASUREMENT) {
    assert.ok(Object.hasOwn(report, name), `${name} is exempted from the direction check and is not in the report`);
  }
  for (const [figure, note] of Object.entries(FIGURE_DIRECTIONS)) {
    assert.ok(['measured', 'derived'].includes(note.evidence), `${figure}: evidence is neither measured nor derived`);
    const causes = ['progress', 'regression', 'instrument'].filter(cause => note[cause]);
    assert.ok(causes.length > 0, `${figure}: a direction note with no cause says nothing`);
    for (const cause of causes) {
      assert.ok(note[cause].length >= MINIMUM_REASON, `${figure}.${cause}: too short to be a reason`);
    }
    if (note.precondition) {
      assert.ok(note.progress, `${figure}: a precondition with no progress cause conditions nothing`);
      assert.ok(note.precondition.length >= MINIMUM_REASON, `${figure}.precondition: too short to be a reason`);
    }
  }
});

test('a direction that only holds under a precondition still holds', () => {
  // The three preconditioned entries all say the same thing: a rise can be a
  // route arriving only while keys with call sites remain undeclared. That is
  // measurable, so it is measured rather than trusted — on the day Stage J
  // leaves no undeclared key, this fails and somebody re-reads those three
  // notes instead of a figure quietly changing meaning under a reader.
  const conditioned = Object.entries(FIGURE_DIRECTIONS).filter(([, note]) => note.precondition);
  assert.ok(conditioned.length > 0, 'the precondition machinery has no user; delete it or give it one');
  for (const [, note] of conditioned) {
    assert.equal(note.precondition, 'keys with landable call sites remain undeclared',
      'a second precondition arrived and this check still measures only the first');
  }
  const measured = measureDestinations(repository);
  const undeclared = measured.sites.filter(site => SERVED.includes(site.destination))
    .filter(site => !Object.hasOwn(ENTITY_ROUTES, `${site.entity}.${site.operation}`));
  assert.ok(undeclared.length > 0,
    'no landable call site is undeclared any more, so those three notes assert a cause that can no longer occur');
});

test('a rise in the refused count is what declaring a route looks like', () => {
  // The worked example behind `declared_but_refused`, run rather than asserted
  // from the text. `measureRoutes` takes its routes as a parameter precisely so
  // a planted table can be measured without touching the module.
  const before = measureRoutes(repository);
  const key = Object.keys(callArguments(repository)
    .filter(call => call.arguments !== null)
    .reduce((keys, call) => {
      const name = `${call.entity}.${call.operation}`;
      if (!Object.hasOwn(ENTITY_ROUTES, name)) keys[name] = true;
      return keys;
    }, {}))[0];
  assert.ok(key, 'no undeclared key with readable call sites is left to plant against');

  const planted = Object.freeze({
    ...ENTITY_ROUTES,
    [key]: Object.freeze({
      function: 'listAgencyTasks',
      reason: 'planted by this test to measure which figure a declaration moves',
      projection: 'none',
      request: () => { const error = new Error('planted'); error.detail = 'planted_refusal'; throw error; },
      response: () => [],
    }),
  });
  const after = measureRoutes(repository, planted);

  // The whole point: the frontend did not change, no screen broke, and the
  // refused count went UP because a key that was being skipped is now claimed.
  assert.ok(after.declared_but_refused > before.declared_but_refused,
    'declaring a refusing route over a skipped key should raise the refused count');
  assert.equal(after.landable_sites, before.landable_sites);
  assert.equal(after.routed_sites, before.routed_sites);
  assert.equal(after.unrouted_sites, before.unrouted_sites);
  assert.equal(after.routes, before.routes + 1);

  // The positive control, inside the check. Those four equalities would also
  // hold if the plant had done nothing at all — a route whose key had no call
  // sites, say — so the same declaration with a request that ACCEPTS the
  // arguments has to move the figures the refusing one left alone. Without
  // this the test passes while measuring nothing.
  const serving = Object.freeze({
    ...planted,
    [key]: Object.freeze({ ...planted[key], request: () => ({}) }),
  });
  const adopted = measureRoutes(repository, serving);
  assert.ok(adopted.routed_sites > before.routed_sites, 'the control plant served no call site');
  assert.ok(adopted.unrouted_sites < before.unrouted_sites, 'the control plant adopted nothing');
  assert.equal(adopted.declared_but_refused, before.declared_but_refused,
    'a serving route should leave the refused count where it was');
});

test('the direction notes print without being pinned into the summary', () => {
  const report = measureRoutes(repository);
  const summary = summaryLines(report).join('\n');
  // The summary's wording is pinned by AGENTS.md. If explaining a figure ever
  // starts editing the line that carries it, this fails and the pin has to
  // move deliberately rather than as a side effect.
  for (const figure of Object.keys(FIGURE_DIRECTIONS)) {
    const note = FIGURE_DIRECTIONS[figure];
    for (const cause of ['progress', 'regression', 'instrument']) {
      if (note[cause]) assert.ok(!summary.includes(note[cause]), `${figure}.${cause} leaked into the pinned summary`);
    }
  }
  const printed = directionLines().join('\n');
  assert.ok(printed.includes('declared_but_refused'), 'the printer does not name the figures');
  assert.ok(printed.startsWith('what a RISE in each figure means:'));
});

test('the counts this tool states about its own figures are derived, not typed', () => {
  // `directionLines`'s own comment names four numbers. They were typed once,
  // wrongly, before they were measured — which is the defect this whole change
  // is about, arriving inside it. So the prose is pinned to the structure.
  const all = Object.entries(FIGURE_DIRECTIONS);
  const causes = (note) => ['progress', 'regression', 'instrument'].filter(cause => note[cause]);
  assert.equal(all.length, 14, 'the number of figures changed');
  assert.equal(all.filter(([, note]) => causes(note).length > 1).length, 9,
    'the number of figures whose rise has more than one cause changed');
  assert.equal(all.filter(([, note]) => note.progress).length, 7,
    'the number of figures whose rise can be progress changed');
  assert.equal(all.filter(([, note]) => note.progress && note.regression).length, 5,
    'the number of figures whose rise can be either progress or regression changed');
  const source = readFileSync(resolve(repository, 'tools-entity-routes.mjs'), 'utf8');
  assert.ok(source.includes('fourteen figures, nine where a rise has more'),
    'the sentence stating those counts is no longer where this test can find it');
});
