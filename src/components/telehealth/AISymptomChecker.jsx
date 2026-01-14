import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Stethoscope, Brain, Loader2, AlertTriangle, CheckCircle, TrendingUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function AISymptomChecker({ patientId, visitId }) {
  const [symptoms, setSymptoms] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [assessment, setAssessment] = useState(null);

  const analyzeSymptoms = async () => {
    if (!symptoms.trim()) {
      toast.error('Please describe symptoms first');
      return;
    }

    setIsAnalyzing(true);
    try {
      // Fetch patient data for context
      const patient = await base44.entities.Patient.filter({ id: patientId }).then(p => p[0]);
      
      const patientContext = patient ? `
Patient Context:
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None listed'}
- Allergies: ${patient.allergies || 'None listed'}
- Past Medical History: ${patient.past_medical_history?.join(', ') || 'None listed'}
` : '';

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an AI clinical assistant helping a healthcare provider during a telehealth consultation. Analyze the following symptoms and provide a structured assessment.

${patientContext}

Reported Symptoms:
${symptoms}

Provide a comprehensive assessment with:
1. Symptom analysis and severity level (mild/moderate/severe/critical)
2. Possible differential diagnoses (top 3-5 most likely)
3. Red flags or urgent concerns that require immediate attention
4. Recommended initial assessment questions to ask the patient
5. Suggested diagnostic tests or examinations
6. Immediate care recommendations
7. Whether in-person evaluation is recommended

IMPORTANT: This is for provider assistance only. All recommendations must be reviewed by the licensed healthcare provider before any action.

Format as JSON.`,
        response_json_schema: {
          type: "object",
          properties: {
            severityLevel: { 
              type: "string",
              enum: ["mild", "moderate", "severe", "critical"]
            },
            severityScore: { type: "number" },
            differentialDiagnoses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  likelihood: { type: "string" },
                  reasoning: { type: "string" }
                }
              }
            },
            redFlags: { type: "array", items: { type: "string" } },
            assessmentQuestions: { type: "array", items: { type: "string" } },
            suggestedTests: { type: "array", items: { type: "string" } },
            immediateRecommendations: { type: "array", items: { type: "string" } },
            requiresInPersonEvaluation: { type: "boolean" },
            clinicalNotes: { type: "string" }
          }
        }
      });

      setAssessment(result);

      // Save AI assessment to visit
      if (visitId) {
        await base44.entities.Visit.update(visitId, {
          ai_symptom_assessment: JSON.stringify(result)
        });
      }

      toast.success('AI symptom assessment complete');
    } catch (error) {
      console.error('Error analyzing symptoms:', error);
      toast.error('Failed to analyze symptoms');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getSeverityColor = (level) => {
    const colors = {
      mild: "bg-green-100 text-green-800 border-green-200",
      moderate: "bg-yellow-100 text-yellow-800 border-yellow-200",
      severe: "bg-orange-100 text-orange-800 border-orange-200",
      critical: "bg-red-100 text-red-800 border-red-200"
    };
    return colors[level] || colors.moderate;
  };

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-blue-50 to-cyan-50">
        <CardTitle className="text-sm flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-blue-600" />
          AI Symptom Checker & Assessment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Input Section */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Describe Patient Symptoms:
          </label>
          <Textarea
            placeholder="E.g., Patient reports persistent chest pain, shortness of breath, and dizziness for the past 2 hours..."
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            rows={4}
            className="text-sm"
          />
        </div>

        <Button
          onClick={analyzeSymptoms}
          disabled={isAnalyzing || !symptoms.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing Symptoms...
            </>
          ) : (
            <>
              <Brain className="w-4 h-4 mr-2" />
              Analyze with AI
            </>
          )}
        </Button>

        {/* Assessment Results */}
        {assessment && (
          <div className="space-y-3">
            {/* Severity Badge */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Severity Assessment:</span>
              <Badge className={getSeverityColor(assessment.severityLevel)}>
                {assessment.severityLevel.toUpperCase()}
              </Badge>
            </div>

            {/* Red Flags */}
            {assessment.redFlags && assessment.redFlags.length > 0 && (
              <Alert className="border-red-200 bg-red-50">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription>
                  <strong className="text-red-900">Urgent Concerns:</strong>
                  <ul className="mt-2 text-sm text-red-800 space-y-1">
                    {assessment.redFlags.map((flag, idx) => (
                      <li key={idx}>• {flag}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Differential Diagnoses */}
            {assessment.differentialDiagnoses && assessment.differentialDiagnoses.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                <h4 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Differential Diagnoses
                </h4>
                <div className="space-y-2">
                  {assessment.differentialDiagnoses.map((dx, idx) => (
                    <div key={idx} className="bg-white rounded p-2 border border-blue-100">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-sm font-medium text-blue-900">{dx.diagnosis}</span>
                        <Badge variant="outline" className="text-xs">{dx.likelihood}</Badge>
                      </div>
                      <p className="text-xs text-blue-700">{dx.reasoning}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Assessment Questions */}
            {assessment.assessmentQuestions && assessment.assessmentQuestions.length > 0 && (
              <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                <h4 className="text-sm font-semibold text-purple-900 mb-2">
                  Recommended Questions to Ask:
                </h4>
                <ul className="text-sm text-purple-800 space-y-1">
                  {assessment.assessmentQuestions.map((q, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span>•</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggested Tests */}
            {assessment.suggestedTests && assessment.suggestedTests.length > 0 && (
              <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                <h4 className="text-sm font-semibold text-green-900 mb-2">
                  Suggested Diagnostic Tests:
                </h4>
                <ul className="text-sm text-green-800 space-y-1">
                  {assessment.suggestedTests.map((test, idx) => (
                    <li key={idx}>• {test}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Immediate Recommendations */}
            {assessment.immediateRecommendations && assessment.immediateRecommendations.length > 0 && (
              <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                <h4 className="text-sm font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Immediate Care Recommendations:
                </h4>
                <ul className="text-sm text-yellow-800 space-y-1">
                  {assessment.immediateRecommendations.map((rec, idx) => (
                    <li key={idx}>• {rec}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* In-Person Evaluation Alert */}
            {assessment.requiresInPersonEvaluation && (
              <Alert className="border-orange-200 bg-orange-50">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-900 text-sm">
                  <strong>In-Person Evaluation Recommended:</strong> Based on the symptoms, an in-person medical evaluation may be necessary.
                </AlertDescription>
              </Alert>
            )}

            {/* Clinical Notes */}
            {assessment.clinicalNotes && (
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Clinical Notes:</h4>
                <p className="text-sm text-gray-700">{assessment.clinicalNotes}</p>
              </div>
            )}

            {/* Disclaimer */}
            <Alert>
              <AlertDescription className="text-xs text-gray-600">
                <strong>Clinical Disclaimer:</strong> This AI assessment is for clinical decision support only and must be reviewed by a licensed healthcare provider. It does not replace professional medical judgment.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}