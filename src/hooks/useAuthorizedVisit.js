import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getAuthorizedVisit } from '@/functions/getAuthorizedVisit';
import { getMyTenantContext } from '@/functions/getMyTenantContext';
import {
  tenantContextMatchesRequest,
  trustedTenantRequest,
} from '@/lib/trustedTenantRequest';

const MAX_IDENTIFIER_LENGTH = 200;
const AUTHORIZED_VISIT_PURPOSES = new Set([
  'schedule',
  'documentation',
  'compliance_review',
]);
const AUTH_REFRESH_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: 'always',
  refetchOnReconnect: 'always',
  refetchOnWindowFocus: 'always',
});

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function inputError(visitId, purpose, agencyId) {
  if (!exactIdentifier(visitId)) return 'visitId is invalid';
  if (!AUTHORIZED_VISIT_PURPOSES.has(purpose)) return 'purpose is invalid';
  if (agencyId === null) {
    return 'agencyId is required; select an agency before loading visit data';
  }
  if (!exactIdentifier(agencyId)) return 'agencyId is invalid';
  return null;
}

function exactTenantScope(context, currentUserId, requestedAgencyId) {
  if (
    !context
    || typeof context !== 'object'
    || Array.isArray(context)
    || context.user_id !== currentUserId
    || !exactIdentifier(context.user_id)
    || !exactIdentifier(context.agency_id)
    || (requestedAgencyId !== null && context.agency_id !== requestedAgencyId)
    || typeof context.tenant_role !== 'string'
    || context.tenant_role.length === 0
  ) {
    return null;
  }

  if (context.tenant_role === 'platform_owner') {
    if (context.membership_id !== null || context.membership_version !== null) return null;
  } else if (
    !exactIdentifier(context.membership_id)
    || !Number.isSafeInteger(context.membership_version)
    || context.membership_version < 1
  ) {
    return null;
  }

  return {
    user_id: context.user_id,
    agency_id: context.agency_id,
    membership_id: context.membership_id,
    membership_version: context.membership_version,
    tenant_role: context.tenant_role,
  };
}

function sameScope(scope, tenantScope) {
  return !!scope
    && scope.agency_id === tenantScope.agency_id
    && scope.membership_id === tenantScope.membership_id
    && scope.membership_version === tenantScope.membership_version
    && scope.tenant_role === tenantScope.tenant_role;
}

function settledSuccessfullyAfterMount(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error;
}

export function authorizedVisitQueryKey({ visitId, purpose, scope }) {
  return [
    'visit',
    visitId || null,
    'authorized-exact',
    purpose || null,
    scope?.user_id || null,
    scope?.agency_id || null,
    scope?.membership_id ?? null,
    scope?.membership_version ?? null,
    scope?.tenant_role || null,
  ];
}

function isAuthorizedVisitQuery(query) {
  const key = query?.queryKey;
  return Array.isArray(key)
    && key[0] === 'visit'
    && key[2] === 'authorized-exact';
}

/**
 * Read one exact Visit through the server-owned authorization boundary.
 *
 * Identity, tenant membership, and the Visit grant are freshly revalidated on
 * mount, focus, and reconnect. Their immutable identities are part of the
 * cache key, and cached Visit PHI is withheld whenever any recheck is pending,
 * paused, or denied. This hook has no direct Visit entity fallback.
 */
export function useAuthorizedVisit({
  visitId,
  purpose,
  agencyId,
  enabled = true,
} = {}) {
  const queryClient = useQueryClient();
  const requestedAgencyId = agencyId === undefined ? null : agencyId;
  const inputErrorMessage = inputError(visitId, purpose, requestedAgencyId);

  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    enabled: enabled && !inputErrorMessage,
    ...AUTH_REFRESH_OPTIONS,
  });
  const currentUserId = exactIdentifier(currentUserQuery.data?.id)
    ? currentUserQuery.data.id
    : null;
  const currentUserSettled = settledSuccessfullyAfterMount(currentUserQuery);
  const identityErrorMessage = currentUserSettled && !currentUserId
    ? 'Authenticated user identity failed integrity validation'
    : null;
  const tenantRequest = useMemo(
    () => trustedTenantRequest(currentUserQuery.data, requestedAgencyId),
    [currentUserQuery.data, requestedAgencyId],
  );
  const authorityErrorMessage = currentUserSettled && currentUserId && !tenantRequest
    ? 'Requested agency does not match the trusted tenant selection'
    : null;

  const tenantContextQuery = useQuery({
    queryKey: [
      'tenant-context',
      'authorized-visit',
      currentUserId,
      requestedAgencyId,
      tenantRequest?.authorityKey || null,
    ],
    queryFn: () => getMyTenantContext(tenantRequest.options),
    enabled: enabled
      && !inputErrorMessage
      && currentUserSettled
      && !!currentUserId
      && !!tenantRequest,
    ...AUTH_REFRESH_OPTIONS,
  });

  const tenantScope = useMemo(() => {
    const context = tenantContextQuery.data?.tenant_context;
    if (!tenantContextMatchesRequest(context, tenantRequest)) return null;
    return exactTenantScope(context, currentUserId, requestedAgencyId);
  }, [currentUserId, requestedAgencyId, tenantContextQuery.data?.tenant_context, tenantRequest]);
  const tenantContextSettled = currentUserSettled
    && settledSuccessfullyAfterMount(tenantContextQuery);
  const scopeErrorMessage = tenantContextSettled && !tenantScope
    ? 'Tenant authorization scope failed integrity validation'
    : null;
  const tenantScopeSettled = tenantContextSettled && !!tenantScope;

  const visitQueryKey = useMemo(() => authorizedVisitQueryKey({
    visitId,
    purpose,
    scope: tenantScope,
  }), [purpose, tenantScope, visitId]);

  const visitQuery = useQuery({
    queryKey: visitQueryKey,
    queryFn: async () => {
      if (inputErrorMessage) throw new Error(inputErrorMessage);
      if (identityErrorMessage) throw new Error(identityErrorMessage);
      if (authorityErrorMessage) throw new Error(authorityErrorMessage);
      if (scopeErrorMessage || !tenantScope) {
        throw new Error(scopeErrorMessage || 'Tenant authorization scope is unavailable');
      }

      const result = await getAuthorizedVisit({
        agencyId: tenantScope.agency_id,
        visitId,
        purpose,
      });
      if (!sameScope(result.scope, tenantScope)) {
        throw new Error('Visit authorization scope changed during lookup');
      }
      return result.visit;
    },
    enabled: enabled && !!(
      inputErrorMessage
      || identityErrorMessage
      || authorityErrorMessage
      || scopeErrorMessage
      || tenantScopeSettled
    ),
    ...AUTH_REFRESH_OPTIONS,
  });

  const upstreamError = currentUserQuery.error || tenantContextQuery.error || null;
  const authorizationError = upstreamError || visitQuery.error || null;
  const isFetching = currentUserQuery.isFetching
    || tenantContextQuery.isFetching
    || visitQuery.isFetching;
  const isPaused = currentUserQuery.isPaused
    || tenantContextQuery.isPaused
    || visitQuery.isPaused;

  useEffect(() => {
    if (!currentUserSettled || !currentUserId) return;
    queryClient.removeQueries({
      predicate: (query) => (
        isAuthorizedVisitQuery(query)
        && query.queryKey[4] !== currentUserId
      ),
    });
  }, [currentUserId, currentUserSettled, queryClient]);

  useEffect(() => {
    if (!tenantContextSettled || !tenantScope) return;
    queryClient.removeQueries({
      predicate: (query) => {
        if (!isAuthorizedVisitQuery(query) || query.queryKey[4] !== currentUserId) {
          return false;
        }
        return query.queryKey[5] !== tenantScope.agency_id
          || query.queryKey[6] !== tenantScope.membership_id
          || query.queryKey[7] !== tenantScope.membership_version
          || query.queryKey[8] !== tenantScope.tenant_role;
      },
    });
  }, [currentUserId, queryClient, tenantContextSettled, tenantScope]);

  // React Query retains the previous success after a failed background fetch.
  // Hide it synchronously via the return contract above, then evict it here.
  useEffect(() => {
    if (visitQuery.isError && !visitQuery.isFetching && visitQuery.data !== undefined) {
      queryClient.removeQueries({ queryKey: visitQueryKey, exact: true });
    }
  }, [
    queryClient,
    visitQuery.data,
    visitQuery.isError,
    visitQuery.isFetching,
    visitQueryKey,
  ]);

  useEffect(() => {
    if (!upstreamError || currentUserQuery.isFetching || tenantContextQuery.isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedVisitQuery });
  }, [
    currentUserQuery.isFetching,
    queryClient,
    tenantContextQuery.isFetching,
    upstreamError,
  ]);

  const settledSuccessfully = Boolean(
    enabled
    && !inputErrorMessage
    && settledSuccessfullyAfterMount(currentUserQuery)
    && currentUserId
    && settledSuccessfullyAfterMount(tenantContextQuery)
    && tenantScope
    && settledSuccessfullyAfterMount(visitQuery)
  );

  return {
    ...visitQuery,
    data: settledSuccessfully ? visitQuery.data : undefined,
    error: authorizationError,
    status: authorizationError ? 'error' : settledSuccessfully ? 'success' : 'pending',
    isError: Boolean(authorizationError),
    isSuccess: settledSuccessfully,
    isPending: !authorizationError && !settledSuccessfully,
    isFetching,
    isPaused,
    isLoading: enabled && (isFetching || isPaused),
    tenantScope: settledSuccessfully ? tenantScope : null,
  };
}

export default useAuthorizedVisit;
