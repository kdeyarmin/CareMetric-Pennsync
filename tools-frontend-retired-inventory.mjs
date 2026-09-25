#!/usr/bin/env node
/**
 * What each screen loses when the domains the migration did not carry go.
 *
 * `check:frontend-destination` says 203 of the frontend's 445 entity call
 * sites reach a domain with nowhere to land. That is the right number for
 * sizing and the wrong shape for acting: hiding a feature is a per-SCREEN
 * decision, and nobody can take 203 of those from a count.
 *
 * So this inverts it. It reports, per file, which entities that file reads or
 * writes that will have no destination, what the migration decided about each
 * one, and therefore what that screen can still do afterwards. A file is the
 * unit somebody edits; an entity is the unit somebody decided about; the pair
 * is what the hiding work is made of.
 *
 * It is a REPORT and not a gate. The population it describes shrinks only when
 * a disposition changes, which is a product decision rather than a regression,
 * so a baseline here would fail a build for somebody answering the question
 * this file exists to ask.
 *
 * WHAT IT DOES NOT CLAIM. It does not say a screen is safe to hide. A screen
 * reading one dropped entity among ten may be fine with that section removed;
 * one whose whole subject is dropped is a screen that goes. Reading the file is
 * still the work — this says which files, and what to look for in each.
 *
 * Deterministic and offline. It shares `measureDestinations` with the
 * destination gate, so the two cannot disagree about what a call site is.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { READ_OPERATIONS, REALTIME_OPERATIONS, SERVED, measureDestinations }
  from './tools-frontend-destination.mjs';

export const FORMAT = 'pennsync-frontend-retired-inventory';
export const FORMAT_VERSION = 1;
export const PAGE_FILE = 'docs/FRONTEND_RETIRED_DOMAIN_INVENTORY.md';

/**
 * What the migration decided, in the words somebody hiding a screen needs.
 *
 * Keyed on the DESTINATION rather than the disposition, because the two
 * broker rows are the same disposition and opposite answers: the family
 * serves the read and refuses the write.
 */
export const OUTCOMES = Object.freeze({
  no_table: 'no table in the owned store — the domain moves to the Hub (D8) or stays paused (D7)',
  broker_is_read_only: 'the broker family serves this entity read-only, so the write has no destination',
  global_reference_is_read_only:
    'D83 reference data: the table is written by migration and grants no caller role anything, '
    + 'so the write is refused by the GRANT rather than by a policy',
  no_realtime_seam: 'the owned store has no realtime seam, so a subscription has nowhere to attach',
  export_archive_only: 'retired to the export archive, which no screen reads',
  undeclared: 'no disposition at all — this is a gap, not a decision',
});

const kind = (operation) => {
  if (REALTIME_OPERATIONS.includes(operation)) return 'realtime';
  return READ_OPERATIONS.includes(operation) ? 'read' : 'write';
};

export function measureInventory(repository) {
  const measured = measureDestinations(repository);
  const dropped = measured.sites.filter(site => !SERVED.includes(site.destination));

  const files = new Map();
  const entities = new Map();
  for (const site of dropped) {
    const file = files.get(site.file) ?? { file: site.file, sites: 0, entities: new Map() };
    file.sites += 1;
    const perEntity = file.entities.get(site.entity)
      ?? { entity: site.entity, disposition: site.disposition, destination: site.destination, operations: new Set() };
    perEntity.operations.add(site.operation);
    file.entities.set(site.entity, perEntity);
    files.set(site.file, file);

    const entity = entities.get(site.entity)
      ?? { entity: site.entity, disposition: site.disposition, destination: site.destination, sites: 0, files: new Set() };
    entity.sites += 1;
    entity.files.add(site.file);
    entities.set(site.entity, entity);
  }

  const byFile = [...files.values()]
    .map(file => ({
      file: file.file,
      sites: file.sites,
      // A file whose EVERY entity is dropped has no half left to keep, which
      // is the first thing somebody deciding between "hide a section" and
      // "retire the screen" wants to know. Measured against that file's whole
      // entity reach, dropped and landable together.
      entirely_dropped: measured.sites.filter(site => site.file === file.file)
        .every(site => !SERVED.includes(site.destination)),
      entities: [...file.entities.values()]
        .map(entry => ({ ...entry, operations: [...entry.operations].sort() }))
        .sort((a, b) => (a.entity < b.entity ? -1 : 1)),
    }))
    .sort((a, b) => b.sites - a.sites || (a.file < b.file ? -1 : 1));

  const byEntity = [...entities.values()]
    .map(entry => ({ ...entry, files: [...entry.files].sort() }))
    .sort((a, b) => b.sites - a.sites || (a.entity < b.entity ? -1 : 1));

  const operations = { read: 0, write: 0, realtime: 0 };
  for (const site of dropped) operations[kind(site.operation)] += 1;

  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    sites: dropped.length,
    files: byFile.length,
    entities: byEntity.length,
    entirely_dropped_files: byFile.filter(file => file.entirely_dropped).length,
    operations,
    by_entity: byEntity,
    by_file: byFile,
  };
}

/** The inventory as a page somebody can act from, rather than as JSON. */
export function renderMarkdown(report) {
  const lines = [
    '# What the dropped domains cost, file by file',
    '',
    '> GENERATED by `node tools-frontend-retired-inventory.mjs --write`. Do not edit by hand.',
    '',
    `${report.sites} entity call sites across ${report.files} files reach a domain the`,
    'migration decided not to carry. This says what each file loses, so the hiding',
    'work is a series of per-screen decisions rather than one decision about 203',
    'numbers. It claims nothing about whether a screen is safe to hide: a file',
    'marked **whole** has no surviving data of its own, and every other file keeps',
    'some and needs reading.',
    '',
    `Reads ${report.operations.read}, writes ${report.operations.write}, `
      + `subscriptions ${report.operations.realtime}. `
      + `${report.entirely_dropped_files} of the ${report.files} files lose everything they read.`,
    '',
    '## By entity — what was decided',
    '',
    '| Entity | Sites | Files | What it becomes |',
    '| --- | ---: | ---: | --- |',
  ];
  for (const entry of report.by_entity) {
    lines.push(`| \`${entry.entity}\` | ${entry.sites} | ${entry.files.length} | ${OUTCOMES[entry.destination]} |`);
  }
  lines.push('', '## By file — what each screen loses', '');
  for (const file of report.by_file) {
    lines.push(`### \`${file.file}\`${file.entirely_dropped ? ' — **whole**' : ''}`, '');
    for (const entry of file.entities) {
      lines.push(`- \`${entry.entity}\` (${entry.operations.join(', ')}) — ${OUTCOMES[entry.destination]}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main(argv, log = console.log) {
  const args = argv.slice(2);
  if (args.some(argument => !['--json', '--summary', '--markdown', '--write'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  const repository = resolve(dirname(fileURLToPath(import.meta.url)));
  const report = measureInventory(repository);
  if (args.includes('--write')) {
    writeFileSync(join(repository, PAGE_FILE), renderMarkdown(report));
    log(JSON.stringify({ written: PAGE_FILE, sites: report.sites, files: report.files }));
  } else if (args.includes('--json')) log(JSON.stringify(report, null, 2));
  else if (args.includes('--markdown')) log(renderMarkdown(report));
  else {
    log(`dropped domains: ${report.sites} call sites across ${report.files} files and `
      + `${report.entities} entities; ${report.entirely_dropped_files} files lose everything they read`);
    log(`  reads ${report.operations.read}, writes ${report.operations.write}, `
      + `subscriptions ${report.operations.realtime}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv));
}

export { main };
