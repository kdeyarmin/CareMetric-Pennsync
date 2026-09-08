import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getMyTenantContext } from '@/functions/getMyTenantContext';
import {
  tenantContextMatchesRequest,
  trustedTenantRequest,
} from '@/lib/trustedTenantRequest';

const MAX_IDENTIFIER_LENGTH = 200;
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
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

function settledSuccessfullyAfterMount(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error;
}

function exactSingletonTenantScope(context, currentUserId) {
  if (
    !context
    || typeof context !== 'object'
    || Array.isArray(context)
    || !exactIdentifier(currentUserId)
    || context.user_id !== currentUserId
    || !exactIdentifier(context.agency_id)
    || !exactIdentifier(context.membership_id)
    || context.membership_key !== `${context.agency_id}:${currentUserId}`
    || !Number.isSafeInteger(context.membership_version)
    || context.membership_version < 1
    || !TENANT_ROLES.has(context.tenant_role)
    || context.membership_status !== 'active'
    || context.is_platform_owner !== false
    || !context.agency
    || typeof context.agency !== 'object'
    || Array.isArray(context.agency)
    || context.agency.id !== context.agency_id
    || !ACTIVE_AGENCY_STATUSES.has(context.agency.status)
  ) {
    return null;
  }

  return { agencyId: context.agency_id };
}

function isPatientDetailsTenantQuery(query) {
  const key = query?.queryKey;
  return Array.isArray(key)
    && key[0] === 'tenant-context'
    && key[1] === 'patient-details-route';
}

/**
 * Resolve the only safe implicit PatientDetails route scope.
 *
 * AuthContext's exact selected membership supplies the agency plus expected
 * membership id/version. Mutable User/Patient agency fields are ignored.
 * Cached identity and tenant results are never exposed until both have
 * revalidated after this mount, so a stale, paused, failed, or transitioning
 * session produces no URL.
 */
export function usePatientDetailsRouteScope({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    enabled,
    ...AUTH_REFRESH_OPTIONS,
  });
  const currentUserSettled = settledSuccessfullyAfterMount(currentUserQuery);
  const currentUserId = exactIdentifier(currentUserQuery.data?.id)
    ? currentUserQuery.data.id
    : null;
  const tenantRequest = useMemo(
    () => trustedTenantRequest(currentUserQuery.data),
    [currentUserQuery.data],
  );

  const tenantContextQuery = useQuery({
    queryKey: [
      'tenant-context',
      'patient-details-route',
      currentUserId,
      tenantRequest?.authorityKey || null,
      tenantRequest?.agencyId || null,
    ],
    queryFn: () => getMyTenantContext(tenantRequest.options),
    enabled: enabled && currentUserSettled && !!currentUserId && !!tenantRequest,
    ...AUTH_REFRESH_OPTIONS,
  });
  const tenantContextSettled = currentUserSettled
    && settledSuccessfullyAfterMount(tenantContextQuery);
  const singletonScope = useMemo(() => exactSingletonTenantScope(
    tenantContextQuery.data?.tenant_context,
    currentUserId,
  ), [currentUserId, tenantContextQuery.data?.tenant_context]);
  const exactSelectedScope = singletonScope
    && tenantContextMatchesRequest(tenantContextQuery.data?.tenant_context, tenantRequest)
    ? singletonScope
    : null;

  const identityError = currentUserSettled && !currentUserId
    ? new Error('Authenticated user identity failed integrity validation')
    : null;
  const authorityError = currentUserSettled && currentUserId && !tenantRequest
    ? new Error('Trusted tenant selection is unavailable')
    : null;
  const scopeError = tenantContextSettled && !exactSelectedScope
    ? new Error('Patient chart route scope failed integrity validation')
    : null;
  const error = currentUserQuery.error
    || tenantContextQuery.error
    || identityError
    || authorityError
    || scopeError;
  const isFetching = currentUserQuery.isFetching || tenantContextQuery.isFetching;
  const isPaused = currentUserQuery.isPaused || tenantContextQuery.isPaused;
  const isSuccess = Boolean(
    enabled
    && currentUserSettled
    && currentUserId
    && tenantContextSettled
    && exactSelectedScope
    && !error
    && !isFetching
    && !isPaused
  );

  // A settled identity transition invalidates every implicit route authority
  // namespace owned by the previous authenticated subject.
  useEffect(() => {
    if (!currentUserSettled || !currentUserId) return;
    queryClient.removeQueries({
      predicate: (query) => isPatientDetailsTenantQuery(query)
        && query.queryKey[2] !== currentUserId,
    });
  }, [currentUserId, currentUserSettled, queryClient]);

  // If the subject itself cannot be revalidated, retain no implicit route
  // authority for another consumer to reuse.
  useEffect(() => {
    if (!currentUserQuery.error || currentUserQuery.isFetching) return;
    queryClient.removeQueries({ predicate: isPatientDetailsTenantQuery });
  }, [currentUserQuery.error, currentUserQuery.isFetching, queryClient]);

  return {
    agencyId: isSuccess ? exactSelectedScope.agencyId : null,
    error: error || null,
    status: error ? 'error' : isSuccess ? 'success' : 'pending',
    isError: Boolean(error),
    isSuccess,
    isPending: !error && !isSuccess,
    isFetching,
    isPaused,
  };
}

export default usePatientDetailsRouteScope;
