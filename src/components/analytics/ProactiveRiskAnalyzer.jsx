import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Activity,
  Brain,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  User,
  TrendingDown,
  Heart,
  Shield,
  Clock,
  Zap
} from "lucide-react";
import { format } from "date-fns";

export default function ProactiveRiskAnalyzer({ _users = [] }) {
  const queryClient = useQueryClient();
  const ai = useAICall();
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [selectedAlert, setSelectedAlert] = useState(null);

  // Fetch patients
  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  // Fetch recent visits
  const { data: visits = [] } = useQuery({
    queryKey: ['recentVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 200),
  });

  // Fetch compliance audits
  const { data: audits = [] } = useQuery({
    queryKey: ['complianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 100),
  });

  // Fetch existing alerts
  const { data: existingAlerts = [], refetch: refetchAlerts } = useQuery({
    queryKey: ['patientAlerts'],
    queryFn: () => base44.entities.PatientAlert.filter({ status: 'active' }),
  });

  // Fetch incidents
  const { data: incidents = [] } = useQuery({
    queryKey: ['recentIncidents'],
    queryFn: () => base44.entities.Incident.list('-incident_date', 50),
  });

  const createAlertMutation = useMutation({
    mutationFn: (alertData) => base44.entities.PatientAlert.create(alertData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
    }
  });

  const updateAlertMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PatientAlert.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientAlerts'] });
    }
  });

  const runProactiveAnalysis = async () => {
    setAnalysisProgress(0);
    setAnalysisResults(null);

    try {
      // Prepare patient data for analysis
      const patientData = patients.filter(p => p.status === 'active').map(patient => {
        const patientVisits = visits.filter(v => v.patient_id === patient.id);
        const patientAudits = audits.filter(a => a.patient_id === patient.id);
        const patientIncidents = incidents.filter(i => i.patient_id === patient.id);
        
        // Get latest vitals
        const latestVisit = patientVisits.sort((a, b) => 
          new Date(b.visit_date) - new Date(a.visit_date)
        )[0];
        
        // Calculate compliance trend
        const recentAudits = patientAudits.slice(0, 5);
        const avgComplianceScore = recentAudits.length > 0 
          ? recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length 
          : null;
        
        return {
          id: patient.id,
          name: `${patient.first_name} ${patient.last_name}`,
          diagnosis: patient.primary_diagnosis,
          secondary_diagnoses: patient.secondary_diagnoses || [],
          visit_count: patientVisits.length,
          last_visit: latestVisit?.visit_date,
          last_vitals: latestVisit?.vital_signs,
          last_note: latestVisit?.nurse_notes?.substring(0, 500),
          compliance_score: avgComplianceScore,
          audit_issues: patientAudits.flatMap(a => a.issues || []).slice(0, 10),
          incident_count: patientIncidents.length,
          recent_incidents: patientIncidents.slice(0, 3).map(i => ({
            type: i.incident_type,
            date: i.incident_date,
            severity: i.severity
          }))
        };
      });

      setAnalysisProgress(20);

      // Batch patients for analysis (5 at a time to avoid token limits)
      const batchSize = 5;
      const allAlerts = [];
      
      for (let i = 0; i < patientData.length; i += batchSize) {
        const batch = patientData.slice(i, i + batchSize);
        
        const result = await ai.run({
          model: "claude_opus_4_8",
          prompt: `You are a clinical risk analysis AI for home health/hospice. Analyze these patients for potential adverse events, non-compliance risks, and urgent care needs.

PATIENT DATA:
${JSON.stringify(batch, null, 2)}

For each patient, analyze:
1. VITAL SIGN TRENDS - Any concerning patterns in vitals
2. COMPLIANCE RISKS - Documentation gaps, missed visits, audit failures
3. CLINICAL DETERIORATION - Signs of worsening condition
4. FALL/SAFETY RISKS - Based on diagnosis, incidents, medications
5. READMISSION RISKS - Factors that could lead to hospitalization
6. CARE GAP ALERTS - Missing assessments or interventions

Only generate alerts for GENUINE concerns. Be specific and actionable.

Return JSON:
{
  "patient_alerts": [
    {
      "patient_id": "patient id",
      "patient_name": "patient name",
      "alert_type": "vital_deterioration" | "medication_risk" | "fall_risk" | "readmission_risk" | "infection_risk" | "symptom_escalation" | "care_gap" | "urgent_intervention",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Brief alert title",
      "message": "Detailed explanation",
      "contributing_factors": ["factor1", "factor2"],
      "recommended_actions": ["action1", "action2"],
      "risk_score": 0-100,
      "urgency": "immediate" | "today" | "this_week" | "monitor"
    }
  ],
  "summary": {
    "critical_count": number,
    "high_count": number,
    "patients_at_risk": number
  }
}`,
          response_json_schema: {
            type: "object",
            properties: {
              patient_alerts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    patient_id: { type: "string" },
                    patient_name: { type: "string" },
                    alert_type: { type: "string" },
                    severity: { type: "string" },
                    title: { type: "string" },
                    message: { type: "string" },
                    contributing_factors: { type: "array", items: { type: "string" } },
                    recommended_actions: { type: "array", items: { type: "string" } },
                    risk_score: { type: "number" },
                    urgency: { type: "string" }
                  }
                }
              },
              summary: {
                type: "object",
                properties: {
                  critical_count: { type: "number" },
                  high_count: { type: "number" },
                  patients_at_risk: { type: "number" }
                }
              }
            }
          }
        });

        if (result.patient_alerts) {
          allAlerts.push(...result.patient_alerts);
        }
        
        setAnalysisProgress(20 + Math.round(((i + batchSize) / patientData.length) * 60));
      }

      setAnalysisProgress(85);

      // Create alerts in database
      let createdCount = 0;
      for (const alert of allAlerts) {
        // Check if similar alert already exists
        const existingAlert = existingAlerts.find(
          ea => ea.patient_id === alert.patient_id && 
               ea.alert_type === alert.alert_type &&
               ea.status === 'active'
        );
        
        if (!existingAlert) {
          await createAlertMutation.mutateAsync({
            patient_id: alert.patient_id,
            alert_type: alert.alert_type,
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            contributing_factors: alert.contributing_factors,
            recommended_actions: alert.recommended_actions,
            risk_score: alert.risk_score,
            flagged_urgent: alert.severity === 'critical' || alert.urgency === 'immediate',
            status: 'active'
          });
          createdCount++;
        }
      }

      setAnalysisProgress(100);
      
      setAnalysisResults({
        total_analyzed: patientData.length,
        alerts_generated: allAlerts.length,
        alerts_created: createdCount,
        critical: allAlerts.filter(a => a.severity === 'critical').length,
        high: allAlerts.filter(a => a.severity === 'high').length,
        medium: allAlerts.filter(a => a.severity === 'medium').length,
        alerts: allAlerts
      });

      refetchAlerts();
    } catch (error) {
      console.error("Error in proactive analysis:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getAlertTypeIcon = (type) => {
    const icons = {
      vital_deterioration: <Activity className="w-4 h-4 text-red-600" />,
      medication_risk: <AlertTriangle className="w-4 h-4 text-orange-600" />,
      fall_risk: <TrendingDown className="w-4 h-4 text-yellow-600" />,
      readmission_risk: <Heart className="w-4 h-4 text-red-500" />,
      infection_risk: <Shield className="w-4 h-4 text-navy-600" />,
      symptom_escalation: <TrendingDown className="w-4 h-4 text-orange-500" />,
      care_gap: <Clock className="w-4 h-4 text-blue-600" />,
      urgent_intervention: <Zap className="w-4 h-4 text-red-600" />
    };
    return icons[type] || <AlertTriangle className="w-4 h-4" />;
  };

  const acknowledgeAlert = async (alertId) => {
    const user = await base44.auth.me();
    await updateAlertMutation.mutateAsync({
      id: alertId,
      data: {
        status: 'acknowledged',
        acknowledged_by: user.email,
        acknowledged_at: new Date().toISOString()
      }
    });
  };

  const resolveAlert = async (alertId, notes) => {
    await updateAlertMutation.mutateAsync({
      id: alertId,
      data: {
        status: 'resolved',
        resolution_notes: notes || 'Resolved by administrator'
      }
    });
  };

  // Group alerts by severity
  const alertsBySeverity = {
    critical: existingAlerts.filter(a => a.severity === 'critical'),
    high: existingAlerts.filter(a => a.severity === 'high'),
    medium: existingAlerts.filter(a => a.severity === 'medium'),
    low: existingAlerts.filter(a => a.severity === 'low')
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            Proactive Risk Analysis
            {existingAlerts.length > 0 && (
              <Badge className="bg-red-600 text-white">{existingAlerts.length} Active</Badge>
            )}
          </div>
          <Button
            size="sm"
            onClick={runProactiveAnalysis}
            disabled={ai.loading}
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" /> Run Analysis</>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {ai.loading && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-600">Analyzing patient data...</span>
              <span className="text-sm font-medium">{analysisProgress}%</span>
            </div>
            <Progress value={analysisProgress} className="h-2" />
          </div>
        )}

        {analysisResults && !ai.loading && (
          <Alert className="mb-4 bg-navy-50 border-navy-200">
            <Brain className="w-4 h-4" />
            <AlertDescription>
              Analyzed {analysisResults.total_analyzed} patients. Found {analysisResults.alerts_generated} potential risks 
              ({analysisResults.critical} critical, {analysisResults.high} high priority). 
              Created {analysisResults.alerts_created} new alerts.
            </AlertDescription>
          </Alert>
        )}

        {/* Alert Summary Cards */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-red-50 p-3 rounded-lg border border-red-200 text-center">
            <p className="text-2xl font-bold text-red-700">{alertsBySeverity.critical.length}</p>
            <p className="text-xs text-red-600">Critical</p>
          </div>
          <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 text-center">
            <p className="text-2xl font-bold text-orange-700">{alertsBySeverity.high.length}</p>
            <p className="text-xs text-orange-600">High</p>
          </div>
          <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-center">
            <p className="text-2xl font-bold text-yellow-700">{alertsBySeverity.medium.length}</p>
            <p className="text-xs text-yellow-600">Medium</p>
          </div>
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
            <p className="text-2xl font-bold text-blue-700">{alertsBySeverity.low.length}</p>
            <p className="text-xs text-blue-600">Low</p>
          </div>
        </div>

        {/* Active Alerts List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {existingAlerts.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-400" />
              <p>No active alerts. Run analysis to check for risks.</p>
            </div>
          ) : (
            existingAlerts
              .sort((a, b) => {
                const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                return severityOrder[a.severity] - severityOrder[b.severity];
              })
              .map(alert => {
                const patient = patients.find(p => p.id === alert.patient_id);
                return (
                  <div 
                    key={alert.id} 
                    className={`p-3 rounded-lg border ${getSeverityColor(alert.severity)} cursor-pointer hover:shadow-md transition-shadow`}
                    onClick={() => setSelectedAlert(alert)}
                  >
                    <div className="flex items-start gap-3">
                      {getAlertTypeIcon(alert.alert_type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{alert.title}</p>
                          <Badge variant="outline" className="text-xs capitalize">
                            {(alert.alert_type || '').replace(/_/g, ' ')}
                          </Badge>
                          {alert.flagged_urgent && (
                            <Badge className="bg-red-600 text-white text-xs">URGENT</Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 mt-1 flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient'}
                        </p>
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">{alert.message}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <Badge className={`${
                          alert.severity === 'critical' ? 'bg-red-600' :
                          alert.severity === 'high' ? 'bg-orange-500' :
                          alert.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                        } text-white text-xs`}>
                          {alert.risk_score || 'N/A'}
                        </Badge>
                        <p className="text-xs text-slate-400 mt-1">
                          {format(new Date(alert.created_date), 'MMM d')}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>

        {/* Alert Detail Dialog */}
        <Dialog open={!!selectedAlert} onOpenChange={() => setSelectedAlert(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedAlert && getAlertTypeIcon(selectedAlert.alert_type)}
                {selectedAlert?.title}
              </DialogTitle>
            </DialogHeader>
            {selectedAlert && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className={getSeverityColor(selectedAlert.severity)}>
                    {selectedAlert.severity}
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    {(selectedAlert.alert_type || '').replace(/_/g, ' ')}
                  </Badge>
                  {selectedAlert.risk_score && (
                    <Badge variant="outline">Risk: {selectedAlert.risk_score}</Badge>
                  )}
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-1">Details</p>
                  <p className="text-sm text-slate-600">{selectedAlert.message}</p>
                </div>

                {selectedAlert.contributing_factors?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">Contributing Factors</p>
                    <ul className="list-disc list-inside text-sm text-slate-600">
                      {selectedAlert.contributing_factors.map((factor, idx) => (
                        <li key={idx}>{factor}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedAlert.recommended_actions?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-1">Recommended Actions</p>
                    <ul className="space-y-1">
                      {selectedAlert.recommended_actions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                          <ChevronRight className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-2 pt-2 border-t">
                  {selectedAlert.status === 'active' && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => {
                        acknowledgeAlert(selectedAlert.id);
                        setSelectedAlert(null);
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Acknowledge
                    </Button>
                  )}
                  <Button 
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      resolveAlert(selectedAlert.id, 'Resolved from dashboard');
                      setSelectedAlert(null);
                    }}
                  >
                    <XCircle className="w-4 h-4 mr-1" /> Resolve
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}