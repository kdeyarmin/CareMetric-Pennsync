import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, ArrowUpRight } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

export default function RevenueImpactAnalysis({ data = [], compact = false }) {
  // Weekly revenue data
  const weeklyRevenue = useMemo(() => {
    const weeks = {};
    
    data.forEach(item => {
      const date = new Date(item.created_date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weeks[weekKey]) {
        weeks[weekKey] = { week: weekKey, actual: 0, potential: 0, count: 0 };
      }
      
      const actualPayment = item.estimated_payment || 0;
      // Estimate potential based on revenue optimization score
      const optimizationScore = item.scores?.revenue_optimization || 70;
      const potentialMultiplier = 1 + ((100 - optimizationScore) / 100 * 0.15);
      
      weeks[weekKey].actual += actualPayment;
      weeks[weekKey].potential += actualPayment * potentialMultiplier;
      weeks[weekKey].count += 1;
    });

    // Sort/slice on the ISO weekKey BEFORE formatting to a year-less label —
    // `new Date("Mar 5")` assumes the current year, so sorting on the label
    // misorders weeks that straddle a year boundary.
    return Object.values(weeks)
      .sort((a, b) => new Date(a.week) - new Date(b.week))
      .slice(-8)
      .map(w => ({
        week: new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        actual: Math.round(w.actual),
        potential: Math.round(w.potential),
        gap: Math.round(w.potential - w.actual),
        episodes: w.count
      }));
  }, [data]);

  // Summary metrics
  const metrics = useMemo(() => {
    const totalActual = weeklyRevenue.reduce((s, w) => s + w.actual, 0);
    const totalPotential = weeklyRevenue.reduce((s, w) => s + w.potential, 0);
    const totalGap = totalPotential - totalActual;
    const totalEpisodes = weeklyRevenue.reduce((s, w) => s + w.episodes, 0);
    const avgPerEpisode = totalEpisodes > 0 ? totalActual / totalEpisodes : 0;

    return {
      totalActual,
      totalPotential,
      totalGap,
      totalEpisodes,
      avgPerEpisode,
      optimizationRate: totalActual > 0 ? Math.round(totalActual / totalPotential * 100) : 0
    };
  }, [weeklyRevenue]);

  // Revenue by clinical group (simulated based on diagnosis patterns)
  const revenueByCategory = useMemo(() => {
    const categories = {
      'Cardiac': { amount: 0, count: 0 },
      'Respiratory': { amount: 0, count: 0 },
      'Wound Care': { amount: 0, count: 0 },
      'Diabetes': { amount: 0, count: 0 },
      'Other': { amount: 0, count: 0 }
    };

    data.forEach(item => {
      const dx = (item.pdgm_data?.primary_diagnosis || '').toLowerCase();
      let category = 'Other';
      if (dx.includes('heart') || dx.includes('chf') || dx.includes('cardiac')) category = 'Cardiac';
      else if (dx.includes('copd') || dx.includes('respiratory') || dx.includes('pneumonia')) category = 'Respiratory';
      else if (dx.includes('wound') || dx.includes('ulcer')) category = 'Wound Care';
      else if (dx.includes('diabetes') || dx.includes('diabetic')) category = 'Diabetes';

      categories[category].amount += item.estimated_payment || 0;
      categories[category].count += 1;
    });

    return Object.entries(categories)
      .map(([name, data]) => ({ name, ...data, avg: data.count > 0 ? Math.round(data.amount / data.count) : 0 }))
      .filter(c => c.count > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  const formatCurrency = (val) => `$${(val / 1000).toFixed(1)}k`;

  return (
    <Card className={compact ? "" : "col-span-full"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            Revenue Impact Analysis
          </div>
          {metrics.totalGap > 0 && (
            <Badge className="bg-green-100 text-green-800">
              <ArrowUpRight className="w-3 h-3 mr-1" />
              ${(metrics.totalGap / 1000).toFixed(1)}k opportunity
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No revenue data available</p>
        ) : (
          <>
            {/* Summary metrics */}
            <div className={`grid ${compact ? 'grid-cols-3' : 'grid-cols-5'} gap-3 mb-6`}>
              <div className="text-center p-3 bg-green-50 rounded-lg border border-green-200">
                <p className="text-xl font-bold text-green-900">${(metrics.totalActual / 1000).toFixed(1)}k</p>
                <p className="text-xs text-green-700">Total Revenue</p>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xl font-bold text-blue-900">${(metrics.totalPotential / 1000).toFixed(1)}k</p>
                <p className="text-xs text-blue-700">Potential</p>
              </div>
              <div className="text-center p-3 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-xl font-bold text-amber-900">{metrics.optimizationRate}%</p>
                <p className="text-xs text-amber-700">Capture Rate</p>
              </div>
              {!compact && (
                <>
                  <div className="text-center p-3 bg-navy-50 rounded-lg border border-navy-200">
                    <p className="text-xl font-bold text-navy-900">{metrics.totalEpisodes}</p>
                    <p className="text-xs text-navy-700">Episodes</p>
                  </div>
                  <div className="text-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-xl font-bold text-slate-900">${metrics.avgPerEpisode.toFixed(0)}</p>
                    <p className="text-xs text-slate-700">Avg/Episode</p>
                  </div>
                </>
              )}
            </div>

            {/* Charts */}
            <div className={compact ? "" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
              <div className={compact ? "" : "lg:col-span-2"}>
                <ResponsiveContainer width="100%" height={compact ? 200 : 280}>
                  <AreaChart data={weeklyRevenue}>
                    <defs>
                      <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 11 }} />
                    <Tooltip 
                      formatter={(value) => [`$${value.toLocaleString()}`, '']}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="actual" stroke="#22c55e" fill="url(#actualGradient)" name="Actual Revenue" />
                    <Area type="monotone" dataKey="potential" stroke="#3557b0" fill="none" strokeDasharray="5 5" name="Potential" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Revenue by category */}
              {!compact && revenueByCategory.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-3">Revenue by Clinical Group</p>
                  <div className="space-y-2">
                    {revenueByCategory.slice(0, 5).map((cat) => (
                      <div key={cat.name} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                        <span className="text-sm font-medium">{cat.name}</span>
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-900">${(cat.amount / 1000).toFixed(1)}k</p>
                          <p className="text-xs text-slate-500">{cat.count} episodes</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}