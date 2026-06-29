#!/usr/bin/env node
// Transpile-check every Base44 Deno function (base44/functions/**/entry.ts).
//
// We can't run Deno here, but the TypeScript compiler (already a devDependency,
// used by the inline-parity tests) catches SYNTAX errors — the main risk when
// editing these single-file functions blind. This is the closest in-repo
// equivalent of the deploy-time transpile/smoke check. It does NOT type-check
// (Deno globals would make that noisy); it only fails on parse/syntax errors.
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "base44", "functions");

async function* entryFiles(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) yield* entryFiles(join(dir, ent.name));
    else if (ent.name === "entry.ts") yield join(dir, ent.name);
  }
}

let checked = 0;
const failures = [];

for await (const file of entryFiles(root)) {
  checked++;
  const src = await readFile(file, "utf8");
  const out = ts.transpileModule(src, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  // Category 1 === Error. transpileModule surfaces syntax errors here.
  const errors = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  for (const d of errors) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    const pos = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    failures.push(`${file}${pos ? `:${pos.line + 1}:${pos.character + 1}` : ""} — ${msg}`);
  }
}

if (failures.length) {
  console.error(`✗ ${failures.length} transpile error(s) across ${checked} functions:\n`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ ${checked} Base44 functions transpile cleanly (syntax check).`);
