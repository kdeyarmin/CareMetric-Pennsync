import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Brain, RefreshCw, TrendingUp, AlertCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function AISystemHealthSummary({ 
  totalUsers, 
  activePatients, 
  visitsThisWeek, 
  avgDocTime,
  securityLogs 
}) {
  const [summary, setSummary] = useState(null);

  const generateSummaryMutation = useMutation({
    mutationFn: async () => {
      const recentErrors = securityLogs.filter(log => 
        log.action.includes('ERROR') || log.action.includes('FAILED')
      ).length;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this system health data and provide an intelligent summary with insights and recommendations:

System Metrics:
- Total Users: ${totalUsers}
- Active Patients: ${activePatients}
- Visits This Week: ${visitsThisWeek}
- Average Documentation Time: ${avgDocTime} minutes
- Recent Errors: ${recentErrors}
- Total Security Events: ${securityLogs.length}

Provide:
1. Overall system health status (excellent/good/fair/poor)
2. Key insights about system performance
3. Trends and patterns you observe
4. Specific recommendations for improvement
5. Any concerns or warnings

Return as JSON.`,
        response_json_schema: {
          type: "object",
          properties: {
            health_status: { type: "string" },
            health_score: { type: "number" },
            key_insights: { type: "array", items: { type: "string" } },
            trends: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } },
            concerns: { type: "array", items: { type: "string" } }
          }
        }
      });
      return response;
    },
    onSuccess: (data) => {
      setSummary(data);
    }
  });

  useEffect(() => {
    generateSummaryMutation.mutate();
  }, []);

  const getStatusColor = (status) => {
    const colors = {
      excellent: "bg-green-100 text-green-800 border-green-300",
      good: "bg-blue-100 text-blue-800 border-blue-300",
      fair: "bg-yellow-100 text-yellow-800 border-yellow-300",
      poor: "bg-red-100 text-red-800 border-red-300"
    };
    return colors[status?.toLowerCase()] || colors.good;
  };

  return (
    <Card className="border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="w-5 h-5 text-green-600" />
            AI System Health Summary
          </CardTitle>
          <Button
            onClick={() => generateSummaryMutation.mutate()}
            disabled={generateSummaryMutation.isPending}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={`w-4 h-4 ${generateSummaryMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {generateSummaryMutation.isPending ? (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-green-600 mx-auto mb-3 animate-pulse" />
            <p className="text-sm text-gray-600">Analyzing system health...</p>
          </div>
        ) : summary ? (
          <div className="space-y-4">
            {/* Health Status */}
            <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
              <div>
                <p className="text-sm text-gray-600 mb-1">System Health Status</p>
                <Badge className={`${getStatusColor(summary.health_status)} text-base px-3 py-1`}>
                  {summary.health_status}
                </Badge>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-green-600">{summary.health_score}/100</p>
                <p className="text-xs text-gray-500">Health Score</p>
              </div>
            </div>

            {/* Key Insights */}
            {summary.key_insights && summary.key_insights.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <h4 className="font-semibold text-gray-900">Key Insights</h4>
                </div>
                <ul className="space-y-1">
                  {summary.key_insights.map((insight, idx) => (
                    <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-green-600 mt-1">•</span>
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations */}
            {summary.recommendations && summary.recommendations.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-2">Recommendations</h4>
                <ul className="space-y-1">
                  {summary.recommendations.map((rec, idx) => (
                    <li key={idx} className="text-sm text-blue-800 flex items-start gap-2">
                      <span className="text-blue-600 mt-1">→</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Concerns */}
            {summary.concerns && summary.concerns.length > 0 && (
              <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-orange-600" />
                  <h4 className="font-semibold text-orange-900">Concerns</h4>
                </div>
                <ul className="space-y-1">
                  {summary.concerns.map((concern, idx) => (
                    <li key={idx} className="text-sm text-orange-800 flex items-start gap-2">
                      <span className="text-orange-600 mt-1">⚠</span>
                      <span>{concern}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500">
            <Brain className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="text-sm">Click refresh to generate AI summary</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}