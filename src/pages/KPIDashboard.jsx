import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Lock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Users, 
  Activity,
  AlertTriangle,
  Target,
  BarChart3,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

const FinancialAccessDenied = () => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
    <div className="text-center max-w-md">
      <div className="bg-red-100 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
        <Lock className="h-8 w-8 text-red-600" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Restricted</h2>
      <p className="text-slate-600">Financial and revenue information is only accessible to agency admins and super admins.</p>
    </div>
  </div>
);

export default function KPIDashboard() {
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const [periodType, setPeriodType] = useState('monthly');
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  });

  if (user && user.role !== 'admin') return <FinancialAccessDenied />;

  const queryClient = useQueryClient();

  const { data: kpis, isLoading } = useQuery({
    queryKey: ['agency-kpis', periodType, selectedPeriod],
    queryFn: async () => {
      const allKPIs = await base44.entities.AgencyKPI.filter({
        period_type: periodType,
        period_start: selectedPeriod.start,
        period_end: selectedPeriod.end
      });
      return allKPIs;
    }
  });

  const generateKPIsMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('generateAgencyKPIs', {
        period_type: periodType,
        period_start: selectedPeriod.start,
        period_end: selectedPeriod.end
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['agency-kpis']);
      toast.success('KPIs generated successfully');
    },
    onError: (error) => {
      toast.error('Failed to generate KPIs: ' + error.message);
    }
  });

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'financial': return <DollarSign className="h-5 w-5" />;
      case 'clinical': return <Activity className="h-5 w-5" />;
      case 'operational': return <Users className="h-5 w-5" />;
      case 'compliance': return <Target className="h-5 w-5" />;
      case 'quality': return <BarChart3 className="h-5 w-5" />;
      default: return <Activity className="h-5 w-5" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'on_target': return 'bg-green-100 text-green-800 border-green-300';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const groupedKPIs = kpis?.reduce((acc, kpi) => {
    if (!acc[kpi.metric_category]) {
      acc[kpi.metric_category] = [];
    }
    acc[kpi.metric_category].push(kpi);
    return acc;
  }, {}) || {};

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">KPI Dashboard</h1>
            <p className="text-sm text-slate-600 mt-1">Key Performance Indicators & Metrics</p>
          </div>
          <Button
            onClick={() => generateKPIsMutation.mutate()}
            disabled={generateKPIsMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {generateKPIsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Generate KPIs
              </>
            )}
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700 mb-2 block">Period Type</label>
                <Select value={periodType} onValueChange={setPeriodType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700 mb-2 block">Start Date</label>
                <input
                  type="date"
                  value={selectedPeriod.start}
                  onChange={(e) => setSelectedPeriod({ ...selectedPeriod, start: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-700 mb-2 block">End Date</label>
                <input
                  type="date"
                  value={selectedPeriod.end}
                  onChange={(e) => setSelectedPeriod({ ...selectedPeriod, end: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI Categories */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : Object.keys(groupedKPIs).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-600 mb-4">No KPIs generated for this period</p>
              <Button
                onClick={() => generateKPIsMutation.mutate()}
                disabled={generateKPIsMutation.isPending}
              >
                Generate KPIs Now
              </Button>
            </CardContent>
          </Card>
        ) : (
          Object.entries(groupedKPIs).map(([category, categoryKPIs]) => (
            <div key={category}>
              <h2 className="text-xl font-semibold text-slate-900 mb-4 capitalize flex items-center gap-2">
                {getCategoryIcon(category)}
                {category} Metrics
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categoryKPIs.map((kpi) => (
                  <Card key={kpi.id} className="border-2">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-sm font-semibold">{kpi.metric_name}</CardTitle>
                        <Badge className={getStatusColor(kpi.status)}>
                          {kpi.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-end justify-between">
                          <div>
                            <p className="text-3xl font-bold text-slate-900">
                              {kpi.unit === '$' && '$'}
                              {kpi.metric_value.toFixed(kpi.unit === '%' || kpi.unit === 'score' ? 1 : 0)}
                              {kpi.unit === '%' && '%'}
                            </p>
                            <p className="text-xs text-slate-600 mt-1">Current Value</p>
                          </div>
                          <div className="text-right">
                            {kpi.trend === 'up' ? (
                              <TrendingUp className="h-5 w-5 text-green-600" />
                            ) : kpi.trend === 'down' ? (
                              <TrendingDown className="h-5 w-5 text-red-600" />
                            ) : (
                              <div className="h-5 w-5" />
                            )}
                          </div>
                        </div>

                        {kpi.target_value && (
                          <div className="pt-3 border-t">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-600">Target:</span>
                              <span className="font-semibold">
                                {kpi.unit === '$' && '$'}
                                {kpi.target_value.toFixed(kpi.unit === '%' || kpi.unit === 'score' ? 1 : 0)}
                                {kpi.unit === '%' && '%'}
                              </span>
                            </div>
                            {kpi.benchmark_value && (
                              <div className="flex items-center justify-between text-xs mt-1">
                                <span className="text-slate-600">Benchmark:</span>
                                <span className="font-semibold">
                                  {kpi.unit === '$' && '$'}
                                  {kpi.benchmark_value.toFixed(kpi.unit === '%' || kpi.unit === 'score' ? 1 : 0)}
                                  {kpi.unit === '%' && '%'}
                                </span>
                              </div>
                            )}
                            {kpi.variance_percentage !== undefined && (
                              <div className="flex items-center justify-between text-xs mt-1">
                                <span className="text-slate-600">Variance:</span>
                                <span className={kpi.variance_percentage >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                                  {kpi.variance_percentage >= 0 ? '+' : ''}
                                  {kpi.variance_percentage.toFixed(1)}%
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}