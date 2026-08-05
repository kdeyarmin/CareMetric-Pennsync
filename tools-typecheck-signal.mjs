#!/usr/bin/env node
// High-signal type check for a plain-JS codebase.
//
// `pnpm run typecheck` runs tsc against jsconfig.json, which sets
// `checkJs: false` — so it only validates syntax and module resolution and can
// never fail on a type error. Turning checkJs on wholesale is not an option
// either: it reports ~25k errors, almost entirely untyped-JSX-prop noise
// (TS2322/TS2559 on every component prop), which no one can act on.
//
// The useful middle ground is to run the full checkJs pass and then keep only
// the error codes that indicate a genuine defect rather than a missing type
// annotation. Every code in SIGNAL_CODES below found a real, shipped bug when
// this was first run against the repo — for example TS2367 flagged
// `status === 'in_progress'` comparisons that could never be true because
// nothing ever produced that value, and TS2551 flagged a misspelled property.
//
// Usage:  node tools-typecheck-signal.mjs [--list]
//   --list   print every signal diagnostic and exit 0 (survey mode)
// Exit code 1 if any signal diagnostic is found (CI gate), 0 otherwise.

import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Error codes that indicate a real defect in untyped JS, with why each is kept.
 * Deliberately excludes TS2322/TS2559/TS2739/TS2740/TS2741/TS2345, which in this
 * codebase are overwhelmingly "component prop has no declared type".
 */
const SIGNAL_CODES = new Map([
  ['TS2367', 'comparison is always false — the two types cannot overlap'],
  ['TS2554', 'wrong number of arguments'],
  ['TS2555', 'too few arguments'],
  ['TS2556', 'spread argument count cannot satisfy the signature'],
  ['TS2349', 'value is not callable'],
  // NOT included: TS2362/TS2363/TS2365 (arithmetic/relational operand is not a
  // number). In this codebase they are almost entirely `dateA - dateB` and
  // `date > timestamp`, which are correct JS — Date coerces via valueOf — and
  // they accounted for 137 of 159 hits when this tool was first tuned. Keeping
  // them would have made the gate pure noise.
  // NOT included: TS2551 (property does not exist, did you mean…), which here
  // only ever fires on real browser globals TS's DOM lib omits
  // (window.SpeechRecognition, window.webkitAudioContext).
  ['TS2447', 'bitwise operator applied to a non-number'],
  ['TS2538', 'value cannot be used as an index type'],
  ['TS2539', 'assignment to something that is not a variable'],
  ['TS2540', 'assignment to a read-only property'],
  ['TS2564', 'property has no initializer and is not definitely assigned'],
  ['TS2588', 'assignment to a constant'],
  ['TS2704', 'delete of a non-optional property'],
  ['TS2721', 'possibly-null value invoked as a function'],
  ['TS18048', 'value is possibly undefined at a dereference'],
  ['TS18047', 'value is possibly null at a dereference'],
]);

// Files whose diagnostics are ignored: test/spec files build deliberately
// partial fixtures (`const rows = []` then `rows[0].id`), which is exactly the
// shape TS18048/TS2493 flag, and is intentional there.
const isIgnoredFile = (file) => /\.(test|spec)\.(js|jsx|mjs)$/.test(file);

const CONFIG = {
  compilerOptions: {
    paths: { '@/*': ['./src/*'] },
    jsx: 'react-jsx',
    module: 'esnext',
    moduleResolution: 'bundler',
    lib: ['esnext', 'dom'],
    target: 'esnext',
    allowJs: true,
    checkJs: true,
    noEmit: true,
    strict: false,
    skipLibCheck: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    types: ['node'],
  },
  include: ['src/**/*.js', 'src/**/*.jsx'],
  exclude: ['node_modules', 'dist', 'src/vite-plugins'],
};

const DIAGNOSTIC = /^(?<file>[^(]+)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<message>.*)$/;

function runTsc(configPath) {
  try {
    return execFileSync('npx', ['tsc', '-p', configPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (error) {
    // tsc exits non-zero whenever it reports anything; the diagnostics are on stdout.
    return `${error.stdout || ''}${error.stderr || ''}`;
  }
}

function main() {
  const listMode = process.argv.includes('--list');
  // Written at the repo root, not a temp dir: a tsconfig's `include` globs
  // resolve relative to the config file's own location, so a temp-dir config
  // silently matches zero files and reports a clean run.
  const configPath = join(process.cwd(), 'tsconfig.typecheck-signal.json');
  writeFileSync(configPath, JSON.stringify(CONFIG, null, 2));

  let output;
  try {
    output = runTsc(configPath);
  } finally {
    rmSync(configPath, { force: true });
  }

  const hits = [];
  let total = 0;
  for (const line of output.split('\n')) {
    const m = DIAGNOSTIC.exec(line.trim());
    if (!m) continue;
    total += 1;
    const { file, code } = m.groups;
    if (!SIGNAL_CODES.has(code)) continue;
    if (isIgnoredFile(file)) continue;
    hits.push({ ...m.groups, why: SIGNAL_CODES.get(code) });
  }

  if (hits.length === 0) {
    console.log(`✓ no high-signal type diagnostics (${total} total diagnostics, all low-signal or in test fixtures).`);
    return 0;
  }

  console.error(`✖ ${hits.length} high-signal type diagnostic(s) out of ${total} total:\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}:${h.col}`);
    console.error(`    ${h.code} — ${h.why}`);
    console.error(`    ${h.message}\n`);
  }
  if (listMode) return 0;
  console.error('These codes indicate real defects, not missing type annotations.');
  console.error('Fix them, or if one is genuinely a false positive, narrow it at the call site.');
  return 1;
}

process.exit(main());
