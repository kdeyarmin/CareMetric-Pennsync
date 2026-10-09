// Loads a Base44 function entry for a contract test, in either runtime format.
//
// The original format registers its handler with `Deno.serve(handler)`. The
// Base44 editor's newer format (first used 2026-10-09) instead exports it as
// the module's default, reads secrets from `base44:runtime`, and may import
// from `base44/shared/`, which the Base44 CLI bundles into each function. A
// test that copies the entry to a temp file and captures `Deno.serve` sees no
// handler in the new format and cannot resolve either import, so this loader:
//
// - replaces the pinned `npm:@base44/sdk` import with the caller's client;
// - replaces `base44:runtime` with `runtime` (default: no secrets);
// - transpiles each relative `.ts` import (for example
//   `../../shared/aiResponsibilityPolicy.ts`) to its own temp module;
// - returns the handler from `Deno.serve` or, failing that, the default export.
//
// Temp files are removed before it returns, and `globalThis.Deno` is restored.
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const SDK_IMPORT = /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/;
const RUNTIME_IMPORT = /import\s+\{([^}]*)\}\s+from\s+'base44:runtime';?/g;
const RELATIVE_TS_IMPORT = /from\s+'(\.{1,2}\/[^']+\.ts)'/g;

let sequence = 0;
const tempFile = (stem) => join(
  tmpdir(),
  `${stem}_${process.pid}_${Date.now()}_${(sequence += 1)}_${Math.random().toString(36).slice(2)}.mjs`,
);

async function emit(url, written, { replaceSdk }) {
  let source = await readFile(url, 'utf8');
  if (replaceSdk) source = source.replace(SDK_IMPORT, 'const createClientFromRequest = globalThis.__functionEntryClient;');
  source = source.replace(RUNTIME_IMPORT, (_, names) => `const {${names}} = globalThis.__functionEntryRuntime;`);
  const imports = [...source.matchAll(RELATIVE_TS_IMPORT)].map((match) => match[1]);
  for (const specifier of new Set(imports)) {
    const dependency = await emit(new URL(specifier, url), written, { replaceSdk: false });
    source = source.replaceAll(`'${specifier}'`, `'${pathToFileURL(dependency).href}'`);
  }
  const file = tempFile(fileURLToPath(url).split(/[\\/]/).slice(-2).join('_').replace(/\W/g, '_'));
  await writeFile(file, transpileTs(source).outputText);
  written.push(file);
  return file;
}

/**
 * Imports a backend module that is not an entry (for example one under
 * `base44/shared/`), with `base44:runtime` replaced by `runtime`, so a test can
 * use the module's own code rather than a retyped copy of it.
 */
export async function importBackendModule(moduleUrl, { runtime = { secrets: { get: () => undefined } } } = {}) {
  const written = [];
  globalThis.__functionEntryRuntime = runtime;
  try {
    return await import(pathToFileURL(await emit(moduleUrl, written, { replaceSdk: false })).href);
  } finally {
    await Promise.all(written.map((file) => unlink(file).catch(() => {})));
    delete globalThis.__functionEntryRuntime;
  }
}

/**
 * @param {URL} entryUrl - the function's `entry.ts`.
 * @param {object} options
 * @param {object} options.client - what `createClientFromRequest` returns.
 * @param {object} [options.runtime] - the `base44:runtime` module; defaults to no secrets.
 * @returns {Promise<Function|undefined>} the request handler.
 */
export async function loadFunctionEntry(entryUrl, { client, runtime = { secrets: { get: () => undefined } } } = {}) {
  const written = [];
  let handler;
  const previousDeno = globalThis.Deno;
  globalThis.__functionEntryClient = () => client;
  globalThis.__functionEntryRuntime = runtime;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: () => undefined } };
  try {
    const file = await emit(entryUrl, written, { replaceSdk: true });
    const module = await import(pathToFileURL(file).href);
    return handler ?? (typeof module.default === 'function' ? module.default : undefined);
  } finally {
    await Promise.all(written.map((file) => unlink(file).catch(() => {})));
    delete globalThis.__functionEntryClient;
    delete globalThis.__functionEntryRuntime;
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
  }
}
