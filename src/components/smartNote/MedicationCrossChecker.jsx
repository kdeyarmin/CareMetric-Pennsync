import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Pill, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { secureAICall } from "../utils/security";

export default function MedicationCrossChecker({ 
  enhancedNote, 
  patientData, 
  onAddDocumentation,
  userEmail 
}) {
  const [analysis, setAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (enhancedNote && patientData?.current_medications?.length > 0) {
      analyzeMedications();
    }
  }, [enhancedNote]);

  const analyzeMedications = async () => {
    setIsAnalyzing(true);
    try {
      const meds = patientData.current_medications.slice(0, 10).map(m => m.name).join(', ');
      
      const result = await secureAICall(
        () => base44.integrations.Core.InvokeLLM({
          prompt: `Check if medications were properly addressed in clinical note.

PATIENT MEDICATIONS: ${meds}

CLINICAL NOTE:
${enhancedNote}

For each medication, check if:
1. Adherence/compliance mentioned
2. Response/effectiveness noted
3. Side effects assessed (especially high-risk meds)
4. Patient education documented if new med

Return:
{
  "documented_meds": ["Meds properly documented"],
  "missing_checks": [
    {
      "medication": "Med name",
      "issue": "What's missing",
      "risk_level": "high/medium/low",
      "suggestion": "What to add"
    }
  ]
}`,
          response_json_schema: {
            type: "object",
            properties: {
              documented_meds: { type: "array", items: { type: "string" } },
              missing_checks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    medication: { type: "string" },
                    issue: { type: "string" },
                    risk_level: { type: "string" },
                    suggestion: { type: "string" }
                  }
                }
              }
            }
          }
        }),
        userEmail
      );
      setAnalysis(result);
    } catch (error) {
      setAnalysis(null);
    }
    setIsAnalyzing(false);
  };

  if (!patientData?.current_medications?.length || isAnalyzing) return null;
  if (!analysis || (analysis.missing_checks?.length === 0 && analysis.documented_meds?.length === 0)) return null;

  const highRiskIssues = analysis.missing_checks?.filter(m => m.risk_level === 'high') || [];

  return (
    <Card className="border-2 border-purple-400 bg-purple-50">
      <CardHeader className="py-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pill className="w-4 h-4 text-purple-600" />
            Medication Documentation Check
            {highRiskIssues.length > 0 && (
              <Badge className="bg-red-600 text-white">{highRiskIssues.length} High Risk</Badge>
            )}
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      {isExpanded && (
        <CardContent className="p-4 space-y-3">
          {analysis.documented_meds?.length > 0 && (
            <Alert className="bg-green-50 border-green-300">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-xs text-green-800">
                <strong>Well Documented:</strong> {analysis.documented_meds.join(', ')}
              </AlertDescription>
            </Alert>
          )}

          {analysis.missing_checks?.map((item, idx) => (
            <div key={idx} className={`p-3 rounded-lg border-2 ${item.risk_level === 'high' ? 'bg-red-50 border-red-300' : 'bg-yellow-50 border-yellow-300'}`}>
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className={`w-4 h-4 mt-0.5 ${item.risk_level === 'high' ? 'text-red-600' : 'text-yellow-600'}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{item.medication}</span>
                    <Badge className={item.risk_level === 'high' ? 'bg-red-600 text-white' : 'bg-yellow-600 text-white'}>
                      {item.risk_level}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-700 mb-2">{item.issue}</p>
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2">
                    <p className="text-xs text-gray-800 italic">"{item.suggestion}"</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onAddDocumentation?.(item.suggestion)}
                    className="bg-purple-600 hover:bg-purple-700 w-full"
                  >
                    Add to Note
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}