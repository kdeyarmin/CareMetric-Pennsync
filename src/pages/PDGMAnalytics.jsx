import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import PDGMRevenueReport from '@/components/reports/PDGMRevenueReport';
import RevenueForecasting from '@/components/analytics/RevenueForecasting';
import CodingGapAnalyzer from '@/components/analytics/CodingGapAnalyzer';
import { 
  DollarSign, 
  TrendingUp, 
  AlertTriangle,
  BarChart3,
  Loader2
} from 'lucide-react';

export default function PDGMAnalytics() {
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  });

  const { data: pdgmRecords, isLoading } = useQuery({
    queryKey: ['pdgm-overview'],
    queryFn: () => base44.entities.PDGMCaseMix.filter({})
  });

  const totalEpisodes = pdgmRecords?.length || 0;
  const avgCaseMix = pdgmRecords?.reduce((sum, r) => sum + (r.case_mix_weight || 0), 0) / (totalEpisodes || 1) || 0;
  const totalRevenue = pdgmRecords?.reduce((sum, r) => sum + (r.estimated_payment || 0), 0) || 0;
  const avgOptimization = pdgmRecords?.reduce((sum, r) => sum + (r.optimization_score || 0), 0) / (totalEpisodes || 1) || 0;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">PDGM Analytics</h1>
          <p className="text-sm text-slate-600 mt-1">
            Revenue optimization and case mix analysis
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{totalEpisodes}</p>
                  <p className="text-xs text-slate-600">Total Episodes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">${totalRevenue.toLocaleString()}</p>
                  <p className="text-xs text-slate-600">Total Revenue</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{avgCaseMix.toFixed(2)}</p>
                  <p className="text-xs text-slate-600">Avg Case Mix</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-yellow-100 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{avgOptimization.toFixed(0)}%</p>
                  <p className="text-xs text-slate-600">Avg Optimization</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Date Range */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700 mb-2 block">Start Date</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700 mb-2 block">End Date</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Analytics Tabs */}
        <Tabs defaultValue="revenue">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="revenue">Revenue Analysis</TabsTrigger>
            <TabsTrigger value="forecast">Forecasting</TabsTrigger>
            <TabsTrigger value="gaps">Coding Gaps</TabsTrigger>
          </TabsList>

          <TabsContent value="revenue" className="mt-6">
            <PDGMRevenueReport startDate={dateRange.start} endDate={dateRange.end} />
          </TabsContent>

          <TabsContent value="forecast" className="mt-6">
            <RevenueForecasting />
          </TabsContent>

          <TabsContent value="gaps" className="mt-6">
            <CodingGapAnalyzer />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}