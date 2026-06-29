import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Target,
  Calendar,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { format, subMonths, isWithinInterval, parseISO } from "date-fns";

const COLORS = ['#10b981', '#3557b0', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function PDGMAnalyticsDashboard() {
  const [dateRange, setDateRange] = useState({
    startDate: format(subMonths(new Date(), 3), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd')
  });

  // Fetch historical OASIS data
  const { data: oasisUploads = [], isLoading } = useQuery({
    queryKey: ['oasisUploads', 'analytics'],
    queryFn: () => base44.entities.OASISUpload.list('-created_date', 500),
  });

  // Fetch action items for optimization tracking
  const { data: actionItems = [] } = useQuery({
    queryKey: ['oasisActions', 'analytics'],
    queryFn: () => base44.entities.OASISActionItem.list('-created_date', 500),
  });

  // Filter data by date range
  const filteredData = useMemo(() => {
    if (!dateRange.startDate || !dateRange.endDate) return oasisUploads;
    
    return oasisUploads.filter(item => {
      try {
        const itemDate = parseISO(item.created_date);
        return isWithinInterval(itemDate, {
          start: parseISO(dateRange.startDate),
          end: parseISO(dateRange.endDate)
        });
      } catch {
        return false;
      }
    });
  }, [oasisUploads, dateRange]);

  // Calculate average payment per episode over time
  const paymentTrends = useMemo(() => {
    const grouped = {};
    
    filteredData.forEach(item => {
      if (item.estimated_payment && item.created_date) {
        const month = format(parseISO(item.created_date), 'MMM yyyy');
        if (!grouped[month]) {
          grouped[month] = { month, total: 0, count: 0 };
        }
        grouped[month].total += item.estimated_payment;
        grouped[month].count += 1;
      }
    });

    return Object.values(grouped)
      .map(g => ({
        month: g.month,
        avgPayment: Math.round(g.total / g.count),
        count: g.count
      }))
      .sort((a, b) => new Date(a.month) - new Date(b.month));
  }, [filteredData]);

  // Calculate discrepancy impact on revenue
  const discrepancyImpact = useMemo(() => {
    const grouped = {};
    
    filteredData.forEach(item => {
      if (item.analysis_results?.discrepancies && item.created_date) {
        const month = format(parseISO(item.created_date), 'MMM yyyy');
        if (!grouped[month]) {
          grouped[month] = { 
            month, 
            totalImpact: 0, 
            count: 0,
            criticalCount: 0,
            highCount: 0
          };
        }
        
        item.analysis_results.discrepancies.forEach(disc => {
          const impact = parseFloat((disc.revenue_impact || '').match(/\$?([\d,]+)/)?.[1]?.replace(/,/g, '') || 0);
          grouped[month].totalImpact += impact;
          grouped[month].count += 1;
          if (disc.severity === 'critical') grouped[month].criticalCount += 1;
          if (disc.severity === 'high') grouped[month].highCount += 1;
        });
      }
    });

    return Object.values(grouped).sort((a, b) => new Date(a.month) - new Date(b.month));
  }, [filteredData]);

  // Calculate optimization opportunity adoption rates
  const optimizationAdoption = useMemo(() => {
    const filtered = actionItems.filter(item => {
      if (!dateRange.startDate || !dateRange.endDate) return true;
      try {
        const itemDate = parseISO(item.created_date);
        return isWithinInterval(itemDate, {
          start: parseISO(dateRange.startDate),
          end: parseISO(dateRange.endDate)
        });
      } catch {
        return false;
      }
    });

    const statusCounts = {
      pending_review: 0,
      approved: 0,
      rejected: 0,
      implemented: 0,
      task_created: 0
    };

    filtered.forEach(item => {
      if (item.status && statusCounts.hasOwnProperty(item.status)) {
        statusCounts[item.status] += 1;
      }
    });

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const adoptedCount = statusCounts.approved + statusCounts.implemented + statusCounts.task_created;
    const adoptionRate = total > 0 ? Math.round((adoptedCount / total) * 100) : 0;

    return {
      statusData: Object.entries(statusCounts).map(([name, value]) => ({
        name: name.replace(/_/g, ' '),
        value,
        percentage: total > 0 ? Math.round((value / total) * 100) : 0
      })),
      adoptionRate,
      total,
      adopted: adoptedCount
    };
  }, [actionItems, dateRange]);

  // Quality score trends
  const qualityTrends = useMemo(() => {
    const grouped = {};
    
    filteredData.forEach(item => {
      if (item.scores && item.created_date) {
        const month = format(parseISO(item.created_date), 'MMM yyyy');
        if (!grouped[month]) {
          grouped[month] = { 
            month, 
            accuracySum: 0, 
            complianceSum: 0, 
            overallSum: 0,
            count: 0 
          };
        }
        grouped[month].accuracySum += item.scores.accuracy || 0;
        grouped[month].complianceSum += item.scores.compliance || 0;
        grouped[month].overallSum += item.scores.overall || 0;
        grouped[month].count += 1;
      }
    });

    return Object.values(grouped)
      .map(g => ({
        month: g.month,
        accuracy: Math.round(g.accuracySum / g.count),
        compliance: Math.round(g.complianceSum / g.count),
        overall: Math.round(g.overallSum / g.count)
      }))
      .sort((a, b) => new Date(a.month) - new Date(b.month));
  }, [filteredData]);

  // Summary statistics
  const summaryStats = useMemo(() => {
    const totalPayment = filteredData.reduce((sum, item) => sum + (item.estimated_payment || 0), 0);
    const avgPayment = filteredData.length > 0 ? totalPayment / filteredData.length : 0;
    
    const avgAccuracy = filteredData.length > 0 
      ? filteredData.reduce((sum, item) => sum + (item.scores?.accuracy || 0), 0) / filteredData.length 
      : 0;
    
    const totalDiscrepancies = filteredData.reduce((sum, item) => 
      sum + (item.analysis_results?.discrepancies?.length || 0), 0
    );

    const totalOpportunityValue = discrepancyImpact.reduce((sum, item) => sum + item.totalImpact, 0);

    return {
      totalEpisodes: filteredData.length,
      avgPayment: Math.round(avgPayment),
      avgAccuracy: Math.round(avgAccuracy),
      totalDiscrepancies,
      totalOpportunityValue: Math.round(totalOpportunityValue),
      adoptionRate: optimizationAdoption.adoptionRate
    };
  }, [filteredData, discrepancyImpact, optimizationAdoption]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm text-slate-600">Loading analytics data...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              PDGM Analytics Dashboard
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">From:</Label>
                <Input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                  className="h-8 text-xs w-36"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">To:</Label>
                <Input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                  className="h-8 text-xs w-36"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDateRange({
                  startDate: format(subMonths(new Date(), 3), 'yyyy-MM-dd'),
                  endDate: format(new Date(), 'yyyy-MM-dd')
                })}
              >
                Last 3 Months
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-slate-500">Episodes</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{summaryStats.totalEpisodes}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-green-600" />
              <span className="text-xs text-slate-500">Avg Payment</span>
            </div>
            <p className="text-2xl font-bold text-green-700">${summaryStats.avgPayment.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-indigo-600" />
              <span className="text-xs text-slate-500">Avg Accuracy</span>
            </div>
            <p className="text-2xl font-bold text-indigo-700">{summaryStats.avgAccuracy}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <span className="text-xs text-slate-500">Discrepancies</span>
            </div>
            <p className="text-2xl font-bold text-orange-700">{summaryStats.totalDiscrepancies}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-navy-600" />
              <span className="text-xs text-slate-500">Opportunity</span>
            </div>
            <p className="text-2xl font-bold text-navy-700">${summaryStats.totalOpportunityValue.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-navy-600" />
              <span className="text-xs text-slate-500">Adoption</span>
            </div>
            <p className="text-2xl font-bold text-navy-700">{summaryStats.adoptionRate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Payment Trends Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />
            Average Payment Per Episode Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={paymentTrends}>
              <defs>
                <linearGradient id="colorPayment" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
              />
              <YAxis 
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
                tickFormatter={(value) => `$${value.toLocaleString()}`}
              />
              <Tooltip 
                formatter={(value) => `$${value.toLocaleString()}`}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area 
                type="monotone" 
                dataKey="avgPayment" 
                stroke="#10b981" 
                fillOpacity={1}
                fill="url(#colorPayment)"
                name="Avg Payment"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Quality Score Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
            Quality Score Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={qualityTrends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
              />
              <YAxis 
                domain={[0, 100]}
                tick={{ fontSize: 11 }}
                stroke="#6b7280"
              />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line 
                type="monotone" 
                dataKey="accuracy" 
                stroke="#3557b0" 
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Accuracy"
              />
              <Line 
                type="monotone" 
                dataKey="compliance" 
                stroke="#10b981" 
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Compliance"
              />
              <Line 
                type="monotone" 
                dataKey="overall" 
                stroke="#8b5cf6" 
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Overall"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Discrepancy Revenue Impact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              Discrepancy Impact on Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={discrepancyImpact}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="month" 
                  tick={{ fontSize: 10 }}
                  stroke="#6b7280"
                />
                <YAxis 
                  tick={{ fontSize: 10 }}
                  stroke="#6b7280"
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  formatter={(value) => `$${value.toLocaleString()}`}
                  contentStyle={{ fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="totalImpact" fill="#f59e0b" name="Total Impact" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Optimization Adoption Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-navy-600" />
              Optimization Adoption Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-center mb-4">
                <p className="text-4xl font-bold text-navy-700">{optimizationAdoption.adoptionRate}%</p>
                <p className="text-sm text-slate-600">Overall Adoption Rate</p>
                <p className="text-xs text-slate-500 mt-1">
                  {optimizationAdoption.adopted} of {optimizationAdoption.total} opportunities adopted
                </p>
              </div>
              
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={optimizationAdoption.statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percentage }) => percentage > 0 ? `${name}: ${percentage}%` : ''}
                    outerRadius={80}
                    fill="#264491"
                    dataKey="value"
                  >
                    {optimizationAdoption.statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}