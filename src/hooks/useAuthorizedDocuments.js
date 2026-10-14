import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getTrustedTenantContext } from '@/lib/roles';
import { listAuthorizedDocuments } from '@/functions/listAuthorizedDocuments';
import {
  tenantContextMatchesRequest,
  trustedTenantRequest,
} from '@/lib/trustedTenantRequest';

const MAX_IDENTIFIER_LENGTH = 200;
const DOCUMENT_PAGE_SIZE = 10;
export const MAX_AUTHORIZED_DOCUMENTS = 500;
const LIST_PURPOSES = new Set(['library', 'signature_queue']);
const BINDING_PURPOSES = new Set(['patient_document', 'referral']);
const AUTH_REFRESH_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: 'always',
  refetchOnReconnect: 'always',
  refetchOnWindowFocus: 'always',
});

// The documents list is served by a deliberately expensive broker (three
// authority re-derivations plus list reads per invocation), so it cannot
// refetch on every UI event the way the identity query above does: with
// AUTH_REFRESH_OPTIONS, every mount, window focus, reconnect, and tab
// return is a full broker invocation — and under platform throttling each
// one fails visibly while amplifying the pressure that caused the failure.
// Give the list the app-standard staleness contract instead (the global
// QueryClient defaults in src/lib/query-client.js): cached rows are
// served inside the stale window, tab switches no longer destroy the
// query, and refetches happen when data is stale or the query is
// invalidated — DocumentUploader invalidates ['documents'] on upload.
// retry stays false: the broker's 503 already carries Retry-After, and a
// failed fetch surfaces the existing error state until the next natural
// refetch or invalidation.
const DOCUMENTS_QUERY_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 60_000,
  gcTime: 300_000,
  refetchOnMount: true,
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
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

function settledDocumentsList(query) {
  // Companion to DOCUMENTS_QUERY_OPTIONS: a warm remount serves the list
  // from cache with no fetch after this mount, so the fetched-after-mount
  // test above can never settle for it and the cached rows would stay
  // masked behind a permanent loading state. Settle instead on a fetch
  // having completed into this exact query key: the key embeds the full
  // scope tuple (user, agency, membership, version, role), the purge
  // effects below evict any same-user query whose key disagrees with the
  // scope this mount validated, and the composite gate still requires
  // this mount's identity and scope validation before rows are exposed.
  // A never-fetched query (initialData leaves dataUpdatedAt at 0), an
  // errored query, and one with a fetch in flight stay unsettled — the
  // same states the after-mount test masks.
  return query.isSuccess
    && query.dataUpdatedAt > 0
    && query.fetchStatus === 'idle'
    && !query.error;
}

function exactTenantScope(context, currentUserId, requestedAgencyId) {
  if (
    !context
    || typeof context !== 'object'
    || Array.isArray(context)
    || !exactIdentifier(currentUserId)
    || context.user_id !== currentUserId
    || !exactIdentifier(context.agency_id)
    || (requestedAgencyId !== null && context.agency_id !== requestedAgencyId)
    || typeof context.tenant_role !== 'string'
    || context.tenant_role.length === 0
  ) return null;

  if (context.tenant_role === 'platform_owner') {
    if (context.membership_id !== null || context.membership_version !== null) return null;
  } else if (
    !exactIdentifier(context.membership_id)
    || !Number.isSafeInteger(context.membership_version)
    || context.membership_version < 1
  ) return null;

  return {
    user_id: context.user_id,
    agency_id: context.agency_id,
    membership_id: context.membership_id,
    membership_version: context.membership_version,
    tenant_role: context.tenant_role,
  };
}

function sameScope(scope, tenantScope, patientId) {
  return !!scope
    && scope.agency_id === tenantScope.agency_id
    && scope.patient_id === patientId
    && scope.membership_id === tenantScope.membership_id
    && scope.membership_version === tenantScope.membership_version
    && scope.tenant_role === tenantScope.tenant_role;
}

function inputError({ agencyId, patientId, purpose, bindingPurpose }) {
  if (agencyId !== null && !exactIdentifier(agencyId)) return 'agencyId is invalid';
  if (patientId !== null && !exactIdentifier(patientId)) return 'patientId is invalid';
  if (!LIST_PURPOSES.has(purpose)) return 'purpose is invalid';
  if (bindingPurpose !== null && !BINDING_PURPOSES.has(bindingPurpose)) {
    return 'bindingPurpose is invalid';
  }
  return null;
}

function compareNewest(left, right) {
  const dateOrder = Date.parse(right.updated_date) - Date.parse(left.updated_date);
  return dateOrder || String(right.id).localeCompare(String(left.id));
}

export async function loadAuthorizedDocumentPages({
  tenantScope,
  patientId = null,
  purpose = 'library',
  bindingPurpose = null,
}) {
  const documents = [];
  const seenIds = new Set();
  let cursor = null;

  while (true) {
    const result = await listAuthorizedDocuments({
      agencyId: tenantScope.agency_id,
      purpose,
      patientId,
      bindingPurpose,
      sort: 'document_id_asc',
      pageSize: DOCUMENT_PAGE_SIZE,
      cursor,
    });
    if (!sameScope(result.scope, tenantScope, patientId)) {
      throw new Error('Document authorization scope changed during listing');
    }
    for (const document of result.documents) {
      if (seenIds.has(document.id)) {
        throw new Error('Document authorization returned a duplicate keyset row');
      }
      seenIds.add(document.id);
      documents.push(document);
      if (documents.length > MAX_AUTHORIZED_DOCUMENTS) {
        throw new Error('Document list exceeds the reviewed UI limit');
      }
    }

    if (!result.page.has_more) break;
    if (documents.length >= MAX_AUTHORIZED_DOCUMENTS) {
      throw new Error('Document list exceeds the reviewed UI limit');
    }
    cursor = result.page.next_cursor;
  }

  return documents.sort(compareNewest);
}

export function authorizedDocumentsQueryKey({ patientId, purpose, bindingPurpose, scope }) {
  return [
    'documents',
    'authorized-list',
    purpose,
    patientId,
    bindingPurpose,
    scope?.user_id || null,
    scope?.agency_id || null,
    scope?.membership_id ?? null,
    scope?.membership_version ?? null,
    scope?.tenant_role || null,
  ];
}

function isAuthorizedDocumentsQuery(query) {
  const key = query?.queryKey;
  return Array.isArray(key) && key[0] === 'documents' && key[1] === 'authorized-list';
}

/**
 * Read binding-backed Document metadata through the finite server broker.
 *
 * Cached rows are hidden while identity, membership, or the list itself is
 * revalidated. A singleton tenant may be resolved server-side; callers with
 * multiple memberships and platform owners must provide an explicit agency.
 * There is no direct Document entity fallback.
 *
 * Tenant scope derives from the context AuthContext bound once at login
 * (src/lib/roles.js), validated locally by the same exact-match checks a
 * freshly fetched context passed through. This hook deliberately does not
 * re-invoke getMyTenantContext on mount/focus: that heavyweight call is the
 * one the platform throttles into HTTP 503s, and the broker revalidates
 * authority server-side on every list regardless.
 */
export function useAuthorizedDocuments({
  agencyId,
  patientId = null,
  purpose = 'library',
  bindingPurpose = null,
  enabled = true,
} = {}) {
  const queryClient = useQueryClient();
  const requestedAgencyId = agencyId === undefined ? null : agencyId;
  const validationError = inputError({
    agencyId: requestedAgencyId,
    patientId,
    purpose,
    bindingPurpose,
  });

  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    enabled: enabled && !validationError,
    ...AUTH_REFRESH_OPTIONS,
  });
  const currentUserSettled = settledSuccessfullyAfterMount(currentUserQuery);
  const currentUserId = exactIdentifier(currentUserQuery.data?.id)
    ? currentUserQuery.data.id
    : null;
  const identityError = currentUserSettled && !currentUserId
    ? 'Authenticated user identity failed integrity validation'
    : null;
  const tenantRequest = useMemo(
    () => trustedTenantRequest(currentUserQuery.data, requestedAgencyId),
    [currentUserQuery.data, requestedAgencyId],
  );
  const authorityError = currentUserSettled && currentUserId && !tenantRequest
    ? 'Requested agency does not match the trusted tenant selection'
    : null;

  // Mirror how the rest of the app obtains tenant scope: read the context
  // AuthContext bound and validated once at login, synchronously, instead of
  // re-invoking getMyTenantContext on every mount/focus. The bound context
  // passes through the same local validation the fresh response did, and no
  // scope exists at all when nothing is bound for this principal.
  const boundTenantContext = useMemo(
    () => (tenantRequest ? getTrustedTenantContext(currentUserQuery.data) : null),
    [currentUserQuery.data, tenantRequest],
  );
  const tenantContextSettled = currentUserSettled && !!tenantRequest;
  const tenantScope = useMemo(() => {
    if (!tenantContextMatchesRequest(boundTenantContext, tenantRequest)) return null;
    return exactTenantScope(boundTenantContext, currentUserId, requestedAgencyId);
  }, [boundTenantContext, currentUserId, requestedAgencyId, tenantRequest]);
  const scopeError = tenantContextSettled && !tenantScope
    ? 'Document tenant authorization scope failed integrity validation'
    : null;

  const documentsQueryKey = useMemo(() => authorizedDocumentsQueryKey({
    patientId,
    purpose,
    bindingPurpose,
    scope: tenantScope,
  }), [bindingPurpose, patientId, purpose, tenantScope]);

  const documentsQuery = useQuery({
    queryKey: documentsQueryKey,
    queryFn: async () => {
      if (validationError) throw new Error(validationError);
      if (identityError) throw new Error(identityError);
      if (authorityError) throw new Error(authorityError);
      if (scopeError || !tenantScope) {
        throw new Error(scopeError || 'Document tenant authorization scope is unavailable');
      }
      return loadAuthorizedDocumentPages({
        tenantScope,
        patientId,
        purpose,
        bindingPurpose,
      });
    },
    enabled: enabled && !!(
      validationError
      || identityError
      || authorityError
      || scopeError
      || (tenantContextSettled && tenantScope)
    ),
    initialData: [],
    initialDataUpdatedAt: 0,
    ...DOCUMENTS_QUERY_OPTIONS,
  });

  const upstreamError = currentUserQuery.error || null;
  const authorizationError = upstreamError || documentsQuery.error || null;
  const isFetching = currentUserQuery.isFetching || documentsQuery.isFetching;
  const isPaused = currentUserQuery.isPaused || documentsQuery.isPaused;

  useEffect(() => {
    if (!currentUserSettled || !currentUserId) return;
    queryClient.removeQueries({
      predicate: (query) => isAuthorizedDocumentsQuery(query)
        && query.queryKey[5] !== currentUserId,
    });
  }, [currentUserId, currentUserSettled, queryClient]);

  useEffect(() => {
    if (!tenantContextSettled || !tenantScope) return;
    queryClient.removeQueries({
      predicate: (query) => {
        if (!isAuthorizedDocumentsQuery(query) || query.queryKey[5] !== currentUserId) {
          return false;
        }
        return query.queryKey[6] !== tenantScope.agency_id
          || query.queryKey[7] !== tenantScope.membership_id
          || query.queryKey[8] !== tenantScope.membership_version
          || query.queryKey[9] !== tenantScope.tenant_role;
      },
    });
  }, [currentUserId, queryClient, tenantContextSettled, tenantScope]);

  useEffect(() => {
    if (
      documentsQuery.isError
      && !documentsQuery.isFetching
      && Array.isArray(documentsQuery.data)
      && documentsQuery.data.length > 0
    ) {
      queryClient.removeQueries({ queryKey: documentsQueryKey, exact: true });
    }
  }, [
    documentsQuery.data,
    documentsQuery.isError,
    documentsQuery.isFetching,
    documentsQueryKey,
    queryClient,
  ]);

  useEffect(() => {
    if (!upstreamError || currentUserQuery.isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedDocumentsQuery });
  }, [currentUserQuery.isFetching, queryClient, upstreamError]);

  const settledSuccessfully = Boolean(
    enabled
    && !validationError
    && currentUserSettled
    && currentUserId
    && tenantContextSettled
    && tenantScope
    && settledDocumentsList(documentsQuery)
  );

  return {
    ...documentsQuery,
    data: settledSuccessfully ? documentsQuery.data : [],
    error: authorizationError,
    status: authorizationError ? 'error' : settledSuccessfully ? 'success' : 'pending',
    isError: Boolean(authorizationError),
    isSuccess: settledSuccessfully,
    isPending: !authorizationError && !settledSuccessfully,
    isFetching,
    isPaused,
    isLoading: enabled && !authorizationError && !settledSuccessfully,
    tenantScope: tenantContextSettled && tenantScope ? tenantScope : null,
  };
}

export default useAuthorizedDocuments;
