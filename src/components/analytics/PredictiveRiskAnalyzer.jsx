import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  Loader2,
  AlertTriangle,
  TrendingUp,
  Activity,
  Heart,
  ClipboardList,
  CheckCircle2,
  XCircle
} from "lucide-react";

export default function PredictiveRiskAnalyzer({ patientId, _patientName, onAlertsCreated, autoAnalyze = false }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);

  const runAnalysis = useCallback(async () => {
    if (!patientId) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const result = await base44.functions.invoke('predictiveRiskAnalysis', {
        patient_id: patientId
      });
      // functions.invoke returns the axios response; the body is on .data.
      const data = result.data;

      if (data.success) {
        setAnalysis(data);
        if (onAlertsCreated && data.alerts_created > 0) {
          onAlertsCreated(data.alerts_created);
        }
      } else {
        setError(data.error || 'Analysis failed');
      }
    } catch (err) {
      console.error('Risk analysis error:', err);
      setError('Failed to analyze patient risk. Please try again.');
    }

    setIsAnalyzing(false);
  }, [patientId, onAlertsCreated]);

  React.useEffect(() => {
    if (autoAnalyze && patientId && !analysis) {
      runAnalysis();
    }
  }, [autoAnalyze, patientId, analysis, runAnalysis]);

  const getRiskColor = (score) => {
    if (score >= 75) return 'bg-red-500';
    if (score >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getRiskLabel = (score) => {
    if (score >= 75) return 'High Risk';
    if (score >= 50) return 'Moderate Risk';
    return 'Low Risk';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || colors.medium;
  };

  const riskIcons = {
    readmission_risk: <Activity className="w-5 h-5" />,
    fall_risk: <AlertTriangle className="w-5 h-5" />,
    adverse_event_risk: <Heart className="w-5 h-5" />,
    medication_safety_risk: <ClipboardList className="w-5 h-5" />,
    functional_decline_risk: <TrendingUp className="w-5 h-5" />
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-r from-navy-50 to-gold-50">
      <CardHeader className="py-4 bg-gradient-to-r from-navy-100 to-gold-100">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="w-5 h-5 text-navy-600" />
          AI Predictive Risk Analysis
          {analysis && (
            <Badge className="bg-navy-600 text-white ml-auto">
              {analysis.overall_risk_level}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!analysis && !isAnalyzing && (
          <div className="text-center py-6">
            <Brain className="w-12 h-12 mx-auto mb-3 text-navy-400" />
            <p className="text-sm text-slate-600 mb-3">
              Analyze patient data to predict risk of adverse events
            </p>
            <Button
              onClick={runAnalysis}
              className="bg-navy-600 hover:bg-navy-700"
            >
              <Brain className="w-4 h-4 mr-2" />
              Run Risk Analysis
            </Button>
          </div>
        )}

        {isAnalyzing && (
          <div className="text-center py-6">
            <Loader2 className="w-10 h-10 animate-spin mx-auto mb-3 text-navy-600" />
            <p className="text-sm text-slate-600">Analyzing patient data...</p>
            <p className="text-xs text-slate-500 mt-1">
              Evaluating vitals, diagnoses, social factors, and visit history
            </p>
          </div>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <XCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {analysis && (
          <div className="space-y-4">
            {/* Summary */}
            <Alert className={analysis.overall_risk_level === 'HIGH' || analysis.overall_risk_level === 'CRITICAL' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}>
              <AlertDescription className="text-sm">
                <strong>Summary:</strong> {analysis.summary}
              </AlertDescription>
            </Alert>

            {/* Risk Scores */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-slate-900">Risk Scores</h4>
              {Object.entries(analysis.risk_scores || {}).map(([key, score]) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {riskIcons[key]}
                      <span className="font-medium">
                        {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </div>
                    <span className="font-bold">{score}/100</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={score} className="flex-1 h-2" />
                    <Badge className={`${getRiskColor(score)} text-white text-xs`}>
                      {getRiskLabel(score)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* High Risk Alerts */}
            {analysis.high_risk_alerts?.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">High Risk Alerts</h4>
                  <Badge className="bg-red-100 text-red-800">
                    {analysis.high_risk_alerts.length} Alert{analysis.high_risk_alerts.length !== 1 ? 's' : ''}
                  </Badge>
                </div>

                {analysis.high_risk_alerts.map((alert, idx) => (
                  <Card key={idx} className={`border-l-4 ${getSeverityColor(alert.severity)}`}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={`w-4 h-4 ${alert.severity === 'critical' ? 'text-red-600' : 'text-orange-600'}`} />
                          <h5 className="text-sm font-bold">{alert.title}</h5>
                        </div>
                        <Badge className={getSeverityColor(alert.severity)}>
                          {alert.severity}
                        </Badge>
                      </div>

                      <p className="text-xs text-slate-700">{alert.message}</p>

                      {alert.contributing_factors?.length > 0 && (
                        <div className="bg-white/50 p-2 rounded">
                          <p className="text-xs font-semibold text-slate-900 mb-1">Contributing Factors:</p>
                          <ul className="text-xs text-slate-700 space-y-0.5">
                            {alert.contributing_factors.map((factor, i) => (
                              <li key={i}>• {factor}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {alert.recommended_actions?.length > 0 && (
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-900 mb-1">Recommended Actions:</p>
                          <ul className="text-xs text-green-800 space-y-0.5">
                            {alert.recommended_actions.map((action, i) => (
                              <li key={i}>✓ {action}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {alert.care_adjustments?.length > 0 && (
                        <div className="bg-blue-50 p-2 rounded border border-blue-200">
                          <p className="text-xs font-semibold text-blue-900 mb-1">Care Plan Adjustments:</p>
                          <ul className="text-xs text-blue-800 space-y-0.5">
                            {alert.care_adjustments.map((adjustment, i) => (
                              <li key={i}>• {adjustment}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {alert.reassessment_timeframe && (
                        <p className="text-xs text-slate-500 italic">
                          Reassess: {alert.reassessment_timeframe}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Alerts Created Notice */}
            {analysis.alerts_created > 0 && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-sm text-green-800">
                  {analysis.alerts_created} patient alert{analysis.alerts_created !== 1 ? 's' : ''} created and added to patient record
                </AlertDescription>
              </Alert>
            )}

            {/* Re-analyze button */}
            <Button
              onClick={runAnalysis}
              variant="outline"
              size="sm"
              className="w-full"
              disabled={isAnalyzing}
            >
              <Brain className="w-4 h-4 mr-2" />
              Re-analyze Risk
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}