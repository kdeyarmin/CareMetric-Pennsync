import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { AlertTriangle, TrendingDown, Target } from "lucide-react";

const _COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3557b0', '#8b5cf6'];

export default function DeficitVisualization({ analysis, compact = false }) {
  if (!analysis || analysis.totalSuggestions === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Target className="w-12 h-12 text-green-500 mx-auto mb-2" />
          <p className="text-slate-600">No deficits identified - excellent performance!</p>
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data
  const categoryData = Object.entries(analysis.analytics?.categoryBreakdown || {})
    .map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
    .sort((a, b) => b.value - a.value);

  const deficitData = analysis.deficits.slice(0, 5).map(d => ({
    name: (d.name || '').length > 15 ? (d.name || '').substring(0, 15) + '...' : (d.name || ''),
    count: d.count,
    percentage: d.percentage,
    severity: d.severity
  }));

  const severityData = [
    { name: 'Critical', value: analysis.analytics?.severityDistribution?.critical || 0, color: '#ef4444' },
    { name: 'High', value: analysis.analytics?.severityDistribution?.high || 0, color: '#f97316' },
    { name: 'Medium', value: analysis.analytics?.severityDistribution?.medium || 0, color: '#eab308' },
    { name: 'Low', value: analysis.analytics?.severityDistribution?.low || 0, color: '#22c55e' }
  ].filter(d => d.value > 0);

  const getSeverityColor = (severity) => {
    const colors = {
      critical: '#ef4444',
      high: '#f97316',
      medium: '#eab308',
      low: '#22c55e'
    };
    return colors[severity] || '#gray';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Deficit Frequency Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            Top Deficit Areas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={compact ? 200 : 250}>
            <BarChart data={deficitData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} angle={-45} textAnchor="end" height={80} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="#ef4444" radius={[8, 8, 0, 0]}>
                {deficitData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getSeverityColor(entry.severity)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Severity Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-orange-600" />
            Severity Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={compact ? 200 : 250}>
            <PieChart>
              <Pie
                data={severityData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}`}
                outerRadius={80}
                fill="#264491"
                dataKey="value"
              >
                {severityData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Category Breakdown */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">AI Suggestion Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={compact ? 200 : 300}>
            <BarChart data={categoryData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={12} />
              <YAxis dataKey="name" type="category" width={100} fontSize={12} />
              <Tooltip />
              <Bar dataKey="value" fill="#3557b0" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Patterns Summary */}
      {analysis.patterns?.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Identified Patterns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {analysis.patterns.slice(0, 4).map((pattern, idx) => (
                <div key={idx} className="bg-orange-50 p-3 rounded border border-orange-200">
                  <p className="text-sm font-medium text-orange-900">{pattern.description}</p>
                  <Badge className="mt-1 bg-orange-600 text-white text-xs">
                    {pattern.count} occurrences
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}