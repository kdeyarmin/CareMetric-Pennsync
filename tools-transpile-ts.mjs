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
