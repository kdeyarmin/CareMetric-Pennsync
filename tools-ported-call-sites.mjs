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
 * `PORTED_FUNCTIONS` held seventy-four when this was written, and nobody had
 * re-measured. This is
 * the same shape as D47, D55, D74 and D75 — a number that kept its meaning
 * after the reason for it had gone — so it is measured here rather than
 * quoted, and pinned so it cannot go stale again.
 *
 * **The fix is no longer per call site, and this measures something else now.**
 * Editing all 67 was the recorded plan and it is unsafe rather than merely
 * large: `src/functions/*` wrappers serve BOTH backends, so every added
 * `agency_id` also reaches the live Base44 original, and roughly a third of
 * those reject an unknown key. Which third cannot be established by scanning —
 * a first attempt here classified `createAuthorizedPatient` as tolerant when it
 * rejects at `entry.ts:149` through a `for (const key of Object.keys(body))`
 * loop the scan did not know, and widening it found further shapes. "No
 * rejection shape found" is not proof of tolerance, which is D47's and D75's
 * lesson in a third place.
 *
 * So `portedCall` in `src/lib/independentStagingAdapter.js` supplies the tenant
 * from the bound trusted principal, where it reaches only the ported service
 * and can never enter a Base44 payload. What this number measures is therefore
 * how many call sites RELY on that fallback rather than naming their tenant.
 * Naming it is still better — it is explicit, and it is the only way a caller
 * holding two memberships can mean the other one — so the ratchet stays and
 * still only moves downward. It is no longer a release blocker.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/**
 * The call text with every string literal and comment blanked out.
 *
 * `text.includes('agency_id')` read the raw text, so `{ note: 'agency_id' }`
 * or a commented-out property counted as naming a tenant — and a ratchet that
 * over-counts `named` silently drops a call site that will refuse at runtime.
 * `callText` already skips strings and comments to balance parentheses; the
 * same discipline has to apply to what is searched, not only to where the call
 * ends. Blanking preserves offsets, so nothing else shifts.
 *
 * It preserves NEWLINES too, and that is load-bearing rather than tidy. A
 * block comment and a multi-line template both span lines, so blanking their
 * newlines would join the line before to the line after: a line-anchored scan
 * would stop seeing a real declaration that followed one, and `lineOf` — which
 * two callers here run over the MASKED text — would report a line number too
 * small by however many lines the comment took. Both failures are silent.
 */
export function codeOnly(text) {
  const out = [...text];
  /** Mask a span to spaces, leaving its newlines where they are. */
  const blank = (from, to) => {
    for (let at = from; at < to; at += 1) if (out[at] !== '\n') out[at] = ' ';
  };
  for (let index = 0; index < text.length; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === '//') {
      const stop = text.indexOf('\n', index);
      const end = stop < 0 ? text.length : stop;
      blank(index, end);
      index = end; continue;
    }
    if (pair === '/*') {
      const stop = text.indexOf('*/', index);
      const end = stop < 0 ? text.length : stop + 2;
      blank(index, end);
      index = end - 1; continue;
    }
    if (text[index] === '/' && isRegexStart(out, index)) {
      let at = index + 1;
      let inClass = false;
      for (; at < text.length; at += 1) {
        const character = text[at];
        // An unterminated literal means this `/` was not a regex after all.
        // Stopping at the newline leaves the rest of the line unmasked, which
        // is the direction that loses nothing.
        if (character === '\n') break;
        if (character === '\\') { blank(at, at + 2); at += 1; continue; }
        if (character === '[') inClass = true;
        else if (character === ']') inClass = false;
        else if (character === '/' && !inClass) break;
        blank(at, at + 1);
      }
      index = at; continue;
    }
    const quote = text[index];
    if (quote === '"' || quote === "'" || quote === '`') {
      let at = index + 1;
      for (; at < text.length; at += 1) {
        if (text[at] === '\\') { blank(at, at + 2); at += 1; continue; }
        if (text[at] === quote) break;
        blank(at, at + 1);
      }
      index = at; continue;
    }
  }
  return out.join('');
}

/**
 * Whether the `/` at `index` opens a regular expression rather than dividing.
 *
 * Only the preceding significant character can tell them apart, and getting it
 * wrong is not cosmetic. `videoNarration.js:35` contains `.replace(/[*_#`~]/g,
 * '')` — a BACKTICK inside a character class. Read as division, that backtick
 * opens a template literal and everything to the next backtick twelve lines
 * down is blanked, taking a real `export const` at line 62 with it. A masker
 * that silently eats real declarations is worse than one that misses a
 * commented example, because nothing downstream can tell a lost name from an
 * absent one.
 *
 * `out` is the partly masked copy, so comments before this point are already
 * spaces and the scan back skips them for free.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await',
]);

function isRegexStart(out, index) {
  let back = index - 1;
  while (back >= 0 && /\s/.test(out[back])) back -= 1;
  if (back < 0) return true;
  const previous = out[back];
  if (!/[\w$)\]'"`]/.test(previous)) return true;
  // A word before it is division after a value and a regex after a keyword.
  if (!/[\w$]/.test(previous)) return false;
  let start = back;
  while (start >= 0 && /[\w$]/.test(out[start])) start -= 1;
  return REGEX_PRECEDING_KEYWORDS.has(out.slice(start + 1, back + 1).join(''));
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
        // Searched in code only: a tenant named inside a string or a
        // comment is not a tenant the request carries.
        tenant: new RegExp(`\\b${TENANT_KEY}\\b`).test(codeOnly(text)) ? 'named'
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
 * The gate. A call site that gains a tenant is progress and has to be
 * recorded; one that newly relies on the adapter's fallback is refused until a
 * reviewed diff admits it.
 *
 * It no longer refuses because such a site WILL refuse — `portedCall`
 * supplies the bound tenant now, so it works. It refuses because the fallback
 * is only right where the tenant decides nothing the caller could have meant
 * differently, and that is a property of the capability that someone has to
 * read. A port with existing callers is the one way the set legitimately
 * grows: the first after the fallback existed was `generatePatientHandout`
 * (D81), whose document reads nothing tenant-scoped, so which of a caller's
 * memberships authorizes it changes nothing on the page.
 *
 * `setNurseDutyStatus` (`src/components/voice/DutyStatusCard.jsx`) is admitted
 * on the sharpest reading yet, and it is one about the ORIGINAL rather than
 * about the port: `hasExactActiveAgencyMembership` requires EXACTLY ONE active
 * membership and refuses otherwise, so a caller who could have meant a
 * different tenant cannot reach the capability at all today. The bound tenant
 * therefore decides nothing for any caller the incumbent serves. What it does
 * decide, for a caller the port newly admits, is which agency's activity trail
 * the entry lands in -- and they hold both, and the row being written is their
 * own profile, which carries no agency.
 *
 * `extractPatientDataFromDocument` (`src/components/patient/OCRDocumentExtractor.jsx`,
 * through `src/lib/documentExtraction.js`) is the
 * second, admitted on the same reading and for a sharper reason: the capability
 * reads NO row at all. It takes a document's bytes, brokers an upload and asks
 * a model what is in it, so no tenant is consulted anywhere in the answer and a
 * caller holding two memberships cannot have meant the other one. Note also
 * what it is not: the site was already in `src/` before this port, calling the
 * Base44 original from the screen; adopting it moved the call into a shared
 * module and did NOT add a request to the frontend, which is why
 * `check:base44-surface`'s invocation count is unchanged. One invocation with
 * the branch deciding only what it carries — two would have read as growth
 * there while the surface stood still.
 */
/**
 * **A site is pinned by FILE AND LINE, so a moved site and a new one are the
 * same refusal.** Read this before treating a `CALL_SITE_TENANT_REGRESSION` as
 * a finding.
 *
 * The identity in these lists is `path:line name`, which makes the diff
 * readable and makes every entry a hostage to the lines above it. Growing a
 * comment, adding an import or reformatting anything earlier in a pinned file
 * re-reports its sites at new lines, and this refuses with the same code, the
 * same shape and the same `added` array a genuinely new untenanted call site
 * would produce. Measured 2026-09-29: a header comment in
 * `src/lib/retiredOfflineQueue.js` moved its two sites from 407 and 494 to 443
 * and 530 and failed `test:utils` exactly as an unported caller would.
 *
 * **What distinguishes the two cases, since the code cannot.** A move takes a
 * site OUT of the expectations at the same moment it adds one, so the pair
 * appears in `added` here and in `fixed` on the staleness check below, with the
 * same file and the same capability name and only the line differing. A real
 * arrival adds without removing. The two refusals fire in sequence rather than
 * together — this one throws first — so the second half is not in the message,
 * and comparing `added` against `expected.absent` by file and name is what tells
 * them apart. Re-pinning with `--write` is correct for a move and hides a real
 * regression, so make that comparison before running it.
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

// Direct-invocation check through pathToFileURL: a hand-built `file://`
// string never matches a Windows backslash path or a percent-encoded one,
// and the CLI then exits 0 having silently done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  try {
    process.exitCode = main(process.argv.slice(2), root, message => console.log(message));
  } catch (failure) {
    console.error(JSON.stringify({ error: failure?.code ?? 'CALL_SITE_FAILED', detail: failure?.detail ?? null }, null, 2));
    process.exitCode = 1;
  }
}
