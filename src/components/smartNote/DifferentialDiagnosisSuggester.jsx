import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Brain, ChevronDown, ChevronUp, Beaker, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export default function DifferentialDiagnosisSuggester({ symptoms, patientHistory }) {
  const [diagnoses, setDiagnoses] = useState([]);
  const [adjustedConfidences, setAdjustedConfidences] = useState({});
  const [loading, setLoading] = useState(false);
  const [expandedDiagnosis, setExpandedDiagnosis] = useState(null);
  const [generatingTests, setGeneratingTests] = useState(null);

  // Compute sorted diagnoses based on adjusted confidence
  const rankedDiagnoses = useMemo(() => {
    return [...diagnoses].sort((a, b) => {
      const aConf = adjustedConfidences[a.id] ?? a.confidence;
      const bConf = adjustedConfidences[b.id] ?? b.confidence;
      return bConf - aConf;
    });
  }, [diagnoses, adjustedConfidences]);

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

Provide 3-5 potential diagnoses in JSON format. Each diagnosis must have:
- name: diagnosis name
- confidence: a number from 0-100 representing your confidence level
- likelihood: "high" (75-100), "medium" (40-74), or "low" (0-39) based on confidence
- keyFeatures: array of clinical features to look for
- nextSteps: array of recommended diagnostic steps

Return ONLY valid JSON array with diagnoses, no other text.`,
        response_json_schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 100 },
              likelihood: { type: "string", enum: ["high", "medium", "low"] },
              keyFeatures: { type: "array", items: { type: "string" } },
              nextSteps: { type: "array", items: { type: "string" } },
            },
            required: ["name", "confidence", "likelihood", "keyFeatures", "nextSteps"],
          },
        },
        add_context_from_internet: false,
      });

      // Add IDs for tracking adjustments
      const withIds = result.map((d, idx) => ({
        ...d,
        id: `dx_${idx}`,
      }));
      setDiagnoses(withIds);
      setAdjustedConfidences({});
    } catch (error) {
      toast.error("Failed to analyze diagnoses");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const adjustConfidence = (diagnosisId, newConfidence) => {
    const clamped = Math.max(0, Math.min(100, newConfidence));
    setAdjustedConfidences((prev) => ({
      ...prev,
      [diagnosisId]: clamped,
    }));
  };

  const resetConfidences = () => {
    setAdjustedConfidences({});
    toast.success("Confidence scores reset to original values");
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
          <div className="bg-white p-4 rounded border space-y-2">
            {suggestions.split('\n').filter(line => line.trim()).map((line, idx) => {
              const isDiagnosis = line.includes('Diagnosis') || line.includes('-');
              return (
                <div key={idx} className={isDiagnosis ? "font-semibold text-blue-700 py-2 border-b" : "text-sm text-gray-700"}>
                  {line}
                </div>
              );
            })}
          </div>
        )}

        {expandedDiagnosis && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-base">{expandedDiagnosis.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm whitespace-pre-wrap bg-white p-3 rounded border">
                {expandedDiagnosis.tests}
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}