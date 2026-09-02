#!/usr/bin/env node
/**
 * Generate the OASIS item review worksheet a qualified reviewer fills in.
 *
 * PennSync does not contain the authoritative CMS OASIS instrument, so its
 * internal item classifications (src/components/oasis/specs/verification.js)
 * were derived from internal evidence and from the app's own canonical scale
 * table — not from a reviewer reading the CMS manual. This tool produces the
 * artifact that closes that gap: one row per item, stating what PennSync claims
 * and the evidence behind it, with the reviewer's columns left blank.
 *
 * Deterministic: same inputs, same bytes, so the checked-in worksheet can be
 * regenerated and diffed. Run:
 *
 *   node tools-oasis-review-worksheet.mjs            # write docs/oasis/…
 *   node tools-oasis-review-worksheet.mjs --check    # fail if it is stale
 *
 * The item bank is a .jsx module, so it is bundled with esbuild (already pinned
 * in this repo) rather than imported directly.
 */
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "docs/oasis/ITEM_REVIEW_WORKSHEET.md");

async function loadItemBank() {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, "src/components/oasis/oasisQuestions.jsx")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const { OASIS_SECTIONS } = await import(url);
  return OASIS_SECTIONS.flatMap((section) =>
    (section.questions || []).map((q) => ({ id: q.id, label: q.label })));
}

const { buildClinicalReviewWorksheet } = await import(
  pathToFileURL(join(ROOT, "src/components/oasis/specs/verification.js")).href
);

const items = await loadItemBank();
// No timestamp in the output: a generated-on line would make every regeneration
// a diff and hide the substantive changes.
const worksheet = buildClinicalReviewWorksheet(items);

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error(`✗ ${OUT} is missing. Run: node tools-oasis-review-worksheet.mjs`);
    process.exit(1);
  }
  if (current !== worksheet) {
    console.error(`✗ ${OUT} is stale. Run: node tools-oasis-review-worksheet.mjs`);
    process.exit(1);
  }
  console.log(`✓ OASIS review worksheet is up to date (${items.length} items).`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, worksheet);
console.log(`✓ Wrote ${OUT} (${items.length} items).`);
