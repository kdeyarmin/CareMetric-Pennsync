#!/usr/bin/env node
/**
 * Every place `src/` reaches a ported capability, and whether it names a tenant.
 *
 * The ported service requires an `agency_id` its Base44 original did not: a
 * capability there is served against a current agency membership, where the
 * original accepted any authenticated caller and re-derived the tenant inside
 * the handler. `src/lib/independentStagingAdapter.js` refuses a call that does
 * not name one (`STAGING_TENANT_SELECTION_REQUIRED`) rather than choosing a
 * tenant on the caller's behalf, which is the point — but it means setting
 * `VITE_PENNSYNC_API_URL` makes every unfixed call site REFUSE rather than
 * work.
 *
 * `docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md` names four such call
 * sites. That count was measured when the adapter routed ELEVEN ported names;
 * `PORTED_FUNCTIONS` now holds seventy-four, and nobody re-measured. This is
 * the same shape as D47, D55, D74 and D75 — a number that kept its meaning
 * after the reason for it had gone — so it is measured here rather than
 * quoted, and pinned so it cannot go stale again.
 *
 * What it does NOT do is decide the fix. Whether a call site may simply gain
 * an `agency_id` depends on its Base44 original: several refuse an unknown key
 * outright (`exactObject`), so adding one would break the live path. That is a
 * per-capability review, and this tool exists to make the list of them finite
 * and ordered rather than to pre-empt it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTED_FUNCTIONS } from './services/authority-client/client.mjs';

export const CALL_SITE_CONTRACT = 'cm.pennsync.ported-call-sites.v1';
export const SOURCE_DIRECTORY = 'src';
export const EXPECTATIONS_FILE = 'tools-ported-call-sites-expectations.json';

/** The tenant key the ported service requires of every request. */
const TENANT_KEY = 'agency_id';

export class CallSiteError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}
const refuse = (code, detail) => { throw new CallSiteError(code, detail); };

/** Every source file a build actually ships, tests excluded. */
export function sourceFiles(root) {
  const base = join(root, SOURCE_DIRECTORY);
  const found = [];
  const walk = directory => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(js|jsx)$/.test(entry)) continue;
      // A spec proves behaviour rather than shipping it, and several
      // deliberately call without a tenant to assert the refusal.
      if (/\.(test|spec)\.(js|jsx)$/.test(entry)) continue;
      found.push(path);
    }
  };
  walk(base);
  return found;
}

/**
 * The text of the call that starts at `open`, by balancing parentheses.
 *
 * A regex cannot do this: a payload is an object literal that contains its own
 * brackets, commas and nested calls, and stopping at the first `)` would read
 * `invoke('x', { a: f(1) })` as ending inside `f`. Strings and both comment
 * forms are skipped so a bracket inside one cannot close the call.
 */
export function callText(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const pair = source.slice(index, index + 2);
    if (pair === '//') { index = source.indexOf('\n', index); if (index < 0) break; continue; }
    if (pair === '/*') { index = source.indexOf('*/', index) + 1; if (index < 1) break; continue; }
    if (char === '"' || char === "'" || char === '`') {
      for (index += 1; index < source.length; index += 1) {
        if (source[index] === '\\') { index += 1; continue; }
        if (source[index] === char) break;
      }
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') { depth -= 1; if (depth === 0) return source.slice(open, index + 1); }
  }
  // An unbalanced call means the scan is wrong about the file, so it claims
  // nothing rather than reporting a truncated payload as tenant-free.
  refuse('CALL_SITE_UNBALANCED', { at: open });
}

/** Where a character offset falls, as a line number. */
const lineOf = (source, offset) => source.slice(0, offset).split('\n').length;

/**
 * The direct reaches in one file: `.invoke('name', …)` and `.fetch('name', …)`
 * naming a ported capability.
 */
export function reachesIn({ path, source, names }) {
  const sites = [];
  for (const name of names) {
    // The receiver is captured because it decides whether the call can reach
    // the ported service at all. `rawBase44` is the unrouted client
    // `src/api/base44Client.js` keeps deliberately: the adapter is not in that
    // path, so such a call never becomes a ported one and its missing tenant
    // is not this gap. Counting those would have overstated the work by the
    // two that bootstrap the tenant itself.
    const pattern = new RegExp(
      `([A-Za-z_$][\\w$]*)(?:\\.functions)?\\.(invoke|fetch)\\(\\s*['"\`]${name}['"\`]`, 'g');
    for (const match of source.matchAll(pattern)) {
      const open = source.indexOf('(', match.index + match[1].length);
      const text = callText(source, open);
      sites.push({
        file: path,
        line: lineOf(source, match.index),
        capability: name,
        via: match[2],
        receiver: match[1],
        routed: match[1] !== 'rawBase44',
        // Conservative on purpose. A payload passed as a variable cannot be
        // read here, so it is `indeterminate` rather than assumed absent —
        // the rule `invokedFunctions` follows for a computed key.
        tenant: text.includes(TENANT_KEY) ? 'named'
          : /\(\s*['"`][^'"`]+['"`]\s*,\s*[[{]/.test(text) ? 'absent'
            : /\(\s*['"`][^'"`]+['"`]\s*\)/.test(text) ? 'absent' : 'indeterminate',
      });
    }
  }
  return sites;
}

/** The whole census. */
export function censusCallSites(root) {
  const names = Object.keys(PORTED_FUNCTIONS);
  if (!names.length) refuse('CALL_SITE_NO_PORTED_FUNCTIONS');
  const sites = [];
  for (const path of sourceFiles(root)) {
    const source = readFileSync(path, 'utf8');
    // Cheap rejection first: most of `src/` mentions none of these.
    if (!names.some(name => source.includes(name))) continue;
    sites.push(...reachesIn({ path: relative(root, path), source, names }));
  }
  sites.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);

  const routed = sites.filter(site => site.routed);
  const tally = key => routed.filter(site => site.tenant === key).length;
  return Object.freeze({
    contract: CALL_SITE_CONTRACT,
    ported_functions: names.length,
    capabilities_reached: [...new Set(routed.map(site => site.capability))].sort(),
    call_sites: routed.length,
    unrouted_call_sites: sites.length - routed.length,
    tenant_named: tally('named'),
    tenant_absent: tally('absent'),
    tenant_indeterminate: tally('indeterminate'),
    // The list is the deliverable: it is the work Stage D has to do, named.
    // `indeterminate` is carried here with `absent` because a call site whose
    // tenant cannot be read is not evidence that it has one.
    absent: routed.filter(site => site.tenant !== 'named')
      .map(site => `${site.file}:${site.line} ${site.capability}`),
  });
}

/** The committed expectations, or a refusal naming why they cannot be read. */
export function readExpectations(root) {
  try {
    return JSON.parse(readFileSync(join(root, EXPECTATIONS_FILE), 'utf8'));
  } catch (failure) {
    refuse('CALL_SITE_EXPECTATIONS_UNREADABLE', { message: failure?.message ?? null });
  }
}

/**
 * The gate. It ratchets DOWNWARD only: a call site that gains a tenant is
 * progress and has to be recorded, and a new one that lacks a tenant is a
 * regression, because it is a flow that will refuse the moment the service is
 * pointed at.
 */
export function checkCallSites(root) {
  const census = censusCallSites(root);
  const expected = readExpectations(root);
  const regressions = census.absent.filter(site => !expected.absent.includes(site));
  if (regressions.length) refuse('CALL_SITE_TENANT_REGRESSION', { added: regressions });
  const fixed = expected.absent.filter(site => !census.absent.includes(site));
  if (fixed.length) refuse('CALL_SITE_EXPECTATIONS_STALE', { fixed });
  return census;
}

function main(argv, root, write) {
  if (argv.includes('--write')) {
    const census = censusCallSites(root);
    const body = { contract: census.contract, absent: census.absent };
    writeFileSync(join(root, EXPECTATIONS_FILE), `${JSON.stringify(body, null, 2)}\n`);
    write(`wrote ${EXPECTATIONS_FILE}: ${census.absent.length} call sites without a tenant`);
    return 0;
  }
  const census = argv.includes('--summary') ? checkCallSites(root) : censusCallSites(root);
  if (argv.includes('--summary')) {
    write(`ported call sites within baseline: reached=${census.capabilities_reached.length}`
      + `/${census.ported_functions} sites=${census.call_sites}`
      + ` tenant_named=${census.tenant_named} without_tenant=${census.absent.length}`);
    return 0;
  }
  write(JSON.stringify(census, null, 2));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  try {
    process.exitCode = main(process.argv.slice(2), root, message => console.log(message));
  } catch (failure) {
    console.error(JSON.stringify({ error: failure?.code ?? 'CALL_SITE_FAILED', detail: failure?.detail ?? null }, null, 2));
    process.exitCode = 1;
  }
}
