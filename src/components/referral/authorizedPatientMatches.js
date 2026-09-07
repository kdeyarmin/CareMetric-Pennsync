import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listAuthorizedPatients } from '@/functions/listAuthorizedPatients';

const MAX_IDENTIFIER_LENGTH = 200;
const PATIENT_ID_BATCH_SIZE = 25;
const IDENTITY_PAGE_SIZE = 25;
const IDENTITY_ROSTER_LIMIT = 10_000;
const MATCH_PATIENT_LIMIT = 100;
const MATCH_PURPOSES = Object.freeze(['identity_match', 'roster']);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function exactTenantScope(tenantContext) {
  if (
    !tenantContext
    || typeof tenantContext !== 'object'
    || Array.isArray(tenantContext)
    || !exactIdentifier(tenantContext.user_id)
    || !exactIdentifier(tenantContext.agency_id)
    || typeof tenantContext.tenant_role !== 'string'
    || tenantContext.tenant_role.length === 0
  ) {
    throw new Error('Referral patient tenant authorization is unavailable');
  }

  if (tenantContext.tenant_role === 'platform_owner') {
    if (tenantContext.membership_id !== null || tenantContext.membership_version !== null) {
      throw new Error('Referral patient tenant authorization is invalid');
    }
  } else if (
    !exactIdentifier(tenantContext.membership_id)
    || !Number.isSafeInteger(tenantContext.membership_version)
    || tenantContext.membership_version < 1
  ) {
    throw new Error('Referral patient tenant authorization is invalid');
  }

  return {
    user_id: tenantContext.user_id,
    agency_id: tenantContext.agency_id,
    membership_id: tenantContext.membership_id,
    membership_version: tenantContext.membership_version,
    tenant_role: tenantContext.tenant_role,
  };
}

function sameTenantScope(scope, tenantScope) {
  return !!scope
    && scope.agency_id === tenantScope.agency_id
    && scope.membership_id === tenantScope.membership_id
    && scope.membership_version === tenantScope.membership_version
    && scope.tenant_role === tenantScope.tenant_role;
}

function requireSameTenantScope(result, tenantScope) {
  if (!sameTenantScope(result?.scope, tenantScope)) {
    throw new Error('Referral patient authorization scope changed during lookup');
  }
}

function uniquePatientIds(patientIds) {
  if (!Array.isArray(patientIds)) {
    throw new Error('Referral patientIds must be an array');
  }
  if (patientIds.some((patientId) => !exactIdentifier(patientId))) {
    throw new Error('Referral patientIds are invalid');
  }

  const unique = [...new Set(patientIds)];
  if (unique.length > MATCH_PATIENT_LIMIT) {
    throw new Error('Referral patient match list exceeds the reviewed limit');
  }
  return unique;
}

async function fetchPatientIdBatches({ tenantScope, patientIds, purpose }) {
  const patients = [];
  for (let index = 0; index < patientIds.length; index += PATIENT_ID_BATCH_SIZE) {
    const batch = patientIds.slice(index, index + PATIENT_ID_BATCH_SIZE);
    const result = await listAuthorizedPatients({
      agencyId: tenantScope.agency_id,
      mode: 'ids',
      purpose,
      patientIds: batch,
    });
    requireSameTenantScope(result, tenantScope);
    patients.push(...result.patients);
  }
  return patients;
}

/**
 * Load the complete, purpose-limited identity roster used by referral matching.
 * Every keyset page must retain the exact authority selected in AuthContext.
 */
export async function listAuthorizedReferralIdentityRoster({ tenantContext } = {}) {
  const tenantScope = exactTenantScope(tenantContext);
  const patients = [];
  const seenPatientIds = new Set();
  let cursor = null;

  while (true) {
    const result = await listAuthorizedPatients({
      agencyId: tenantScope.agency_id,
      mode: 'page',
      purpose: 'identity_match',
      sort: 'id_asc',
      pageSize: IDENTITY_PAGE_SIZE,
      cursor,
    });
    requireSameTenantScope(result, tenantScope);

    // Check before accepting the page and before honoring has_more=false. A
    // short final page can still take the accumulated roster over the reviewed
    // 10,000-row boundary and must fail closed instead of being returned.
    if (patients.length + result.patients.length > IDENTITY_ROSTER_LIMIT) {
      throw new Error('Referral patient identity roster exceeds the reviewed limit');
    }

    for (const patient of result.patients) {
      if (seenPatientIds.has(patient.id)) {
        throw new Error('Referral patient identity roster returned a duplicate row');
      }
      seenPatientIds.add(patient.id);
      patients.push(patient);
    }

    if (!result.page.has_more) return patients;
    if (patients.length >= IDENTITY_ROSTER_LIMIT) {
      throw new Error('Referral patient identity roster exceeds the reviewed limit');
    }
    cursor = result.page.next_cursor;
  }
}

/**
 * Resolve suggested patient ids through both least-privilege projections.
 * Only records authorized by both reads are returned: identity details support
 * human comparison and the roster projection supplies reviewed display/version
 * fields used when an intake match is rechecked immediately before linking.
 */
export async function resolveAuthorizedReferralPatients({
  tenantContext,
  patientIds,
} = {}) {
  const uniqueIds = uniquePatientIds(patientIds);
  if (uniqueIds.length === 0) return [];

  const tenantScope = exactTenantScope(tenantContext);
  const [identityPatients, rosterPatients] = await Promise.all(
    MATCH_PURPOSES.map((purpose) => fetchPatientIdBatches({
      tenantScope,
      patientIds: uniqueIds,
      purpose,
    })),
  );
  const identityById = new Map(identityPatients.map((patient) => [patient.id, patient]));
  const rosterById = new Map(rosterPatients.map((patient) => [patient.id, patient]));

  return uniqueIds.flatMap((patientId) => {
    const identityPatient = identityById.get(patientId);
    const rosterPatient = rosterById.get(patientId);
    // Keep overlapping fields (especially medical_record_number) from the
    // roster projection that also supplies updated_date. If the two concurrent
    // purpose reads straddle another Patient update, pairing an older identity
    // MRN with the newer roster version could otherwise authorize intake to
    // overwrite that concurrent MRN change.
    return identityPatient && rosterPatient
      ? [{ ...identityPatient, ...rosterPatient }]
      : [];
  });
}

function tenantScopeKey(tenantContext) {
  try {
    const tenantScope = exactTenantScope(tenantContext);
    return [
      tenantScope.user_id,
      tenantScope.agency_id,
      tenantScope.membership_id,
      tenantScope.membership_version,
      tenantScope.tenant_role,
    ];
  } catch {
    return [null, null, null, null, null];
  }
}

function settledSuccessfullyAfterMount(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error;
}

/**
 * Fresh-authority query for referral match cards. Cached PHI is withheld until
 * the current mount completes an exact-scope broker lookup, and is purged if a
 * later authorization refresh fails.
 */
export function useAuthorizedReferralPatients({
  tenantContext,
  patientIds,
  enabled = true,
} = {}) {
  const queryClient = useQueryClient();
  const patientIdsSnapshot = Array.isArray(patientIds) ? JSON.stringify(patientIds) : null;
  const stablePatientIds = useMemo(
    () => (patientIdsSnapshot === null ? null : JSON.parse(patientIdsSnapshot)),
    [patientIdsSnapshot],
  );
  const authorityKey = useMemo(() => tenantScopeKey(tenantContext), [tenantContext]);
  const queryKey = useMemo(() => [
    'patients',
    'authorized-referral-matches',
    stablePatientIds,
    ...authorityKey,
  ], [authorityKey, stablePatientIds]);
  const shouldFetch = enabled
    && Array.isArray(stablePatientIds)
    && stablePatientIds.length > 0;

  const query = useQuery({
    queryKey,
    queryFn: () => resolveAuthorizedReferralPatients({
      tenantContext,
      patientIds: stablePatientIds,
    }),
    enabled: shouldFetch,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  useEffect(() => {
    if (query.isError && !query.isFetching && query.data !== undefined) {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  }, [query.data, query.isError, query.isFetching, queryClient, queryKey]);

  const isFreshSuccess = shouldFetch && settledSuccessfullyAfterMount(query);
  return {
    ...query,
    data: isFreshSuccess ? query.data : [],
    isSuccess: !shouldFetch || isFreshSuccess,
    isPending: shouldFetch && !query.isError && !isFreshSuccess,
    isLoading: shouldFetch
      && (query.isFetching || query.isPaused || !isFreshSuccess)
      && !query.isError,
  };
}
