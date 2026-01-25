import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from "recharts";
import { 
  TrendingUp, Users, Activity, DollarSign, CheckCircle, 
  AlertCircle, Calendar, Download, Brain, Target, FileText 
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function AgencyAnalyticsDashboard({ agency }) {
  const [dateRange, setDateRange] = useState("30");
  const [selectedMetric, setSelectedMetric] = useState("productivity");

  // Fetch agency users
  const { data: agencyUsers = [] } = useQuery({
    queryKey: ['agencyUsers', agency.agency_code],
    queryFn: async () => {
      const allUsers = await base44.asServiceRole.entities.User.list();
      return allUsers.filter(u => u.agency_code === agency.agency_code);
    }
  });

  // Fetch visits for the date range
  const { data: visits = [] } = useQuery({
    queryKey: ['agencyVisits', agency.agency_code, dateRange],
    queryFn: async () => {
      const allVisits = await base44.asServiceRole.entities.Visit.list();
      const agencyUserEmails = agencyUsers.map(u => u.email);
      const cutoffDate = subDays(new Date(), parseInt(dateRange));
      
      return allVisits.filter(v => 
        agencyUserEmails.includes(v.created_by) &&
        new Date(v.visit_date) >= cutoffDate
      );
    },
    enabled: agencyUsers.length > 0
  });

  // Fetch patients
  const { data: patients = [] } = useQuery({
    queryKey: ['agencyPatients', agency.agency_code],
    queryFn: async () => {
      const allPatients = await base44.asServiceRole.entities.Patient.list();
      return allPatients.filter(p => !p.is_sample);
    }
  });

  // Fetch compliance audits
  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['agencyCompliance', agency.agency_code, dateRange],
    queryFn: async () => {
      const audits = await base44.asServiceRole.entities.ComplianceAudit.list();
      const agencyUserEmails = agencyUsers.map(u => u.email);
      const cutoffDate = subDays(new Date(), parseInt(dateRange));
      
      return audits.filter(a => 
        agencyUserEmails.includes(a.nurse_email) &&
        new Date(a.created_date) >= cutoffDate
      );
    },
    enabled: agencyUsers.length > 0
  });

  // Fetch AI feedback
  const { data: aiFeedback = [] } = useQuery({
    queryKey: ['agencyAIFeedback', agency.agency_code, dateRange],
    queryFn: async () => {
      const feedback = await base44.asServiceRole.entities.AIFeedback.list();
      const agencyUserEmails = agencyUsers.map(u => u.email);
      const cutoffDate = subDays(new Date(), parseInt(dateRange));
      
      return feedback.filter(f => 
        agencyUserEmails.includes(f.user_email) &&
        new Date(f.created_date) >= cutoffDate
      );
    },
    enabled: agencyUsers.length > 0
  });

  // Calculate Provider Productivity Metrics
  const providerProductivity = agencyUsers.map(user => {
    const userVisits = visits.filter(v => v.created_by === user.email);
    const avgNotesPerDay = userVisits.length / parseInt(dateRange);
    const userAudits = complianceAudits.filter(a => a.nurse_email === user.email);
    const avgComplianceScore = userAudits.length > 0
      ? userAudits.reduce((sum, a) => sum + (a.overall_score || 0), 0) / userAudits.length
      : 0;

    return {
      name: user.full_name || user.email,
      email: user.email,
      visits: userVisits.length,
      avgPerDay: avgNotesPerDay.toFixed(1),
      complianceScore: avgComplianceScore.toFixed(1),
      credential: user.credential_type || 'RN'
    };
  }).sort((a, b) => b.visits - a.visits);

  // Patient Outcomes Metrics
  const patientOutcomeStats = {
    totalPatients: patients.length,
    activePatients: patients.filter(p => p.status === 'active').length,
    dischargedPatients: patients.filter(p => p.status === 'discharged').length,
    avgRiskScore: patients.length > 0
      ? patients.reduce((sum, p) => sum + (p.risk_assessment?.score || 0), 0) / patients.length
      : 0,
    highRiskPatients: patients.filter(p => (p.risk_assessment?.level === 'high' || p.risk_assessment?.level === 'critical')).length
  };

  // AI Feature Utilization
  const aiUtilization = {
    totalAIInteractions: aiFeedback.length,
    positiveRatings: aiFeedback.filter(f => f.rating >= 4).length,
    avgRating: aiFeedback.length > 0
      ? aiFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / aiFeedback.length
      : 0,
    mostUsedFeature: (() => {
      const features = {};
      aiFeedback.forEach(f => {
        if (f.feature_type) {
          features[f.feature_type] = (features[f.feature_type] || 0) + 1;
        }
      });
      const entries = Object.entries(features);
      return entries.length > 0 ? entries.sort((a, b) => b[1] - a[1])[0][0] : 'N/A';
    })()
  };

  // AI Feature Usage Breakdown
  const aiFeatureBreakdown = (() => {
    const features = {};
    aiFeedback.forEach(f => {
      if (f.feature_type) {
        features[f.feature_type] = (features[f.feature_type] || 0) + 1;
      }
    });
    return Object.entries(features).map(([name, value]) => ({ name, value }));
  })();

  // Billing Accuracy
  const billingAccuracy = {
    totalBilled: agency.total_billed_amount || 0,
    currentMonthBill: agencyUsers.length * agency.price_per_user,
    avgPerUser: agencyUsers.length > 0 ? agency.price_per_user : 0,
    utilizationRate: (agencyUsers.length / agency.max_users) * 100
  };

  // Compliance Trend Data
  const complianceTrend = (() => {
    const days = parseInt(dateRange);
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const dayAudits = complianceAudits.filter(a => 
        format(new Date(a.created_date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
      );
      const avgScore = dayAudits.length > 0
        ? dayAudits.reduce((sum, a) => sum + (a.overall_score || 0), 0) / dayAudits.length
        : 0;
      
      data.push({
        date: format(date, 'MMM dd'),
        score: avgScore.toFixed(1),
        audits: dayAudits.length
      });
    }
    return data.filter(d => d.audits > 0);
  })();

  // Visit Type Distribution
  const visitTypeData = (() => {
    const types = {};
    visits.forEach(v => {
      const type = v.visit_type || 'other';
      types[type] = (types[type] || 0) + 1;
    });
    return Object.entries(types).map(([name, value]) => ({ name, value }));
  })();

  // Export to PDF
  const handleExport = async () => {
    try {
      const reportData = {
        agency: agency.agency_name,
        dateRange: `Last ${dateRange} days`,
        generatedAt: new Date().toISOString(),
        productivity: providerProductivity,
        outcomes: patientOutcomeStats,
        aiUtilization,
        billing: billingAccuracy
      };
      
      // In a real implementation, this would call a PDF generation function
      console.log('Export report:', reportData);
      alert('Report exported! (PDF generation coming soon)');
    } catch (error) {
      console.error('Export error:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Analytics Dashboard</h2>
          <p className="text-sm text-slate-600">Comprehensive insights for {agency.agency_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleExport} variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Visits</p>
                <p className="text-3xl font-bold text-slate-900">{visits.length}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Avg {(visits.length / parseInt(dateRange)).toFixed(1)}/day
                </p>
              </div>
              <Activity className="w-10 h-10 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Avg Compliance</p>
                <p className="text-3xl font-bold text-slate-900">
                  {complianceAudits.length > 0 
                    ? (complianceAudits.reduce((sum, a) => sum + (a.overall_score || 0), 0) / complianceAudits.length).toFixed(0)
                    : 0}%
                </p>
                <p className="text-xs text-slate-500 mt-1">{complianceAudits.length} audits</p>
              </div>
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">AI Satisfaction</p>
                <p className="text-3xl font-bold text-slate-900">
                  {aiUtilization.avgRating.toFixed(1)}/5
                </p>
                <p className="text-xs text-slate-500 mt-1">{aiFeedback.length} ratings</p>
              </div>
              <Brain className="w-10 h-10 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Active Patients</p>
                <p className="text-3xl font-bold text-slate-900">
                  {patientOutcomeStats.activePatients}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {patientOutcomeStats.highRiskPatients} high risk
                </p>
              </div>
              <Target className="w-10 h-10 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics Tabs */}
      <Tabs defaultValue="productivity" className="space-y-4">
        <TabsList>
          <TabsTrigger value="productivity">📊 Productivity</TabsTrigger>
          <TabsTrigger value="outcomes">🎯 Patient Outcomes</TabsTrigger>
          <TabsTrigger value="ai">🤖 AI Utilization</TabsTrigger>
          <TabsTrigger value="billing">💰 Billing</TabsTrigger>
          <TabsTrigger value="compliance">✅ Compliance</TabsTrigger>
        </TabsList>

        {/* Provider Productivity */}
        <TabsContent value="productivity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Provider Productivity Rankings</CardTitle>
              <CardDescription>Visit counts and performance metrics by provider</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {providerProductivity.slice(0, 10).map((provider, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-700">#{idx + 1}</span>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{provider.name}</p>
                        <p className="text-xs text-slate-500">{provider.credential}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{provider.visits} visits</p>
                      <p className="text-xs text-slate-500">{provider.avgPerDay}/day avg</p>
                      <Badge className="mt-1" variant={provider.complianceScore >= 90 ? "default" : "outline"}>
                        {provider.complianceScore}% compliance
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visit Volume by Provider</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={providerProductivity.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="visits" fill="#3b82f6" name="Total Visits" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Patient Outcomes */}
        <TabsContent value="outcomes" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Total Patients</p>
                <p className="text-3xl font-bold">{patientOutcomeStats.totalPatients}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Active Patients</p>
                <p className="text-3xl font-bold text-green-600">{patientOutcomeStats.activePatients}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Avg Risk Score</p>
                <p className="text-3xl font-bold text-orange-600">
                  {patientOutcomeStats.avgRiskScore.toFixed(1)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Patient Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Active', value: patientOutcomeStats.activePatients },
                      { name: 'Discharged', value: patientOutcomeStats.dischargedPatients },
                    ]}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {[0, 1].map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Utilization */}
        <TabsContent value="ai" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Total AI Interactions</p>
                <p className="text-3xl font-bold">{aiUtilization.totalAIInteractions}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Positive Ratings</p>
                <p className="text-3xl font-bold text-green-600">
                  {aiUtilization.positiveRatings} 
                  <span className="text-sm text-slate-500 ml-2">
                    ({aiUtilization.totalAIInteractions > 0 
                      ? ((aiUtilization.positiveRatings / aiUtilization.totalAIInteractions) * 100).toFixed(0) 
                      : 0}%)
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Most Used Feature</p>
                <p className="text-xl font-bold capitalize">{aiUtilization.mostUsedFeature}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>AI Feature Usage Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={aiFeatureBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8b5cf6" name="Usage Count" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing */}
        <TabsContent value="billing" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Total Billed</p>
                <p className="text-3xl font-bold">${billingAccuracy.totalBilled.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Current Month</p>
                <p className="text-3xl font-bold text-green-600">
                  ${billingAccuracy.currentMonthBill.toFixed(2)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-slate-600">Seat Utilization</p>
                <p className="text-3xl font-bold text-blue-600">
                  {billingAccuracy.utilizationRate.toFixed(0)}%
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Billing Breakdown</CardTitle>
              <CardDescription>Current billing cycle details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium">Active Users</span>
                  <span className="font-bold">{agencyUsers.length}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium">Price per User</span>
                  <span className="font-bold">${agency.price_per_user}/month</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium">Billing Cycle</span>
                  <span className="font-bold capitalize">{agency.billing_cycle}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <span className="text-sm font-medium">Current Bill</span>
                  <span className="font-bold text-blue-700">${billingAccuracy.currentMonthBill.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliance */}
        <TabsContent value="compliance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Compliance Score Trend</CardTitle>
              <CardDescription>Daily average compliance scores over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={complianceTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} name="Avg Score" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visit Type Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={visitTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {visitTypeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}