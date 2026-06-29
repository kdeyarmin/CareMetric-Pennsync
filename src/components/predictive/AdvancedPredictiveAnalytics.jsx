import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Hospital,
  Activity,
  Target,
  Clock
} from "lucide-react";
import { toast } from 'sonner';

export default function AdvancedPredictiveAnalytics({ patientId, autoAnalyze = false }) {
  const ai = useAICall();
  const [predictions, setPredictions] = useState(null);
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const patients = await base44.entities.Patient.filter({ id: patientId });
      return patients[0];
    },
    enabled: !!patientId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 30),
    enabled: !!patientId,
    initialData: []
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date'),
    enabled: !!patientId,
    initialData: []
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId,
    initialData: []
  });

  const createCarePlanMutation = useMutation({
    mutationFn: (carePlanData) => base44.entities.CarePlan.create({ ...carePlanData, patient_id: patientId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientCarePlans', patientId] });
    }
  });

  const performPredictiveAnalysis = React.useCallback(async () => {
    if (!patient) return;

    try {
      // Calculate vital signs trends
      const recentVisits = visits.slice(0, 10).filter(v => v.vital_signs);
      const vitalsHistory = recentVisits.map(v => v.vital_signs);
      
      // Calculate medication complexity
      const medicationCount = patient.current_medications?.length || 0;
      const highRiskMeds = patient.current_medications?.filter(m => 
        ['warfarin', 'insulin', 'digoxin', 'anticoagulant'].some(risk => 
          m.name?.toLowerCase().includes(risk)
        )
      ).length || 0;

      const analysisData = {
        patient: {
          age: calculateAge(patient.date_of_birth),
          diagnoses: [patient.primary_diagnosis, ...(patient.secondary_diagnoses || [])].filter(Boolean),
          comorbidityCount: (patient.secondary_diagnoses?.length || 0) + (patient.past_medical_history?.length || 0),
          medicationCount,
          highRiskMedicationCount: highRiskMeds,
          functionalStatus: patient.functional_status,
          socialHistory: patient.social_history,
          mentalHealth: patient.mental_health,
          pastHospitalizations: patient.past_hospitalizations?.length || 0,
          recentHospitalization: patient.past_hospitalizations?.[0]?.date
        },
        vitals: {
          history: vitalsHistory,
          recentCount: recentVisits.length,
          hasAbnormalTrends: checkAbnormalVitals(vitalsHistory)
        },
        visits: {
          totalCount: visits.length,
          last30Days: visits.filter(v => {
            const daysDiff = Math.floor((new Date() - new Date(v.visit_date)) / (1000 * 60 * 60 * 24));
            return daysDiff <= 30;
          }).length,
          missedVisits: visits.filter(v => v.status === 'cancelled').length
        },
        incidents: {
          totalCount: incidents.length,
          fallCount: incidents.filter(i => i.incident_type === 'fall').length,
          hospitalizationCount: incidents.filter(i => i.incident_type === 'hospitalized').length,
          recentIncidents: incidents.slice(0, 5).map(i => ({
            type: i.incident_type,
            date: i.incident_date,
            severity: i.severity
          }))
        },
        carePlans: {
          activeCount: carePlans.filter(cp => cp.status === 'active').length,
          metGoalsCount: carePlans.filter(cp => cp.status === 'met').length,
          notMetCount: carePlans.filter(cp => cp.status === 'not_met').length
        }
      };

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an advanced predictive analytics AI specialized in home health patient outcomes forecasting using evidence-based clinical algorithms.

**CRITICAL TASK:** Analyze this patient's comprehensive data and generate accurate predictions for clinical deterioration and hospital readmission risks, along with proactive care recommendations.

**Patient Analysis Data:**
${JSON.stringify(analysisData, null, 2)}

**Your Analysis Must Include:**

1. **CLINICAL DETERIORATION PREDICTION**
   - Risk Score: 0-100 (based on evidence-based early warning scores)
   - Risk Level: low/moderate/high/critical
   - Predicted Timeframe: immediate/24-48hrs/1-2weeks/1-month
   - Key Risk Factors Contributing to Score (5-8 factors with weights)
   - Clinical Indicators of Deterioration (specific signs to monitor)
   - Confidence Level: percentage (based on data completeness)

   Consider:
   * Vital signs trends and abnormalities (weight, BP variability, tachycardia)
   * Recent symptom escalation or functional decline
   * Medication non-adherence or complexity
   * Acute changes in mental status
   * Fall history and frequency
   * Comorbidity burden
   * Social support adequacy

2. **HOSPITAL READMISSION PREDICTION**
   - Risk Score: 0-100 (using LACE index principles + enhanced factors)
   - Risk Level: low/moderate/high/critical
   - Predicted Timeframe: 7-day/30-day/90-day windows
   - Contributing Factors (weighted by importance):
     * Recent hospitalization recency and length
     * Emergency department visits
     * Comorbidity complexity
     * Medication regimen complexity
     * Functional status decline
     * Social determinants of health
     * Care plan adherence
   - Preventive Intervention Window: days before predicted event
   - Confidence Level: percentage

3. **PROACTIVE CARE PLAN RECOMMENDATIONS**
   Generate 5-8 specific, actionable care interventions prioritized by impact:
   
   For each recommendation provide:
   - Intervention: Specific action to take
   - Problem: Clinical problem being addressed
   - Goal: Measurable outcome expected
   - Interventions: Detailed nursing interventions (3-5 items)
   - Rationale: Why this will reduce risk
   - Priority: immediate/high/medium
   - Expected Impact: reduction in risk score (percentage)
   - Timeframe: When to implement and reassess

4. **MONITORING PROTOCOL**
   - Vital Signs: Frequency and parameters to track
   - Symptom Assessment: What to monitor daily/weekly
   - Red Flags: Warning signs requiring immediate action
   - Contact Schedule: Recommended check-in frequency

5. **RESOURCE ALLOCATION FORECAST**
   - Predicted Visit Frequency Needed
   - Estimated Nursing Hours (next 30 days)
   - Additional Services Recommended (PT, OT, MSW, etc.)
   - DME or supplies anticipated

6. **OUTCOME PREDICTIONS** (30-day, 60-day, 90-day)
   - Expected trajectory: improving/stable/declining
   - Key milestones and expected dates
   - Discharge readiness timeline

Use clinical judgment based on established risk prediction models (LACE, HOSPITAL score, NEWS2, etc.) and adapt to home health context.`,
        response_json_schema: {
          type: "object",
          properties: {
            deterioration_prediction: {
              type: "object",
              properties: {
                risk_score: { type: "number" },
                risk_level: { type: "string" },
                timeframe: { type: "string" },
                key_risk_factors: { 
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      factor: { type: "string" },
                      weight: { type: "string" }
                    }
                  }
                },
                clinical_indicators: { type: "array", items: { type: "string" } },
                confidence: { type: "number" }
              }
            },
            readmission_prediction: {
              type: "object",
              properties: {
                risk_score: { type: "number" },
                risk_level: { type: "string" },
                timeframe_7day: { type: "number" },
                timeframe_30day: { type: "number" },
                timeframe_90day: { type: "number" },
                contributing_factors: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      factor: { type: "string" },
                      weight: { type: "string" }
                    }
                  }
                },
                intervention_window_days: { type: "number" },
                confidence: { type: "number" }
              }
            },
            proactive_care_plans: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  intervention: { type: "string" },
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  rationale: { type: "string" },
                  priority: { type: "string" },
                  expected_impact: { type: "string" },
                  timeframe: { type: "string" }
                }
              }
            },
            monitoring_protocol: {
              type: "object",
              properties: {
                vital_signs_frequency: { type: "string" },
                symptom_assessment: { type: "array", items: { type: "string" } },
                red_flags: { type: "array", items: { type: "string" } },
                contact_frequency: { type: "string" }
              }
            },
            resource_forecast: {
              type: "object",
              properties: {
                visit_frequency: { type: "string" },
                estimated_nursing_hours: { type: "number" },
                additional_services: { type: "array", items: { type: "string" } }
              }
            },
            outcome_predictions: {
              type: "object",
              properties: {
                day_30_trajectory: { type: "string" },
                day_60_trajectory: { type: "string" },
                day_90_trajectory: { type: "string" },
                key_milestones: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      });

      setPredictions(result);
    } catch (error) {
      console.error('Error performing predictive analysis:', error);
      toast.error('Failed to perform predictive analysis. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, incidents, carePlans]);

  React.useEffect(() => {
    if (autoAnalyze && patient && !predictions && !ai.loading) {
      performPredictiveAnalysis();
    }
  }, [autoAnalyze, patient, predictions, ai.loading, performPredictiveAnalysis]);

  const checkAbnormalVitals = (vitalsHistory) => {
    if (!vitalsHistory || vitalsHistory.length < 2) return false;
    
    const latest = vitalsHistory[0];
    const previous = vitalsHistory[1];
    
    // Check for significant changes
    if (latest?.blood_pressure_systolic && previous?.blood_pressure_systolic) {
      const bpChange = Math.abs(latest.blood_pressure_systolic - previous.blood_pressure_systolic);
      if (bpChange > 20) return true;
    }
    
    if (latest?.heart_rate && previous?.heart_rate) {
      const hrChange = Math.abs(latest.heart_rate - previous.heart_rate);
      if (hrChange > 20) return true;
    }
    
    return false;
  };

  const calculateAge = (dob) => {
    if (!dob) return null;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleImplementCarePlan = (recommendation) => {
    createCarePlanMutation.mutate({
      problem: recommendation.problem,
      goal: recommendation.goal,
      interventions: recommendation.interventions,
      status: 'active',
      frequency: recommendation.timeframe
    });
  };

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'low': return 'bg-green-500';
      case 'moderate': return 'bg-yellow-500';
      case 'high': return 'bg-orange-500';
      case 'critical': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'immediate': return 'bg-red-600';
      case 'high': return 'bg-orange-600';
      case 'medium': return 'bg-yellow-600';
      default: return 'bg-blue-600';
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-navy-300">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-navy-600" />
              Advanced Predictive Analytics
            </CardTitle>
            <Button
              onClick={performPredictiveAnalysis}
              disabled={ai.loading || !patient}
              size="sm"
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  {predictions ? 'Refresh Analysis' : 'Run Predictions'}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ai.loading && (
            <Alert className="bg-navy-50 border-navy-200">
              <Brain className="w-4 h-4 text-navy-600 animate-pulse" />
              <AlertDescription className="text-navy-900">
                AI is analyzing patient data using advanced predictive models... This may take 30-60 seconds.
              </AlertDescription>
            </Alert>
          )}

          {!ai.loading && !predictions && (
            <Alert className="bg-blue-50 border-blue-200">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                Click "Run Predictions" to forecast patient outcomes and generate proactive care recommendations.
              </AlertDescription>
            </Alert>
          )}

          {predictions && (
            <div className="space-y-6">
              {/* Deterioration Prediction */}
              <Card className="border-2 border-red-300">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-5 h-5 text-red-600" />
                    Clinical Deterioration Risk
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-2">
                        <span className="text-3xl font-bold text-red-600">
                          {predictions.deterioration_prediction?.risk_score}
                        </span>
                        <Badge className={`${getRiskColor(predictions.deterioration_prediction?.risk_level)} text-white`}>
                          {predictions.deterioration_prediction?.risk_level?.toUpperCase()}
                        </Badge>
                      </div>
                      <Progress value={predictions.deterioration_prediction?.risk_score} className="mb-2" />
                      <p className="text-sm text-slate-600">
                        Predicted timeframe: <strong>{predictions.deterioration_prediction?.timeframe}</strong> • 
                        Confidence: <strong>{predictions.deterioration_prediction?.confidence}%</strong>
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="font-semibold text-sm mb-2">Key Risk Factors:</p>
                    <div className="space-y-1">
                      {predictions.deterioration_prediction?.key_risk_factors?.slice(0, 5).map((factor, i) => (
                        <div key={i} className="flex items-center justify-between text-sm bg-red-50 p-2 rounded">
                          <span>{factor.factor}</span>
                          <Badge variant="outline">{factor.weight}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  {predictions.deterioration_prediction?.clinical_indicators?.length > 0 && (
                    <Alert className="bg-yellow-50 border-yellow-300">
                      <AlertTriangle className="w-4 h-4 text-yellow-600" />
                      <AlertDescription>
                        <p className="font-semibold text-sm mb-1">Monitor for these indicators:</p>
                        <ul className="text-xs space-y-1">
                          {predictions.deterioration_prediction?.clinical_indicators.slice(0, 4).map((indicator, i) => (
                            <li key={i}>• {indicator}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              {/* Readmission Prediction */}
              <Card className="border-2 border-orange-300">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Hospital className="w-5 h-5 text-orange-600" />
                    Hospital Readmission Risk
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-2">
                        <span className="text-3xl font-bold text-orange-600">
                          {predictions.readmission_prediction?.risk_score}
                        </span>
                        <Badge className={`${getRiskColor(predictions.readmission_prediction?.risk_level)} text-white`}>
                          {predictions.readmission_prediction?.risk_level?.toUpperCase()}
                        </Badge>
                      </div>
                      <Progress value={predictions.readmission_prediction?.risk_score} className="mb-2" />
                      <p className="text-sm text-slate-600">
                        Confidence: <strong>{predictions.readmission_prediction?.confidence}%</strong>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-orange-50 p-3 rounded-lg">
                      <p className="text-xs text-slate-600">7-Day Risk</p>
                      <p className="text-xl font-bold text-orange-600">{predictions.readmission_prediction?.timeframe_7day}%</p>
                    </div>
                    <div className="bg-orange-50 p-3 rounded-lg">
                      <p className="text-xs text-slate-600">30-Day Risk</p>
                      <p className="text-xl font-bold text-orange-600">{predictions.readmission_prediction?.timeframe_30day}%</p>
                    </div>
                    <div className="bg-orange-50 p-3 rounded-lg">
                      <p className="text-xs text-slate-600">90-Day Risk</p>
                      <p className="text-xl font-bold text-orange-600">{predictions.readmission_prediction?.timeframe_90day}%</p>
                    </div>
                  </div>

                  <Alert className="bg-blue-50 border-blue-300">
                    <Clock className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-sm">
                      Intervention window: <strong>{predictions.readmission_prediction?.intervention_window_days} days</strong> to prevent predicted readmission
                    </AlertDescription>
                  </Alert>

                  <div>
                    <p className="font-semibold text-sm mb-2">Contributing Factors:</p>
                    <div className="space-y-1">
                      {predictions.readmission_prediction?.contributing_factors?.slice(0, 5).map((factor, i) => (
                        <div key={i} className="flex items-center justify-between text-sm bg-orange-50 p-2 rounded">
                          <span>{factor.factor}</span>
                          <Badge variant="outline">{factor.weight}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Proactive Care Plans */}
              {predictions.proactive_care_plans?.length > 0 && (
                <Card className="border-2 border-green-300">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Target className="w-5 h-5 text-green-600" />
                      Proactive Care Plan Recommendations ({predictions.proactive_care_plans.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {predictions.proactive_care_plans.map((plan, i) => (
                      <div key={i} className="bg-green-50 p-4 rounded-lg border border-green-200">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={getPriorityColor(plan.priority)}>
                                {plan.priority}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                Impact: {plan.expected_impact}
                              </Badge>
                            </div>
                            <p className="font-semibold text-slate-900">{plan.intervention}</p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleImplementCarePlan(plan)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            Implement
                          </Button>
                        </div>

                        <div className="space-y-2 text-sm">
                          <div>
                            <p className="text-slate-600"><strong>Problem:</strong> {plan.problem}</p>
                          </div>
                          <div>
                            <p className="text-slate-600"><strong>Goal:</strong> {plan.goal}</p>
                          </div>
                          <div>
                            <p className="text-slate-600 mb-1"><strong>Interventions:</strong></p>
                            <ul className="text-xs space-y-1 ml-4">
                              {plan.interventions?.map((int, idx) => (
                                <li key={idx}>• {int}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="bg-white p-2 rounded border border-green-200">
                            <p className="text-xs text-slate-700"><strong>Rationale:</strong> {plan.rationale}</p>
                          </div>
                          <div className="flex gap-2 text-xs text-slate-600">
                            <Clock className="w-3 h-3" />
                            <span>{plan.timeframe}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Monitoring Protocol */}
              {predictions.monitoring_protocol && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-blue-600" />
                      Monitoring Protocol
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold mb-1">Vital Signs:</p>
                      <p className="text-sm text-slate-700">{predictions.monitoring_protocol.vital_signs_frequency}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold mb-1">Contact Schedule:</p>
                      <p className="text-sm text-slate-700">{predictions.monitoring_protocol.contact_frequency}</p>
                    </div>
                    {predictions.monitoring_protocol.red_flags?.length > 0 && (
                      <Alert className="bg-red-50 border-red-300">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        <AlertDescription>
                          <p className="font-semibold text-sm mb-1">Red Flags - Call MD Immediately:</p>
                          <ul className="text-xs space-y-1">
                            {predictions.monitoring_protocol.red_flags.map((flag, i) => (
                              <li key={i}>• {flag}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Resource Forecast & Outcomes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {predictions.resource_forecast && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Resource Forecast (30 Days)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div>
                        <p className="text-slate-600">Visit Frequency:</p>
                        <p className="font-semibold">{predictions.resource_forecast.visit_frequency}</p>
                      </div>
                      <div>
                        <p className="text-slate-600">Est. Nursing Hours:</p>
                        <p className="font-semibold">{predictions.resource_forecast.estimated_nursing_hours} hours</p>
                      </div>
                      {predictions.resource_forecast.additional_services?.length > 0 && (
                        <div>
                          <p className="text-slate-600 mb-1">Additional Services:</p>
                          <div className="flex flex-wrap gap-1">
                            {predictions.resource_forecast.additional_services.map((svc, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{svc}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {predictions.outcome_predictions && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Outcome Predictions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-600">30-Day:</span>
                        <Badge>{predictions.outcome_predictions.day_30_trajectory}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">60-Day:</span>
                        <Badge>{predictions.outcome_predictions.day_60_trajectory}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">90-Day:</span>
                        <Badge>{predictions.outcome_predictions.day_90_trajectory}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}