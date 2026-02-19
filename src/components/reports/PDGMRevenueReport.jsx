import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  DollarSign, 
  TrendingUp, 
  AlertTriangle,
  Download,
  Loader2
} from 'lucide-react';

export default function PDGMRevenueReport({ startDate, endDate }) {
  const { data: pdgmRecords, isLoading } = useQuery({
    queryKey: ['pdgm-revenue', startDate, endDate],
    queryFn: async () => {
      const records = await base44.entities.PDGMCaseMix.filter({});
      return records.filter(r => {
        const periodStart = new Date(r.period_start_date);
        return periodStart >= new Date(startDate) && periodStart <= new Date(endDate);
      });
    }
  });

  const { data: billing } = useQuery({
    queryKey: ['billing-revenue', startDate, endDate],
    queryFn: async () => {
      const records = await base44.entities.Billing.filter({});
      return records.filter(r => {
        const billingStart = new Date(r.billing_period_start);
        return billingStart >= new Date(startDate) && billingStart <= new Date(endDate);
      });
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const totalEstimatedRevenue = pdgmRecords?.reduce((sum, r) => sum + (r.estimated_payment || 0), 0) || 0;
  const totalActualRevenue = billing?.reduce((sum, b) => sum + (b.total_paid || 0), 0) || 0;
  const averageCaseMix = pdgmRecords?.reduce((sum, r) => sum + (r.case_mix_weight || 0), 0) / (pdgmRecords?.length || 1) || 0;
  const lupaCount = pdgmRecords?.filter(r => r.is_lupa).length || 0;
  const lupaRate = pdgmRecords?.length > 0 ? (lupaCount / pdgmRecords.length) * 100 : 0;
  
  // Group by clinical grouping
  const groupingStats = pdgmRecords?.reduce((acc, r) => {
    if (!acc[r.clinical_grouping]) {
      acc[r.clinical_grouping] = { count: 0, revenue: 0 };
    }
    acc[r.clinical_grouping].count++;
    acc[r.clinical_grouping].revenue += r.estimated_payment || 0;
    return acc;
  }, {}) || {};

  // Optimization opportunities
  const optimizationOpportunities = pdgmRecords?.flatMap(r => 
    (r.optimization_opportunities || []).map(opp => ({
      ...opp,
      patient_id: r.patient_id,
      pdgm_id: r.id
    }))
  ) || [];

  const totalOptimizationImpact = optimizationOpportunities.reduce((sum, opp) => 
    sum + (opp.impact || 0), 0
  );

  return (
    <div className="space-y-6">
      {/* Revenue Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${totalEstimatedRevenue.toLocaleString()}</p>
                <p className="text-xs text-slate-600">Estimated Revenue</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{averageCaseMix.toFixed(2)}</p>
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
                <p className="text-2xl font-bold">{lupaRate.toFixed(1)}%</p>
                <p className="text-xs text-slate-600">LUPA Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${totalOptimizationImpact.toLocaleString()}</p>
                <p className="text-xs text-slate-600">Optimization Potential</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Clinical Grouping Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Clinical Grouping</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(groupingStats).map(([grouping, stats]) => (
              <div key={grouping} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="font-medium">{grouping}</p>
                  <p className="text-xs text-slate-600">{stats.count} episodes</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">${stats.revenue.toLocaleString()}</p>
                  <p className="text-xs text-slate-600">
                    ${(stats.revenue / stats.count).toLocaleString()} avg
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Optimization Opportunities */}
      {optimizationOpportunities.length > 0 && (
        <Card className="border-2 border-yellow-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Revenue Optimization Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {optimizationOpportunities.slice(0, 10).map((opp, idx) => (
                <div key={idx} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-medium text-sm">{opp.area}</p>
                    <Badge className="bg-green-100 text-green-800">
                      +${opp.impact?.toLocaleString()}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-700 mb-1">
                    Current: {opp.current_value} → Recommended: {opp.recommended_value}
                  </p>
                  <p className="text-xs text-slate-600">{opp.rationale}</p>
                </div>
              ))}
            </div>
            {optimizationOpportunities.length > 10 && (
              <p className="text-xs text-slate-600 text-center mt-3">
                +{optimizationOpportunities.length - 10} more opportunities
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}