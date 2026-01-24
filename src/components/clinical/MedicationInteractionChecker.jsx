import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Pill, AlertTriangle, Loader2, Shield, Activity, CheckCircle2 } from "lucide-react";
import { getPrompt, trackPromptUsage } from "../utils/aiPrompts";

export default function MedicationInteractionChecker({ patient }) {
  const [isChecking, setIsChecking] = useState(false);
  const [interactions, setInteractions] = useState(null);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(true);

  useEffect(() => {
    if (autoCheckEnabled && patient?.current_medications?.length > 0) {
      checkInteractions();
    }
  }, [patient?.current_medications, autoCheckEnabled]);

  const checkInteractions = async () => {
    if (!patient?.current_medications || patient.current_medications.length === 0) {
      return;
    }

    setIsChecking(true);
    const startTime = Date.now();

    try {
      const medications = patient.current_medications.map(med => ({
        name: med.name,
        dosage: med.dosage,
        frequency: med.frequency
      }));

      const conditions = [
        patient.primary_diagnosis,
        ...(patient.secondary_diagnoses || []),
        ...(patient.chronic_conditions?.map(c => c.condition) || [])
      ].filter(Boolean);

      const { prompt, schema, version } = getPrompt(
        'MEDICATION_INTERACTION_CHECK',
        medications,
        patient.allergies || "None reported",
        conditions
      );

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: schema
      });

      setInteractions(response);

      const responseTime = Date.now() - startTime;
      trackPromptUsage('MEDICATION_INTERACTION_CHECK', version, true, responseTime);
    } catch (error) {
      console.error('Error checking medication interactions:', error);
      alert('Failed to check medication interactions. Please try again.');

      const responseTime = Date.now() - startTime;
      trackPromptUsage('MEDICATION_INTERACTION_CHECK', version, false, responseTime);
    }

    setIsChecking(false);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white border-red-600';
      case 'severe': return 'bg-orange-500 text-white border-orange-500';
      case 'moderate': return 'bg-yellow-500 text-white border-yellow-500';
      default: return 'bg-blue-500 text-white border-blue-500';
    }
  };

  const getRiskColor = (risk) => {
    switch (risk) {
      case 'critical': return 'border-red-500 bg-red-50';
      case 'high': return 'border-orange-500 bg-orange-50';
      case 'moderate': return 'border-yellow-500 bg-yellow-50';
      default: return 'border-green-500 bg-green-50';
    }
  };

  if (!patient?.current_medications || patient.current_medications.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pill className="w-5 h-5 text-blue-600" />
            Medication Interaction Checker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <Pill className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p>No medications documented</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={interactions ? `border-2 ${getRiskColor(interactions.overall_risk_level)}` : ''}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Pill className="w-5 h-5 text-blue-600" />
            Medication Interaction Checker
          </div>
          {interactions && (
            <Badge className={getSeverityColor(interactions.overall_risk_level)}>
              {interactions.overall_risk_level.toUpperCase()} RISK
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Analyzing {patient.current_medications.length} medications
          </p>
          <Button
            onClick={checkInteractions}
            disabled={isChecking}
            size="sm"
            variant="outline"
          >
            {isChecking ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking...</>
            ) : (
              <><Shield className="w-4 h-4 mr-2" /> Check Now</>
            )}
          </Button>
        </div>

        {interactions && (
          <div className="space-y-4">
            {/* Drug-Drug Interactions */}
            {interactions.interactions?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Drug-Drug Interactions ({interactions.interactions.length})
                </h3>
                <div className="space-y-3">
                  {interactions.interactions.map((interaction, idx) => (
                    <Card key={idx} className={`border-l-4 ${getSeverityColor(interaction.severity).replace('text-white', 'border-l')}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <p className="font-semibold text-gray-900">
                              {interaction.drugs.join(' + ')}
                            </p>
                          </div>
                          <Badge className={getSeverityColor(interaction.severity)}>
                            {interaction.severity}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-700 mb-2">
                          <span className="font-medium">Mechanism:</span> {interaction.mechanism}
                        </p>
                        <p className="text-sm text-gray-700 mb-2">
                          <span className="font-medium">Clinical Effects:</span> {interaction.clinical_effects}
                        </p>
                        <Alert className="bg-blue-50 border-blue-200 mt-2">
                          <Activity className="w-4 h-4 text-blue-600" />
                          <AlertDescription className="text-blue-900 text-sm">
                            <span className="font-semibold">Management:</span> {interaction.management}
                          </AlertDescription>
                        </Alert>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Contraindications */}
            {interactions.contraindications?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-orange-600" />
                  Contraindications ({interactions.contraindications.length})
                </h3>
                <div className="space-y-2">
                  {interactions.contraindications.map((contra, idx) => (
                    <Alert key={idx} className="bg-orange-50 border-orange-200">
                      <AlertTriangle className="w-4 h-4 text-orange-600" />
                      <AlertDescription className="text-orange-900 text-sm">
                        <p className="font-semibold">{contra.medication}</p>
                        <p>{contra.reason} ({contra.type})</p>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {interactions.recommendations?.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Safer Alternatives
                </h3>
                <div className="space-y-2">
                  {interactions.recommendations.map((rec, idx) => (
                    <Card key={idx} className="border-l-4 border-l-green-500">
                      <CardContent className="p-3">
                        <p className="text-sm mb-1">
                          <span className="font-medium">Consider replacing:</span> {rec.current_medication}
                        </p>
                        <p className="text-sm mb-1">
                          <span className="font-medium">With:</span> {rec.alternative}
                        </p>
                        <p className="text-sm text-gray-600">{rec.rationale}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Monitoring Parameters */}
            {interactions.monitoring_parameters?.length > 0 && (
              <Alert className="bg-blue-50 border-blue-200">
                <Activity className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <p className="font-semibold mb-2">Recommended Monitoring:</p>
                  <ul className="text-sm space-y-1">
                    {interactions.monitoring_parameters.map((param, idx) => (
                      <li key={idx}>• {param}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* No Issues Found */}
            {(!interactions.interactions || interactions.interactions.length === 0) &&
             (!interactions.contraindications || interactions.contraindications.length === 0) && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <p className="font-semibold">No Critical Interactions Detected</p>
                  <p className="text-sm">Current medication regimen appears safe. Continue routine monitoring.</p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <Alert className="bg-amber-50 border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900 text-sm">
            AI-generated medication analysis. Always verify with pharmacology references and clinical judgment. Report serious interactions to prescribing physician immediately.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}