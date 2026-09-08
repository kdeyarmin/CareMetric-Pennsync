import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { describeCallerPatientScope, agencyQueryKey } from '@/lib/agencyRoster';
import { getStaffRole, getTrustedTenantContext } from "@/lib/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, Users, FileText, ClipboardCheck } from "lucide-react";
import { ALL_ROWS } from '@/lib/queryLimits';
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';

const EMPTY_ROWS = Object.freeze([]);
// PersonnelCredential's administrator read is not bound to an immutable agency
// membership. Client-side email intersection is not sufficient authorization.
const CREDENTIAL_METRICS_AVAILABLE = false;
const FRESH_QUERY_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
});

function settledSuccessfullyAfterMount(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error
    && !query.isFetching
    && !query.isPaused;
}

function tenantScopeKey(scope) {
  if (!scope) return null;
  return JSON.stringify([
    scope.user_id,
    scope.agency_id,
    scope.membership_id,
    scope.membership_version,
    scope.tenant_role,
  ]);
}

export default function DataQualityDashboard() {
  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    ...FRESH_QUERY_OPTIONS,
  });
  const currentUserAvailable = settledSuccessfullyAfterMount(currentUserQuery);
  const currentUser = currentUserAvailable ? currentUserQuery.data : null;


  const patientQuery = useScopedPatients({
    purpose: 'data_quality',
    status: 'active',
    sort: null,
    limit: ALL_ROWS,
    enabled: currentUserAvailable,
  });
  const patients = patientQuery.isSuccess ? patientQuery.data : EMPTY_ROWS;

  const visitQuery = useAuthorizedVisits({
    purpose: 'data_quality',
    status: 'completed',
    sort: '-visit_date',
    limit: ALL_ROWS,
    enabled: currentUserAvailable,
  });
  const visits = visitQuery.isSuccess ? visitQuery.data : EMPTY_ROWS;
  const tenantScopesMismatch = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !sameAuthorizedTenantScope(patientQuery.tenantScope, visitQuery.tenantScope);
  const authorizedDataAvailable = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !tenantScopesMismatch;
  const dataQualityAuthorityKey = authorizedDataAvailable
    ? tenantScopeKey(patientQuery.tenantScope)
    : null;
  const auxiliaryTenantScope = currentUserAvailable
    ? getTrustedTenantContext(currentUser)
    : null;
  const auxiliaryAuthorityMatches = authorizedDataAvailable
    && sameAuthorizedTenantScope(auxiliaryTenantScope, patientQuery.tenantScope);

  const usersQuery = useQuery({
    queryKey: ['all-users-quality', dataQualityAuthorityKey, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list('-created_date', ALL_ROWS);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: Boolean(dataQualityAuthorityKey && auxiliaryAuthorityMatches),
    ...FRESH_QUERY_OPTIONS,
  });
  const usersAvailable = auxiliaryAuthorityMatches
    && settledSuccessfullyAfterMount(usersQuery);
  const users = usersAvailable ? usersQuery.data : EMPTY_ROWS;

  // How many charts carry no agency attribution at all. These stay visible on
  // purpose (see src/lib/agencyScope.js), but they are the set a stricter rule
  // would silently hide, so the backlog belongs on the data-quality board rather
  // than buried in the filter. Keyed on the roster size so it recomputes when
  // charts land; the staff roster behind it is memoized app-wide.
  const agencyScopeQuery = useQuery({
    queryKey: [
      'patients', 'attribution', dataQualityAuthorityKey,
      agencyQueryKey(currentUser), patients.length,
    ],
    queryFn: () => describeCallerPatientScope(patients, currentUser),
    enabled: Boolean(dataQualityAuthorityKey && usersAvailable),
    ...FRESH_QUERY_OPTIONS,
  });
  const agencyScopeAvailable = usersAvailable
    && settledSuccessfullyAfterMount(agencyScopeQuery);
  const agencyScope = agencyScopeAvailable ? agencyScopeQuery.data : null;

  const allDataAvailable = authorizedDataAvailable
    && auxiliaryAuthorityMatches
    && usersAvailable
    && agencyScopeAvailable;

  const qualityMetrics = useMemo(() => {
    // Patient data quality
    const patientIssues = patientQuery.isSuccess
      ? patients.filter(p =>
        !p.emergency_contact_name
        || !p.emergency_contact_phone
        || !p.physician_name
        || !p.phone
      )
      : null;

    const patientCompleteness = patientQuery.isSuccess
      ? patients.length > 0
        ? ((patients.length - patientIssues.length) / patients.length * 100).toFixed(1)
        : null
      : null;

    const userIssues = users.filter(u => {
      if (!u.phone || u.phone === '') return true;
      if (getStaffRole(u) === 'nurse') {
        return !u.care_scope || !u.credential_type || u.credential_type === '';
      }
      return false;
    });

    const userCompleteness = users.length > 0
      ? ((users.length - userIssues.length) / users.length * 100).toFixed(1)
      : null;

    // Visit documentation quality
    const visitIssues = visitQuery.isSuccess
      ? visits.filter(v =>
        !v.nurse_notes ||
        v.nurse_notes.length < 100 ||
        !v.vital_signs ||
        !v.homebound_justification
      )
      : null;

    const visitCompleteness = visitQuery.isSuccess
      ? visits.length > 0
        ? ((visits.length - visitIssues.length) / visits.length * 100).toFixed(1)
        : null
      : null;

    return {
      patientIssues,
      patientCompleteness,
      userIssues,
      userCompleteness,
      visitIssues,
      visitCompleteness,
    };
  }, [patients, patientQuery.isSuccess, users, visits, visitQuery.isSuccess]);

  const overallScore = useMemo(() => {
    if (
      qualityMetrics.patientCompleteness === null
      || qualityMetrics.userCompleteness === null
      || qualityMetrics.visitCompleteness === null
      || !allDataAvailable
    ) return null;
    const scores = [
      parseFloat(qualityMetrics.patientCompleteness),
      parseFloat(qualityMetrics.userCompleteness),
      parseFloat(qualityMetrics.visitCompleteness),
    ];
    return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  }, [allDataAvailable, qualityMetrics]);

  if (!allDataAvailable) {
    return (
      <Alert className="border-amber-300 bg-amber-50" role="status">
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <AlertDescription className="text-amber-950">
          {patientQuery.isError || visitQuery.isError || tenantScopesMismatch
            ? 'Data quality metrics are unavailable because Patient or Visit access could not be verified. Platform owners remain blocked until a reviewed agency selector is available.'
            : usersQuery.isError || agencyScopeQuery.isError
              ? 'Data quality metrics are unavailable because a tenant-scoped staff or attribution source could not be verified. No scores or issue counts are shown.'
              : 'Reverifying matching Patient, Visit, staff, and attribution access before loading data quality metrics…'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Data Quality Dashboard</h2>
          <p className="text-sm text-slate-500">Monitor data completeness and compliance</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-500">Verified-source Score</p>
          <p className="text-3xl font-bold text-indigo-600">
            {overallScore === null ? 'Unavailable' : `${overallScore}%`}
          </p>
        </div>
      </div>

      {!CREDENTIAL_METRICS_AVAILABLE && (
        <Alert className="border-amber-300 bg-amber-50" role="status">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-950">
            Credential coverage is unavailable until PersonnelCredential has a
            tenant-bound reporting projection. It is excluded from the verified-source score.
          </AlertDescription>
        </Alert>
      )}

      {overallScore !== null && parseFloat(overallScore) < 90 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Data quality is below recommended threshold. Review critical issues below.
          </AlertDescription>
        </Alert>
      )}

      {agencyScope?.scoped && agencyScope.unattributable > 0 && (
        <Alert className="border-slate-300 bg-slate-50">
          <AlertTriangle className="h-4 w-4 text-slate-600" />
          <AlertDescription className="text-slate-800">
            <span className="font-semibold">
              {agencyScope.unattributable} of {agencyScope.total} charts have no agency attribution.
            </span>{' '}
            They were created by an importer or service account, or by a user who is
            no longer on the roster, so nothing ties them to an agency. They stay
            visible here — hiding them would remove active charts from clinical
            views — but they are not covered by agency scoping until an agency is
            recorded on the record itself.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Patient Records</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            {qualityMetrics.patientCompleteness === null ? (
              <p className="text-sm font-semibold text-amber-800">No patient denominator</p>
            ) : (
              <>
                <div className="text-2xl font-bold">{qualityMetrics.patientCompleteness}%</div>
                <Progress value={parseFloat(qualityMetrics.patientCompleteness)} className="mt-2" />
                <p className="text-xs text-slate-500 mt-2">
                  {qualityMetrics.patientIssues.length} records missing critical data
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">User Profiles</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            {qualityMetrics.userCompleteness === null ? (
              <p className="text-sm font-semibold text-amber-800">No user denominator</p>
            ) : (
              <>
                <div className="text-2xl font-bold">{qualityMetrics.userCompleteness}%</div>
                <Progress value={parseFloat(qualityMetrics.userCompleteness)} className="mt-2" />
                <p className="text-xs text-slate-500 mt-2">
                  {qualityMetrics.userIssues.length} profiles incomplete
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Visit Documentation</CardTitle>
            <FileText className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            {qualityMetrics.visitCompleteness === null ? (
              <p className="text-sm font-semibold text-amber-800">No completed-visit denominator</p>
            ) : (
              <>
                <div className="text-2xl font-bold">{qualityMetrics.visitCompleteness}%</div>
                <Progress value={parseFloat(qualityMetrics.visitCompleteness)} className="mt-2" />
                <p className="text-xs text-slate-500 mt-2">
                  {qualityMetrics.visitIssues.length} visits need improvement
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Credential Tracking</CardTitle>
            <ClipboardCheck className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <p className="text-sm font-semibold text-amber-800">Unavailable</p>
            <p className="text-xs text-slate-500 mt-2">
              Tenant-bound credential projection required
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Patient Record Issues</CardTitle>
          </CardHeader>
          <CardContent>
            {patients.length === 0 ? (
              <p className="text-sm text-amber-800">
                No active patient records are available for completeness scoring.
              </p>
            ) : qualityMetrics.patientIssues.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span>All patient records complete</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {qualityMetrics.patientIssues.slice(0, 10).map(patient => (
                  <div key={patient.id} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                    <span className="text-sm font-medium">{patient.first_name} {patient.last_name}</span>
                    <Badge variant="outline" className="text-xs">
                      Missing: {[
                        !patient.emergency_contact_name && 'Emergency Contact',
                        !patient.emergency_contact_phone && 'Emergency Phone',
                        !patient.physician_name && 'Physician',
                        !patient.phone && 'Phone'
                      ].filter(Boolean).join(', ')}
                    </Badge>
                  </div>
                ))}
                {qualityMetrics.patientIssues.length > 10 && (
                  <p className="text-xs text-slate-500 text-center pt-2">
                    +{qualityMetrics.patientIssues.length - 10} more patients
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">User Profile Issues</CardTitle>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-amber-800">
                No agency user profiles are available for completeness scoring.
              </p>
            ) : qualityMetrics.userIssues.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span>All user profiles complete</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {qualityMetrics.userIssues.slice(0, 10).map(user => (
                  <div key={user.email} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                    <span className="text-sm font-medium">{user.full_name}</span>
                    <Badge variant="outline" className="text-xs">
                      Missing: {[
                        (!user.phone || user.phone === '') && 'Phone',
                        getStaffRole(user) === 'nurse' && !user.care_scope && 'Care Scope',
                        getStaffRole(user) === 'nurse' && (!user.credential_type || user.credential_type === '') && 'Credential'
                      ].filter(Boolean).join(', ')}
                    </Badge>
                  </div>
                ))}
                {qualityMetrics.userIssues.length > 10 && (
                  <p className="text-xs text-slate-500 text-center pt-2">
                    +{qualityMetrics.userIssues.length - 10} more users
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
