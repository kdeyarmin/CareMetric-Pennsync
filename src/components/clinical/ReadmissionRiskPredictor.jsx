import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Loader2, TrendingUp, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ReadmissionRiskPredictor({ patient, onInterventionSelected }) {
  const [prediction, setPrediction] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handlePredictRisk = async () => {
    if (!patient?.id) {
      toast.error('Patient data required');
      return;
    }

    setIsLoading(true);
    try {
      const patientData = {
        age: calculateAge(patient.date_of_birth),
        primaryDiagnosis: patient.primary_diagnosis || 'Unknown',
        hospitalizationCount: patient.past_hospitalizations?.length || 0,
        functionalStatus: patient.functional_status?.adl_independence || 'Unknown',
        cognitiveStatus: patient.functional_status?.cognitive_status || 'Unknown',
        fallRisk: patient.functional_status?.fall_risk || 'Unknown',
        mentalHealth: patient.mental_health?.depression_screening || 'Not screened',
        livingSituation: patient.social_history?.living_situation || 'Unknown',
        caregiverSupport: patient.caregiver_name ? 'Yes' : 'No',
        transportation: patient.social_history?.transportation || 'Unknown',
        medicationCount: patient.current_medications?.length || 0,
        vitalChanges: 'See recent visits'
      };

      const response = await base44.functions.invoke('aiClinicalDecisionSupport', {
        action: 'predictReadmissionRisk',
        patientData
      });

      setPrediction(response.data);
      toast.success('Risk analysis complete');
    } catch (error) {
      toast.error('Failed to predict readmission risk');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateAge = (dob) => {
    if (!dob) return 'Unknown';
    const today = new Date();
    const birthDate = new Date(dob);
    return Math.floor((today - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
  };

  const getRiskColor = (level) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      moderate: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-green-100 text-green-800 border-green-300'
    };
    return colors[level?.toLowerCase()] || colors.moderate;
  };

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="w-5 h-5 text-purple-600" />
          Readmission Risk Assessment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={handlePredictRisk}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing patient data...
            </>
          ) : (
            'Predict Readmission Risk'
          )}
        </Button>

        {prediction && (
          <div className="space-y-4">
            {/* Risk Score */}
            <div className={`rounded-lg p-4 border-2 ${getRiskColor(prediction.riskLevel)}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-lg">Risk Score</h3>
                <Badge className={getRiskColor(prediction.riskLevel)}>
                  {prediction.riskLevel?.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      prediction.riskScore >= 70
                        ? 'bg-red-500'
                        : prediction.riskScore >= 50
                        ? 'bg-orange-500'
                        : 'bg-green-500'
                    }`}
                    style={{ width: `${prediction.riskScore}%` }}
                  />
                </div>
                <span className="text-2xl font-bold">{prediction.riskScore}%</span>
              </div>
            </div>

            {/* Risk Factors */}
            <div>
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600" />
                Key Risk Factors
              </h4>
              <div className="space-y-2">
                {prediction.keyRiskFactors?.map((factor, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm bg-red-50 p-2 rounded">
                    <span className="text-red-600 font-bold">•</span>
                    <span>{factor}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Protective Factors */}
            {prediction.protectiveFactors?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Protective Factors
                </h4>
                <div className="space-y-2">
                  {prediction.protectiveFactors.map((factor, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm bg-green-50 p-2 rounded">
                      <span className="text-green-600 font-bold">✓</span>
                      <span>{factor}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Interventions */}
            {prediction.interventions?.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-3">Recommended Interventions</h3>
                <div className="space-y-2">
                  {prediction.interventions.map((intervention, idx) => (
                    <div
                      key={idx}
                      className="border rounded-lg p-3 space-y-2 hover:bg-gray-50 cursor-pointer"
                      onClick={() => onInterventionSelected && onInterventionSelected(intervention)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm">{intervention.intervention}</p>
                        <Badge variant="outline" className="text-xs">
                          {intervention.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold">Impact:</span> {intervention.expectedImpact}
                      </p>
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold">Owner:</span> {intervention.responsibleTeam}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Monitoring Plan */}
            {prediction.monitoringPlan && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <h4 className="font-semibold text-sm mb-2">Monitoring Plan</h4>
                <p className="text-sm text-gray-700">{prediction.monitoringPlan}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}