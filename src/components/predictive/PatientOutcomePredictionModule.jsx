import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  TrendingUp, 
  AlertTriangle, 
  Activity, 
  Heart,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Brain,
  Target
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function PatientOutcomePredictionModule({ patientId, careSetting, providerType }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [predictions, setPredictions] = useState(null);

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId
  });

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits', patientId],
    queryFn: async () => {
      const visits = await base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 10);
      return visits;
    },
    enabled: !!patientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['carePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId, status: 'active' }),
    enabled: !!patientId
  });

  const analyzePredictions = async () => {
    setAnalyzing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical analytics AI analyzing patient outcomes for a ${providerType} in ${careSetting} setting.

PATIENT DATA:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis}
- Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(', ') || 'None'}
- Current Medications: ${(patient.current_medications || []).map(m => m.name).join(', ') || 'None'}
- Baseline Vitals: ${JSON.stringify(patient.baseline_vitals || {})}
- Functional Status: ${JSON.stringify(patient.functional_status || {})}
- Recent Hospitalizations: ${(patient.past_hospitalizations || []).length}

RECENT VISIT TRENDS (${recentVisits.length} visits):
${recentVisits.slice(0, 5).map(v => `- ${v.visit_date}: ${v.visit_type} - ${v.nurse_notes?.substring(0, 200) || 'No notes'}`).join('\n')}

ACTIVE CARE PLANS:
${carePlans.map(cp => `- Problem: ${cp.problem}, Goal: ${cp.goal}, Progress: ${cp.progress_percentage || 0}%`).join('\n')}

CARE SETTING: ${careSetting}
PROVIDER TYPE: ${providerType}

Analyze this patient data and predict outcomes specific to ${careSetting} setting. Provide:

1. **Readmission Risk** (0-100 score with justification)
2. **Treatment Efficacy** (0-100 score - how well current treatments are working)
3. **Deterioration Risk** (0-100 score - risk of clinical decline)
4. **Care Plan Success Probability** (0-100 score)
5. **Intervention Recommendations** (3-5 specific actions for ${providerType})
6. **Timeline Predictions** (expected outcomes in 7, 30, 60 days)
7. **Risk Factors** (top 3-5 factors contributing to risks)
8. **Protective Factors** (positive elements supporting recovery)

Focus on ${careSetting}-specific metrics and ${providerType} scope of practice.`,
        response_json_schema: {
          type: 'object',
          properties: {
            readmission_risk: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                level: { type: 'string' },
                justification: { type: 'string' }
              }
            },
            treatment_efficacy: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                level: { type: 'string' },
                analysis: { type: 'string' }
              }
            },
            deterioration_risk: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                level: { type: 'string' },
                warning_signs: { type: 'array', items: { type: 'string' } }
              }
            },
            care_plan_success: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                level: { type: 'string' },
                analysis: { type: 'string' }
              }
            },
            intervention_recommendations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string' },
                  priority: { type: 'string' },
                  rationale: { type: 'string' },
                  timeframe: { type: 'string' }
                }
              }
            },
            timeline_predictions: {
              type: 'object',
              properties: {
                seven_days: { type: 'string' },
                thirty_days: { type: 'string' },
                sixty_days: { type: 'string' }
              }
            },
            risk_factors: { type: 'array', items: { type: 'string' } },
            protective_factors: { type: 'array', items: { type: 'string' } }
          }
        }
      });

      setPredictions(response);
    } catch (error) {
      console.error('Prediction error:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const getRiskColor = (score) => {
    if (score >= 70) return 'text-red-600 bg-red-50 border-red-300';
    if (score >= 40) return 'text-yellow-600 bg-yellow-50 border-yellow-300';
    return 'text-green-600 bg-green-50 border-green-300';
  };

  const getRiskIcon = (score) => {
    if (score >= 70) return <XCircle className="w-5 h-5 text-red-600" />;
    if (score >= 40) return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
    return <CheckCircle2 className="w-5 h-5 text-green-600" />;
  };

  if (!patient) return null;

  return (
    <Card className="border-purple-300 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-600" />
            AI Outcome Predictions
          </span>
          <Button 
            onClick={analyzePredictions} 
            disabled={analyzing}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                Run Analysis
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!predictions ? (
          <Alert>
            <Target className="w-4 h-4" />
            <AlertDescription>
              AI will analyze {patient.first_name}'s clinical data, visit trends, and care plans to predict outcomes
              and recommend interventions specific to {careSetting} and {providerType} practice.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Risk Scores Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className={getRiskColor(predictions.readmission_risk?.score || 0)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {getRiskIcon(predictions.readmission_risk?.score || 0)}
                    <p className="text-xs font-semibold">Readmission Risk</p>
                  </div>
                  <p className="text-2xl font-bold">{predictions.readmission_risk?.score || 0}%</p>
                  <Badge className="mt-1 text-xs">{predictions.readmission_risk?.level || 'Low'}</Badge>
                </CardContent>
              </Card>

              <Card className={getRiskColor(100 - (predictions.treatment_efficacy?.score || 0))}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Heart className="w-5 h-5" />
                    <p className="text-xs font-semibold">Treatment Efficacy</p>
                  </div>
                  <p className="text-2xl font-bold">{predictions.treatment_efficacy?.score || 0}%</p>
                  <Badge className="mt-1 text-xs">{predictions.treatment_efficacy?.level || 'Good'}</Badge>
                </CardContent>
              </Card>

              <Card className={getRiskColor(predictions.deterioration_risk?.score || 0)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-5 h-5" />
                    <p className="text-xs font-semibold">Deterioration Risk</p>
                  </div>
                  <p className="text-2xl font-bold">{predictions.deterioration_risk?.score || 0}%</p>
                  <Badge className="mt-1 text-xs">{predictions.deterioration_risk?.level || 'Low'}</Badge>
                </CardContent>
              </Card>

              <Card className={getRiskColor(100 - (predictions.care_plan_success?.score || 0))}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-5 h-5" />
                    <p className="text-xs font-semibold">Care Plan Success</p>
                  </div>
                  <p className="text-2xl font-bold">{predictions.care_plan_success?.score || 0}%</p>
                  <Badge className="mt-1 text-xs">{predictions.care_plan_success?.level || 'High'}</Badge>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Risk & Protective Factors */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Key Factors</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-red-700 mb-2">⚠️ Risk Factors:</p>
                    <ul className="space-y-1">
                      {predictions.risk_factors?.map((factor, i) => (
                        <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                          <span className="text-red-500">•</span>
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-green-700 mb-2">✓ Protective Factors:</p>
                    <ul className="space-y-1">
                      {predictions.protective_factors?.map((factor, i) => (
                        <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                          <span className="text-green-500">•</span>
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>

              {/* Timeline Predictions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Expected Outcomes Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Badge className="bg-blue-100 text-blue-800 mt-0.5">7 Days</Badge>
                    <p className="text-xs flex-1">{predictions.timeline_predictions?.seven_days}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-indigo-100 text-indigo-800 mt-0.5">30 Days</Badge>
                    <p className="text-xs flex-1">{predictions.timeline_predictions?.thirty_days}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-purple-100 text-purple-800 mt-0.5">60 Days</Badge>
                    <p className="text-xs flex-1">{predictions.timeline_predictions?.sixty_days}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Intervention Recommendations */}
            <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-blue-600" />
                  Recommended Interventions for {providerType}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {predictions.intervention_recommendations?.map((rec, i) => (
                  <div key={i} className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-1">
                        <Badge className={
                          rec.priority === 'critical' ? 'bg-red-600' :
                          rec.priority === 'high' ? 'bg-orange-500' :
                          'bg-blue-500'
                        }>
                          {rec.priority}
                        </Badge>
                        <p className="font-semibold text-sm">{rec.action}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{rec.timeframe}</Badge>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{rec.rationale}</p>
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="text-xs"
                      onClick={async () => {
                        try {
                          await base44.entities.Task.create({
                            patient_id: patientId,
                            title: rec.action,
                            description: rec.rationale,
                            priority: rec.priority,
                            type: 'clinical',
                            source: 'ai_generated',
                            ai_reason: 'Predictive analytics recommendation',
                            due_timeframe: rec.timeframe === 'Immediate' ? 'today' : 
                                          rec.timeframe.includes('week') ? 'this_week' : '48_hours'
                          });
                          alert('✅ Task created from recommendation');
                        } catch (error) {
                          alert('Failed to create task');
                        }
                      }}
                    >
                      <ArrowRight className="w-3 h-3 mr-1" />
                      Create Task
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Detailed Justifications */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Alert>
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  <p className="font-semibold text-sm mb-1">Readmission Risk Analysis:</p>
                  <p className="text-xs">{predictions.readmission_risk?.justification}</p>
                </AlertDescription>
              </Alert>

              <Alert>
                <TrendingUp className="w-4 h-4" />
                <AlertDescription>
                  <p className="font-semibold text-sm mb-1">Treatment Efficacy Analysis:</p>
                  <p className="text-xs">{predictions.treatment_efficacy?.analysis}</p>
                </AlertDescription>
              </Alert>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}