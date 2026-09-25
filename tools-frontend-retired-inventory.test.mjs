import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SERVED, measureDestinations } from './tools-frontend-destination.mjs';
import { OUTCOMES, PAGE_FILE, measureInventory, renderMarkdown } from './tools-frontend-retired-inventory.mjs';

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
 * carry", and five of them do not: they are writes to D83 reference tables it
 * carries for READS. It also hard-coded the old total in a sentence beside a
 * derived one, which is the shape that goes stale where nothing can notice.
 */
test('the two reasons a site has no destination are counted apart', () => {
  const report = measureInventory(repository);
  assert.equal(report.uncarried_domain + report.carried_for_reads, report.sites);
  assert.ok(report.carried_for_reads > 0,
    'with none of them, this test would pass without the distinction existing');
  const page = renderMarkdown(report);
  assert.match(page, new RegExp(`${report.uncarried_domain} reach a domain`));
  assert.match(page, new RegExp(`${report.carried_for_reads} are writes to D83`));
  // Named on its own, because the literal that was here was 203 — which is
  // still a real number in this report, so a check by VALUE alone cannot tell
  // the hard-coded one from the derived one.
  assert.match(page, new RegExp(`one decision about ${report.sites}\\b`));
  // Every number in the page comes from the report. A literal that happens to
  // be right today is the defect, so no digit may appear that the report does
  // not hold.
  const derived = new Set([report.sites, report.files, report.entities,
    report.entirely_dropped_files, report.carried_for_reads, report.uncarried_domain,
    report.operations.read, report.operations.write, report.operations.realtime,
    ...report.by_file.map(file => file.sites), ...report.by_entity.map(entry => entry.sites)]
    .map(String));
  // Not a number in a name: `D83` is a decision, not a count.
  for (const number of page.split('\n').slice(0, 13).join('\n').match(/(?<![A-Za-z])\d+/g) ?? []) {
    assert.ok(derived.has(number), `${number} in the summary is not from the report`);
  }
});
