import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Loader2, TrendingUp, Activity, AlertTriangle, Target, Brain, Calendar, Clock, Shield } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function PredictiveOutcomesAnalyzer({ analysisResults, pdgmData, patientId, onPredictionsComplete }) {
  const ai = useAICall();
  const [predictions, setPredictions] = useState(null);
  const [autoPredict, setAutoPredict] = useState(false);

  // Fetch patient's historical data with enhanced context
  const { data: patientHistory = [] } = useQuery({
    queryKey: ['patientHistory', patientId],
    queryFn: async () => {
      if (!patientId) return [];
      const [visits, oasisData, carePlans, incidents, alerts, tasks, recommendations] = await Promise.all([
        base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 50),
        base44.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 20),
        base44.entities.CarePlan.filter({ patient_id: patientId }),
        base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 20),
        base44.entities.PatientAlert.filter({ patient_id: patientId }, '-created_date', 30),
        base44.entities.Task.filter({ patient_id: patientId }, '-created_date', 50),
        base44.entities.PatientRecommendation.filter({ patient_id: patientId }, '-created_date', 30)
      ]);
      return { visits, oasisData, carePlans, incidents, alerts, tasks, recommendations };
    },
    enabled: !!patientId
  });

  // Fetch patient details
  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => patientId ? base44.entities.Patient.filter({ id: patientId }).then(p => p[0]) : null,
    enabled: !!patientId
  });

  // Fetch population-level benchmarks
  const { data: populationData = [] } = useQuery({
    queryKey: ['populationOASIS'],
    queryFn: () => base44.entities.OASISUpload.list('-created_date', 100),
  });

  const calculateHistoricalTrends = useCallback((history, _patient) => {
    if (!history || !history.visits) return null;

    const trends = {
      visit_count: history.visits?.length || 0,
      incident_count: history.incidents?.length || 0,
      hospitalization_count: history.incidents?.filter(i => i.incident_type === 'hospitalized')?.length || 0,
      fall_count: history.incidents?.filter(i => i.incident_type === 'fall')?.length || 0,
      active_alerts: history.alerts?.filter(a => a.status === 'active').length || 0,
      critical_alerts: history.alerts?.filter(a => a.severity === 'critical' && a.status === 'active').length || 0,
      care_plan_adherence: history.carePlans?.filter(cp => cp.status === 'met').length / (history.carePlans?.length || 1),
      recommendation_completion_rate: history.recommendations?.filter(r => r.status === 'completed').length / (history.recommendations?.length || 1),
      avg_visit_gap_days: null,
      functional_trend: 'unknown'
    };

    // Calculate average days between visits
    if (history.visits?.length >= 2) {
      const sortedVisits = [...history.visits].sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date));
      let totalGap = 0;
      for (let i = 1; i < sortedVisits.length; i++) {
        const gap = (new Date(sortedVisits[i].visit_date) - new Date(sortedVisits[i-1].visit_date)) / (1000 * 60 * 60 * 24);
        totalGap += gap;
      }
      trends.avg_visit_gap_days = Math.round(totalGap / (sortedVisits.length - 1));
    }

    // Analyze functional trend from OASIS history
    if (history.oasisData?.length >= 2) {
      const recent = history.oasisData.slice(0, 2);
      if (recent[0]?.pdgm_data?.functional_level && recent[1]?.pdgm_data?.functional_level) {
        const levels = ['low', 'medium', 'high'];
        const current = levels.indexOf(recent[0].pdgm_data.functional_level);
        const previous = levels.indexOf(recent[1].pdgm_data.functional_level);
        trends.functional_trend = current > previous ? 'improving' : current < previous ? 'declining' : 'stable';
      }
    }

    return trends;
  }, []);

  const calculatePopulationBenchmarks = useCallback((population, currentPdgm) => {
    if (!population || population.length === 0) return null;

    // Filter to similar cases (same clinical group)
    const similarCases = population.filter(p =>
      p.pdgm_data?.clinical_group === currentPdgm.clinical_group
    );

    if (similarCases.length === 0) return null;

    return {
      similar_case_count: similarCases.length,
      avg_payment: similarCases.reduce((sum, p) => sum + (p.estimated_payment || 0), 0) / similarCases.length,
      avg_compliance: similarCases.reduce((sum, p) => sum + (p.scores?.compliance || 0), 0) / similarCases.length,
      clinical_group: currentPdgm.clinical_group
    };
  }, []);

  const generatePredictions = useCallback(async () => {
    if (!analysisResults || !pdgmData) return;

    try {
      // Calculate historical trends
      const historicalTrends = calculateHistoricalTrends(patientHistory, patient);
      
      // Calculate population benchmarks
      const benchmarks = calculatePopulationBenchmarks(populationData, pdgmData);

      // Comprehensive AI prediction
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a predictive analytics expert for home health outcomes. Analyze OASIS data and predict patient outcomes with clinical reasoning.

CURRENT OASIS ASSESSMENT:
${JSON.stringify({
  primary_diagnosis: pdgmData.primary_diagnosis,
  comorbidities: pdgmData.comorbidities?.slice(0, 8),
  functional_scores: pdgmData.functional_scores,
  clinical_group: pdgmData.clinical_group,
  functional_level: pdgmData.functional_level,
  admission_source: pdgmData.admission_source,
  episode_timing: pdgmData.episode_timing,
  risk_factors: pdgmData.risk_factors,
  cognitive_status: pdgmData.cognitive_status,
  therapy_services: pdgmData.therapy_services
}, null, 2)}

PATIENT CONTEXT:
- Age: ${patient?.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
- Past Hospitalizations: ${patient?.past_hospitalizations?.length || 0}
- Living Situation: ${patient?.social_history?.living_situation || 'Unknown'}
- Support System: ${patient?.social_history?.support_system || 'Unknown'}
- Active Alerts: ${patientHistory?.alerts?.filter(a => a.status === 'active').length || 0}
- Pending Tasks: ${patientHistory?.tasks?.filter(t => t.status === 'pending').length || 0}
- Active Care Plans: ${patientHistory?.carePlans?.filter(cp => cp.status === 'active').length || 0}
- Recent Incidents: ${patientHistory?.incidents?.length || 0} (falls: ${patientHistory?.incidents?.filter(i => i.incident_type === 'fall').length || 0}, hospitalizations: ${patientHistory?.incidents?.filter(i => i.incident_type === 'hospitalized').length || 0})
- Previous Recommendations: ${patientHistory?.recommendations?.filter(r => r.status === 'completed').length || 0} completed, ${patientHistory?.recommendations?.filter(r => r.status === 'pending').length || 0} pending

HISTORICAL TRENDS:
${JSON.stringify(historicalTrends, null, 2)}

POPULATION BENCHMARKS (for context):
${JSON.stringify(benchmarks, null, 2)}

COMPLIANCE & QUALITY CONTEXT:
- Current Compliance Score: ${analysisResults.compliance_score}%
- Current Accuracy Score: ${analysisResults.accuracy_score}%
- Documentation Quality: ${analysisResults.overall_score}%

PREDICT THE FOLLOWING WITH EVIDENCE-BASED REASONING:

1. READMISSION RISK (30-day, 60-day)
   - Calculate risk percentage with confidence intervals
   - Identify specific risk factors from data
   - Compare to population baseline

2. LENGTH OF STAY PREDICTION
   - Predict episode duration in days
   - Provide range (optimistic/realistic/pessimistic)
   - Identify factors that could extend/reduce stay

3. FUNCTIONAL OUTCOME TRAJECTORY
   - Predict functional improvement/decline
   - Estimate discharge functional status
   - Identify barriers to improvement

4. REVENUE FORECAST
   - Predict next assessment period payment
   - Forecast 6-month revenue trend for this patient
   - Identify risk of payment denials or appeals

5. COMPLIANCE RISK PROJECTION
   - Predict likelihood of audit flags in next assessment
   - Forecast potential compliance deterioration areas
   - Identify emerging documentation patterns that could cause issues

6. CLINICAL OUTCOME PREDICTIONS
   - Wound healing timeline (if applicable)
   - Pain management success probability
   - Medication adherence likelihood
   - Fall risk trajectory

Provide SPECIFIC, ACTIONABLE predictions with clinical reasoning.`,
        response_json_schema: {
          type: "object",
          properties: {
            readmission_risk: {
              type: "object",
              properties: {
                thirty_day_risk: { type: "number", description: "0-100 percentage" },
                sixty_day_risk: { type: "number", description: "0-100 percentage" },
                ninety_day_risk: { type: "number", description: "0-100 percentage" },
                risk_level: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
                confidence: { type: "string", enum: ["high", "moderate", "low"] },
                key_risk_factors: { type: "array", items: { type: "string" } },
                protective_factors: { type: "array", items: { type: "string" } },
                compared_to_population: { type: "string" },
                intervention_impact: { type: "string" }
              }
            },
            length_of_stay: {
              type: "object",
              properties: {
                predicted_days: { type: "number" },
                optimistic_scenario: { type: "number" },
                realistic_scenario: { type: "number" },
                pessimistic_scenario: { type: "number" },
                confidence_interval: { type: "string" },
                extending_factors: { type: "array", items: { type: "string" } },
                shortening_factors: { type: "array", items: { type: "string" } }
              }
            },
            functional_trajectory: {
              type: "object",
              properties: {
                predicted_direction: { type: "string", enum: ["improvement", "stable", "decline", "mixed"] },
                improvement_likelihood: { type: "number", description: "0-100 percentage" },
                predicted_discharge_functional_level: { type: "string" },
                timeline_to_goals: { type: "string" },
                specific_predictions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      domain: { type: "string" },
                      current_score: { type: "number" },
                      predicted_score: { type: "number" },
                      timeline: { type: "string" }
                    }
                  }
                },
                barriers_to_improvement: { type: "array", items: { type: "string" } }
              }
            },
            revenue_forecast: {
              type: "object",
              properties: {
                next_period_payment: { type: "number" },
                six_month_projection: { type: "number" },
                payment_trend: { type: "string", enum: ["increasing", "stable", "decreasing"] },
                denial_risk: { type: "string", enum: ["low", "moderate", "high"] },
                appeal_likelihood: { type: "number" },
                revenue_optimization_potential: { type: "string" },
                forecasted_monthly_payments: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      month: { type: "string" },
                      predicted_payment: { type: "number" },
                      confidence: { type: "string" }
                    }
                  }
                }
              }
            },
            compliance_risk_projection: {
              type: "object",
              properties: {
                next_audit_flag_probability: { type: "number" },
                emerging_risk_areas: { type: "array", items: { type: "string" } },
                documentation_deterioration_risk: { type: "string", enum: ["low", "moderate", "high"] },
                specific_compliance_predictions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      area: { type: "string" },
                      current_score: { type: "number" },
                      predicted_score: { type: "number" },
                      risk_level: { type: "string" }
                    }
                  }
                }
              }
            },
            clinical_outcomes: {
              type: "object",
              properties: {
                wound_healing_timeline: { type: "string" },
                pain_management_success: { type: "number", description: "0-100 percentage" },
                medication_adherence_likelihood: { type: "number" },
                fall_risk_trajectory: { type: "string" },
                icu_admission_risk: { type: "number" },
                emergency_visit_risk: { type: "number" }
              }
            },
            proactive_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  category: { type: "string" },
                  rationale: { type: "string" },
                  expected_impact: { type: "string" },
                  implementation_timeline: { type: "string" },
                  success_indicators: { type: "array", items: { type: "string" } }
                }
              }
            },
            early_warning_signals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  signal: { type: "string" },
                  severity: { type: "string" },
                  action_needed: { type: "string" },
                  timeframe: { type: "string" }
                }
              }
            },
            risk_mitigation_strategies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_addressed: { type: "string" },
                  intervention: { type: "string" },
                  implementation_steps: { type: "array", items: { type: "string" } },
                  resources_needed: { type: "string" },
                  expected_risk_reduction: { type: "string" },
                  monitoring_frequency: { type: "string" },
                  success_metrics: { type: "array", items: { type: "string" } }
                }
              }
            },
            resource_allocation_plan: {
              type: "object",
              properties: {
                skilled_nursing_visits_per_week: { type: "number" },
                pt_sessions_recommended: { type: "number" },
                ot_sessions_recommended: { type: "number" },
                aide_visits_per_week: { type: "number" },
                nurse_hours_per_episode: { type: "number" },
                total_cost_estimate: { type: "number" },
                high_priority_resources: { type: "array", items: { type: "string" } },
                resource_optimization_tips: { type: "array", items: { type: "string" } }
              }
            },
            care_planning_insights: {
              type: "object",
              properties: {
                primary_goals: { type: "array", items: { type: "string" } },
                critical_interventions: { type: "array", items: { type: "string" } },
                interdisciplinary_coordination_needs: { type: "array", items: { type: "string" } },
                family_education_priorities: { type: "array", items: { type: "string" } },
                equipment_recommendations: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      });

      setPredictions(result);
      if (onPredictionsComplete) {
        onPredictionsComplete(result);
      }
    } catch (error) {
      console.error("Predictive analysis error:", error);
      setPredictions({ error: "Failed to generate predictions. Please try again." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, calculateHistoricalTrends, calculatePopulationBenchmarks, onPredictionsComplete, patient, patientHistory, pdgmData, populationData]);

  // Auto-predict when data is available
  useEffect(() => {
    if (analysisResults && pdgmData && !predictions && !ai.loading && !autoPredict) {
      setAutoPredict(true);
      generatePredictions();
    }
  }, [analysisResults, pdgmData, patientHistory, autoPredict, generatePredictions, ai.loading, predictions]);

  const getRiskColor = (level) => {
    switch (level) {
      case 'very_high': return 'bg-red-700 text-white';
      case 'high': return 'bg-red-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  if (!analysisResults || !pdgmData) return null;

  return (
    <Card className="border-2 border-indigo-300 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-indigo-600" />
            AI Predictive Outcomes Analysis
          </CardTitle>
          <Button
            onClick={generatePredictions}
            disabled={ai.loading}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Predicting...</>
            ) : (
              <><Brain className="w-4 h-4 mr-2" /> {predictions ? 'Refresh Predictions' : 'Generate Predictions'}</>
            )}
          </Button>
        </div>
      </CardHeader>

      {ai.loading && (
        <CardContent className="py-6">
          <Progress value={50} className="h-2" />
          <p className="text-sm text-slate-600 mt-3 text-center">
            Analyzing {patientHistory?.visits?.length || 0} visits, {populationData.length} benchmark cases, and clinical patterns...
          </p>
        </CardContent>
      )}

      {predictions && !predictions.error && (
        <CardContent className="pt-6 space-y-6">
          {/* Readmission Risk */}
          <Card className={`border-2 ${
            predictions.readmission_risk?.risk_level === 'very_high' || predictions.readmission_risk?.risk_level === 'high'
              ? 'border-red-400 bg-red-50'
              : predictions.readmission_risk?.risk_level === 'moderate'
                ? 'border-yellow-400 bg-yellow-50'
                : 'border-green-400 bg-green-50'
          }`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                Hospital Readmission Risk
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">30-Day Risk</p>
                  <p className="text-2xl font-bold text-red-600">{predictions.readmission_risk?.thirty_day_risk}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">60-Day Risk</p>
                  <p className="text-2xl font-bold text-orange-600">{predictions.readmission_risk?.sixty_day_risk}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">90-Day Risk</p>
                  <p className="text-2xl font-bold text-yellow-600">{predictions.readmission_risk?.ninety_day_risk}%</p>
                </div>
                <div className="text-center">
                  <Badge className={getRiskColor(predictions.readmission_risk?.risk_level)} size="lg">
                    {predictions.readmission_risk?.risk_level?.replace('_', ' ').toUpperCase()}
                  </Badge>
                  <p className="text-xs text-slate-600 mt-1">{predictions.readmission_risk?.confidence} confidence</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-red-100 p-3 rounded border border-red-200">
                  <p className="text-xs text-red-700 font-semibold mb-2">Risk Factors:</p>
                  <ul className="space-y-1">
                    {predictions.readmission_risk?.key_risk_factors?.map((factor, idx) => (
                      <li key={idx} className="text-sm text-red-800">• {factor}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-green-100 p-3 rounded border border-green-200">
                  <p className="text-xs text-green-700 font-semibold mb-2">Protective Factors:</p>
                  <ul className="space-y-1">
                    {predictions.readmission_risk?.protective_factors?.map((factor, idx) => (
                      <li key={idx} className="text-sm text-green-800">✓ {factor}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-sm text-blue-900">
                  <strong>vs Population:</strong> {predictions.readmission_risk?.compared_to_population}
                </AlertDescription>
              </Alert>

              {predictions.readmission_risk?.intervention_impact && (
                <Alert className="bg-navy-50 border-navy-200 mt-2">
                  <AlertDescription className="text-sm text-navy-900">
                    <strong>Intervention Impact:</strong> {predictions.readmission_risk?.intervention_impact}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Length of Stay Prediction */}
          <Card className="border-2 border-blue-300">
            <CardHeader className="bg-blue-50">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                Length of Stay Prediction
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="text-center p-3 bg-green-50 rounded border">
                  <p className="text-xs text-green-600">Optimistic</p>
                  <p className="text-xl font-bold text-green-700">{predictions.length_of_stay?.optimistic_scenario} days</p>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded border">
                  <p className="text-xs text-blue-600">Realistic</p>
                  <p className="text-2xl font-bold text-blue-700">{predictions.length_of_stay?.realistic_scenario} days</p>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded border">
                  <p className="text-xs text-orange-600">Pessimistic</p>
                  <p className="text-xl font-bold text-orange-700">{predictions.length_of_stay?.pessimistic_scenario} days</p>
                </div>
                <div className="text-center p-3 bg-navy-50 rounded border">
                  <p className="text-xs text-navy-600">Predicted</p>
                  <p className="text-2xl font-bold text-navy-700">{predictions.length_of_stay?.predicted_days} days</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-orange-50 p-2 rounded border border-orange-200">
                  <p className="text-xs text-orange-700 font-semibold mb-1">Extending Factors:</p>
                  <ul className="text-xs text-orange-800 space-y-0.5">
                    {predictions.length_of_stay?.extending_factors?.map((factor, idx) => (
                      <li key={idx}>⚠ {factor}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-green-50 p-2 rounded border border-green-200">
                  <p className="text-xs text-green-700 font-semibold mb-1">Shortening Factors:</p>
                  <ul className="text-xs text-green-800 space-y-0.5">
                    {predictions.length_of_stay?.shortening_factors?.map((factor, idx) => (
                      <li key={idx}>✓ {factor}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Functional Trajectory */}
          <Card className="border-2 border-navy-300">
            <CardHeader className="bg-navy-50">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-navy-600" />
                Functional Outcome Trajectory
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">Direction</p>
                  <Badge className={
                    predictions.functional_trajectory?.predicted_direction === 'improvement' ? 'bg-green-600' :
                    predictions.functional_trajectory?.predicted_direction === 'decline' ? 'bg-red-600' :
                    'bg-yellow-600'
                  } size="lg">
                    {predictions.functional_trajectory?.predicted_direction}
                  </Badge>
                </div>
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">Improvement Likelihood</p>
                  <p className="text-2xl font-bold text-navy-600">{predictions.functional_trajectory?.improvement_likelihood}%</p>
                </div>
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">Timeline to Goals</p>
                  <p className="text-sm font-bold text-navy-700">{predictions.functional_trajectory?.timeline_to_goals}</p>
                </div>
              </div>

              {predictions.functional_trajectory?.specific_predictions?.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-semibold mb-2">Specific Domain Predictions:</p>
                  <div className="space-y-2">
                    {predictions.functional_trajectory.specific_predictions.map((pred, idx) => (
                      <div key={idx} className="grid grid-cols-3 gap-2 p-2 bg-white rounded border items-center">
                        <p className="text-sm font-medium">{pred.domain}</p>
                        <div className="flex items-center gap-2 justify-center">
                          <Badge variant="outline">{pred.current_score}</Badge>
                          <span className="text-slate-400">→</span>
                          <Badge className={pred.predicted_score > pred.current_score ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}>
                            {pred.predicted_score}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600 text-right">{pred.timeline}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {predictions.functional_trajectory?.predicted_discharge_functional_level && (
                <Alert className="bg-navy-50 border-navy-200">
                  <AlertDescription className="text-sm text-navy-900">
                    <strong>Predicted Discharge Level:</strong> {predictions.functional_trajectory.predicted_discharge_functional_level}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Revenue Forecast */}
          <Card className="border-2 border-green-300">
            <CardHeader className="bg-green-50">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                Revenue Forecast & Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">Next Period</p>
                  <p className="text-2xl font-bold text-green-600">
                    ${predictions.revenue_forecast?.next_period_payment?.toLocaleString()}
                  </p>
                </div>
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">6-Month Total</p>
                  <p className="text-2xl font-bold text-green-700">
                    ${predictions.revenue_forecast?.six_month_projection?.toLocaleString()}
                  </p>
                </div>
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">Trend</p>
                  <Badge className={
                    predictions.revenue_forecast?.payment_trend === 'increasing' ? 'bg-green-600' :
                    predictions.revenue_forecast?.payment_trend === 'decreasing' ? 'bg-red-600' :
                    'bg-blue-600'
                  } size="lg">
                    {predictions.revenue_forecast?.payment_trend}
                  </Badge>
                </div>
              </div>

              {predictions.revenue_forecast?.forecasted_monthly_payments?.length > 0 && (
                <div className="mb-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={predictions.revenue_forecast.forecasted_monthly_payments}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value) => `$${(value ?? 0).toLocaleString()}`} />
                      <Line type="monotone" dataKey="predicted_payment" stroke="#10b981" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded border ${
                  predictions.revenue_forecast?.denial_risk === 'high' ? 'bg-red-100 border-red-300' :
                  predictions.revenue_forecast?.denial_risk === 'moderate' ? 'bg-yellow-100 border-yellow-300' :
                  'bg-green-100 border-green-300'
                }`}>
                  <p className="text-xs font-semibold mb-1">Denial Risk:</p>
                  <p className="text-sm font-bold">{predictions.revenue_forecast?.denial_risk}</p>
                </div>
                <div className="bg-blue-50 p-3 rounded border border-blue-200">
                  <p className="text-xs font-semibold mb-1">Appeal Likelihood:</p>
                  <p className="text-sm font-bold">{predictions.revenue_forecast?.appeal_likelihood}%</p>
                </div>
              </div>

              {predictions.revenue_forecast?.revenue_optimization_potential && (
                <Alert className="bg-green-50 border-green-200 mt-3">
                  <AlertDescription className="text-sm text-green-900">
                    <strong>Optimization Potential:</strong> {predictions.revenue_forecast.revenue_optimization_potential}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Compliance Risk Projection */}
          <Card className="border-2 border-orange-300">
            <CardHeader className="bg-orange-50">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                Compliance Risk Projection
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">Audit Flag Probability</p>
                  <p className="text-3xl font-bold text-red-600">
                    {predictions.compliance_risk_projection?.next_audit_flag_probability}%
                  </p>
                </div>
                <div className="text-center p-3 bg-white rounded border-2">
                  <p className="text-xs text-slate-600">Documentation Risk</p>
                  <Badge className={getRiskColor(predictions.compliance_risk_projection?.documentation_deterioration_risk)} size="lg">
                    {predictions.compliance_risk_projection?.documentation_deterioration_risk}
                  </Badge>
                </div>
              </div>

              {predictions.compliance_risk_projection?.emerging_risk_areas?.length > 0 && (
                <div className="bg-orange-50 p-3 rounded border border-orange-200 mb-3">
                  <p className="text-sm font-semibold text-orange-900 mb-2">Emerging Risk Areas:</p>
                  <ul className="space-y-1">
                    {predictions.compliance_risk_projection.emerging_risk_areas.map((area, idx) => (
                      <li key={idx} className="text-sm text-orange-800">⚠ {area}</li>
                    ))}
                  </ul>
                </div>
              )}

              {predictions.compliance_risk_projection?.specific_compliance_predictions?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-900">Specific Area Predictions:</p>
                  {predictions.compliance_risk_projection.specific_compliance_predictions.map((pred, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border">
                      <span className="text-sm">{pred.area}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{pred.current_score}%</span>
                        <span className="text-slate-400">→</span>
                        <span className={`text-sm font-bold ${pred.predicted_score < pred.current_score ? 'text-red-600' : 'text-green-600'}`}>
                          {pred.predicted_score}%
                        </span>
                        <Badge className={getRiskColor(pred.risk_level)} size="sm">{pred.risk_level}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Clinical Outcomes */}
          {predictions.clinical_outcomes && (
            <Card className="border-2 border-navy-300">
              <CardHeader className="bg-navy-50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="w-5 h-5 text-navy-600" />
                  Clinical Outcome Predictions
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {predictions.clinical_outcomes.pain_management_success !== undefined && (
                    <div className="p-3 bg-white rounded border text-center">
                      <p className="text-xs text-slate-600 mb-1">Pain Management Success</p>
                      <p className="text-xl font-bold text-blue-600">{predictions.clinical_outcomes.pain_management_success}%</p>
                    </div>
                  )}
                  {predictions.clinical_outcomes.medication_adherence_likelihood !== undefined && (
                    <div className="p-3 bg-white rounded border text-center">
                      <p className="text-xs text-slate-600 mb-1">Medication Adherence</p>
                      <p className="text-xl font-bold text-green-600">{predictions.clinical_outcomes.medication_adherence_likelihood}%</p>
                    </div>
                  )}
                  {predictions.clinical_outcomes.fall_risk_trajectory && (
                    <div className="p-3 bg-white rounded border text-center">
                      <p className="text-xs text-slate-600 mb-1">Fall Risk Trend</p>
                      <Badge className={
                        predictions.clinical_outcomes.fall_risk_trajectory.includes('decreasing') ? 'bg-green-600' :
                        predictions.clinical_outcomes.fall_risk_trajectory.includes('increasing') ? 'bg-red-600' :
                        'bg-yellow-600'
                      }>
                        {predictions.clinical_outcomes.fall_risk_trajectory}
                      </Badge>
                    </div>
                  )}
                  {predictions.clinical_outcomes.emergency_visit_risk !== undefined && (
                    <div className="p-3 bg-white rounded border text-center">
                      <p className="text-xs text-slate-600 mb-1">Emergency Visit Risk</p>
                      <p className="text-xl font-bold text-orange-600">{predictions.clinical_outcomes.emergency_visit_risk}%</p>
                    </div>
                  )}
                  {predictions.clinical_outcomes.wound_healing_timeline && (
                    <div className="p-3 bg-white rounded border">
                      <p className="text-xs text-slate-600 mb-1">Wound Healing Timeline</p>
                      <p className="text-sm font-bold text-navy-600">{predictions.clinical_outcomes.wound_healing_timeline}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Early Warning Signals */}
          {predictions.early_warning_signals?.length > 0 && (
            <Card className="border-2 border-red-400 bg-red-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-red-900">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Early Warning Signals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {predictions.early_warning_signals.map((signal, idx) => (
                    <Card key={idx} className={`border-l-4 ${
                      signal.severity === 'critical' ? 'border-l-red-600' :
                      signal.severity === 'high' ? 'border-l-orange-500' :
                      'border-l-yellow-500'
                    }`}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <p className="font-semibold text-slate-900">{signal.signal}</p>
                          <Badge className={
                            signal.severity === 'critical' ? 'bg-red-600' :
                            signal.severity === 'high' ? 'bg-orange-500' :
                            'bg-yellow-500'
                          }>
                            {signal.severity}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">{signal.action_needed}</p>
                        <Badge variant="outline" className="text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {signal.timeframe}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Risk Mitigation Strategies */}
          {predictions.risk_mitigation_strategies?.length > 0 && (
            <Card className="border-2 border-red-400 bg-gradient-to-r from-red-50 to-orange-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="w-5 h-5 text-red-600" />
                  Risk Mitigation Strategies
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {predictions.risk_mitigation_strategies.map((strategy, idx) => (
                    <Card key={idx} className="border-l-4 border-l-red-600">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-semibold text-slate-900 mb-1">{strategy.risk_addressed}</h4>
                            <p className="text-sm text-slate-700">{strategy.intervention}</p>
                          </div>
                          <Badge className="bg-green-600 text-white">
                            {strategy.expected_risk_reduction}
                          </Badge>
                        </div>

                        {strategy.implementation_steps?.length > 0 && (
                          <div className="bg-blue-50 p-3 rounded border border-blue-200 mb-2">
                            <p className="text-xs text-blue-700 font-semibold mb-2">Implementation Steps:</p>
                            <ol className="space-y-1">
                              {strategy.implementation_steps.map((step, sIdx) => (
                                <li key={sIdx} className="text-sm text-blue-900 flex items-start gap-2">
                                  <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                                    {sIdx + 1}
                                  </span>
                                  {step}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div className="bg-navy-50 p-2 rounded border border-navy-200">
                            <p className="text-xs text-navy-600 mb-1">Resources Needed:</p>
                            <p className="text-sm text-navy-900">{strategy.resources_needed}</p>
                          </div>
                          <div className="bg-orange-50 p-2 rounded border border-orange-200">
                            <p className="text-xs text-orange-600 mb-1">Monitoring:</p>
                            <p className="text-sm text-orange-900">{strategy.monitoring_frequency}</p>
                          </div>
                        </div>

                        {strategy.success_metrics?.length > 0 && (
                          <div className="bg-green-50 p-2 rounded border border-green-200">
                            <p className="text-xs text-green-700 font-semibold mb-1">Success Metrics:</p>
                            <ul className="space-y-0.5">
                              {strategy.success_metrics.map((metric, mIdx) => (
                                <li key={mIdx} className="text-xs text-green-800">✓ {metric}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resource Allocation Plan */}
          {predictions.resource_allocation_plan && (
            <Card className="border-2 border-green-400">
              <CardHeader className="bg-green-50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="w-5 h-5 text-green-600" />
                  Resource Allocation Plan
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="text-center p-3 bg-white rounded border">
                    <p className="text-xs text-slate-600 mb-1">SN Visits/Week</p>
                    <p className="text-2xl font-bold text-blue-700">{predictions.resource_allocation_plan.skilled_nursing_visits_per_week}</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded border">
                    <p className="text-xs text-slate-600 mb-1">PT Sessions</p>
                    <p className="text-2xl font-bold text-green-700">{predictions.resource_allocation_plan.pt_sessions_recommended}</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded border">
                    <p className="text-xs text-slate-600 mb-1">OT Sessions</p>
                    <p className="text-2xl font-bold text-navy-700">{predictions.resource_allocation_plan.ot_sessions_recommended}</p>
                  </div>
                  <div className="text-center p-3 bg-white rounded border">
                    <p className="text-xs text-slate-600 mb-1">Aide Visits/Week</p>
                    <p className="text-2xl font-bold text-orange-700">{predictions.resource_allocation_plan.aide_visits_per_week}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 bg-indigo-50 rounded border border-indigo-200">
                    <p className="text-xs text-indigo-600 mb-1">Nurse Hours/Episode</p>
                    <p className="text-xl font-bold text-indigo-700">{predictions.resource_allocation_plan.nurse_hours_per_episode} hrs</p>
                  </div>
                  <div className="p-3 bg-green-50 rounded border border-green-200">
                    <p className="text-xs text-green-600 mb-1">Total Cost Estimate</p>
                    <p className="text-xl font-bold text-green-700">${predictions.resource_allocation_plan.total_cost_estimate?.toLocaleString()}</p>
                  </div>
                </div>

                {predictions.resource_allocation_plan.high_priority_resources?.length > 0 && (
                  <div className="bg-red-50 p-3 rounded border border-red-200 mb-3">
                    <p className="text-sm font-semibold text-red-900 mb-2">High-Priority Resources:</p>
                    <ul className="space-y-1">
                      {predictions.resource_allocation_plan.high_priority_resources.map((resource, idx) => (
                        <li key={idx} className="text-sm text-red-800">⚡ {resource}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {predictions.resource_allocation_plan.resource_optimization_tips?.length > 0 && (
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <p className="text-sm font-semibold text-blue-900 mb-2">Optimization Tips:</p>
                    <ul className="space-y-1">
                      {predictions.resource_allocation_plan.resource_optimization_tips.map((tip, idx) => (
                        <li key={idx} className="text-sm text-blue-800">💡 {tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Care Planning Insights */}
          {predictions.care_planning_insights && (
            <Card className="border-2 border-navy-400 bg-gradient-to-r from-navy-50 to-gold-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="w-5 h-5 text-navy-600" />
                  Care Planning Insights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {predictions.care_planning_insights.primary_goals?.length > 0 && (
                    <div className="bg-white p-3 rounded border">
                      <p className="text-sm font-semibold text-slate-900 mb-2">🎯 Primary Care Goals:</p>
                      <ul className="space-y-1">
                        {predictions.care_planning_insights.primary_goals.map((goal, idx) => (
                          <li key={idx} className="text-sm text-slate-800">• {goal}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {predictions.care_planning_insights.critical_interventions?.length > 0 && (
                    <div className="bg-red-50 p-3 rounded border border-red-200">
                      <p className="text-sm font-semibold text-red-900 mb-2">⚡ Critical Interventions:</p>
                      <ul className="space-y-1">
                        {predictions.care_planning_insights.critical_interventions.map((intervention, idx) => (
                          <li key={idx} className="text-sm text-red-800">• {intervention}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {predictions.care_planning_insights.interdisciplinary_coordination_needs?.length > 0 && (
                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <p className="text-sm font-semibold text-blue-900 mb-2">🤝 Team Coordination Needs:</p>
                      <ul className="space-y-1">
                        {predictions.care_planning_insights.interdisciplinary_coordination_needs.map((need, idx) => (
                          <li key={idx} className="text-sm text-blue-800">• {need}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {predictions.care_planning_insights.family_education_priorities?.length > 0 && (
                      <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                        <p className="text-sm font-semibold text-yellow-900 mb-2">👨‍👩‍👧 Family Education:</p>
                        <ul className="space-y-1">
                          {predictions.care_planning_insights.family_education_priorities.map((priority, idx) => (
                            <li key={idx} className="text-xs text-yellow-800">• {priority}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {predictions.care_planning_insights.equipment_recommendations?.length > 0 && (
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <p className="text-sm font-semibold text-green-900 mb-2">🛠️ Equipment Needs:</p>
                        <ul className="space-y-1">
                          {predictions.care_planning_insights.equipment_recommendations.map((equip, idx) => (
                            <li key={idx} className="text-xs text-green-800">• {equip}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Proactive Recommendations */}
          {predictions.proactive_recommendations?.length > 0 && (
            <Card className="border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-600" />
                  Proactive Recommendations ({predictions.proactive_recommendations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[...predictions.proactive_recommendations]
                    .sort((a, b) => {
                      // Default a missing/out-of-enum AI priority to the end so the
                      // comparator never returns NaN (which sort treats as "equal",
                      // scrambling the order). Copy the array first so the AI result
                      // object isn't mutated in place.
                      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                      const rank = (p) => priorityOrder[p] ?? 99;
                      return rank(a.priority) - rank(b.priority);
                    })
                    .map((rec, idx) => (
                    <Card key={idx} className="border-l-4 border-l-blue-600">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">
                              {idx + 1}
                            </span>
                            <p className="font-semibold text-slate-900">{rec.recommendation}</p>
                          </div>
                          <Badge className={
                            rec.priority === 'critical' ? 'bg-red-600' :
                            rec.priority === 'high' ? 'bg-orange-500' :
                            rec.priority === 'medium' ? 'bg-yellow-500' :
                            'bg-blue-500'
                          }>
                            {rec.priority}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div className="bg-navy-50 p-2 rounded border border-navy-200">
                            <p className="text-xs text-navy-600 mb-1">Category:</p>
                            <p className="text-sm text-navy-900">{rec.category}</p>
                          </div>
                          <div className="bg-green-50 p-2 rounded border border-green-200">
                            <p className="text-xs text-green-600 mb-1">Timeline:</p>
                            <p className="text-sm text-green-900">{rec.implementation_timeline}</p>
                          </div>
                        </div>

                        <div className="bg-blue-50 p-2 rounded border border-blue-200 mb-2">
                          <p className="text-xs text-blue-700 font-semibold mb-1">Rationale:</p>
                          <p className="text-sm text-blue-900">{rec.rationale}</p>
                        </div>

                        <div className="bg-green-50 p-2 rounded border border-green-200 mb-2">
                          <p className="text-xs text-green-700 font-semibold mb-1">Expected Impact:</p>
                          <p className="text-sm text-green-900">{rec.expected_impact}</p>
                        </div>

                        {rec.success_indicators?.length > 0 && (
                          <div className="bg-white p-2 rounded border">
                            <p className="text-xs text-slate-600 mb-1">Success Indicators:</p>
                            <ul className="space-y-0.5">
                              {rec.success_indicators.map((indicator, sIdx) => (
                                <li key={sIdx} className="text-xs text-slate-800">✓ {indicator}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      )}

      {predictions?.error && (
        <CardContent>
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{predictions.error}</AlertDescription>
          </Alert>
        </CardContent>
      )}

      {!predictions && !ai.loading && (
        <CardContent className="py-8 text-center">
          <Brain className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600 mb-4">Click "Generate Predictions" for AI-powered outcome analysis</p>
          <p className="text-xs text-slate-500">
            Analyzes current assessment + {patientHistory?.visits?.length || 0} historical visits + {populationData.length} population benchmarks
          </p>
        </CardContent>
      )}
    </Card>
  );
}