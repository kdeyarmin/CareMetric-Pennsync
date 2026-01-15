import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import DetailedComplianceFeedback from "../compliance/DetailedComplianceFeedback";
import { getProviderCompliancePrompt } from "../utils/providerSpecificConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

export default function ClinicalNoteAnalyzer({ onDataExtracted, visitType, diagnosis }) {
  const [roughNotes, setRoughNotes] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  const [enhancedNote, setEnhancedNote] = useState(null);
  const [complianceResults, setComplianceResults] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const enhanceNote = async () => {
    if (!roughNotes.trim()) {
      toast.error("Please enter clinical notes");
      return;
    }

    if (!visitType) {
      toast.error("Please select a visit type");
      return;
    }

    if (!diagnosis) {
      toast.error("Please select a diagnosis");
      return;
    }

    setExtracting(true);
    setEnhancedNote(null);
    setComplianceResults(null);
    
    try {
      // Get provider-specific compliance requirements
      const compliancePrompt = getProviderCompliancePrompt(currentUser?.provider_type || 'RN', visitType);

      // Call AI to enhance note and check compliance
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a healthcare documentation specialist. Analyze the following rough clinical note and:

1. Extract key clinical data (diagnoses, medications, symptoms, vital signs)
2. Enhance it into a Medicare-compliant, professional clinical note
3. Perform comprehensive compliance checks based on the visit type and diagnosis
4. Provide specific compliance feedback and suggestions

Visit Type: ${visitType}
Primary Diagnosis: ${diagnosis}

Provider Type: ${currentUser?.provider_type || 'RN'}
Compliance Requirements: ${compliancePrompt}

Rough Note:
${roughNotes}

Return your analysis in the following JSON format:
{
  "extracted_data": {
    "diagnoses": ["list of diagnoses found"],
    "medications": ["list of medications"],
    "symptoms": ["list of symptoms"],
    "vitals": {"temperature": "", "blood_pressure": "", "heart_rate": "", etc}
  },
  "enhanced_note": "The full Medicare-compliant enhanced clinical note with proper formatting",
  "compliance_check": {
    "compliance_score": 0-100,
    "status": "passed" | "flagged" | "critical",
    "issues": [{"element": "", "severity": "", "problem": "", "suggestion": ""}],
    "compliant_elements": ["list of elements that passed"]
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            extracted_data: {
              type: "object",
              properties: {
                diagnoses: { type: "array", items: { type: "string" } },
                medications: { type: "array", items: { type: "string" } },
                symptoms: { type: "array", items: { type: "string" } },
                vitals: { type: "object" }
              }
            },
            enhanced_note: { type: "string" },
            compliance_check: {
              type: "object",
              properties: {
                compliance_score: { type: "number" },
                status: { type: "string" },
                issues: { type: "array" },
                compliant_elements: { type: "array" }
              }
            }
          }
        }
      });

      setExtractedData(result.extracted_data);
      setEnhancedNote(result.enhanced_note);
      setComplianceResults(result.compliance_check);
      
      onDataExtracted?.(result.extracted_data);
      toast.success("Note enhanced and compliance checked");
    } catch (error) {
      toast.error("Failed to enhance note");
      console.error(error);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Card className="border-indigo-200 bg-indigo-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-indigo-600" />
          Clinical Note Analyzer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          value={roughNotes}
          onChange={(e) => setRoughNotes(e.target.value)}
          placeholder="Paste your rough clinical notes here..."
          className="w-full h-32 p-2 border rounded text-sm"
        />

        <Button
          onClick={enhanceNote}
          disabled={extracting || !visitType || !diagnosis}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {extracting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Enhancing Note...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4 mr-2" />
              Enhance Note
            </>
          )}
        </Button>

        {enhancedNote && (
          <div className="space-y-4">
            {/* Enhanced Note Display */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-300 dark:border-slate-600">
              <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-indigo-600" />
                Enhanced Compliant Note
              </h4>
              <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap max-h-96 overflow-y-auto bg-slate-50 dark:bg-slate-800 p-3 rounded border">
                {enhancedNote}
              </div>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(enhancedNote);
                  toast.success("Enhanced note copied to clipboard");
                }}
                variant="outline"
                size="sm"
                className="w-full mt-3"
              >
                Copy Enhanced Note
              </Button>
            </div>

            {/* Compliance Results */}
            {complianceResults && (
              <Card className={
                complianceResults.status === 'passed' ? 'border-green-300 bg-green-50' :
                complianceResults.status === 'critical' ? 'border-red-300 bg-red-50' :
                'border-yellow-300 bg-yellow-50'
              }>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="text-lg">Compliance Analysis</span>
                    <span className={`text-2xl font-bold ${
                      complianceResults.compliance_score >= 90 ? 'text-green-600' :
                      complianceResults.compliance_score >= 70 ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      {complianceResults.compliance_score}%
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Compliant Elements */}
                  {complianceResults.compliant_elements?.length > 0 && (
                    <div>
                      <h5 className="font-semibold text-green-800 mb-2">✓ Compliant Elements</h5>
                      <ul className="space-y-1">
                        {complianceResults.compliant_elements.map((element, idx) => (
                          <li key={idx} className="text-sm text-green-700">• {element}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Issues Found */}
                  {complianceResults.issues?.length > 0 && (
                    <div>
                      <h5 className="font-semibold text-red-800 mb-2">⚠ Issues Found</h5>
                      <div className="space-y-3">
                        {complianceResults.issues.map((issue, idx) => (
                          <div key={idx} className="bg-white p-3 rounded border border-red-200">
                            <div className="flex items-start gap-2 mb-1">
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                issue.severity === 'critical' ? 'bg-red-600 text-white' :
                                issue.severity === 'high' ? 'bg-orange-500 text-white' :
                                'bg-yellow-500 text-white'
                              }`}>
                                {issue.severity}
                              </span>
                              <p className="font-medium text-gray-900 text-sm">{issue.element}</p>
                            </div>
                            <p className="text-sm text-red-700 mb-2">{issue.problem}</p>
                            <p className="text-sm text-green-700 bg-green-50 p-2 rounded">
                              💡 {issue.suggestion}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Extracted Data Summary */}
            {extractedData && (
              <div className="bg-white dark:bg-slate-900 p-4 rounded border space-y-3 text-sm">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100">Extracted Clinical Data</h4>
                {extractedData.diagnoses?.length > 0 && (
                  <div>
                    <p className="font-semibold text-gray-700">Diagnoses:</p>
                    <p className="text-gray-600">{extractedData.diagnoses.join(", ")}</p>
                  </div>
                )}
                {extractedData.medications?.length > 0 && (
                  <div>
                    <p className="font-semibold text-gray-700">Medications:</p>
                    <p className="text-gray-600">{extractedData.medications.join(", ")}</p>
                  </div>
                )}
                {extractedData.symptoms?.length > 0 && (
                  <div>
                    <p className="font-semibold text-gray-700">Symptoms:</p>
                    <p className="text-gray-600">{extractedData.symptoms.join(", ")}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}