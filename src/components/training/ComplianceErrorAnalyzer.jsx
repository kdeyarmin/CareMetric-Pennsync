import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, AlertCircle, Target } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function ComplianceErrorAnalyzer({ userEmail, onGenerateTraining }) {
  const { data: violations = [], isLoading } = useQuery({
    queryKey: ['userViolations', userEmail],
    queryFn: () => base44.entities.ComplianceViolation.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  // Analyze error patterns
  const errorAnalysis = useMemo(() => {
    if (violations.length === 0) return null;

    // Group by rule name
    const ruleGroups = violations.reduce((acc, v) => {
      if (!acc[v.rule_name]) {
        acc[v.rule_name] = {
          rule_name: v.rule_name,
          category: v.rule_category,
          severity: v.severity,
          count: 0,
          examples: [],
          statuses: { open: 0, resolved: 0 }
        };
      }
      acc[v.rule_name].count++;
      acc[v.rule_name].statuses[v.status]++;
      if (acc[v.rule_name].examples.length < 3) {
        acc[v.rule_name].examples.push(v.violation_description);
      }
      return acc;
    }, {});

    const patterns = Object.values(ruleGroups)
      .sort((a, b) => b.count - a.count);

    // Calculate total errors by severity
    const severityCounts = violations.reduce((acc, v) => {
      acc[v.severity] = (acc[v.severity] || 0) + 1;
      return acc;
    }, {});

    // Top 3 most common errors
    const topErrors = patterns.slice(0, 3);

    // Resolution rate
    const resolvedCount = violations.filter(v => v.status === 'resolved').length;
    const resolutionRate = violations.length > 0 
      ? ((resolvedCount / violations.length) * 100).toFixed(1)
      : 0;

    return {
      totalViolations: violations.length,
      patterns,
      topErrors,
      severityCounts,
      resolutionRate,
      needsTraining: patterns.length > 0 && (severityCounts.critical > 0 || severityCounts.high >= 2)
    };
  }, [violations]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-gray-500">
          Analyzing compliance errors...
        </CardContent>
      </Card>
    );
  }

  if (!errorAnalysis || errorAnalysis.totalViolations === 0) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-6 text-center">
          <Target className="w-12 h-12 text-green-600 mx-auto mb-3" />
          <p className="font-semibold text-green-900">Excellent Compliance Performance!</p>
          <p className="text-sm text-green-700 mt-1">No compliance errors detected</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = errorAnalysis.patterns.slice(0, 5).map(p => ({
    name: p.rule_name.length > 30 ? p.rule_name.substring(0, 30) + '...' : p.rule_name,
    violations: p.count,
    open: p.statuses.open,
    resolved: p.statuses.resolved
  }));

  return (
    <Card className="border-orange-200 bg-orange-50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="w-5 h-5 text-orange-600" />
          Compliance Error Pattern Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3 bg-white rounded-lg border">
            <p className="text-2xl font-bold text-gray-900">{errorAnalysis.totalViolations}</p>
            <p className="text-xs text-gray-600">Total Errors</p>
          </div>
          <div className="p-3 bg-white rounded-lg border">
            <p className="text-2xl font-bold text-gray-900">{errorAnalysis.patterns.length}</p>
            <p className="text-xs text-gray-600">Error Types</p>
          </div>
          <div className="p-3 bg-white rounded-lg border">
            <p className="text-2xl font-bold text-gray-900">{errorAnalysis.resolutionRate}%</p>
            <p className="text-xs text-gray-600">Resolved</p>
          </div>
        </div>

        {/* Error Pattern Chart */}
        <div className="bg-white p-3 rounded-lg border">
          <p className="text-sm font-semibold mb-3">Top Error Patterns</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="violations" fill="#F97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top 3 Errors */}
        <div>
          <p className="text-sm font-semibold mb-2">Most Common Errors</p>
          <div className="space-y-2">
            {errorAnalysis.topErrors.map((error, idx) => (
              <div key={idx} className="p-3 bg-white rounded-lg border">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{error.rule_name}</p>
                    <p className="text-xs text-gray-600 mt-1">Category: {error.category}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-orange-600">{error.count}x</Badge>
                    <Badge className={
                      error.severity === 'critical' ? 'bg-red-600' :
                      error.severity === 'high' ? 'bg-orange-600' :
                      'bg-yellow-600'
                    }>
                      {error.severity}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Training Recommendation */}
        {errorAnalysis.needsTraining && (
          <div className="p-4 bg-purple-50 rounded-lg border-2 border-purple-300">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-purple-900 mb-1">Personalized Training Recommended</p>
                <p className="text-sm text-purple-800 mb-3">
                  We've identified {errorAnalysis.patterns.length} compliance error patterns. AI-generated training can help you improve.
                </p>
                <Button
                  size="sm"
                  onClick={() => onGenerateTraining(errorAnalysis.patterns)}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Brain className="w-4 h-4 mr-2" />
                  Generate Personalized Training
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}