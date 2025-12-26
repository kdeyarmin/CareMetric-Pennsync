import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Eye,
  ChevronRight,
  Shield,
  TrendingUp,
  FileText,
  Clock,
  X
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import AIInsightFeedbackWidget from "../feedback/AIInsightFeedbackWidget";

export default function ComplianceAlertNotifications({ 
  nurseEmail,
  showAll = false,
  maxAlerts = 5,
  compact = false
}) {
  const queryClient = useQueryClient();
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set());
  const [feedbackAlertId, setFeedbackAlertId] = useState(null);

  // Fetch active compliance alerts
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['complianceAlerts', nurseEmail],
    queryFn: async () => {
      const allAlerts = await base44.entities.PatientAlert.filter({ status: 'active' }, '-created_date', 50);
      
      // Filter by nurse responsibility if email provided
      if (nurseEmail && !showAll) {
        // Show alerts for patients this nurse has visited or is assigned to
        const nurseVisits = await base44.entities.Visit.filter({ created_by: nurseEmail }, null, 100);
        const nursePatientIds = new Set(nurseVisits.map(v => v.patient_id));
        return allAlerts.filter(a => nursePatientIds.has(a.patient_id));
      }
      
      return allAlerts;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId) => base44.entities.PatientAlert.update(alertId, { 
      status: 'acknowledged',
      acknowledged_by: nurseEmail,
      acknowledged_at: new Date().toISOString()
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complianceAlerts'] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ alertId, notes }) => base44.entities.PatientAlert.update(alertId, { 
      status: 'resolved',
      resolution_notes: notes
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complianceAlerts'] });
    },
  });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-red-500 bg-red-50';
      case 'high': return 'border-orange-500 bg-orange-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <XCircle className="w-5 h-5 text-red-600" />;
      case 'high': return <AlertTriangle className="w-5 h-5 text-orange-600" />;
      case 'medium': return <Clock className="w-5 h-5 text-yellow-600" />;
      default: return <Bell className="w-5 h-5 text-blue-600" />;
    }
  };

  const getAlertTypeIcon = (type) => {
    switch (type) {
      case 'care_gap': return <TrendingUp className="w-4 h-4" />;
      case 'documentation_risk': return <FileText className="w-4 h-4" />;
      case 'readmission_risk': return <Shield className="w-4 h-4" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  const handleDismiss = (alertId) => {
    setDismissedAlerts(prev => new Set([...prev, alertId]));
  };

  const visibleAlerts = alerts
    .filter(a => !dismissedAlerts.has(a.id))
    .slice(0, showAll ? alerts.length : maxAlerts);

  const criticalCount = alerts.filter(a => a.severity === 'critical' && !dismissedAlerts.has(a.id)).length;
  const highCount = alerts.filter(a => a.severity === 'high' && !dismissedAlerts.has(a.id)).length;

  if (isLoading) {
    return (
      <Card className={compact ? 'border-gray-200' : 'border-2 border-purple-200'}>
        <CardContent className="p-4 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto" />
          <p className="text-sm text-gray-600 mt-2">Loading compliance alerts...</p>
        </CardContent>
      </Card>
    );
  }

  if (compact && visibleAlerts.length === 0) {
    return null;
  }

  return (
    <Card className={`${compact ? 'border-gray-200' : 'border-2 border-purple-200'} ${criticalCount > 0 ? 'ring-2 ring-red-400' : ''}`}>
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className={`w-5 h-5 ${criticalCount > 0 ? 'text-red-600 animate-pulse' : 'text-purple-600'}`} />
            Compliance Alerts
            {(criticalCount > 0 || highCount > 0) && (
              <div className="flex gap-1">
                {criticalCount > 0 && (
                  <Badge className="bg-red-600 text-white">{criticalCount} Critical</Badge>
                )}
                {highCount > 0 && (
                  <Badge className="bg-orange-600 text-white">{highCount} High</Badge>
                )}
              </div>
            )}
          </CardTitle>
          {!showAll && alerts.length > maxAlerts && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={createPageUrl('PatientAlerts')}>
                View All ({alerts.length})
                <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {visibleAlerts.length === 0 ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-sm text-green-800">
              No active compliance alerts. Great job!
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className={compact ? 'h-64' : 'h-96'}>
            <div className="space-y-3">
              {visibleAlerts.map((alert) => (
                <Card key={alert.id} className={`border-2 ${getSeverityColor(alert.severity)} relative`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6"
                    onClick={() => handleDismiss(alert.id)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {getSeverityIcon(alert.severity)}
                      <div className="flex-1 space-y-2">
                        {/* Alert Header */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">
                              {getAlertTypeIcon(alert.alert_type)}
                              <span className="ml-1">{alert.alert_type.replace(/_/g, ' ')}</span>
                            </Badge>
                            <Badge className={`${alert.severity === 'critical' ? 'bg-red-600' : alert.severity === 'high' ? 'bg-orange-600' : 'bg-yellow-600'} text-white text-xs`}>
                              Risk: {alert.risk_score}/100
                            </Badge>
                          </div>
                          <p className="font-semibold text-sm">{alert.title}</p>
                          <p className="text-sm text-gray-700 mt-1">{alert.message}</p>
                        </div>

                        {/* Contributing Factors */}
                        {alert.contributing_factors?.length > 0 && (
                          <div className="bg-white/60 p-2 rounded border border-gray-200">
                            <p className="text-xs font-semibold text-gray-700 mb-1">Contributing Factors:</p>
                            <ul className="text-xs text-gray-600 space-y-0.5">
                              {alert.contributing_factors.slice(0, 3).map((factor, idx) => (
                                <li key={idx} className="flex items-start gap-1">
                                  <span className="text-orange-500">•</span>
                                  {factor}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Recommended Actions */}
                        {alert.recommended_actions?.length > 0 && (
                          <div className="bg-blue-50 p-2 rounded border border-blue-200">
                            <p className="text-xs font-semibold text-blue-800 mb-1">Recommended Actions:</p>
                            <ul className="text-xs text-blue-700 space-y-0.5">
                              {alert.recommended_actions.slice(0, 3).map((action, idx) => (
                                <li key={idx} className="flex items-start gap-1">
                                  <span className="text-blue-600">✓</span>
                                  {action}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            asChild
                          >
                            <Link to={createPageUrl(`PatientDetails?id=${alert.patient_id}`)}>
                              <Eye className="w-3 h-3 mr-1" />
                              View Patient
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                            disabled={acknowledgeMutation.isPending}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Acknowledge
                          </Button>
                        </div>

                        {/* AI Feedback */}
                        {feedbackAlertId === alert.id ? (
                          <div className="mt-3 pt-3 border-t">
                            <AIInsightFeedbackWidget
                              insightType="compliance_alert"
                              insightId={alert.id}
                              insightContent={`${alert.title}: ${alert.message}`}
                              onFeedbackSubmitted={() => setFeedbackAlertId(null)}
                              compact={true}
                            />
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="w-full mt-2 text-xs"
                            onClick={() => setFeedbackAlertId(alert.id)}
                          >
                            Rate this alert
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}