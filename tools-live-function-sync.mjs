// Exact, read-only comparison of this repository's backend function sources
// with what a Base44 deployment is actually RUNNING.
// Usage: node tools-live-function-sync.mjs [--origin https://host] [--app <id>]
//                                         [--only name,name] [--json]
// Exit 0 = every comparable function's deployment answers as this tree says it
// must, 1 = observed drift, 2 = unavailable/invalid verification.
//
// Why this exists. `check:live-frontend` compares a local build with the
// published static site; nothing compared the FUNCTIONS. A Base44 deployment
// keeps a per-function artifact that can lag the app's stored source - the
// platform's own redeploy route exists to "recover a function whose deployment
// is missing or out of date" - so a merged, reviewed, green change can sit in
// the tree, and in the app's stored source, while the deployment serves the
// code it replaced. Every suite here builds from the tree, which is the one
// case that cannot see it.
//
// What it does NOT prove: nothing about authenticated behaviour, tenant
// isolation, data migration, or whether a release variable is set. It compares
// ONE observable - the answer a deployed function gives a caller with no
// session - against the answer this tree's source gives the same caller.
//
// The probe is a GET with no body, and only ever at a function whose source
// refuses an anonymous caller before touching the SDK, so neither branch can
// read, write, or send anything.
import { auditAnonymousFunctions } from './tools-anonymous-function-audit.mjs';
import { PRODUCTION_ORIGINS, VerificationError, validateOrigin } from './tools-live-frontend-sync.mjs';
import { KNOWN_APPS, RETIRED_APP } from './tools-pennsync-provision.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';

export const PUBLISHED_ORIGIN = 'https://caremetricai.base44.app';
export const PRODUCTION_APP = '694ec16e72e01b60d22f7cbf';
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

// A comparison is only sound where the harness's answer is a property of the
// SOURCE. Each of these names a way it is a property of the harness instead,
// and every one was derived from a real false positive rather than imagined.
export const EXCLUSION_REASONS = Object.freeze({
  NOT_EXECUTED: 'source did not execute to a response in the harness',
  ENVIRONMENT_DEPENDENT: 'refusal reads the environment, so a release variable can open it in a deployment',
  HARNESS_BLOCKED: 'refusal followed an intercepted SDK call, so the inert harness produced it',
  HARNESS_AUTH_STUB: 'refusal consulted the harness auth stub, which resolves to null where the platform rejects',
  METHOD_DEPENDENT: 'refusal depends on the request method, so a bodyless GET cannot reproduce it',
  NOT_A_REFUSAL: 'source does not refuse an anonymous caller, so there is nothing safe to probe',
});

/**
 * Whether one function's anonymous answer may be compared with a deployment's.
 *
 * The order is the reason, not a style: an environment read makes the answer
 * incomparable however the other checks come out, so it is asked first. A
 * refusal the harness FORCED by blocking an SDK call is next, because such a
 * function reaches its real gate in a deployment and would otherwise be
 * reported as drift - `handleTelnyxStatusWebhook` is the live example, where
 * the trapped credential lookup answers 503 here and the signature check
 * answers 401 there, with identical code on both sides.
 *
 * The auth stub is the same shape and was found the same way, by running this
 * against the real deployment rather than by reading: the harness's `auth.me()`
 * RESOLVES to null, so a handler refuses with its own 401, while the platform's
 * REJECTS for a caller with no session and an uncaught rejection is a 500. That
 * is 118 functions answering differently with identical code on both sides, and
 * reading the sources would not have shown it.
 */
export function classifyComparability(post, get) {
  if (!post || !get || post.status === null || post.status === undefined
    || get.status === null || get.status === undefined) {
    return { comparable: false, reason: 'NOT_EXECUTED' };
  }
  if (post.environmentKeys?.length) return { comparable: false, reason: 'ENVIRONMENT_DEPENDENT' };
  if (post.operations?.length || get.operations?.length) return { comparable: false, reason: 'HARNESS_BLOCKED' };
  if (post.authChecks || get.authChecks) return { comparable: false, reason: 'HARNESS_AUTH_STUB' };
  if (post.status !== get.status) return { comparable: false, reason: 'METHOD_DEPENDENT' };
  if (!(post.status >= 400)) return { comparable: false, reason: 'NOT_A_REFUSAL' };
  return { comparable: true, reason: null };
}

/** Split one POST sweep and one GET sweep into what may be probed and what may not. */
export function planComparison(postResults, getResults) {
  const byName = new Map((getResults ?? []).map(row => [row.name, row]));
  const comparable = [];
  const excluded = [];
  for (const post of postResults ?? []) {
    const get = byName.get(post.name);
    const { comparable: ok, reason } = classifyComparability(post, get);
    if (ok) comparable.push({ name: post.name, status: post.status, code: post.responseCode ?? null });
    else excluded.push({ name: post.name, reason, detail: EXCLUSION_REASONS[reason] });
  }
  comparable.sort((a, b) => a.name.localeCompare(b.name));
  excluded.sort((a, b) => a.name.localeCompare(b.name));
  return { comparable, excluded };
}

/** The app a deployment may be checked against, or a refusal naming why not. */
export function validateApp(value) {
  if (value === RETIRED_APP) throw new VerificationError('APP_RETIRED');
  if (!Object.hasOwn(KNOWN_APPS, value)) throw new VerificationError('APP_UNKNOWN');
  return value;
}

export function functionUrl(origin, app, name) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new VerificationError('FUNCTION_NAME_INVALID');
  return `${origin}/api/apps/${app}/functions/${name}`;
}

/**
 * One function's verdict. A status mismatch is drift; so is a code mismatch at
 * a matching status, because the code is what names WHICH gate answered. A
 * deployment that has never had the function at all is reported apart from
 * drift: the remedy differs.
 */
export function compareObserved(expected, observed) {
  const base = { name: expected.name, expected: { status: expected.status, code: expected.code ?? null } };
  if (observed?.error) return { ...base, observed: null, verdict: 'unreachable', detail: observed.error };
  const got = { status: observed.status, code: observed.code ?? null };
  if (observed.status === 404) return { ...base, observed: got, verdict: 'not_deployed' };
  if (observed.status !== expected.status) return { ...base, observed: got, verdict: 'drifted' };
  if (expected.code !== null && expected.code !== undefined && observed.code !== expected.code) {
    return { ...base, observed: got, verdict: 'drifted' };
  }
  return { ...base, observed: got, verdict: 'matched' };
}

async function probe(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'manual', signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const text = (await response.text().catch(() => '')).slice(0, MAX_BODY_BYTES);
    let code = null;
    try {
      const data = JSON.parse(text);
      code = typeof data?.code === 'string' ? data.code.slice(0, 120) : null;
    } catch { code = null; }
    return { status: response.status, code };
  } catch (error) {
    // Never surface the thrown value: it can carry the request URL and, with a
    // proxy in front, configuration. The code is enough to act on.
    return { error: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED' };
  } finally { clearTimeout(timer); }
}

export async function verifyFunctions(origin, app, comparable, { fetchImpl = fetch, concurrency = 4 } = {}) {
  const queue = [...comparable];
  const results = [];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      results.push(compareObserved(next, await probe(functionUrl(origin, app, next.name), fetchImpl)));
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => a.name.localeCompare(b.name));
  const byVerdict = Object.fromEntries(['matched', 'drifted', 'not_deployed', 'unreachable']
    .map(key => [key, results.filter(row => row.verdict === key).length]));
  return { origin, app, label: KNOWN_APPS[app], checked: results.length, byVerdict, results };
}

export function parseArguments(args) {
  const options = { origin: PUBLISHED_ORIGIN, app: PRODUCTION_APP, only: null, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--origin') options.origin = args[++index];
    else if (argument === '--app') options.app = args[++index];
    else if (argument === '--only') options.only = String(args[++index] ?? '').split(',').filter(Boolean);
    else throw new VerificationError('INVALID_ARGUMENTS');
  }
  if (typeof options.origin !== 'string' || typeof options.app !== 'string') {
    throw new VerificationError('INVALID_ARGUMENTS');
  }
  return options;
}

export async function main(args = process.argv.slice(2), {
  fetchImpl = fetch, log = console.log, root = process.cwd(), audit = auditAnonymousFunctions,
} = {}) {
  let options;
  let origin;
  let app;
  try {
    options = parseArguments(args);
    origin = validateOrigin(options.origin);
    app = validateApp(options.app);
  } catch (error) {
    log(JSON.stringify({ passed: false, errors: [{ code: error?.code ?? 'INVALID_ARGUMENTS' }] }));
    return 2;
  }
  const post = await audit(root, {}, { method: 'POST' });
  const get = await audit(root, {}, { method: 'GET' });
  if (post.discoveryErrors?.length || get.discoveryErrors?.length || !post.results?.length) {
    log(JSON.stringify({ passed: false, errors: [{ code: 'SOURCE_SWEEP_INCOMPLETE' }] }));
    return 2;
  }
  let { comparable, excluded } = planComparison(post.results, get.results);
  if (options.only) {
    const wanted = new Set(options.only);
    const unknown = options.only.filter(name => !post.results.some(row => row.name === name));
    if (unknown.length) {
      log(JSON.stringify({ passed: false, errors: [{ code: 'UNKNOWN_FUNCTION', names: unknown }] }));
      return 2;
    }
    const skipped = options.only.filter(name => excluded.some(row => row.name === name));
    if (skipped.length) {
      log(JSON.stringify({ passed: false, errors: [{ code: 'FUNCTION_NOT_COMPARABLE', names: skipped }] }));
      return 2;
    }
    comparable = comparable.filter(row => wanted.has(row.name));
    excluded = excluded.filter(row => wanted.has(row.name));
  }
  const report = await verifyFunctions(origin, app, comparable, { fetchImpl });
  // Drift and unverifiability are different answers and get different exits.
  // A sweep that could not ask is not a sweep that found nothing, and reporting
  // one as the other is how this class of defect stayed invisible: 2 means the
  // question was not answered, so a caller can tell it from a clean 0. Drift
  // still wins over an unreachable sibling, because the drift is real either way.
  const drifted = report.byVerdict.drifted > 0 || report.byVerdict.not_deployed > 0;
  const unverifiable = report.checked === 0 || report.byVerdict.unreachable > 0;
  const exit = drifted ? 1 : unverifiable ? 2 : 0;
  const passed = exit === 0;
  const summary = {
    passed,
    ...(exit === 2 ? { errors: [{ code: report.checked === 0 ? 'NOTHING_COMPARABLE' : 'DEPLOYMENT_UNREACHABLE' }] } : {}),
    scope: 'anonymous GET at each deployed function whose source refuses before any SDK, environment or method read',
    measurementBoundary: 'One observable per function. Proves nothing about authenticated behaviour, tenancy, data, or release variables.',
    ...report,
    excludedCount: excluded.length,
    excludedByReason: Object.fromEntries(Object.keys(EXCLUSION_REASONS)
      .map(key => [key, excluded.filter(row => row.reason === key).length])
      .filter(([, count]) => count > 0)),
  };
  if (options.json) log(JSON.stringify(summary, null, 2));
  else {
    log(`${exit === 0 ? 'OK' : exit === 1 ? 'DRIFT' : 'UNVERIFIED'} ${report.label} ${report.origin} — checked ${report.checked}, `
      + `${report.byVerdict.matched} matched, ${report.byVerdict.drifted} drifted, `
      + `${report.byVerdict.not_deployed} not deployed, ${report.byVerdict.unreachable} unreachable `
      + `(${excluded.length} not comparable)`);
    for (const row of report.results.filter(item => item.verdict !== 'matched')) {
      log(`  ${row.verdict.padEnd(13)} ${row.name}  expected ${row.expected.status}`
        + `${row.expected.code ? ` ${row.expected.code}` : ''}`
        + `  observed ${row.observed ? `${row.observed.status}${row.observed.code ? ` ${row.observed.code}` : ''}` : row.detail}`);
    }
  }
  return exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
