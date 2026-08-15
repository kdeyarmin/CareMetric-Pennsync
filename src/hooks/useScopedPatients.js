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
 * `options` is passed through to useQuery, so a caller can still narrow with
 * `select`, defer with `enabled`, or override `staleTime`.
 */
export function useScopedPatients({
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
    queryKey: ['patients', 'scoped', sort, limit, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const rows = await base44.entities.Patient.list(sort, limit);
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

export default useScopedPatients;
