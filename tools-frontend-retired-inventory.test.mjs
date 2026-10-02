import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SERVED, measureDestinations } from './tools-frontend-destination.mjs';
import {
  CARRIED_DISPOSITIONS, OUTCOMES, PAGE_FILE, UNCARRIED_DISPOSITIONS,
  entityHasTableWithoutContract, entityIsCarried, measureInventory, renderMarkdown,
} from './tools-frontend-retired-inventory.mjs';
import { carriesTable } from './tools-entity-schema-plan.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));

test('the inventory is exactly the call sites the destination gate cannot place', () => {
  const report = measureInventory(repository);
  const measured = measureDestinations(repository);
  const dropped = measured.sites.filter(site => !SERVED.includes(site.destination));
  assert.equal(report.sites, dropped.length);
  // The two views of the same population have to agree, or one of them is
  // dropping rows: a file counted twice, or an entity missed entirely.
  assert.equal(report.by_file.reduce((total, file) => total + file.sites, 0), report.sites);
  assert.equal(report.by_entity.reduce((total, entry) => total + entry.sites, 0), report.sites);
  assert.equal(report.operations.read + report.operations.write + report.operations.realtime, report.sites);
});

test('every destination it reports has words somebody can act on', () => {
  const report = measureInventory(repository);
  for (const entry of report.by_entity) {
    assert.ok(OUTCOMES[entry.destination], `no outcome text for ${entry.destination}`);
  }
});

/**
 * `entirely_dropped` is the split the hiding work turns on — retire the screen
 * or hide a section — so it is checked against that file's WHOLE entity reach
 * rather than against the dropped half, which would mark every file whole.
 */
test('a file is only whole when nothing it reads survives', () => {
  const report = measureInventory(repository);
  const measured = measureDestinations(repository);
  for (const file of report.by_file) {
    const all = measured.sites.filter(site => site.file === file.file);
    const survives = all.some(site => SERVED.includes(site.destination));
    assert.equal(file.entirely_dropped, !survives, file.file);
  }
  assert.ok(report.by_file.some(file => !file.entirely_dropped),
    'no file keeps anything, which would mean the check is reading the dropped half only');
});

test('the committed page is what the tree produces', () => {
  const report = measureInventory(repository);
  assert.equal(readFileSync(join(repository, PAGE_FILE), 'utf8'), renderMarkdown(report),
    'run `node tools-frontend-retired-inventory.mjs --write`');
});

/**
 * The page said every site here "reaches a domain the migration decided not to
 * carry", and fourteen of them do not: their entity IS carried and it is the
 * OPERATION that has no destination. It also hard-coded the old total in a
 * sentence beside a derived one, which is the shape that goes stale where
 * nothing can notice.
 *
 * The first version of the split counted five — the D83 reference writes —
 * because it asked the DESTINATION bucket instead of the disposition, and left
 * the nine broker writes on the uncarried side although the family serves
 * their three entities read-only. The test below pins the split against the
 * dispositions for that reason: a page pinned to a tool agrees with the tool,
 * which is consistency and not correctness.
 */
test('the two reasons a site has no destination are counted apart', () => {
  const report = measureInventory(repository);
  assert.equal(report.uncarried_domain + report.carried_entity, report.sites);
  assert.ok(report.carried_entity > 0,
    'with none of them, this test would pass without the distinction existing');
  const page = renderMarkdown(report);
  assert.match(page, new RegExp(`${report.uncarried_domain} reach a domain`));
  assert.match(page, new RegExp(`${report.carried_entity} are operations with no destination`));
  // Named on its own, because the literal that was here was 203 — which is
  // still a real number in this report, so a check by VALUE alone cannot tell
  // the hard-coded one from the derived one.
  assert.match(page, new RegExp(`one decision about ${report.sites}\\b`));
  // Every number in the page comes from the report. A literal that happens to
  // be right today is the defect, so no digit may appear that the report does
  // not hold.
  const derived = new Set([report.sites, report.files, report.entities,
    report.entirely_dropped_files, report.carried_entity, report.uncarried_domain,
    report.table_without_contract,
    report.operations.read, report.operations.write, report.operations.realtime,
    ...report.by_file.map(file => file.sites), ...report.by_entity.map(entry => entry.sites)]
    .map(String));
  // Not a number in a name: `D83` and `D7` are decisions, not counts.
  //
  // The slice is taken to the summary's own end rather than to a line count,
  // because widening the summary by six lines moved the boundary and a fixed
  // `13` would have stopped checking the digits that were added — the guard
  // going quiet in exactly the change that gave it more to read.
  const summary = page.split('\n## ')[0];
  assert.ok(summary.includes(String(report.table_without_contract)),
    'the summary must carry the figure, or this slice is checking the wrong text');
  for (const number of summary.match(/(?<![A-Za-z])\d+/g) ?? []) {
    assert.ok(derived.has(number), `${number} in the summary is not from the report`);
  }
});

/**
 * The figure that is a SUBSET, asserted as one. Its whole purpose is to say
 * which of the uncarried sites have a row, and the two mistakes available are
 * summing it with the figure it sits inside and moving it onto the carried
 * side — so both are refused here rather than described in a comment.
 */
test('the sites with a table and no contract are counted inside the uncarried side', () => {
  const report = measureInventory(repository);
  const dropped = measureDestinations(repository).sites
    .filter(site => !SERVED.includes(site.destination));
  const expected = dropped.filter(site =>
    entityHasTableWithoutContract(site.entity, site.disposition));
  assert.ok(expected.length > 0,
    'with none of them this test would pass without the distinction existing');
  assert.equal(report.table_without_contract, expected.length);
  // Inside, not beside: every one of them is on the uncarried side.
  assert.ok(report.table_without_contract <= report.uncarried_domain);
  for (const site of expected) {
    assert.equal(entityIsCarried(site.disposition), false,
      `${site.entity} is counted here, so its domain must be uncarried`);
  }
  // And the sum the page rests on is still the two-way one.
  assert.equal(report.uncarried_domain + report.carried_entity, report.sites);
  // Every one of them has a table, measured through the generator's predicate
  // and not through this tool's disposition lists.
  for (const site of expected) {
    assert.equal(carriesTable(site.entity, site.disposition), true);
  }
  // The destination each lands in is the accurate-reason bucket rather than
  // `no_table`, which is the half of this that `tools-frontend-destination.mjs`
  // owns. Named so the two tools cannot drift apart silently.
  assert.deepEqual([...new Set(expected.map(site => site.destination))], ['no_access_contract']);
});

/**
 * The split is about whether the migration carried the DOMAIN, so it is proved
 * against the dispositions rather than against the destination buckets it was
 * first (wrongly) derived from. Both sides are asserted non-empty, because a
 * predicate that matched nothing would satisfy the sum above on its own.
 *
 * This test's name said "whose entity has a table", which was the same sentence
 * while a paused entity could not have one and is now a different claim — the
 * table question is `carriesTable`'s and is asserted in its own test below.
 */
test('the carried side is exactly the sites whose domain the migration carried', () => {
  const report = measureInventory(repository);
  const dropped = measureDestinations(repository).sites
    .filter(site => !SERVED.includes(site.destination));
  const carried = dropped.filter(site => CARRIED_DISPOSITIONS.includes(site.disposition));
  const uncarried = dropped.filter(site => UNCARRIED_DISPOSITIONS.includes(site.disposition));
  assert.ok(carried.length > 0 && uncarried.length > 0);
  assert.equal(carried.length + uncarried.length, dropped.length,
    'every dropped site is on exactly one side, or a disposition is in neither list');
  assert.equal(report.carried_entity, carried.length);
  assert.equal(report.uncarried_domain, uncarried.length);
  // Named, because the nine that were miscounted are the broker writes and a
  // reader checking this needs to see them rather than take the totals.
  assert.deepEqual([...new Set(carried.map(site => site.destination))].sort(),
    ['broker_is_read_only', 'global_reference_is_read_only']);
});

test('an unknown disposition is refused rather than bucketed', () => {
  assert.throws(() => entityIsCarried('something_new'),
    /FRONTEND_INVENTORY_UNKNOWN_DISPOSITION:something_new/);
  assert.equal(entityIsCarried('broker'), true);
  assert.equal(entityIsCarried('hub'), false);
});
