import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { agencyQueryKey, scopePatientsToCallerAgency } from '@/lib/agencyRoster';
import { getMyTenantContext } from '@/functions/getMyTenantContext';
import { listAuthorizedPatients } from '@/functions/listAuthorizedPatients';

const AUTHORIZED_PAGE_SIZE = 50;
const AUTHORIZED_ROSTER_LIMIT = 10000;
const AUTHORIZED_SORT_FIELDS = new Set([
  'id',
  'first_name',
  'middle_name',
  'last_name',
  'medical_record_number',
  'status',
  'care_type',
  'admission_date',
  'primary_diagnosis',
  'updated_date',
]);
const AUTHORIZED_STATUSES = new Set(['active', 'hospitalized', 'discharged']);

function requestedAgencyId(currentUser) {
  const agencyId = String(currentUser?.agency_id || '').trim();
  return agencyId || null;
}

function tenantScopeKey(context) {
  if (!context) return null;
  return [
    context.user_id,
    context.agency_id,
    context.membership_id,
    context.membership_version,
    context.tenant_role,
  ];
}

function sameTenantScope(scope, context) {
  return !!scope
    && !!context
    && scope.agency_id === context.agency_id
    && scope.membership_id === context.membership_id
    && scope.membership_version === context.membership_version
    && scope.tenant_role === context.tenant_role;
}

function comparePatients(sort) {
  if (!sort) return null;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return (left, right) => {
    const leftValue = left?.[field];
    const rightValue = right?.[field];
    if (leftValue == null && rightValue == null) {
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    }
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    const compared = String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (compared !== 0) return descending ? -compared : compared;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  };
}

function validateAuthorizedOptions({ status, sort, limit, options }) {
  if (status != null && !AUTHORIZED_STATUSES.has(status)) {
    throw new Error('Authorized patient status is invalid');
  }
  const sortField = sort ? sort.replace(/^-/, '') : null;
  if (sortField && !AUTHORIZED_SORT_FIELDS.has(sortField)) {
    throw new Error('Authorized patient sort is invalid');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUTHORIZED_ROSTER_LIMIT) {
    throw new Error('Authorized patient limit is invalid');
  }
  const incompatible = Object.keys(options).filter((key) => key !== 'select');
  if (incompatible.length > 0) {
    throw new Error(`Authorized patient query option is incompatible: ${incompatible[0]}`);
  }
}

async function fetchAuthorizedRoster({ tenantContext, status, sort, limit }) {
  const rows = [];
  const seenIds = new Set();
  let cursor = null;

  while (true) {
    const result = await listAuthorizedPatients({
      agencyId: tenantContext.agency_id,
      mode: 'page',
      purpose: 'roster',
      ...(status ? { status } : {}),
      sort: 'id_asc',
      pageSize: AUTHORIZED_PAGE_SIZE,
      cursor,
    });
    if (!sameTenantScope(result.scope, tenantContext)) {
      throw new Error('Patient roster authority changed during request');
    }
    for (const patient of result.patients) {
      if (seenIds.has(patient.id)) {
        throw new Error('Patient roster returned a duplicate keyset row');
      }
      seenIds.add(patient.id);
      rows.push(patient);
    }

    if (!result.page.has_more) break;
    if (rows.length >= AUTHORIZED_ROSTER_LIMIT) {
      throw new Error('Patient roster exceeds the reviewed UI read limit');
    }
    cursor = result.page.next_cursor;
  }

  const comparator = comparePatients(sort);
  const ordered = comparator ? [...rows].sort(comparator) : rows;
  return ordered.slice(0, limit);
}

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
 * `readMode: 'authorized-roster'` opts a compatible selector into the server
 * broker. That mode deliberately returns only listAuthorizedPatients' reviewed
 * `roster` projection. It walks the broker's keyset pages before applying the
 * requested UI sort/limit, so a limit never selects the wrong subset merely
 * because the authorization boundary pages by id. The default remains
 * `legacy` until full-chart consumers have purpose-specific projections; this
 * is an explicit migration seam, not a silent shape change across every page.
 *
 * Legacy `options` are passed through to useQuery. Authorized mode accepts only
 * `select`; cache and refetch policy are part of its security boundary.
 */
export function useScopedPatients({
  status,
  sort = '-updated_date',
  limit = 2000,
  enabled = true,
  readMode = 'legacy',
  ...options
} = {}) {
  if (readMode !== 'legacy' && readMode !== 'authorized-roster') {
    throw new Error('Patient readMode is invalid');
  }
  if (readMode === 'authorized-roster') {
    validateAuthorizedOptions({ status, sort, limit, options });
  }

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const useAuthorizedRoster = readMode === 'authorized-roster';
  const agencyId = requestedAgencyId(currentUser);
  const tenantContextQuery = useQuery({
    queryKey: [
      'tenant-context',
      'patient-roster',
      currentUser?.id || currentUser?.email || null,
      agencyId || 'default',
    ],
    queryFn: async () => {
      const result = await getMyTenantContext(agencyId ? { agencyId } : {});
      if (!result.tenant_context.agency_id) {
        throw new Error('Select an agency before loading an authorized patient roster');
      }
      return result.tenant_context;
    },
    enabled: useAuthorizedRoster && enabled && !!currentUser,
  });

  const legacyQuery = useQuery({
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
    enabled: !useAuthorizedRoster && enabled && !!currentUser,
    initialData: [],
    // `initialData` alone is seeded as FRESH, so any non-zero staleTime (the
    // app default, or one a caller passes) suppresses the fetch-on-mount and
    // the roster stays permanently empty. src/lib/query-client.js sets this
    // globally for the same reason; repeat it here so the hook does not depend
    // on which QueryClient it happens to be mounted under.
    initialDataUpdatedAt: 0,
    ...options,
  });

  const authorizedQuery = useQuery({
    queryKey: [
      'patients', 'authorized-roster', status || 'all', sort || 'unsorted', limit,
      tenantScopeKey(tenantContextQuery.data),
    ],
    queryFn: () => fetchAuthorizedRoster({
      tenantContext: tenantContextQuery.data,
      status,
      sort,
      limit,
    }),
    enabled: useAuthorizedRoster && enabled && !!tenantContextQuery.data,
    initialData: [],
    initialDataUpdatedAt: 0,
    // A server-authorized roster must not inherit the app-wide 60-second fresh
    // window: remount/focus/reconnect should re-check membership and assignment
    // authority. Exact revocation-driven eviction remains a hosted cutover gate
    // until assignment state has a server-owned version in the cache identity.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select: options.select,
  });

  if (!useAuthorizedRoster) return legacyQuery;
  if (tenantContextQuery.error) {
    return { ...tenantContextQuery, data: [] };
  }
  return authorizedQuery;
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
