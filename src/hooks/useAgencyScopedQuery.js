import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { agencyQueryKey, loadAgencyRoster } from '@/lib/agencyRoster';
import { filterRecordsByAuthorAgency } from '@/lib/agencyScope';

/**
 * Read a clinical record set across patients, scoped to the caller's agency.
 *
 * `Patient` has useScopedPatients; this is the equivalent for the child records
 * that hang off a chart — Visit, Incident, OASISAssessment, CarePlan,
 * PatientAlert, Document. Every one of those entities declares a bare
 * `user_condition: { role: "admin" }` read arm, which docs/HOSTED-RLS-PROOF.md
 * §5b establishes is platform-wide, so a facility admin listing them gets other
 * tenants' nurse notes and vitals.
 *
 * Doing the same four things by hand at every site is what produced the drift
 * this replaces on the patient side, so they live here instead:
 *
 *   - scope by the authoring staff member's agency,
 *   - put the agency in the cache key, or two admins in different agencies
 *     share one entry,
 *   - not run until the caller is known, since scoping fails closed to [],
 *   - leave the fetch itself to the caller, because sort/limit/filter vary far
 *     more here than they do for patients.
 *
 * `authorOf` defaults to `created_by`. Pass it explicitly for a row that records
 * its author under a different field (Document uses `uploaded_by`).
 */
export function useAgencyScopedQuery({
  queryKey,
  fetch,
  authorOf,
  scoped = true,
  enabled = true,
  ...options
}) {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  return useQuery({
    // `scoped: false` for a read that is ALREADY narrower than agency — pinned
    // to one chart or one record. Filtering such a read again can only hide
    // rows: a document on this chart uploaded by a co-treating clinician in
    // another agency would disappear from the chart it belongs to. An unscoped
    // read also keeps its key unchanged and does not wait on the caller,
    // because neither is needed when nothing is being filtered.
    queryKey: scoped ? [...queryKey, agencyQueryKey(currentUser)] : queryKey,
    queryFn: async () => {
      const rows = await fetch();
      if (!scoped) return rows;
      return filterRecordsByAuthorAgency(rows, await loadAgencyRoster(), currentUser, authorOf);
    },
    enabled: enabled && (!scoped || !!currentUser),
    // See useScopedPatients: `initialData` alone is seeded as fresh, so a
    // non-zero staleTime would suppress the fetch-on-mount entirely.
    initialDataUpdatedAt: 0,
    ...options,
  });
}

export default useAgencyScopedQuery;
