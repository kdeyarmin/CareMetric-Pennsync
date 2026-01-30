import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  Zap,
  Users,
  FileText,
  Download,
  Calendar,
  Activity,
  BarChart3,
  Target,
  AlertCircle,
} from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";

import PerformanceMetricsCard from "../components/analytics/PerformanceMetricsCard";
import ComplianceTrendsChart from "../components/analytics/ComplianceTrendsChart";
import AIUtilizationChart from "../components/analytics/AIUtilizationChart";
import UserPerformanceTable from "../components/analytics/UserPerformanceTable";

export default function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState("30");
  const [selectedUser, setSelectedUser] = useState("all");
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  // Fetch all users for admin
  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    enabled: isAdmin,
  });

  // Fetch note conversions
  const { data: noteConversions = [] } = useQuery({
    queryKey: ['noteConversions', selectedUser, startDate, endDate],
    queryFn: () => base44.entities.NoteConversion.list('-created_date'),
    select: (data) => data.filter(nc => {
      const ncDate = new Date(nc.created_date);
      const inDateRange = ncDate >= new Date(startDate) && ncDate <= new Date(endDate);
      const userMatch = selectedUser === 'all' || nc.nurse_email === selectedUser;
      return inDateRange && userMatch;
    }),
  });

  // Fetch compliance audits
  const { data: complianceAudits = [] } = useQuery({
    queryKey: ['complianceAudits', selectedUser, startDate, endDate],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date'),
    select: (data) => data.filter(ca => {
      const caDate = new Date(ca.created_date);
      const inDateRange = caDate >= new Date(startDate) && caDate <= new Date(endDate);
      const userMatch = selectedUser === 'all' || ca.nurse_email === selectedUser;
      return inDateRange && userMatch;
    }),
  });

  // Fetch user activities
  const { data: userActivities = [] } = useQuery({
    queryKey: ['userActivities', selectedUser, startDate, endDate],
    queryFn: () => base44.entities.UserActivity.list('-created_date'),
    select: (data) => data.filter(ua => {
      const uaDate = new Date(ua.created_date);
      const inDateRange = uaDate >= new Date(startDate) && uaDate <= new Date(endDate);
      const userMatch = selectedUser === 'all' || ua.user_email === selectedUser;
      return inDateRange && userMatch;
    }),
  });

  // Calculate key metrics
  const metrics = useMemo(() => {
    // Documentation time metrics
    const avgDocTime = noteConversions.length > 0
      ? noteConversions.reduce((sum, nc) => sum + (nc.conversion_time_ms || 0), 0) / noteConversions.length / 1000 / 60
      : 0;

    // Compliance score metrics
    const avgComplianceScore = complianceAudits.length > 0
      ? complianceAudits.reduce((sum, ca) => sum + (ca.compliance_score || 0), 0) / complianceAudits.length
      : 0;

    // AI utilization
    const aiActions = userActivities.filter(ua => 
      ['note_enhanced', 'note_ai_generated', 'template_generated'].includes(ua.action)
    );
    const totalActions = userActivities.filter(ua => 
      ['visit_document', 'note_enhanced', 'note_ai_generated'].includes(ua.action)
    );
    const aiUtilizationRate = totalActions.length > 0 
      ? (aiActions.length / totalActions.length) * 100 
      : 0;

    // Quality metrics
    const avgQualityScore = noteConversions.length > 0
      ? noteConversions.reduce((sum, nc) => sum + (nc.quality_score || 0), 0) / noteConversions.length
      : 0;

    // Compliance improvement metrics - safely handle undefined fields
    const conversionsWithCompliance = noteConversions.filter(nc => 
      nc.rough_note_compliance != null && 
      nc.enhanced_note_compliance != null && 
      typeof nc.rough_note_compliance === 'number' && 
      typeof nc.enhanced_note_compliance === 'number'
    );
    const avgComplianceImprovement = conversionsWithCompliance.length > 0
      ? conversionsWithCompliance.reduce((sum, nc) => sum + ((nc.enhanced_note_compliance || 0) - (nc.rough_note_compliance || 0)), 0) / conversionsWithCompliance.length
      : 0;
    const avgRoughCompliance = conversionsWithCompliance.length > 0
      ? conversionsWithCompliance.reduce((sum, nc) => sum + (nc.rough_note_compliance || 0), 0) / conversionsWithCompliance.length
      : 0;
    const avgEnhancedCompliance = conversionsWithCompliance.length > 0
      ? conversionsWithCompliance.reduce((sum, nc) => sum + (nc.enhanced_note_compliance || 0), 0) / conversionsWithCompliance.length
      : 0;

    // Previous period comparison
    const midDate = new Date(startDate);
    midDate.setDate(midDate.getDate() + (new Date(endDate) - new Date(startDate)) / (2 * 24 * 60 * 60 * 1000));
    
    const recentConversions = noteConversions.filter(nc => new Date(nc.created_date) >= midDate);
    const olderConversions = noteConversions.filter(nc => new Date(nc.created_date) < midDate);
    
    const recentAvgTime = recentConversions.length > 0
      ? recentConversions.reduce((sum, nc) => sum + (nc.conversion_time_ms || 0), 0) / recentConversions.length / 1000 / 60
      : avgDocTime;
    const olderAvgTime = olderConversions.length > 0
      ? olderConversions.reduce((sum, nc) => sum + (nc.conversion_time_ms || 0), 0) / olderConversions.length / 1000 / 60
      : avgDocTime;
    
    const timeChange = olderAvgTime > 0 ? ((recentAvgTime - olderAvgTime) / olderAvgTime) * 100 : 0;

    return {
      avgDocTime: avgDocTime.toFixed(1),
      avgComplianceScore: avgComplianceScore.toFixed(1),
      aiUtilizationRate: aiUtilizationRate.toFixed(1),
      avgQualityScore: avgQualityScore.toFixed(1),
      totalNotes: noteConversions.length,
      totalAudits: complianceAudits.length,
      timeChange: timeChange.toFixed(1),
      aiActionsCount: aiActions.length,
      totalVisits: userActivities.filter(ua => ua.action === 'visit_document').length,
      avgComplianceImprovement: avgComplianceImprovement.toFixed(1),
      avgRoughCompliance: avgRoughCompliance.toFixed(1),
      avgEnhancedCompliance: avgEnhancedCompliance.toFixed(1),
      notesWithComplianceTracking: conversionsWithCompliance.length
    };
  }, [noteConversions, complianceAudits, userActivities, startDate, endDate]);

  // Prepare trend data
  const trendData = useMemo(() => {
    const days = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = format(d, 'yyyy-MM-dd');
      days[dateKey] = {
        date: format(d, 'MMM dd'),
        compliance: [],
        docTime: [],
        aiUsage: 0,
        totalActions: 0
      };
    }

    complianceAudits.forEach(ca => {
      const dateKey = format(new Date(ca.created_date), 'yyyy-MM-dd');
      if (days[dateKey]) {
        days[dateKey].compliance.push(ca.compliance_score || 0);
      }
    });

    noteConversions.forEach(nc => {
      const dateKey = format(new Date(nc.created_date), 'yyyy-MM-dd');
      if (days[dateKey]) {
        days[dateKey].docTime.push((nc.conversion_time_ms || 0) / 1000 / 60);
      }
    });

    userActivities.forEach(ua => {
      const dateKey = format(new Date(ua.created_date), 'yyyy-MM-dd');
      if (days[dateKey]) {
        if (['note_enhanced', 'note_ai_generated', 'template_generated'].includes(ua.action)) {
          days[dateKey].aiUsage++;
        }
        if (['visit_document', 'note_enhanced', 'note_ai_generated'].includes(ua.action)) {
          days[dateKey].totalActions++;
        }
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
      aiUtilization: day.totalActions > 0
        ? (day.aiUsage / day.totalActions) * 100
        : null,
      notes: day.docTime.length
    }));
  }, [complianceAudits, noteConversions, userActivities, startDate, endDate]);

  // User performance summary
  const userPerformance = useMemo(() => {
    if (!isAdmin) return [];

    const userStats = {};
    
    allUsers.forEach(user => {
      userStats[user.email] = {
        name: user.full_name,
        email: user.email,
        notesCount: 0,
        avgDocTime: 0,
        avgCompliance: 0,
        avgQuality: 0,
        aiUsageCount: 0,
        totalActions: 0
      };
    });

    noteConversions.forEach(nc => {
      if (userStats[nc.nurse_email]) {
        userStats[nc.nurse_email].notesCount++;
        userStats[nc.nurse_email].avgDocTime += (nc.conversion_time_ms || 0) / 1000 / 60;
        userStats[nc.nurse_email].avgQuality += nc.quality_score || 0;
      }
    });

    complianceAudits.forEach(ca => {
      if (userStats[ca.nurse_email]) {
        userStats[ca.nurse_email].avgCompliance += ca.compliance_score || 0;
      }
    });

    userActivities.forEach(ua => {
      if (userStats[ua.user_email]) {
        if (['note_enhanced', 'note_ai_generated', 'template_generated'].includes(ua.action)) {
          userStats[ua.user_email].aiUsageCount++;
        }
        if (['visit_document', 'note_enhanced', 'note_ai_generated'].includes(ua.action)) {
          userStats[ua.user_email].totalActions++;
        }
      }
    });

    return Object.values(userStats).map(user => ({
      ...user,
      avgDocTime: user.notesCount > 0 ? (user.avgDocTime / user.notesCount).toFixed(1) : 0,
      avgCompliance: user.notesCount > 0 ? (user.avgCompliance / user.notesCount).toFixed(1) : 0,
      avgQuality: user.notesCount > 0 ? (user.avgQuality / user.notesCount).toFixed(1) : 0,
      aiUtilization: user.totalActions > 0 ? ((user.aiUsageCount / user.totalActions) * 100).toFixed(1) : 0
    })).filter(user => user.notesCount > 0);
  }, [noteConversions, complianceAudits, userActivities, allUsers, isAdmin]);

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
    try {
      const { exportToPDF } = await import('@/components/utils/pdfExporter');
      
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
            ['Average Documentation Time', `${metrics.avgDocTime} minutes`],
            ['Average Compliance Score', `${metrics.avgComplianceScore}%`],
            ['AI Utilization Rate', `${metrics.aiUtilizationRate}%`],
            ['Average Quality Score', `${metrics.avgQualityScore}%`],
            ['Total Notes Generated', metrics.totalNotes],
            ['Total Audits Performed', metrics.totalAudits],
            ['Total Visits Documented', metrics.totalVisits],
            ['AI Actions Count', metrics.aiActionsCount]
          ]
        },

        
        { type: 'heading', text: 'User Performance Summary', size: 14 },
        { type: 'spacer', height: 5 }
      ];

      if (isAdmin && userPerformance.length > 0) {
        content.push({
          type: 'table',
          headers: ['Nurse', 'Notes', 'Avg Time', 'Compliance', 'Quality', 'AI Usage'],
          rows: userPerformance.slice(0, 10).map(user => [
            user.name,
            user.notesCount,
            `${user.avgDocTime} min`,
            `${user.avgCompliance}%`,
            `${user.avgQuality}%`,
            `${user.aiUtilization}%`
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
      alert('Failed to export PDF: ' + error.message);
    }
  };

  // Export report as JSON
  const handleExportReport = () => {
    try {
      if (!metrics || !trendData || trendData.length === 0) {
        alert('No data available to export. Please adjust your filters and try again.');
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
      alert('Failed to generate report: ' + error.message);
    }
  };

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
         <div className="flex-1 min-w-0">
           <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold text-gray-900 truncate">Performance Analytics</h1>
          <p className="text-xs sm:text-sm text-gray-600 mt-1">Track metrics, trends, and outcomes</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button onClick={handleExportPDF} className="bg-blue-600 hover:bg-blue-700 touch-target w-full sm:w-auto" size="sm">
            <Download className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Export </span>PDF
          </Button>
          <Button onClick={handleExportReport} variant="outline" className="touch-target w-full sm:w-auto" size="sm">
            <Download className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Export </span>JSON
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
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
                  <Label className="text-xs mb-1">Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs mb-1">End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 md:gap-4 mb-4 sm:mb-6">
        <PerformanceMetricsCard
          title="Avg Doc Time"
          value={`${metrics.avgDocTime} min`}
          change={metrics.timeChange}
          icon={Clock}
          color="blue"
        />
        <PerformanceMetricsCard
          title="Quality Score"
          value={`${metrics.avgQualityScore}%`}
          icon={Target}
          color="indigo"
        />
      </div>



      {/* Charts */}
      <Tabs defaultValue="time" className="mb-4 sm:mb-6 w-full">
        <TabsList className="grid w-full grid-cols-2 gap-1 p-1">
          <TabsTrigger value="time" className="text-[10px] sm:text-xs md:text-sm">Doc Time</TabsTrigger>
          <TabsTrigger value="ai" className="text-[10px] sm:text-xs md:text-sm">AI Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="time" className="w-full">
          <Card className="w-full overflow-hidden">
            <CardHeader className="p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base md:text-lg">Average Documentation Time</CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4">
              <div className="w-full overflow-x-auto">
                <ResponsiveContainer width="100%" height={250} minWidth={300}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" style={{ fontSize: '10px' }} angle={-45} textAnchor="end" height={60} />
                    <YAxis style={{ fontSize: '10px' }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line 
                      type="monotone" 
                      dataKey="avgDocTime" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      name="Doc Time (min)"
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="w-full">
          <Card className="w-full overflow-hidden">
            <CardHeader className="p-3 sm:p-4">
              <CardTitle className="text-sm sm:text-base md:text-lg">AI Feature Usage Rate</CardTitle>
            </CardHeader>
            <CardContent className="p-2 sm:p-4">
              <div className="w-full overflow-x-auto">
                <ResponsiveContainer width="100%" height={250} minWidth={300}>
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" style={{ fontSize: '10px' }} angle={-45} textAnchor="end" height={60} />
                    <YAxis domain={[0, 100]} style={{ fontSize: '10px' }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar 
                      dataKey="aiUtilization" 
                      fill="#8b5cf6" 
                      name="AI Utilization (%)"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* User Performance Table (Admin Only) */}
      {isAdmin && userPerformance.length > 0 && (
        <Card className="w-full overflow-hidden">
          <CardHeader className="p-3 sm:p-4">
            <CardTitle className="text-sm sm:text-base md:text-lg">User Performance Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-4 overflow-x-auto">
            <UserPerformanceTable users={userPerformance} />
          </CardContent>
        </Card>
      )}


    </div>
  );
}