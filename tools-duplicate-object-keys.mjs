#!/usr/bin/env node
/**
 * Fail closed on a DUPLICATE OBJECT KEY anywhere in the tracked JavaScript and
 * TypeScript.
 *
 * The hazard (measured by #360's seat): two branches each add the same key to
 * the same frozen registry literal in `services/authority-client/client.mjs`
 * at different offsets. Git merges both additions with NO conflict, because a
 * duplicate data key in an ES module is legal — the later one silently wins,
 * `Object.keys` shows one key, and `node --check` passes. Nothing a contributor
 * runs catches it, and it exists only in the MERGED tree, so neither branch's
 * own green says anything about it.
 *
 * The instrument (measured by #372's seat): esbuild's `transformSync` — already
 * vendored here at 0.28.2 and already invoked by `tools-transpile-ts.mjs` for
 * the backend-transpile gate — emits `Duplicate key "alpha" in object literal`
 * with a line number. The repository already had the means; the transpile gate
 * discards the warnings (`void warnings`). This is the same shape as #380: the
 * parser already says it, the gate throws it away, and nobody finds out. This
 * check keeps the warning.
 *
 * SCOPE: every tracked `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.tsx`, `.mts`,
 * `.cts`. The hazard is the same in all of them — a TypeScript object literal
 * merges a duplicate key exactly as an ES module one does — and esbuild parses
 * all of them, so scanning fewer than the whole tracked JS/TS population would
 * be a self-inflicted blind spot of the kind this gate exists to refuse. The
 * success line prints the population it cleared; there is no excluded count
 * because nothing in the tracked JS/TS population is excluded.
 *
 * LOADER: the loader is chosen per extension — `tsx` for `.jsx`/`.tsx`, `ts`
 * for `.ts`/`.mts`/`.cts`, `js` for `.js`/`.cjs`/`.mjs`. #376's seat measured
 * that the `js` and `ts` loaders THROW on JSX while `tsx` accepts both JSX and
 * TypeScript, so a file whose extension understates its syntax (JSX in a `.js`)
 * would throw under its per-extension loader. A throw is retried once under
 * `tsx`; only a file that throws under BOTH is unparseable.
 *
 * REFUSAL (not print): this is a gate, so the clean answer has to REFUSE when
 * it did not see the whole population, not merely print a smaller number. Two
 * refusals enforce that: an empty file list fails, and any file that is
 * unparseable even after the `tsx` retry fails the gate by name. The success
 * path asserts files-parsed == files-in-scope, so a population that shrinks
 * through a per-file parse failure can never produce a clean line. The refusal
 * message breaks the unparseable set down BY EXTENSION first (Plan's sharpened
 * requirement): one aggregate count cannot tell three odd files from a whole
 * class gone invisible — "every .jsx skipped" is a tolerable-looking number and
 * an intolerable hole — so the dimension a hole runs along is named before the
 * per-file list (which carries the directory).
 *
 * Getter/setter pairs and other legal repeats are NOT duplicates and esbuild
 * does not warn on them, so matching the parser's own warning rather than a
 * hand-rolled key scan is what keeps this precise.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const DUPLICATE_KEY = /^Duplicate key\b.*\bin object literal$/;
// Every tracked JS/TS extension: optional c|m prefix, j or t, s, optional x.
// Matches js, cjs, mjs, jsx, ts, cts, mts, tsx; not json (trailing chars).
const JS_EXTENSIONS = /\.(?:c|m)?[jt]sx?$/;

/** The esbuild loader a file's extension selects before any retry. */
function loaderFor(fileName) {
  if (/\.[jt]sx$/.test(fileName)) return "tsx"; // .jsx, .tsx
  if (/\.(?:c|m)?ts$/.test(fileName)) return "ts"; // .ts, .cts, .mts
  return "js"; // .js, .cjs, .mjs
}

function transform(source, loader) {
  return esbuild.transformSync(source, {
    loader,
    // The object literal is the same shape in every module format; esbuild
    // parses and warns regardless of what we ask it to emit.
    format: "esm",
    sourcemap: false,
    logLevel: "silent",
    // `logLimit: 0` lifts esbuild's diagnostic cap. In 0.28.2 that cap governs
    // PRINTED messages, not the `warnings` array returned here (measured: a
    // duplicate-key warning still arrives behind 200 earlier warnings), and
    // `logLevel: "silent"` suppresses printing anyway — so this changes nothing
    // today. It is set so the fail-closed guarantee does not REST on that
    // undocumented behaviour: were a future esbuild to truncate the returned
    // array at the default 10, a duplicate warning behind enough non-target
    // ones would be dropped and the file would read clean. Belt and suspenders
    // over a hole a reviewer flagged, pinned by the regression test.
    logLimit: 0,
  });
}

/**
 * Parse one source and return the duplicate-object-key warnings esbuild emits.
 * Pure: takes the text, never touches the filesystem.
 * @param {string} source
 * @param {string} fileName — selects the loader (see `loaderFor`).
 * @returns {{ dupes: object[], retriedAsTsx: boolean } | null} — null when the
 *   file cannot be parsed under its loader OR a `tsx` retry (the caller fails
 *   the gate on null; it is never a silent clean pass).
 */
export function findDuplicateKeys(source, fileName) {
  const primary = loaderFor(fileName);
  let warnings;
  let retriedAsTsx = false;
  try {
    ({ warnings } = transform(source, primary));
  } catch {
    // The per-extension loader could not parse this file — the measured case
    // is JSX under the `js` or `ts` loader, which THROW where `tsx` does not.
    // A TS type assertion like `<T>x` is the reverse (it parses under `ts` and
    // throws under `tsx`), but that path does not throw under `ts`, so it never
    // reaches this retry. Retry once under `tsx`; a file that throws under both
    // is genuinely unparseable and the caller fails the gate, named.
    if (primary === "tsx") return null;
    try {
      ({ warnings } = transform(source, "tsx"));
      retriedAsTsx = true;
    } catch {
      return null;
    }
  }
  const dupes = [];
  for (const w of warnings || []) {
    if (DUPLICATE_KEY.test(w.text)) {
      const m = /^Duplicate key "(.*)" in object literal$/.exec(w.text);
      // esbuild carries BOTH ends of the collision: the warning location is the
      // DUPLICATE, and a note "The original key … is here:" carries the FIRST.
      // Naming both is Plan's requirement — the hazard is a key appended far
      // from its first use, so the duplicate's line alone does not lead a reader
      // to what it shadows.
      const note = (w.notes || []).find((n) => n.location);
      dupes.push({
        key: m ? m[1] : null,
        line: w.location ? w.location.line : null,
        column: w.location ? w.location.column : null,
        originalLine: note && note.location ? note.location.line : null,
        text: w.text,
      });
    }
  }
  return { dupes, retriedAsTsx };
}

/**
 * Tally a set of files by extension, most-frequent first. Used to break a
 * parse-failure down along the dimension a systematic hole runs along, so a
 * whole class gone invisible (every `.jsx`) is legible rather than a flat count.
 * @param {string[]} files
 * @returns {[string, number][]}
 */
export function unparseableByExtension(files) {
  const counts = new Map();
  for (const f of files) {
    const m = /\.([^./\\]+)$/.exec(f);
    const ext = m ? `.${m[1]}` : "(none)";
    counts.set(ext, (counts.get(ext) || 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

/** The tracked JS/TS files, from git rather than a disk walk. */
export function trackedJsFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return out.split("\0").filter((p) => p && JS_EXTENSIONS.test(p));
}

/**
 * Scan a list of files. Returns the duplicate findings, the files that could
 * not be parsed, and how many needed a `tsx` retry, so the caller decides what
 * fails the gate and can report the population it covered.
 * @param {string[]} files
 */
export function scanFiles(files) {
  const findings = [];
  const unparseable = [];
  let retried = 0;
  for (const file of files) {
    const res = findDuplicateKeys(readFileSync(file, "utf8"), file);
    if (res === null) {
      unparseable.push(file);
      continue;
    }
    if (res.retriedAsTsx) retried += 1;
    for (const d of res.dupes) findings.push({ file, ...d });
  }
  return { findings, unparseable, retried, scanned: files.length };
}

function main() {
  let files;
  try {
    files = trackedJsFiles();
  } catch (err) {
    // git failing (not a repo, not installed) is a blind run by another route:
    // refuse rather than let an uncaught throw read as an incidental crash.
    console.error(
      `duplicate-object-keys: could not list tracked files (${err?.message || err}) — refusing to report clean.`,
    );
    process.exit(1);
  }

  // Fail closed on a BLIND run. Reporting "0 duplicates" after looking at
  // nothing is indistinguishable from a healthy tree except by the population
  // size, so a zero population is refused rather than reported clean — the
  // exact failure (a clean answer from a check that saw nothing) this gate
  // exists to catch, turned on the gate itself.
  if (files.length === 0) {
    console.error(
      "duplicate-object-keys: no tracked JS/TS files found — refusing to report clean.",
    );
    process.exit(1);
  }

  const { findings, unparseable, retried, scanned } = scanFiles(files);
  const parsed = scanned - unparseable.length;

  if (unparseable.length) {
    // Fail closed: a file this check cannot parse is one it cannot clear, so a
    // population that shrank through a parse failure never reaches the clean
    // line below. The by-extension tally comes first so a systematic hole (a
    // whole class the vendored parser stopped taking) is legible at a glance,
    // not inferred from a long flat list.
    const byExt = unparseableByExtension(unparseable)
      .map(([ext, n]) => `${ext}=${n}`)
      .join(" ");
    console.error(
      `duplicate-object-keys: ${unparseable.length} of ${scanned} tracked file(s) could not be parsed under their loader or a tsx retry (by extension: ${byExt}):`,
    );
    for (const f of unparseable) console.error(`  ${f}`);
  }

  if (findings.length) {
    console.error(
      `duplicate-object-keys: ${findings.length} duplicate object key(s) in tracked JavaScript/TypeScript:`,
    );
    for (const f of findings) {
      const original =
        f.originalLine != null ? ` (first use at line ${f.originalLine})` : "";
      console.error(`  ${f.file}:${f.line}:${f.column} — ${f.text}${original}`);
    }
  }

  if (findings.length || unparseable.length) process.exit(1);

  // Invariant: a clean answer is printed only after parsing every file in
  // scope. The unparseable refusal above already guarantees this; assert it on
  // the success path too, so the guarantee is local to the line that claims
  // "0 duplicates" rather than inferred from a branch three steps up.
  if (parsed !== scanned) {
    console.error(
      `duplicate-object-keys: parsed ${parsed} of ${scanned} tracked file(s) — refusing to report clean.`,
    );
    process.exit(1);
  }

  // The parsed count is a first-class result (Plan's requirement): a clean
  // answer carries the population it cleared, so it cannot be read as a blind
  // zero. The retry count surfaces any file whose extension understated its
  // syntax — 0 on a tree whose extensions match their contents.
  console.log(
    `duplicate-object-keys: parsed ${parsed}/${scanned} tracked file(s) (${retried} via tsx retry), 0 duplicate object keys.`,
  );
}

// Convert one representation into the other rather than pasting a path into
// URL syntax (a hand-built `file://` string matches neither a Windows nor a
// percent-encoded path), and guard on argv[1] presence so the module still
// imports when there is none — see tools-cli-entrypoint.test.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
