import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  AlertTriangle, CheckCircle2, XCircle, 
  TrendingUp, Clock, ArrowRight, Loader2 
} from "lucide-react";
import { motion } from "framer-motion";

export default function ProactiveRiskInterventions({ patientId, patientName }) {
  const queryClient = useQueryClient();
  const [runningPrediction, setRunningPrediction] = useState(false);
  const [expandedRisk, setExpandedRisk] = useState(null);

  const { data: activeRisks = [], isLoading } = useQuery({
    queryKey: ['patientActiveRisks', patientId],
    queryFn: () => base44.entities.PatientRiskAssessment.filter({ 
      patient_id: patientId,
      status: 'active'
    }, '-risk_score'),
    enabled: !!patientId,
  });

  const runPredictionMutation = useMutation({
    mutationFn: async () => {
      const { predictPatientRisk } = await import('@/functions/predictPatientRisk');
      return await predictPatientRisk({ patient_id: patientId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientActiveRisks', patientId] });
    }
  });

  const updateRiskStatusMutation = useMutation({
    mutationFn: ({ riskId, status, notes, appliedInterventions }) => 
      base44.entities.PatientRiskAssessment.update(riskId, {
        status,
        outcome_notes: notes,
        interventions_applied: appliedInterventions,
        acknowledged_by: base44.auth.me().then(u => u.email),
        acknowledged_date: new Date().toISOString()
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientActiveRisks', patientId] });
      setExpandedRisk(null);
    }
  });

  const handleRunPrediction = async () => {
    setRunningPrediction(true);
    try {
      await runPredictionMutation.mutateAsync();
    } finally {
      setRunningPrediction(false);
    }
  };

  const getRiskColor = (level) => {
    switch (level) {
      case 'critical': return 'border-red-600 bg-red-50 dark:bg-red-950';
      case 'high': return 'border-orange-500 bg-orange-50 dark:bg-orange-950';
      case 'moderate': return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950';
      case 'low': return 'border-blue-500 bg-blue-50 dark:bg-blue-950';
      default: return 'border-gray-500 bg-gray-50 dark:bg-gray-950';
    }
  };

  const getBadgeColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  return (
    <Card className="border-l-4 border-l-red-600">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            Proactive Risk Predictions
            {activeRisks.length > 0 && (
              <Badge className="bg-red-600">{activeRisks.length}</Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            onClick={handleRunPrediction}
            disabled={runningPrediction}
            variant="outline"
          >
            {runningPrediction ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4 mr-2" />
                Analyze Risks
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : activeRisks.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400 mb-2">No active risk predictions</p>
            <Button
              size="sm"
              onClick={handleRunPrediction}
              disabled={runningPrediction}
            >
              Run Risk Analysis
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {activeRisks.map((risk, idx) => (
              <motion.div
                key={risk.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={`border-2 ${getRiskColor(risk.risk_level)} rounded-lg p-4`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={getBadgeColor(risk.risk_level)}>
                        {risk.risk_level}
                      </Badge>
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {risk.risk_type.replace(/_/g, ' ').toUpperCase()}
                      </h3>
                      <Badge variant="outline" className="text-xs">
                        Score: {risk.risk_score}/100
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Expected: {risk.timeframe || 'Next 7-14 days'}
                    </p>
                  </div>
                </div>

                {/* Contributing Factors */}
                {risk.contributing_factors?.length > 0 && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Contributing Factors:
                    </p>
                    <div className="space-y-1">
                      {risk.contributing_factors.slice(0, 3).map((factor, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-600 mt-1.5 flex-shrink-0" />
                          <p className="text-xs text-gray-700 dark:text-gray-300">
                            <strong>{factor.factor}</strong> - {factor.evidence}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Intervention Suggestions */}
                {risk.intervention_suggestions?.length > 0 && (
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Recommended Interventions:
                    </p>
                    <div className="space-y-2">
                      {risk.intervention_suggestions.map((intervention, i) => (
                        <div key={i} className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {intervention.intervention}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">
                                  {intervention.priority}
                                </Badge>
                                {intervention.evidence_based && (
                                  <Badge className="bg-green-600 text-xs">Evidence-Based</Badge>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                updateRiskStatusMutation.mutate({
                                  riskId: risk.id,
                                  status: 'interventions_applied',
                                  appliedInterventions: [intervention.intervention]
                                });
                              }}
                            >
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 mt-4">
                  <Button
                    size="sm"
                    onClick={() => updateRiskStatusMutation.mutate({
                      riskId: risk.id,
                      status: 'acknowledged'
                    })}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    Acknowledge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateRiskStatusMutation.mutate({
                      riskId: risk.id,
                      status: 'false_positive'
                    })}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Mark False
                  </Button>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                  Predicted on {new Date(risk.prediction_date).toLocaleDateString()} • 
                  Model: {risk.ai_model_version || 'v1.0'}
                </p>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}