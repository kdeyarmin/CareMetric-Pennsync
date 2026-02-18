import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  AlertTriangle, 
  TrendingDown, 
  TrendingUp, 
  Activity,
  Heart,
  Pill,
  Brain,
  Droplet,
  RefreshCw,
  Clock,
  Shield,
  AlertCircle,
  FileText
} from 'lucide-react';
import InterventionLogger from './InterventionLogger';
import InterventionHistory from './InterventionHistory';

export default function PredictiveAnalyticsDashboard({ patientId }) {
  const [predictionHorizon, setPredictionHorizon] = useState(30);
  const [interventionDialogOpen, setInterventionDialogOpen] = useState(false);
  const [selectedPrediction, setSelectedPrediction] = useState(null);

  const { data: predictions, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['predictiveAnalytics', patientId, predictionHorizon],
    queryFn: async () => {
      const response = await base44.functions.invoke('predictiveHealthAnalytics', {
        patient_id: patientId,
        prediction_horizon_days: predictionHorizon
      });
      return response.data;
    },
    enabled: !!patientId,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            <span className="ml-3 text-lg">Analyzing patient data and generating predictions...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!predictions) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Unable to generate predictions. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const getRiskColor = (level) => {
    const colors = {
      low: 'bg-green-100 text-green-800 border-green-300',
      moderate: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      very_high: 'bg-red-100 text-red-800 border-red-300',
      critical: 'bg-red-200 text-red-900 border-red-400'
    };
    return colors[level] || 'bg-gray-100 text-gray-800';
  };

  const getProbabilityColor = (probability) => {
    if (probability >= 70) return 'text-red-600 font-bold';
    if (probability >= 40) return 'text-orange-600 font-semibold';
    if (probability >= 20) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Predictive Health Analytics
              </CardTitle>
              <CardDescription>
                AI-powered predictions for adverse health events over the next {predictionHorizon} days
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={predictionHorizon}
                onChange={(e) => setPredictionHorizon(Number(e.target.value))}
                className="border rounded px-3 py-2"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <Button 
                onClick={() => refetch()} 
                disabled={isFetching}
                size="sm"
                variant="outline"
              >
                {isFetching ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Overall Risk Summary */}
          <div className={`p-4 rounded-lg border-2 ${getRiskColor(predictions.overall_risk_summary?.risk_level)}`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-lg mb-2">Overall Risk Assessment</h3>
                <p className="text-sm mb-3">{predictions.overall_risk_summary?.key_insights}</p>
                <div className="flex flex-wrap gap-2">
                  {predictions.overall_risk_summary?.primary_concerns?.map((concern, idx) => (
                    <Badge key={idx} variant="outline">{concern}</Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {predictions.overall_risk_summary?.trending_direction === 'declining' && (
                  <TrendingDown className="h-6 w-6 text-red-600" />
                )}
                {predictions.overall_risk_summary?.trending_direction === 'improving' && (
                  <TrendingUp className="h-6 w-6 text-green-600" />
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Intervention Logger Dialog */}
      {selectedPrediction && (
        <InterventionLogger
          patientId={patientId}
          predictionType={selectedPrediction.type}
          originalRiskScore={selectedPrediction.score}
          riskAnalysisId={selectedPrediction.riskAnalysisId}
          open={interventionDialogOpen}
          onOpenChange={setInterventionDialogOpen}
        />
      )}

      {/* Tabbed Predictions */}
      <Tabs defaultValue="readmission" className="w-full">
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8">
          <TabsTrigger value="readmission">Readmission</TabsTrigger>
          <TabsTrigger value="falls">Falls</TabsTrigger>
          <TabsTrigger value="disease">Disease</TabsTrigger>
          <TabsTrigger value="medication">Medication</TabsTrigger>
          <TabsTrigger value="functional">Functional</TabsTrigger>
          <TabsTrigger value="pressure">Pressure Injury</TabsTrigger>
          <TabsTrigger value="ed">ED Visits</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>

        {/* Hospital Readmission */}
        <TabsContent value="readmission">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5 text-red-600" />
                  Hospital Readmission Risk
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedPrediction({
                      type: 'hospital_readmission',
                      score: predictions.readmission_prediction?.risk_score,
                      riskAnalysisId: predictions.readmission_prediction?.risk_analysis_id
                    });
                    setInterventionDialogOpen(true);
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Log Intervention
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={`p-4 rounded-lg border-2 ${getRiskColor(predictions.readmission_prediction?.risk_category)}`}>
                  <div className="text-sm font-medium mb-1">Risk Score</div>
                  <div className={`text-3xl font-bold ${getProbabilityColor(predictions.readmission_prediction?.risk_score)}`}>
                    {predictions.readmission_prediction?.risk_score}%
                  </div>
                  <div className="text-xs mt-1">Confidence: {predictions.readmission_prediction?.confidence_level}</div>
                </div>
                <div className="p-4 rounded-lg border bg-white col-span-2">
                  <div className="text-sm font-medium mb-2">Timeframe</div>
                  <div className="text-lg">{predictions.readmission_prediction?.timeframe}</div>
                  <div className="text-sm font-medium mt-3 mb-2">Protective Factors</div>
                  <div className="flex flex-wrap gap-2">
                    {predictions.readmission_prediction?.protective_factors?.map((factor, idx) => (
                      <Badge key={idx} className="bg-green-100 text-green-800">{factor}</Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Contributing Factors</h4>
                <div className="space-y-2">
                  {predictions.readmission_prediction?.contributing_factors?.map((factor, idx) => (
                    <div key={idx} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium flex items-center gap-2">
                            {factor.factor}
                            {!factor.modifiable && <Badge variant="outline" className="text-xs">Non-modifiable</Badge>}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">{factor.evidence}</div>
                        </div>
                        <Badge className={getRiskColor(factor.impact_level)}>
                          {factor.impact_level}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {predictions.readmission_prediction?.early_warning_signs?.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">Early Warning Signs Detected:</div>
                    <ul className="list-disc list-inside space-y-1">
                      {predictions.readmission_prediction.early_warning_signs.map((sign, idx) => (
                        <li key={idx} className="text-sm">{sign}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <h4 className="font-semibold mb-3">Recommended Interventions</h4>
                <div className="space-y-3">
                  {predictions.readmission_prediction?.interventions?.map((intervention, idx) => (
                    <Card key={idx}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="font-medium">{intervention.intervention}</div>
                          <Badge className={
                            intervention.priority === 'immediate' ? 'bg-red-100 text-red-800' :
                            intervention.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                            'bg-yellow-100 text-yellow-800'
                          }>
                            {intervention.priority}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-600 mb-2">
                          Expected Risk Reduction: {intervention.expected_risk_reduction}
                        </div>
                        <div className="text-sm">
                          <div className="font-medium mb-1">Implementation Steps:</div>
                          <ol className="list-decimal list-inside space-y-1">
                            {intervention.implementation_steps?.map((step, stepIdx) => (
                              <li key={stepIdx}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fall Risk */}
        <TabsContent value="falls">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-600" />
                  Fall Risk Prediction
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedPrediction({
                      type: 'fall_risk',
                      score: predictions.fall_risk_prediction?.risk_score,
                      riskAnalysisId: null
                    });
                    setInterventionDialogOpen(true);
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Log Intervention
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-4 rounded-lg border-2 ${getRiskColor(predictions.fall_risk_prediction?.risk_category)}`}>
                  <div className="text-sm font-medium mb-1">Fall Risk Probability</div>
                  <div className={`text-3xl font-bold ${getProbabilityColor(predictions.fall_risk_prediction?.risk_score)}`}>
                    {predictions.fall_risk_prediction?.risk_score}%
                  </div>
                  <div className="text-sm mt-2">
                    Morse Scale Equivalent: {predictions.fall_risk_prediction?.morse_scale_equivalent}
                  </div>
                </div>
                <div className="p-4 rounded-lg border bg-white">
                  <div className="text-sm font-medium mb-2">Fall History</div>
                  <div className="text-sm">{predictions.fall_risk_prediction?.fall_history || 'No documented falls'}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold mb-3">Intrinsic Factors (Patient)</h4>
                  <div className="space-y-2">
                    {predictions.fall_risk_prediction?.intrinsic_factors?.map((factor, idx) => (
                      <div key={idx} className="p-3 border rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium">{factor.factor}</div>
                            <div className="text-sm text-gray-600">{factor.evidence}</div>
                          </div>
                          <Badge className={getRiskColor(factor.severity)}>
                            {factor.severity}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-3">Extrinsic Factors (Environment)</h4>
                  <ul className="list-disc list-inside space-y-2">
                    {predictions.fall_risk_prediction?.extrinsic_factors?.map((factor, idx) => (
                      <li key={idx} className="text-sm">{factor}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Prevention Interventions</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {predictions.fall_risk_prediction?.interventions?.map((intervention, idx) => (
                    <Card key={idx}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="font-medium text-sm">{intervention.intervention}</div>
                          <Badge variant="outline" className="text-xs">{intervention.type}</Badge>
                        </div>
                        <div className="text-xs text-gray-600 mb-1">
                          Expected Impact: {intervention.expected_impact}
                        </div>
                        <Badge className={
                          intervention.priority === 'immediate' ? 'bg-red-100 text-red-800 text-xs' :
                          intervention.priority === 'high' ? 'bg-orange-100 text-orange-800 text-xs' :
                          'bg-yellow-100 text-yellow-800 text-xs'
                        }>
                          {intervention.priority}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Intervention History */}
              <div className="mt-6">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Intervention History
                </h4>
                <InterventionHistory patientId={patientId} predictionType="fall_risk" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Disease Exacerbation */}
        <TabsContent value="disease">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-purple-600" />
                Disease Exacerbation Predictions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {predictions.disease_exacerbation_predictions?.map((disease, idx) => (
                <Card key={idx} className="border-2">
                  <CardHeader className={getRiskColor(disease.risk_level)}>
                    <CardTitle className="text-lg">{disease.condition}</CardTitle>
                    <CardDescription className="text-inherit">
                      Current Status: {disease.current_stability}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm font-medium mb-1">Exacerbation Probability</div>
                        <div className={`text-2xl font-bold ${getProbabilityColor(disease.exacerbation_probability)}`}>
                          {disease.exacerbation_probability}%
                        </div>
                        <div className="text-xs text-gray-600">{disease.timeframe}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-1">Confidence</div>
                        <Badge>{disease.confidence_level}</Badge>
                      </div>
                    </div>

                    {disease.warning_signs_present?.length > 0 && (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <div className="font-semibold mb-1">Warning Signs Present:</div>
                          <ul className="list-disc list-inside text-sm">
                            {disease.warning_signs_present.map((sign, signIdx) => (
                              <li key={signIdx}>{sign}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {disease.triggers_identified?.length > 0 && (
                      <div>
                        <div className="text-sm font-medium mb-2">Identified Triggers:</div>
                        <div className="flex flex-wrap gap-2">
                          {disease.triggers_identified.map((trigger, triggerIdx) => (
                            <Badge key={triggerIdx} variant="outline">{trigger}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-sm font-medium mb-2">Recommended Interventions:</div>
                      <div className="space-y-2">
                        {disease.interventions?.map((intervention, intIdx) => (
                          <div key={intIdx} className="p-2 border rounded text-sm">
                            <div className="font-medium">{intervention.intervention}</div>
                            <div className="text-gray-600">Timing: {intervention.timing}</div>
                            <div className="text-gray-600">Expected Benefit: {intervention.expected_benefit}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Medication Safety */}
        <TabsContent value="medication">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Pill className="h-5 w-5 text-blue-600" />
                Medication-Related Adverse Event Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`p-4 rounded-lg border-2 ${getRiskColor(predictions.medication_adverse_event_risk?.overall_risk)}`}>
                <h4 className="font-semibold mb-2">Overall Medication Risk</h4>
                <div className="text-lg">{predictions.medication_adverse_event_risk?.overall_risk?.toUpperCase()}</div>
                <div className="text-sm mt-2">
                  Polypharmacy Burden: {predictions.medication_adverse_event_risk?.polypharmacy_burden}
                </div>
              </div>

              {predictions.medication_adverse_event_risk?.high_risk_medications?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">High-Risk Medications Requiring Monitoring</h4>
                  <div className="space-y-2">
                    {predictions.medication_adverse_event_risk.high_risk_medications.map((med, idx) => (
                      <Card key={idx}>
                        <CardContent className="p-3">
                          <div className="font-medium mb-1">{med.medication}</div>
                          <div className="text-sm text-gray-600 mb-2">Risk Type: {med.risk_type}</div>
                          <div className="text-sm text-gray-600 mb-2">Probability: {med.probability}</div>
                          <div className="text-sm">
                            <span className="font-medium">Monitoring Plan: </span>
                            {med.monitoring_plan}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {predictions.medication_adverse_event_risk?.adherence_concerns && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Adherence Assessment</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="text-sm font-medium mb-1">Overall Adherence Probability</div>
                      <div className="text-lg">{predictions.medication_adverse_event_risk.adherence_concerns.overall_adherence_probability}</div>
                    </div>
                    {predictions.medication_adverse_event_risk.adherence_concerns.barriers_identified?.length > 0 && (
                      <div>
                        <div className="text-sm font-medium mb-2">Barriers Identified:</div>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {predictions.medication_adverse_event_risk.adherence_concerns.barriers_identified.map((barrier, idx) => (
                            <li key={idx}>{barrier}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {predictions.medication_adverse_event_risk.adherence_concerns.medications_at_risk?.length > 0 && (
                      <div>
                        <div className="text-sm font-medium mb-2">Medications at Risk:</div>
                        <div className="flex flex-wrap gap-2">
                          {predictions.medication_adverse_event_risk.adherence_concerns.medications_at_risk.map((med, idx) => (
                            <Badge key={idx} variant="outline">{med}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Functional Decline */}
        <TabsContent value="functional">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-indigo-600" />
                Functional Decline Prediction
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-4 rounded-lg border-2 ${getRiskColor(predictions.functional_decline_prediction?.risk_level)}`}>
                  <div className="text-sm font-medium mb-1">Decline Probability</div>
                  <div className={`text-3xl font-bold ${getProbabilityColor(predictions.functional_decline_prediction?.decline_probability)}`}>
                    {predictions.functional_decline_prediction?.decline_probability}%
                  </div>
                  <div className="text-sm mt-2">Over {predictions.functional_decline_prediction?.timeframe}</div>
                </div>
                <div className="p-4 rounded-lg border bg-white">
                  <div className="text-sm font-medium mb-2">Current Trajectory</div>
                  <div className="flex items-center gap-2">
                    {predictions.functional_decline_prediction?.current_trajectory === 'declining' && (
                      <TrendingDown className="h-5 w-5 text-red-600" />
                    )}
                    {predictions.functional_decline_prediction?.current_trajectory === 'improving' && (
                      <TrendingUp className="h-5 w-5 text-green-600" />
                    )}
                    <span className="capitalize">{predictions.functional_decline_prediction?.current_trajectory}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Affected Functional Domains</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {predictions.functional_decline_prediction?.affected_domains?.map((domain, idx) => (
                    <Card key={idx}>
                      <CardContent className="p-3">
                        <div className="font-medium capitalize mb-2">{domain.domain}</div>
                        <div className="text-sm text-gray-600 mb-1">
                          Current: {domain.current_status}
                        </div>
                        <div className="text-sm text-gray-600 mb-2">
                          Predicted: {domain.predicted_change}
                        </div>
                        <div className="text-xs text-gray-500">{domain.evidence}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {predictions.functional_decline_prediction?.interventions?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Interventions to Maintain Function</h4>
                  <ul className="list-disc list-inside space-y-2">
                    {predictions.functional_decline_prediction.interventions.map((intervention, idx) => (
                      <li key={idx} className="text-sm">{intervention}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pressure Injury Risk */}
        <TabsContent value="pressure">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Droplet className="h-5 w-5 text-teal-600" />
                Pressure Injury Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`p-4 rounded-lg border-2 ${getRiskColor(predictions.pressure_injury_risk?.risk_category)}`}>
                <div className="text-sm font-medium mb-1">Braden-Like Risk Score</div>
                <div className="text-3xl font-bold">{predictions.pressure_injury_risk?.risk_score}</div>
                <div className="text-sm mt-2">Category: {predictions.pressure_injury_risk?.risk_category}</div>
              </div>

              {predictions.pressure_injury_risk?.current_wounds && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold">Current Wounds:</div>
                    <div className="text-sm mt-1">{predictions.pressure_injury_risk.current_wounds}</div>
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <h4 className="font-semibold mb-3">Risk Factors</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {predictions.pressure_injury_risk?.risk_factors?.map((factor, idx) => (
                    <div key={idx} className="p-3 border rounded-lg">
                      <div className="font-medium">{factor.factor}</div>
                      <div className="text-sm text-gray-600 mt-1">{factor.assessment}</div>
                      <div className="text-xs text-gray-500 mt-1">Score: {factor.score}</div>
                    </div>
                  ))}
                </div>
              </div>

              {predictions.pressure_injury_risk?.prevention_plan?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Prevention Plan</h4>
                  <ul className="list-disc list-inside space-y-2">
                    {predictions.pressure_injury_risk.prevention_plan.map((item, idx) => (
                      <li key={idx} className="text-sm">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ED Visit Prediction */}
        <TabsContent value="ed">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Emergency Department Visit Prediction
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`p-4 rounded-lg border-2 ${getRiskColor(predictions.ed_visit_prediction?.risk_level)}`}>
                <div className="text-sm font-medium mb-1">ED Visit Probability</div>
                <div className={`text-3xl font-bold ${getProbabilityColor(predictions.ed_visit_prediction?.probability)}`}>
                  {predictions.ed_visit_prediction?.probability}%
                </div>
              </div>

              {predictions.ed_visit_prediction?.likely_triggers?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Likely Triggers</h4>
                  <div className="flex flex-wrap gap-2">
                    {predictions.ed_visit_prediction.likely_triggers.map((trigger, idx) => (
                      <Badge key={idx} variant="outline">{trigger}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {predictions.ed_visit_prediction?.prevention_strategies?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3">Prevention Strategies</h4>
                  <ul className="list-disc list-inside space-y-2">
                    {predictions.ed_visit_prediction.prevention_strategies.map((strategy, idx) => (
                      <li key={idx} className="text-sm">{strategy}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monitoring Plan */}
        <TabsContent value="monitoring">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                Recommended Monitoring Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {predictions.recommended_monitoring_plan?.map((item, idx) => (
                <Card key={idx}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-medium">{item.parameter}</div>
                      <Badge variant="outline">{item.frequency}</Badge>
                    </div>
                    <div className="text-sm text-gray-600 mb-2">
                      <span className="font-medium">Alert Thresholds: </span>
                      {item.alert_thresholds}
                    </div>
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Rationale: </span>
                      {item.rationale}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {predictions.care_coordination_priorities?.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-semibold mb-3">Care Coordination Priorities</h4>
                  <div className="space-y-2">
                    {predictions.care_coordination_priorities.map((priority, idx) => (
                      <Card key={idx}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="font-medium">{priority.action}</div>
                            <Badge className={
                              priority.urgency === 'immediate' ? 'bg-red-100 text-red-800' :
                              priority.urgency === 'within_24hrs' ? 'bg-orange-100 text-orange-800' :
                              'bg-yellow-100 text-yellow-800'
                            }>
                              {priority.urgency}
                            </Badge>
                          </div>
                          <div className="text-sm text-gray-600 mb-1">
                            Responsible: {priority.responsible_party}
                          </div>
                          <div className="text-sm text-gray-600">
                            Expected Outcome: {priority.expected_outcome}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Data Quality Footer */}
      {predictions.data_quality_assessment && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-gray-600" />
              <div className="flex-1">
                <div className="text-sm font-medium">Data Quality Assessment</div>
                <div className="text-xs text-gray-600">
                  Completeness: {predictions.data_quality_assessment.overall_completeness} | 
                  Recency: {predictions.data_quality_assessment.data_recency}
                </div>
              </div>
            </div>
            {predictions.data_quality_assessment.gaps_identified?.length > 0 && (
              <div className="mt-3 text-sm">
                <div className="font-medium mb-1">Data Gaps:</div>
                <div className="flex flex-wrap gap-2">
                  {predictions.data_quality_assessment.gaps_identified.map((gap, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">{gap}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}