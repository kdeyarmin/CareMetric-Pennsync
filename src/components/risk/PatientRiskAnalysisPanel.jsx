import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle, TrendingUp, Activity, RefreshCw, CheckCircle2,
  AlertTriangle, Shield, Users
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function PatientRiskAnalysisPanel({ patientId }) {
  const queryClient = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);

  const { data: analyses = [], isLoading } = useQuery({
    queryKey: ['riskAnalyses', patientId],
    queryFn: () => base44.entities.RiskAnalysis.filter({ patient_id: patientId }, '-analysis_date', 10),
  });

  const latestAnalysis = analyses[0];

  const analyzeRisk = useMutation({
    mutationFn: async () => {
      setAnalyzing(true);
      const response = await base44.functions.invoke('analyzePatientRisk', { patient_id: patientId });
      
      // Save analysis to database
      await base44.entities.RiskAnalysis.create({
        patient_id: patientId,
        analysis_date: response.data.analysis_date,
        overall_risk_score: response.data.overall_risk_score,
        hospitalization_risk: response.data.risk_categories.hospitalization_risk,
        fall_risk: response.data.risk_categories.fall_risk,
        readmission_risk: response.data.risk_categories.readmission_risk,
        overall_summary: response.data.risk_categories.overall_summary,
        priority_actions: response.data.risk_categories.priority_actions,
        analyzed_by: response.data.analyzed_by
      });

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskAnalyses', patientId] });
      setAnalyzing(false);
    },
    onError: () => {
      setAnalyzing(false);
    }
  });

  const getRiskColor = (score) => {
    if (score >= 75) return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' };
    if (score >= 50) return { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' };
    if (score >= 25) return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200' };
    return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' };
  };

  const getRiskLevel = (score) => {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 25) return 'MODERATE';
    return 'LOW';
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-gray-500">
          Loading risk analysis...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              AI Risk Analysis
            </CardTitle>
            <Button
              onClick={() => analyzeRisk.mutate()}
              disabled={analyzing}
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${analyzing ? 'animate-spin' : ''}`} />
              {analyzing ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!latestAnalysis ? (
            <Alert>
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                No risk analysis available yet. Click "Run Analysis" to generate AI-powered risk assessment.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Overall Risk Score */}
              <div className={`p-4 rounded-lg border-2 ${getRiskColor(latestAnalysis.overall_risk_score).bg} ${getRiskColor(latestAnalysis.overall_risk_score).border}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-semibold ${getRiskColor(latestAnalysis.overall_risk_score).text}`}>
                    Overall Risk Score
                  </span>
                  <Badge className={getRiskColor(latestAnalysis.overall_risk_score).bg}>
                    {getRiskLevel(latestAnalysis.overall_risk_score)}
                  </Badge>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-4xl font-bold">
                    {latestAnalysis.overall_risk_score}
                  </div>
                  <Progress value={latestAnalysis.overall_risk_score} className="flex-1 h-3" />
                </div>
                <p className="text-sm mt-2 text-gray-700">
                  {latestAnalysis.overall_summary}
                </p>
              </div>

              {/* Risk Categories */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Hospitalization Risk */}
                <Card className={`border-2 ${getRiskColor(latestAnalysis.hospitalization_risk.score).border}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-5 h-5 text-red-600" />
                      <h4 className="font-semibold text-sm">Hospitalization</h4>
                    </div>
                    <div className="text-3xl font-bold mb-2">
                      {latestAnalysis.hospitalization_risk.score}
                    </div>
                    <Badge className={`${getRiskColor(latestAnalysis.hospitalization_risk.score).bg} text-xs`}>
                      {latestAnalysis.hospitalization_risk.level}
                    </Badge>
                    <p className="text-xs text-gray-600 mt-2">
                      Monitor: {latestAnalysis.hospitalization_risk.monitoring_frequency}
                    </p>
                  </CardContent>
                </Card>

                {/* Fall Risk */}
                <Card className={`border-2 ${getRiskColor(latestAnalysis.fall_risk.score).border}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-5 h-5 text-orange-600" />
                      <h4 className="font-semibold text-sm">Fall Risk</h4>
                    </div>
                    <div className="text-3xl font-bold mb-2">
                      {latestAnalysis.fall_risk.score}
                    </div>
                    <Badge className={`${getRiskColor(latestAnalysis.fall_risk.score).bg} text-xs`}>
                      {latestAnalysis.fall_risk.level}
                    </Badge>
                    <p className="text-xs text-gray-600 mt-2">
                      Monitor: {latestAnalysis.fall_risk.monitoring_frequency}
                    </p>
                  </CardContent>
                </Card>

                {/* Readmission Risk */}
                <Card className={`border-2 ${getRiskColor(latestAnalysis.readmission_risk.score).border}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-5 h-5 text-blue-600" />
                      <h4 className="font-semibold text-sm">Readmission</h4>
                    </div>
                    <div className="text-3xl font-bold mb-2">
                      {latestAnalysis.readmission_risk.score}
                    </div>
                    <Badge className={`${getRiskColor(latestAnalysis.readmission_risk.score).bg} text-xs`}>
                      {latestAnalysis.readmission_risk.level}
                    </Badge>
                    <p className="text-xs text-gray-600 mt-2">
                      Monitor: {latestAnalysis.readmission_risk.monitoring_frequency}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Priority Actions */}
              {latestAnalysis.priority_actions && latestAnalysis.priority_actions.length > 0 && (
                <Alert className="bg-blue-50 border-blue-300">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  <AlertDescription>
                    <p className="font-semibold text-blue-900 mb-2">Priority Actions:</p>
                    <ul className="list-disc ml-4 space-y-1 text-sm text-blue-800">
                      {latestAnalysis.priority_actions.map((action, idx) => (
                        <li key={idx}>{action}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Detailed Interventions */}
              <div className="grid grid-cols-1 gap-3">
                {latestAnalysis.hospitalization_risk.interventions.length > 0 && (
                  <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                    <h4 className="font-semibold text-sm text-red-900 mb-2 flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Hospitalization Prevention
                    </h4>
                    <ul className="text-sm text-red-800 space-y-1">
                      {latestAnalysis.hospitalization_risk.interventions.slice(0, 3).map((int, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-red-600">•</span>
                          <span>{int}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {latestAnalysis.fall_risk.interventions.length > 0 && (
                  <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                    <h4 className="font-semibold text-sm text-orange-900 mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Fall Prevention
                    </h4>
                    <ul className="text-sm text-orange-800 space-y-1">
                      {latestAnalysis.fall_risk.interventions.slice(0, 3).map((int, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-orange-600">•</span>
                          <span>{int}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-500 text-center">
                Last analyzed {formatDistanceToNow(new Date(latestAnalysis.analysis_date), { addSuffix: true })}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}