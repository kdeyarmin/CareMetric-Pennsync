import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Brain, ChevronDown, ChevronUp, Beaker } from "lucide-react";
import { toast } from "sonner";

export default function DifferentialDiagnosisSuggester({ symptoms, patientHistory }) {
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedDiagnosis, setExpandedDiagnosis] = useState(null);
  const [generatingTests, setGeneratingTests] = useState(null);

  const analyzeDiagnoses = async () => {
    if (!symptoms?.trim()) {
      toast.error("Please enter symptoms");
      return;
    }

    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical decision support system. Analyze the following patient information and suggest differential diagnoses.

Symptoms: ${symptoms}
Patient History: ${patientHistory || "Not provided"}

Provide 3-5 potential diagnoses with:
- Diagnosis name
- Likelihood (high/medium/low)
- Key clinical features to look for
- Recommended next steps

Format as a structured list.`,
        add_context_from_internet: false,
      });

      setSuggestions(result);
    } catch (error) {
      toast.error("Failed to analyze diagnoses");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const generateDiagnosticTests = async (diagnosisName) => {
    setGeneratingTests(diagnosisName);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `For the diagnosis: "${diagnosisName}"
        
Patient Symptoms: ${symptoms}

Generate a specific diagnostic test plan including:
1. First-line lab tests
2. Imaging studies (if needed)
3. Diagnostic procedures
4. Expected timeline
5. Cost considerations

Be specific and practical.`,
        add_context_from_internet: false,
      });

      toast.success("Diagnostic tests generated");
      setExpandedDiagnosis({ name: diagnosisName, tests: result });
    } catch (error) {
      toast.error("Failed to generate diagnostic tests");
      console.error(error);
    } finally {
      setGeneratingTests(null);
    }
  };

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-600" />
          Differential Diagnosis Suggester
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          placeholder="Enter patient symptoms..."
          className="w-full h-24 p-2 border rounded text-sm"
          defaultValue={symptoms}
        />
        
        <Button
          onClick={analyzeDiagnoses}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing...
            </>
          ) : (
            "Analyze Diagnoses"
          )}
        </Button>

        {suggestions && (
          <div className="bg-white p-4 rounded border text-sm whitespace-pre-wrap">
            {suggestions}
          </div>
        )}
      </CardContent>
    </Card>
  );
}