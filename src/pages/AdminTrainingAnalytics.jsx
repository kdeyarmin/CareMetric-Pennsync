import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { isAdminView } from "@/lib/roles";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  Award,
  AlertCircle,
  CheckCircle2,
  Clock,
  BarChart3
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import { ALL_ROWS } from '@/lib/queryLimits';
import { listTenantTrainingIntegrityRecords } from '@/functions/listTenantTrainingIntegrityRecords';
import ReportReadState from '@/components/analytics/ReportReadState';
import { readReportRows, measuredAverage, displayMeasurement, REPORT_READ_OPTIONS } from '@/components/analytics/reportReadContracts';
import { parseLocalDate } from '@/lib/dateLocal';

export default function AdminTrainingAnalytics() {
  const userQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    ...REPORT_READ_OPTIONS,
  });
  const currentUser = userQuery.isSuccess ? userQuery.data : null;
  const isAdmin = isAdminView(currentUser);
  const authorityKey = agencyQueryKey(currentUser);

  const usersQuery = useQuery({
    queryKey: ['allUsers', 'training-report', 5000, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = readReportRows(await base44.entities.User.list('-created_date', 5000), 'users');
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return { rows: filterUsersByCallerAgency(_rows, currentUser), capped: _rows.length >= 5000 };
    },
    enabled: isAdmin,
    ...REPORT_READ_OPTIONS,
  });

  // Org-wide training activity now comes from the live TrainingAssignment system
  // (the retired TrainingCompletion entity is no longer written).
  const assignmentsQuery = useQuery({
    queryKey: ['allTrainingAssignments', '-created_date', 5000, authorityKey],
    queryFn: async () => readReportRows(await base44.entities.TrainingAssignment.list('-created_date', 5000), 'assignments'),
    enabled: isAdmin,
    ...REPORT_READ_OPTIONS,
  });

  const modulesQuery = useQuery({
    queryKey: ['trainingModules', authorityKey],
    queryFn: async () => readReportRows(await base44.entities.TrainingModule.list(undefined, ALL_ROWS), 'modules'),
    enabled: isAdmin,
    ...REPORT_READ_OPTIONS,
  });

  const recommendationsQuery = useQuery({
    queryKey: ['allRecommendations', authorityKey],
    queryFn: async () => {
      const response = await listTenantTrainingIntegrityRecords({
        resource: 'training_recommendations',
        limit: 500,
      });
      return readReportRows((response?.data || response)?.records, 'recommendations');
    },
    enabled: isAdmin,
    ...REPORT_READ_OPTIONS,
  });

  if (!userQuery.isSuccess) return <PageContainer><ReportReadState queries={[userQuery]} title="Report access" /></PageContainer>;
  if (!isAdmin) {
    return (
      <PageContainer>
        <AccessDeniedState description="Training analytics are available to administrators only." />
      </PageContainer>
    );
  }

  const queries = [usersQuery, assignmentsQuery, modulesQuery, recommendationsQuery];
  if (!queries.every(query => query.isSuccess && !query.isError)) {
    return <PageContainer><ReportReadState queries={queries} title="Training report data" /></PageContainer>;
  }
  const allUsers = usersQuery.data.rows;
  const assignments = assignmentsQuery.data;
  const modules = modulesQuery.data;
  const recommendations = recommendationsQuery.data;
  const capped = usersQuery.data.capped || assignments.length >= 5000 || modules.length >= ALL_ROWS || recommendations.length >= 500;

  const nurses = allUsers.filter(u => u.role === 'user');

  // Analytics calculations (course-assignment based)
  const isCompleted = (a) => a.status === 'completed' || a.pass_fail_result === 'passed';
  const avg = rows => measuredAverage(rows, a => a.score_percentage);
  const completedAssignments = assignments.filter(isCompleted);
  const scoredAssignments = assignments.filter(a => typeof a.score_percentage === 'number');

  const totalCompletions = completedAssignments.length;
  const avgScore = avg(scoredAssignments);
  const inProgress = assignments.filter(a => a.status === 'in_progress').length;
  const unaddressedRecs = recommendations.filter(r => !r.addressed).length;

  // Completion rate by nurse
  const nurseCompletionData = nurses.map(nurse => {
    const assigned = assignments.filter(a => a.assigned_to_user_id === nurse.email);
    const done = completedAssignments.filter(a => a.assigned_to_user_id === nurse.email);
    return {
      name: nurse.full_name || nurse.email,
      completions: done.length,
      assignments: assigned.length,
      avgScore: avg(done.filter(a => typeof a.score_percentage === 'number'))
    };
  }).sort((a, b) => b.completions - a.completions);

  // Module popularity — mapped to each module's linked course.
  const moduleData = modules.map(module => {
    const courseAssignments = module.course_id
      ? completedAssignments.filter(a => a.course_id === module.course_id)
      : [];
    const title = module.title || 'Untitled module';
    return {
      name: title.substring(0, 30) + (title.length > 30 ? '...' : ''),
      completions: courseAssignments.length,
      avgScore: avg(courseAssignments.filter(a => typeof a.score_percentage === 'number'))
    };
  }).sort((a, b) => b.completions - a.completions).slice(0, 10);

  // Category distribution
  const categoryData = Object.create(null);
  modules.forEach(m => {
    const category = m.category || 'Uncategorized';
    categoryData[category] = (categoryData[category] || 0) + 1;
  });
  const categoryChartData = Object.entries(categoryData).map(([cat, count]) => ({
    name: cat,
    value: count
  }));

  // Completion trends (by day)
  const weeklyData = {};
  completedAssignments.forEach(a => {
    if (a.completion_date) {
      const week = format(parseLocalDate(a.completion_date), "yyyy-MM-dd");
      weeklyData[week] = (weeklyData[week] || 0) + 1;
    }
  });
  const trendData = Object.entries(weeklyData)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([date, count]) => ({
      date: date.substring(5),
      completions: count
    }));

  const COLORS = ['#3557b0', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0d9488'];

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        eyebrow="Manage"
        title="Training Analytics Dashboard"
        description="Monitor training progress and effectiveness across your agency"
        favoritePage="AdminTrainingAnalytics"
      />

      {capped && <p role="status" className="mb-4 text-sm text-amber-800">A source reached its record limit. These figures describe loaded records and may omit older activity.</p>}
      <p className="mb-4 text-sm text-slate-600">Completion trends include dated completions only. A missing score is not a zero score.</p>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Completions" value={totalCompletions} icon={CheckCircle2} tone="navy" />
        <StatCard label="Avg Score" value={displayMeasurement(avgScore, '%', 0)} icon={Award} tone="emerald" />
        <StatCard label="In Progress" value={inProgress} icon={Clock} tone="amber" />
        <StatCard label="Pending Recs" value={unaddressedRecs} icon={AlertCircle} tone="rose" />
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="nurses">Nurse Performance</TabsTrigger>
          <TabsTrigger value="modules">Module Analytics</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Category Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={categoryChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#264491"
                      dataKey="value"
                    >
                      {categoryChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Completion Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="completions" stroke="#3557b0" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="nurses" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Nurse Training Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {nurseCompletionData.map((nurse, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{nurse.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{nurse.completions} completed</Badge>
                          <Badge className="bg-emerald-500">{displayMeasurement(nurse.avgScore, '% avg', 0)}</Badge>
                        </div>
                      </div>
                      {nurse.assignments > 0
                        ? <Progress role="progressbar" aria-label={`${nurse.name} assigned training completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={(nurse.completions / nurse.assignments) * 100} value={(nurse.completions / nurse.assignments) * 100} className="h-2" />
                        : <p className="text-xs text-slate-500">No assigned training</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="modules" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Training Modules</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={moduleData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={150} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="completions" fill="#3557b0" name="Completions" />
                  <Bar dataKey="avgScore" fill="#10B981" name="Avg Score %" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Training Activity Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="completions" stroke="#3557b0" strokeWidth={3} name="Completions" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
