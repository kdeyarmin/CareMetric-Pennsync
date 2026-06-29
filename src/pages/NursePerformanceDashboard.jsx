import { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import {
  Award,
  AlertTriangle,
  Target,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Brain,
  Sparkles,
  Lightbulb,
  ChevronRight,
  Heart,
  Zap,
  Plus,
  Edit2,
  Trash2,
  TrendingUp
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const COLORS = ['#3557b0', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0d9488'];

export default function NursePerformanceDashboard() {
  const [selectedNurse, setSelectedNurse] = useState('');
  const [dateRange, setDateRange] = useState('30');
  const [showGoalDialog, setShowGoalDialog] = useState(false);
  const [editingGoal, setEditingGoal] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    enabled: currentUser?.role === 'admin',
    initialData: []
  });

  const nurseEmail = currentUser?.role === 'admin' && selectedNurse 
    ? selectedNurse 
    : currentUser?.email;

  const { data: performanceData, isLoading, refetch } = useQuery({
    queryKey: ['nursePerformance', nurseEmail, dateRange],
    queryFn: async () => {
      const response = await base44.functions.invoke('analyzeNursePerformance', {
        nurse_email: nurseEmail,
        date_range_days: parseInt(dateRange)
      });
      return response.data || response;
    },
    enabled: !!nurseEmail
  });

  const metrics = performanceData?.metrics;
  const insights = performanceData?.insights;
  const skillGaps = performanceData?.skill_gaps || [];
  const docQuality = performanceData?.documentation_quality;
  const patientOutcomes = performanceData?.patient_outcomes;
  const utilization = performanceData?.utilization;
  const burnoutRisk = performanceData?.burnout_risk;

  // Fetch nurse goals
  const { data: nurseGoals = [] } = useQuery({
    queryKey: ['nurseGoals', nurseEmail],
    queryFn: () => base44.entities.NurseGoal.filter({ nurse_email: nurseEmail }),
    enabled: !!nurseEmail,
    initialData: []
  });

  // Goal mutations
  const createGoalMutation = useMutation({
    mutationFn: (goal) => base44.entities.NurseGoal.create(goal),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nurseGoals'] });
      setShowGoalDialog(false);
      setEditingGoal(null);
    }
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.NurseGoal.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nurseGoals'] });
      setShowGoalDialog(false);
      setEditingGoal(null);
    }
  });

  const deleteGoalMutation = useMutation({
    mutationFn: (id) => base44.entities.NurseGoal.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nurseGoals'] })
  });

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-emerald-600 bg-emerald-50';
    if (score >= 80) return 'text-blue-600 bg-blue-50';
    if (score >= 70) return 'text-amber-600 bg-amber-50';
    return 'text-red-600 bg-red-50';
  };

  const getGradeColor = (grade) => {
    if (grade === 'A' || grade === 'A+') return 'bg-emerald-500';
    if (grade === 'B' || grade === 'B+') return 'bg-blue-500';
    if (grade === 'C') return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getBurnoutColor = (level) => {
    if (level === 'low') return 'text-emerald-600 bg-emerald-50';
    if (level === 'moderate') return 'text-amber-600 bg-amber-50';
    if (level === 'high') return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  const handleSaveGoal = (goalData) => {
    if (editingGoal) {
      updateGoalMutation.mutate({ id: editingGoal.id, data: goalData });
    } else {
      createGoalMutation.mutate({ ...goalData, nurse_email: nurseEmail });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
            Loading performance data...
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={TrendingUp}
        eyebrow="Admin"
        title="Nurse Performance Dashboard"
        description="AI-powered insights and personalized recommendations"
        favoritePage="NursePerformanceDashboard"
        actions={
          <div className="flex flex-col sm:flex-row gap-2">
            {currentUser?.role === 'admin' && (
              <Select value={selectedNurse} onValueChange={setSelectedNurse}>
                <SelectTrigger className="w-full sm:w-64 h-11 touch-target">
                  <SelectValue placeholder="Select nurse..." />
                </SelectTrigger>
                <SelectContent>
                  {allUsers.filter(u => u.role === 'user' && u.is_approved !== false).map(user => (
                    <SelectItem key={user.email} value={user.email}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-full sm:w-40 h-11 touch-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => refetch()} variant="outline" className="min-h-[44px] w-full sm:w-auto">
              Refresh
            </Button>
          </div>
        }
      />

      {!performanceData ? (
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
            Select a nurse to view performance data
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Performance Grade & Summary */}
          <Card className="mb-6 border-l-4 border-l-navy-500">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className={`w-20 h-20 rounded-full ${getGradeColor(insights?.performance_grade || 'B')} flex items-center justify-center shadow-lg`}>
                    <span className="text-3xl font-bold text-white">{insights?.performance_grade || 'B'}</span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-1">Overall Performance</h2>
                    <p className="text-slate-700">{insights?.overall_summary}</p>
                  </div>
                </div>
                <Award className="w-16 h-16 text-blue-300" />
              </div>
            </CardContent>
          </Card>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <Card>
              <CardContent className="p-3 sm:p-4 md:p-6">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1 truncate">Compliance Score</p>
                    <p className={`text-xl sm:text-2xl md:text-3xl font-bold ${getScoreColor(metrics?.avg_compliance_score)}`}>
                      {metrics?.avg_compliance_score || 0}%
                    </p>
                  </div>
                  <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Enhancements Completed</p>
                    <p className="text-3xl font-bold text-slate-900">{metrics?.completed_visits || 0}</p>
                  </div>
                  <FileText className="w-8 h-8 text-emerald-400" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">AI Adoption</p>
                    <p className="text-3xl font-bold text-navy-600">
                      {metrics?.suggestion_acceptance_rate || 0}%
                    </p>
                  </div>
                  <Brain className="w-8 h-8 text-navy-400" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Avg Doc Time</p>
                    <p className="text-3xl font-bold text-orange-600">
                      {metrics?.avg_documentation_time || 0}m
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-orange-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="insights" className="space-y-4 sm:space-y-6">
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex md:grid md:w-full md:grid-cols-9 gap-1 min-w-max h-auto">
              <TabsTrigger value="insights" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Insights</TabsTrigger>
              <TabsTrigger value="quality" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Quality</TabsTrigger>
              <TabsTrigger value="outcomes" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Outcomes</TabsTrigger>
              <TabsTrigger value="utilization" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Utilization</TabsTrigger>
              <TabsTrigger value="burnout" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Burnout</TabsTrigger>
              <TabsTrigger value="goals" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Goals</TabsTrigger>
              <TabsTrigger value="skills" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Skills</TabsTrigger>
              <TabsTrigger value="trends" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Trends</TabsTrigger>
              <TabsTrigger value="suggestions" className="py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">Suggest</TabsTrigger>
            </TabsList>
          </div>

            {/* Documentation Quality Tab */}
            <TabsContent value="quality" className="space-y-6">
              <div className="grid md:grid-cols-3 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Total Notes</p>
                    <p className="text-3xl font-bold text-blue-600">{docQuality?.total_notes || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Avg Note Length</p>
                    <p className="text-3xl font-bold text-emerald-600">{docQuality?.avg_note_length || 0}</p>
                    <p className="text-xs text-slate-500 mt-1">characters</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Completeness</p>
                    <p className="text-3xl font-bold text-navy-600">
                      {docQuality?.total_notes > 0 
                        ? Math.round((docQuality.notes_with_vitals / docQuality.total_notes) * 100)
                        : 0}%
                    </p>
                    <p className="text-xs text-slate-500 mt-1">notes with vitals</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Quality Indicators</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                      <span className="text-sm">Notes with AI Tags</span>
                      <span className="font-semibold">{docQuality?.notes_with_tags || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                      <span className="text-sm">Notes with Vitals</span>
                      <span className="font-semibold">{docQuality?.notes_with_vitals || 0}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      Issues Identified
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                      <span className="text-sm">Critical Issues</span>
                      <Badge variant="destructive">{docQuality?.critical_issues || 0}</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                      <span className="text-sm">Flagged for Review</span>
                      <Badge className="bg-amber-500">{docQuality?.flagged_issues || 0}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Patient Outcomes Tab */}
            <TabsContent value="outcomes" className="space-y-6">
              <div className="grid md:grid-cols-4 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Patients Managed</p>
                    <p className="text-3xl font-bold text-blue-600">{patientOutcomes?.total_patients || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Care Plans</p>
                    <p className="text-3xl font-bold text-emerald-600">{patientOutcomes?.care_plans_managed || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Goals Met</p>
                    <p className="text-3xl font-bold text-navy-600">{patientOutcomes?.goals_met || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Achievement Rate</p>
                    <p className="text-3xl font-bold text-teal-600">{patientOutcomes?.goal_achievement_rate || 0}%</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Care Plan Progress</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Met', value: patientOutcomes?.goals_met || 0 },
                            { name: 'Active', value: patientOutcomes?.goals_active || 0 }
                          ]}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#264491"
                          dataKey="value"
                        >
                          <Cell fill="#10B981" />
                          <Cell fill="#3557b0" />
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Incident Management</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <span className="text-sm">Total Incidents</span>
                      <span className="text-2xl font-bold">{patientOutcomes?.incidents_reported || 0}</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg">
                      <span className="text-sm">High Severity</span>
                      <Badge variant="destructive">{patientOutcomes?.high_severity_incidents || 0}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Utilization Tab */}
            <TabsContent value="utilization" className="space-y-6">
              <div className="grid md:grid-cols-4 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Visits (30d)</p>
                    <p className="text-3xl font-bold text-blue-600">{utilization?.visits_last_30_days || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Avg Visits/Day</p>
                    <p className="text-3xl font-bold text-emerald-600">{utilization?.avg_visits_per_day || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Productive Hours</p>
                    <p className="text-3xl font-bold text-navy-600">{utilization?.productive_hours || 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Utilization Rate</p>
                    <p className="text-3xl font-bold text-orange-600">{utilization?.utilization_rate || 0}%</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Workload Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm font-medium">Daily Visit Load</span>
                        <span className="text-sm text-slate-600">{utilization?.avg_visits_per_day || 0} / 6 optimal</span>
                      </div>
                      <Progress value={(utilization?.avg_visits_per_day / 6) * 100 || 0} />
                    </div>
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm font-medium">Utilization Rate</span>
                        <span className="text-sm text-slate-600">{utilization?.utilization_rate || 0}%</span>
                      </div>
                      <Progress value={utilization?.utilization_rate || 0} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Burnout Risk Tab */}
            <TabsContent value="burnout" className="space-y-6">
              <Alert className={getBurnoutColor(burnoutRisk?.risk_level || 'low')}>
                <Heart className="w-5 h-5" />
                <AlertDescription>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-bold text-lg">Burnout Risk: {burnoutRisk?.risk_level?.toUpperCase() || 'LOW'}</p>
                      <p className="text-sm mt-1">Risk Score: {burnoutRisk?.risk_score || 0}/100</p>
                    </div>
                    <div className="text-right">
                      <Progress value={burnoutRisk?.risk_score || 0} className="w-32 mb-2" />
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="grid md:grid-cols-2 gap-6">
                {burnoutRisk?.warning_signs?.length > 0 && (
                  <Card className="border-amber-200">
                    <CardHeader className="bg-amber-50">
                      <CardTitle className="flex items-center gap-2 text-amber-900">
                        <AlertTriangle className="w-5 h-5" />
                        Warning Signs
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      <ul className="space-y-2">
                        {burnoutRisk.warning_signs.map((sign, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{sign}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {burnoutRisk?.positive_indicators?.length > 0 && (
                  <Card className="border-emerald-200">
                    <CardHeader className="bg-emerald-50">
                      <CardTitle className="flex items-center gap-2 text-emerald-900">
                        <CheckCircle2 className="w-5 h-5" />
                        Positive Indicators
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      <ul className="space-y-2">
                        {burnoutRisk.positive_indicators.map((indicator, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{indicator}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>

              {burnoutRisk?.contributing_factors?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Contributing Factors</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {burnoutRisk.contributing_factors.map((factor, idx) => (
                        <li key={idx} className="p-3 bg-slate-50 rounded-lg text-sm">{factor}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {burnoutRisk?.recommendations?.length > 0 && (
                <Card className="border-blue-200">
                  <CardHeader className="bg-blue-50">
                    <CardTitle className="flex items-center gap-2 text-blue-900">
                      <Lightbulb className="w-5 h-5" />
                      Recommendations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <ul className="space-y-3">
                      {burnoutRisk.recommendations.map((rec, idx) => (
                        <li key={idx} className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                          <Zap className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          <span className="text-sm">{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Personal Goals Tab */}
            <TabsContent value="goals" className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-semibold">My Performance Goals</h3>
                  <p className="text-sm text-slate-600">Track your professional development objectives</p>
                </div>
                <Button onClick={() => { setEditingGoal(null); setShowGoalDialog(true); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Goal
                </Button>
              </div>

              {nurseGoals.length === 0 ? (
                <EmptyState icon={Target} title="No goals set yet" description="Create your first performance goal to start tracking." />
              ) : (
                <div className="grid md:grid-cols-2 gap-6">
                  {nurseGoals.map((goal) => {
                    const progress = goal.target_value > 0 
                      ? Math.min(Math.round((goal.current_value / goal.target_value) * 100), 100)
                      : 0;
                    
                    return (
                      <Card key={goal.id} className={
                        goal.status === 'achieved' ? 'border-emerald-300 bg-emerald-50' :
                        goal.status === 'missed' ? 'border-red-300 bg-red-50' :
                        'border-blue-300'
                      }>
                        <CardHeader>
                          <div className="flex justify-between items-start">
                            <div>
                              <CardTitle className="text-lg">{goal.title}</CardTitle>
                              <p className="text-sm text-slate-600 mt-1">{goal.description}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" aria-label="Edit goal" onClick={() => { setEditingGoal(goal); setShowGoalDialog(true); }}>
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" aria-label="Delete goal" onClick={() => deleteGoalMutation.mutate(goal.id)}>
                                <Trash2 className="w-4 h-4 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="flex justify-between text-sm">
                              <span>Progress</span>
                              <span className="font-semibold">{goal.current_value} / {goal.target_value} {goal.unit}</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                            <div className="flex justify-between text-xs text-slate-600">
                              <span>Target: {format(new Date(goal.target_date), 'MMM d, yyyy')}</span>
                              <Badge variant={
                                goal.status === 'achieved' ? 'default' :
                                goal.status === 'missed' ? 'destructive' :
                                'secondary'
                              }>
                                {goal.status}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* AI Insights Tab */}
            <TabsContent value="insights" className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Strengths */}
                <Card className="border-emerald-200">
                  <CardHeader className="bg-emerald-50">
                    <CardTitle className="flex items-center gap-2 text-emerald-900">
                      <Award className="w-5 h-5" />
                      Key Strengths
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <ul className="space-y-3">
                      {insights?.strengths?.map((strength, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                          <span className="text-slate-700">{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                {/* Areas for Improvement */}
                <Card className="border-amber-200">
                  <CardHeader className="bg-amber-50">
                    <CardTitle className="flex items-center gap-2 text-amber-900">
                      <Target className="w-5 h-5" />
                      Growth Opportunities
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <ul className="space-y-4">
                      {insights?.areas_for_improvement?.map((area, idx) => (
                        <li key={idx} className="border-l-4 border-amber-400 pl-3">
                          <p className="font-semibold text-slate-900 mb-1">{area.area}</p>
                          <p className="text-sm text-slate-600">{area.suggestion}</p>
                          <Badge className="mt-2 text-xs" variant={area.priority === 'high' ? 'destructive' : 'secondary'}>
                            {area.priority} priority
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>

              {/* Training Recommendations */}
              <Card>
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2 text-navy-900">
                    <BookOpen className="w-5 h-5 text-navy-600" />
                    Personalized Training Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-3">
                    {insights?.training_recommendations?.map((rec, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <Lightbulb className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{rec.topic}</p>
                          <p className="text-sm text-slate-600 mt-1">{rec.reason}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant={rec.urgency === 'high' ? 'destructive' : rec.urgency === 'medium' ? 'default' : 'secondary'}>
                              {rec.urgency} urgency
                            </Badge>
                            <Button asChild size="sm" variant="outline" className="ml-auto">
                              <Link to={createPageUrl('NurseTrainingHub')}>
                                Start Training
                                <ChevronRight className="w-3 h-3 ml-1" />
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Risk Factors */}
              {insights?.risk_factors?.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>
                    <strong className="block mb-2">Performance Risk Factors:</strong>
                    <ul className="list-disc ml-4 space-y-1">
                      {insights.risk_factors.map((risk, idx) => (
                        <li key={idx}>{risk}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            {/* Trends Tab */}
            <TabsContent value="trends" className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Compliance Trend */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Compliance Score Trend</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={metrics?.compliance_trend || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="score" stroke="#3557b0" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Productivity Trend */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Visit Productivity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={metrics?.productivity_trend || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="visits" fill="#10B981" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* AI Tool Adoption */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">AI Tool Adoption</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={metrics?.ai_adoption_trend || []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="usage" stroke="#8B5CF6" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Visit Types Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Visit Types</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={Object.entries(metrics?.visits_by_type || {}).map(([type, count]) => ({
                            name: type.replace(/_/g, ' '),
                            value: count
                          }))}
                          cx="50%"
                          cy="40%"
                          outerRadius={60}
                          fill="#264491"
                          dataKey="value"
                          label={({ percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''}
                        >
                          {Object.keys(metrics?.visits_by_type || {}).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend 
                          wrapperStyle={{ fontSize: '12px' }}
                          iconType="circle"
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed Metrics */}
              <div className="grid md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Template Usage Rate</p>
                    <div className="flex items-center gap-3">
                      <Progress 
                        value={(metrics?.template_usage / (metrics?.completed_visits || 1) * 100) || 0} 
                        className="flex-1"
                      />
                      <span className="text-lg font-semibold">
                        {Math.round((metrics?.template_usage / (metrics?.completed_visits || 1) * 100) || 0)}%
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">AI Scribe Adoption</p>
                    <div className="flex items-center gap-3">
                      <Progress 
                        value={(metrics?.ai_scribe_usage / (metrics?.completed_visits || 1) * 100) || 0} 
                        className="flex-1"
                      />
                      <span className="text-lg font-semibold">
                        {Math.round((metrics?.ai_scribe_usage / (metrics?.completed_visits || 1) * 100) || 0)}%
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-600 mb-2">Voice Commands</p>
                    <div className="flex items-center gap-3">
                      <Progress 
                        value={Math.min((metrics?.voice_command_usage / 20) * 100, 100)} 
                        className="flex-1"
                      />
                      <span className="text-lg font-semibold">{metrics?.voice_command_usage || 0}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* AI Suggestions Tab */}
            <TabsContent value="suggestions" className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Suggestion Stats */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">AI Suggestion Analytics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
                      <span className="text-slate-700">Total Suggestions Received</span>
                      <span className="text-2xl font-bold text-blue-600">{metrics?.total_suggestions_received}</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg">
                      <span className="text-slate-700">Suggestions Applied</span>
                      <span className="text-2xl font-bold text-emerald-600">{metrics?.suggestions_applied}</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-navy-50 rounded-lg">
                      <span className="text-slate-700">Acceptance Rate</span>
                      <span className="text-2xl font-bold text-navy-600">{metrics?.suggestion_acceptance_rate}%</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Suggestions by Source */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Suggestions by Source</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={Object.entries(metrics?.suggestions_by_source || {}).map(([source, count]) => ({
                        name: source.replace(/_/g, ' '),
                        count
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#8B5CF6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Unaddressed Recommendations */}
              <Card className="border-amber-200">
                <CardHeader className="bg-amber-50">
                  <CardTitle className="text-lg flex items-center gap-2 text-amber-900">
                    <Sparkles className="w-5 h-5" />
                    Pending AI Suggestions ({performanceData?.recent_recommendations?.length || 0})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <ScrollArea className="h-96">
                    <div className="space-y-3">
                      {performanceData?.recent_recommendations?.map((rec, idx) => (
                        <div key={idx} className="p-4 border rounded-lg hover:bg-slate-50">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant={rec.severity === 'critical' ? 'destructive' : rec.severity === 'high' ? 'default' : 'secondary'}>
                                  {rec.severity}
                                </Badge>
                                <Badge variant="outline">{rec.recommendation_type}</Badge>
                                <span className="text-xs text-slate-500">{(rec.source || '').replace(/_/g, ' ')}</span>
                              </div>
                              <p className="text-sm text-slate-900">{rec.recommendation_text}</p>
                              {rec.context_data?.element && (
                                <p className="text-xs text-slate-500 mt-1">Context: {rec.context_data.element}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Skill Gaps Tab */}
            <TabsContent value="skills" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-red-600" />
                    Identified Skill Gaps
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {skillGaps.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                      <p>No significant skill gaps identified. Great work!</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {skillGaps.map((gap, idx) => (
                        <div key={idx} className="rounded-lg border border-rose-200 bg-rose-50/60 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="font-semibold text-slate-900">{gap.skill}</h3>
                                <Badge variant="destructive">{gap.gap_severity} priority</Badge>
                              </div>
                              <p className="text-sm text-slate-600 mb-3">{gap.recommendation}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500">Current level:</span>
                                <Badge variant="outline">{(gap.current_level || 'unknown').replace(/_/g, ' ')}</Badge>
                              </div>
                            </div>
                            <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                              <Link to={createPageUrl('NurseTrainingHub')}>
                                Take Training
                              </Link>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>

          {/* Goal Dialog */}
          <Dialog open={showGoalDialog} onOpenChange={setShowGoalDialog}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingGoal ? 'Edit Goal' : 'Create New Goal'}</DialogTitle>
                <DialogDescription>Set a personal performance goal to track your progress</DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                handleSaveGoal({
                  goal_type: formData.get('goal_type'),
                  title: formData.get('title'),
                  description: formData.get('description'),
                  target_value: parseFloat(formData.get('target_value')),
                  current_value: parseFloat(formData.get('current_value') || 0),
                  unit: formData.get('unit'),
                  target_date: formData.get('target_date'),
                  priority: formData.get('priority'),
                  status: editingGoal?.status || 'active'
                });
              }}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Goal Type</Label>
                      <Select name="goal_type" defaultValue={editingGoal?.goal_type || 'compliance_score'} required>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compliance_score">Compliance Score</SelectItem>
                          <SelectItem value="documentation_time">Documentation Time</SelectItem>
                          <SelectItem value="visits_per_day">Visits per Day</SelectItem>
                          <SelectItem value="ai_adoption">AI Adoption</SelectItem>
                          <SelectItem value="patient_outcomes">Patient Outcomes</SelectItem>
                          <SelectItem value="training_completion">Training Completion</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Priority</Label>
                      <Select name="priority" defaultValue={editingGoal?.priority || 'medium'} required>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Title</Label>
                    <Input name="title" defaultValue={editingGoal?.title} required placeholder="e.g., Achieve 95% compliance" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input name="description" defaultValue={editingGoal?.description} placeholder="Detailed description of your goal" />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label>Target Value</Label>
                      <Input name="target_value" type="number" defaultValue={editingGoal?.target_value} required />
                    </div>
                    <div>
                      <Label>Current Value</Label>
                      <Input name="current_value" type="number" defaultValue={editingGoal?.current_value || 0} />
                    </div>
                    <div>
                      <Label>Unit</Label>
                      <Input name="unit" defaultValue={editingGoal?.unit || '%'} required placeholder="%, min, count" />
                    </div>
                  </div>
                  <div>
                    <Label>Target Date</Label>
                    <Input name="target_date" type="date" defaultValue={editingGoal?.target_date} required />
                  </div>
                </div>
                <DialogFooter className="mt-6">
                  <Button type="button" variant="outline" onClick={() => setShowGoalDialog(false)}>Cancel</Button>
                  <Button type="submit">{editingGoal ? 'Update' : 'Create'} Goal</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </PageContainer>
  );
}