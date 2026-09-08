import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getMyTenantContext } from '@/functions/getMyTenantContext';
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

  const tenantContextQuery = useQuery({
    queryKey: [
      'tenant-context',
      'authorized-documents',
      currentUserId,
      requestedAgencyId,
      tenantRequest?.authorityKey || null,
    ],
    queryFn: () => getMyTenantContext(tenantRequest.options),
    enabled: enabled
      && !validationError
      && currentUserSettled
      && !!currentUserId
      && !!tenantRequest,
    ...AUTH_REFRESH_OPTIONS,
  });
  const tenantContextSettled = currentUserSettled
    && settledSuccessfullyAfterMount(tenantContextQuery);
  const tenantScope = useMemo(() => {
    const context = tenantContextQuery.data?.tenant_context;
    if (!tenantContextMatchesRequest(context, tenantRequest)) return null;
    return exactTenantScope(context, currentUserId, requestedAgencyId);
  }, [currentUserId, requestedAgencyId, tenantContextQuery.data?.tenant_context, tenantRequest]);
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
    ...AUTH_REFRESH_OPTIONS,
  });

  const upstreamError = currentUserQuery.error || tenantContextQuery.error || null;
  const authorizationError = upstreamError || documentsQuery.error || null;
  const isFetching = currentUserQuery.isFetching
    || tenantContextQuery.isFetching
    || documentsQuery.isFetching;
  const isPaused = currentUserQuery.isPaused
    || tenantContextQuery.isPaused
    || documentsQuery.isPaused;

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
    if (!upstreamError || currentUserQuery.isFetching || tenantContextQuery.isFetching) return;
    queryClient.removeQueries({ predicate: isAuthorizedDocumentsQuery });
  }, [
    currentUserQuery.isFetching,
    queryClient,
    tenantContextQuery.isFetching,
    upstreamError,
  ]);

  const settledSuccessfully = Boolean(
    enabled
    && !validationError
    && currentUserSettled
    && currentUserId
    && tenantContextSettled
    && tenantScope
    && settledSuccessfullyAfterMount(documentsQuery)
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
