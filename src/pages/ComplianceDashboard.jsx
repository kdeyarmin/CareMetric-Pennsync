import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, TrendingUp,
  TrendingDown, BarChart3, Calendar, Users, FileText,
  Search, Filter, ChevronLeft, ChevronRight, Eye, Wand2
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { formatEastern } from "@/components/utils/timezone";
import PullToRefresh from "../components/mobile/PullToRefresh";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import OneClickComplianceFixer from "../components/compliance/OneClickComplianceFixer";
import ProactiveComplianceRiskPredictor from "../components/compliance/ProactiveComplianceRiskPredictor";
import AIComplianceCarePlanSuggester from "../components/compliance/AIComplianceCarePlanSuggester";

export default function ComplianceDashboard() {
  const [timeframe, setTimeframe] = useState("30");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("open");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedViolation, setSelectedViolation] = useState(null);
  const [detailDialog, setDetailDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allAudits = [] } = useQuery({
    queryKey: ['allComplianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 500)
  });

  const { data: allViolations = [] } = useQuery({
    queryKey: ['allComplianceViolations'],
    queryFn: () => base44.entities.ComplianceViolation.list('-created_date', 500)
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list()
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list()
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list()
  });

  const { data: userAgency } = useQuery({
    queryKey: ['userAgency', currentUser?.email],
    queryFn: async () => {
      if (currentUser?.role === 'admin') return null;
      const agencies = await base44.entities.Agency.filter({ admin_email: currentUser.email });
      return agencies[0] || null;
    },
    enabled: !!currentUser?.email && currentUser?.role !== 'admin'
  });

  const isAgencyAdmin = !!userAgency;
  const canAccess = currentUser?.role === 'admin' || isAgencyAdmin;

  const resolveViolationMutation = useMutation({
    mutationFn: ({ id, resolution_notes }) => 
      base44.entities.ComplianceViolation.update(id, {
        status: 'resolved',
        resolved_date: new Date().toISOString(),
        resolution_notes
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allComplianceViolations'] });
      toast.success("Violation marked as resolved");
    }
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    const days = parseInt(timeframe);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentAudits = allAudits.filter(a => new Date(a.audit_date) >= cutoff);
    const recentViolations = allViolations.filter(v => new Date(v.created_date) >= cutoff);

    const openViolations = allViolations.filter(v => v.status === 'open');
    const criticalOpen = openViolations.filter(v => v.severity === 'critical');
    const highOpen = openViolations.filter(v => v.severity === 'high');

    const avgScore = recentAudits.length > 0
      ? (recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length).toFixed(1)
      : 0;

    const passedAudits = recentAudits.filter(a => a.status === 'passed').length;
    const flaggedAudits = recentAudits.filter(a => a.status === 'flagged' || a.status === 'critical').length;

    return {
      totalAudits: recentAudits.length,
      avgScore,
      passedAudits,
      flaggedAudits,
      totalViolations: recentViolations.length,
      openViolations: openViolations.length,
      criticalOpen: criticalOpen.length,
      highOpen: highOpen.length,
      resolvedViolations: allViolations.filter(v => v.status === 'resolved').length,
      autoFixableCount: openViolations.filter(v => v.auto_fix_available).length
    };
  }, [allAudits, allViolations, timeframe]);

  // Compliance score trend
  const complianceTrend = useMemo(() => {
    const days = parseInt(timeframe);
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayAudits = allAudits.filter(a => a.audit_date?.startsWith(dateStr));
      const avgScore = dayAudits.length > 0
        ? Math.round(dayAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / dayAudits.length)
        : null;

      trend.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        score: avgScore,
        audits: dayAudits.length
      });
    }

    return trend;
  }, [allAudits, timeframe]);

  // Violations by severity
  const violationsBySeverity = useMemo(() => {
    const counts = allViolations
      .filter(v => v.status === 'open')
      .reduce((acc, v) => {
        acc[v.severity] = (acc[v.severity] || 0) + 1;
        return acc;
      }, {});

    const colors = {
      critical: '#EF4444',
      high: '#F97316',
      medium: '#EAB308',
      low: '#3B82F6'
    };

    return Object.entries(counts).map(([severity, count]) => ({
      name: severity.charAt(0).toUpperCase() + severity.slice(1),
      value: count,
      color: colors[severity]
    }));
  }, [allViolations]);

  // Violations by category
  const violationsByCategory = useMemo(() => {
    const counts = allViolations
      .filter(v => v.status === 'open')
      .reduce((acc, v) => {
        const category = v.rule_category || 'Other';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {});

    return Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [allViolations]);

  // Filter violations
  const filteredViolations = useMemo(() => {
    return allViolations.filter(v => {
      const matchesSeverity = filterSeverity === 'all' || v.severity === filterSeverity;
      const matchesStatus = filterStatus === 'all' || v.status === filterStatus;
      const matchesSearch = !searchTerm ||
        v.rule_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.violation_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.user_email?.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSeverity && matchesStatus && matchesSearch;
    });
  }, [allViolations, filterSeverity, filterStatus, searchTerm]);

  // User performance
  const userPerformance = useMemo(() => {
    const userStats = {};

    allAudits.forEach(audit => {
      if (!userStats[audit.nurse_email]) {
        userStats[audit.nurse_email] = {
          email: audit.nurse_email,
          name: audit.nurse_name,
          totalAudits: 0,
          totalScore: 0,
          violations: 0
        };
      }
      userStats[audit.nurse_email].totalAudits++;
      userStats[audit.nurse_email].totalScore += audit.compliance_score || 0;
    });

    allViolations.forEach(v => {
      if (userStats[v.user_email]) {
        userStats[v.user_email].violations++;
      }
    });

    return Object.values(userStats)
      .map(u => ({
        ...u,
        avgScore: u.totalAudits > 0 ? (u.totalScore / u.totalAudits).toFixed(1) : 0
      }))
      .sort((a, b) => parseFloat(b.avgScore) - parseFloat(a.avgScore));
  }, [allAudits, allViolations]);

  if (!canAccess) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
            <p className="text-gray-600">This dashboard is only accessible to administrators and agency managers.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries();
    }}>
      <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto">
         {/* Header */}
         <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-2 sm:gap-0">
           <div>
             <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
               <Shield className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 text-blue-600" />
               Compliance
             </h1>
             <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              {isAgencyAdmin ? 'Agency-wide compliance monitoring' : 'System-wide compliance monitoring'}
            </p>
          </div>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-28 sm:w-32 text-xs sm:text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 Days</SelectItem>
              <SelectItem value="30">30 Days</SelectItem>
              <SelectItem value="90">90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-4 sm:mb-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-2 sm:p-3 md:p-4">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-blue-600 mb-1 sm:mb-2" />
            <p className="text-base sm:text-lg md:text-xl lg:text-2xl font-bold text-gray-900">{metrics.avgScore}%</p>
            <p className="text-[10px] sm:text-xs text-gray-600">Avg Score</p>
          </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
           <CardContent className="p-2 sm:p-3 md:p-4">
             <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-red-600 mb-1 sm:mb-2" />
             <p className="text-base sm:text-lg md:text-xl lg:text-2xl font-bold text-gray-900">{metrics.openViolations}</p>
             <p className="text-[10px] sm:text-xs text-gray-600">Issues</p>
           </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
           <CardContent className="p-3 sm:p-4">
             <XCircle className="w-6 sm:w-8 h-6 sm:h-8 text-orange-600 mb-2" />
             <p className="text-xl sm:text-2xl font-bold text-gray-900">{metrics.criticalOpen}</p>
             <p className="text-xs text-gray-600">Critical Issues</p>
           </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
           <CardContent className="p-3 sm:p-4">
             <CheckCircle2 className="w-6 sm:w-8 h-6 sm:h-8 text-green-600 mb-2" />
             <p className="text-xl sm:text-2xl font-bold text-gray-900">{metrics.passedAudits}</p>
             <p className="text-xs text-gray-600">Passed Audits</p>
           </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="violations" className="space-y-4 sm:space-y-6">
          <div className="w-full overflow-x-auto">
          <TabsList className="grid w-max min-w-full gap-1 p-1 grid-cols-4">
            <TabsTrigger value="violations" className="text-[10px] sm:text-xs md:text-sm px-1.5 sm:px-3 whitespace-nowrap">
              Issues
            </TabsTrigger>
            <TabsTrigger value="trends" className="text-[10px] sm:text-xs md:text-sm px-1.5 sm:px-3 whitespace-nowrap">Trends</TabsTrigger>
            <TabsTrigger value="users" className="text-[10px] sm:text-xs md:text-sm px-1.5 sm:px-3 whitespace-nowrap">Perf</TabsTrigger>
            <TabsTrigger value="audits" className="text-[10px] sm:text-xs md:text-sm px-1.5 sm:px-3 whitespace-nowrap">Audits</TabsTrigger>
          </TabsList>
          </div>

          {/* Violations Tab */}
          <TabsContent value="violations" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search violations..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 text-sm"
                    />
                  </div>
                  <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Severities</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-full sm:w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Auto-Fixable Issues */}
            {metrics.autoFixableCount > 0 && (
              <Card className="border-2 border-green-300 bg-green-50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Wand2 className="w-6 h-6 text-green-600" />
                      <div>
                        <p className="font-semibold text-green-900">
                          {metrics.autoFixableCount} issues can be auto-fixed
                        </p>
                        <p className="text-sm text-green-700">
                          Use one-click resolution to quickly resolve common compliance issues
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Violations List */}
            <div className="space-y-3">
              {filteredViolations.length === 0 ? (
                <Card>
                  <CardContent className="p-12 text-center">
                    <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <p className="text-gray-600">
                      {filterStatus === 'open' ? 'No open compliance issues!' : 'No violations found'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                filteredViolations.map((violation, idx) => (
                  <Card
                    key={idx}
                    className={`border-l-4 ${
                      violation.severity === 'critical' ? 'border-l-red-500 bg-red-50' :
                      violation.severity === 'high' ? 'border-l-orange-500 bg-orange-50' :
                      violation.severity === 'medium' ? 'border-l-yellow-500 bg-yellow-50' :
                      'border-l-blue-500 bg-blue-50'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold">{violation.rule_name}</h4>
                            <Badge className={
                              violation.severity === 'critical' ? 'bg-red-600' :
                              violation.severity === 'high' ? 'bg-orange-600' :
                              violation.severity === 'medium' ? 'bg-yellow-600' :
                              'bg-blue-600'
                            }>
                              {violation.severity}
                            </Badge>
                            <Badge variant={violation.status === 'open' ? 'default' : 'secondary'}>
                              {violation.status}
                            </Badge>
                            {violation.auto_fix_available && (
                              <Badge className="bg-green-600">
                                <Wand2 className="w-3 h-3 mr-1" />
                                Auto-Fix
                              </Badge>
                            )}
                          </div>

                          <p className="text-sm text-gray-700 mb-2">{violation.violation_description}</p>

                          {violation.recommended_action && (
                            <div className="bg-white p-2 rounded border border-gray-200 mb-2">
                              <p className="text-xs font-semibold text-gray-700">Recommended Action:</p>
                              <p className="text-xs text-gray-600">{violation.recommended_action}</p>
                            </div>
                          )}

                          {violation.suggested_fix && (
                            <div className="bg-blue-50 p-2 rounded border border-blue-200 mb-2">
                              <p className="text-xs font-semibold text-blue-700">💡 AI Suggested Fix:</p>
                              <p className="text-xs text-blue-600 whitespace-pre-wrap">{violation.suggested_fix.substring(0, 150)}...</p>
                            </div>
                          )}

                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>{violation.user_email}</span>
                            <span>•</span>
                            <span>{formatEastern(violation.created_date, 'MMM d, yyyy h:mm a')}</span>
                            <span>•</span>
                            <span className="capitalize">{violation.detection_method || 'manual'}</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedViolation(violation);
                              setDetailDialog(true);
                            }}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {violation.status === 'open' && (
                            <Button
                              size="sm"
                              onClick={() => {
                                const notes = prompt("Enter resolution notes (optional):");
                                resolveViolationMutation.mutate({
                                  id: violation.id,
                                  resolution_notes: notes || 'Manually resolved'
                                });
                              }}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Resolve
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Trends Tab */}
          <TabsContent value="trends" className="space-y-6">
            {/* Compliance Score Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  Compliance Score Trend
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2 sm:p-4">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={complianceTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload?.length && payload[0].value !== null) {
                          return (
                            <div className="bg-white p-3 border rounded shadow">
                              <p className="text-sm font-semibold">{payload[0].payload.date}</p>
                              <p className="text-sm text-blue-600">Score: {payload[0].value}%</p>
                              <p className="text-xs text-gray-500">{payload[0].payload.audits} audits</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#3B82F6"
                      strokeWidth={3}
                      dot={{ fill: '#3B82F6' }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* Violations by Severity */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-orange-600" />
                    Open Issues by Severity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {violationsBySeverity.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={violationsBySeverity}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, value }) => `${name}: ${value}`}
                          outerRadius={80}
                          dataKey="value"
                        >
                          {violationsBySeverity.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-8 text-gray-500">No open violations</div>
                  )}
                </CardContent>
              </Card>

              {/* Violations by Category */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-purple-600" />
                    Issues by Category
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {violationsByCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={violationsByCategory}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#8B5CF6" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-8 text-gray-500">No violations to display</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* User Performance Tab */}
          <TabsContent value="users" className="space-y-4">
            {/* AI Feedback Summary */}
            <Card className="border-purple-200 bg-purple-50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-600" />
                AI Suggestions Impact
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-purple-900">
                    {allViolations.filter(v => v.ai_feedback === 'helpful').length}
                  </p>
                  <p className="text-xs text-purple-700">Helpful Suggestions</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-purple-900">
                    {allViolations.filter(v => v.auto_fix_available).length}
                  </p>
                  <p className="text-xs text-purple-700">Auto-Fixable Issues</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-purple-900">
                    {allViolations.filter(v => v.status === 'resolved' && v.resolution_notes?.includes('Auto-fixed')).length}
                  </p>
                  <p className="text-xs text-purple-700">Auto-Resolved</p>
                </div>
              </div>
            </CardContent>
            </Card>

            {/* Proactive Risk Prediction for High-Risk Patients */}
            {(() => {
            const highRiskPatients = Array.from(new Set(
              allViolations
                .filter(v => v.severity === 'critical' || v.severity === 'high')
                .map(v => v.entity_id)
            )).slice(0, 3);

            return highRiskPatients.length > 0 && (
              <div className="space-y-4">
                {highRiskPatients.map(entityId => {
                  const patientVisits = allViolations.filter(v => v.entity_id === entityId);
                  const patientId = patientVisits[0]?.entity_type === 'visit' ? 
                    visits?.find(v => v.id === entityId)?.patient_id : 
                    carePlans?.find(cp => cp.id === entityId)?.patient_id;

                  return patientId && (
                    <ProactiveComplianceRiskPredictor 
                      key={patientId}
                      patientId={patientId}
                      autoAnalyze={false}
                    />
                  );
                })}
              </div>
            );
            })()}

            {/* AI Care Plan Suggestions */}
            {(() => {
            const patientsWithGaps = Array.from(new Set(
              allViolations
                .filter(v => v.status === 'open')
                .map(v => v.entity_id)
            )).slice(0, 2);

            return patientsWithGaps.length > 0 && (
              <div className="space-y-4">
                {patientsWithGaps.map(entityId => {
                  const patientVisits = allViolations.filter(v => v.entity_id === entityId);
                  const patientId = patientVisits[0]?.entity_type === 'visit' ? 
                    visits?.find(v => v.id === entityId)?.patient_id : 
                    carePlans?.find(cp => cp.id === entityId)?.patient_id;

                  return patientId && (
                    <AIComplianceCarePlanSuggester 
                      key={patientId}
                      patientId={patientId}
                      autoGenerate={false}
                    />
                  );
                })}
              </div>
            );
            })()}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  User Compliance Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left p-2">User</th>
                        <th className="text-center p-2">Audits</th>
                        <th className="text-center p-2">Avg Score</th>
                        <th className="text-center p-2">Violations</th>
                        <th className="text-center p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userPerformance.slice(0, 20).map((user, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="p-2">
                            <div>
                              <p className="font-medium">{user.name || user.email}</p>
                              <p className="text-xs text-gray-500">{user.email}</p>
                            </div>
                          </td>
                          <td className="text-center p-2">{user.totalAudits}</td>
                          <td className="text-center p-2">
                            <Badge className={
                              parseFloat(user.avgScore) >= 90 ? 'bg-green-600' :
                              parseFloat(user.avgScore) >= 75 ? 'bg-yellow-600' :
                              'bg-red-600'
                            }>
                              {user.avgScore}%
                            </Badge>
                          </td>
                          <td className="text-center p-2">
                            {user.violations > 0 ? (
                              <Badge className="bg-red-600">{user.violations}</Badge>
                            ) : (
                              <span className="text-gray-400">0</span>
                            )}
                          </td>
                          <td className="text-center p-2">
                            {parseFloat(user.avgScore) >= 85 && user.violations === 0 ? (
                              <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto" />
                            ) : (
                              <AlertTriangle className="w-5 h-5 text-orange-600 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {userPerformance.length === 0 && (
                    <div className="text-center py-8 text-gray-500">No user data available</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit History Tab */}
          <TabsContent value="audits" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Recent Compliance Audits
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {allAudits.slice(0, 20).map((audit, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${
                        audit.status === 'passed' ? 'bg-green-50 border-green-200' :
                        audit.status === 'critical' ? 'bg-red-50 border-red-200' :
                        'bg-yellow-50 border-yellow-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{audit.nurse_name || audit.nurse_email}</span>
                            <Badge className={
                              audit.status === 'passed' ? 'bg-green-600' :
                              audit.status === 'critical' ? 'bg-red-600' :
                              'bg-yellow-600'
                            }>
                              {audit.status}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {audit.audit_type}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-600">
                            {formatEastern(audit.audit_date, 'MMM d, yyyy h:mm a')}
                          </p>
                          {audit.issues_found?.length > 0 && (
                            <p className="text-xs text-gray-700 mt-1">
                              {audit.issues_found.length} issue{audit.issues_found.length !== 1 ? 's' : ''} found
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                         <p className="text-2xl font-bold">{audit.compliance_score}%</p>
                        </div>
                        </div>
                        </div>
                        ))}
                        </div>
                        </CardContent>
                        </Card>
                        </TabsContent>
                        </Tabs>

        {/* Violation Detail Dialog */}
        <Dialog open={detailDialog} onOpenChange={setDetailDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                Compliance Issue Details
              </DialogTitle>
            </DialogHeader>

            {selectedViolation && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-semibold">Rule</Label>
                  <p className="text-sm mt-1">{selectedViolation.rule_name}</p>
                </div>

                <div>
                  <Label className="text-sm font-semibold">Description</Label>
                  <p className="text-sm mt-1">{selectedViolation.violation_description}</p>
                </div>

                <div className="flex gap-2">
                  <Badge className={
                    selectedViolation.severity === 'critical' ? 'bg-red-600' :
                    selectedViolation.severity === 'high' ? 'bg-orange-600' :
                    'bg-yellow-600'
                  }>
                    {selectedViolation.severity}
                  </Badge>
                  <Badge>{selectedViolation.status}</Badge>
                </div>

                {selectedViolation.recommended_action && (
                  <div>
                    <Label className="text-sm font-semibold">Recommended Action</Label>
                    <p className="text-sm mt-1 p-3 bg-blue-50 rounded border border-blue-200">
                      {selectedViolation.recommended_action}
                    </p>
                  </div>
                )}

                {selectedViolation.auto_fix_available && selectedViolation.entity_id && (
                  <OneClickComplianceFixer
                    issue={selectedViolation}
                    documentContent={selectedViolation.document_analyzed || ""}
                    violationId={selectedViolation.id}
                    applyToEntity={true}
                    onFixed={(fixedContent, changes) => {
                      toast.success("Issue auto-fixed: " + changes);
                      setDetailDialog(false);
                      queryClient.invalidateQueries({ queryKey: ['allComplianceViolations'] });
                    }}
                  />
                )}

                {/* Manual Fix Guidance */}
                {!selectedViolation.auto_fix_available && selectedViolation.suggested_fix && (
                  <Card className="border-blue-200 bg-blue-50">
                    <CardHeader>
                      <CardTitle className="text-sm">Manual Fix Guidance</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs whitespace-pre-wrap bg-white p-3 rounded border">
                        {selectedViolation.suggested_fix}
                      </pre>
                      <p className="text-xs text-blue-700 mt-2">
                        Please apply this correction manually to the documentation
                      </p>
                    </CardContent>
                  </Card>
                )}

                {selectedViolation.status === 'open' && (
                  <Button
                    onClick={() => {
                      const notes = prompt("Enter resolution notes:");
                      if (notes) {
                        resolveViolationMutation.mutate({
                          id: selectedViolation.id,
                          resolution_notes: notes
                        });
                        setDetailDialog(false);
                      }
                    }}
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    Mark as Resolved
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PullToRefresh>
  );
}