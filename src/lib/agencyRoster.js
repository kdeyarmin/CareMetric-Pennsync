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

/**
 * Fetch the COMPLETE platform roster, paging past the per-request limit.
 * `filterPatientsByCallerAgency` / `filterRecordsByAuthorAgency` treat an
 * author who is missing from the roster as "unattributable" and deliberately
 * retain the record, so a truncated roster (only the newest N accounts) would
 * misclassify records authored by older foreign-agency users and leak them
 * across tenants. Paginate until a short page proves we have every account.
 */
async function fetchFullRoster() {
  const all = [];
  for (let page = 0; page < ROSTER_MAX_PAGES; page += 1) {
    const rows = await base44.entities.User.list('-created_date', ROSTER_PAGE_SIZE, page * ROSTER_PAGE_SIZE);
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
  inFlight = fetchFullRoster()
    .then((rows) => {
      cachedRoster = Array.isArray(rows) ? rows : [];
      cachedAt = Date.now();
      return cachedRoster;
    })
    .catch(() => cachedRoster)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Resolve the signed-in user for code paths that have no React component to
 * read `useQuery(['currentUser'])` from — imperative loaders inside event
 * handlers, mostly. Memoized on the same window as the roster.
 * Resolves to null when auth is unavailable, which fails closed.
 */
export function loadCurrentCaller() {
  if (callerAt && Date.now() - callerAt < ROSTER_TTL_MS) {
    return Promise.resolve(cachedCaller);
  }
  if (callerInFlight) return callerInFlight;
  callerInFlight = base44.auth.me()
    .then((user) => {
      cachedCaller = user || null;
      callerAt = Date.now();
      return cachedCaller;
    })
    .catch(() => cachedCaller)
    .finally(() => { callerInFlight = null; });
  return callerInFlight;
}

/** Drop the memoized roster and caller (sign-out, and tests). */
export function resetAgencyRosterCache() {
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
 * `agencyQueryKey(currentUser)` in the query key and `enabled: !!currentUser`,
 * since a missing caller fails closed to [].
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
 * Cache-key fragment identifying the agency a scoped query was filtered for.
 * A scoped query MUST carry this: without it two admins in different agencies
 * share one cache entry and each renders the other tenant's roster.
 */
export function agencyQueryKey(caller) {
  if (!caller) return null;
  if (caller.account_type === 'super_admin') return 'super_admin';
  return String(caller.agency_id || caller.agency_name || '').trim() || 'platform';
}
