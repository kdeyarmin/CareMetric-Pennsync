import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";
import { TrendingUp, Shield } from "lucide-react";
import { format } from "date-fns";

export default function ComplianceTrendChart({ 
  complianceAudits = [],
  noteConversions = [],
  compact = false 
}) {
  // Group audits by day. Key on the full ISO date (yyyy-MM-dd) — keying on MM/dd
  // discards the year, so entries from different years merge into one bucket and a
  // Dec/Jan boundary sorts wrong; the MM/dd label is kept only for display.
  const auditsByWeek = complianceAudits.reduce((acc, audit) => {
    const date = new Date(audit.audit_date);
    if (isNaN(date)) return acc;
    const key = format(date, 'yyyy-MM-dd');
    if (!acc[key]) {
      acc[key] = { total: 0, count: 0, label: format(date, 'MM/dd') };
    }
    acc[key].total += audit.compliance_score || 0;
    acc[key].count++;
    return acc;
  }, {});

  const auditTrendData = Object.entries(auditsByWeek)
    .sort(([a], [b]) => a.localeCompare(b)) // ISO date keys sort chronologically
    .map(([, data]) => ({
      week: data.label,
      avgScore: Math.round(data.total / data.count)
    }))
    .slice(-12); // Last 12 days

  // Note quality scores over time
  const noteQualityByWeek = noteConversions.reduce((acc, note) => {
    const date = new Date(note.created_date);
    if (isNaN(date)) return acc;
    const key = format(date, 'yyyy-MM-dd');
    if (!acc[key]) {
      acc[key] = { quality: [], compliance: [], label: format(date, 'MM/dd') };
    }
    if (note.quality_score) acc[key].quality.push(note.quality_score);
    if (note.compliance_score) acc[key].compliance.push(note.compliance_score);
    return acc;
  }, {});

  const noteQualityData = Object.entries(noteQualityByWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, data]) => ({
      week: data.label,
      quality: data.quality.length > 0
        ? Math.round(data.quality.reduce((a, b) => a + b, 0) / data.quality.length)
        : 0,
      compliance: data.compliance.length > 0
        ? Math.round(data.compliance.reduce((a, b) => a + b, 0) / data.compliance.length)
        : 0
    }))
    .filter(d => d.quality > 0 || d.compliance > 0)
    .slice(-12);

  // Calculate current vs previous period
  const currentAvg = auditTrendData.length > 0 
    ? Math.round(auditTrendData.slice(-4).reduce((sum, d) => sum + d.avgScore, 0) / Math.min(4, auditTrendData.length))
    : 0;
  
  const previousWindow = auditTrendData.length > 4 ? auditTrendData.slice(-8, -4) : [];
  const previousAvg = previousWindow.length > 0
    ? Math.round(previousWindow.reduce((sum, d) => sum + d.avgScore, 0) / previousWindow.length)
    : 0;

  const trend = currentAvg - previousAvg;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-3 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Current Compliance Score</p>
                <p className="text-3xl font-bold text-slate-900">{currentAvg}%</p>
                {trend !== 0 && (
                  <div className={`flex items-center gap-1 mt-1 ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <TrendingUp className={`w-4 h-4 ${trend < 0 ? 'rotate-180' : ''}`} />
                    <span className="text-sm font-medium">
                      {Math.abs(trend)}% vs previous period
                    </span>
                  </div>
                )}
              </div>
              <Shield className="w-12 h-12 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Compliance Score Trend */}
      {auditTrendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Compliance Score Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={compact ? 200 : 280}>
              <AreaChart data={auditTrendData}>
                <defs>
                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3557b0" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3557b0" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" fontSize={12} />
                <YAxis fontSize={12} domain={[0, 100]} />
                <Tooltip />
                <Area 
                  type="monotone" 
                  dataKey="avgScore" 
                  stroke="#3557b0" 
                  strokeWidth={2}
                  fill="url(#colorScore)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Note Quality vs Compliance */}
      {noteQualityData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Note Quality & Compliance Scores</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={compact ? 200 : 280}>
              <LineChart data={noteQualityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" fontSize={12} />
                <YAxis fontSize={12} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="quality" 
                  stroke="#8b5cf6" 
                  strokeWidth={2}
                  name="Quality Score"
                  dot={{ r: 3 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="compliance" 
                  stroke="#22c55e" 
                  strokeWidth={2}
                  name="Compliance Score"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}