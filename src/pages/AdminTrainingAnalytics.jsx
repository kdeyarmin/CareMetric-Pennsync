import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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

export default function AdminTrainingAnalytics() {
  const [_selectedModule, _setSelectedModule] = useState('all');
  const [_dateRange, _setDateRange] = useState('30');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    enabled: currentUser?.role === 'admin'
  });

  // Org-wide training activity now comes from the live TrainingAssignment system
  // (the retired TrainingCompletion entity is no longer written).
  const { data: assignments = [] } = useQuery({
    queryKey: ['allTrainingAssignments'],
    queryFn: () => base44.entities.TrainingAssignment.list('-created_date', 5000),
    enabled: currentUser?.role === 'admin'
  });

  const { data: modules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list(),
    enabled: currentUser?.role === 'admin'
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ['allRecommendations'],
    queryFn: () => base44.entities.TrainingRecommendation.list(),
    enabled: currentUser?.role === 'admin'
  });

  if (currentUser?.role !== 'admin') {
    return (
      <PageContainer>
        <AccessDeniedState description="Training analytics are available to administrators only." />
      </PageContainer>
    );
  }

  const nurses = allUsers.filter(u => u.role === 'user');

  // Analytics calculations (course-assignment based)
  const isCompleted = (a) => a.status === 'completed' || a.pass_fail_result === 'passed';
  const avg = (rows) => rows.length > 0 ? Math.round(rows.reduce((s, a) => s + a.score_percentage, 0) / rows.length) : 0;
  const completedAssignments = assignments.filter(isCompleted);
  const scoredAssignments = assignments.filter(a => typeof a.score_percentage === 'number');

  const totalCompletions = completedAssignments.length;
  const avgScore = avg(scoredAssignments);
  const inProgress = assignments.filter(a => a.status === 'in_progress').length;
  const unaddressedRecs = recommendations.filter(r => !r.addressed).length;

  // Completion rate by nurse
  const nurseCompletionData = nurses.map(nurse => {
    const done = completedAssignments.filter(a => a.assigned_to_user_id === nurse.email);
    return {
      name: nurse.full_name || nurse.email,
      completions: done.length,
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
  const categoryData = {};
  modules.forEach(m => {
    categoryData[m.category] = (categoryData[m.category] || 0) + 1;
  });
  const categoryChartData = Object.entries(categoryData).map(([cat, count]) => ({
    name: cat,
    value: count
  }));

  // Completion trends (by day)
  const weeklyData = {};
  completedAssignments.forEach(a => {
    if (a.completion_date) {
      const week = new Date(a.completion_date).toISOString().substring(0, 10);
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

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Completions" value={totalCompletions} icon={CheckCircle2} tone="navy" />
        <StatCard label="Avg Score" value={`${avgScore.toFixed(0)}%`} icon={Award} tone="emerald" />
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
                          <Badge className="bg-emerald-500">{nurse.avgScore}% avg</Badge>
                        </div>
                      </div>
                      <Progress value={modules.length > 0 ? Math.min(100, (nurse.completions / modules.length) * 100) : 0} className="h-2" />
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