import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import {
  BarChart,
  Bar,
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

const _COLORS = ['#22c55e', '#3557b0', '#f59e0b', '#ef4444'];

export default function ComplianceRatesChart({ data = [], notes = [], compact = false }) {
  // Weekly compliance trends
  const weeklyCompliance = useMemo(() => {
    const weeks = {};
    
    data.forEach(item => {
      const date = new Date(item.created_date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!weeks[weekKey]) {
        weeks[weekKey] = { week: weekKey, scoreSum: 0, count: 0, passed: 0, flagged: 0 };
      }
      
      weeks[weekKey].scoreSum += item.compliance_score || 0;
      weeks[weekKey].count += 1;
      if (item.status === 'passed') weeks[weekKey].passed++;
      else weeks[weekKey].flagged++;
    });

    // Sort/slice on the ISO weekKey BEFORE formatting to a year-less label —
    // `new Date("Mar 5")` assumes the current year, so sorting on the label
    // misorders weeks that straddle a year boundary.
    return Object.values(weeks)
      .sort((a, b) => new Date(a.week) - new Date(b.week))
      .slice(-8)
      .map(w => ({
        week: new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        score: w.count > 0 ? Math.round(w.scoreSum / w.count) : 0,
        passed: w.passed,
        flagged: w.flagged
      }));
  }, [data]);

  // Status distribution
  const statusDistribution = useMemo(() => {
    const counts = { passed: 0, flagged: 0, critical: 0, pending: 0 };
    data.forEach(item => {
      if (item.status === 'passed') counts.passed++;
      else if (item.status === 'flagged') counts.flagged++;
      else if (item.status === 'critical') counts.critical++;
      else counts.pending++;
    });
    return [
      { name: 'Passed', value: counts.passed, color: '#22c55e' },
      { name: 'Flagged', value: counts.flagged, color: '#f59e0b' },
      { name: 'Critical', value: counts.critical, color: '#ef4444' },
      { name: 'Pending', value: counts.pending, color: '#6b7280' }
    ].filter(d => d.value > 0);
  }, [data]);

  // Note compliance from AI analysis
  const noteCompliance = useMemo(() => {
    const bins = { excellent: 0, good: 0, fair: 0, poor: 0 };
    notes.forEach(note => {
      const score = note.quality_score || 0;
      if (score >= 90) bins.excellent++;
      else if (score >= 75) bins.good++;
      else if (score >= 60) bins.fair++;
      else bins.poor++;
    });
    return [
      { name: 'Excellent (90+)', value: bins.excellent },
      { name: 'Good (75-89)', value: bins.good },
      { name: 'Fair (60-74)', value: bins.fair },
      { name: 'Needs Work (<60)', value: bins.poor }
    ];
  }, [notes]);

  const overallRate = data.length > 0
    ? Math.round(data.filter(d => d.status === 'passed').length / data.length * 100)
    : 0;

  return (
    <Card className={compact ? "" : "col-span-full"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Compliance Rates
          </div>
          <Badge className={overallRate >= 80 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
            {overallRate}% Pass Rate
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 && notes.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No compliance data available</p>
        ) : (
          <div className={compact ? "" : "grid grid-cols-1 lg:grid-cols-3 gap-6"}>
            {/* Trend chart */}
            <div className={compact ? "" : "lg:col-span-2"}>
              <ResponsiveContainer width="100%" height={compact ? 200 : 280}>
                <BarChart data={weeklyCompliance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend />
                  <Bar dataKey="passed" stackId="a" fill="#22c55e" name="Passed" />
                  <Bar dataKey="flagged" stackId="a" fill="#f59e0b" name="Flagged" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Status pie chart */}
            {!compact && statusDistribution.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Audit Status Distribution</p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {statusDistribution.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [value, 'Count']} />
                    <Legend 
                      layout="horizontal" 
                      verticalAlign="bottom"
                      formatter={(value) => <span className="text-xs">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Note quality summary */}
        {!compact && notes.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <p className="text-sm font-medium text-slate-700 mb-3">Note Quality Distribution</p>
            <div className="grid grid-cols-4 gap-3">
              {noteCompliance.map((item, idx) => (
                <div key={idx} className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-2xl font-bold text-slate-900">{item.value}</p>
                  <p className="text-xs text-slate-600">{item.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}