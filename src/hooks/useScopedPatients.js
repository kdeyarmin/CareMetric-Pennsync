import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { agencyQueryKey, scopePatientsToCallerAgency } from '@/lib/agencyRoster';

/**
 * The one way to read a patient roster across charts.
 *
 * Every view that lists patients has to do the same four things, and getting
 * any of them wrong is a data bug rather than a style problem:
 *
 *   - apply the caller's agency scope (see src/lib/agencyScope.js),
 *   - put the agency in the cache key, or two admins in different agencies
 *     share one entry and each renders the other tenant's roster,
 *   - not run until the caller is known, since scoping fails closed to [],
 *   - key on sort + limit, because a 100-row read and a 2000-row read of the
 *     same entity are different result sets.
 *
 * Doing that by hand at two dozen call sites is what produced the drift this
 * hook replaces: some scoped and some did not, and ten of the ones that did
 * left the agency out of the key. A shared key also means the eight views that
 * want `('-updated_date', 2000)` now share one fetch instead of eight.
 *
 * Pass `status` for the active-only roster (`Patient.filter({ status }, …)`);
 * omit it for the full list. Both are cross-chart reads and both are scoped —
 * the second population of unscoped views read the roster this way rather than
 * via `.list`, which is why the shape lives here instead of at the call site.
 *
 * `options` is passed through to useQuery, so a caller can still narrow with
 * `select`, defer with `enabled`, or override `staleTime`.
 */
export function useScopedPatients({
  status,
  sort = '-updated_date',
  limit = 2000,
  enabled = true,
  ...options
} = {}) {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  return useQuery({
    // `status` and `sort` are part of the identity: an active-only read and a
    // full read of the same limit are different result sets. `sort: null` means
    // "whatever the API orders by", which is its own ordering, not '-updated_date'.
    queryKey: [
      'patients', 'scoped', status || 'all', sort || 'unsorted', limit,
      agencyQueryKey(currentUser),
    ],
    queryFn: async () => {
      const rows = status
        ? await base44.entities.Patient.filter({ status }, sort || undefined, limit)
        : await base44.entities.Patient.list(sort, limit);
      return scopePatientsToCallerAgency(rows, currentUser);
    },
    enabled: enabled && !!currentUser,
    initialData: [],
    // `initialData` alone is seeded as FRESH, so any non-zero staleTime (the
    // app default, or one a caller passes) suppresses the fetch-on-mount and
    // the roster stays permanently empty. src/lib/query-client.js sets this
    // globally for the same reason; repeat it here so the hook does not depend
    // on which QueryClient it happens to be mounted under.
    initialDataUpdatedAt: 0,
    ...options,
  });
}

/**
 * Shared roster selectors.
 *
 * React Query memoizes `select` by REFERENCE (`options.select === selectFn` in
 * queryObserver), so an inline arrow is a fresh reference on every render and
 * the filter re-runs every time — over rosters up to 10,000 rows here, plus the
 * structural-sharing pass over its result. Module-level selectors are stable for
 * the life of the module, so the filter runs once per fetch instead.
 *
 * A selector that closes over props or state cannot live here; wrap those in
 * `useCallback` at the call site so they are stable between renders.
 */
export const excludeArchived = (rows) => rows.filter((p) => !p.is_archived);

export const onlyActive = (rows) => rows.filter((p) => p.status === 'active');

export const activeAndNotArchived = (rows) => rows.filter(
  (p) => !p.is_archived && p.status === 'active',
);

export default useScopedPatients;
