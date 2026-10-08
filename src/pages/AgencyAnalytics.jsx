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
import { calculateStats, calculateNurseStats } from "../components/utils/statsCalculator";
import { toast } from "sonner";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';
import { useAgencyAnalyticsAuxiliary } from '@/components/analytics/useAgencyAnalyticsAuxiliary';
import { buildAgencyAnalyticsCsv, trainingCompletionStats } from '@/components/analytics/agencyAnalyticsExport';
import { downloadAuthorityBoundBlob } from '@/lib/downloadBlob';
import { toLocalISODate } from '@/lib/dateLocal';
import { CheckCircle2, Shield } from "lucide-react";

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
  // Admin-only page: agency-wide performance rankings must not render for
  // clinical staff (server-side RLS remains the primary
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

  // 2026-10-08 owner decision: the note-conversion, compliance-audit, incident
  // and training sources are loaded again, but only once the Patient/Visit
  // authority and the staff roster agree, and each is bounded to this agency
  // by the person its rows are attributed to. A section whose source has not
  // settled freshly is reported as unavailable rather than computed from [].
  const auxiliary = useAgencyAnalyticsAuxiliary({
    authorityKey: analyticsAuthorityKey,
    enabled: analyticsAvailable,
    currentUser,
  });
  const noteConversions = auxiliary.noteConversions.rows;
  const complianceAudits = auxiliary.complianceAudits.rows;
  const incidents = auxiliary.incidents.rows;
  const trainingAssignments = auxiliary.trainingAssignments.rows;

  const overallStats = useMemo(() => {
    return calculateStats({
      visits,
      users,
      patients: allPatients,
      noteConversions: noteConversions || EMPTY_ROWS,
      incidents: incidents || EMPTY_ROWS,
      complianceAudits: complianceAudits || EMPTY_ROWS,
    });
  }, [visits, users, allPatients, noteConversions, incidents, complianceAudits]);
  const trainingStats = useMemo(
    () => (trainingAssignments ? trainingCompletionStats(trainingAssignments) : null),
    [trainingAssignments],
  );

  // Calculate nurse performance stats
  const nurseStats = useMemo(() => {
    const nurses = users.filter(u => u.role === 'user');
    return nurses.map(nurse => ({
      ...nurse,
      stats: calculateNurseStats(nurse.email, { visits, noteConversions: noteConversions || EMPTY_ROWS })
    }));
  }, [users, visits, noteConversions]);

  // Top performers
  const topPerformers = useMemo(() => {
    return [...nurseStats]
      .filter(n => n.stats.totalVisits > 0)
      .sort((a, b) => b.stats.completionRate - a.stats.completionRate)
      .slice(0, 5);
  }, [nurseStats]);

  const handleExport = () => {
    if (!analyticsAvailable) {
      toast.error('Agency analytics must finish verifying before it can be exported.');
      return;
    }
    try {
      const csv = buildAgencyAnalyticsCsv({
        overallStats,
        topPerformers,
        trainingStats,
        available: {
          compliance: Boolean(complianceAudits),
          incidents: Boolean(incidents),
        },
        generatedAt: new Date().toISOString(),
      });
      downloadAuthorityBoundBlob(new Blob([csv], { type: 'text/csv' }), `agency_analytics_${toLocalISODate()}.csv`);
    } catch (error) {
      console.error('Agency analytics export error:', error);
      toast.error(`Failed to export report: ${error.message}`);
    }
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
            disabled={!analyticsAvailable}
          >
            <Download className="w-4 h-4" />
            Export Report
          </Button>
        }
      />

      <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
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
                  {noteConversions && complianceAudits ? (
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-slate-600">AI Enhancement Rate</span>
                          <span className="text-sm font-semibold">{overallStats.visits.total > 0 ? Math.min(100, Math.round((overallStats.noteEnhancements.total / overallStats.visits.total) * 100)) : 0}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${overallStats.visits.total > 0 ? Math.min(100, Math.round((overallStats.noteEnhancements.total / overallStats.visits.total) * 100)) : 0}%` }}></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                          <p className="text-2xl font-bold text-slate-900">{overallStats.compliance.auditsInRange > 0 ? overallStats.compliance.avgScore : '—'}</p>
                          <p className="text-sm text-slate-600">Avg Quality Score</p>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-slate-900">{overallStats.noteEnhancements.total}</p>
                          <p className="text-sm text-slate-600">Notes Enhanced</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Alert className="border-amber-300 bg-amber-50" role="status">
                      <AlertCircle className="h-4 w-4 text-amber-700" />
                      <AlertDescription className="text-amber-950">
                        {auxiliary.noteConversions.isError || auxiliary.complianceAudits.isError
                          ? 'Documentation-efficiency metrics are unavailable because the note-enhancement or compliance-audit records could not be loaded.'
                          : 'Loading note-enhancement and compliance-audit records…'}
                      </AlertDescription>
                    </Alert>
                  )}
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
            {complianceAudits ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <StatCard
                    title="Avg Compliance Score"
                    value={overallStats.compliance.auditsInRange > 0 ? `${overallStats.compliance.avgScore}%` : '—'}
                    icon={Shield}
                    color="green"
                  />
                  <StatCard
                    title="Total Audits"
                    value={overallStats.compliance.auditsInRange}
                    subtitle={`${overallStats.compliance.passedAudits} passed`}
                    icon={CheckCircle2}
                    color="indigo"
                  />
                  <StatCard
                    title="Quality Score"
                    value={overallStats.compliance.auditsInRange > 0 ? `${overallStats.compliance.qualityScore}%` : '—'}
                    subtitle="Share of audits passed"
                    icon={AlertCircle}
                    color="indigo"
                  />
                </div>
                {incidents && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Incidents</CardTitle>
                      <CardDescription>Reported by this agency&apos;s staff</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      <div><p className="text-2xl font-bold">{overallStats.incidents.total}</p><p className="text-sm text-slate-600">Total</p></div>
                      <div><p className="text-2xl font-bold">{overallStats.incidents.falls}</p><p className="text-sm text-slate-600">Falls</p></div>
                      <div><p className="text-2xl font-bold">{overallStats.incidents.hospitalizations}</p><p className="text-sm text-slate-600">Hospitalizations</p></div>
                      <div><p className="text-2xl font-bold">{overallStats.incidents.medicationErrors}</p><p className="text-sm text-slate-600">Medication errors</p></div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Alert className="border-amber-300 bg-amber-50" role="status">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-950">
                  {auxiliary.complianceAudits.isError
                    ? 'Compliance analytics are unavailable because the compliance-audit records could not be loaded.'
                    : 'Loading compliance-audit records…'}
                </AlertDescription>
              </Alert>
            )}
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
                        <TableCell className={noteConversions ? 'text-slate-600' : 'text-amber-700'}>
                          {noteConversions ? `${nurse.stats.timeSavedHours}h` : 'Unavailable'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Training Tab */}
          <TabsContent value="training" className="space-y-6">
            {trainingStats ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <StatCard title="Total Trainings" value={trainingStats.total} icon={FileText} color="indigo" />
                  <StatCard
                    title="Completed"
                    value={trainingStats.completed}
                    subtitle={trainingStats.rate === null ? 'No assignments' : `${trainingStats.rate}% rate`}
                    icon={CheckCircle2}
                    color="green"
                  />
                  <StatCard title="In Progress" value={trainingStats.total - trainingStats.completed} icon={Clock} color="amber" />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Training Completion Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-600">Overall Completion Rate</span>
                        <span className="text-sm font-semibold">{trainingStats.rate === null ? '—' : `${trainingStats.rate}%`}</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-3">
                        <div className="bg-indigo-600 h-3 rounded-full transition-all" style={{ width: `${trainingStats.rate || 0}%` }}></div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Alert className="border-amber-300 bg-amber-50" role="status">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-950">
                  {auxiliary.trainingAssignments.isError
                    ? 'Training analytics are unavailable because the training assignments could not be loaded.'
                    : 'Loading training assignments…'}
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>
    </PageContainer>
  );
}
