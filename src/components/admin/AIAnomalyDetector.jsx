import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Zap, TrendingUp, Shield, RefreshCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function AIAnomalyDetector({ securityLogs }) {
  const [anomalies, setAnomalies] = useState([]);

  const detectAnomaliesMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze these security logs and identify anomalies, suspicious patterns, or security concerns:

${JSON.stringify(securityLogs.slice(0, 50), null, 2)}

Identify:
1. Unusual login patterns or failed attempts
2. Suspicious user activity
3. Potential security threats
4. Anomalous access patterns
5. Any concerning trends

Return analysis in JSON format with array of anomalies, each containing: type, severity (critical/high/medium/low), description, affected_users, recommended_action.`,
        response_json_schema: {
          type: "object",
          properties: {
            anomalies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  severity: { type: "string" },
                  description: { type: "string" },
                  affected_users: { type: "array", items: { type: "string" } },
                  recommended_action: { type: "string" }
                }
              }
            }
          }
        }
      });
      return response.anomalies;
    },
    onSuccess: (data) => {
      setAnomalies(data || []);
    }
  });

  const getSeverityColor = (severity) => {
    const colors = {
      critical: "bg-red-100 text-red-800 border-red-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[severity] || colors.medium;
  };

  const getSeverityIcon = (severity) => {
    if (severity === "critical" || severity === "high") return AlertTriangle;
    if (severity === "medium") return TrendingUp;
    return Shield;
  };

  return (
    <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="w-5 h-5 text-purple-600" />
            AI Anomaly Detection
          </CardTitle>
          <Button
            onClick={() => detectAnomaliesMutation.mutate()}
            disabled={detectAnomaliesMutation.isPending}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${detectAnomaliesMutation.isPending ? 'animate-spin' : ''}`} />
            {detectAnomaliesMutation.isPending ? 'Analyzing...' : 'Analyze Logs'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <Shield className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="text-sm">Click "Analyze Logs" to detect security anomalies</p>
          </div>
        ) : (
          <div className="space-y-3">
            {anomalies.map((anomaly, idx) => {
              const Icon = getSeverityIcon(anomaly.severity);
              return (
                <div key={idx} className="bg-white rounded-lg p-4 border-l-4 border-l-purple-500 shadow-sm">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-purple-600" />
                      <span className="font-semibold text-gray-900">{anomaly.type}</span>
                    </div>
                    <Badge className={getSeverityColor(anomaly.severity)}>
                      {anomaly.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{anomaly.description}</p>
                  {anomaly.affected_users && anomaly.affected_users.length > 0 && (
                    <div className="text-xs text-gray-600 mb-2">
                      <span className="font-medium">Affected Users: </span>
                      {anomaly.affected_users.join(", ")}
                    </div>
                  )}
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 mt-2">
                    <p className="text-xs font-medium text-blue-900">Recommended Action:</p>
                    <p className="text-xs text-blue-800">{anomaly.recommended_action}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}