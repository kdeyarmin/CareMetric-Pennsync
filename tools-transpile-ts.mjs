#!/usr/bin/env node
/**
 * Shared TypeScript → ESM strip for tools and Base44 inline-parity tests.
 *
 * Prefer esbuild over `typescript.transpileModule`. TypeScript 7 redesigned the
 * default package export and no longer exposes the classic transpileModule /
 * ScriptTarget API that these callers depended on. esbuild is already pinned
 * in this repo (see pnpm-workspace.yaml overrides) and is sufficient for the
 * syntax-only transforms we need.
 */
import * as esbuild from "esbuild";
import { resolve as resolvePath } from "node:path";

/**
 * @param {string} source
 * @param {{ fileName?: string }} [opts]
 * @returns {{ outputText: string, warnings: import('esbuild').Message[] }}
 */
export function transpileTs(source, { fileName = "module.ts" } = {}) {
  const loader = fileName.endsWith("tsx") || fileName.endsWith("jsx") ? "tsx" : "ts";
  const result = esbuild.transformSync(source, {
    loader,
    format: "esm",
    target: "es2022",
    sourcemap: false,
    // Keep names stable for parity tests that export specific identifiers.
    keepNames: true,
    // Surface syntax errors as thrown TransformFailure (caught by callers that
    // need diagnostic lists).
    logLevel: "silent",
  });
  return { outputText: result.code, warnings: result.warnings || [] };
}

/**
 * Syntax-check + transpile. Returns a list of human-readable error strings
 * (empty when the source is valid). Compatible with the old transpileModule
 * diagnostic loop used by tools-check-backend-transpile.mjs.
 * @param {string} source
 * @param {{ fileName?: string }} [opts]
 * @returns {{ outputText: string | null, errors: string[] }}
 */
export function transpileTsCollectErrors(source, { fileName = "module.ts" } = {}) {
  try {
    const { outputText, warnings } = transpileTs(source, { fileName });
    // Treat esbuild warnings as non-fatal — parity/transpile checks only gate
    // on hard transform failures (syntax).
    void warnings;
    return { outputText, errors: [] };
  } catch (err) {
    const errors = [];
    const messages = err?.errors || [];
    if (Array.isArray(messages) && messages.length) {
      for (const m of messages) {
        const loc = m.location
          ? `${fileName}:${m.location.line}:${m.location.column}`
          : fileName;
        errors.push(`${loc} — ${m.text}`);
      }
    } else {
      errors.push(`${fileName} — ${err?.message || String(err)}`);
    }
    return { outputText: null, errors };
  }
}

const FUNCTION_DIRECTORY = new URL("./base44/functions/entry/", import.meta.url);
const NEW_FORMAT = /from\s+['"](?:base44:runtime(?:\/[^'"]*)?|\.{1,2}\/[^'"]+)['"]|export\s+default\b/;

// `base44:runtime` as a contract test sees it: secrets read through the same
// Deno.env.get stub the harness already provides for older functions.
const RUNTIME_STUB = `export const secrets = { get: (key) => globalThis.Deno?.env?.get?.(key) };
export const waitUntil = (promise) => promise;`;

/**
 * Transpile a Base44 function entry for a contract test, in either runtime
 * format.
 *
 * The Base44 editor's newer format (first used 2026-10-09) exports the handler
 * as the module default instead of passing it to `Deno.serve`, reads secrets
 * from `base44:runtime`, and imports from `base44/shared/`, which the Base44
 * CLI bundles into each function. A harness that writes the transpiled entry to
 * a temp file and captures `Deno.serve` can do none of that, so for such a
 * source this:
 *
 * - bundles relative imports inline, resolved as if from
 *   `base44/functions/<name>/`, so `../../shared/x.ts` is `base44/shared/x.ts`;
 * - serves `base44:runtime` from a stub whose `secrets.get` is `Deno.env.get`;
 * - registers a default-export handler through `Deno.serve` at load, which is
 *   what an older-format function does itself.
 *
 * Every other import (`npm:`, `node:`, URLs) is left external, as in
 * `transpileTs`. An older-format source is transpiled exactly as `transpileTs`
 * would.
 * @param {string} source
 * @param {{ fileName?: string }} [opts]
 * @returns {Promise<{ outputText: string, warnings: import('esbuild').Message[] }>}
 */
export async function transpileFunctionEntry(source, { fileName = "entry.ts" } = {}) {
  if (!NEW_FORMAT.test(source)) return transpileTs(source, { fileName });
  const servesDefault = /export\s+default\b/.test(source);
  const entry = "base44-function-entry";
  const result = await esbuild.build({
    stdin: {
      contents: servesDefault
        ? `import handler from ${JSON.stringify(entry)};\n`
          + `if (typeof handler === "function" && typeof globalThis.Deno?.serve === "function") globalThis.Deno.serve(handler);\n`
          + `export default handler;\n`
        : `import ${JSON.stringify(entry)};\n`,
      loader: "js",
      resolveDir: decodeURIComponent(FUNCTION_DIRECTORY.pathname),
      sourcefile: fileName,
    },
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    keepNames: true,
    logLevel: "silent",
    plugins: [{
      name: "base44-function-entry",
      setup(build) {
        build.onResolve({ filter: new RegExp(`^${entry}$`) }, () => ({ path: fileName, namespace: "base44-entry" }));
        build.onLoad({ filter: /.*/, namespace: "base44-entry" }, () => ({
          contents: source,
          loader: "ts",
          resolveDir: decodeURIComponent(FUNCTION_DIRECTORY.pathname),
        }));
        build.onResolve({ filter: /^base44:runtime(?:\/.*)?$/ }, (args) => ({ path: args.path, namespace: "base44-runtime" }));
        build.onLoad({ filter: /.*/, namespace: "base44-runtime" }, () => ({ contents: RUNTIME_STUB, loader: "js" }));
        // Only relative imports are bundled; everything else stays external.
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "entry-point") return undefined;
          if (/^\.{1,2}\//.test(args.path)) return { path: resolvePath(args.resolveDir, args.path) };
          return { path: args.path, external: true };
        });
      },
    }],
  });
  return { outputText: result.outputFiles[0].text, warnings: result.warnings || [] };
}
