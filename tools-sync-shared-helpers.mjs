#!/usr/bin/env node
// Keeps helpers that are INLINED into multiple Base44 Deno functions in sync with
// the single canonical source in base44/_shared/backendHelpers.mjs.
//
// A function opts in by wrapping the helper in marker comments:
//   // <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
//   ...helper body (generated)...
//   // <<<END SHARED HELPER: isSafeFetchUrl>>>
//
//   node tools-sync-shared-helpers.mjs            # rewrite all consumers in place
//   node tools-sync-shared-helpers.mjs --check    # exit 1 if any copy is out of sync (CI)

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SHARED_HELPERS } from './base44/_shared/backendHelpers.mjs';

const FUNCTIONS_DIR = new URL('./base44/functions/', import.meta.url);

const beginMarker = (name) =>
  `// <<<BEGIN SHARED HELPER: ${name} — generated, edit base44/_shared/backendHelpers.mjs>>>`;
const endMarker = (name) => `// <<<END SHARED HELPER: ${name}>>>`;

/** Replace every marked helper block in `src` with its canonical source. */
export function applyHelpers(src) {
  let out = src;
  const applied = [];
  for (const [name, body] of Object.entries(SHARED_HELPERS)) {
    const begin = beginMarker(name);
    const end = endMarker(name);
    let from = 0;
    while (true) {
      const b = out.indexOf(begin, from);
      if (b === -1) break;
      const e = out.indexOf(end, b);
      if (e === -1) throw new Error(`Unbalanced markers for "${name}" (BEGIN without END)`);
      const block = `${begin}\n${body}\n${end}`;
      out = out.slice(0, b) + block + out.slice(e + end.length);
      from = b + block.length;
      applied.push(name);
    }
  }
  return { out, applied };
}

async function listEntryFiles() {
  const dirs = await readdir(FUNCTIONS_DIR, { withFileTypes: true });
  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    files.push(new URL(`./${d.name}/entry.ts`, FUNCTIONS_DIR));
  }
  return files;
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await listEntryFiles();
  let changed = 0;
  let consumers = 0;
  const drifted = [];

  for (const file of files) {
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    if (!src.includes('<<<BEGIN SHARED HELPER:')) continue;
    consumers += 1;
    const { out } = applyHelpers(src);
    if (out !== src) {
      changed += 1;
      drifted.push(file.pathname.split('/functions/')[1]);
      if (!check) await writeFile(file, out);
    }
  }

  if (check) {
    if (changed > 0) {
      console.error(`✗ ${changed} function(s) have out-of-sync shared helpers:\n  - ${drifted.join('\n  - ')}\n  Run: npm run sync:shared-helpers`);
      process.exit(1);
    }
    console.log(`✓ shared helpers in sync across ${consumers} consumer function(s).`);
  } else {
    console.log(changed > 0
      ? `Updated shared helpers in ${changed} function(s).`
      : `No changes — shared helpers already in sync across ${consumers} consumer(s).`);
  }
}

// Only run when invoked directly (allows importing applyHelpers in tests).
// Use pathToFileURL so the comparison is robust to relative paths / spaces —
// a bare `file://${process.argv[1]}` can be a malformed URL and silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
