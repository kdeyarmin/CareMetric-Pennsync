import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, Loader, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function DifferentialDiagnosisSuggester({
  roughNote,
  vitalSigns,
  patientData,
  diagnosis,
  userEmail
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (roughNote.length >= 50 && Object.keys(vitalSigns).some(k => vitalSigns[k])) {
      generateDifferentials();
    }
  }, [roughNote, vitalSigns]);

  const generateDifferentials = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      const vitalsContext = Object.entries(vitalSigns)
        .filter(([k, v]) => v && k !== 'o2Source' && k !== 'o2Flow')
        .map(([k, v]) => {
          if (k === 'o2') return `O2 Sat: ${v}%`;
          if (k === 'bp') return `BP: ${v}`;
          if (k === 'hr') return `HR: ${v}`;
          if (k === 'temp') return `Temp: ${v}°F`;
          if (k === 'pain') return `Pain: ${v}/10`;
          return `${k}: ${v}`;
        })
        .join(', ');

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Based on the clinical presentation below, suggest 3-5 potential differential diagnoses with brief explanations. Consider the vital signs, symptoms described, and patient context.

CLINICAL PRESENTATION:
${roughNote}

VITAL SIGNS: ${vitalsContext || 'Not provided'}

PATIENT CONTEXT:
${patientData ? `
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patientData.allergies || 'NKDA'}
- Age: ${patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
` : 'Patient data not available'}

CURRENT DIAGNOSIS BEING DOCUMENTED: ${diagnosis || 'Not specified'}

Return JSON with differential diagnosis suggestions including:
- diagnosis_name: The suspected condition
- likelihood: 'high', 'moderate', or 'low' based on presentation
- key_findings: Array of clinical findings supporting this diagnosis
- red_flags: Array of warning signs to monitor
- clinical_reasoning: Brief explanation of why this diagnosis fits

Return as JSON array of diagnoses.`,
        response_json_schema: {
          type: "object",
          properties: {
            differentials: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis_name: { type: "string" },
                  likelihood: { type: "string" },
                  key_findings: { type: "array", items: { type: "string" } },
                  red_flags: { type: "array", items: { type: "string" } },
                  clinical_reasoning: { type: "string" }
                }
              }
            },
            primary_considerations: { type: "string" }
          }
        }
      });

      setSuggestions(result);
    } catch (err) {
      setError(err.message || 'Failed to generate differential diagnoses');
      toast.error('Failed to generate differential suggestions');
    } finally {
      setIsLoading(false);
    }
  };

  if (!roughNote || roughNote.length < 50) return null;

  return (
    <Card className="w-full max-w-full overflow-hidden bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-600" />
          AI Differential Diagnosis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader className="w-4 h-4 animate-spin text-indigo-600" />
            <span className="text-sm text-indigo-700">Analyzing clinical presentation...</span>
          </div>
        ) : error ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
          </Alert>
        ) : suggestions ? (
          <div className="space-y-3">
            {suggestions.primary_considerations && (
              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-800">
                  {suggestions.primary_considerations}
                </AlertDescription>
              </Alert>
            )}

            {suggestions.differentials?.map((diff, idx) => (
              <div
                key={idx}
                className="border border-indigo-200 rounded-lg p-3 bg-white space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm text-indigo-900">
                      {diff.diagnosis_name}
                    </h4>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      diff.likelihood === 'high'
                        ? 'bg-green-100 text-green-800 border-green-300'
                        : diff.likelihood === 'moderate'
                        ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                        : 'bg-gray-100 text-gray-800 border-gray-300'
                    }
                  >
                    {diff.likelihood}
                  </Badge>
                </div>

                <div className="text-xs text-gray-700">
                  <p className="font-medium mb-1">Clinical Reasoning:</p>
                  <p>{diff.clinical_reasoning}</p>
                </div>

                {diff.key_findings?.length > 0 && (
                  <div className="text-xs">
                    <p className="font-medium text-gray-700 mb-1">Supporting Findings:</p>
                    <ul className="list-disc list-inside text-gray-600 space-y-0.5">
                      {diff.key_findings.map((finding, i) => (
                        <li key={i}>{finding}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {diff.red_flags?.length > 0 && (
                  <div className="text-xs">
                    <p className="font-medium text-red-700 mb-1">⚠️ Red Flags to Monitor:</p>
                    <ul className="list-disc list-inside text-red-600 space-y-0.5">
                      {diff.red_flags.map((flag, i) => (
                        <li key={i}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={generateDifferentials}
              className="w-full"
            >
              Refresh Analysis
            </Button>
          </div>
        ) : (
          <Button
            onClick={generateDifferentials}
            className="w-full bg-indigo-600 hover:bg-indigo-700"
          >
            <Brain className="w-4 h-4 mr-2" />
            Generate Differential Diagnoses
          </Button>
        )}
      </CardContent>
    </Card>
  );
}