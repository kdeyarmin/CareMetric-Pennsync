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

        {diagnoses.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Ranked Diagnoses</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={resetConfidences}
                className="gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </Button>
            </div>

            {rankedDiagnoses.map((dx) => {
              const currentConf = adjustedConfidences[dx.id] ?? dx.confidence;
              const likelihood =
                currentConf >= 75 ? "high" : currentConf >= 40 ? "medium" : "low";
              const bgColor =
                likelihood === "high"
                  ? "bg-green-50 border-green-200"
                  : likelihood === "medium"
                  ? "bg-yellow-50 border-yellow-200"
                  : "bg-red-50 border-red-200";

              return (
                <Card key={dx.id} className={`${bgColor} border`}>
                  <CardContent className="pt-6 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900">{dx.name}</h4>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs font-medium px-2 py-1 rounded bg-white">
                            Confidence: {Math.round(currentConf)}%
                          </span>
                          <span
                            className={`text-xs font-medium px-2 py-1 rounded ${
                              likelihood === "high"
                                ? "bg-green-200 text-green-800"
                                : likelihood === "medium"
                                ? "bg-yellow-200 text-yellow-800"
                                : "bg-red-200 text-red-800"
                            }`}
                          >
                            {likelihood.charAt(0).toUpperCase() +
                              likelihood.slice(1)}{" "}
                            Likelihood
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpandedDiagnosis(
                            expandedDiagnosis?.id === dx.id ? null : dx
                          )
                        }
                      >
                        {expandedDiagnosis?.id === dx.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {/* Confidence Adjustment Slider */}
                    <div className="bg-white p-3 rounded border">
                      <label className="text-xs font-medium text-gray-700 block mb-2">
                        Adjust Confidence (based on clinical judgment):
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={currentConf}
                        onChange={(e) =>
                          adjustConfidence(dx.id, parseInt(e.target.value))
                        }
                        className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>0%</span>
                        <span>{Math.round(currentConf)}%</span>
                        <span>100%</span>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {expandedDiagnosis?.id === dx.id && (
                      <div className="space-y-2 border-t pt-3">
                        <div>
                          <p className="text-xs font-semibold text-gray-700 mb-1">
                            Key Clinical Features:
                          </p>
                          <ul className="text-sm text-gray-600 space-y-1">
                            {dx.keyFeatures?.map((feature, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span>•</span> {feature}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-700 mb-1">
                            Recommended Next Steps:
                          </p>
                          <ul className="text-sm text-gray-600 space-y-1">
                            {dx.nextSteps?.map((step, idx) => (
                              <li key={idx} className="flex gap-2">
                                <span>•</span> {step}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => generateDiagnosticTests(dx.name)}
                          disabled={generatingTests === dx.name}
                          className="w-full gap-2 mt-2"
                        >
                          {generatingTests === dx.name ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Generating Tests...
                            </>
                          ) : (
                            <>
                              <Beaker className="w-3 h-3" />
                              Generate Diagnostic Tests
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}


      </CardContent>
    </Card>
  );
}