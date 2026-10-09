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
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} source
 * @param {{ fileName?: string }} [opts]
 * @returns {{ outputText: string, warnings: import('esbuild').Message[] }}
 */
export function transpileTs(source, { fileName = "module.ts" } = {}) {
  if (isModernFunctionEntry(source)) return transpileModernFunctionEntry(source, fileName);
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

const FUNCTIONS_DIRECTORY = fileURLToPath(new URL("./base44/functions/", import.meta.url));
// esbuild resolves from a directory that must exist. Every function directory
// sits at the same depth, so any of them resolves `../../shared/` the same way.
const functionEntryDirectory = (fileName) => {
  const named = /^([\w-]+)\/entry\.ts$/.exec(fileName)?.[1];
  const candidates = [named, ...readdirSync(FUNCTIONS_DIRECTORY)].filter(Boolean);
  const found = candidates.find((name) => existsSync(join(FUNCTIONS_DIRECTORY, name, "entry.ts")));
  return join(FUNCTIONS_DIRECTORY, found);
};

/**
 * Whether `source` is a Base44 function entry in the editor's newer format
 * (first used 2026-10-09): it reads `base44:runtime`, imports from
 * `base44/shared/`, or exports its request handler as the module default.
 * @param {string} source
 */
export function isModernFunctionEntry(source) {
  return /from\s*["']base44:runtime["']/.test(source)
    || /from\s*["']\.\.\/\.\.\/shared\//.test(source)
    || /export\s+default\s+(?:async\s+)?function\s*[\w$]*\s*\(\s*req\b/.test(source);
}

/**
 * The newer format, transpiled so a contract harness can load it the way it
 * loads an older-format function:
 *
 * - relative imports are bundled, resolved as if from `base44/functions/<name>/`,
 *   so `../../shared/x.ts` is `base44/shared/x.ts`, which the Base44 CLI bundles
 *   into each function too;
 * - `base44:runtime` becomes an object whose `secrets.get` is the harness's own
 *   `Deno.env.get` stub;
 * - a default-export handler is also registered through `Deno.serve` at load,
 *   which is what an older-format function does itself.
 *
 * Every other import (`npm:`, `node:`, URLs) stays external, as `transpileTs`
 * leaves it.
 */
function transpileModernFunctionEntry(source, fileName) {
  const result = esbuild.buildSync({
    stdin: { contents: source, loader: "ts", resolveDir: functionEntryDirectory(fileName), sourcefile: fileName },
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    keepNames: true,
    logLevel: "silent",
    external: ["npm:*", "node:*", "jsr:*", "https:*", "http:*", "file:*", "base44:*"],
  });
  let code = result.outputFiles[0].text;
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*"base44:runtime(?:\/[^"]*)?";\n?/g, (_, names) => {
    const bindings = names.split(",").map((name) => name.trim()).filter(Boolean)
      .map((name) => name.replace(/\s+as\s+/, ": ")).join(", ");
    return `const { ${bindings} } = { secrets: { get: (key) => globalThis.Deno?.env?.get?.(key) }, waitUntil: (promise) => promise };\n`;
  });
  const exported = /export\s*\{([^}]*)\};?\s*$/.exec(code);
  const handler = exported?.[1].split(",").map((part) => part.trim())
    .find((part) => /\s+as\s+default$/.test(part))?.split(/\s+as\s+/)[0];
  if (handler) {
    code = code.slice(0, exported.index)
      + `if (typeof ${handler} === "function" && typeof globalThis.Deno?.serve === "function") globalThis.Deno.serve(${handler});\n`
      + code.slice(exported.index);
  }
  return { outputText: code, warnings: result.warnings || [] };
}

/**
 * The newer-format handling as an explicit, awaitable call. `transpileTs`
 * applies the same handling itself to a newer-format entry.
 * @param {string} source
 * @param {{ fileName?: string }} [opts]
 */
export async function transpileFunctionEntry(source, opts = {}) {
  return transpileTs(source, opts);
}
