import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Heart,
  Activity,
  Shield,
  BookOpen,
  GraduationCap,
  CheckCircle2,
  ArrowRight,
  Pill,
  Target
} from "lucide-react";

export default function ProactiveClinicalSupport({ patientId, compact = false }) {
  const [_expandedAlert, _setExpandedAlert] = useState(null);

  const { data: analysis, isLoading, refetch } = useQuery({
    queryKey: ['clinicalRiskAnalysis', patientId],
    queryFn: async () => {
      const response = await base44.functions.invoke('analyzeClinicalRisks', { patientId });
      return response.data || response;
    },
    enabled: !!patientId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-red-500 bg-red-50';
      case 'high': return 'border-orange-500 bg-orange-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  const getSeverityBadge = (severity) => {
    const colors = {
      critical: 'bg-red-600 text-white',
      high: 'bg-orange-600 text-white',
      medium: 'bg-yellow-600 text-white',
      low: 'bg-blue-600 text-white'
    };
    return <Badge className={colors[severity] || colors.low}>{(severity || 'low').toUpperCase()}</Badge>;
  };

  const getRiskIcon = (riskLevel) => {
    if (riskLevel === 'high' || riskLevel === 'critical') return <AlertTriangle className="w-6 h-6 text-red-600" />;
    if (riskLevel === 'medium') return <Activity className="w-6 h-6 text-yellow-600" />;
    return <Heart className="w-6 h-6 text-green-600" />;
  };

  if (isLoading) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-600 mx-auto mb-4" />
          <p className="text-sm text-slate-600">Analyzing patient data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!analysis || !analysis.success) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <AlertDescription className="text-sm text-red-800">
          Unable to load clinical decision support analysis.
          <Button variant="link" onClick={() => refetch()} className="ml-2 h-auto p-0">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const criticalAlerts = analysis.clinical_alerts?.filter(a => a.severity === 'critical') || [];
  const highAlerts = analysis.clinical_alerts?.filter(a => a.severity === 'high') || [];

  if (compact) {
    return (
      <Card className="border-2 border-navy-200">
        <CardHeader className="py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            Clinical Decision Support
            {(criticalAlerts.length > 0 || highAlerts.length > 0) && (
              <Badge className="bg-red-600 text-white animate-pulse">
                {criticalAlerts.length + highAlerts.length} urgent
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-slate-600">Overall Risk Score</p>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold">{analysis.overall_risk_score}/100</p>
                {getRiskIcon(analysis.risk_level)}
              </div>
            </div>
            <Badge className={
              analysis.risk_level === 'high' || analysis.risk_level === 'critical' ? 'bg-red-600' :
              analysis.risk_level === 'medium' ? 'bg-yellow-600' : 'bg-green-600'
            }>
              {analysis.risk_level} risk
            </Badge>
          </div>
          {(criticalAlerts.length > 0 || highAlerts.length > 0) && (
            <Alert className="border-red-300 bg-red-50">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-sm text-red-800">
                {criticalAlerts.length} critical and {highAlerts.length} high-priority alerts require immediate attention.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="py-4 bg-gradient-to-r from-navy-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="w-6 h-6 text-navy-600" />
            AI Clinical Decision Support
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={`text-lg px-4 py-1 ${
              analysis.risk_level === 'critical' ? 'bg-red-600' :
              analysis.risk_level === 'high' ? 'bg-orange-600' :
              analysis.risk_level === 'medium' ? 'bg-yellow-600' : 'bg-green-600'
            }`}>
              {analysis.overall_risk_score}/100
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Trend Analysis Summary */}
        {analysis.trend_analysis && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600 mb-1">Vital Signs</p>
              <div className="flex items-center gap-1">
                {analysis.trend_analysis.vital_signs_trend?.includes('deteriorating') ? 
                  <TrendingDown className="w-4 h-4 text-red-600" /> : 
                  <TrendingUp className="w-4 h-4 text-green-600" />
                }
                <p className="text-xs font-medium">{analysis.trend_analysis.vital_signs_trend}</p>
              </div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600 mb-1">Functional Status</p>
              <p className="text-xs font-medium">{analysis.trend_analysis.functional_status_trend}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600 mb-1">Care Plan Progress</p>
              <p className="text-xs font-medium">{analysis.trend_analysis.care_plan_progress}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600 mb-1">Incidents</p>
              <p className="text-xs font-medium">{analysis.trend_analysis.incident_frequency}</p>
            </div>
          </div>
        )}

        {/* Clinical Alerts */}
        {analysis.clinical_alerts?.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <Shield className="w-5 h-5 text-navy-600" />
              Clinical Alerts ({analysis.clinical_alerts.length})
            </h3>
            <ScrollArea className="h-96">
              <Accordion type="single" collapsible className="space-y-2">
                {analysis.clinical_alerts.map((alert, idx) => (
                  <AccordionItem key={idx} value={`alert-${idx}`} className={`border-2 rounded-lg ${getSeverityColor(alert.severity)}`}>
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-3 text-left">
                          <AlertTriangle className={`w-5 h-5 ${
                            alert.severity === 'critical' ? 'text-red-600' :
                            alert.severity === 'high' ? 'text-orange-600' :
                            'text-yellow-600'
                          }`} />
                          <div>
                            <p className="font-semibold text-sm">{alert.title}</p>
                            <p className="text-xs text-slate-600">{alert.alert_type}</p>
                          </div>
                        </div>
                        {getSeverityBadge(alert.severity)}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-4">
                      {/* Clinical Evidence */}
                      {alert.clinical_evidence?.length > 0 && (
                        <div className="bg-white p-3 rounded border border-slate-200">
                          <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            Clinical Evidence:
                          </p>
                          <ul className="text-xs text-slate-800 space-y-1">
                            {alert.clinical_evidence.map((evidence, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="text-navy-600">•</span>
                                {evidence}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommended Interventions */}
                      {alert.recommended_interventions?.length > 0 && (
                        <div className="bg-blue-50 p-3 rounded border border-blue-200">
                          <p className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            Evidence-Based Interventions:
                          </p>
                          <div className="space-y-2">
                            {alert.recommended_interventions.slice(0, 3).map((intervention, i) => (
                              <div key={i} className="bg-white p-2 rounded border border-blue-200">
                                <div className="flex items-start gap-2">
                                  <Badge className="bg-blue-600 text-white text-xs">#{intervention.priority}</Badge>
                                  <div className="flex-1">
                                    <p className="text-xs font-medium text-slate-900">{intervention.intervention}</p>
                                    <p className="text-xs text-slate-600 mt-1 italic">Rationale: {intervention.rationale}</p>
                                    <p className="text-xs text-green-700 mt-1">
                                      <CheckCircle2 className="w-3 h-3 inline mr-1" />
                                      Expected: {intervention.expected_outcome}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Patient Education */}
                      {alert.patient_education_topics?.length > 0 && (
                        <div className="bg-green-50 p-3 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1">
                            <BookOpen className="w-3 h-3" />
                            Patient/Family Education Topics:
                          </p>
                          <ul className="text-xs text-green-700 space-y-1">
                            {alert.patient_education_topics.map((topic, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <ArrowRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                {topic}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Nurse Education */}
                      {alert.nurse_education_resources?.length > 0 && (
                        <div className="bg-navy-50 p-3 rounded border border-navy-200">
                          <p className="text-xs font-semibold text-navy-800 mb-2 flex items-center gap-1">
                            <GraduationCap className="w-3 h-3" />
                            Nurse Training Resources:
                          </p>
                          <ul className="text-xs text-navy-700 space-y-1">
                            {alert.nurse_education_resources.map((resource, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <ArrowRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                {resource}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Monitoring & Escalation */}
                      <div className="flex gap-2 text-xs">
                        {alert.monitoring_frequency && (
                          <div className="flex-1 bg-slate-100 p-2 rounded">
                            <p className="font-semibold text-slate-700">Monitor:</p>
                            <p className="text-slate-600">{alert.monitoring_frequency}</p>
                          </div>
                        )}
                        {alert.escalation_criteria && (
                          <div className="flex-1 bg-red-100 p-2 rounded">
                            <p className="font-semibold text-red-700">Escalate if:</p>
                            <p className="text-red-600">{alert.escalation_criteria}</p>
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </ScrollArea>
          </div>
        )}

        {/* Medication Concerns */}
        {analysis.medication_concerns?.length > 0 && (
          <div className="bg-orange-50 p-4 rounded-lg border-2 border-orange-200">
            <h3 className="font-semibold text-orange-900 mb-3 flex items-center gap-2">
              <Pill className="w-5 h-5" />
              Medication Concerns ({analysis.medication_concerns.length})
            </h3>
            <div className="space-y-2">
              {analysis.medication_concerns.map((concern, idx) => (
                <div key={idx} className="bg-white p-3 rounded border border-orange-200">
                  <Badge className="bg-orange-600 text-white mb-2">{concern.concern_type}</Badge>
                  <p className="text-sm font-medium text-slate-900">
                    {concern.medications_involved?.join(', ')}
                  </p>
                  <p className="text-xs text-slate-700 mt-1">{concern.risk_description}</p>
                  <p className="text-xs text-blue-700 mt-2 font-medium">
                    → {concern.recommendation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Care Plan Deviations */}
        {analysis.care_plan_deviations?.length > 0 && (
          <div className="bg-yellow-50 p-4 rounded-lg border-2 border-yellow-200">
            <h3 className="font-semibold text-yellow-900 mb-3">Care Plan Deviations</h3>
            <div className="space-y-2">
              {analysis.care_plan_deviations.map((deviation, idx) => (
                <div key={idx} className="bg-white p-3 rounded border border-yellow-200">
                  <p className="text-sm font-medium text-slate-900">{deviation.care_plan_problem}</p>
                  <p className="text-xs text-slate-700 mt-1">{deviation.deviation_description}</p>
                  <p className="text-xs text-green-700 mt-2 font-medium">
                    ✓ {deviation.corrective_action}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}