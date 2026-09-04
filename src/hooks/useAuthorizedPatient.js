import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  getAuthorizedPatient,
  isAuthorizedPatientPurpose,
} from '@/functions/getAuthorizedPatient';
import { getMyTenantContext } from '@/functions/getMyTenantContext';

const MAX_IDENTIFIER_LENGTH = 200;
const AUTH_REFRESH_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
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

function inputError(patientId, purpose, agencyId) {
  if (!exactIdentifier(patientId)) return 'patientId is invalid';
  if (!isAuthorizedPatientPurpose(purpose)) return 'purpose is invalid';
  if (agencyId === null) {
    return 'agencyId is required; select an agency before loading patient data';
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

export function authorizedPatientQueryKey({ patientId, purpose, scope }) {
  return [
    'patient',
    patientId || null,
    'authorized-exact',
    purpose || null,
    scope?.user_id || null,
    scope?.agency_id || null,
    scope?.membership_id ?? null,
    scope?.membership_version ?? null,
    scope?.tenant_role || null,
  ];
}

function isAuthorizedPatientQuery(query) {
  const key = query?.queryKey;
  return Array.isArray(key)
    && key[0] === 'patient'
    && key[2] === 'authorized-exact';
}

/**
 * Read one exact Patient through the server-owned authorization boundary.
 *
 * The tenant context is resolved first and its immutable identity becomes part
 * of the Patient cache key. A membership transition therefore cannot reuse a
 * prior membership's cached PHI. An explicit agency is mandatory so an
 * unscoped platform owner or multi-membership user must select the tenant they
 * intend to access. Focus/reconnect always re-check both the tenant authority
 * and the exact Patient grant. While any check is in flight, or after any check
 * fails, cached PHI is withheld. Invalid input and scope drift fail closed;
 * this hook has no direct Patient entity fallback.
 *
 * The key begins with ['patient', patientId], so the existing single-patient
 * invalidation contract also invalidates every purpose/scope projection for
 * that Patient.
 */
export function useAuthorizedPatient({
  patientId,
  purpose,
  agencyId,
  enabled = true,
} = {}) {
  const queryClient = useQueryClient();
  const requestedAgencyId = agencyId === undefined ? null : agencyId;
  const inputErrorMessage = inputError(patientId, purpose, requestedAgencyId);

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

  const tenantContextQuery = useQuery({
    queryKey: [
      'tenant-context',
      'authorized-patient',
      currentUserId,
      requestedAgencyId,
    ],
    queryFn: () => getMyTenantContext(
      requestedAgencyId === null ? {} : { agencyId: requestedAgencyId },
    ),
    enabled: enabled && !inputErrorMessage && currentUserSettled && !!currentUserId,
    ...AUTH_REFRESH_OPTIONS,
  });

  const tenantScope = useMemo(() => exactTenantScope(
    tenantContextQuery.data?.tenant_context,
    currentUserId,
    requestedAgencyId,
  ), [
    currentUserId,
    requestedAgencyId,
    tenantContextQuery.data?.tenant_context,
  ]);
  const tenantContextSettled = currentUserSettled
    && settledSuccessfullyAfterMount(tenantContextQuery);
  const scopeErrorMessage = tenantContextSettled && !tenantScope
    ? 'Tenant authorization scope failed integrity validation'
    : null;
  const tenantScopeSettled = tenantContextSettled && !!tenantScope;

  const patientQueryKey = useMemo(() => authorizedPatientQueryKey({
    patientId,
    purpose,
    scope: tenantScope,
  }), [patientId, purpose, tenantScope]);

  const patientQuery = useQuery({
    queryKey: patientQueryKey,
    queryFn: async () => {
      if (inputErrorMessage) throw new Error(inputErrorMessage);
      if (identityErrorMessage) throw new Error(identityErrorMessage);
      if (scopeErrorMessage || !tenantScope) {
        throw new Error(scopeErrorMessage || 'Tenant authorization scope is unavailable');
      }

      const result = await getAuthorizedPatient({
        agencyId: tenantScope.agency_id,
        patientId,
        purpose,
      });
      if (!sameScope(result.scope, tenantScope)) {
        throw new Error('Patient authorization scope changed during lookup');
      }
      return result.patient;
    },
    enabled: enabled && !!(
      inputErrorMessage
      || identityErrorMessage
      || scopeErrorMessage
      || tenantScopeSettled
    ),
    ...AUTH_REFRESH_OPTIONS,
  });

  const upstreamError = currentUserQuery.error || tenantContextQuery.error || null;
  const authorizationError = upstreamError || patientQuery.error || null;
  const isFetching = currentUserQuery.isFetching
    || tenantContextQuery.isFetching
    || patientQuery.isFetching;
  const isPaused = currentUserQuery.isPaused
    || tenantContextQuery.isPaused
    || patientQuery.isPaused;

  // A settled identity change is a hard cache namespace transition. Remove
  // every exact-Patient projection owned by the prior authenticated user.
  useEffect(() => {
    if (!currentUserSettled || !currentUserId) return;
    queryClient.removeQueries({
      predicate: (query) => (
        isAuthorizedPatientQuery(query)
        && query.queryKey[4] !== currentUserId
      ),
    });
  }, [
    currentUserId,
    currentUserSettled,
    queryClient,
  ]);

  // Likewise, retain no exact-Patient cache from a different immutable tenant
  // membership once the requested tenant has settled successfully.
  useEffect(() => {
    if (!tenantContextSettled || !tenantScope) return;
    queryClient.removeQueries({
      predicate: (query) => {
        if (!isAuthorizedPatientQuery(query) || query.queryKey[4] !== currentUserId) {
          return false;
        }
        return query.queryKey[5] !== tenantScope.agency_id
          || query.queryKey[6] !== tenantScope.membership_id
          || query.queryKey[7] !== tenantScope.membership_version
          || query.queryKey[8] !== tenantScope.tenant_role;
      },
    });
  }, [
    currentUserId,
    queryClient,
    tenantContextSettled,
    tenantScope,
  ]);

  // React Query deliberately retains the last successful data when a
  // background refetch fails. Remove that cache entry after a denied broker
  // recheck; the return value below already withholds it on the failing render.
  useEffect(() => {
    if (patientQuery.isError && !patientQuery.isFetching && patientQuery.data !== undefined) {
      queryClient.removeQueries({ queryKey: patientQueryKey, exact: true });
    }
  }, [
    patientQuery.data,
    patientQuery.isError,
    patientQuery.isFetching,
    patientQueryKey,
    queryClient,
  ]);

  // If identity or tenant revalidation fails, no exact Patient projection from
  // the now-unverifiable authority remains reusable elsewhere in the client.
  useEffect(() => {
    if (!upstreamError || currentUserQuery.isFetching || tenantContextQuery.isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedPatientQuery });
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
    && settledSuccessfullyAfterMount(patientQuery)
  );

  return {
    ...patientQuery,
    data: settledSuccessfully ? patientQuery.data : undefined,
    error: authorizationError,
    status: authorizationError ? 'error' : settledSuccessfully ? 'success' : 'pending',
    isError: Boolean(authorizationError),
    isSuccess: settledSuccessfully,
    isPending: !authorizationError && !settledSuccessfully,
    isFetching,
    isPaused,
    // Cached data is intentionally hidden while background authorization
    // rechecks run, so expose that interval as loading to hook consumers.
    isLoading: enabled && (isFetching || isPaused),
    tenantScope: settledSuccessfully ? tenantScope : null,
  };
}

export default useAuthorizedPatient;
