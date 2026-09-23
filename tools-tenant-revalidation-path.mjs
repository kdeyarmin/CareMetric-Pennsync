#!/usr/bin/env node
/**
 * The two seams of `getMyTenantContext`, and the invariant that keeps them apart.
 *
 * `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` (stage D) records why pointing
 * `VITE_PENNSYNC_API_URL` at the service is harmless for this capability even
 * though `routesPorted` is tested FIRST in the adapter's dispatcher, ahead of
 * every special case. The reason is structural rather than dispatch order: the
 * capability has TWO seams.
 *
 * - `bootstrapMyTenantContext` — the pre-tenant one, used by `AuthContext`
 *   before a tenant realm can be opened. It goes through
 *   `tenantAuthorityClient` to the adapter's own `authority` object, which
 *   never reaches `invoke` and so never reaches `routesPorted` at all.
 * - `getMyTenantContext` — the revalidation path behind the SDK membrane. It
 *   IS routed, and every one of its call sites passes
 *   `trustedTenantRequest(...).options`, which sets `agencyId` unconditionally
 *   and returns null rather than omitting it. So every routed call carries a
 *   tenant, `portedCall` lifts it into the envelope, and the contract serves
 *   it.
 *
 * That is a property of the current call sites, not of the code that serves
 * them, which is what this gate is for. The plan called it a fragility and
 * predicted the failure would be loud: a bare `getMyTenantContext()` "would
 * refuse on the routed path while the bootstrap kept working". **That
 * prediction is now wrong, and in the worse direction.** `portedCall` supplies
 * the tenant from the bound trusted principal when a call site names none, so
 * a bare revalidation call does not refuse — measured against the staging
 * fixture it reaches the service as
 * `{ agency_id: 'agency-a', params: {} }` and resolves. What it drops is
 * `expectedMembershipId` and `expectedMembershipVersion`, the two values
 * `resolveMyTenantContext` compares the answer against. A revalidation call
 * that carries no expectation revalidates nothing: it asks what the bound
 * tenant is and is told, which is the question it already knew the answer to.
 *
 * So the failure mode inverted from a refusal to a silent no-op, and a silent
 * one cannot be found by running the app. It is an invariant rather than a
 * count, so there is no expectations file and nothing to ratchet: every
 * revalidation call site passes options derived from `trustedTenantRequest`,
 * and the bootstrap seam keeps its single importer. Both are offline,
 * deterministic and read only committed source.
 *
 * This authorizes nothing and changes no deployment. It refuses a shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The cousin gate already solved reading a call out of JavaScript with a
// scanner: `callText` balances parentheses so a nested call cannot end the
// payload early, and `codeOnly` blanks strings and comments so a name inside
// one cannot be read as code. Sharing them keeps the two gates agreeing about
// what a call site IS, which is the thing a second copy would drift on.
import { callText, codeOnly, sourceFiles } from './tools-ported-call-sites.mjs';

export const REVALIDATION_CONTRACT = 'cm.pennsync.tenant-revalidation-path.v1';

/** The routed seam: behind the SDK membrane, and the one that must carry a request. */
export const REVALIDATION_SEAM = 'getMyTenantContext';
/** The pre-tenant seam: never reaches `invoke`, so it is fenced by its importer instead. */
export const BOOTSTRAP_SEAM = 'bootstrapMyTenantContext';
/** Where both are defined. Its own body calls each transport and is not a call site. */
export const SEAM_MODULE = 'src/functions/getMyTenantContext.js';
/** The only module that may open the pre-tenant seam. */
export const BOOTSTRAP_IMPORTER = 'src/lib/AuthContext.jsx';
/** The helper a revalidation request has to come from. */
export const REQUEST_HELPER = 'trustedTenantRequest';
/** The member it is read through. */
export const REQUEST_MEMBER = 'options';

export class RevalidationError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}
const refuse = (code, detail) => { throw new RevalidationError(code, detail); };

/** Where a character offset falls, as a line number. */
const lineOf = (source, offset) => source.slice(0, offset).split('\n').length;

/**
 * The initializer of `const`/`let <identifier>` nearest ABOVE `before`.
 *
 * A `const` cannot be read before its declaration, so the nearest preceding
 * one is the binding a call site actually holds. The initializer is taken by
 * balancing brackets to its terminating `;` rather than to the end of the
 * line, because the shape in every hook today is a multi-line
 * `useMemo(() => trustedTenantRequest(...), [...])` — reading one line of that
 * would miss the helper entirely and call a correct call site unverified.
 */
export function initializerAbove(code, identifier, before) {
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${identifier}\\s*=`, 'g');
  let start = -1;
  for (const match of code.matchAll(pattern)) {
    if (match.index >= before) break;
    start = match.index + match[0].length;
  }
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ';' && depth === 0) return code.slice(start, index);
    // A declaration that never closes means the scan is wrong about the file,
    // so it claims nothing rather than reporting a truncated initializer.
    if (depth < 0) return code.slice(start, index);
  }
  return null;
}

/**
 * Every revalidation call in one file, classified by what it passes.
 *
 * `trusted` is the only shape the gate accepts: `<identifier>.options` where
 * that identifier is bound from `trustedTenantRequest(...)` in the same file.
 * `bare` passes nothing and is the silent no-op above. Everything else is
 * `unverified` — a hand-built object literal may happen to be correct today,
 * but it is not the helper's frozen output and nothing keeps it carrying the
 * membership expectations.
 */
export function revalidationCallsIn({ path, source }) {
  const code = codeOnly(source);
  const calls = [];
  const pattern = new RegExp(`(\\.\\s*)?\\b${REVALIDATION_SEAM}\\s*\\(`, 'g');
  for (const match of code.matchAll(pattern)) {
    // A definition, and a member call on a transport client, are not call
    // sites of the exported seam. Both live in the seam module, which is
    // excluded whole by `censusRevalidation`, but the receiver test is kept
    // here so this function is correct read on its own.
    if (match[1]) continue;
    const before = code.slice(Math.max(0, match.index - 20), match.index);
    if (/\b(?:function|async function)\s*$/.test(before)) continue;
    const open = match.index + match[0].length - 1;
    const text = callText(code, open);
    const argument = text.slice(1, -1).trim();
    const member = new RegExp(`^([A-Za-z_$][\\w$]*)\\s*\\.\\s*${REQUEST_MEMBER}$`).exec(argument);
    const initializer = member ? initializerAbove(code, member[1], match.index) : null;
    calls.push({
      file: path,
      line: lineOf(code, match.index),
      argument,
      shape: argument === '' ? 'bare'
        : member && initializer && new RegExp(`\\b${REQUEST_HELPER}\\s*\\(`).test(initializer)
          ? 'trusted' : 'unverified',
    });
  }
  return calls;
}

/** Every shipped module that imports the pre-tenant seam. */
export function bootstrapImportersIn({ path, source }) {
  const code = codeOnly(source);
  return new RegExp(`\\b${BOOTSTRAP_SEAM}\\b`).test(code) ? [path] : [];
}

/** The whole census: both seams, across everything a build ships. */
export function censusRevalidation(root) {
  const calls = [];
  const importers = [];
  let seamModuleSeen = false;
  for (const path of sourceFiles(root)) {
    const relativePath = relative(root, path).split('\\').join('/');
    if (relativePath === SEAM_MODULE) { seamModuleSeen = true; continue; }
    const source = readFileSync(path, 'utf8');
    if (!source.includes(REVALIDATION_SEAM) && !source.includes(BOOTSTRAP_SEAM)) continue;
    calls.push(...revalidationCallsIn({ path: relativePath, source }));
    importers.push(...bootstrapImportersIn({ path: relativePath, source }));
  }
  // The module both seams are defined in has to exist, or this gate is
  // measuring a capability that has moved and would pass by finding nothing.
  if (!seamModuleSeen) refuse('REVALIDATION_SEAM_MODULE_MISSING', { expected: SEAM_MODULE });
  calls.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  const tally = shape => calls.filter(call => call.shape === shape).length;
  return Object.freeze({
    contract: REVALIDATION_CONTRACT,
    seam_module: SEAM_MODULE,
    revalidation_call_sites: calls.length,
    trusted: tally('trusted'),
    bare: tally('bare'),
    unverified: tally('unverified'),
    untrusted: calls.filter(call => call.shape !== 'trusted')
      .map(call => `${call.file}:${call.line} ${call.argument || '(no argument)'}`),
    bootstrap_importers: [...new Set(importers)].sort(),
  });
}

/**
 * The gate. Both halves are invariants, so neither has a baseline to drift:
 * a revalidation call that does not carry a trusted request is a regression
 * whether it is the first or the seventh, and a second importer of the
 * pre-tenant seam is the mirror-image defect — a caller reaching authority
 * from outside the realm that fences it.
 */
export function checkRevalidation(root) {
  const census = censusRevalidation(root);
  if (!census.revalidation_call_sites) {
    refuse('REVALIDATION_NO_CALL_SITES', { seam: REVALIDATION_SEAM });
  }
  if (census.untrusted.length) {
    refuse('REVALIDATION_REQUEST_MISSING', { sites: census.untrusted });
  }
  const foreign = census.bootstrap_importers.filter(path => path !== BOOTSTRAP_IMPORTER);
  if (foreign.length) refuse('REVALIDATION_BOOTSTRAP_ESCAPED', { importers: foreign });
  if (!census.bootstrap_importers.includes(BOOTSTRAP_IMPORTER)) {
    refuse('REVALIDATION_BOOTSTRAP_UNUSED', { expected: BOOTSTRAP_IMPORTER });
  }
  return census;
}

function main(argv, root, write) {
  const census = argv.includes('--summary') ? checkRevalidation(root) : censusRevalidation(root);
  if (argv.includes('--summary')) {
    write(`tenant revalidation path intact: calls=${census.revalidation_call_sites}`
      + ` trusted=${census.trusted} bare=${census.bare} unverified=${census.unverified}`
      + ` bootstrap_importers=${census.bootstrap_importers.length}`);
    return 0;
  }
  write(JSON.stringify(census, null, 2));
  return 0;
}

// Direct-invocation check through pathToFileURL: a hand-built `file://`
// string never matches a Windows backslash path or a percent-encoded one,
// and the CLI then exits 0 having silently done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  try {
    process.exitCode = main(process.argv.slice(2), root, message => console.log(message));
  } catch (failure) {
    console.error(JSON.stringify({
      error: failure?.code ?? 'REVALIDATION_FAILED', detail: failure?.detail ?? null,
    }, null, 2));
    process.exitCode = 1;
  }
}
