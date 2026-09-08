import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { agencyQueryKey } from '@/lib/agencyRoster';
import { getTrustedTenantContext, isAdminView } from "@/lib/roles";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  TrendingUp,
  Clock,
  FileText,
  Download,
  AlertCircle,
  BarChart3
} from "lucide-react";
import { calculateStats, calculateNurseStats, formatCurrency } from "../components/utils/statsCalculator";
import { toast } from "sonner";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';

const EMPTY_ROWS = Object.freeze([]);
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

export default function AgencyAnalytics() {
  // Admin-only page: agency-wide performance rankings and revenue/cost figures
  // must not render for clinical staff (server-side RLS remains the primary
  // control; this is the same defense-in-depth gate as AnalyticsDashboard).
  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    ...FRESH_QUERY_OPTIONS,
  });
  const currentUserAvailable = settledSuccessfullyAfterMount(currentUserQuery);
  const currentUser = currentUserAvailable ? currentUserQuery.data : null;
  const isAdmin = isAdminView(currentUser);

  // Fetch all necessary data
  const visitQuery = useAuthorizedVisits({
    purpose: 'operations_analytics',
    sort: '-created_date',
    limit: 1000,
    enabled: isAdmin,
  });
  const visits = visitQuery.isSuccess ? visitQuery.data : EMPTY_ROWS;

  const patientQuery = useScopedPatients({ purpose: 'roster', sort: '-updated_date', limit: 5000, enabled: isAdmin });
  const allPatients = patientQuery.isSuccess ? patientQuery.data : EMPTY_ROWS;
  const tenantScopesMismatch = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !sameAuthorizedTenantScope(patientQuery.tenantScope, visitQuery.tenantScope);
  const primaryAuthorized = visitQuery.isSuccess
    && patientQuery.isSuccess
    && !tenantScopesMismatch;
  const analyticsAuthorityKey = primaryAuthorized
    ? tenantScopeKey(patientQuery.tenantScope)
    : null;
  const auxiliaryTenantScope = currentUserAvailable
    ? getTrustedTenantContext(currentUser)
    : null;
  const auxiliaryAuthorityMatches = primaryAuthorized
    && sameAuthorizedTenantScope(auxiliaryTenantScope, patientQuery.tenantScope);

  // The legacy User list is an interim agency-scoped source. Do not even start
  // it for platform owners or before Patient/Visit independently agree on one
  // immutable membership authority, and never consume cached rows in recheck.
  const usersQuery = useQuery({
    queryKey: ['all-users', 5000, analyticsAuthorityKey, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list('-created_date', 5000);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: Boolean(analyticsAuthorityKey && auxiliaryAuthorityMatches),
    ...FRESH_QUERY_OPTIONS,
  });
  const usersAvailable = auxiliaryAuthorityMatches
    && settledSuccessfullyAfterMount(usersQuery);
  const users = usersAvailable ? usersQuery.data : EMPTY_ROWS;
  const analyticsAvailable = primaryAuthorized && usersAvailable;

  // NoteConversion, ComplianceAudit, and TrainingAssignment administrator reads
  // are platform-wide and lack immutable agency provenance. They are not loaded
  // here. Only metrics based on the authorized P/V snapshot and fresh scoped
  // roster remain available.
  const overallStats = useMemo(() => {
    return calculateStats({
      visits,
      users,
      patients: allPatients,
    });
  }, [visits, users, allPatients]);

  // Calculate nurse performance stats
  const nurseStats = useMemo(() => {
    const nurses = users.filter(u => u.role === 'user');
    return nurses.map(nurse => ({
      ...nurse,
      stats: calculateNurseStats(nurse.email, { visits })
    }));
  }, [users, visits]);

  // Top performers
  const topPerformers = useMemo(() => {
    return [...nurseStats]
      .filter(n => n.stats.totalVisits > 0)
      .sort((a, b) => b.stats.completionRate - a.stats.completionRate)
      .slice(0, 5);
  }, [nurseStats]);

  const handleExport = () => {
    toast.error(
      'Agency analytics export is unavailable until NoteConversion, ComplianceAudit, and TrainingAssignment have tenant-bound reporting projections.',
    );
  };

  if (!currentUserAvailable && !currentUserQuery.isError) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="p-12 text-center text-slate-600">
            Verifying administrator access…
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (currentUserQuery.isError || !isAdmin) {
    return (
      <PageContainer>
        <AccessDeniedState
          title="Access restricted"
          description="Agency Analytics is available to administrators only."
          className="py-24"
        />
      </PageContainer>
    );
  }

  if (!analyticsAvailable) {
    return (
      <PageContainer>
        <PageHeader
          icon={BarChart3}
          eyebrow="Analytics"
          title="Agency Analytics & Performance"
          description="Comprehensive overview of agency operations and metrics"
          favoritePage="AgencyAnalytics"
          actions={
            <Button variant="outline" className="gap-2" disabled>
              <Download className="w-4 h-4" />
              Export Report
            </Button>
          }
        />
        <Alert className="border-amber-300 bg-amber-50" role="status">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-950">
            {visitQuery.isError || patientQuery.isError || tenantScopesMismatch
              ? 'Agency analytics are unavailable because Patient or Visit access could not be verified. No metrics or exports are shown.'
              : usersQuery.isError
                ? 'Agency analytics are unavailable because the agency staff roster could not be verified. No metrics or exports are shown.'
                : 'Reverifying Patient, Visit, and staff-roster access before loading agency metrics…'}
          </AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        eyebrow="Analytics"
        title="Agency Analytics & Performance"
        description="Comprehensive overview of agency operations and metrics"
        favoritePage="AgencyAnalytics"
        actions={
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleExport}
            disabled
            title="Tenant-bound reporting projections are not available"
          >
            <Download className="w-4 h-4" />
            Export Report
          </Button>
        }
      />

      <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="financial">Financial</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Documentation Efficiency */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    Documentation Efficiency
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Alert className="border-amber-300 bg-amber-50" role="status">
                    <AlertCircle className="h-4 w-4 text-amber-700" />
                    <AlertDescription className="text-amber-950">
                      Documentation-efficiency and compliance metrics are unavailable until
                      NoteConversion and ComplianceAudit have tenant-bound reporting projections.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              {/* Patient Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-600" />
                    Patient Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Active</span>
                      <span className="text-sm font-semibold text-emerald-600">{overallStats.patients.active}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Discharged</span>
                      <span className="text-sm font-semibold text-slate-600">{overallStats.patients.discharged}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Total</span>
                      <span className="text-sm font-semibold text-slate-600">{overallStats.patients.total}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top Performers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                  Top Performing Nurses
                </CardTitle>
                <CardDescription>Based on the freshly authorized Visit snapshot</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topPerformers.map((nurse, idx) => (
                    <div key={nurse.email} className="flex items-center gap-4 p-3 rounded-lg bg-slate-50">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{nurse.full_name}</p>
                        <p className="text-sm text-slate-500">{nurse.stats.totalVisits} visits</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-indigo-600">{nurse.stats.completionRate}%</p>
                        <p className="text-xs text-slate-500">completion</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="space-y-6">
            <Alert className="border-amber-300 bg-amber-50" role="status">
              <AlertCircle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-950">
                Compliance analytics are unavailable until ComplianceAudit has a
                tenant-bound reporting projection. A platform-wide administrator list
                is not treated as agency evidence.
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Staff Performance Metrics</CardTitle>
                <CardDescription>Individual nurse statistics and productivity</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nurse</TableHead>
                      <TableHead>Visits</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Time Saved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nurseStats.map((nurse) => (
                      <TableRow key={nurse.email}>
                        <TableCell className="font-medium text-slate-900">{nurse.full_name}</TableCell>
                        <TableCell className="text-slate-600">{nurse.stats.totalVisits}</TableCell>
                        <TableCell className="text-slate-600">{nurse.stats.completedVisits}</TableCell>
                        <TableCell>
                          <Badge variant={
                            nurse.stats.completionRate >= 80 ? 'success' :
                            nurse.stats.completionRate >= 60 ? 'warning' :
                            'destructive'
                          }>
                            {nurse.stats.completionRate}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-amber-700">Unavailable</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Training Tab */}
          <TabsContent value="training" className="space-y-6">
            <Alert className="border-amber-300 bg-amber-50" role="status">
              <AlertCircle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-950">
                Training analytics are unavailable until TrainingAssignment has a
                tenant-bound reporting projection. Counts and completion rates are withheld.
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* Financial Tab */}
          <TabsContent value="financial" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StatCard
                title="Est. Revenue"
                value={formatCurrency(overallStats.financial.estimatedRevenue)}
                subtitle="From completed visits"
                icon={Clock}
                color="purple"
              />
              <Alert className="border-amber-300 bg-amber-50" role="status">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-950">
                  Time-saved and cost-savings estimates are unavailable until
                  NoteConversion has a tenant-bound reporting projection.
                </AlertDescription>
              </Alert>
            </div>
          </TabsContent>
        </Tabs>
    </PageContainer>
  );
}
