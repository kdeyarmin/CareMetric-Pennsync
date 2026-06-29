import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  TrendingUp, 
  Sparkles,
  ArrowRight
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from "recharts";

export default function ComplianceImpactReport({ noteConversions }) {
  if (!noteConversions || noteConversions.length === 0) {
    return null;
  }

  const conversionsWithCompliance = noteConversions.filter(nc => 
    nc.rough_note_compliance != null && 
    nc.enhanced_note_compliance != null &&
    typeof nc.rough_note_compliance === 'number' &&
    typeof nc.enhanced_note_compliance === 'number'
  );

  if (conversionsWithCompliance.length === 0) {
    return null;
  }

  const avgRoughCompliance = conversionsWithCompliance.reduce(
    (sum, nc) => sum + (nc.rough_note_compliance || 0), 0
  ) / conversionsWithCompliance.length;

  const avgEnhancedCompliance = conversionsWithCompliance.reduce(
    (sum, nc) => sum + (nc.enhanced_note_compliance || 0), 0
  ) / conversionsWithCompliance.length;

  const avgImprovement = avgEnhancedCompliance - avgRoughCompliance;

  // Group by nurse for individual impact
  const nurseImpact = {};
  conversionsWithCompliance.forEach(nc => {
    const email = nc.nurse_email || 'unknown';
    if (!nurseImpact[email]) {
      nurseImpact[email] = {
        email: email,
        notes: [],
        totalRough: 0,
        totalEnhanced: 0,
        count: 0
      };
    }
    nurseImpact[email].notes.push(nc);
    nurseImpact[email].totalRough += (nc.rough_note_compliance || 0);
    nurseImpact[email].totalEnhanced += (nc.enhanced_note_compliance || 0);
    nurseImpact[email].count++;
  });

  const nurseStats = Object.values(nurseImpact).map(n => ({
    nurse: n.email.split('@')[0],
    avgRough: (n.totalRough / n.count).toFixed(1),
    avgEnhanced: (n.totalEnhanced / n.count).toFixed(1),
    improvement: ((n.totalEnhanced - n.totalRough) / n.count).toFixed(1),
    count: n.count
  }));

  // Timeline data - safely handle dates and values
  const timelineData = conversionsWithCompliance
    .filter(nc => nc.created_date)
    .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
    .slice(-20) // Last 20 notes for readability
    .map((nc, idx) => ({
      note: `Note ${idx + 1}`,
      rough: nc.rough_note_compliance || 0,
      enhanced: nc.enhanced_note_compliance || 0
    }));

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader className="bg-gradient-to-r from-navy-100 to-gold-100">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-navy-600" />
          AI Enhancement Impact Report
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-white rounded-lg border-2 border-orange-200">
            <p className="text-sm text-slate-600 mb-1">Before AI</p>
            <p className="text-4xl font-bold text-orange-600">{avgRoughCompliance.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-1">Avg rough draft compliance</p>
          </div>
          <div className="p-4 bg-white rounded-lg border-2 border-green-200">
            <p className="text-sm text-slate-600 mb-1">After AI</p>
            <p className="text-4xl font-bold text-green-600">{avgEnhancedCompliance.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-1">Avg enhanced compliance</p>
          </div>
          <div className="p-4 bg-white rounded-lg border-2 border-navy-200">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-5 h-5 text-navy-600" />
              <p className="text-sm text-slate-600">AI Impact</p>
            </div>
            <p className="text-4xl font-bold text-navy-600">+{avgImprovement.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-1">Avg improvement</p>
          </div>
          <div className="p-4 bg-white rounded-lg border-2 border-blue-200">
            <p className="text-sm text-slate-600 mb-1">Notes Analyzed</p>
            <p className="text-4xl font-bold text-blue-600">{conversionsWithCompliance.length}</p>
            <p className="text-xs text-slate-500 mt-1">With compliance tracking</p>
          </div>
        </div>

        {/* Before vs After Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Compliance: Before vs After AI Enhancement</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[
                { metric: 'Rough Draft', compliance: avgRoughCompliance },
                { metric: 'AI Enhanced', compliance: avgEnhancedCompliance }
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="metric" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="compliance" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Nurse-by-Nurse Impact */}
        {nurseStats.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">AI Impact by Nurse</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {nurseStats.map((stat, idx) => (
                  <div key={idx} className="p-3 bg-white rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-slate-900">{stat.nurse}</span>
                      <Badge className="bg-navy-100 text-navy-800">
                        {stat.count} note{stat.count > 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="text-center p-2 bg-orange-50 rounded">
                        <p className="text-orange-600 font-bold">{stat.avgRough}%</p>
                        <p className="text-slate-600">Before</p>
                      </div>
                      <div className="flex items-center justify-center">
                        <ArrowRight className="w-4 h-4 text-navy-600" />
                      </div>
                      <div className="text-center p-2 bg-green-50 rounded">
                        <p className="text-green-600 font-bold">{stat.avgEnhanced}%</p>
                        <p className="text-slate-600">After</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Progress value={Math.min(Math.max(parseFloat(stat.improvement) * 2, 0), 100)} className="flex-1" />
                      <span className="text-sm font-semibold text-navy-600">+{stat.improvement}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Timeline of Improvements */}
        {timelineData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Compliance Improvement Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="note" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="rough" 
                    stroke="#f97316" 
                    strokeWidth={2}
                    name="Rough Draft"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="enhanced" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    name="AI Enhanced"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}