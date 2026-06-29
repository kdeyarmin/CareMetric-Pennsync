import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Target } from "lucide-react";
import {
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

export default function OASISAccuracyTrends({ data = [], compact = false }) {
  // Group data by week
  const weeklyData = useMemo(() => {
    const weeks = {};
    
    data.forEach(item => {
      const date = new Date(item.created_date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weeks[weekKey]) {
        weeks[weekKey] = {
          week: weekKey,
          accuracySum: 0,
          overallSum: 0,
          complianceSum: 0,
          revenueSum: 0,
          count: 0
        };
      }
      
      weeks[weekKey].accuracySum += item.scores?.accuracy || 0;
      weeks[weekKey].overallSum += item.scores?.overall || 0;
      weeks[weekKey].complianceSum += item.scores?.compliance || 0;
      weeks[weekKey].revenueSum += item.scores?.revenue_optimization || 0;
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
        accuracy: w.count > 0 ? Math.round(w.accuracySum / w.count) : 0,
        overall: w.count > 0 ? Math.round(w.overallSum / w.count) : 0,
        compliance: w.count > 0 ? Math.round(w.complianceSum / w.count) : 0,
        revenue: w.count > 0 ? Math.round(w.revenueSum / w.count) : 0,
        count: w.count
      }));
  }, [data]);

  // Calculate trend
  const trend = useMemo(() => {
    if (weeklyData.length < 2) return { value: 0, positive: true };
    const recent = weeklyData.slice(-2);
    const diff = recent[1]?.accuracy - recent[0]?.accuracy;
    return { value: Math.abs(diff).toFixed(1), positive: diff >= 0 };
  }, [weeklyData]);

  // Score distribution
  const scoreDistribution = useMemo(() => {
    const ranges = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, '<60': 0 };
    data.forEach(item => {
      const score = item.scores?.accuracy || 0;
      if (score >= 90) ranges['90-100']++;
      else if (score >= 80) ranges['80-89']++;
      else if (score >= 70) ranges['70-79']++;
      else if (score >= 60) ranges['60-69']++;
      else ranges['<60']++;
    });
    return Object.entries(ranges).map(([range, count]) => ({ range, count }));
  }, [data]);

  return (
    <Card className={compact ? "" : "col-span-full"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" />
            OASIS Accuracy Trends
          </div>
          <div className="flex items-center gap-2">
            {trend.positive ? (
              <Badge className="bg-green-100 text-green-800">
                <TrendingUp className="w-3 h-3 mr-1" /> +{trend.value}%
              </Badge>
            ) : (
              <Badge className="bg-red-100 text-red-800">
                <TrendingDown className="w-3 h-3 mr-1" /> -{trend.value}%
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No OASIS data available for this period</p>
        ) : (
          <div className={compact ? "" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
            {/* Main trend chart */}
            <div className={compact ? "" : "lg:col-span-2"}>
              <ResponsiveContainer width="100%" height={compact ? 200 : 300}>
                <AreaChart data={weeklyData}>
                  <defs>
                    <linearGradient id="accuracyGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3557b0" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3557b0" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip 
                    formatter={(value) => [`${value}%`, '']}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend />
                  <Area 
                    type="monotone" 
                    dataKey="accuracy" 
                    stroke="#3557b0" 
                    fill="url(#accuracyGradient)"
                    name="Accuracy"
                  />
                  <Line type="monotone" dataKey="overall" stroke="#8b5cf6" name="Overall" strokeWidth={2} dot={false} />
                  {!compact && <Line type="monotone" dataKey="compliance" stroke="#10b981" name="Compliance" strokeWidth={2} dot={false} />}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Score distribution */}
            {!compact && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-3">Score Distribution</p>
                <div className="space-y-2">
                  {scoreDistribution.map(({ range, count }) => {
                    const percentage = data.length > 0 ? (count / data.length * 100).toFixed(0) : 0;
                    const color = range === '90-100' ? 'bg-green-500' :
                                  range === '80-89' ? 'bg-blue-500' :
                                  range === '70-79' ? 'bg-yellow-500' :
                                  range === '60-69' ? 'bg-orange-500' : 'bg-red-500';
                    return (
                      <div key={range} className="flex items-center gap-2">
                        <span className="text-xs text-slate-600 w-16">{range}%</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-4">
                          <div 
                            className={`${color} h-4 rounded-full transition-all`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-700 w-8">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}