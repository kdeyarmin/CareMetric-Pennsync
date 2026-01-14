import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  AlertTriangle, 
  TrendingUp, 
  CheckCircle2, 
  RefreshCw, 
  Eye,
  ChevronDown,
  ChevronUp,
  Activity
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ProactiveRiskIdentifier({ compact = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedAlerts, setExpandedAlerts] = useState({});

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: riskAlerts = [], isLoading, refetch } = useQuery({
    queryKey: ['activeRiskAlerts'],
    queryFn: async () => {
      const alerts = await base44.entities.RiskAlert.filter(
        { status: 'active' },
        '-risk_score'
      );
      return alerts;
    },
    refetchInterval: 300000 // Refresh every 5 minutes
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('analyzePatientRisks', {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeRiskAlerts'] });
    }
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId) => {
      await base44.entities.RiskAlert.update(alertId, {
        acknowledged_by: currentUser?.email,
        acknowledged_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeRiskAlerts'] });
    }
  });

  const resolveMutation = useMutation({
    mutationFn: async (alertId) => {
      await base44.entities.RiskAlert.update(alertId, {
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: currentUser?.email
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeRiskAlerts'] });
    }
  });

  const getRiskColor = (level) => {
    const colors = {
      low: "bg-green-100 text-green-800 border-green-200",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
      high: "bg-orange-100 text-orange-800 border-orange-200",
      critical: "bg-red-100 text-red-800 border-red-200"
    };
    return colors[level] || colors.medium;
  };

  const getRiskIcon = (level) => {
    if (level === 'critical' || level === 'high') {
      return <AlertTriangle className="w-5 h-5" />;
    }
    return <TrendingUp className="w-5 h-5" />;
  };

  const toggleExpand = (alertId) => {
    setExpandedAlerts(prev => ({
      ...prev,
      [alertId]: !prev[alertId]
    }));
  };

  const criticalAlerts = riskAlerts.filter(a => a.risk_level === 'critical');
  const highAlerts = riskAlerts.filter(a => a.risk_level === 'high');

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
            <span className="ml-2">Loading risk analysis...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            <CardTitle className="text-lg">Proactive Risk Alerts</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {criticalAlerts.length > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                {criticalAlerts.length} Critical
              </Badge>
            )}
            {highAlerts.length > 0 && (
              <Badge className="bg-orange-500 text-white">
                {highAlerts.length} High
              </Badge>
            )}
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => runAnalysisMutation.mutate()}
              disabled={runAnalysisMutation.isPending}
            >
              {runAnalysisMutation.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6">
        {riskAlerts.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              No Active Risk Alerts
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              All patients are within normal risk parameters
            </p>
            <Button 
              onClick={() => runAnalysisMutation.mutate()}
              variant="outline"
              className="mt-4"
            >
              Run Risk Analysis
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {riskAlerts.map((alert) => (
              <Card 
                key={alert.id}
                className={`border-2 ${
                  alert.requires_immediate_action 
                    ? 'border-red-300 bg-red-50 dark:bg-red-950/20' 
                    : 'border-gray-200'
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`p-2 rounded-lg ${getRiskColor(alert.risk_level)}`}>
                        {getRiskIcon(alert.risk_level)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 dark:text-white">
                            {alert.patient_name}
                          </h3>
                          <Badge className={getRiskColor(alert.risk_level)}>
                            {alert.risk_level?.toUpperCase()} Risk
                          </Badge>
                          <Badge variant="outline">
                            Score: {alert.risk_score}/100
                          </Badge>
                          {alert.priority >= 4 && (
                            <Badge variant="destructive">
                              Priority {alert.priority}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {alert.summary}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleExpand(alert.id)}
                    >
                      {expandedAlerts[alert.id] ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </div>

                  {expandedAlerts[alert.id] && (
                    <div className="mt-4 space-y-3 border-t pt-3">
                      {alert.risk_factors && alert.risk_factors.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2 text-gray-900 dark:text-white">
                            Risk Factors:
                          </h4>
                          <div className="space-y-2">
                            {alert.risk_factors.map((factor, idx) => (
                              <div key={idx} className="flex items-start gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {factor.category}
                                </Badge>
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  {factor.description}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {alert.recommended_actions && alert.recommended_actions.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2 text-gray-900 dark:text-white">
                            Recommended Interventions:
                          </h4>
                          <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                            {alert.recommended_actions.map((action, idx) => (
                              <li key={idx}>{action}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="flex gap-2 mt-4 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(createPageUrl('PatientDetails') + `?id=${alert.patient_id}`)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View Patient
                        </Button>
                        {!alert.acknowledged_by && (
                          <Button
                            size="sm"
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                            disabled={acknowledgeMutation.isPending}
                          >
                            Acknowledge
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resolveMutation.mutate(alert.id)}
                          disabled={resolveMutation.isPending}
                        >
                          Mark Resolved
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}