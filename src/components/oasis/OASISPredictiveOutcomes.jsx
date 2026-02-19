import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  Activity, 
  Heart,
  Clock,
  Target
} from 'lucide-react';

export default function OASISPredictiveOutcomes({ analysis }) {
  if (!analysis?.risk_scores && !analysis?.predicted_outcomes) {
    return null;
  }

  const getRiskLevel = (score) => {
    if (score >= 75) return { label: 'High', color: 'text-red-600', bg: 'bg-red-50' };
    if (score >= 50) return { label: 'Moderate', color: 'text-yellow-600', bg: 'bg-yellow-50' };
    return { label: 'Low', color: 'text-green-600', bg: 'bg-green-50' };
  };

  const getProbabilityColor = (probability) => {
    if (probability >= 0.7) return 'text-red-600';
    if (probability >= 0.4) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="space-y-4">
      {/* Risk Scores */}
      {analysis.risk_scores && (
        <Card className="border-purple-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-purple-600" />
              Predictive Risk Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(analysis.risk_scores).map(([key, score]) => {
              const risk = getRiskLevel(score);
              return (
                <div key={key} className={`p-3 rounded-lg ${risk.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium capitalize">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <Badge variant="outline" className={risk.color}>
                      {risk.label}
                    </Badge>
                  </div>
                  <Progress value={score} className="h-2" />
                  <span className="text-xs text-slate-600 mt-1">
                    Risk Score: {score}%
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Predicted LOS */}
      {analysis.predicted_los && (
        <Card className="border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                <span className="text-sm font-medium">Estimated Length of Service</span>
              </div>
              <span className="text-2xl font-bold text-blue-600">
                {analysis.predicted_los} days
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Predicted Outcomes */}
      {analysis.predicted_outcomes && analysis.predicted_outcomes.length > 0 && (
        <Card className="border-indigo-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-indigo-600" />
              Predicted Patient Outcomes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analysis.predicted_outcomes.map((outcome, idx) => (
              <div key={idx} className="p-3 border border-slate-200 rounded-lg">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-800">
                    {outcome.outcome}
                  </span>
                  <span className={`text-xs font-bold ${getProbabilityColor(outcome.probability)}`}>
                    {Math.round(outcome.probability * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-3 w-3 text-slate-500" />
                  <span className="text-xs text-slate-600">{outcome.timeframe}</span>
                </div>
                {outcome.contributing_factors && outcome.contributing_factors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-slate-700 mb-1">Contributing Factors:</p>
                    <ul className="text-xs text-slate-600 space-y-1">
                      {outcome.contributing_factors.map((factor, fidx) => (
                        <li key={fidx} className="flex items-start gap-1">
                          <span className="text-slate-400">•</span>
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Early Warning Flags */}
      {analysis.early_warning_flags && analysis.early_warning_flags.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Early Warning Indicators
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {analysis.early_warning_flags.map((flag, idx) => (
              <Alert key={idx} className="border-red-200 bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-xs">
                  <div className="font-semibold text-red-900 mb-1">{flag.indicator}</div>
                  <div className="text-red-800">{flag.recommendation}</div>
                </AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}