#!/usr/bin/env node
// Enumerating guard: every Base44 Deno function that builds an SDK client from its
// incoming Request must route that Request through a pinned-request wrapper, never
// hand createClientFromRequest (or an alias of it) the raw req.
//
// Why this exists. createClientFromRequest reads TWO things straight off the
// inbound headers and validates neither:
//   * serverUrl, from the Base44-Api-Url header (NOT request.url) — a caller who
//     sets it aims the client's credential at a host of their choosing; and
//   * appId, from the Base44-App-Id header — it becomes both the /apps/<appId>/
//     path and the X-App-Id header on that same credentialed client, so a caller
//     who sets it aims the credential at another app's data.
// The URL on the constructed Request appears to decide the host but reaches
// nothing; the headers decide. The wrappers (base44/_shared/backendHelpers.mjs)
// close both: they DROP Base44-Api-Url/State/functions-version so serverUrl falls
// back to the platform default, and they emit a pinned Base44-App-Id — the
// caller-supplied expected constant — refusing (throwing, naming both ids) on a
// mismatch. The fix only works if every call site uses it, so this walks the
// function directory and tests each one: a new function added raw is a red here,
// not an omission from a hand-kept list.
//
// There are two wrappers, picked by posture so a posture cannot be acquired by
// omission:
//   * userScopedClientRequest(req, expectedAppId)  — forwards the user credential
//   * serviceRoleClientRequest(req, expectedAppId) — service credential only
// This checks, per function that builds a client from a request:
//   1. every factory call (createClientFromRequest, or a local alias assigned
//      from it) wraps its argument in one of the two wrappers, called DIRECTLY at
//      the factory site (not via a variable), WITH an expected-app-id argument;
//   2. the base44ClientRequest shared-helper block is inlined in the file; and
//   3. if a wrapper call's app-id argument is PENNSYNC_PRODUCTION_APP_ID, the
//      pennsyncProductionAppId block is inlined too, so the constant resolves.
// check:shared-helpers polices that an inlined copy matches the canonical source;
// this only checks presence.
//
// A function with a genuine reason to deviate declares itself in ESCAPES with a
// reason of real length; the guard still requires a wrapped, app-id-bearing call,
// so an escape documents intent without reopening the hole. Empty by design.
//
//   node tools-pinned-sdk-request.mjs            # check (exit 1 on findings)
//   node tools-pinned-sdk-request.mjs --summary  # one-line summary first
//   node tools-pinned-sdk-request.mjs --json     # machine-readable report

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FUNCTIONS_DIR = path.join(HERE, 'base44', 'functions');

// function name -> reason. A function here still must wrap its call; the entry
// records why it deviates. Empty by design.
export const ESCAPES = Object.freeze({});

const CLIENT_FACTORY = 'createClientFromRequest';
export const WRAPPERS = Object.freeze(['userScopedClientRequest', 'serviceRoleClientRequest']);
const PROD_APP_ID_IDENTIFIER = 'PENNSYNC_PRODUCTION_APP_ID';
const HELPER_MARKER = '<<<BEGIN SHARED HELPER: base44ClientRequest';
const PROD_APP_ID_MARKER = '<<<BEGIN SHARED HELPER: pennsyncProductionAppId';

// Strip line and block comments, string and template literals, and REGEX literals
// so a call or marker mentioned in prose does not read as code, a commented-out
// call does not read as a finding, and — the subtle one — a quote or backtick
// inside a regex does not desync string tracking and swallow real code after it.
// It is not a full JS parser, but it tracks the five literal forms and template
// interpolation (via a context stack) so the code it leaves behind is faithful
// enough to search. Regex-vs-division is decided by whether the previous
// meaningful character is in expression position; when ambiguous it prefers
// regex, because mis-reading a regex AS division is the failure that desyncs.
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // Stack of contexts. 'code' may be the top-level or a template interpolation
  // (interp:true), which ends at the brace that balances its opening `${`.
  const stack = [{ kind: 'code', interp: false, depth: 0 }];
  let last = ''; // last meaningful (non-space) char emitted while in code
  const top = () => stack[stack.length - 1];
  // Regex is allowed when the previous meaningful char does not end a value.
  const regexAllowed = () => last === '' || !/[A-Za-z0-9_$)\].]/.test(last);
  while (i < n) {
    const ctx = top();
    const c = src[i];
    const d = src[i + 1];
    if (ctx.kind === 'code') {
      if (c === '/' && d === '/') { // line comment
        i += 2; while (i < n && src[i] !== '\n') i += 1; continue;
      }
      if (c === '/' && d === '*') { // block comment
        i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue;
      }
      if (c === "'" || c === '"') { stack.push({ kind: 'string', q: c }); i += 1; continue; }
      if (c === '`') { stack.push({ kind: 'template' }); i += 1; continue; }
      if (c === '/' && regexAllowed()) { stack.push({ kind: 'regex', inClass: false }); i += 1; continue; }
      if (ctx.interp) {
        if (c === '{') { ctx.depth += 1; }
        else if (c === '}') { if (ctx.depth === 0) { stack.pop(); i += 1; continue; } ctx.depth -= 1; }
      }
      out += c;
      if (!/\s/.test(c)) last = c;
      i += 1; continue;
    }
    if (ctx.kind === 'string') {
      if (c === '\\') { i += 2; continue; }
      if (c === ctx.q) { stack.pop(); }
      i += 1; continue;
    }
    if (ctx.kind === 'template') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i += 1; continue; }
      if (c === '$' && d === '{') { stack.push({ kind: 'code', interp: true, depth: 0 }); i += 2; continue; }
      i += 1; continue;
    }
    if (ctx.kind === 'regex') {
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { ctx.inClass = true; i += 1; continue; }
      if (c === ']') { ctx.inClass = false; i += 1; continue; }
      if (c === '/' && !ctx.inClass) { stack.pop(); last = '/'; i += 1; continue; }
      i += 1; continue;
    }
  }
  return out;
}

const isIdentChar = (ch) => !!ch && /[A-Za-z0-9_$.]/.test(ch);

// Local identifiers bound to createClientFromRequest, e.g. a default parameter
// `createClient = createClientFromRequest`. Calls to them are factory calls too.
export function factoryAliases(code) {
  const aliases = new Set();
  const re = /([A-Za-z_$][\w$]*)\s*=\s*createClientFromRequest\b/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m[1] !== CLIENT_FACTORY) aliases.add(m[1]);
  }
  return aliases;
}

// From the position just after an opening paren, return the slice of arguments up
// to the matching close paren, and whether a top-level comma (a second argument)
// appears before it. Input must be comment/string-stripped.
function argListAfter(code, openParenIdx) {
  let depth = 1;
  let i = openParenIdx + 1;
  let topLevelComma = false;
  const start = i;
  for (; i < code.length && depth > 0; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 1) topLevelComma = true;
  }
  return { args: code.slice(start, i - 1), topLevelComma, end: i };
}

// The first argument of a call whose open paren is at openParenIdx: the text up to
// the first top-level comma or the matching close paren.
function firstArgAfter(code, openParenIdx) {
  let depth = 1;
  let i = openParenIdx + 1;
  const start = i;
  for (; i < code.length && depth > 0; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { depth -= 1; if (depth === 0) break; }
    else if (c === ',' && depth === 1) break;
  }
  return code.slice(start, i).trim();
}

/** Every factory call and how it is wrapped. Returns
 *  [{ wrapped, wrapper, hasAppId, usesProdConst }]. */
export function clientFactoryCalls(code) {
  const names = [CLIENT_FACTORY, ...factoryAliases(code)];
  const calls = [];
  for (const name of names) {
    let from = 0;
    const needle = `${name}(`;
    while (true) {
      const idx = code.indexOf(needle, from);
      if (idx === -1) break;
      const before = idx === 0 ? '' : code[idx - 1];
      if (isIdentChar(before)) { from = idx + name.length; continue; } // part of a longer identifier
      const openParen = idx + name.length;
      const arg = firstArgAfter(code, openParen);
      let wrapped = false;
      let wrapper = null;
      let hasAppId = false;
      let usesProdConst = false;
      for (const w of WRAPPERS) {
        if (arg.startsWith(`${w}(`)) {
          wrapped = true;
          wrapper = w;
          const wOpen = arg.indexOf('(');
          const inner = argListAfter(arg, wOpen);
          hasAppId = inner.topLevelComma;
          usesProdConst = new RegExp(`(^|[^\\w$.])${PROD_APP_ID_IDENTIFIER}([^\\w$]|$)`).test(inner.args);
          break;
        }
      }
      calls.push({ wrapped, wrapper, hasAppId, usesProdConst });
      from = openParen;
    }
  }
  return calls;
}

export function analyzeFunction(name, code, escapes = ESCAPES) {
  const stripped = stripCommentsAndStrings(code);
  const calls = clientFactoryCalls(stripped);
  if (calls.length === 0) return null; // does not build a client from a request
  const findings = [];
  const raw = calls.filter((c) => !c.wrapped).length;
  if (raw > 0) {
    findings.push({
      name, kind: 'raw_call',
      detail: `${raw} of ${calls.length} factory call(s) do not wrap their argument in ${WRAPPERS.join('(...) or ')}(...)`,
    });
  }
  const wrappedNoAppId = calls.filter((c) => c.wrapped && !c.hasAppId).length;
  if (wrappedNoAppId > 0) {
    findings.push({
      name, kind: 'missing_app_id',
      detail: `${wrappedNoAppId} wrapped call(s) pass no expected-app-id argument (the wrapper requires one and throws without it)`,
    });
  }
  if (!code.includes(HELPER_MARKER)) {
    findings.push({
      name, kind: 'helper_missing',
      detail: 'builds a client from a request but does not inline the base44ClientRequest shared helper (its marker block is absent)',
    });
  }
  if (calls.some((c) => c.usesProdConst) && !code.includes(PROD_APP_ID_MARKER)) {
    findings.push({
      name, kind: 'prod_const_missing',
      detail: `references ${PROD_APP_ID_IDENTIFIER} but does not inline the pennsyncProductionAppId block, so the constant does not resolve`,
    });
  }
  const escape = Object.prototype.hasOwnProperty.call(escapes, name);
  if (escape && (!escapes[name] || String(escapes[name]).trim().length < 20)) {
    findings.push({ name, kind: 'escape_unexplained', detail: 'ESCAPES entry has no reason of at least 20 characters' });
  }
  return { name, calls: calls.length, raw, escape, findings };
}

export function scan(dir = FUNCTIONS_DIR) {
  const results = [];
  const findings = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'entry.ts');
    if (!existsSync(file)) continue;
    const analysis = analyzeFunction(entry.name, readFileSync(file, 'utf8'));
    if (!analysis) continue;
    results.push(analysis);
    findings.push(...analysis.findings);
  }
  return {
    functionsUsingFactory: results.length,
    functionsWrapped: results.filter((r) => r.findings.length === 0).length,
    findings,
    passed: findings.length === 0,
  };
}

function main(argv) {
  const report = scan();
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    if (argv.includes('--summary')) {
      process.stdout.write(
        `pinned SDK request: ${report.functionsUsingFactory} function(s) build a client from a request, ` +
          `${report.functionsWrapped} clean, ${report.findings.length} finding(s)\n`,
      );
    }
    for (const f of report.findings) {
      process.stdout.write(`${f.kind.toUpperCase().padEnd(18)} ${f.name}\n            ${f.detail}\n`);
    }
    if (!report.passed) {
      process.stdout.write(
        `\nEvery function that builds a client from a request must pass ${WRAPPERS.join(' or ')}(req, expectedAppId), ` +
          'not the raw req, and inline the base44ClientRequest shared helper (run: node tools-sync-shared-helpers.mjs).\n',
      );
    }
  }
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
