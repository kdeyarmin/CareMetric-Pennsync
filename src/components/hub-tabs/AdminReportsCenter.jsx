import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { agencyQueryKey } from '@/lib/agencyRoster';
import { getTrustedTenantContext } from '@/lib/roles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, BarChart3, Gauge, Brain, FileText } from "lucide-react";
import ReportsCenter from "@/components/admin/ReportsCenter";
import QualityMetricsDashboard from "@/components/admin/QualityMetricsDashboard";
import AIKPIReportGenerator from "@/components/admin/AIKPIReportGenerator";
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';

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

/**
 * Reports Center — a single home for the agency admin's reporting surface.
 * Consolidates the standalone report builders that previously had no entry
 * point: the comprehensive Reports Center, quality metrics, AI-generated KPI
 * reports, and documentation note-conversion analytics.
 */
export default function AdminReportsCenterPage() {
  const [activeTab, setActiveTab] = useState('reports');
  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    ...FRESH_QUERY_OPTIONS,
  });
  const currentUserAvailable = settledSuccessfullyAfterMount(currentUserQuery);
  const currentUser = currentUserAvailable ? currentUserQuery.data : null;
  const auxiliaryTenantScope = currentUserAvailable
    ? getTrustedTenantContext(currentUser)
    : null;


  // ReportsCenter expects roster/clinical data as props (it filters them
  // directly), so establish the broker authority before any auxiliary read.
  const patientQuery = useScopedPatients({
    purpose: 'roster',
    sort: '-updated_date',
    limit: 1000,
    enabled: currentUserAvailable && activeTab === 'reports',
  });
  const visitQuery = useAuthorizedVisits({
    purpose: 'reporting',
    sort: '-created_date',
    limit: 1000,
    // The quality and KPI tabs own their own purpose-limited Visit queries.
    // Avoid a second agency-wide scan while one of those tabs is active.
    enabled: currentUserAvailable && activeTab === 'reports',
  });
  const tenantScopesMismatch = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !sameAuthorizedTenantScope(patientQuery.tenantScope, visitQuery.tenantScope);
  const primaryAuthorized = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !tenantScopesMismatch;
  const auxiliaryAuthorityMatches = primaryAuthorized
    && sameAuthorizedTenantScope(auxiliaryTenantScope, patientQuery.tenantScope);
  const reportAuthorityKey = primaryAuthorized
    ? tenantScopeKey(patientQuery.tenantScope)
    : null;

  const usersQuery = useQuery({
    queryKey: ["reports-users", reportAuthorityKey, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list("-created_date", 1000);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: Boolean(reportAuthorityKey && auxiliaryAuthorityMatches),
    ...FRESH_QUERY_OPTIONS,
  });
  const incidentsQuery = useAgencyScopedQuery({
    queryKey: ["reports-incidents", reportAuthorityKey],
    fetch: () => base44.entities.Incident.list("-created_date", 1000),
    enabled: Boolean(reportAuthorityKey && auxiliaryAuthorityMatches),
    ...FRESH_QUERY_OPTIONS,
  });
  const auxiliaryAvailable = auxiliaryAuthorityMatches
    && settledSuccessfullyAfterMount(usersQuery)
    && settledSuccessfullyAfterMount(incidentsQuery);
  const reportsSnapshot = useMemo(() => (
    primaryAuthorized && auxiliaryAvailable
      ? {
        authorityKey: reportAuthorityKey,
        auxiliaryTenantScope,
        patientTenantScope: patientQuery.tenantScope,
        visitTenantScope: visitQuery.tenantScope,
        users: usersQuery.data,
        patients: patientQuery.data,
        visits: visitQuery.data,
        incidents: incidentsQuery.data,
      }
      : null
  ), [
    auxiliaryAvailable,
    auxiliaryTenantScope,
    incidentsQuery.data,
    patientQuery.data,
    patientQuery.tenantScope,
    primaryAuthorized,
    reportAuthorityKey,
    usersQuery.data,
    visitQuery.data,
    visitQuery.tenantScope,
  ]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="reports" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BarChart3 className="h-4 w-4 mr-2" />
              Report Builder
            </TabsTrigger>
            <TabsTrigger value="quality" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Gauge className="h-4 w-4 mr-2" />
              Quality Metrics
            </TabsTrigger>
            <TabsTrigger value="kpi" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Brain className="h-4 w-4 mr-2" />
              AI KPI Reports
            </TabsTrigger>
            <TabsTrigger value="notes" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileText className="h-4 w-4 mr-2" />
              Note Analytics
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="reports">
          {reportsSnapshot ? (
            <ReportsCenter
              key={reportsSnapshot.authorityKey}
              authorityKey={reportsSnapshot.authorityKey}
              users={reportsSnapshot.users}
              patients={reportsSnapshot.patients}
              visits={reportsSnapshot.visits}
              incidents={reportsSnapshot.incidents}
            />
          ) : (
            <Alert className="border-amber-300 bg-amber-50" role="status">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-950">
                {visitQuery.isError || patientQuery.isError || tenantScopesMismatch
                  ? 'Report Builder is unavailable because matching Patient and Visit access could not be verified. Platform owners remain blocked until a reviewed agency selector is available.'
                  : usersQuery.isError || incidentsQuery.isError
                    ? 'Report Builder is unavailable because the tenant-scoped staff or incident source could not be verified. Metrics, previews, and exports are withheld.'
                    : 'Reverifying matching Patient, Visit, staff, and incident access before loading report metrics and export controls…'}
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
        <TabsContent value="quality">
          <QualityMetricsDashboard />
        </TabsContent>
        <TabsContent value="kpi">
          <AIKPIReportGenerator />
        </TabsContent>
        <TabsContent value="notes">
          <Alert className="border-amber-300 bg-amber-50" role="status">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-950">
              Note analytics are unavailable until NoteConversion has a tenant-bound
              reporting projection. The platform-wide administrator read is not used
              for agency metrics or exports.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
    </div>
  );
}
