/**
 * Shared staff roster for agency scoping.
 *
 * `filterPatientsByCallerAgency` needs the FULL user list to tell a chart
 * authored by another tenant apart from one whose author is simply unknown.
 * Every scoped query used to fetch that roster itself, inside its own queryFn —
 * where React Query cannot cache it — costing one extra User.list round-trip per
 * scoped view. This memoizes it for the app-wide staleTime instead, so the whole
 * app pays for the roster once.
 *
 * Kept out of agencyScope.js on purpose: that module stays pure so its rules can
 * be unit-tested without stubbing the API client.
 */
import { base44 } from '@/api/base44Client';
import { filterPatientsByCallerAgency, describePatientAgencyScope } from '@/lib/agencyScope';
import { getTenantAuthorityKey } from '@/lib/roles';

const ROSTER_TTL_MS = 60000; // matches the app-wide React Query staleTime
const ROSTER_PAGE_SIZE = 2000;
// Safety valve so a pathological backend response can't loop forever; at 2,000
// rows per page this still covers a 100,000-account platform.
const ROSTER_MAX_PAGES = 50;

let cachedRoster = [];
let cachedAt = 0;
let inFlight = null;

let cachedCaller = null;
let callerAt = 0;
let callerInFlight = null;
// Every authority transition advances this epoch. Promises that began under an
// older principal/tenant may still resolve because the SDK calls are not
// abortable; they must never repopulate either module cache (or clear a newer
// in-flight request from their finally handler).
let cacheEpoch = 0;

/**
 * Fetch the COMPLETE platform roster, paging past the per-request limit.
 * `filterPatientsByCallerAgency` / `filterRecordsByAuthorAgency` treat an
 * author who is missing from the roster as "unattributable" and deliberately
 * retain the record, so a truncated roster (only the newest N accounts) would
 * misclassify records authored by older foreign-agency users and leak them
 * across tenants. Paginate until a short page proves we have every account.
 */
async function fetchFullRoster(expectedEpoch) {
  const all = [];
  for (let page = 0; page < ROSTER_MAX_PAGES; page += 1) {
    if (expectedEpoch !== cacheEpoch) return [];
    const rows = await base44.entities.User.list('-created_date', ROSTER_PAGE_SIZE, page * ROSTER_PAGE_SIZE);
    if (expectedEpoch !== cacheEpoch) return [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < ROSTER_PAGE_SIZE) break;
  }
  return all;
}

/**
 * Resolve the staff roster, reusing a recent fetch when one is available.
 * Never rejects: a roster we could not load resolves to the last known value so
 * a transient User.list failure cannot be mistaken for "this agency has no
 * staff". The failure is not cached, so the next caller retries.
 */
export function loadAgencyRoster() {
  if (cachedAt && Date.now() - cachedAt < ROSTER_TTL_MS) {
    return Promise.resolve(cachedRoster);
  }
  if (inFlight) return inFlight;
  const requestEpoch = cacheEpoch;
  let request;
  request = fetchFullRoster(requestEpoch)
    .then((rows) => {
      if (requestEpoch !== cacheEpoch) return [];
      cachedRoster = Array.isArray(rows) ? rows : [];
      cachedAt = Date.now();
      return cachedRoster;
    })
    .catch(() => (requestEpoch === cacheEpoch ? cachedRoster : []))
    .finally(() => {
      if (requestEpoch === cacheEpoch && inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/**
 * Resolve the signed-in user for code paths that have no React component to
 * read `useQuery(['currentUser'])` from — imperative loaders inside event
 * handlers, mostly. Memoized on the same window as the roster.
 * Resolves to null when auth is unavailable, which fails closed. AuthContext
 * must reset this cache synchronously before every logout, account change, or
 * tenant-authority transition so a prior principal is never reused.
 */
export function loadCurrentCaller() {
  if (callerAt && Date.now() - callerAt < ROSTER_TTL_MS) {
    return Promise.resolve(cachedCaller);
  }
  if (callerInFlight) return callerInFlight;
  const requestEpoch = cacheEpoch;
  let request;
  request = base44.auth.me()
    .then((user) => {
      if (requestEpoch !== cacheEpoch) return null;
      cachedCaller = user || null;
      callerAt = Date.now();
      return cachedCaller;
    })
    .catch(() => (requestEpoch === cacheEpoch ? cachedCaller : null))
    .finally(() => {
      if (requestEpoch === cacheEpoch && callerInFlight === request) callerInFlight = null;
    });
  callerInFlight = request;
  return request;
}

/** Drop the memoized roster and caller (authority transition, sign-out, tests). */
export function resetAgencyRosterCache() {
  cacheEpoch += 1;
  cachedRoster = [];
  cachedAt = 0;
  inFlight = null;
  cachedCaller = null;
  callerAt = 0;
  callerInFlight = null;
}

/**
 * Scope a freshly-listed set of charts to the caller's agency.
 * Use this in any queryFn that lists patients across charts; pair it with
 * `agencyQueryKey(currentUser)` in the query key and enable the query only when
 * that authority key is non-null. A present User without a trusted context is
 * not sufficient authority and fails closed to [].
 */
export async function scopePatientsToCallerAgency(patients, caller) {
  const roster = await loadAgencyRoster();
  return filterPatientsByCallerAgency(patients, roster, caller);
}

/**
 * scopePatientsToCallerAgency for imperative loaders that have no `currentUser`
 * in hand. Kept as a separate export rather than a default argument so that
 * passing an unresolved caller still fails closed instead of quietly
 * self-resolving.
 */
export async function scopePatientsForCurrentCaller(patients) {
  return scopePatientsToCallerAgency(patients, await loadCurrentCaller());
}

/** Counts behind the last scoping decision, for surfacing the scope in the UI. */
export async function describeCallerPatientScope(patients, caller) {
  const roster = await loadAgencyRoster();
  return describePatientAgencyScope(patients, roster, caller);
}

/**
 * Cache-key fragment identifying the exact trusted tenant authority used by a
 * scoped query. It deliberately ignores mutable User role/agency fields. The
 * key changes with principal, membership, membership version, tenant role,
 * agency, or owner mode so React Query cannot reuse protected data across an
 * account switch, tenant switch, revocation/version update, or role change.
 * Missing or mismatched trusted context returns null and must keep the query
 * disabled/fail closed.
 */
export function agencyQueryKey(caller) {
  return getTenantAuthorityKey(caller);
}
