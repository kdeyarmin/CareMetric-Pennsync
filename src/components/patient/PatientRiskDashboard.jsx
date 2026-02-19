import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  AlertTriangle, 
  Heart,
  Activity,
  TrendingUp,
  Shield
} from 'lucide-react';

export default function PatientRiskDashboard({ patientId }) {
  const { data: riskAnalysis } = useQuery({
    queryKey: ['patient-risk', patientId],
    queryFn: async () => {
      const analyses = await base44.entities.RiskAnalysis.filter({ patient_id: patientId });
      return analyses.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];
    }
  });

  const { data: interventions } = useQuery({
    queryKey: ['patient-interventions', patientId],
    queryFn: () => base44.entities.InterventionLog.filter({ patient_id: patientId })
  });

  const { data: suggestedInterventions } = useQuery({
    queryKey: ['suggested-interventions', patientId],
    queryFn: () => base44.entities.SuggestedIntervention.filter({ 
      patient_id: patientId,
      status: 'pending_review'
    })
  });

  if (!riskAnalysis) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Activity className="h-12 w-12 text-slate-400 mx-auto mb-3" />
          <p className="text-slate-600">No risk analysis available</p>
        </CardContent>
      </Card>
    );
  }

  const getRiskColor = (level) => {
    switch (level) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const riskScores = riskAnalysis.risk_scores || {};

  return (
    <div className="space-y-4">
      {/* Overall Risk */}
      <Card className={`border-2 ${
        riskAnalysis.overall_risk_level === 'high' ? 'border-red-300' :
        riskAnalysis.overall_risk_level === 'medium' ? 'border-yellow-300' : 'border-green-300'
      }`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Overall Risk Assessment
            </CardTitle>
            <Badge className={getRiskColor(riskAnalysis.overall_risk_level)}>
              {riskAnalysis.overall_risk_level} Risk
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center mb-4">
            <p className={`text-5xl font-bold ${
              riskAnalysis.overall_risk_score >= 70 ? 'text-red-600' :
              riskAnalysis.overall_risk_score >= 40 ? 'text-yellow-600' : 'text-green-600'
            }`}>
              {riskAnalysis.overall_risk_score.toFixed(0)}
            </p>
            <p className="text-sm text-slate-600 mt-1">Risk Score (0-100)</p>
          </div>
          
          <Progress 
            value={riskAnalysis.overall_risk_score} 
            className="h-3 mb-4"
          />

          {riskAnalysis.summary && (
            <p className="text-sm text-slate-700">{riskAnalysis.summary}</p>
          )}
        </CardContent>
      </Card>

      {/* Specific Risk Scores */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Risk Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(riskScores).map(([key, score]) => {
            const label = key.replace(/_/g, ' ').replace('risk', '').trim();
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm capitalize">{label}</span>
                  <span className={`text-sm font-bold ${
                    score >= 70 ? 'text-red-600' :
                    score >= 40 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {score.toFixed(0)}%
                  </span>
                </div>
                <Progress value={score} className="h-2" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Suggested Interventions */}
      {suggestedInterventions && suggestedInterventions.length > 0 && (
        <Card className="border-2 border-blue-300">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Heart className="h-4 w-4 text-blue-600" />
              Suggested Interventions ({suggestedInterventions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {suggestedInterventions.slice(0, 3).map(suggestion => (
                <div key={suggestion.id} className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-medium text-sm">{suggestion.suggested_intervention_category}</p>
                    <Badge className={getRiskColor(suggestion.risk_level)}>
                      {suggestion.risk_level} risk
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-700 mb-2">
                    {suggestion.suggested_intervention_description}
                  </p>
                  {suggestion.suggested_expected_outcome && (
                    <p className="text-xs text-slate-600">
                      Expected: {suggestion.suggested_expected_outcome}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Past Interventions */}
      {interventions && interventions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Intervention History ({interventions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {interventions.slice(0, 3).map(intervention => (
                <div key={intervention.id} className="p-2 bg-slate-50 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium">{intervention.intervention_category}</p>
                    {intervention.outcome_status && (
                      <Badge variant="outline" className="text-xs">
                        {intervention.outcome_status}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">
                    {new Date(intervention.intervention_date).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}