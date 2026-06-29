import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  FileText,
  AlertTriangle,
  CheckCircle2,
  Activity
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ComplianceTrendsDashboard() {
  const [timeRange, setTimeRange] = useState("30");
  const [selectedNurse, setSelectedNurse] = useState("all");

  useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: audits = [] } = useQuery({
    queryKey: ['complianceAudits', timeRange],
    queryFn: async () => {
      const daysAgo = parseInt(timeRange);
      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - daysAgo);
      
      const allAudits = await base44.entities.ComplianceAudit.list('-audit_date', 500);
      return allAudits.filter(a => new Date(a.audit_date) >= dateThreshold);
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list('-created_date', 5000),
    initialData: [],
  });

  const { data: patients = [] } = useQuery({
    // Namespaced + limited: the bare ['patients'] key collided with active-only
    // ['patients'] queries elsewhere, and the missing limit capped trends at 50.
    queryKey: ['patients', 'all', 5000],
    queryFn: () => base44.entities.Patient.list('-created_date', 5000),
    initialData: [],
  });

  // Calculate trends
  const calculateTrends = () => {
    const filtered = selectedNurse === 'all' 
      ? audits 
      : audits.filter(a => a.nurse_email === selectedNurse);

    const avgScore = filtered.length > 0 
      ? filtered.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / filtered.length 
      : 0;

    const passed = filtered.filter(a => a.status === 'passed').length;
    const flagged = filtered.filter(a => a.status === 'flagged').length;
    const critical = filtered.filter(a => a.status === 'critical').length;

    // Group by nurse
    const byNurse = {};
    audits.forEach(audit => {
      if (!byNurse[audit.nurse_email]) {
        byNurse[audit.nurse_email] = { total: 0, score: 0, count: 0 };
      }
      byNurse[audit.nurse_email].score += audit.compliance_score || 0;
      byNurse[audit.nurse_email].count += 1;
    });

    const nurseStats = Object.entries(byNurse).map(([email, data]) => ({
      email,
      name: users.find(u => u.email === email)?.full_name || email,
      avgScore: data.count > 0 ? (data.score / data.count) : 0,
      auditCount: data.count
    })).sort((a, b) => b.avgScore - a.avgScore);

    // Group by patient
    const byPatient = {};
    audits.forEach(audit => {
      if (!byPatient[audit.patient_id]) {
        byPatient[audit.patient_id] = { total: 0, score: 0, count: 0 };
      }
      byPatient[audit.patient_id].score += audit.compliance_score || 0;
      byPatient[audit.patient_id].count += 1;
    });

    const patientStats = Object.entries(byPatient).map(([id, data]) => {
      const patient = patients.find(p => p.id === id);
      return {
        id,
        name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
        avgScore: data.count > 0 ? (data.score / data.count) : 0,
        auditCount: data.count
      };
    }).sort((a, b) => a.avgScore - b.avgScore);

    // Most common issues
    const issueTypes = {};
    audits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const key = issue.element || 'Other';
        issueTypes[key] = (issueTypes[key] || 0) + 1;
      });
    });

    const topIssues = Object.entries(issueTypes)
      .map(([element, count]) => ({ element, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      avgScore: Math.round(avgScore),
      passed,
      flagged,
      critical,
      total: filtered.length,
      nurseStats: nurseStats.slice(0, 10),
      patientStats: patientStats.slice(0, 10),
      topIssues
    };
  };

  const trends = calculateTrends();

  const getScoreColor = (score) => {
    if (score >= 90) return "text-green-600";
    if (score >= 80) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBg = (score) => {
    if (score >= 90) return "bg-green-100 border-green-300";
    if (score >= 80) return "bg-yellow-100 border-yellow-300";
    return "bg-red-100 border-red-300";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Compliance Trends Dashboard</h2>
          <p className="text-sm text-slate-600">Track documentation quality and compliance over time</p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 6 months</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={selectedNurse} onValueChange={setSelectedNurse}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Nurses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Nurses</SelectItem>
              {users.map(user => (
                <SelectItem key={user.email} value={user.email}>
                  {user.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className={getScoreBg(trends.avgScore)}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Average Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getScoreColor(trends.avgScore)}`}>
              {trends.avgScore}%
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-50 border-green-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Passed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600 flex items-center gap-2">
              <CheckCircle2 className="w-8 h-8" />
              {trends.passed}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-yellow-50 border-yellow-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Flagged</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600 flex items-center gap-2">
              <AlertTriangle className="w-8 h-8" />
              {trends.flagged}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-50 border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 flex items-center gap-2">
              <Activity className="w-8 h-8" />
              {trends.critical}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for detailed views */}
      <Tabs defaultValue="nurses" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="nurses">By Nurse</TabsTrigger>
          <TabsTrigger value="patients">By Patient</TabsTrigger>
          <TabsTrigger value="issues">Common Issues</TabsTrigger>
        </TabsList>

        <TabsContent value="nurses" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Top Performing Nurses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {trends.nurseStats.map((nurse, idx) => (
                  <div key={nurse.email} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-lg text-slate-500 w-6">#{idx + 1}</div>
                      <div>
                        <p className="font-medium text-slate-900">{nurse.name}</p>
                        <p className="text-xs text-slate-600">{nurse.auditCount} audits</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getScoreBg(nurse.avgScore)}>
                        <span className={getScoreColor(nurse.avgScore)}>{Math.round(nurse.avgScore)}%</span>
                      </Badge>
                      {idx === 0 && nurse.avgScore >= 90 && (
                        <TrendingUp className="w-5 h-5 text-green-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patients" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Patients Needing Attention
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {trends.patientStats.map((patient, _idx) => (
                  <div key={patient.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{patient.name}</p>
                        <p className="text-xs text-slate-600">{patient.auditCount} visits audited</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getScoreBg(patient.avgScore)}>
                        <span className={getScoreColor(patient.avgScore)}>{Math.round(patient.avgScore)}%</span>
                      </Badge>
                      {patient.avgScore < 80 && (
                        <TrendingDown className="w-5 h-5 text-red-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issues" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Most Common Compliance Issues
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {trends.topIssues.map((issue, idx) => (
                  <div key={issue.element} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-lg text-slate-500 w-6">#{idx + 1}</div>
                      <p className="font-medium text-slate-900">{issue.element}</p>
                    </div>
                    <Badge variant="outline" className="text-red-600 border-red-300">
                      {issue.count} occurrences
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}