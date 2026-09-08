import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getMyTenantContext } from '@/functions/getMyTenantContext';
import {
  collectAuthorizedVisits,
  isAuthorizedVisitListPurpose,
  isAuthorizedVisitListSort,
} from '@/functions/listAuthorizedVisits';
import {
  tenantContextMatchesRequest,
  trustedTenantRequest,
} from '@/lib/trustedTenantRequest';

const MAX_IDENTIFIER_LENGTH = 200;
const VISIT_STATUSES = new Set([
  'scheduled', 'in_progress', 'completed', 'pending_review', 'cancelled',
]);
const MAX_VISIT_LIMIT = 10_000;
const AUTH_REFRESH_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
});

export const AUTHORIZED_VISIT_LIST_QUERY_KEY = Object.freeze([
  'visits', 'authorized-list',
]);

export function invalidateAuthorizedVisitLists(queryClient) {
  return queryClient.invalidateQueries({ queryKey: AUTHORIZED_VISIT_LIST_QUERY_KEY });
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

function isAuthorizedVisitListQuery(query) {
  const key = query?.queryKey;
  return Array.isArray(key) && key[0] === 'visits' && key[1] === 'authorized-list';
}

function validateOptions({ agencyId, patientId, purpose, status, sort, limit, options }) {
  if (agencyId !== undefined && !exactIdentifier(agencyId)) {
    throw new Error('Authorized Visit agencyId is invalid');
  }
  if (patientId !== null && patientId !== undefined && !exactIdentifier(patientId)) {
    throw new Error('Authorized Visit patientId is invalid');
  }
  if (!isAuthorizedVisitListPurpose(purpose)) {
    throw new Error('Authorized Visit purpose is invalid');
  }
  if (status !== null && status !== undefined && !VISIT_STATUSES.has(status)) {
    throw new Error('Authorized Visit status is invalid');
  }
  if (!isAuthorizedVisitListSort(purpose, sort)) {
    throw new Error('Authorized Visit sort is invalid for purpose');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_VISIT_LIMIT) {
    throw new Error('Authorized Visit limit is invalid');
  }
  const incompatible = Object.keys(options).filter((key) => key !== 'select');
  if (incompatible.length > 0) {
    throw new Error(`Authorized Visit query option is incompatible: ${incompatible[0]}`);
  }
}

/**
 * The sole frontend list boundary for Visit PHI. Only exact patient/status
 * filters are supported; every result is a named projection loaded through
 * bounded keyset pages and cached under immutable membership identity.
 */
export function useAuthorizedVisits({
  agencyId,
  patientId = null,
  purpose,
  status = null,
  sort = '-visit_date',
  limit = 500,
  enabled = true,
  ...options
} = {}) {
  const queryClient = useQueryClient();
  validateOptions({ agencyId, patientId, purpose, status, sort, limit, options });

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
      'tenant-context', 'visit-list', currentUserId,
      tenantRequest?.authorityKey || null,
      tenantRequest?.agencyId || requestedAgencyId,
    ],
    queryFn: async () => {
      if (!tenantRequest) throw new Error('Trusted tenant selection is unavailable');
      const result = await getMyTenantContext(tenantRequest.options);
      if (!tenantContextMatchesRequest(result.tenant_context, tenantRequest)) {
        throw new Error('Visit list tenant authority changed during verification');
      }
      if (!result.tenant_context.agency_id) {
        throw new Error('Select an agency before loading Visits');
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
      ? new Error('Visit list tenant authority failed integrity validation')
      : null),
    [tenantContext, tenantContextSettled],
  );

  const visitQuery = useQuery({
    queryKey: [
      'visits', 'authorized-list', purpose, patientId, status, sort, limit,
      tenantScopeKey(tenantContext),
    ],
    queryFn: () => {
      if (!tenantContext) throw new Error('Fresh Visit tenant authority is unavailable');
      if (
        patientId === null
        && !['agency_admin', 'manager', 'platform_owner'].includes(tenantContext.tenant_role)
      ) {
        throw new Error(
          'Agency-wide Visit metrics require manager authority; select an exact patient',
        );
      }
      return collectAuthorizedVisits({
        agencyId: tenantContext.agency_id,
        patientId,
        purpose,
        status,
        sort,
        limit,
        expectedScope: tenantContext,
      });
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
  const authorizationError = upstreamError || visitQuery.error || null;
  const isFetching = currentUserQuery.isFetching
    || tenantContextQuery.isFetching
    || visitQuery.isFetching;
  const isPaused = currentUserQuery.isPaused
    || tenantContextQuery.isPaused
    || visitQuery.isPaused;
  const settled = Boolean(
    enabled
    && currentUserSettled
    && currentUserId
    && tenantContextSettled
    && tenantContext
    && settledSuccessfullyAfterMount(visitQuery)
    && !authorizationError
    && !isFetching
    && !isPaused
  );

  useEffect(() => {
    if (!upstreamError || isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedVisitListQuery });
  }, [isFetching, queryClient, upstreamError]);

  useEffect(() => {
    if (!visitQuery.isError || visitQuery.isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedVisitListQuery });
  }, [queryClient, visitQuery.isError, visitQuery.isFetching]);

  return {
    ...visitQuery,
    data: settled ? visitQuery.data : [],
    error: authorizationError,
    status: authorizationError ? 'error' : settled ? 'success' : 'pending',
    isError: Boolean(authorizationError),
    isPending: !authorizationError && !settled,
    isSuccess: settled,
    isFetching,
    isPaused,
    isLoading: enabled && !authorizationError && !settled,
    tenantScope: settled ? tenantContext : null,
  };
}

export default useAuthorizedVisits;
