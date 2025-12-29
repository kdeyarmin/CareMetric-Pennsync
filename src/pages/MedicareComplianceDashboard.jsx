import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import PremiumFeatureGate from "../components/subscription/PremiumFeatureGate";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Shield,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  FileText,
  Calendar,
  BarChart3,
  Download,
  Sparkles
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { format, subDays, startOfDay } from "date-fns";
import ComplianceReportGenerator from "../components/compliance/ComplianceReportGenerator";
import ProactiveComplianceMonitor from "../components/compliance/ProactiveComplianceMonitor";
import AdvancedComplianceRiskScoring from "../components/compliance/AdvancedComplianceRiskScoring";
import AITrainingModuleGenerator from "../components/training/AITrainingModuleGenerator";
import AIComplianceAssistant from "../components/compliance/AIComplianceAssistant";
import AIComplianceAuditor from "../components/compliance/AIComplianceAuditor";

export default function MedicareComplianceDashboard() {
  const [timeRange, setTimeRange] = useState(30);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const [aiInsights, setAIInsights] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: audits = [] } = useQuery({
    queryKey: ['myComplianceAudits', timeRange, currentUser?.email],
    queryFn: async () => {
      // Only get current nurse's audits
      return base44.entities.ComplianceAudit.filter({ nurse_email: currentUser?.email }, '-audit_date', 1000);
    },
    enabled: !!currentUser?.email,
    initialData: [],
  });

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  // Filter audits by time range
  const cutoffDate = subDays(new Date(), timeRange);
  const filteredAudits = audits.filter(audit => {
    const auditDate = new Date(audit.audit_date || audit.created_date);
    return auditDate >= cutoffDate;
  });

  // Calculate metrics
  const avgComplianceScore = filteredAudits.length > 0
    ? filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / filteredAudits.length
    : 0;

  const criticalIssuesCount = filteredAudits.reduce((sum, a) => 
    sum + (a.issues?.filter(i => i.severity === 'critical').length || 0), 0
  );

  const totalIssuesCount = filteredAudits.reduce((sum, a) => 
    sum + (a.issues?.length || 0), 0
  );

  // Trend data - daily averages
  const trendData = [];
  const daysToShow = Math.min(timeRange, 30);
  for (let i = daysToShow - 1; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const dateStr = format(date, 'MMM dd');
    const dayAudits = filteredAudits.filter(a => {
      const auditDate = startOfDay(new Date(a.audit_date || a.created_date));
      return auditDate.getTime() === startOfDay(date).getTime();
    });
    
    if (dayAudits.length > 0) {
      const avgScore = dayAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / dayAudits.length;
      trendData.push({
        date: dateStr,
        score: Math.round(avgScore),
        audits: dayAudits.length
      });
    }
  }

  // Issue frequency analysis
  const issueFrequency = {};
  filteredAudits.forEach(audit => {
    (audit.issues || []).forEach(issue => {
      const key = issue.element || 'Unknown';
      if (!issueFrequency[key]) {
        issueFrequency[key] = {
          count: 0,
          severity: issue.severity || 'medium',
          cop_reference: issue.cop_reference || 'N/A'
        };
      }
      issueFrequency[key].count++;
    });
  });

  const topIssues = Object.entries(issueFrequency)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([issue, data]) => ({
      name: issue,
      count: data.count,
      severity: data.severity,
      cop_reference: data.cop_reference,
      percentage: ((data.count / filteredAudits.length) * 100).toFixed(1)
    }));

  // Rule violation frequency
  const ruleViolations = medicareRules.map(rule => {
    const violations = filteredAudits.reduce((count, audit) => {
      const ruleIssues = (audit.issues || []).filter(i => 
        i.element?.toLowerCase().includes(rule.rule_name.toLowerCase()) ||
        i.cop_reference === rule.cop_reference
      );
      return count + ruleIssues.length;
    }, 0);
    
    return {
      rule: rule.rule_name,
      cop: rule.cop_reference,
      violations: violations,
      severity: rule.severity
    };
  }).filter(r => r.violations > 0).sort((a, b) => b.violations - a.violations);

  const generateAIInsights = async () => {
    setIsGeneratingInsights(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze Medicare compliance data for an independent home health nurse and provide personalized insights.

COMPLIANCE METRICS:
- Time Period: Last ${timeRange} days
- Total Audits: ${filteredAudits.length}
- Average Compliance Score: ${avgComplianceScore.toFixed(1)}%
- Critical Issues: ${criticalIssuesCount}
- Total Issues: ${totalIssuesCount}

TOP 5 MOST FREQUENT ISSUES IN MY DOCUMENTATION:
${topIssues.slice(0, 5).map(i => `- ${i.name}: ${i.count} occurrences (${i.percentage}% of audits) - ${i.cop_reference}`).join('\n')}

TOP RULE VIOLATIONS:
${ruleViolations.slice(0, 5).map(r => `- ${r.rule} (${r.cop}): ${r.violations} violations`).join('\n')}

Provide personalized insights for this individual nurse:

1. OVERALL ASSESSMENT: My current compliance performance (excellent, good, needs improvement, critical)
2. CRITICAL PRIORITIES: Top 3 areas I need to focus on immediately with specific CoP references
3. LEARNING OPPORTUNITIES: Patterns showing where I need more training or practice
4. PERSONAL DEVELOPMENT: Specific recommendations for improving my documentation
5. RISK AREAS: Which 42 CFR 484 requirements I struggle with most
6. ACTION PLAN: My personalized 30-day improvement plan with measurable goals
7. TREND ANALYSIS: Am I improving, staying stable, or declining
8. LEARNING FOCUS: Where to focus my training and skill development

Focus on Medicare CoP compliance for individual nurse practice improvement.

Return JSON with sections: overall_assessment, critical_priorities (array), learning_opportunities (array), personal_development (array), risk_areas (array), action_plan (array), trend_analysis, learning_focus (array).`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_assessment: { type: "string" },
            critical_priorities: { 
              type: "array", 
              items: { 
                type: "object",
                properties: {
                  priority: { type: "string" },
                  cop_reference: { type: "string" },
                  impact: { type: "string" },
                  timeline: { type: "string" }
                }
              }
            },
            learning_opportunities: { type: "array", items: { type: "string" } },
            personal_development: { type: "array", items: { type: "string" } },
            risk_areas: { 
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  cop_reference: { type: "string" },
                  risk_level: { type: "string" }
                }
              }
            },
            action_plan: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  owner: { type: "string" },
                  timeline: { type: "string" },
                  success_metric: { type: "string" }
                }
              }
            },
            trend_analysis: { type: "string" },
            learning_focus: { type: "array", items: { type: "string" } }
          }
        }
      });

      setAIInsights(result);
    } catch (error) {
      console.error('Error generating insights:', error);
      alert('Failed to generate insights. Please try again.');
    }
    setIsGeneratingInsights(false);
  };

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  return (
    <PremiumFeatureGate
      featureName="Medicare Compliance Dashboard"
      featureDescription="Monitor your Medicare compliance with real-time scoring, AI-powered insights, and personalized improvement plans. This premium feature ensures you stay audit-ready."
      allowTrial={true}
    >
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">My Medicare Compliance</h1>
              <p className="text-gray-600">Personal Compliance Tracking & Improvement</p>
            </div>
          </div>
          <Button onClick={generateAIInsights} disabled={isGeneratingInsights}>
            {isGeneratingInsights ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Analyzing...
              </>
            ) : (
              <>
                <BarChart3 className="w-4 h-4 mr-2" />
                Generate AI Insights
              </>
            )}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={timeRange.toString()} onValueChange={(v) => setTimeRange(parseInt(v))}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="60">Last 60 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm mb-1">My Avg Compliance</p>
                <p className="text-4xl font-bold">{avgComplianceScore.toFixed(1)}%</p>
              </div>
              <Shield className="w-12 h-12 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-100 text-sm mb-1">Critical Issues</p>
                <p className="text-4xl font-bold">{criticalIssuesCount}</p>
              </div>
              <AlertTriangle className="w-12 h-12 text-red-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm mb-1">My Total Issues</p>
                <p className="text-4xl font-bold">{totalIssuesCount}</p>
              </div>
              <FileText className="w-12 h-12 text-orange-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm mb-1">My Audits</p>
                <p className="text-4xl font-bold">{filteredAudits.length}</p>
              </div>
              <Calendar className="w-12 h-12 text-green-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Insights */}
      {aiInsights && (
        <Card className="mb-8 border-2 border-purple-300 bg-gradient-to-r from-purple-50 to-pink-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              AI Strategic Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Overall Assessment */}
            <div className="bg-white p-4 rounded-lg border-2 border-purple-200">
              <h3 className="font-bold text-purple-900 mb-2">Overall Assessment</h3>
              <p className="text-gray-700">{aiInsights.overall_assessment}</p>
            </div>

            {/* Critical Priorities */}
            <div>
              <h3 className="font-bold text-gray-900 mb-3">My Critical Focus Areas</h3>
              <div className="space-y-2">
                {aiInsights.critical_priorities?.map((priority, idx) => (
                  <Card key={idx} className="border-l-4 border-l-red-500 bg-red-50">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold text-red-900">{priority.priority}</p>
                          <Badge variant="outline" className="mt-1 text-xs">{priority.cop_reference}</Badge>
                          <p className="text-sm text-red-800 mt-2">{priority.impact}</p>
                        </div>
                        <Badge className="bg-red-600">{priority.timeline}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Learning Opportunities */}
            {aiInsights.learning_opportunities?.length > 0 && (
              <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                <h3 className="font-bold text-blue-900 mb-2">My Learning Opportunities</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                  {aiInsights.learning_opportunities.map((opp, idx) => (
                    <li key={idx}>• {opp}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Personal Development */}
            {aiInsights.personal_development?.length > 0 && (
              <div className="bg-green-50 p-4 rounded-lg border-2 border-green-200">
                <h3 className="font-bold text-green-900 mb-2">Personal Development Recommendations</h3>
                <ul className="text-sm text-green-800 space-y-1">
                  {aiInsights.personal_development.map((dev, idx) => (
                    <li key={idx}>• {dev}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 30-Day Action Plan */}
            <div>
              <h3 className="font-bold text-gray-900 mb-3">My 30-Day Improvement Plan</h3>
              <div className="space-y-2">
                {aiInsights.action_plan?.map((action, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-blue-600">{idx + 1}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{action.action}</p>
                      <div className="flex gap-3 mt-1 text-xs text-gray-600">
                        <span><strong>Timeline:</strong> {action.timeline}</span>
                        <span><strong>Success Metric:</strong> {action.success_metric}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Learning Focus */}
            {aiInsights.learning_focus?.length > 0 && (
              <div className="bg-purple-50 p-4 rounded-lg border-2 border-purple-200">
                <h3 className="font-bold text-purple-900 mb-2">My Learning Focus Areas</h3>
                <ul className="text-sm text-purple-800 space-y-1">
                  {aiInsights.learning_focus.map((focus, idx) => (
                    <li key={idx}>• {focus}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Trend Analysis */}
            <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
              <h3 className="font-bold text-blue-900 mb-2">Trend Analysis</h3>
              <p className="text-gray-700">{aiInsights.trend_analysis}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="risk">Risk Scoring</TabsTrigger>
          <TabsTrigger value="trends">My Trends</TabsTrigger>
          <TabsTrigger value="issues">My Issues</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Compliance Score Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Compliance Score Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: '90-100% (Excellent)', value: filteredAudits.filter(a => a.compliance_score >= 90).length, color: '#10B981' },
                        { name: '80-89% (Good)', value: filteredAudits.filter(a => a.compliance_score >= 80 && a.compliance_score < 90).length, color: '#3B82F6' },
                        { name: '70-79% (Fair)', value: filteredAudits.filter(a => a.compliance_score >= 70 && a.compliance_score < 80).length, color: '#F59E0B' },
                        { name: '<70% (Poor)', value: filteredAudits.filter(a => a.compliance_score < 70).length, color: '#EF4444' }
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {[
                        { name: '90-100%', value: filteredAudits.filter(a => a.compliance_score >= 90).length, color: '#10B981' },
                        { name: '80-89%', value: filteredAudits.filter(a => a.compliance_score >= 80 && a.compliance_score < 90).length, color: '#3B82F6' },
                        { name: '70-79%', value: filteredAudits.filter(a => a.compliance_score >= 70 && a.compliance_score < 80).length, color: '#F59E0B' },
                        { name: '<70%', value: filteredAudits.filter(a => a.compliance_score < 70).length, color: '#EF4444' }
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Issue Severity Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Issue Severity Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {['critical', 'high', 'medium', 'low'].map(severity => {
                    const count = filteredAudits.reduce((sum, a) => 
                      sum + (a.issues?.filter(i => i.severity === severity).length || 0), 0
                    );
                    const color = severity === 'critical' ? 'red' : severity === 'high' ? 'orange' : severity === 'medium' ? 'yellow' : 'blue';
                    
                    return (
                      <div key={severity}>
                        <div className="flex justify-between mb-1">
                          <span className="text-sm capitalize font-medium">{severity}</span>
                          <span className="text-sm font-bold">{count}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`bg-${color}-500 h-2 rounded-full`}
                            style={{ width: `${totalIssuesCount > 0 ? (count / totalIssuesCount * 100) : 0}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Proactive Monitor */}
          <ProactiveComplianceMonitor autoMonitor={true} />
        </TabsContent>

        {/* Risk Scoring Tab */}
        <TabsContent value="risk" className="space-y-6">
          <AdvancedComplianceRiskScoring
            timeRange={timeRange}
            audits={filteredAudits}
            autoAnalyze={true}
          />
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My Compliance Score Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#3B82F6" 
                    strokeWidth={3}
                    name="Compliance Score (%)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Daily Audit Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="audits" fill="#10B981" name="Audits Completed" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Top Issues Tab */}
        <TabsContent value="issues" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My Most Frequent Documentation Gaps</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={topIssues} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={200} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" fill="#EF4444" name="Occurrences" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Detailed Issue List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Issue Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topIssues.map((issue, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded border">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{issue.name}</span>
                        <Badge className={
                          issue.severity === 'critical' ? 'bg-red-600' :
                          issue.severity === 'high' ? 'bg-orange-600' :
                          issue.severity === 'medium' ? 'bg-yellow-600' : 'bg-blue-600'
                        }>
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">CoP Reference: {issue.cop_reference}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900">{issue.count}</p>
                      <p className="text-xs text-gray-600">{issue.percentage}% of audits</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Rule Violation Analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">42 CFR 484 Rule Violations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {ruleViolations.map((rule, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-white rounded border-l-4 border-l-red-500">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{rule.rule}</p>
                      <p className="text-xs text-gray-600">{rule.cop}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className="bg-red-600">{rule.violations} violations</Badge>
                      <Badge variant="outline">{rule.severity}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tools Tab */}
        <TabsContent value="tools" className="space-y-6">
          {/* AI-Driven Compliance Auditor */}
          <AIComplianceAuditor />
          
          {/* AI Compliance Q&A Assistant */}
          <AIComplianceAssistant />

          <div className="grid md:grid-cols-2 gap-6">
            <ComplianceReportGenerator dateRange={timeRange} nurseEmail={currentUser?.email} />
            <ProactiveComplianceMonitor autoMonitor={true} />
          </div>
          
          {/* AI Training Module Generator */}
          <Card className="border-2 border-purple-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                Generate Training from Compliance Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AITrainingModuleGenerator />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </PremiumFeatureGate>
  );
}