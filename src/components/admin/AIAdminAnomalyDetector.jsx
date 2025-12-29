import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Shield, Eye, CheckCircle2, RefreshCw, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";

export default function AIAdminAnomalyDetector({ auditLogs }) {
  const [anomalies, setAnomalies] = useState([]);
  const queryClient = useQueryClient();

  const detectAnomaliesMutation = useMutation({
    mutationFn: async () => {
      // Prepare audit summary for AI analysis
      const recentLogs = auditLogs.slice(0, 100);
      
      const summary = recentLogs.map(log => ({
        timestamp: log.timestamp,
        user: log.user_email,
        role: log.user_role,
        action: log.action_type,
        description: log.action_description,
        target: log.target_identifier,
        ip: log.ip_address
      }));

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze these administrative audit logs for suspicious patterns or anomalies:

${JSON.stringify(summary, null, 2)}

Look for:
1. Unusual frequency of sensitive operations (password resets, role changes)
2. Operations performed outside normal hours
3. Multiple failed attempts or suspicious patterns
4. Bulk operations that seem unusual
5. Actions by users that don't match their typical behavior
6. Rapid succession of privileged operations
7. Operations from unusual IP addresses
8. Administrative actions on weekends/holidays

For each anomaly found, provide:
- Type of anomaly
- Severity (critical/high/medium/low)
- Description of the suspicious pattern
- Affected users/entities
- Risk score (0-100)
- Recommended action

Return as JSON array of anomalies.`,
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
                  risk_score: { type: "number" },
                  recommended_action: { type: "string" },
                  related_log_ids: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });

      return response.anomalies || [];
    },
    onSuccess: (data) => {
      setAnomalies(data);
      
      // Flag suspicious entries in the database
      data.forEach(async (anomaly) => {
        if (anomaly.severity === 'critical' || anomaly.severity === 'high') {
          // Find and flag related audit entries
          const logsToFlag = auditLogs.filter(log => 
            anomaly.affected_users.includes(log.user_email) ||
            anomaly.affected_users.includes(log.target_identifier)
          );
          
          for (const log of logsToFlag.slice(0, 5)) {
            await base44.entities.AuditTrail.update(log.id, {
              flagged_suspicious: true,
              flagged_reason: anomaly.description,
              risk_score: anomaly.risk_score
            });
          }
        }
      });

      queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
    }
  });

  const markAsReviewedMutation = useMutation({
    mutationFn: async ({ anomaly, notes }) => {
      const currentUser = await base44.auth.me();
      
      // Mark related logs as reviewed
      const logsToReview = auditLogs.filter(log => 
        anomaly.affected_users.includes(log.user_email) ||
        anomaly.affected_users.includes(log.target_identifier)
      );

      for (const log of logsToReview.slice(0, 5)) {
        await base44.entities.AuditTrail.update(log.id, {
          reviewed: true,
          reviewed_by: currentUser.email,
          reviewed_at: new Date().toISOString(),
          review_notes: notes
        });
      }

      return anomaly;
    },
    onSuccess: (anomaly) => {
      setAnomalies(prev => prev.filter(a => a !== anomaly));
      queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
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

  const getRiskColor = (score) => {
    if (score >= 80) return "text-red-600";
    if (score >= 60) return "text-orange-600";
    if (score >= 40) return "text-yellow-600";
    return "text-blue-600";
  };

  return (
    <Card className="border-red-200 bg-gradient-to-br from-red-50 to-orange-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            AI Anomaly Detection - Admin Actions
          </CardTitle>
          <Button
            onClick={() => detectAnomaliesMutation.mutate()}
            disabled={detectAnomaliesMutation.isPending}
            size="sm"
            className="bg-red-600 hover:bg-red-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${detectAnomaliesMutation.isPending ? 'animate-spin' : ''}`} />
            {detectAnomaliesMutation.isPending ? 'Analyzing...' : 'Scan for Anomalies'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <div className="text-center py-8">
            <Shield className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600">
              Click "Scan for Anomalies" to analyze audit logs for suspicious patterns
            </p>
            <p className="text-xs text-gray-500 mt-2">
              AI will review {auditLogs.length} recent audit entries
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert className="border-orange-300 bg-orange-50">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <AlertDescription className="text-orange-900">
                <p className="font-semibold">Found {anomalies.length} suspicious pattern(s)</p>
                <p className="text-sm mt-1">Review each anomaly and mark as resolved when addressed</p>
              </AlertDescription>
            </Alert>

            {anomalies.map((anomaly, idx) => (
              <div key={idx} className="bg-white rounded-lg p-4 border-l-4 border-l-red-500 shadow-md">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={getSeverityColor(anomaly.severity)}>
                        {anomaly.severity}
                      </Badge>
                      <span className={`text-2xl font-bold ${getRiskColor(anomaly.risk_score)}`}>
                        {anomaly.risk_score}
                      </span>
                      <span className="text-xs text-gray-500">risk score</span>
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-1">{anomaly.type}</h4>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAnomalies(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <p className="text-sm text-gray-700 mb-3">{anomaly.description}</p>

                {anomaly.affected_users && anomaly.affected_users.length > 0 && (
                  <div className="bg-gray-50 rounded p-2 mb-3">
                    <p className="text-xs font-medium text-gray-600 mb-1">Affected Users:</p>
                    <div className="flex flex-wrap gap-1">
                      {anomaly.affected_users.map((user, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {user}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                  <p className="text-xs font-medium text-blue-900 mb-1">Recommended Action:</p>
                  <p className="text-sm text-blue-800">{anomaly.recommended_action}</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // View related logs
                      console.log('View related logs:', anomaly.related_log_ids);
                    }}
                    className="text-xs"
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    View Logs
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => markAsReviewedMutation.mutate({ 
                      anomaly, 
                      notes: 'Reviewed and addressed' 
                    })}
                    disabled={markAsReviewedMutation.isPending}
                    className="text-xs bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Mark Resolved
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}