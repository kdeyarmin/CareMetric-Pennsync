import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HANDLER_NAMES } from './services/pennsync-api/handlers.mjs';
import { PORTED_FUNCTIONS } from './services/authority-client/client.mjs';
import { ARGUMENTS_UNSUPPORTED, ENTITY_ROUTES, ROUTED_OPERATIONS, routeFor }
  from './src/lib/independentEntityRoutes.js';
import { main, measureRoutes, servedSites, summaryLines } from './tools-entity-routes.mjs';
import { callArguments } from './tools-entity-call-arguments.mjs';
import { SERVED, measureDestinations } from './tools-frontend-destination.mjs';
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
test('a served site is removed from the remainder once, not per key', () => {
  const baseline = measureRoutes(repository);
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
      && !Object.hasOwn(ENTITY_ROUTES, candidate.key)
      && candidate.readable === 1 && candidate.total > candidate.readable)
    .sort((left, right) => (left.key + left.file).localeCompare(right.key + right.file));
  assert.ok(candidates.length > 0,
    'no undeclared landable key has one readable call and one unreadable one in a single\n'
    + '  file, so the case this test exists for cannot be reached on this tree. It is a\n'
    + '  REFUSAL rather than a skip: the multiset subtraction is still exercised by the\n'
    + '  committed report, whose bucket sum falls short if a Set comes back, but the\n'
    + '  planted half of the proof is gone and something has to say so.');
  const chosen = candidates[0];

  const routes = { ...ENTITY_ROUTES, [chosen.key]: sound({ request: () => ({}) }) };
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

/** The keys a contract's own `return jsonb_build_object(...)` statements name. */
function answeredKeys(body) {
  return new Set([...body.matchAll(/return jsonb_build_object\(([\s\S]{0,400}?)\);/g)]
    .flatMap(match => [...match[1].matchAll(/'([a-z_]+)'\s*,/g)].map(key => key[1])));
}

/** Each screen read's declared answer key, beside the contract it reaches. */
function declaredAnswerKeys() {
  const routes = readFileSync(resolve(repository, 'src/lib/independentEntityRoutes.js'), 'utf8');
  const contracts = readFileSync(resolve(repository, 'services/pennsync-api/record-contracts.mjs'), 'utf8');
  const declared = [];
  for (const match of routes.matchAll(
    /answerKey:\s*'([a-z_]+)',\s*\n\s*entity:\s*'([A-Za-z]+)',\s*\n\s*function:\s*'([A-Za-z]+)'/g)) {
    const [, answerKey, entity, capability] = match;
    const rpc = contracts.match(
      new RegExp(`\\n  ${capability}: Object\\.freeze\\(\\{[\\s\\S]{0,400}?rpc: '([a-z_]+)'`));
    declared.push({ answerKey, entity, capability, rpc: rpc?.[1]?.replace(/^pennsync_/, '') ?? null });
  }
  return declared;
}

test('every declared answer key is one its contract actually returns', () => {
  const bodies = contractBodies();
  const declared = declaredAnswerKeys();
  // Not a floor. If the extraction above stops matching, this goes to zero and
  // every assertion below becomes vacuously true at once.
  assert.ok(declared.length >= 7,
    `only ${declared.length} screen reads were extracted; the declaration shape moved`);

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
