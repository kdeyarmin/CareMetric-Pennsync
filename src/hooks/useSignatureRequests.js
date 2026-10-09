import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getTrustedTenantContext } from '@/lib/roles';
import {
  getSignatureSummary,
  listSignatureAuditEvents,
  listSignatureRequests,
} from '@/lib/esignClient';

const FRESH = Object.freeze({
  retry: false,
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
});

export const SIGNATURE_REQUESTER_ROLES = Object.freeze(['agency_admin', 'manager', 'clinician']);
export const SIGNATURE_MANAGER_ROLES = Object.freeze(['agency_admin', 'manager']);

/**
 * The agency every signing call names: the tenant context AuthContext bound
 * after the server validated it. The brokers re-decide membership and chart
 * access on every call, so this only chooses which agency to ask about.
 */
export function useSigningTenant() {
  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const context = getTrustedTenantContext(currentUserQuery.data);
  const tenantRole = typeof context?.tenant_role === 'string' ? context.tenant_role : null;
  return {
    loading: currentUserQuery.isLoading,
    agencyId: typeof context?.agency_id === 'string' ? context.agency_id : null,
    userId: typeof context?.user_id === 'string' ? context.user_id : null,
    tenantRole,
    canRequest: SIGNATURE_REQUESTER_ROLES.includes(tenantRole),
    canManage: SIGNATURE_MANAGER_ROLES.includes(tenantRole) || context?.is_platform_owner === true,
  };
}

export function signatureRequestsKey(agencyId, ...rest) {
  return ['esign', agencyId || null, ...rest];
}

export function useSignatureRequests({ status = 'all', patientId = null, enabled = true } = {}) {
  const tenant = useSigningTenant();
  const query = useQuery({
    queryKey: signatureRequestsKey(tenant.agencyId, 'requests', status, patientId),
    queryFn: () => listSignatureRequests({ agencyId: tenant.agencyId, status, patientId }),
    enabled: enabled && !!tenant.agencyId,
    ...FRESH,
  });
  return { ...query, tenant, requests: query.data?.requests ?? [], truncated: query.data?.truncated === true };
}

export function useSignatureSummary({ enabled = true } = {}) {
  const tenant = useSigningTenant();
  const query = useQuery({
    queryKey: signatureRequestsKey(tenant.agencyId, 'summary'),
    queryFn: () => getSignatureSummary({ agencyId: tenant.agencyId }),
    enabled: enabled && !!tenant.agencyId,
    ...FRESH,
  });
  return { ...query, tenant, summary: query.data?.summary ?? null };
}

export function useSignatureAuditEvents({ enabled = true, limit = 200 } = {}) {
  const tenant = useSigningTenant();
  const query = useQuery({
    queryKey: signatureRequestsKey(tenant.agencyId, 'audit', limit),
    queryFn: () => listSignatureAuditEvents({ agencyId: tenant.agencyId, limit }),
    enabled: enabled && !!tenant.agencyId,
    ...FRESH,
  });
  return { ...query, tenant, events: query.data?.events ?? [] };
}
