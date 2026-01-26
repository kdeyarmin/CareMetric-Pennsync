import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, Shield, Brain, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ProactiveComplianceRiskPredictor({ patientId, autoAnalyze = false }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [riskPrediction, setRiskPrediction] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const { data: patient } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    select: (patients) => patients.find(p => p.id === patientId)
  });

  const { data: violations = [] } = useQuery({
    queryKey: ['patientViolations', patientId],
    queryFn: async () => {
      const visits = await base44.entities.Visit.filter({ patient_id: patientId });
      const carePlans = await base44.entities.CarePlan.filter({ patient_id: patientId });
      
      const visitIds = visits.map(v => v.id);
      const carePlanIds = carePlans.map(cp => cp.id);
      
      const allViolations = await base44.entities.ComplianceViolation.filter({});
      return allViolations.filter(v => 
        (v.entity_type === 'visit' && visitIds.includes(v.entity_id)) ||
        (v.entity_type === 'care_plan' && carePlanIds.includes(v.entity_id))
      );
    },
    enabled: !!patientId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  React.useEffect(() => {
    if (autoAnalyze && patient && !riskPrediction && !analyzing) {
      handleAnalyze();
    }
  }, [autoAnalyze, patient]);

  const handleAnalyze = async () => {
    if (!patient) return;
    
    setAnalyzing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a healthcare compliance risk analyst. Analyze this patient's documentation history and compliance violations to predict future compliance risks.

PATIENT INFORMATION:
- Diagnoses: ${patient.primary_diagnosis}, ${patient.secondary_diagnoses?.join(', ') || 'none'}
- Care Type: ${patient.care_type}
- Current Status: ${patient.status}

DOCUMENTATION HISTORY:
- Total Visits: ${visits.length}
- Recent Visits: ${visits.slice(0, 5).map(v => `${v.visit_type} on ${v.visit_date}`).join(', ')}
- Active Care Plans: ${carePlans.filter(cp => cp.status === 'active').length}

COMPLIANCE VIOLATIONS HISTORY:
${violations.length === 0 ? 'No previous violations' : violations.map(v => `
- ${v.rule_name} (${v.severity})
  Issue: ${v.violation_description}
  Status: ${v.status}
`).join('\n')}

PATTERNS TO ANALYZE:
1. Recurring compliance issues
2. Documentation quality trends
3. Risk factors based on care type and diagnoses
4. Missing documentation elements
5. Severity escalation patterns

Predict:
1. Future compliance risk score (0-100)
2. Specific high-risk areas for this patient
3. Recommended preventive actions
4. Timeline for next likely violation if trends continue`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            high_risk_areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  risk_percentage: { type: "number" },
                  reasoning: { type: "string" }
                }
              }
            },
            preventive_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  expected_impact: { type: "string" }
                }
              }
            },
            predicted_timeline: { type: "string" },
            key_patterns: { type: "array", items: { type: "string" } },
            confidence_level: { type: "number" }
          }
        }
      });

      setRiskPrediction(response);
      toast.success("Compliance risk analysis complete");
    } catch (error) {
      toast.error("Analysis failed: " + error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const riskColors = {
    low: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-600" },
    medium: { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-800", badge: "bg-yellow-600" },
    high: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-800", badge: "bg-orange-600" },
    critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", badge: "bg-red-600" }
  };

  const colors = riskPrediction ? riskColors[riskPrediction.risk_level] : riskColors.medium;

  return (
    <Card className={`${riskPrediction ? `${colors.bg} ${colors.border}` : ''}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            Proactive Compliance Risk Prediction
          </CardTitle>
          {riskPrediction && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!riskPrediction ? (
          <div className="text-center py-4">
            <Button
              onClick={handleAnalyze}
              disabled={analyzing || !patient}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing Compliance Risk...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Analyze Future Compliance Risk
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            {/* Risk Score */}
            <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
              <div>
                <p className="text-sm text-gray-600">Compliance Risk Score</p>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-3xl font-bold">{riskPrediction.overall_risk_score}</p>
                  <Badge className={colors.badge}>
                    {riskPrediction.risk_level.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Confidence: {riskPrediction.confidence_level}%
                </p>
              </div>
              <Shield className={`w-12 h-12 ${colors.text}`} />
            </div>

            {/* High Risk Areas */}
            {expanded && riskPrediction.high_risk_areas.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  High-Risk Areas
                </h4>
                <div className="space-y-2">
                  {riskPrediction.high_risk_areas.map((area, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-lg border">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{area.area}</p>
                          <p className="text-xs text-gray-600 mt-1">{area.reasoning}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {area.risk_percentage}% risk
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preventive Actions */}
            {expanded && riskPrediction.preventive_actions.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-green-600" />
                  Recommended Preventive Actions
                </h4>
                <div className="space-y-2">
                  {riskPrediction.preventive_actions.map((action, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-lg border border-green-200">
                      <div className="flex items-start gap-2">
                        <Badge className={
                          action.priority === 'critical' ? 'bg-red-600' :
                          action.priority === 'high' ? 'bg-orange-600' :
                          action.priority === 'medium' ? 'bg-yellow-600' :
                          'bg-blue-600'
                        }>
                          {action.priority}
                        </Badge>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{action.action}</p>
                          <p className="text-xs text-gray-600 mt-1">
                            Expected Impact: {action.expected_impact}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key Patterns & Timeline */}
            {expanded && (
              <div className="space-y-3">
                {riskPrediction.key_patterns.length > 0 && (
                  <div className="p-3 bg-white rounded-lg border">
                    <h4 className="text-sm font-semibold mb-2">Identified Patterns</h4>
                    <ul className="space-y-1">
                      {riskPrediction.key_patterns.map((pattern, idx) => (
                        <li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
                          <span className="text-purple-600">•</span>
                          <span>{pattern}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <h4 className="text-sm font-semibold text-purple-900 mb-1">Predicted Timeline</h4>
                  <p className="text-xs text-purple-800">{riskPrediction.predicted_timeline}</p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAnalyze}
                  className="w-full"
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Re-analyze Risk
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}