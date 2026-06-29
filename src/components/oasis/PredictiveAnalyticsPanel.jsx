import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Activity,
  Target,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Heart,
  Hospital,
  Lightbulb
} from "lucide-react";

export default function PredictiveAnalyticsPanel({ 
  patient, 
  oasisData, 
  historicalVisits = [],
  carePlans = [],
  incidents = []
}) {
  const ai = useAICall();
  const [predictions, setPredictions] = useState(null);
  const [error, setError] = useState(null);

  const analyzePredictiveRisks = async () => {
    setError(null);

    try {
      // Gather comprehensive patient context
      const patientContext = {
        demographics: {
          age: patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : null,
          primary_diagnosis: patient.primary_diagnosis,
          secondary_diagnoses: patient.secondary_diagnoses,
          functional_status: patient.functional_status,
          living_situation: patient.social_history?.living_situation
        },
        clinical_history: {
          past_hospitalizations: patient.past_hospitalizations?.length || 0,
          past_medical_history: patient.past_medical_history,
          current_medications: patient.current_medications?.length || 0,
          recent_vitals: patient.baseline_vitals,
          wounds: patient.wounds?.length || 0
        },
        oasis_indicators: oasisData ? {
          mobility_score: oasisData.M1860_mobility,
          adl_score: oasisData.M1800_adl_total,
          cognitive_function: oasisData.M1700_cognitive,
          pain_level: oasisData.M1242_pain,
          dyspnea: oasisData.M1400_dyspnea
        } : null,
        service_utilization: {
          total_visits: historicalVisits.length,
          recent_visits_count: historicalVisits.filter(v => {
            const visitDate = new Date(v.visit_date);
            const monthAgo = new Date();
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return visitDate >= monthAgo;
          }).length,
          incident_count: incidents.length,
          care_plan_count: carePlans.length
        }
      };

      const prompt = `You are a clinical analytics AI analyzing home health patient data to predict outcomes and risks.

Patient Context:
${JSON.stringify(patientContext, null, 2)}

Based on this comprehensive patient profile, provide a detailed predictive analysis:

1. **Readmission Risk Assessment** (0-100%):
   - Calculate risk percentage
   - Identify key contributing factors
   - Compare to population baseline

2. **Functional Decline Prediction**:
   - Likelihood of ADL decline in next 60 days
   - Specific areas of concern
   - Trajectory forecast

3. **Clinical Deterioration Indicators**:
   - Risk of acute events (falls, infection, cardiac events)
   - Early warning signs to monitor
   - Timeline for potential events

4. **Care Gap Analysis**:
   - Unaddressed clinical needs
   - Missing assessments or interventions
   - Documentation gaps

5. **Proactive Interventions** (prioritized list):
   - Evidence-based recommendations
   - Timing for each intervention
   - Expected impact on outcomes

6. **Resource Utilization Forecast**:
   - Predicted visit frequency needs
   - Potential for increased services
   - Cost-effectiveness considerations

Provide specific, actionable insights with confidence levels.`;

      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            readmission_risk: {
              type: "object",
              properties: {
                risk_percentage: { type: "number" },
                risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
                contributing_factors: { type: "array", items: { type: "string" } },
                comparison_to_baseline: { type: "string" }
              }
            },
            functional_decline: {
              type: "object",
              properties: {
                decline_probability: { type: "number" },
                areas_of_concern: { type: "array", items: { type: "string" } },
                trajectory: { type: "string" },
                timeframe_days: { type: "number" }
              }
            },
            clinical_deterioration: {
              type: "object",
              properties: {
                acute_event_risks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      event_type: { type: "string" },
                      risk_level: { type: "string" },
                      probability: { type: "number" },
                      warning_signs: { type: "array", items: { type: "string" } }
                    }
                  }
                },
                monitoring_priorities: { type: "array", items: { type: "string" } }
              }
            },
            care_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  gap_type: { type: "string" },
                  description: { type: "string" },
                  impact: { type: "string", enum: ["high", "medium", "low"] },
                  recommendation: { type: "string" }
                }
              }
            },
            proactive_interventions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  intervention: { type: "string" },
                  priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
                  rationale: { type: "string" },
                  timing: { type: "string" },
                  expected_outcome: { type: "string" }
                }
              }
            },
            resource_forecast: {
              type: "object",
              properties: {
                predicted_visit_frequency: { type: "string" },
                service_intensity_trend: { type: "string" },
                cost_considerations: { type: "string" }
              }
            },
            overall_outlook: { type: "string" },
            confidence_level: { type: "string", enum: ["high", "moderate", "low"] }
          }
        }
      });

      setPredictions(response);
    } catch (err) {
      setError(err.message);
      console.error("Predictive analysis error:", err);
    }
  };

  const getRiskColor = (level) => {
    const colors = {
      low: "text-green-700 bg-green-50 border-green-200",
      moderate: "text-yellow-700 bg-yellow-50 border-yellow-200",
      high: "text-orange-700 bg-orange-50 border-orange-200",
      critical: "text-red-700 bg-red-50 border-red-200"
    };
    return colors[level] || colors.moderate;
  };

  const _getRiskIcon = (level) => {
    if (level === 'critical' || level === 'high') return <AlertTriangle className="w-5 h-5" />;
    if (level === 'moderate') return <Clock className="w-5 h-5" />;
    return <CheckCircle2 className="w-5 h-5" />;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      urgent: "bg-red-600",
      high: "bg-orange-600",
      medium: "bg-yellow-600",
      low: "bg-blue-600"
    };
    return colors[priority] || colors.medium;
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-blue-50">
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-6 h-6 text-navy-600" />
          AI Predictive Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {!predictions && !ai.loading && (
          <div className="text-center py-8">
            <Brain className="w-16 h-16 text-navy-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              Generate Predictive Insights
            </h3>
            <p className="text-slate-600 mb-6">
              AI-powered analysis of patient risks, outcomes, and proactive interventions
            </p>
            <Button
              onClick={analyzePredictiveRisks}
              className="bg-navy-600 hover:bg-navy-700"
            >
              <Activity className="w-4 h-4 mr-2" />
              Analyze Patient Risk Profile
            </Button>
          </div>
        )}

        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-navy-600 mx-auto mb-4" />
            <p className="text-slate-600">Analyzing patient data and generating predictions...</p>
          </div>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <XCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {predictions && (
          <div className="space-y-6">
            {/* Overall Confidence */}
            <Alert className="bg-blue-50 border-blue-200">
              <Brain className="w-4 h-4 text-blue-600" />
              <AlertDescription>
                <strong>Analysis Confidence: {predictions.confidence_level}</strong>
                <p className="text-sm mt-1">{predictions.overall_outlook}</p>
              </AlertDescription>
            </Alert>

            {/* Readmission Risk */}
            <Card className={`border-2 ${getRiskColor(predictions.readmission_risk?.risk_level)}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Hospital className="w-5 h-5" />
                    <h4 className="font-bold">Readmission Risk</h4>
                  </div>
                  <Badge className={getPriorityColor(predictions.readmission_risk?.risk_level)}>
                    {predictions.readmission_risk?.risk_percentage}%
                  </Badge>
                </div>
                <Progress value={predictions.readmission_risk?.risk_percentage} className="h-2 mb-3" />
                <p className="text-sm mb-2"><strong>Risk Level:</strong> {predictions.readmission_risk?.risk_level}</p>
                <p className="text-sm mb-2">{predictions.readmission_risk?.comparison_to_baseline}</p>
                <div className="mt-2">
                  <p className="text-xs font-semibold mb-1">Contributing Factors:</p>
                  <div className="flex flex-wrap gap-1">
                    {predictions.readmission_risk?.contributing_factors?.map((factor, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">{factor}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Functional Decline */}
            {predictions.functional_decline && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-5 h-5 text-orange-600" />
                    <h4 className="font-bold">Functional Decline Prediction</h4>
                  </div>
                  <p className="text-sm mb-2">
                    <strong>Decline Probability:</strong> {predictions.functional_decline.decline_probability}%
                  </p>
                  <p className="text-sm mb-2">
                    <strong>Timeframe:</strong> Next {predictions.functional_decline.timeframe_days} days
                  </p>
                  <p className="text-sm mb-3">{predictions.functional_decline.trajectory}</p>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">Areas of Concern:</p>
                    {predictions.functional_decline.areas_of_concern?.map((area, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <AlertTriangle className="w-3 h-3 text-orange-600" />
                        {area}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Clinical Deterioration Risks */}
            {predictions.clinical_deterioration?.acute_event_risks?.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Heart className="w-5 h-5 text-red-600" />
                    <h4 className="font-bold">Acute Event Risks</h4>
                  </div>
                  <div className="space-y-3">
                    {predictions.clinical_deterioration.acute_event_risks.map((risk, idx) => (
                      <div key={idx} className="border-l-4 border-red-400 pl-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-semibold text-sm">{risk.event_type}</p>
                          <Badge className={getPriorityColor(risk.risk_level)}>
                            {risk.probability}%
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600 mb-1">Warning Signs:</p>
                        {risk.warning_signs?.map((sign, sIdx) => (
                          <p key={sIdx} className="text-xs text-slate-700">• {sign}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                  {predictions.clinical_deterioration.monitoring_priorities?.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-semibold mb-2">Monitoring Priorities:</p>
                      {predictions.clinical_deterioration.monitoring_priorities.map((priority, idx) => (
                        <Badge key={idx} variant="outline" className="mr-1 mb-1 text-xs">
                          {priority}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Care Gaps */}
            {predictions.care_gaps?.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-5 h-5 text-blue-600" />
                    <h4 className="font-bold">Care Gap Analysis</h4>
                  </div>
                  <div className="space-y-2">
                    {predictions.care_gaps.map((gap, idx) => (
                      <div key={idx} className={`p-2 rounded border ${
                        gap.impact === 'high' ? 'bg-red-50 border-red-200' :
                        gap.impact === 'medium' ? 'bg-yellow-50 border-yellow-200' :
                        'bg-slate-50 border-slate-200'
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-semibold text-sm">{gap.gap_type}</p>
                          <Badge variant="outline">{gap.impact} impact</Badge>
                        </div>
                        <p className="text-xs text-slate-700 mb-1">{gap.description}</p>
                        <p className="text-xs text-blue-700">
                          <strong>Recommendation:</strong> {gap.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Proactive Interventions */}
            <Card className="border-2 border-green-200 bg-green-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-green-700" />
                  <h4 className="font-bold text-green-900">Recommended Interventions</h4>
                </div>
                <div className="space-y-3">
                  {predictions.proactive_interventions?.map((intervention, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-green-200">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-semibold text-sm flex-1">{intervention.intervention}</p>
                        <Badge className={getPriorityColor(intervention.priority)}>
                          {intervention.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-700 mb-1">
                        <strong>Rationale:</strong> {intervention.rationale}
                      </p>
                      <p className="text-xs text-slate-700 mb-1">
                        <strong>Timing:</strong> {intervention.timing}
                      </p>
                      <p className="text-xs text-green-700">
                        <strong>Expected Outcome:</strong> {intervention.expected_outcome}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Resource Forecast */}
            {predictions.resource_forecast && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-5 h-5 text-navy-600" />
                    <h4 className="font-bold">Resource Utilization Forecast</h4>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p><strong>Visit Frequency:</strong> {predictions.resource_forecast.predicted_visit_frequency}</p>
                    <p><strong>Service Intensity:</strong> {predictions.resource_forecast.service_intensity_trend}</p>
                    <p className="text-slate-700">{predictions.resource_forecast.cost_considerations}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end pt-4 border-t">
              <Button
                onClick={analyzePredictiveRisks}
                variant="outline"
                size="sm"
              >
                <Activity className="w-4 h-4 mr-2" />
                Re-analyze
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}