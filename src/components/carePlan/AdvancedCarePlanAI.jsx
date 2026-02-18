import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Brain, Sparkles, TrendingUp, AlertCircle, CheckCircle, 
  Target, Clock, Lightbulb, Activity, BarChart3, Plus, Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function AdvancedCarePlanAI({ patientId, patientName, onCarePlanCreated }) {
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('advancedCarePlanAI', { patient_id: patientId });
      return response;
    },
    onSuccess: (data) => {
      setAnalysis(data.analysis);
      toast.success('AI analysis complete');
    },
    onError: (error) => {
      toast.error(`Analysis failed: ${error.message}`);
    }
  });

  const createCarePlanMutation = useMutation({
    mutationFn: async (planData) => {
      return await base44.entities.CarePlan.create({
        patient_id: patientId,
        ...planData,
        status: 'active'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientCarePlans', patientId] });
      toast.success('Care plan created');
      if (onCarePlanCreated) onCarePlanCreated();
    }
  });

  const handleAnalyze = () => {
    setAnalyzing(true);
    analyzeMutation.mutate();
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      moderate: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || colors.moderate;
  };

  const getAdherenceColor = (percentage) => {
    if (percentage >= 80) return 'text-green-600';
    if (percentage >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const handleQuickAdd = (suggestion) => {
    createCarePlanMutation.mutate({
      problem: suggestion.problem,
      goal: suggestion.goal,
      interventions: suggestion.interventions,
      frequency: suggestion.frequency,
      target_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
  };

  return (
    <Card className="border-2 border-purple-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Brain className="w-6 h-6 text-purple-600" />
              Advanced Care Plan AI
            </CardTitle>
            <CardDescription>
              Proactive gap analysis, evidence-based interventions, and adherence prediction
            </CardDescription>
          </div>
          <Button 
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Run AI Analysis
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {analysis && (
        <CardContent>
          {/* Overall Assessment */}
          <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border-2 border-purple-200">
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              Overall Assessment
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-white p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Completeness</p>
                <p className="text-2xl font-bold text-purple-600">
                  {analysis.overall_assessment?.care_plan_completeness_score || 0}%
                </p>
              </div>
              <div className="bg-white p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Adherence Risk</p>
                <Badge className={getSeverityColor(analysis.overall_assessment?.adherence_risk_level || 'moderate')}>
                  {analysis.overall_assessment?.adherence_risk_level || 'Moderate'}
                </Badge>
              </div>
              <div className="bg-white p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Gaps Identified</p>
                <p className="text-2xl font-bold text-orange-600">{analysis.gap_analysis?.length || 0}</p>
              </div>
              <div className="bg-white p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Suggestions</p>
                <p className="text-2xl font-bold text-green-600">{analysis.suggested_care_plans?.length || 0}</p>
              </div>
            </div>

            {analysis.overall_assessment?.key_concerns?.length > 0 && (
              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <p className="font-semibold text-sm text-red-900 mb-2">🚨 Key Concerns:</p>
                <ul className="space-y-1">
                  {analysis.overall_assessment.key_concerns.map((concern, idx) => (
                    <li key={idx} className="text-sm text-red-800">• {concern}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.overall_assessment?.immediate_actions?.length > 0 && (
              <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 mt-3">
                <p className="font-semibold text-sm text-yellow-900 mb-2">⚡ Immediate Actions Required:</p>
                <ul className="space-y-1">
                  {analysis.overall_assessment.immediate_actions.map((action, idx) => (
                    <li key={idx} className="text-sm text-yellow-800">• {action}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <Tabs defaultValue="gaps" className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="gaps">
                Gaps ({analysis.gap_analysis?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="suggestions">
                Suggestions ({analysis.suggested_care_plans?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="optimizations">
                Optimizations ({analysis.existing_plan_optimizations?.length || 0})
              </TabsTrigger>
            </TabsList>

            {/* Gap Analysis Tab */}
            <TabsContent value="gaps" className="space-y-3">
              {!analysis.gap_analysis || analysis.gap_analysis.length === 0 ? (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <AlertDescription>
                    No significant care plan gaps identified. Current care plans appear comprehensive.
                  </AlertDescription>
                </Alert>
              ) : (
                analysis.gap_analysis.map((gap, idx) => (
                  <Card key={idx} className={`border-l-4 ${getSeverityColor(gap.severity)}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <Badge className={getSeverityColor(gap.severity)} variant="outline">
                            {gap.severity} Priority
                          </Badge>
                          <h4 className="font-semibold text-gray-900 mt-2">{gap.gap_type}</h4>
                          {gap.diagnosis_related && (
                            <p className="text-xs text-gray-600">Related to: {gap.diagnosis_related}</p>
                          )}
                        </div>
                        <AlertCircle className="w-5 h-5 text-orange-600" />
                      </div>
                      <p className="text-sm text-gray-700 mb-3">{gap.description}</p>
                      <div className="bg-gray-50 p-3 rounded-lg space-y-2">
                        <div>
                          <p className="text-xs font-semibold text-gray-600">Clinical Rationale:</p>
                          <p className="text-sm text-gray-700">{gap.clinical_rationale}</p>
                        </div>
                        {gap.evidence_base && (
                          <div>
                            <p className="text-xs font-semibold text-gray-600">Evidence Base:</p>
                            <p className="text-sm text-gray-700">{gap.evidence_base}</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Suggested Care Plans Tab */}
            <TabsContent value="suggestions" className="space-y-4">
              {analysis.suggested_care_plans?.map((suggestion, idx) => (
                <Card key={idx} className="border-2 border-blue-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={getSeverityColor(suggestion.priority)}>
                            {suggestion.priority} Priority
                          </Badge>
                          {suggestion.adherence_prediction && (
                            <Badge variant="outline" className="bg-white">
                              <Activity className="w-3 h-3 mr-1" />
                              {suggestion.adherence_prediction.probability_percentage}% Adherence
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-bold text-gray-900 text-lg">{suggestion.problem}</h4>
                        <p className="text-sm text-blue-600 mt-1">🎯 Goal: {suggestion.goal}</p>
                      </div>
                      <Button 
                        size="sm"
                        onClick={() => handleQuickAdd(suggestion)}
                        disabled={createCarePlanMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-1">Interventions:</p>
                        <ul className="space-y-1">
                          {suggestion.interventions?.map((intervention, i) => (
                            <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                              {intervention}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="grid md:grid-cols-2 gap-3">
                        <div className="bg-blue-50 p-3 rounded-lg">
                          <p className="text-xs font-semibold text-blue-900 mb-1">📊 Monitoring:</p>
                          <ul className="space-y-1">
                            {suggestion.monitoring_parameters?.map((param, i) => (
                              <li key={i} className="text-xs text-blue-800">• {param}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="bg-green-50 p-3 rounded-lg">
                          <p className="text-xs font-semibold text-green-900 mb-1">🎯 Expected Outcomes:</p>
                          <p className="text-xs text-green-800">{suggestion.expected_outcomes}</p>
                        </div>
                      </div>

                      <div className="bg-purple-50 p-3 rounded-lg">
                        <p className="text-xs font-semibold text-purple-900 mb-1">📋 Clinical Rationale:</p>
                        <p className="text-xs text-purple-800">{suggestion.rationale}</p>
                      </div>

                      <div className="bg-gray-50 p-3 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="w-4 h-4 text-gray-600" />
                          <p className="text-xs font-semibold text-gray-700">Implementation Details:</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="font-medium">Frequency:</span> {suggestion.frequency}
                          </div>
                          <div>
                            <span className="font-medium">Timeframe:</span> {suggestion.target_timeframe}
                          </div>
                        </div>
                      </div>

                      {/* Adherence Prediction */}
                      {suggestion.adherence_prediction && (
                        <div className="bg-white border-2 border-purple-200 p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-3">
                            <TrendingUp className="w-5 h-5 text-purple-600" />
                            <h5 className="font-semibold text-gray-900">Adherence Prediction</h5>
                          </div>
                          
                          <div className="mb-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-600">Predicted Adherence</span>
                              <span className={`text-2xl font-bold ${getAdherenceColor(suggestion.adherence_prediction.probability_percentage)}`}>
                                {suggestion.adherence_prediction.probability_percentage}%
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div 
                                className={`h-2 rounded-full ${
                                  suggestion.adherence_prediction.probability_percentage >= 80 ? 'bg-green-600' :
                                  suggestion.adherence_prediction.probability_percentage >= 60 ? 'bg-yellow-600' : 'bg-red-600'
                                }`}
                                style={{ width: `${suggestion.adherence_prediction.probability_percentage}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-600 mt-1">
                              Confidence: {suggestion.adherence_prediction.confidence_level}
                            </p>
                          </div>

                          <div className="grid md:grid-cols-2 gap-3">
                            {suggestion.adherence_prediction.facilitating_factors?.length > 0 && (
                              <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                                <p className="text-xs font-semibold text-green-900 mb-1">✅ Facilitating Factors:</p>
                                <ul className="space-y-1">
                                  {suggestion.adherence_prediction.facilitating_factors.map((factor, i) => (
                                    <li key={i} className="text-xs text-green-800">• {factor}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {suggestion.adherence_prediction.barriers?.length > 0 && (
                              <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                                <p className="text-xs font-semibold text-red-900 mb-1">⚠️ Barriers:</p>
                                <ul className="space-y-1">
                                  {suggestion.adherence_prediction.barriers.map((barrier, i) => (
                                    <li key={i} className="text-xs text-red-800">• {barrier}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {suggestion.adherence_prediction.adherence_strategies?.length > 0 && (
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mt-3">
                              <p className="text-xs font-semibold text-blue-900 mb-1">💡 Strategies to Improve Adherence:</p>
                              <ul className="space-y-1">
                                {suggestion.adherence_prediction.adherence_strategies.map((strategy, i) => (
                                  <li key={i} className="text-xs text-blue-800">• {strategy}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
              )}
            </TabsContent>

            {/* Existing Plan Optimizations Tab */}
            <TabsContent value="optimizations" className="space-y-3">
              {!analysis.existing_plan_optimizations || analysis.existing_plan_optimizations.length === 0 ? (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <AlertDescription>
                    Current care plans are optimized. No modifications recommended at this time.
                  </AlertDescription>
                </Alert>
              ) : (
                analysis.existing_plan_optimizations.map((optimization, idx) => (
                  <Card key={idx} className="border-l-4 border-l-indigo-600">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <Lightbulb className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-1" />
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900">{optimization.current_problem}</h4>
                          <Badge variant="outline" className="mt-1">Existing Care Plan</Badge>
                        </div>
                      </div>

                      <div className="bg-indigo-50 p-3 rounded-lg mb-3">
                        <p className="text-xs font-semibold text-indigo-900 mb-2">📝 Suggested Modifications:</p>
                        <ul className="space-y-1">
                          {optimization.suggested_modifications?.map((mod, i) => (
                            <li key={i} className="text-sm text-indigo-800">• {mod}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <p className="text-xs font-semibold text-gray-600">Rationale:</p>
                          <p className="text-sm text-gray-700">{optimization.rationale}</p>
                        </div>
                        <div className="bg-green-50 p-2 rounded">
                          <p className="text-xs font-semibold text-green-900">Expected Improvement:</p>
                          <p className="text-sm text-green-800">{optimization.expected_improvement}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-gray-700">
              <strong>💡 Pro Tip:</strong> Review AI suggestions with your clinical judgment. 
              These recommendations are based on evidence-based practices but should be tailored to individual patient needs.
            </p>
          </div>
        </CardContent>
      )}

      {!analysis && !analyzeMutation.isPending && (
        <CardContent>
          <div className="text-center py-12">
            <Brain className="w-16 h-16 text-purple-300 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">
              Click "Run AI Analysis" to identify care plan gaps and get evidence-based recommendations
            </p>
            <div className="bg-purple-50 p-4 rounded-lg max-w-md mx-auto">
              <p className="text-sm font-semibold text-purple-900 mb-2">AI Will Analyze:</p>
              <ul className="text-sm text-purple-800 space-y-1">
                <li>• Current vs. recommended care plans</li>
                <li>• Risk factors requiring intervention</li>
                <li>• Patient adherence likelihood</li>
                <li>• Evidence-based best practices</li>
              </ul>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}