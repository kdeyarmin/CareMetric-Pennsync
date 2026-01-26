import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle,
  TrendingDown,
  Pill,
  Activity,
  Brain,
  CheckCircle2,
  Loader2,
  Target,
  FileText,
  Shield,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

export default function AIRiskPredictionPanel({ 
  patientId, 
  onRiskCalculated = null,
  autoAnalyze = false 
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [riskData, setRiskData] = useState(null);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('predictPatientRiskComprehensive', {
        patient_id: patientId
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      if (data.success) {
        setRiskData(data.risk_analysis);
        toast.success('Risk analysis complete');
        onRiskCalculated?.(data.risk_analysis);
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    },
    onError: (error) => {
      console.error('Risk analysis error:', error);
      toast.error('Failed to analyze patient risk');
    }
  });

  React.useEffect(() => {
    if (autoAnalyze && !riskData && !analyzing) {
      handleAnalyze();
    }
  }, [autoAnalyze, patientId]);

  const handleAnalyze = () => {
    setAnalyzing(true);
    analyzeMutation.mutate();
    setTimeout(() => setAnalyzing(false), 1000);
  };

  const getRiskColor = (level) => {
    switch (level) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-300';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-300';
      case 'moderate': return 'text-yellow-600 bg-yellow-50 border-yellow-300';
      case 'low': return 'text-green-600 bg-green-50 border-green-300';
      default: return 'text-gray-600 bg-gray-50 border-gray-300';
    }
  };

  const getScoreColor = (score) => {
    if (score >= 76) return 'bg-red-500';
    if (score >= 51) return 'bg-orange-500';
    if (score >= 26) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getPriorityBadge = (priority) => {
    const colors = {
      critical: 'bg-red-600',
      high: 'bg-orange-500',
      medium: 'bg-yellow-500',
      low: 'bg-blue-500'
    };
    return colors[priority] || colors.medium;
  };

  if (!patientId || patientId === 'no_patient') {
    return null;
  }

  return (
    <Card className="border-2 border-red-300 bg-gradient-to-br from-red-50 to-white dark:from-red-950 dark:to-slate-900">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-300" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                AI Risk Prediction
                <Badge variant="outline" className="text-xs">Predictive Analytics</Badge>
              </CardTitle>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Comprehensive risk assessment with proactive interventions
              </p>
            </div>
          </div>
          {!riskData && (
            <Button
              onClick={handleAnalyze}
              disabled={analyzing || analyzeMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {analyzing || analyzeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Analyze Risk
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {!riskData && !analyzing && !analyzeMutation.isPending && (
          <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-300">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900 dark:text-blue-100">
              <p className="font-semibold mb-1">AI-Powered Risk Assessment</p>
              <p className="text-sm">
                Click "Analyze Risk" to generate a comprehensive predictive risk assessment analyzing patient history, visit notes, compliance data, and social determinants to identify risks for readmission, falls, medication non-compliance, and clinical deterioration.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {riskData && (
          <div className="space-y-4">
            {/* Overall Risk Score */}
            <Alert className={`border-2 ${getRiskColor(riskData.overall_risk_level)}`}>
              <AlertTriangle className="w-5 h-5" />
              <AlertDescription>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-bold text-lg">
                      Overall Risk: {riskData.overall_risk_score}/100
                    </p>
                    <p className="text-sm mt-1">
                      Risk Level: <strong className="uppercase">{riskData.overall_risk_level}</strong>
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-xs">
                      <Sparkles className="w-3 h-3" />
                      <span>{riskData.confidence_level}% confidence</span>
                    </div>
                  </div>
                </div>
                <Progress value={riskData.overall_risk_score} className="h-3" />
              </AlertDescription>
            </Alert>

            {/* Risk Category Breakdown */}
            <Tabs defaultValue="readmission" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="readmission" className="text-xs">
                  <Activity className="w-3 h-3 mr-1" />
                  Readmit
                </TabsTrigger>
                <TabsTrigger value="falls" className="text-xs">
                  <TrendingDown className="w-3 h-3 mr-1" />
                  Falls
                </TabsTrigger>
                <TabsTrigger value="meds" className="text-xs">
                  <Pill className="w-3 h-3 mr-1" />
                  Meds
                </TabsTrigger>
                <TabsTrigger value="deterioration" className="text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Clinical
                </TabsTrigger>
              </TabsList>

              {/* Readmission Risk */}
              <TabsContent value="readmission" className="space-y-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold">Readmission Risk</h4>
                      <span className="text-2xl font-bold">{riskData.readmission_risk.score}/100</span>
                    </div>
                    <Progress value={riskData.readmission_risk.score} className={`h-2 ${getScoreColor(riskData.readmission_risk.score)}`} />
                    
                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Contributing Factors:</p>
                      <ul className="space-y-1">
                        {riskData.readmission_risk.contributing_factors?.map((factor, i) => (
                          <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                            <span className="text-red-500">•</span>
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Recommended Interventions:</p>
                      <div className="space-y-2">
                        {riskData.readmission_risk.interventions?.map((intervention, i) => (
                          <div key={i} className="bg-blue-50 dark:bg-blue-950 p-3 rounded border border-blue-200">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-sm font-medium">{intervention.action}</p>
                              <Badge className={getPriorityBadge(intervention.priority)}>
                                {intervention.priority}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <span>👤 {intervention.responsible_role}</span>
                              <span>⏱️ {intervention.timeframe}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {riskData.readmission_risk.documentation_recommendations?.length > 0 && (
                      <div className="mt-4 bg-purple-50 dark:bg-purple-950 p-3 rounded border border-purple-200">
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Documentation Improvements:
                        </p>
                        <ul className="space-y-1">
                          {riskData.readmission_risk.documentation_recommendations.map((rec, i) => (
                            <li key={i} className="text-xs text-purple-900 dark:text-purple-100">
                              • {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Fall Risk */}
              <TabsContent value="falls" className="space-y-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold">Fall Risk</h4>
                      <span className="text-2xl font-bold">{riskData.fall_risk.score}/100</span>
                    </div>
                    <Progress value={riskData.fall_risk.score} className={`h-2 ${getScoreColor(riskData.fall_risk.score)}`} />
                    
                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Contributing Factors:</p>
                      <ul className="space-y-1">
                        {riskData.fall_risk.contributing_factors?.map((factor, i) => (
                          <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                            <span className="text-orange-500">•</span>
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Safety Interventions:</p>
                      <div className="space-y-2">
                        {riskData.fall_risk.interventions?.map((intervention, i) => (
                          <div key={i} className="bg-orange-50 dark:bg-orange-950 p-3 rounded border border-orange-200">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-sm font-medium">{intervention.action}</p>
                              <Badge className={getPriorityBadge(intervention.priority)}>
                                {intervention.priority}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <span>👤 {intervention.responsible_role}</span>
                              <span>⏱️ {intervention.timeframe}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {riskData.fall_risk.documentation_recommendations?.length > 0 && (
                      <div className="mt-4 bg-purple-50 dark:bg-purple-950 p-3 rounded border border-purple-200">
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Documentation Improvements:
                        </p>
                        <ul className="space-y-1">
                          {riskData.fall_risk.documentation_recommendations.map((rec, i) => (
                            <li key={i} className="text-xs text-purple-900 dark:text-purple-100">
                              • {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Medication Compliance Risk */}
              <TabsContent value="meds" className="space-y-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold">Medication Non-Compliance Risk</h4>
                      <span className="text-2xl font-bold">{riskData.medication_compliance_risk.score}/100</span>
                    </div>
                    <Progress value={riskData.medication_compliance_risk.score} className={`h-2 ${getScoreColor(riskData.medication_compliance_risk.score)}`} />
                    
                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Contributing Factors:</p>
                      <ul className="space-y-1">
                        {riskData.medication_compliance_risk.contributing_factors?.map((factor, i) => (
                          <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                            <span className="text-blue-500">•</span>
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Adherence Interventions:</p>
                      <div className="space-y-2">
                        {riskData.medication_compliance_risk.interventions?.map((intervention, i) => (
                          <div key={i} className="bg-blue-50 dark:bg-blue-950 p-3 rounded border border-blue-200">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-sm font-medium">{intervention.action}</p>
                              <Badge className={getPriorityBadge(intervention.priority)}>
                                {intervention.priority}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <span>👤 {intervention.responsible_role}</span>
                              <span>⏱️ {intervention.timeframe}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {riskData.medication_compliance_risk.documentation_recommendations?.length > 0 && (
                      <div className="mt-4 bg-purple-50 dark:bg-purple-950 p-3 rounded border border-purple-200">
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Documentation Improvements:
                        </p>
                        <ul className="space-y-1">
                          {riskData.medication_compliance_risk.documentation_recommendations.map((rec, i) => (
                            <li key={i} className="text-xs text-purple-900 dark:text-purple-100">
                              • {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Clinical Deterioration Risk */}
              <TabsContent value="deterioration" className="space-y-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold">Clinical Deterioration Risk</h4>
                      <span className="text-2xl font-bold">{riskData.clinical_deterioration_risk.score}/100</span>
                    </div>
                    <Progress value={riskData.clinical_deterioration_risk.score} className={`h-2 ${getScoreColor(riskData.clinical_deterioration_risk.score)}`} />
                    
                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Contributing Factors:</p>
                      <ul className="space-y-1">
                        {riskData.clinical_deterioration_risk.contributing_factors?.map((factor, i) => (
                          <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                            <span className="text-red-500">•</span>
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold mb-2">Clinical Interventions:</p>
                      <div className="space-y-2">
                        {riskData.clinical_deterioration_risk.interventions?.map((intervention, i) => (
                          <div key={i} className="bg-red-50 dark:bg-red-950 p-3 rounded border border-red-200">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-sm font-medium">{intervention.action}</p>
                              <Badge className={getPriorityBadge(intervention.priority)}>
                                {intervention.priority}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <span>👤 {intervention.responsible_role}</span>
                              <span>⏱️ {intervention.timeframe}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {riskData.clinical_deterioration_risk.documentation_recommendations?.length > 0 && (
                      <div className="mt-4 bg-purple-50 dark:bg-purple-950 p-3 rounded border border-purple-200">
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Documentation Improvements:
                        </p>
                        <ul className="space-y-1">
                          {riskData.clinical_deterioration_risk.documentation_recommendations.map((rec, i) => (
                            <li key={i} className="text-xs text-purple-900 dark:text-purple-100">
                              • {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Critical Interventions Summary */}
            {riskData.critical_interventions?.length > 0 && (
              <Card className="border-2 border-red-500 bg-red-50 dark:bg-red-950">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="w-4 h-4 text-red-600" />
                    Critical Actions Required
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {riskData.critical_interventions.map((intervention, i) => (
                      <div key={i} className="bg-white dark:bg-slate-900 p-3 rounded border border-red-300">
                        <div className="flex items-start gap-2 mb-2">
                          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{intervention.intervention}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{intervention.rationale}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t">
                          <span className="text-gray-600 dark:text-gray-400">⏱️ {intervention.timeline}</span>
                          <span className="text-green-600 font-medium">Impact: {intervention.expected_impact}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Care Plan Adjustments */}
            {riskData.recommended_care_plan_adjustments?.length > 0 && (
              <Card className="border-teal-200 bg-teal-50 dark:bg-teal-950">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="w-4 h-4 text-teal-600" />
                    Recommended Care Plan Adjustments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {riskData.recommended_care_plan_adjustments.map((adjustment, i) => (
                      <li key={i} className="flex items-start gap-2 p-2 bg-white dark:bg-slate-900 rounded border border-teal-200">
                        <ArrowRight className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{adjustment}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Monitoring Recommendations */}
            {riskData.monitoring_recommendations?.length > 0 && (
              <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" />
                    Enhanced Monitoring Plan
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {riskData.monitoring_recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2 p-2 bg-white dark:bg-slate-900 rounded border border-blue-200">
                        <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Re-analyze Button */}
            <Button
              onClick={handleAnalyze}
              variant="outline"
              className="w-full"
              disabled={analyzing || analyzeMutation.isPending}
            >
              {analyzing || analyzeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Re-analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Re-analyze Risk
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}