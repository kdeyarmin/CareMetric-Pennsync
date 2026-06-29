#!/usr/bin/env node
// Keeps the duplicate-patient matching engine in the Deno edge function in
// sync with the single source of truth used by the frontend.
//
// base44 edge functions are deployed as a single self-contained entry.ts and
// cannot import from src/, so the engine is embedded verbatim between marker
// comments. This script regenerates that block from
// src/components/patient/patientDuplicateUtils.js.
//
//   node tools-sync-dedupe-engine.mjs           # rewrite entry.ts in place
//   node tools-sync-dedupe-engine.mjs --check    # exit 1 if out of sync (CI/test)

import { readFile, writeFile } from 'node:fs/promises';

const ENGINE_PATH = new URL('./src/components/patient/patientDuplicateUtils.js', import.meta.url);
const ENTRY_PATH = new URL('./base44/functions/deduplicatePatients/entry.ts', import.meta.url);

export const BEGIN_MARKER =
  '// <<<BEGIN GENERATED ENGINE — DO NOT EDIT BY HAND.\n' +
  '// Source: src/components/patient/patientDuplicateUtils.js\n' +
  '// Regenerate: npm run sync:dedupe-engine>>>';
export const END_MARKER = '// <<<END GENERATED ENGINE>>>';

/** Build the full entry.ts contents with the current engine embedded. */
export async function buildEntrySource() {
  const engineSrc = (await readFile(ENGINE_PATH, 'utf8')).trim();
  const entrySrc = await readFile(ENTRY_PATH, 'utf8');

  const begin = entrySrc.indexOf(BEGIN_MARKER);
  const endStart = entrySrc.indexOf(END_MARKER);
  if (begin === -1 || endStart === -1 || endStart < begin) {
    throw new Error('entry.ts is missing the generated-engine markers');
  }
  const end = endStart + END_MARKER.length;

  const block = `${BEGIN_MARKER}\n${engineSrc}\n${END_MARKER}`;
  return entrySrc.slice(0, begin) + block + entrySrc.slice(end);
}

/** Extract the embedded engine source (between markers) from entry.ts text. */
export function extractEmbeddedEngine(entrySrc) {
  const begin = entrySrc.indexOf(BEGIN_MARKER);
  const endStart = entrySrc.indexOf(END_MARKER);
  if (begin === -1 || endStart === -1) return null;
  return entrySrc.slice(begin + BEGIN_MARKER.length, endStart).trim();
}

// Run as a CLI (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const next = await buildEntrySource();
  const current = await readFile(ENTRY_PATH, 'utf8');

  if (next === current) {
    console.log('deduplicatePatients engine is in sync.');
  } else if (check) {
    console.error(
      'deduplicatePatients engine is OUT OF SYNC with patientDuplicateUtils.js.\n' +
        'Run: npm run sync:dedupe-engine'
    );
    process.exit(1);
  } else {
    await writeFile(ENTRY_PATH, next);
    console.log('Updated base44/functions/deduplicatePatients/entry.ts');
  }
}
