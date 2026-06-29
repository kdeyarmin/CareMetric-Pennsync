import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  Activity,
  Users,
  AlertTriangle,
  CheckCircle2,
  Target,
  BarChart3,
  Heart,
  Ambulance,
  Calendar,
  Download,
  Sparkles, // Added for AI Insights
  RefreshCw // Added for AI Insights loading
} from "lucide-react";
import { format, subDays, differenceInMinutes } from "date-fns";
import { escapeCsvField } from "@/components/admin/csvExport";

export default function QualityMetricsDashboard() {
  const [timeRange, setTimeRange] = useState("30");
  const [selectedNurse, setSelectedNurse] = useState("all");
  const [aiInsights, setAiInsights] = useState(null); // State for AI insights
  const [isGenerating, setIsGenerating] = useState(false); // State for AI insights loading

  // Calculate date range
  const getDateRange = () => {
    const today = new Date();
    const daysAgo = parseInt(timeRange, 10);
    return {
      start: format(subDays(today, daysAgo), 'yyyy-MM-dd'),
      end: format(today, 'yyyy-MM-dd')
    };
  };

  const dateRange = getDateRange();

  // Fetch data
  const { data: allVisits, isLoading: visitsLoading } = useQuery({
    queryKey: ['allVisitsMetrics', timeRange],
    queryFn: async () => {
      const visits = await base44.entities.Visit.list('-visit_date', 1000);
      return visits.filter(v => v.visit_date >= dateRange.start && v.visit_date <= dateRange.end);
    },
    initialData: [],
  });

  const { data: allPatients } = useQuery({
    queryKey: ['allPatientsMetrics'],
    // The sibling Visit/Incident/SecurityLog queries here pass limits; this one
    // didn't, so patient-derived metrics were capped at Base44's default 50.
    queryFn: () => base44.entities.Patient.list('-updated_date', 5000),
    initialData: [],
  });

  const { data: allIncidents } = useQuery({
    queryKey: ['allIncidentsMetrics', timeRange],
    queryFn: async () => {
      const incidents = await base44.entities.Incident.list('-incident_date', 500);
      return incidents.filter(i => i.incident_date >= dateRange.start && i.incident_date <= dateRange.end);
    },
    initialData: [],
  });

  const { data: allUsers } = useQuery({
    queryKey: ['allUsersMetrics'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const { data: securityLogs } = useQuery({
    queryKey: ['securityLogsMetrics', timeRange],
    queryFn: async () => {
      const logs = await base44.entities.SecurityLog.list('-timestamp', 1000);
      return logs.filter(log => {
        if (!log.timestamp) return false;
        const logDate = format(new Date(log.timestamp), 'yyyy-MM-dd');
        return logDate >= dateRange.start && logDate <= dateRange.end;
      });
    },
    initialData: [],
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['noteConversionsMetrics', timeRange],
    queryFn: async () => {
      const conversions = await base44.entities.NoteConversion.list('-created_date', 10000);
      return conversions.filter(nc => {
        if (!nc.created_date) return false;
        const conversionDate = format(new Date(nc.created_date), 'yyyy-MM-dd');
        return conversionDate >= dateRange.start && conversionDate <= dateRange.end;
      });
    },
    initialData: [],
  });

  // Filter visits by selected nurse
  const filteredVisits = useMemo(() => {
    if (selectedNurse === "all") return allVisits;
    return allVisits.filter(v => v.created_by === selectedNurse);
  }, [allVisits, selectedNurse]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalVisits = filteredVisits.length;
    const completedVisits = filteredVisits.filter(v => v.status === 'completed').length;
    const scheduledVisits = filteredVisits.filter(v => v.status === 'scheduled').length;
    const cancelledVisits = filteredVisits.filter(v => v.status === 'cancelled').length;

    // Completion rate
    const completionRate = totalVisits > 0 ? Math.round((completedVisits / totalVisits) * 100) : 0;

    // Average documentation time
    const visitsWithTime = filteredVisits.filter(v => 
      v.status === 'completed' && v.start_time && v.end_time
    );
    
    let avgDocTime = 0;
    if (visitsWithTime.length > 0) {
      // `new Date("2000-01-01 <bad>")` yields an Invalid Date and
      // differenceInMinutes then returns NaN WITHOUT throwing (so the old
      // try/catch never caught it) — one bad row turned the whole average into
      // "NaN min". Skip non-finite diffs and divide by the count that was valid.
      let validCount = 0;
      const totalMinutes = visitsWithTime.reduce((sum, visit) => {
        const start = new Date(`2000-01-01 ${visit.start_time}`);
        const end = new Date(`2000-01-01 ${visit.end_time}`);
        const mins = differenceInMinutes(end, start);
        if (Number.isFinite(mins)) { validCount++; return sum + mins; }
        return sum;
      }, 0);
      avgDocTime = validCount > 0 ? Math.round(totalMinutes / validCount) : 0;
    }

    // Incidents
    const falls = allIncidents.filter(i => i.incident_type === 'fall').length;
    const hospitalizations = allIncidents.filter(i => i.incident_type === 'hospitalized').length;
    const medErrors = allIncidents.filter(i => i.incident_type === 'medication_error').length;

    // Hospitalization rate per 100 patient episodes
    const activePatients = allPatients.filter(p => p.status === 'active').length;
    const hospitalizationRate = activePatients > 0 
      ? Math.round((hospitalizations / activePatients) * 100) 
      : 0;

    // Fall rate per 1000 visits
    const fallRate = totalVisits > 0 
      ? Math.round((falls / totalVisits) * 1000) 
      : 0;

    // Average visits per patient
    const patientVisitCounts = {};
    filteredVisits.forEach(v => {
      patientVisitCounts[v.patient_id] = (patientVisitCounts[v.patient_id] || 0) + 1;
    });
    const avgVisitsPerPatient = Object.keys(patientVisitCounts).length > 0
      ? Math.round(Object.values(patientVisitCounts).reduce((a, b) => a + b, 0) / Object.keys(patientVisitCounts).length * 10) / 10
      : 0;

    // Quality scores from security logs
    const qaLogs = securityLogs.filter(log => log.action === 'NOTE_SCRUBBER_COMPLETED');
    const avgQualityScore = qaLogs.length > 0
      ? Math.round(qaLogs.reduce((sum, log) => sum + (log.details?.score || 0), 0) / qaLogs.length)
      : 0;

    // Nurse productivity
    const nurseStats = {};
    allUsers.filter(u => u.role === 'user').forEach(nurse => {
      const nurseVisits = allVisits.filter(v => v.created_by === nurse.email); // Use allVisits for overall nurse stats
      const nurseCompleted = nurseVisits.filter(v => v.status === 'completed').length;
      
      nurseStats[nurse.email] = {
        name: nurse.full_name || nurse.email,
        totalVisits: nurseVisits.length,
        completedVisits: nurseCompleted,
        completionRate: nurseVisits.length > 0 ? Math.round((nurseCompleted / nurseVisits.length) * 100) : 0,
        avgDocTime: 0
      };

      // Calculate avg doc time for this nurse
      const nurseVisitsWithTime = nurseVisits.filter(v => v.start_time && v.end_time);
      if (nurseVisitsWithTime.length > 0) {
        // Same NaN guard as the agency-wide avg: differenceInMinutes returns NaN
        // (without throwing) on a malformed time, so skip non-finite diffs and
        // divide by the valid count — otherwise one bad row showed "NaN min".
        let validCount = 0;
        const totalMins = nurseVisitsWithTime.reduce((sum, v) => {
          const start = new Date(`2000-01-01 ${v.start_time}`);
          const end = new Date(`2000-01-01 ${v.end_time}`);
          const mins = differenceInMinutes(end, start);
          if (Number.isFinite(mins)) { validCount++; return sum + mins; }
          return sum;
        }, 0);
        nurseStats[nurse.email].avgDocTime = validCount > 0 ? Math.round(totalMins / validCount) : 0;
      }
    });

    // Time saved by AI (using note enhancements)
    const totalTimeSavedMinutes = noteConversions.length * 20; // 20 minutes saved per enhanced note
    const totalTimeSavedHours = Math.round(totalTimeSavedMinutes / 60);

    return {
      totalVisits,
      completedVisits,
      scheduledVisits,
      cancelledVisits,
      completionRate,
      avgDocTime,
      falls,
      hospitalizations,
      medErrors,
      hospitalizationRate,
      fallRate,
      avgVisitsPerPatient,
      avgQualityScore,
      nurseStats,
      activePatients,
      totalTimeSavedHours
    };
  }, [filteredVisits, allVisits, allIncidents, allPatients, allUsers, securityLogs, noteConversions]);

  const getMetricStatus = (value, thresholds) => {
    if (value >= thresholds.excellent) return { color: 'text-green-600', bg: 'bg-green-50', label: 'Excellent' };
    if (value >= thresholds.good) return { color: 'text-blue-600', bg: 'bg-blue-50', label: 'Good' };
    if (value >= thresholds.fair) return { color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Needs Improvement' };
    return { color: 'text-red-600', bg: 'bg-red-50', label: 'Critical' };
  };

  const exportMetrics = () => {
    const csvContent = `PennCares Quality Metrics Report
Time Range: Last ${timeRange} days (${dateRange.start} to ${dateRange.end})
Generated: ${format(new Date(), 'PPpp')}

=== OVERALL METRICS ===
Total Visits,${metrics.totalVisits}
Completed Visits,${metrics.completedVisits}
Completion Rate,${metrics.completionRate}%
Average Documentation Time,${metrics.avgDocTime} minutes
Average Quality Score,${metrics.avgQualityScore}/100

=== PATIENT OUTCOMES ===
Active Patients,${metrics.activePatients}
Average Visits per Patient,${metrics.avgVisitsPerPatient}
Hospitalization Rate,${metrics.hospitalizationRate} per 100 patients
Fall Rate,${metrics.fallRate} per 1000 visits

=== INCIDENTS ===
Total Falls,${metrics.falls}
Total Hospitalizations,${metrics.hospitalizations}
Medication Errors,${metrics.medErrors}

=== AI IMPACT ===
Total Time Saved,${metrics.totalTimeSavedHours} hours

=== NURSE PRODUCTIVITY ===
Nurse,Total Visits,Completed,Completion Rate,Avg Doc Time
${Object.entries(metrics.nurseStats).map(([_email, stats]) =>
  `${escapeCsvField(stats.name)},${stats.totalVisits},${stats.completedVisits},${stats.completionRate}%,${stats.avgDocTime} min`
).join('\n')}`;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quality-metrics-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const generateAIInsights = async () => {
    setIsGenerating(true);
    setAiInsights(null); // Clear previous insights
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate AI analysis time

    let insightsText = ``;

    insightsText += `Based on the data for the last ${timeRange} days (${dateRange.start} to ${dateRange.end}):\n\n`;

    insightsText += `### Overall Performance Summary:\n`;
    if (metrics.completionRate >= 90 && metrics.avgQualityScore >= 85 && metrics.avgDocTime <= 45 && metrics.fallRate < 10 && metrics.hospitalizationRate < 15) {
        insightsText += `- Your agency is demonstrating **Excellent** overall performance! All key metrics are meeting or exceeding targets. Keep up the outstanding work.\n`;
    } else if (metrics.completionRate >= 80 && metrics.avgQualityScore >= 75 && metrics.fallRate < 15 && metrics.hospitalizationRate < 20) {
        insightsText += `- Performance is **Good**, with some areas for potential optimization to achieve top-tier quality.\n`;
    } else {
        insightsText += `- Performance indicates **Areas for Improvement**, particularly in key quality and patient outcome metrics. Targeted interventions are recommended.\n`;
    }
    insightsText += `* Current Visit Completion Rate: ${metrics.completionRate}% (Target: 90%+)\n`;
    insightsText += `* Average Quality Score: ${metrics.avgQualityScore}/100 (Target: 85+/100)\n`;
    insightsText += `* Average Documentation Time: ${metrics.avgDocTime} minutes (Target: <45 min)\n\n`;

    insightsText += `### Key Recommendations:\n`;
    let hasRecommendations = false;

    if (metrics.completionRate < 85) {
        insightsText += `- **Boost Completion Rate:** Your completion rate of ${metrics.completionRate}% is below the desired target. Consider reviewing visit scheduling, staff availability, and common reasons for cancellations to improve adherence. Targeted training on visit protocols could also help.\n`;
        hasRecommendations = true;
    }
    if (metrics.avgQualityScore < 80) {
        insightsText += `- **Enhance Quality Scores:** With an average score of ${metrics.avgQualityScore}/100, there's room to improve documentation quality. Leverage Penn Sync's AI assistance features more extensively to ensure comprehensive and compliant records, focusing on areas identified by the scrubber.\n`;
        hasRecommendations = true;
    }
    if (metrics.avgDocTime > 50) {
        insightsText += `- **Optimize Documentation Efficiency:** The average documentation time of ${metrics.avgDocTime} minutes suggests potential inefficiencies. Encourage nurses to utilize Penn Sync's voice dictation and smart templates to streamline their workflow and reduce administrative burden. Review individual nurse times for specific coaching.\n`;
        hasRecommendations = true;
    }
    if (metrics.fallRate > 10) {
        insightsText += `- **Address Elevated Fall Rate:** An elevated fall rate of ${metrics.fallRate} per 1000 visits is a critical concern. Implement enhanced fall prevention strategies, patient education on safety, and ensure thorough risk assessments during each visit. Analyze incident reports for common themes.\n`;
        hasRecommendations = true;
    }
    if (metrics.hospitalizationRate > 15) {
        insightsText += `- **Reduce Hospitalizations:** A hospitalization rate of ${metrics.hospitalizationRate} per 100 patients is higher than desired. Focus on proactive patient management, early identification of deteriorating conditions, and close coordination with primary care providers to prevent avoidable hospital readmissions.\n`;
        hasRecommendations = true;
    }
    if (metrics.medErrors > 0) {
        insightsText += `- **Minimize Medication Errors:** There were ${metrics.medErrors} medication errors reported. This highlights a need for stricter medication management protocols, double-checking procedures, and continuous education on safe medication administration. Review dispensing and administration processes.\n`;
        hasRecommendations = true;
    }
    
    const strugglingNurses = Object.entries(metrics.nurseStats)
        .filter(([, stats]) => stats.completionRate < 70 || stats.avgDocTime > 60)
        .map(([, s]) => s.name);
    if (strugglingNurses.length > 0) {
        insightsText += `- **Support Nurse Productivity:** ${strugglingNurses.join(', ')} currently show lower completion rates or higher documentation times. Targeted coaching, mentorship, or additional training on Penn Sync features could be highly beneficial for these individuals.\n`;
        hasRecommendations = true;
    }

    if (!hasRecommendations) {
        insightsText += `- All primary metrics are performing well. Continue monitoring and leveraging Penn Sync's tools for sustained excellence. Consider setting even more ambitious targets for continuous improvement.\n`;
    }

    insightsText += `\n### Penn Sync AI Impact & Value:\n`;
    insightsText += `- Penn Sync AI has saved an estimated **${metrics.totalTimeSavedHours} hours** of documentation time during this period. This translates to nurses dedicating more time directly to patient care rather than administrative tasks.\n`;
    insightsText += `- The average quality score of **${metrics.avgQualityScore}/100** suggests effective use of AI-driven quality checks and compliance support, reducing errors and improving record accuracy.\n`;

    setAiInsights(insightsText);
    setIsGenerating(false);
};

  if (visitsLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-slate-500">
          Loading quality metrics...
        </CardContent>
      </Card>
    );
  }

  const _completionStatus = getMetricStatus(metrics.completionRate, { excellent: 95, good: 85, fair: 75 });
  const _qualityStatus = getMetricStatus(metrics.avgQualityScore, { excellent: 90, good: 80, fair: 70 });

  return (
    <div className="space-y-6">
      {/* Penn Sync Branded Header */}
      <Card className="bg-gradient-to-r from-navy-600 to-indigo-600 text-white border-none">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-2">Penn Sync Quality Metrics Dashboard</h2>
              <p className="text-navy-100">
                Comprehensive quality tracking and performance analytics powered by Penn Sync AI
              </p>
            </div>
            <TrendingUp className="w-12 h-12 text-navy-200" />
          </div>
        </CardContent>
      </Card>

      {/* Filters and Export Button */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="text-sm text-slate-600">
              Data for: {dateRange.start} to {dateRange.end} ({timeRange} days)
            </div>

            <div className="flex flex-wrap gap-3">
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="60">Last 60 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedNurse} onValueChange={setSelectedNurse}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Nurses</SelectItem>
                  {allUsers.filter(u => u.role === 'user').map(nurse => (
                    <SelectItem key={nurse.id} value={nurse.email}>
                      {nurse.full_name || nurse.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={exportMetrics}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Export Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>



      {/* Patient Outcomes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-500" />
            Patient Outcomes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
              <Users className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-900">{metrics.activePatients}</p>
              <p className="text-sm text-slate-600">Active Patients</p>
            </div>

            <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
              <Calendar className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-slate-900">{metrics.avgVisitsPerPatient}</p>
              <p className="text-sm text-slate-600">Avg Visits/Patient</p>
            </div>

            <div className={`text-center p-4 rounded-lg border ${
              metrics.hospitalizationRate < 10 ? 'bg-green-50 border-green-200' : 
              metrics.hospitalizationRate < 20 ? 'bg-yellow-50 border-yellow-200' : 
              'bg-red-50 border-red-200'
            }`}>
              <Ambulance className={`w-8 h-8 mx-auto mb-2 ${
                metrics.hospitalizationRate < 10 ? 'text-green-600' : 
                metrics.hospitalizationRate < 20 ? 'text-yellow-600' : 
                'text-red-600'
              }`} />
              <p className="text-2xl font-bold text-slate-900">{metrics.hospitalizationRate}</p>
              <p className="text-sm text-slate-600">Hospitalization Rate</p>
              <p className="text-xs text-slate-500 mt-1">per 100 patients</p>
            </div>

            <div className={`text-center p-4 rounded-lg border ${
              metrics.fallRate < 5 ? 'bg-green-50 border-green-200' : 
              metrics.fallRate < 10 ? 'bg-yellow-50 border-yellow-200' : 
              'bg-red-50 border-red-200'
            }`}>
              <AlertTriangle className={`w-8 h-8 mx-auto mb-2 ${
                metrics.fallRate < 5 ? 'text-green-600' : 
                metrics.fallRate < 10 ? 'text-yellow-600' : 
                'text-red-600'
              }`} />
              <p className="text-2xl font-bold text-slate-900">{metrics.fallRate}</p>
              <p className="text-sm text-slate-600">Fall Rate</p>
              <p className="text-xs text-slate-500 mt-1">per 1000 visits</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Incident Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Incident Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <div className="flex items-center justify-between mb-2">
                <AlertTriangle className="w-6 h-6 text-red-600" />
                <Badge variant="destructive">{metrics.falls} Total</Badge>
              </div>
              <p className="font-semibold text-slate-900">Patient Falls</p>
              <p className="text-sm text-slate-600 mt-1">
                {metrics.falls > 0
                  ? (metrics.totalVisits > 0
                      ? `Rate: ${Math.round((metrics.falls / metrics.totalVisits) * 1000)} per 1000 visits`
                      : `${metrics.falls} reported`)
                  : 'No falls reported'}
              </p>
            </div>

            <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-center justify-between mb-2">
                <Ambulance className="w-6 h-6 text-orange-600" />
                <Badge className="bg-orange-500">{metrics.hospitalizations} Total</Badge>
              </div>
              <p className="font-semibold text-slate-900">Hospitalizations</p>
              <p className="text-sm text-slate-600 mt-1">
                {metrics.hospitalizations > 0 
                  ? `Rate: ${metrics.hospitalizationRate} per 100 patients`
                  : 'No hospitalizations reported'}
              </p>
            </div>

            <div className="p-4 bg-navy-50 rounded-lg border border-navy-200">
              <div className="flex items-center justify-between mb-2">
                <Activity className="w-6 h-6 text-navy-600" />
                <Badge className="bg-navy-500">{metrics.medErrors} Total</Badge>
              </div>
              <p className="font-semibold text-slate-900">Medication Errors</p>
              <p className="text-sm text-slate-600 mt-1">
                {metrics.medErrors > 0
                  ? (metrics.totalVisits > 0
                      ? `Rate: ${Math.round((metrics.medErrors / metrics.totalVisits) * 1000)} per 1000 visits`
                      : `${metrics.medErrors} reported`)
                  : 'No med errors reported'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Nurse Productivity Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            Nurse Productivity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nurse</TableHead>
                  <TableHead className="text-center">Total Visits</TableHead>
                  <TableHead className="text-center">Completed</TableHead>
                  <TableHead className="text-center">Completion Rate</TableHead>
                  <TableHead className="text-center">Avg Doc Time</TableHead>
                  <TableHead className="text-center">Performance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(metrics.nurseStats)
                  .sort((a, b) => b[1].completedVisits - a[1].completedVisits)
                  .map(([email, stats]) => {
                    const perfStatus = stats.completionRate >= 90 
                      ? { color: 'bg-green-500', label: 'Excellent' }
                      : stats.completionRate >= 80 
                      ? { color: 'bg-blue-500', label: 'Good' }
                      : stats.completionRate >= 70 
                      ? { color: 'bg-yellow-500', label: 'Fair' }
                      : { color: 'bg-red-500', label: 'Needs Improvement' };

                    return (
                      <TableRow key={email}>
                        <TableCell className="font-medium">{stats.name}</TableCell>
                        <TableCell className="text-center">{stats.totalVisits}</TableCell>
                        <TableCell className="text-center">{stats.completedVisits}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Progress value={stats.completionRate} className="w-20 h-2" />
                            <span className="text-sm font-semibold">{stats.completionRate}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={stats.avgDocTime <= 45 ? 'text-green-600 font-semibold' : 'text-slate-900'}>
                            {stats.avgDocTime} min
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={perfStatus.color}>
                            {perfStatus.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Quality Insights */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" />
            Quality Insights & Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {metrics.completionRate < 85 && (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-900">
                <p className="font-semibold">Completion Rate Below Target</p>
                <p className="text-sm">Current: {metrics.completionRate}% | Target: 85%+</p>
                <p className="text-sm mt-1">Consider: Staff training, workflow optimization, addressing barriers</p>
              </AlertDescription>
            </Alert>
          )}

          {metrics.fallRate > 10 && (
            <Alert className="bg-red-50 border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <p className="font-semibold">Elevated Fall Rate</p>
                <p className="text-sm">Current: {metrics.fallRate} per 1000 visits | Target: &lt;10</p>
                <p className="text-sm mt-1">Action: Review fall prevention protocols, increase safety assessments</p>
              </AlertDescription>
            </Alert>
          )}

          {metrics.hospitalizationRate > 15 && (
            <Alert className="bg-orange-50 border-orange-200">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <AlertDescription className="text-orange-900">
                <p className="font-semibold">High Hospitalization Rate</p>
                <p className="text-sm">Current: {metrics.hospitalizationRate} per 100 patients | Target: &lt;15</p>
                <p className="text-sm mt-1">Consider: Enhanced monitoring, caregiver education, earlier intervention</p>
              </AlertDescription>
            </Alert>
          )}

          {metrics.avgDocTime > 50 && (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertTriangle className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <p className="font-semibold">Documentation Time Above Target</p>
                <p className="text-sm">Current: {metrics.avgDocTime} min | Target: &lt;45 min</p>
                <p className="text-sm mt-1">Tip: Encourage use of voice dictation, smart templates, and AI features</p>
              </AlertDescription>
            </Alert>
          )}

          {metrics.completionRate >= 90 && metrics.avgQualityScore >= 85 && metrics.avgDocTime <= 45 && metrics.fallRate < 10 && metrics.hospitalizationRate < 15 && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                <p className="font-semibold">🎉 Excellent Agency Performance!</p>
                <p className="text-sm">All key metrics are meeting or exceeding targets. Keep up the great work!</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* AI Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            Penn Sync AI Quality Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isGenerating ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-navy-600 mr-2" />
              <span className="text-slate-600">Penn Sync AI is analyzing quality metrics...</span>
            </div>
          ) : aiInsights ? (
            <div className="space-y-4">
              <div className="text-slate-700" style={{ whiteSpace: 'pre-wrap' }}>
                {aiInsights}
              </div>
              <Button
                onClick={generateAIInsights}
                variant="outline"
                className="bg-slate-100 hover:bg-slate-200 text-slate-800 gap-2 mt-4"
              >
                <Sparkles className="w-4 h-4" />
                Regenerate Insights
              </Button>
            </div>
          ) : (
            <div className="text-center py-8">
              <Button
                onClick={generateAIInsights}
                className="bg-navy-600 hover:bg-navy-700 gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Generate Penn Sync AI Insights
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}