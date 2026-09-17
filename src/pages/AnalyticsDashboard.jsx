import { useState, useMemo, useRef, useLayoutEffect } from "react";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { isAdminView } from "@/lib/roles";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import {
  Clock,
  Download,
  Target,
  PieChart,
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import UserActivityUnavailable from "@/components/security/UserActivityUnavailable";
import { format, subDays } from "date-fns";
import { parseLocalDate } from '@/lib/dateLocal';
import { ALL_ROWS } from '@/lib/queryLimits';

import PerformanceMetricsCard from "../components/analytics/PerformanceMetricsCard";
import UserPerformanceTable from "../components/analytics/UserPerformanceTable";
import AccessDeniedState from '@/components/ui/AccessDeniedState';
import ReportReadState from '@/components/analytics/ReportReadState';
import { readReportRows, reportRangeAvailable, measuredAverage, displayMeasurement, EMPTY_REPORT_ROWS, REPORT_READ_OPTIONS } from '@/components/analytics/reportReadContracts';

/**
 * Build a "rows within [startDate, endDate] for this user" filter.
 *
 * The bounds are computed ONCE per selector rather than inside the per-row
 * predicate, where `new Date(startDate + 'T00:00:00')` and its endDate twin were
 * rebuilt for every row — 20,000 throwaway Dates per 10,000-row pass, on each of
   * both queries. Local-midnight parsing is preserved, so a date-only bound is
 * still compared on the local calendar day rather than in UTC.
 */
function rangeSelector(startDate, endDate, selectedUser, dateOf, emailOf) {
  if (!reportRangeAvailable(startDate, endDate)) return data => ({ rows: [], capped: data.length >= ALL_ROWS });
  const from = new Date(`${startDate}T00:00:00`);
  const to = new Date(`${endDate}T23:59:59.999`);
  return (data) => ({ rows: data.filter((row) => {
    const at = parseLocalDate(dateOf(row));
    if (!(at >= from && at <= to)) return false;
    return selectedUser === 'all' || emailOf(row) === selectedUser;
  }), capped: data.length >= ALL_ROWS });
}

export default function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState("30");
  const [selectedUser, setSelectedUser] = useState("all");
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const userQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    ...REPORT_READ_OPTIONS,
  });
  const currentUser = userQuery.isSuccess ? userQuery.data : null;

  const isAdmin = isAdminView(currentUser);
  const rangeAvailable = reportRangeAvailable(startDate, endDate);

  // Fetch all users for admin
  const usersQuery = useQuery({
    queryKey: ['allUsers', 'performance-report', ALL_ROWS, agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = readReportRows(await base44.entities.User.list('-created_date', ALL_ROWS), 'users');
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return { rows: filterUsersByCallerAgency(_rows, currentUser), capped: _rows.length >= ALL_ROWS };
    },
    enabled: isAdmin,
    ...REPORT_READ_OPTIONS,
  });

  // Memoized so the reference is stable between renders: React Query compares
  // `select` by identity, so an inline arrow re-filters all 10,000 rows on every
  // render. Three of these ran per render before.
  const selectNoteConversions = useMemo(
    () => rangeSelector(startDate, endDate, selectedUser, (nc) => nc.created_date, (nc) => nc.nurse_email),
    [startDate, endDate, selectedUser],
  );
  const selectComplianceAudits = useMemo(
    () => rangeSelector(startDate, endDate, selectedUser, (ca) => ca.audit_date || ca.created_date, (ca) => ca.nurse_email),
    [startDate, endDate, selectedUser],
  );
  // Fetch note conversions
  const notesQuery = useQuery({
    queryKey: ['noteConversions', selectedUser, startDate, endDate, agencyQueryKey(currentUser)],
    // Without a limit Base44 returns only the 50 newest rows, so any selected date
    // range older than those 50 showed zero/partial data and skewed the averages.
    queryFn: async () => readReportRows(await base44.entities.NoteConversion.list('-created_date', ALL_ROWS), 'notes'),
    select: selectNoteConversions,
    enabled: isAdmin && rangeAvailable,
    ...REPORT_READ_OPTIONS,
  });

  // Fetch compliance audits
  const auditsQuery = useQuery({
    queryKey: ['complianceAudits', selectedUser, startDate, endDate, agencyQueryKey(currentUser)],
    queryFn: async () => readReportRows(await base44.entities.ComplianceAudit.list('-audit_date', ALL_ROWS), 'audits'),
    select: selectComplianceAudits,
    enabled: isAdmin && rangeAvailable,
    ...REPORT_READ_OPTIONS,
  });
  const reportQueries = [usersQuery, notesQuery, auditsQuery];
  const dataAvailable = isAdmin && reportQueries.every(query => query.isSuccess && !query.isError);
  const reportAvailable = dataAvailable && rangeAvailable;
  const allUsers = reportAvailable ? usersQuery.data.rows : EMPTY_REPORT_ROWS;
  const noteConversions = reportAvailable ? notesQuery.data.rows : EMPTY_REPORT_ROWS;
  const complianceAudits = reportAvailable ? auditsQuery.data.rows : EMPTY_REPORT_ROWS;
  const capped = dataAvailable && reportQueries.some(query => query.data.capped);
  const exportAvailable = reportAvailable && !capped;
  const exportAvailableRef = useRef(exportAvailable);
  useLayoutEffect(() => { exportAvailableRef.current = exportAvailable; }, [exportAvailable]);

  // Average only rows that actually carry the metric — treating a missing
  // value as 0 halved the averages whenever legacy rows lacked the field.

  // Calculate key metrics
  const metrics = useMemo(() => {
    // Documentation time metrics
    const avgDocMilliseconds = measuredAverage(noteConversions, (nc) => nc.conversion_time_ms);
    const avgDocTime = avgDocMilliseconds == null ? null : avgDocMilliseconds / 60000;

    // Compliance score metrics
    const avgComplianceScore = measuredAverage(complianceAudits, (ca) => ca.compliance_score);

    // Quality metrics
    const avgQualityScore = measuredAverage(noteConversions, (nc) => nc.quality_score);

    // Compliance improvement metrics - safely handle undefined fields
    const conversionsWithCompliance = noteConversions.filter(nc => 
      nc.rough_note_compliance != null && 
      nc.enhanced_note_compliance != null && 
      typeof nc.rough_note_compliance === 'number' && 
      typeof nc.enhanced_note_compliance === 'number'
    );
    const avgComplianceImprovement = conversionsWithCompliance.length > 0
      ? conversionsWithCompliance.reduce((sum, nc) => sum + ((nc.enhanced_note_compliance || 0) - (nc.rough_note_compliance || 0)), 0) / conversionsWithCompliance.length
      : null;
    const avgRoughCompliance = conversionsWithCompliance.length > 0
      ? conversionsWithCompliance.reduce((sum, nc) => sum + (nc.rough_note_compliance || 0), 0) / conversionsWithCompliance.length
      : null;
    const avgEnhancedCompliance = conversionsWithCompliance.length > 0
      ? conversionsWithCompliance.reduce((sum, nc) => sum + (nc.enhanced_note_compliance || 0), 0) / conversionsWithCompliance.length
      : null;

    // Previous period comparison — split at the exact midpoint instant. Adding a
    // fractional day count via setDate lands the boundary imprecisely at day edges.
    const midDate = new Date((new Date(`${startDate}T00:00:00`).getTime() + new Date(`${endDate}T23:59:59.999`).getTime()) / 2);
    
    const recentConversions = noteConversions.filter(nc => parseLocalDate(nc.created_date) >= midDate);
    const olderConversions = noteConversions.filter(nc => parseLocalDate(nc.created_date) < midDate);
    
    const recentAvgTime = measuredAverage(recentConversions, nc => nc.conversion_time_ms);
    const olderAvgTime = measuredAverage(olderConversions, nc => nc.conversion_time_ms);
    
    const timeChange = olderAvgTime > 0 && recentAvgTime != null ? ((recentAvgTime - olderAvgTime) / olderAvgTime) * 100 : null;

    return {
      avgDocTime: avgDocTime?.toFixed(1) ?? null,
      avgComplianceScore: avgComplianceScore?.toFixed(1) ?? null,
      avgQualityScore: avgQualityScore?.toFixed(1) ?? null,
      totalNotes: noteConversions.length,
      totalAudits: complianceAudits.length,
      timeChange: timeChange?.toFixed(1) ?? null,
      avgComplianceImprovement: avgComplianceImprovement?.toFixed(1) ?? null,
      avgRoughCompliance: avgRoughCompliance?.toFixed(1) ?? null,
      avgEnhancedCompliance: avgEnhancedCompliance?.toFixed(1) ?? null,
      notesWithComplianceTracking: conversionsWithCompliance.length
    };
  }, [noteConversions, complianceAudits, startDate, endDate]);

  // Prepare trend data
  const trendData = useMemo(() => {
    if (!rangeAvailable) return [];
    const days = {};
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = format(d, 'yyyy-MM-dd');
      days[dateKey] = {
        date: format(d, 'MMM dd'),
        compliance: [],
        docTime: [],
        notes: 0,
      };
    }

    complianceAudits.forEach(ca => {
      const dateKey = format(parseLocalDate(ca.audit_date || ca.created_date), 'yyyy-MM-dd');
      if (days[dateKey] && Number.isFinite(ca.compliance_score)) {
        days[dateKey].compliance.push(ca.compliance_score);
      }
    });

    noteConversions.forEach(nc => {
      const dateKey = format(parseLocalDate(nc.created_date), 'yyyy-MM-dd');
      if (days[dateKey]) {
        days[dateKey].notes++;
        if (Number.isFinite(nc.conversion_time_ms)) days[dateKey].docTime.push(nc.conversion_time_ms / 60000);
      }
    });

    return Object.values(days).map(day => ({
      date: day.date,
      avgCompliance: day.compliance.length > 0 
        ? day.compliance.reduce((a, b) => a + b, 0) / day.compliance.length 
        : null,
      avgDocTime: day.docTime.length > 0
        ? day.docTime.reduce((a, b) => a + b, 0) / day.docTime.length
        : null,
      notes: day.notes
    }));
  }, [complianceAudits, noteConversions, startDate, endDate, rangeAvailable]);

  // User performance summary
  const userPerformance = useMemo(() => {
    if (!isAdmin) return [];

    const userStats = new Map(allUsers.filter(user => user.email).map(user => [user.email, { name: user.full_name || user.email, email: user.email, notes: [], audits: [] }]));
    noteConversions.forEach(note => userStats.get(note.nurse_email)?.notes.push(note));
    complianceAudits.forEach(audit => userStats.get(audit.nurse_email)?.audits.push(audit));
    return [...userStats.values()].map(user => {
      const milliseconds = measuredAverage(user.notes, note => note.conversion_time_ms);
      return {
        name: user.name, email: user.email, notesCount: user.notes.length,
        avgDocTime: milliseconds == null ? null : (milliseconds / 60000).toFixed(1),
        avgCompliance: measuredAverage(user.audits, audit => audit.compliance_score)?.toFixed(1) ?? null,
        avgQuality: measuredAverage(user.notes, note => note.quality_score)?.toFixed(1) ?? null,
      };
    }).filter(user => user.notesCount > 0);
  }, [noteConversions, complianceAudits, allUsers, isAdmin]);

  // Handle date range change
  const handleDateRangeChange = (value) => {
    setDateRange(value);
    if (value !== 'custom') {
      const days = parseInt(value);
      setStartDate(format(subDays(new Date(), days), 'yyyy-MM-dd'));
      setEndDate(format(new Date(), 'yyyy-MM-dd'));
    }
  };

  // Export report as PDF
  const handleExportPDF = async () => {
    if (!exportAvailable) return;
    try {
      const { exportToPDF } = await import('@/components/utils/pdfExporter');
      if (!exportAvailableRef.current) return;
      
      const content = [
        { type: 'heading', text: 'Performance Analytics Report', size: 18 },
        { type: 'text', text: `Date Range: ${startDate} to ${endDate}` },
        { type: 'text', text: `User: ${selectedUser === 'all' ? 'All Users' : selectedUser}` },
        { type: 'text', text: `Generated: ${new Date().toLocaleString()}` },
        { type: 'spacer', height: 10 },
        { type: 'line' },
        { type: 'spacer', height: 5 },
        
        { type: 'heading', text: 'Key Performance Metrics', size: 14 },
        { type: 'spacer', height: 5 },
        {
          type: 'table',
          headers: ['Metric', 'Value'],
          rows: [
            ['Average Documentation Time', displayMeasurement(metrics.avgDocTime, ' minutes')],
            ['Average Compliance Score', displayMeasurement(metrics.avgComplianceScore, '%')],
            ['Average Quality Score', displayMeasurement(metrics.avgQualityScore, '%')],
            ['Total Notes Generated', metrics.totalNotes],
            ['Total Audits Performed', metrics.totalAudits]
          ]
        },

        
        { type: 'heading', text: 'User Performance Summary', size: 14 },
        { type: 'spacer', height: 5 }
      ];

      if (isAdmin && userPerformance.length > 0) {
        content.push({
          type: 'table',
          headers: ['Nurse', 'Notes', 'Avg Time', 'Compliance', 'Quality'],
          rows: userPerformance.slice(0, 10).map(user => [
            user.name,
            user.notesCount,
            displayMeasurement(user.avgDocTime, ' min'),
            displayMeasurement(user.avgCompliance, '%'),
            displayMeasurement(user.avgQuality, '%')
          ])
        });
      }

      await exportToPDF({
        filename: `performance-analytics-${startDate}-to-${endDate}.pdf`,
        title: 'Performance Analytics Report',
        subtitle: `${startDate} to ${endDate}`,
        content
      });
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('Failed to export PDF: ' + error.message);
    }
  };

  // Export report as JSON
  const handleExportReport = () => {
    if (!exportAvailable) return;
    try {
      if (!metrics || !trendData || trendData.length === 0) {
        toast.error('No data available to export. Please adjust your filters and try again.');
        return;
      }

      // Calculate compliance improvement statistics - safely handle missing data
      const complianceImpactData = noteConversions
        .filter(nc => 
          nc.rough_note_compliance != null && 
          nc.enhanced_note_compliance != null &&
          typeof nc.rough_note_compliance === 'number' &&
          typeof nc.enhanced_note_compliance === 'number'
        )
        .map(nc => ({
          nurse: nc.nurse_email || 'Unknown',
          visit_type: nc.visit_type || 'N/A',
          date: nc.created_date,
          rough_compliance: nc.rough_note_compliance || 0,
          enhanced_compliance: nc.enhanced_note_compliance || 0,
          improvement: (nc.enhanced_note_compliance || 0) - (nc.rough_note_compliance || 0)
        }));

      const report = {
        generatedAt: new Date().toISOString(),
        dateRange: { start: startDate, end: endDate },
        user: selectedUser === 'all' ? 'All Users' : selectedUser,
        summary: metrics,
        aiImpactMetrics: {
          avgRoughCompliance: metrics.avgRoughCompliance,
          avgEnhancedCompliance: metrics.avgEnhancedCompliance,
          avgComplianceImprovement: metrics.avgComplianceImprovement,
          notesAnalyzed: metrics.notesWithComplianceTracking,
          detailedImpacts: complianceImpactData
        },
        dailyTrends: trendData,
        userPerformance: isAdmin ? userPerformance : null
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-report-${startDate}-to-${endDate}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Report generation error:', error);
      toast.error('Failed to generate report: ' + error.message);
    }
  };

  if (!userQuery.isSuccess) return <PageContainer><ReportReadState queries={[userQuery]} title="Report access" /></PageContainer>;
  if (!isAdmin) return <PageContainer><AccessDeniedState description="Performance reports are available to administrators only." /></PageContainer>;

  return (
    <PageContainer>
      <PageHeader
        icon={PieChart}
        eyebrow="Analytics"
        title="Performance Analytics"
        description="Track metrics, trends, and outcomes"
        favoritePage="AnalyticsDashboard"
        actions={
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button onClick={handleExportPDF} disabled={!exportAvailable} className="min-h-[44px] w-full sm:w-auto">
              <Download className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Export PDF</span>
              <span className="sm:hidden">PDF</span>
            </Button>
            <Button onClick={handleExportReport} disabled={!exportAvailable} variant="outline" className="min-h-[44px] w-full sm:w-auto">
              <Download className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Export JSON</span>
              <span className="sm:hidden">JSON</span>
            </Button>
          </div>
        }
      />

      <div className="mb-4 sm:mb-6">
        <UserActivityUnavailable title="AI utilization analytics unavailable" />
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <Label className="text-xs mb-1">Date Range</Label>
              <Select value={dateRange} onValueChange={handleDateRangeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {dateRange === 'custom' && (
              <>
                <div>
                  <Label htmlFor="performance-start-date" className="text-xs mb-1">Start Date</Label>
                  <Input id="performance-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="performance-end-date" className="text-xs mb-1">End Date</Label>
                  <Input id="performance-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </>
            )}
            {isAdmin && (
              <div>
                <Label className="text-xs mb-1">User</Label>
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {allUsers.map(user => (
                      <SelectItem key={user.id} value={user.email}>{user.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {rangeAvailable && !dataAvailable && <ReportReadState queries={reportQueries} title="Performance report data" />}
      {!rangeAvailable && <p role="alert" className="mb-4 text-sm text-amber-800">Choose valid start and end dates in order, covering at most 366 calendar days.</p>}
      {capped && <p role="status" className="mb-4 text-sm text-amber-800">A source reached its record limit. Figures describe loaded records only; export is unavailable until complete source data can be obtained.</p>}

      {reportAvailable && <>
      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <PerformanceMetricsCard
          title="Avg Doc Time"
          value={displayMeasurement(metrics.avgDocTime, ' min')}
          change={metrics.timeChange}
          icon={Clock}
          color="blue"
          invertTrend
        />
        <PerformanceMetricsCard
          title="Quality Score"
          value={displayMeasurement(metrics.avgQualityScore, '%')}
          icon={Target}
          color="indigo"
        />
      </div>



      {/* Documentation trend remains available from NoteConversion rows. */}
      <Card className="mb-4 sm:mb-6">
        <CardHeader className="p-3 sm:p-4 md:p-6">
          <CardTitle className="text-base sm:text-lg">Average Documentation Time</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 md:p-6">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" style={{ fontSize: '12px' }} />
              <YAxis style={{ fontSize: '12px' }} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="avgDocTime"
                stroke="#3557b0"
                strokeWidth={2}
                name="Doc Time (min)"
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* User Performance Table (Admin Only) */}
      {isAdmin && userPerformance.length > 0 && (
        <Card>
          <CardHeader className="p-3 sm:p-4 md:p-6">
            <CardTitle className="text-base sm:text-lg">User Performance Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 md:p-6">
            <UserPerformanceTable users={userPerformance} />
          </CardContent>
        </Card>
      )}
      </>}
    </PageContainer>
  );
}
