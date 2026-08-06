#!/usr/bin/env node
// Transpile-check every Base44 Deno function (base44/functions/**/entry.ts).
//
// We can't run Deno here, but esbuild (see tools-transpile-ts.mjs) catches
// SYNTAX errors — the main risk when editing these single-file functions
// blind. This is the closest in-repo equivalent of the deploy-time
// transpile/smoke check. It does NOT type-check (Deno globals would make that
// noisy); it only fails on parse/syntax errors.
import { readdir, readFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transpileTsCollectErrors } from "./tools-transpile-ts.mjs";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const root = join(repoRoot, "base44", "functions");
const srcRoot = join(repoRoot, "src");
const wrappersRoot = join(repoRoot, "src", "functions");

async function* entryFiles(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) yield* entryFiles(join(dir, ent.name));
    else if (ent.name === "entry.ts") yield join(dir, ent.name);
  }
}

let checked = 0;
const failures = [];
const backendFunctionNames = new Set();

for await (const file of entryFiles(root)) {
  checked++;
  backendFunctionNames.add(relative(root, dirname(file)).split(/[\\/]/)[0]);
  const src = await readFile(file, "utf8");
  const { errors } = transpileTsCollectErrors(src, { fileName: file });
  for (const err of errors) failures.push(err);
}

async function* sourceFiles(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, ent.name);
    if (ent.isDirectory()) yield* sourceFiles(file);
    else if (/\.[cm]?[jt]sx?$/.test(ent.name)) yield file;
  }
}

const invokePattern = /functions\.(?:invoke|fetch)\(\s*['"]([^'"]+)['"]/g;
const wrapperInvokePattern = /base44\.functions\.(?:invoke|fetch)\(\s*['"]([^'"]+)['"]/g;

async function checkInvokedBackendFunctionsExist() {
  for await (const file of sourceFiles(srcRoot)) {
    const src = await readFile(file, "utf8");
    for (const match of src.matchAll(invokePattern)) {
      const functionName = match[1];
      if (!backendFunctionNames.has(functionName)) {
        failures.push(`${file} invokes missing Base44 function '${functionName}'`);
      }
    }
  }
}

async function checkClientWrappersTargetMatchingBackendFunctions() {
  for await (const file of sourceFiles(wrappersRoot)) {
    // Colocated test files exercise the wrappers (mocking the client), they
    // are not wrappers themselves — the one-invocation rule doesn't apply.
    if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)) continue;
    const wrapperName = relative(wrappersRoot, file).replace(/\.[cm]?[jt]sx?$/, "");
    const src = await readFile(file, "utf8");
    const targets = [...src.matchAll(wrapperInvokePattern)].map((match) => match[1]);
    if (targets.length !== 1) {
      failures.push(`${file} must invoke exactly one Base44 function, found ${targets.length}`);
      continue;
    }
    const [target] = targets;
    if (target !== wrapperName) {
      failures.push(`${file} wrapper name does not match invoked Base44 function '${target}'`);
    }
    if (!backendFunctionNames.has(target)) {
      failures.push(`${file} targets missing Base44 function '${target}'`);
    }
  }
}

await checkInvokedBackendFunctionsExist();
await checkClientWrappersTargetMatchingBackendFunctions();

if (failures.length) {
  console.error(`✗ ${failures.length} backend compatibility validation failure(s) (${checked} backend entry file(s) checked):\n`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ ${checked} Base44 functions transpile cleanly and client invocations target existing Base44 functions.`);
