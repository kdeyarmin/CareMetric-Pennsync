import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getMyTenantContext } from '@/functions/getMyTenantContext';
import {
  authorizedPatientListPageSize,
  isAuthorizedPatientListPurpose,
  isAuthorizedPatientListSort,
  listAuthorizedPatients,
} from '@/functions/listAuthorizedPatients';
import {
  tenantContextMatchesRequest,
  trustedTenantRequest,
} from '@/lib/trustedTenantRequest';

const AUTHORIZED_ROSTER_LIMIT = 10_000;
const MAX_IDENTIFIER_LENGTH = 200;
const AUTHORIZED_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const AUTH_REFRESH_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
});

export const AUTHORIZED_PATIENT_LIST_QUERY_KEY = Object.freeze([
  'patients', 'authorized-list',
]);

export function invalidateAuthorizedPatientLists(queryClient) {
  return queryClient.invalidateQueries({ queryKey: AUTHORIZED_PATIENT_LIST_QUERY_KEY });
}

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function settledSuccessfullyAfterMount(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error;
}

function isAuthorizedPatientListQuery(query) {
  const key = query?.queryKey;
  return Array.isArray(key)
    && key[0] === 'patients'
    && key[1] === 'authorized-list';
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

function validateOptions({ agencyId, purpose, status, sort, limit, options }) {
  if (agencyId !== undefined && !exactIdentifier(agencyId)) {
    throw new Error('Authorized patient agencyId is invalid');
  }
  if (!isAuthorizedPatientListPurpose(purpose)) {
    throw new Error('Authorized patient purpose is invalid');
  }
  if (status != null && !AUTHORIZED_STATUSES.has(status)) {
    throw new Error('Authorized patient status is invalid');
  }
  if (!isAuthorizedPatientListSort(purpose, sort)) {
    throw new Error('Authorized patient sort is invalid for purpose');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUTHORIZED_ROSTER_LIMIT) {
    throw new Error('Authorized patient limit is invalid');
  }
  const incompatible = Object.keys(options).filter((key) => key !== 'select');
  if (incompatible.length > 0) {
    throw new Error(`Authorized patient query option is incompatible: ${incompatible[0]}`);
  }
}

async function fetchAuthorizedPatients({ tenantContext, purpose, status, sort, limit }) {
  const rows = [];
  const seenIds = new Set();
  let cursor = null;
  const pageSize = authorizedPatientListPageSize(purpose);

  while (true) {
    const result = await listAuthorizedPatients({
      agencyId: tenantContext.agency_id,
      mode: 'page',
      purpose,
      ...(status ? { status } : {}),
      sort: 'id_asc',
      pageSize,
      cursor,
    });
    if (!sameTenantScope(result.scope, tenantContext)) {
      throw new Error('Patient list authority changed during request');
    }
    for (const patient of result.patients) {
      if (seenIds.has(patient.id)) {
        throw new Error('Patient list returned a duplicate keyset row');
      }
      seenIds.add(patient.id);
      rows.push(patient);
    }

    if (!result.page.has_more) break;
    if (rows.length >= AUTHORIZED_ROSTER_LIMIT) {
      throw new Error('Patient list exceeds the reviewed UI read limit');
    }
    cursor = result.page.next_cursor;
  }

  const comparator = comparePatients(sort);
  const ordered = comparator ? [...rows].sort(comparator) : rows;
  return ordered.slice(0, limit);
}

/**
 * The sole frontend list boundary for Patient PHI. Every caller names a
 * reviewed purpose. Identity and immutable tenant membership are revalidated
 * before the purpose projection is loaded, cached rows are scoped by that
 * membership identity, and stale rows are hidden throughout every recheck.
 */
export function useScopedPatients({
  agencyId,
  purpose,
  status,
  sort = '-updated_date',
  limit = 2000,
  enabled = true,
  readMode,
  ...options
} = {}) {
  const queryClient = useQueryClient();
  if (readMode !== undefined) {
    throw new Error('Patient readMode is obsolete; use a reviewed purpose');
  }
  validateOptions({ agencyId, purpose, status, sort, limit, options });

  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    enabled,
    ...AUTH_REFRESH_OPTIONS,
  });
  const currentUser = currentUserQuery.data;
  const currentUserSettled = settledSuccessfullyAfterMount(currentUserQuery);
  const currentUserId = exactIdentifier(currentUser?.id) ? currentUser.id : null;
  const requestedAgencyId = agencyId === undefined ? null : agencyId;
  const tenantRequest = useMemo(
    () => trustedTenantRequest(currentUser, requestedAgencyId),
    [currentUser, requestedAgencyId],
  );
  const identityError = useMemo(
    () => (currentUserSettled && !currentUserId
      ? new Error('Authenticated user identity failed integrity validation')
      : null),
    [currentUserId, currentUserSettled],
  );
  const authorityError = useMemo(
    () => (currentUserSettled && currentUserId && !tenantRequest
      ? new Error('Requested agency does not match the trusted tenant selection')
      : null),
    [currentUserId, currentUserSettled, tenantRequest],
  );
  const tenantContextQuery = useQuery({
    queryKey: [
      'tenant-context',
      'patient-list',
      currentUser?.id || currentUser?.email || null,
      tenantRequest?.authorityKey || null,
      tenantRequest?.agencyId || requestedAgencyId,
    ],
    queryFn: async () => {
      if (!tenantRequest) throw new Error('Trusted tenant selection is unavailable');
      const result = await getMyTenantContext(tenantRequest.options);
      if (!tenantContextMatchesRequest(result.tenant_context, tenantRequest)) {
        throw new Error('Patient list tenant authority changed during verification');
      }
      if (!result.tenant_context.agency_id) {
        throw new Error('Select an agency before loading patients');
      }
      return result.tenant_context;
    },
    enabled: enabled && currentUserSettled && !!currentUserId && !!tenantRequest,
    ...AUTH_REFRESH_OPTIONS,
  });
  const tenantContextSettled = currentUserSettled
    && settledSuccessfullyAfterMount(tenantContextQuery);
  const tenantContext = tenantContextSettled
    && tenantContextMatchesRequest(tenantContextQuery.data, tenantRequest)
    ? tenantContextQuery.data
    : null;
  const tenantScopeError = useMemo(
    () => (tenantContextSettled && !tenantContext
      ? new Error('Patient list tenant authority failed integrity validation')
      : null),
    [tenantContext, tenantContextSettled],
  );

  const authorizedQuery = useQuery({
    queryKey: [
      'patients', 'authorized-list', purpose, status || 'all', sort || 'unsorted', limit,
      tenantScopeKey(tenantContext),
    ],
    queryFn: () => {
      if (!tenantContext) throw new Error('Fresh Patient tenant authority is unavailable');
      return fetchAuthorizedPatients({ tenantContext, purpose, status, sort, limit });
    },
    enabled: enabled && !!tenantContext,
    initialData: [],
    initialDataUpdatedAt: 0,
    ...AUTH_REFRESH_OPTIONS,
    select: options.select,
  });

  const upstreamError = currentUserQuery.error
    || tenantContextQuery.error
    || identityError
    || authorityError
    || tenantScopeError
    || null;
  const authorizationError = upstreamError || authorizedQuery.error || null;
  const isFetching = currentUserQuery.isFetching
    || tenantContextQuery.isFetching
    || authorizedQuery.isFetching;
  const isPaused = currentUserQuery.isPaused
    || tenantContextQuery.isPaused
    || authorizedQuery.isPaused;
  const authorizedSettled = Boolean(
    enabled
    && currentUserSettled
    && currentUserId
    && tenantContextSettled
    && tenantContext
    && settledSuccessfullyAfterMount(authorizedQuery)
    && !authorizationError
    && !isFetching
    && !isPaused
  );

  useEffect(() => {
    if (!upstreamError || isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedPatientListQuery });
  }, [isFetching, queryClient, upstreamError]);

  useEffect(() => {
    if (!authorizedQuery.isError || authorizedQuery.isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedPatientListQuery });
  }, [authorizedQuery.isError, authorizedQuery.isFetching, queryClient]);

  return {
    ...authorizedQuery,
    data: authorizedSettled ? authorizedQuery.data : [],
    error: authorizationError,
    status: authorizationError ? 'error' : authorizedSettled ? 'success' : 'pending',
    isError: Boolean(authorizationError),
    isPending: !authorizationError && !authorizedSettled,
    isSuccess: authorizedSettled,
    isFetching,
    isPaused,
    isLoading: enabled && !authorizationError && !authorizedSettled,
    tenantScope: authorizedSettled ? tenantContext : null,
  };
}

export const onlyActive = (rows) => rows.filter((patient) => patient.status === 'active');
export const excludeArchived = (rows) => rows.filter((patient) => !patient.is_archived);
export const activeAndNotArchived = (rows) => rows.filter(
  (patient) => patient.status === 'active' && !patient.is_archived,
);

export default useScopedPatients;
