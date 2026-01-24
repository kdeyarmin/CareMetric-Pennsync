import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, Loader2, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { getPrompt, trackPromptUsage } from "../utils/aiPrompts";

export default function DifferentialDiagnosisGenerator({ patient }) {
  const [symptoms, setSymptoms] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [diagnoses, setDiagnoses] = useState(null);

  const handleGenerate = async () => {
    if (!symptoms.trim()) {
      alert("Please enter patient symptoms");
      return;
    }

    setIsGenerating(true);
    const startTime = Date.now();

    try {
      const history = {
        age: patient.date_of_birth,
        chronic_conditions: patient.chronic_conditions || [],
        medications: patient.current_medications || [],
        allergies: patient.allergies,
        past_medical_history: patient.past_medical_history || []
      };

      const { prompt, schema, version } = getPrompt('DIFFERENTIAL_DIAGNOSIS', symptoms, history);

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        response_json_schema: schema
      });

      setDiagnoses(response);

      const responseTime = Date.now() - startTime;
      trackPromptUsage('DIFFERENTIAL_DIAGNOSIS', version, true, responseTime);
    } catch (error) {
      console.error('Error generating differential diagnosis:', error);
      alert('Failed to generate differential diagnosis. Please try again.');

      const responseTime = Date.now() - startTime;
      trackPromptUsage('DIFFERENTIAL_DIAGNOSIS', version, false, responseTime);
    }

    setIsGenerating(false);
  };

  const getProbabilityColor = (probability) => {
    switch (probability) {
      case 'high': return 'bg-red-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      default: return 'bg-blue-500 text-white';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          AI Differential Diagnosis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Patient Symptoms & Presentation</Label>
          <Textarea
            placeholder="Enter chief complaint, symptoms, vital signs, physical exam findings..."
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            className="min-h-[120px]"
          />
        </div>

        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !symptoms.trim()}
          className="bg-purple-600 hover:bg-purple-700 w-full"
        >
          {isGenerating ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Differential...</>
          ) : (
            <><Brain className="w-4 h-4 mr-2" /> Generate Differential Diagnosis</>
          )}
        </Button>

        {diagnoses && (
          <div className="space-y-3 mt-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              Differential Diagnoses
            </h3>
            {diagnoses.differential_diagnoses?.map((dx, idx) => (
              <Card key={idx} className="border-l-4 border-l-purple-500">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-gray-900">{idx + 1}. {dx.diagnosis}</h4>
                    <Badge className={getProbabilityColor(dx.probability)}>
                      {dx.probability} probability
                    </Badge>
                  </div>

                  {dx.supporting_findings?.length > 0 && (
                    <div className="mb-3">
                      <p className="text-sm font-medium text-gray-700 mb-1">Supporting Findings:</p>
                      <ul className="text-sm text-gray-600 space-y-1">
                        {dx.supporting_findings.map((finding, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle2 className="w-3 h-3 text-green-600 mt-0.5 flex-shrink-0" />
                            <span>{finding}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dx.next_steps?.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-1">Recommended Next Steps:</p>
                      <ul className="text-sm text-gray-600 space-y-1">
                        {dx.next_steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-purple-600 font-bold">→</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            <Alert className="bg-amber-50 border-amber-200 mt-4">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-900 text-sm">
                <p className="font-semibold mb-1">Clinical Judgment Required</p>
                This AI-generated differential is a clinical decision support tool. Always correlate with clinical assessment, patient history, and appropriate diagnostic testing.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}