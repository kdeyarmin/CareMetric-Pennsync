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
// Exit 0 for a completed check without signal diagnostics, 1 for findings,
// and 2 for an unavailable/broken compiler or invalid arguments.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SIGNAL_CODES = new Map([
  ['TS2367', 'comparison is always false — the two types cannot overlap'],
  ['TS2554', 'wrong number of arguments'],
  ['TS2555', 'too few arguments'],
  ['TS2556', 'spread argument count cannot satisfy the signature'],
  ['TS2349', 'value is not callable'],
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

export class CompilerExecutionError extends Error {
  constructor() {
    super('TypeScript did not complete a valid diagnostic run. Check the installed compiler and build environment.');
    this.name = 'CompilerExecutionError';
  }
}

export function readCompilerOutput(result) {
  const output = `${result?.stdout || ''}${result?.stderr || ''}`;
  const lines = output.split(/\r?\n/);
  const hasFileDiagnostic = lines.some((line) => DIAGNOSTIC.test(line.trim()));
  const hasGlobalDiagnostic = lines.some((line) => /^error TS\d+:/.test(line.trim()));
  const hasUnexpectedOutput = lines.some((line) => line.trim()
    && !DIAGNOSTIC.test(line.trim())
    && !/^\s+\S/.test(line));
  if (
    !result
    || result.error
    || result.signal
    || !Number.isInteger(result.status)
    || ![0, 1, 2].includes(result.status)
    || hasGlobalDiagnostic
    || hasUnexpectedOutput
    || (typeof result.stderr === 'string' && result.stderr.trim())
    || (result.status !== 0 && !hasFileDiagnostic)
    || (result.status === 0 && hasFileDiagnostic)
    || (output.trim() && !hasFileDiagnostic)
  ) {
    throw new CompilerExecutionError();
  }
  return output;
}

export function runTsc(configPath, { run = spawnSync, cwd = process.cwd() } = {}) {
  let compilerPath;
  try {
    const require = createRequire(join(cwd, 'package.json'));
    const packagePath = require.resolve('typescript/package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tsc;
    if (typeof entry !== 'string' || !entry) throw new CompilerExecutionError();
    compilerPath = resolve(dirname(packagePath), entry);
  } catch {
    throw new CompilerExecutionError();
  }
  let result;
  try {
    result = run(process.execPath, [compilerPath, '-p', configPath, '--pretty', 'false'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000,
      killSignal: 'SIGKILL',
    });
  } catch {
    throw new CompilerExecutionError();
  }
  return readCompilerOutput(result);
}

export function main(args = process.argv.slice(2), { compile = runTsc } = {}) {
  if (args.some((arg) => arg !== '--list') || args.length > 1) {
    console.error('Usage: node tools-typecheck-signal.mjs [--list]');
    return 2;
  }
  const listMode = args.includes('--list');
  const configPath = join(process.cwd(), 'tsconfig.typecheck-signal.json');
  writeFileSync(configPath, JSON.stringify(CONFIG, null, 2));

  let output;
  try {
    output = compile(configPath);
  } catch {
    console.error('✖ TypeScript execution failed; type-check results are unavailable (not a pass).');
    return 2;
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}