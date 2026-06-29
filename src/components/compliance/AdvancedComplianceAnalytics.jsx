import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  Calendar,
  BarChart3,
  Target,
  BookOpen,
  Zap
} from "lucide-react";
import { format, subMonths, parseISO, isWithinInterval } from "date-fns";

export default function AdvancedComplianceAnalytics({ 
  audits = [], 
  trainingCompletions = [],
  _nurses = [],
  _patients = []
}) {
  const [timeRange, setTimeRange] = useState("6m");
  const [selectedNurse, setSelectedNurse] = useState("all");
  const [_selectedCategory, _setSelectedCategory] = useState("all");

  // Calculate date range based on selection
  const dateRange = useMemo(() => {
    const end = new Date();
    let start;
    switch (timeRange) {
      case "1m": start = subMonths(end, 1); break;
      case "3m": start = subMonths(end, 3); break;
      case "6m": start = subMonths(end, 6); break;
      case "1y": start = subMonths(end, 12); break;
      default: start = subMonths(end, 6);
    }
    return { start, end };
  }, [timeRange]);

  // Filter audits by date range
  const filteredAudits = useMemo(() => {
    return audits.filter(audit => {
      if (!audit.audit_date) return false;
      const auditDate = parseISO(audit.audit_date);
      const inRange = isWithinInterval(auditDate, { start: dateRange.start, end: dateRange.end });
      const matchesNurse = selectedNurse === "all" || audit.nurse_email === selectedNurse;
      return inRange && matchesNurse;
    });
  }, [audits, dateRange, selectedNurse]);

  // Monthly trend data
  const monthlyTrends = useMemo(() => {
    const months = {};
    const monthCount = timeRange === "1y" ? 12 : timeRange === "6m" ? 6 : timeRange === "3m" ? 3 : 1;
    
    for (let i = monthCount - 1; i >= 0; i--) {
      const monthDate = subMonths(new Date(), i);
      const key = format(monthDate, 'MMM yyyy');
      months[key] = {
        month: format(monthDate, 'MMM'),
        fullMonth: key,
        totalAudits: 0,
        totalScore: 0,
        passed: 0,
        failed: 0,
        criticalIssues: 0,
        avgScore: 0
      };
    }

    filteredAudits.forEach(audit => {
      const monthKey = format(parseISO(audit.audit_date), 'MMM yyyy');
      if (months[monthKey]) {
        months[monthKey].totalAudits++;
        months[monthKey].totalScore += audit.compliance_score || 0;
        if (audit.status === 'passed') months[monthKey].passed++;
        else months[monthKey].failed++;
        months[monthKey].criticalIssues += audit.issues?.filter(i => i.severity === 'critical').length || 0;
      }
    });

    return Object.values(months).map(m => ({
      ...m,
      avgScore: m.totalAudits > 0 ? Math.round(m.totalScore / m.totalAudits) : 0,
      passRate: m.totalAudits > 0 ? Math.round((m.passed / m.totalAudits) * 100) : 0
    }));
  }, [filteredAudits, timeRange]);

  // Nurse performance rankings
  const nursePerformance = useMemo(() => {
    const performance = {};
    
    filteredAudits.forEach(audit => {
      const email = audit.nurse_email;
      if (!performance[email]) {
        performance[email] = {
          email,
          name: email?.split('@')[0] || 'Unknown',
          totalAudits: 0,
          totalScore: 0,
          passed: 0,
          issueCount: 0
        };
      }
      performance[email].totalAudits++;
      performance[email].totalScore += audit.compliance_score || 0;
      if (audit.status === 'passed') performance[email].passed++;
      performance[email].issueCount += audit.issues?.length || 0;
    });

    return Object.values(performance)
      .map(p => ({
        ...p,
        avgScore: p.totalAudits > 0 ? Math.round(p.totalScore / p.totalAudits) : 0,
        passRate: p.totalAudits > 0 ? Math.round((p.passed / p.totalAudits) * 100) : 0,
        avgIssues: p.totalAudits > 0 ? (p.issueCount / p.totalAudits).toFixed(1) : 0
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [filteredAudits]);

  // Organization-wide risk analysis
  const orgRisks = useMemo(() => {
    const categories = {};
    
    filteredAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const cat = categorizeIssue(issue.element || issue.problem || '');
        if (!categories[cat]) {
          categories[cat] = {
            category: cat,
            count: 0,
            critical: 0,
            high: 0,
            medium: 0,
            // 'low' is a valid severity in the auditor schema; without a counter
            // here `categories[cat]['low']++` did `undefined++` and wrote low: NaN.
            low: 0,
            affectedNurses: new Set(),
            trend: []
          };
        }
        categories[cat].count++;
        // Guard against any unexpected severity so we never write a NaN counter.
        if (categories[cat][issue.severity] === undefined) categories[cat][issue.severity] = 0;
        categories[cat][issue.severity || 'medium']++;
        categories[cat].affectedNurses.add(audit.nurse_email);
      });
    });

    return Object.values(categories)
      .map(c => ({
        ...c,
        affectedNurses: c.affectedNurses.size,
        riskScore: c.critical * 3 + c.high * 2 + c.medium
      }))
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [filteredAudits]);

  // Training impact analysis
  const trainingImpact = useMemo(() => {
    const nurseData = {};
    
    // Group audits by nurse and calculate before/after training scores
    filteredAudits.forEach(audit => {
      const email = audit.nurse_email;
      if (!nurseData[email]) {
        nurseData[email] = { email, beforeTraining: [], afterTraining: [] };
      }
      
      // Check if nurse completed training before this audit
      const completedTraining = trainingCompletions.some(tc => 
        tc.nurse_email === email && 
        tc.status === 'completed' &&
        tc.completion_date && 
        parseISO(tc.completion_date) < parseISO(audit.audit_date)
      );
      
      if (completedTraining) {
        nurseData[email].afterTraining.push(audit.compliance_score || 0);
      } else {
        nurseData[email].beforeTraining.push(audit.compliance_score || 0);
      }
    });

    const impact = Object.values(nurseData)
      .filter(n => n.beforeTraining.length > 0 && n.afterTraining.length > 0)
      .map(n => ({
        name: n.email?.split('@')[0] || 'Unknown',
        beforeAvg: Math.round(n.beforeTraining.reduce((a, b) => a + b, 0) / n.beforeTraining.length),
        afterAvg: Math.round(n.afterTraining.reduce((a, b) => a + b, 0) / n.afterTraining.length),
        improvement: 0
      }))
      .map(n => ({ ...n, improvement: n.afterAvg - n.beforeAvg }));

    return impact;
  }, [filteredAudits, trainingCompletions]);

  // Overall stats
  const overallStats = useMemo(() => {
    if (filteredAudits.length === 0) return null;
    
    const scores = filteredAudits.map(a => a.compliance_score || 0);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const passRate = Math.round(
      (filteredAudits.filter(a => a.status === 'passed').length / filteredAudits.length) * 100
    );
    const totalIssues = filteredAudits.reduce((sum, a) => sum + (a.issues?.length || 0), 0);
    
    // Calculate trend — only meaningful with at least two audits to split into two
    // halves. With a single audit, midpoint is 0 and recentAvg becomes 0/0 -> 0,
    // producing a bogus large "declining" trend against the real olderAvg.
    const midpoint = Math.floor(filteredAudits.length / 2);
    let trend = 0;
    if (filteredAudits.length >= 2 && midpoint > 0) {
      const recentAvg = filteredAudits.slice(0, midpoint).reduce((s, a) => s + (a.compliance_score || 0), 0) / midpoint;
      const olderAvg = filteredAudits.slice(midpoint).reduce((s, a) => s + (a.compliance_score || 0), 0) / (filteredAudits.length - midpoint);
      trend = recentAvg - olderAvg;
    }

    return { avgScore, passRate, totalAudits: filteredAudits.length, totalIssues, trend };
  }, [filteredAudits]);

  const uniqueNurses = useMemo(() => {
    const emails = new Set(audits.map(a => a.nurse_email).filter(Boolean));
    return Array.from(emails);
  }, [audits]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label className="text-xs text-slate-500">Time Range</Label>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">1 Month</SelectItem>
                  <SelectItem value="3m">3 Months</SelectItem>
                  <SelectItem value="6m">6 Months</SelectItem>
                  <SelectItem value="1y">1 Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Nurse</Label>
              <Select value={selectedNurse} onValueChange={setSelectedNurse}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Nurses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Nurses</SelectItem>
                  {uniqueNurses.map(email => (
                    <SelectItem key={email} value={email}>
                      {email?.split('@')[0]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex gap-2">
              <Badge variant="outline" className="h-9 px-3 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {format(dateRange.start, 'MMM d')} - {format(dateRange.end, 'MMM d, yyyy')}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      {overallStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold">{overallStats.avgScore}%</p>
              <p className="text-xs text-blue-100">Avg Score</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold">{overallStats.passRate}%</p>
              <p className="text-xs text-green-100">Pass Rate</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-navy-500 to-navy-600 text-white">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold">{overallStats.totalAudits}</p>
              <p className="text-xs text-navy-100">Total Audits</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold">{overallStats.totalIssues}</p>
              <p className="text-xs text-orange-100">Total Issues</p>
            </CardContent>
          </Card>
          <Card className={`bg-gradient-to-br ${overallStats.trend >= 0 ? 'from-emerald-500 to-emerald-600' : 'from-red-500 to-red-600'} text-white`}>
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-1">
                {overallStats.trend >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                <p className="text-2xl font-bold">{overallStats.trend >= 0 ? '+' : ''}{overallStats.trend.toFixed(1)}</p>
              </div>
              <p className="text-xs text-white/80">Score Trend</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trends">Long-term Trends</TabsTrigger>
          <TabsTrigger value="risks">Org Risks</TabsTrigger>
          <TabsTrigger value="training">Training Impact</TabsTrigger>
          <TabsTrigger value="nurses">Nurse Rankings</TabsTrigger>
        </TabsList>

        {/* Long-term Trends */}
        <TabsContent value="trends">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  Compliance Score Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="avgScore" stroke="#3557b0" fill="#3557b0" fillOpacity={0.3} name="Avg Score" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-green-600" />
                  Pass/Fail Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="passed" fill="#10b981" name="Passed" stackId="a" />
                      <Bar dataKey="failed" fill="#ef4444" name="Failed" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  Critical Issues Over Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="criticalIssues" stroke="#ef4444" strokeWidth={2} name="Critical Issues" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Organization Risks */}
        <TabsContent value="risks">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  Top Compliance Risks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {orgRisks.slice(0, 6).map((risk, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{risk.category}</span>
                        <Badge className={
                          risk.riskScore > 10 ? 'bg-red-100 text-red-800' :
                          risk.riskScore > 5 ? 'bg-orange-100 text-orange-800' :
                          'bg-yellow-100 text-yellow-800'
                        }>
                          Risk Score: {risk.riskScore}
                        </Badge>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <span className="text-slate-500">{risk.count} issues</span>
                        <span className="text-slate-300">|</span>
                        <span className="text-red-600">{risk.critical} critical</span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-500">{risk.affectedNurses} nurses affected</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-navy-600" />
                  Risk Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={orgRisks.slice(0, 8)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="category" type="category" width={100} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="critical" fill="#ef4444" name="Critical" stackId="a" />
                      <Bar dataKey="high" fill="#f97316" name="High" stackId="a" />
                      <Bar dataKey="medium" fill="#eab308" name="Medium" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Training Impact */}
        <TabsContent value="training">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-600" />
                  Training Impact on Scores
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trainingImpact.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trainingImpact}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="beforeAvg" fill="#94a3b8" name="Before Training" />
                        <Bar dataKey="afterAvg" fill="#10b981" name="After Training" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
                    Not enough data to show training impact yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-green-600" />
                  Improvement After Training
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {trainingImpact.length > 0 ? (
                    trainingImpact.sort((a, b) => b.improvement - a.improvement).map((nurse, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                        <span className="text-sm font-medium">{nurse.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{nurse.beforeAvg}% → {nurse.afterAvg}%</span>
                          <Badge className={nurse.improvement >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                            {nurse.improvement >= 0 ? '+' : ''}{nurse.improvement}%
                          </Badge>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-slate-500 text-sm py-8">
                      Complete more training modules to see impact data
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Nurse Rankings */}
        <TabsContent value="nurses">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" />
                Nurse Performance Rankings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Nurse</TableHead>
                    <TableHead className="text-center">Audits</TableHead>
                    <TableHead className="text-center">Avg Score</TableHead>
                    <TableHead className="text-center">Pass Rate</TableHead>
                    <TableHead className="text-center">Avg Issues</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nursePerformance.map((nurse, idx) => (
                    <TableRow key={nurse.email}>
                      <TableCell>
                        {idx < 3 ? (
                          <Badge className={
                            idx === 0 ? 'bg-gold-100 text-gold-800 border border-gold-300' :
                            idx === 1 ? 'bg-slate-200 text-slate-800' :
                            'bg-amber-100 text-amber-800 border border-amber-200'
                          }>
                            #{idx + 1}
                          </Badge>
                        ) : (
                          <span className="text-slate-500">#{idx + 1}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{nurse.name}</TableCell>
                      <TableCell className="text-center">{nurse.totalAudits}</TableCell>
                      <TableCell className="text-center">
                        <span className={nurse.avgScore >= 85 ? 'text-emerald-600 font-semibold' : nurse.avgScore >= 70 ? 'text-amber-600' : 'text-red-600'}>
                          {nurse.avgScore}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">{nurse.passRate}%</TableCell>
                      <TableCell className="text-center">{nurse.avgIssues}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={
                          nurse.avgScore >= 85 ? 'success' :
                          nurse.avgScore >= 70 ? 'warning' :
                          'destructive'
                        }>
                          {nurse.avgScore >= 85 ? 'Excellent' : nurse.avgScore >= 70 ? 'Good' : 'Needs Improvement'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper function
function categorizeIssue(text) {
  const lower = text.toLowerCase();
  if (lower.includes('homebound')) return 'Homebound Status';
  if (lower.includes('skilled')) return 'Skilled Need';
  if (lower.includes('vital')) return 'Vital Signs';
  if (lower.includes('assessment')) return 'Assessment';
  if (lower.includes('response') || lower.includes('teach')) return 'Patient Response';
  if (lower.includes('medication')) return 'Medication';
  if (lower.includes('care plan') || lower.includes('goal')) return 'Care Plan';
  if (lower.includes('functional') || lower.includes('adl')) return 'Functional Status';
  return 'General';
}