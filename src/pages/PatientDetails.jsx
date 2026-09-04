import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, Users } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { logActivity, ActivityActions } from '@/components/utils/activityLogger';
import { listAuthorizedVisits } from '@/functions/listAuthorizedVisits';
import { useAuthorizedPatient } from '@/hooks/useAuthorizedPatient';
import { usePatientDetailsRouteScope } from '@/hooks/usePatientDetailsRouteScope';
import {
  createPatientDetailsRouteHref,
  isExactPatientDetailsRouteIdentifier,
} from '@/lib/patientDetailsRoute';

const VISIT_PAGE_SIZE = 50;
const MAX_AUTHORIZED_VISITS = 5000;
const AUTHORITY_FIELDS = Object.freeze([
  'agency_id',
  'membership_id',
  'membership_version',
  'tenant_role',
  'patient_id',
  'access_basis',
  'assignment_id',
  'assignment_version',
]);

function authorityFingerprint(scope) {
  return AUTHORITY_FIELDS.map((field) => JSON.stringify(scope?.[field] ?? null)).join(':');
}

function sameAuthority(left, right) {
  return AUTHORITY_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function sameTenantScope(scope, tenantScope, patientId) {
  return !!scope
    && !!tenantScope
    && scope.agency_id === tenantScope.agency_id
    && scope.membership_id === tenantScope.membership_id
    && scope.membership_version === tenantScope.membership_version
    && scope.tenant_role === tenantScope.tenant_role
    && scope.patient_id === patientId;
}

/**
 * Re-authorize every immutable-id Visit page and discard the row projections.
 * PatientDetails cannot retain or render Visit PHI until the rest of the chart
 * has purpose-bound read brokers. Only the verified authority summary reaches
 * React Query's short-lived cache.
 */
export async function authorizeVisitSchedule({ agencyId, patientId, tenantScope }) {
  let cursor = null;
  let scope = null;
  let authorizedCount = 0;
  const seenVisitIds = new Set();

  while (true) {
    const result = await listAuthorizedVisits({
      agencyId,
      patientId,
      purpose: 'schedule',
      status: null,
      sort: 'id_asc',
      pageSize: VISIT_PAGE_SIZE,
      cursor,
    });

    if (!sameTenantScope(result.scope, tenantScope, patientId)) {
      throw new Error('Patient and Visit tenant authority do not match');
    }
    if (scope !== null && !sameAuthority(scope, result.scope)) {
      throw new Error('Visit authority changed during chart authorization');
    }
    scope = result.scope;

    for (const visit of result.visits) {
      if (visit.patient_id !== patientId) {
        throw new Error('Visit authorization returned a row for another patient');
      }
      if (seenVisitIds.has(visit.id)) {
        throw new Error('Visit authorization returned a duplicate keyset row');
      }
      seenVisitIds.add(visit.id);
      authorizedCount += 1;
      if (authorizedCount > MAX_AUTHORIZED_VISITS) {
        throw new Error('Visit authorization exceeds the reviewed chart limit');
      }
    }

    if (result.page.has_more && authorizedCount >= MAX_AUTHORIZED_VISITS) {
      throw new Error('Visit authorization exceeds the reviewed chart limit');
    }
    if (!result.page.has_more) break;
    cursor = result.page.next_cursor;
  }

  return {
    authorizedCount,
    authorityFingerprint: authorityFingerprint(scope),
  };
}

function AccessMessage({ title, children }) {
  const navigate = useNavigate();
  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        eyebrow="Patient Care"
        title="Patient details"
        description="Purpose-bound chart access"
        favoritePage="PatientDetails"
      />
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden="true" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600">
          <p>{children}</p>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Go back
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

export default function PatientDetails() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const patientId = searchParams.get('id') || searchParams.get('patientId');
  const agencyId = searchParams.get('agencyId') || searchParams.get('agency_id');
  const agencyParamPresent = searchParams.has('agencyId') || searchParams.has('agency_id');
  const patientIdIsExact = isExactPatientDetailsRouteIdentifier(patientId);
  const routeScopeEnabled = patientIdIsExact && !agencyParamPresent;
  const routeIsExact = Boolean(patientId && agencyId);
  const auditedAuthorization = useRef(null);

  const routeScope = usePatientDetailsRouteScope({ enabled: routeScopeEnabled });

  const patientQuery = useAuthorizedPatient({
    patientId,
    agencyId,
    purpose: 'display',
    enabled: routeIsExact,
  });

  const visitAuthorizationQuery = useQuery({
    queryKey: [
      'patient-details',
      'visit-authorization',
      patientId,
      patientQuery.tenantScope?.user_id ?? null,
      patientQuery.tenantScope?.agency_id ?? null,
      patientQuery.tenantScope?.membership_id ?? null,
      patientQuery.tenantScope?.membership_version ?? null,
      patientQuery.tenantScope?.tenant_role ?? null,
    ],
    queryFn: () => authorizeVisitSchedule({
      agencyId,
      patientId,
      tenantScope: patientQuery.tenantScope,
    }),
    enabled: routeIsExact
      && patientQuery.isSuccess
      && !!patientQuery.tenantScope,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  const authorizationSettled = Boolean(
    patientQuery.isSuccess
    && patientQuery.isFetchedAfterMount
    && patientQuery.fetchStatus === 'idle'
    && !patientQuery.error
    && visitAuthorizationQuery.isSuccess
    && visitAuthorizationQuery.isFetchedAfterMount
    && visitAuthorizationQuery.fetchStatus === 'idle'
    && !visitAuthorizationQuery.error
  );

  // Normalize a safe server-resolved singleton membership into an explicit
  // route before either PHI read can start. On the subsequent router render,
  // routeIsExact becomes true and both purpose-bound brokers re-authorize the
  // explicit patient + agency pair from scratch.
  useEffect(() => {
    if (!routeScopeEnabled || !routeScope.isSuccess || !routeScope.agencyId) return;
    const destination = createPatientDetailsRouteHref(patientId, routeScope.agencyId);
    if (!destination) return;
    navigate(destination, { replace: true });
  }, [
    navigate,
    patientId,
    routeScope.agencyId,
    routeScope.isSuccess,
    routeScopeEnabled,
  ]);

  useEffect(() => {
    if (!authorizationSettled) return;
    const auditKey = [
      patientQuery.tenantScope.user_id,
      agencyId,
      patientId,
      visitAuthorizationQuery.data.authorityFingerprint,
    ].join(':');
    if (auditedAuthorization.current === auditKey) return;
    auditedAuthorization.current = auditKey;

    void logActivity(ActivityActions.VIEW, {
      entity_type: 'Patient',
      entity_id: patientId,
      agency_id: agencyId,
      page: 'PatientDetails',
      access_boundary: 'patient_and_visit_read_brokers',
    });
  }, [
    agencyId,
    authorizationSettled,
    patientId,
    patientQuery.tenantScope,
    visitAuthorizationQuery.data,
  ]);

  if (!routeIsExact) {
    if (routeScopeEnabled && !routeScope.isError) {
      return (
        <AccessMessage title="Verifying chart access">
          Current tenant authority is being checked before any patient data is requested.
        </AccessMessage>
      );
    }
    return (
      <AccessMessage title="Chart context required">
        Open this chart from an agency-scoped patient list. No patient data was requested.
      </AccessMessage>
    );
  }

  if (patientQuery.isError || visitAuthorizationQuery.isError) {
    return (
      <AccessMessage title="Patient details unavailable">
        This chart cannot be opened with the current agency and care-team authority.
      </AccessMessage>
    );
  }

  if (!authorizationSettled) {
    return (
      <AccessMessage title="Verifying chart access">
        Patient and visit authorization are being checked against current tenant authority.
      </AccessMessage>
    );
  }

  return (
    <AccessMessage title="Patient details temporarily unavailable">
      Current Patient and Visit authority was verified. The chart remains hidden until every
      related clinical panel has its own purpose-bound tenant read service.
    </AccessMessage>
  );
}
