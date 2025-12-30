import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Sparkles, Brain, Target, Shield, FileText, Zap } from "lucide-react";

const FEATURE_COLORS = {
  note_enhanced: '#3b82f6',
  compliance_check: '#10b981',
  oasis_automation: '#a855f7',
  pdgm_optimization: '#f59e0b',
  clinical_decision_support: '#ef4444',
  voice_transcription: '#06b6d4',
  task_generation: '#ec4899',
  care_plan_generation: '#8b5cf6',
  other: '#6b7280'
};

export default function AIFeatureUsageStats({ userActivity = [], noteConversions = [] }) {
  // Analyze AI feature usage
  const featureUsage = React.useMemo(() => {
    const usage = {};
    
    // Count from user activity
    userActivity.forEach(activity => {
      if (activity.details?.ai_utilization || activity.details?.feature) {
        const feature = activity.details.feature || activity.action;
        usage[feature] = (usage[feature] || 0) + 1;
      }
    });

    // Count note enhancements
    usage['note_enhanced'] = noteConversions.length;

    // Format for charts
    const chartData = Object.entries(usage)
      .map(([feature, count]) => ({
        feature: feature.replace(/_/g, ' '),
        count,
        color: FEATURE_COLORS[feature] || FEATURE_COLORS.other
      }))
      .sort((a, b) => b.count - a.count);

    const total = chartData.reduce((sum, item) => sum + item.count, 0);

    return { chartData, total, usage };
  }, [userActivity, noteConversions]);

  // Calculate AI adoption rate
  const adoptionMetrics = React.useMemo(() => {
    const totalActions = userActivity.length;
    const aiActions = userActivity.filter(a => a.details?.ai_utilization || a.details?.feature).length;
    const adoptionRate = totalActions > 0 ? Math.round((aiActions / totalActions) * 100) : 0;

    return {
      totalActions,
      aiActions,
      adoptionRate,
      manualActions: totalActions - aiActions
    };
  }, [userActivity]);

  return (
    <div className="space-y-4">
      {/* AI Adoption Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-purple-600 font-medium">AI Adoption</p>
                <p className="text-3xl font-bold text-purple-900">{adoptionMetrics.adoptionRate}%</p>
                <p className="text-xs text-purple-600">{adoptionMetrics.aiActions} AI actions</p>
              </div>
              <Sparkles className="w-10 h-10 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600 font-medium">Total Features</p>
                <p className="text-3xl font-bold text-blue-900">{featureUsage.total}</p>
                <p className="text-xs text-blue-600">Used overall</p>
              </div>
              <Brain className="w-10 h-10 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-green-600 font-medium">Top Feature</p>
                <p className="text-lg font-bold text-green-900">
                  {featureUsage.chartData[0]?.feature || 'N/A'}
                </p>
                <p className="text-xs text-green-600">{featureUsage.chartData[0]?.count || 0} uses</p>
              </div>
              <Zap className="w-10 h-10 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feature Usage Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            AI Feature Usage Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {featureUsage.chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={featureUsage.chartData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="feature" type="category" width={150} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">Start using AI features to see your usage stats</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Feature Details List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature Usage Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {featureUsage.chartData.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
              <div className="flex items-center gap-3">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-sm font-medium capitalize">{item.feature}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{item.count} uses</Badge>
                <span className="text-xs text-gray-500">
                  {Math.round((item.count / featureUsage.total) * 100)}%
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}