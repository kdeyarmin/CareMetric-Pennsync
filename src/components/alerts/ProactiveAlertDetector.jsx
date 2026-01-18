import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Shield,
  Plus,
  Eye,
  X
} from "lucide-react";
import { toast } from "sonner";

export default function ProactiveAlertDetector({ patientId, patientName, onAlertCreated }) {
  const [suggestedAlerts, setSuggestedAlerts] = useState(null);
  const [overallAssessment, setOverallAssessment] = useState(null);
  const [priorityConcerns, setPriorityConcerns] = useState([]);
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set());

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('analyzePatientForAlerts', {
        patient_id: patientId
      });
      return response.data;
    },
    onSuccess: (data) => {
      setSuggestedAlerts(data.suggested_alerts || []);
      setOverallAssessment(data.overall_risk_assessment);
      setPriorityConcerns(data.priority_concerns || []);
      setDismissedAlerts(new Set());
      
      const criticalCount = data.suggested_alerts?.filter(a => a.severity === 'critical').length || 0;
      if (criticalCount > 0) {
        toast.warning(`${criticalCount} critical alert(s) detected`);
      } else if (data.suggested_alerts?.length > 0) {
        toast.success(`${data.suggested_alerts.length} potential issue(s) identified`);
      } else {
        toast.success('No new issues detected');
      }
    },
    onError: (error) => {
      console.error('Error analyzing patient:', error);
      toast.error('Failed to analyze patient data');
    }
  });

  const createAlertMutation = useMutation({
    mutationFn: async (alertData) => {
      return await base44.entities.PatientAlert.create(alertData);
    },
    onSuccess: (createdAlert) => {
      toast.success('Alert created successfully');
      if (onAlertCreated) {
        onAlertCreated(createdAlert);
      }
      // Remove from suggested list
      setSuggestedAlerts(prev => prev.filter(a => a.title !== createdAlert.title));
    },
    onError: (error) => {
      console.error('Error creating alert:', error);
      toast.error('Failed to create alert');
    }
  });

  const handleCreateAlert = (alert) => {
    createAlertMutation.mutate({
      patient_id: patientId,
      alert_type: alert.alert_type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      contributing_factors: alert.contributing_factors || [],
      recommended_actions: alert.recommended_actions || [],
      risk_score: alert.risk_score,
      data_sources: alert.data_sources || {},
      status: 'active',
      flagged_urgent: alert.severity === 'critical'
    });
  };

  const handleDismiss = (alertTitle) => {
    setDismissedAlerts(prev => new Set([...prev, alertTitle]));
    toast.info('Alert dismissed');
  };

  const filteredAlerts = suggestedAlerts?.filter(a => !dismissedAlerts.has(a.title)) || [];

  return (
    <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm">
            <Brain className="w-5 h-5 text-purple-600" />
            AI Proactive Alert Detection
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4 mr-1" />
                Analyze Patient
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {analyzeMutation.isPending && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-purple-600 mr-2" />
            <span className="text-sm text-slate-600">
              Analyzing patient data for potential risks...
            </span>
          </div>
        )}

        {overallAssessment && !analyzeMutation.isPending && (
          <Alert className="bg-blue-50 border-blue-200">
            <Shield className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-sm">
              <strong>Overall Assessment:</strong> {overallAssessment}
            </AlertDescription>
          </Alert>
        )}

        {priorityConcerns.length > 0 && !analyzeMutation.isPending && (
          <div className="bg-yellow-50 dark:bg-yellow-900 p-3 rounded-lg border border-yellow-200">
            <p className="font-semibold text-sm text-yellow-900 dark:text-yellow-100 mb-2">
              ⚠️ Priority Concerns:
            </p>
            <ul className="text-xs text-yellow-800 dark:text-yellow-200 space-y-1">
              {priorityConcerns.map((concern, idx) => (
                <li key={idx}>• {concern}</li>
              ))}
            </ul>
          </div>
        )}

        {filteredAlerts.length > 0 && !analyzeMutation.isPending && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Suggested Alerts ({filteredAlerts.length})
              </h4>
              <Badge variant="outline" className="text-xs">
                AI-Generated
              </Badge>
            </div>

            {filteredAlerts.map((alert, idx) => (
              <div
                key={idx}
                className={`bg-white dark:bg-slate-900 p-4 rounded-lg border-l-4 ${
                  alert.severity === 'critical' ? 'border-red-600' :
                  alert.severity === 'high' ? 'border-orange-500' :
                  alert.severity === 'medium' ? 'border-yellow-500' :
                  'border-blue-500'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={
                        alert.severity === 'critical' ? 'bg-red-600' :
                        alert.severity === 'high' ? 'bg-orange-500' :
                        alert.severity === 'medium' ? 'bg-yellow-500' :
                        'bg-blue-500'
                      }>
                        {alert.severity}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {alert.alert_type.replace(/_/g, ' ')}
                      </Badge>
                      {alert.risk_score && (
                        <span className="text-xs text-slate-500">
                          Risk: {alert.risk_score}/100
                        </span>
                      )}
                    </div>
                    <h5 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {alert.title}
                    </h5>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDismiss(alert.title)}
                      className="h-8 w-8 p-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                  {alert.message}
                </p>

                {alert.clinical_rationale && (
                  <div className="bg-blue-50 dark:bg-blue-900 p-2 rounded text-xs mb-2">
                    <strong className="text-blue-900 dark:text-blue-100">Clinical Rationale:</strong>
                    <p className="text-blue-800 dark:text-blue-200 mt-1">
                      {alert.clinical_rationale}
                    </p>
                  </div>
                )}

                {alert.contributing_factors?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Contributing Factors:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {alert.contributing_factors.map((factor, fIdx) => (
                        <Badge key={fIdx} variant="outline" className="text-xs">
                          {factor}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {alert.recommended_actions?.length > 0 && (
                  <div className="bg-green-50 dark:bg-green-900 p-2 rounded mb-3">
                    <p className="text-xs font-medium text-green-900 dark:text-green-100 mb-1">
                      Recommended Actions:
                    </p>
                    <ul className="text-xs text-green-800 dark:text-green-200 space-y-1">
                      {alert.recommended_actions.map((action, aIdx) => (
                        <li key={aIdx}>• {action}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleCreateAlert(alert)}
                    disabled={createAlertMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700 text-xs"
                  >
                    {createAlertMutation.isPending ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3 mr-1" />
                    )}
                    Create Alert
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {suggestedAlerts && filteredAlerts.length === 0 && !analyzeMutation.isPending && (
          <div className="text-center py-6">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p className="text-sm text-slate-600">
              No new issues detected. Patient status appears stable.
            </p>
          </div>
        )}

        {!suggestedAlerts && !analyzeMutation.isPending && (
          <div className="text-center py-6">
            <Brain className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500 mb-3">
              AI-powered analysis of patient data to identify potential risks
            </p>
            <Button size="sm" onClick={() => analyzeMutation.mutate()}>
              <TrendingUp className="w-4 h-4 mr-1" />
              Run Analysis
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}