import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { CHART_COLORS_6 } from "@/constants/chartColors";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
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
  AreaChart,
  ScatterChart,
  Scatter
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  FileText,
  Activity,
  Minus,
  BarChart3,
  PieChart as PieChartIcon,
  Filter
} from "lucide-react";
import { format, subDays } from "date-fns";

export default function OASISAnalyticsDashboard() {
  const [timeRange, setTimeRange] = useState("30");
  const [filterAssessmentType, setFilterAssessmentType] = useState("all");
  const [_sortBy, _setSortBy] = useState("date");

  // Fetch all OASIS uploads with analysis data
  const { data: oasisUploads = [], isLoading } = useQuery({
    queryKey: ['oasisUploads'],
    queryFn: () => base44.entities.OASISUpload.list('-created_date', 200),
  });

  // Filter data based on time range and assessment type
  const filteredData = useMemo(() => {
    const now = new Date();
    const cutoffDate = timeRange === "all" ? new Date(0) : subDays(now, parseInt(timeRange));
    
    return oasisUploads.filter(upload => {
      const uploadDate = new Date(upload.created_date);
      const inRange = uploadDate >= cutoffDate;
      const typeMatch = filterAssessmentType === "all" || upload.assessment_type === filterAssessmentType;
      return inRange && typeMatch && upload.analysis_results;
    });
  }, [oasisUploads, timeRange, filterAssessmentType]);

  // Calculate aggregate metrics
  const metrics = useMemo(() => {
    if (filteredData.length === 0) return null;

    const totalAnalyses = filteredData.length;
    const avgAccuracy = filteredData.reduce((sum, d) => sum + (d.scores?.accuracy || 0), 0) / totalAnalyses;
    const avgCompliance = filteredData.reduce((sum, d) => sum + (d.scores?.compliance || 0), 0) / totalAnalyses;
    const avgOverall = filteredData.reduce((sum, d) => sum + (d.scores?.overall || 0), 0) / totalAnalyses;
    const avgRevenue = filteredData.reduce((sum, d) => sum + (d.scores?.revenue_optimization || 0), 0) / totalAnalyses;

    const totalEstimatedPayment = filteredData.reduce((sum, d) => sum + (d.estimated_payment || 0), 0);
    const avgPayment = totalEstimatedPayment / totalAnalyses;

    // Count issues
    const totalAccuracyIssues = filteredData.reduce((sum, d) => 
      sum + (d.analysis_results?.accuracy_issues?.length || 0), 0);
    const totalComplianceIssues = filteredData.reduce((sum, d) => 
      sum + (d.analysis_results?.compliance_concerns?.length || 0), 0);
    const totalOptimizations = filteredData.reduce((sum, d) => 
      sum + (d.analysis_results?.revenue_tips?.length || 0), 0);

    // Status distribution
    const statusCounts = filteredData.reduce((acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {});

    // Assessment type distribution
    const typeCounts = filteredData.reduce((acc, d) => {
      const type = d.assessment_type || 'Unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    // Find trends (comparing first half to second half)
    const midpoint = Math.floor(filteredData.length / 2);
    const firstHalf = filteredData.slice(midpoint);
    const secondHalf = filteredData.slice(0, midpoint);
    
    const firstHalfAvg = firstHalf.reduce((sum, d) => sum + (d.scores?.overall || 0), 0) / (firstHalf.length || 1);
    const secondHalfAvg = secondHalf.reduce((sum, d) => sum + (d.scores?.overall || 0), 0) / (secondHalf.length || 1);
    // Need both halves populated; with a single data point secondHalf is empty and
    // the trend would render as a misleading large negative (0 - firstHalfAvg).
    const trend = (firstHalf.length > 0 && secondHalf.length > 0) ? secondHalfAvg - firstHalfAvg : 0;

    return {
      totalAnalyses,
      avgAccuracy,
      avgCompliance,
      avgOverall,
      avgRevenue,
      totalEstimatedPayment,
      avgPayment,
      totalAccuracyIssues,
      totalComplianceIssues,
      totalOptimizations,
      statusCounts,
      typeCounts,
      trend
    };
  }, [filteredData]);

  // Prepare chart data
  const chartData = useMemo(() => {
    // Time series data
    const timeSeriesData = [...filteredData]
      .reverse()
      .map(d => ({
        date: format(new Date(d.created_date), 'MM/dd'),
        accuracy: d.scores?.accuracy || 0,
        compliance: d.scores?.compliance || 0,
        overall: d.scores?.overall || 0,
        revenue: d.scores?.revenue_optimization || 0,
        payment: d.estimated_payment || 0,
        patientName: d.patient_name || 'Unknown'
      }));

    // Score distribution
    const scoreRanges = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, 'Below 60': 0 };
    filteredData.forEach(d => {
      const score = d.scores?.overall || 0;
      if (score >= 90) scoreRanges['90-100']++;
      else if (score >= 80) scoreRanges['80-89']++;
      else if (score >= 70) scoreRanges['70-79']++;
      else if (score >= 60) scoreRanges['60-69']++;
      else scoreRanges['Below 60']++;
    });

    const scoreDistribution = Object.entries(scoreRanges).map(([range, count]) => ({
      range,
      count,
      percentage: ((count / filteredData.length) * 100).toFixed(1)
    }));

    // Assessment type pie chart
    const typeDistribution = Object.entries(metrics?.typeCounts || {}).map(([type, count]) => ({
      name: type,
      value: count
    }));

    // Payment vs Score scatter
    const paymentScoreData = filteredData
      .filter(d => d.estimated_payment && d.scores?.overall)
      .map(d => ({
        score: d.scores.overall,
        payment: d.estimated_payment,
        patient: d.patient_name || 'Unknown'
      }));

    return {
      timeSeriesData,
      scoreDistribution,
      typeDistribution,
      paymentScoreData
    };
  }, [filteredData, metrics]);

  // Top opportunities
  const topOpportunities = useMemo(() => {
    const allOpps = [];
    filteredData.forEach(upload => {
      const tips = upload.analysis_results?.revenue_tips || [];
      tips.forEach(tip => {
        allOpps.push({
          patient: upload.patient_name,
          category: tip.category,
          opportunity: tip.opportunity,
          impact: tip.potential_impact,
          date: upload.created_date
        });
      });
    });
    return allOpps.slice(0, 10);
  }, [filteredData]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const getTrendIcon = (trend) => {
    if (trend > 2) return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (trend < -2) return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-slate-600" />;
  };

  const getTrendColor = (trend) => {
    if (trend > 2) return "text-green-600";
    if (trend < -2) return "text-red-600";
    return "text-slate-600";
  };

  const COLORS = CHART_COLORS_6;

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-center py-12">
          <Activity className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading analytics data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Filters:</span>
            </div>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="90">Last 90 Days</SelectItem>
                <SelectItem value="180">Last 6 Months</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterAssessmentType} onValueChange={setFilterAssessmentType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="SOC">SOC</SelectItem>
                <SelectItem value="ROC">ROC</SelectItem>
                <SelectItem value="Recertification">Recertification</SelectItem>
                <SelectItem value="Follow-up">Follow-up</SelectItem>
                <SelectItem value="Discharge">Discharge</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="ml-auto">
              {filteredData.length} Analyses
            </Badge>
          </div>
        </CardContent>
      </Card>

      {metrics && (
        <>
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Overall Score */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-600">Avg Overall Score</span>
                  {getTrendIcon(metrics.trend)}
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">{metrics.avgOverall.toFixed(1)}%</p>
                    <p className={`text-xs mt-1 ${getTrendColor(metrics.trend)}`}>
                      {metrics.trend > 0 ? '+' : ''}{metrics.trend.toFixed(1)}% trend
                    </p>
                  </div>
                  <Target className="w-8 h-8 text-blue-500 opacity-20" />
                </div>
              </CardContent>
            </Card>

            {/* Accuracy */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-600">Avg Accuracy</span>
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">{metrics.avgAccuracy.toFixed(1)}%</p>
                    <p className="text-xs text-slate-500 mt-1">{metrics.totalAccuracyIssues} issues found</p>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-green-500 opacity-20" />
                </div>
              </CardContent>
            </Card>

            {/* Compliance */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-600">Avg Compliance</span>
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">{metrics.avgCompliance.toFixed(1)}%</p>
                    <p className="text-xs text-slate-500 mt-1">{metrics.totalComplianceIssues} concerns</p>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-orange-500 opacity-20" />
                </div>
              </CardContent>
            </Card>

            {/* Revenue */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-600">Total PDGM Payment</span>
                  <DollarSign className="w-4 h-4 text-green-600" />
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">{formatCurrency(metrics.totalEstimatedPayment)}</p>
                    <p className="text-xs text-slate-500 mt-1">{formatCurrency(metrics.avgPayment)} avg</p>
                  </div>
                  <DollarSign className="w-8 h-8 text-green-500 opacity-20" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score Trends Over Time */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                  Score Trends Over Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData.timeSeriesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip 
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value) => `${value.toFixed(1)}%`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="overall" stroke="#3557b0" fill="#3557b0" fillOpacity={0.2} name="Overall" />
                    <Area type="monotone" dataKey="accuracy" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name="Accuracy" />
                    <Area type="monotone" dataKey="compliance" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} name="Compliance" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Score Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <PieChartIcon className="w-5 h-5 text-navy-600" />
                  Score Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData.scoreDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip 
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value, name, props) => [
                        `${value} (${props.payload.percentage}%)`,
                        'Count'
                      ]}
                    />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assessment Type Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  Assessment Type Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={chartData.typeDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#264491"
                      dataKey="value"
                    >
                      {chartData.typeDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Payment vs Score Correlation */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  Payment vs Quality Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      type="number" 
                      dataKey="score" 
                      name="Score" 
                      unit="%" 
                      domain={[0, 100]}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis 
                      type="number" 
                      dataKey="payment" 
                      name="Payment"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
                    />
                    <Tooltip 
                      cursor={{ strokeDasharray: '3 3' }}
                      formatter={(value, name) => {
                        if (name === 'payment') return formatCurrency(value);
                        return `${value}%`;
                      }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Scatter 
                      name="OASIS Submissions" 
                      data={chartData.paymentScoreData} 
                      fill="#10b981"
                      shape="circle"
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Top Opportunities Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                Top Revenue Optimization Opportunities
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topOpportunities.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Opportunity</TableHead>
                      <TableHead className="text-center">Impact</TableHead>
                      <TableHead className="text-center">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topOpportunities.map((opp, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-slate-900">{opp.patient || 'Unknown'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{opp.category}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-700">{opp.opportunity}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={
                            opp.impact === 'high' ? 'success' :
                            opp.impact === 'medium' ? 'warning' :
                            'info'
                          }>
                            {opp.impact}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center text-slate-600">
                          {format(new Date(opp.date), 'MM/dd/yy')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-center text-slate-500 py-8">No optimization opportunities identified yet</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Submissions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                Recent OASIS Submissions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredData.slice(0, 5).map((upload) => (
                  <div key={upload.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <FileText className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{upload.patient_name || 'Unknown Patient'}</p>
                        <p className="text-xs text-slate-500">
                          {upload.assessment_type} - {format(new Date(upload.created_date), 'MMM dd, yyyy')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-medium text-slate-900">
                          Score: {upload.scores?.overall?.toFixed(1) || 'N/A'}%
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatCurrency(upload.estimated_payment || 0)}
                        </p>
                      </div>
                      <Badge className={
                        (upload.scores?.overall || 0) >= 80 ? 'bg-green-100 text-green-800' :
                        (upload.scores?.overall || 0) >= 60 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }>
                        {upload.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!metrics && filteredData.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 mb-2">No OASIS analyses found for the selected filters</p>
            <p className="text-sm text-slate-500">Upload and analyze OASIS documents to see insights here</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}