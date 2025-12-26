import React, { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Wand2, X } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function ProactiveComplianceWarnings({ 
  roughNote, 
  visitType, 
  diagnosis,
  patientData,
  onAddCompliance,
  threshold = 50 
}) {
  const [warnings, setWarnings] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (roughNote?.length >= threshold) {
        checkCompliance();
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [roughNote, visitType, diagnosis]);

  const checkCompliance = async () => {
    if (!roughNote || isAnalyzing) return;

    setIsAnalyzing(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this ROUGH note for critical compliance gaps. The nurse is still writing. Flag ONLY missing elements that are ESSENTIAL before enhancement.

ROUGH NOTE (in progress):
${roughNote}

VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis}

Flag ONLY if:
1. Homebound status is missing (critical)
2. Skilled need justification is missing (critical)
3. Patient response/outcomes are missing (high)

For each gap, provide a brief warning and suggested one-sentence addition.`,
        response_json_schema: {
          type: "object",
          properties: {
            warnings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  warning: { type: "string" },
                  suggested_text: { type: "string" },
                  severity: { type: "string" }
                }
              }
            }
          }
        }
      });

      setWarnings(result.warnings || []);
    } catch (error) {
      console.error('Error checking compliance:', error);
    }
    setIsAnalyzing(false);
  };

  const activeWarnings = warnings.filter(w => !dismissed.includes(w.element));

  if (activeWarnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {activeWarnings.map((warning, idx) => (
        <Alert 
          key={idx} 
          className={`${
            warning.severity === 'critical' 
              ? 'bg-red-50 border-red-300' 
              : 'bg-orange-50 border-orange-300'
          }`}
        >
          <AlertTriangle className={`w-4 h-4 ${
            warning.severity === 'critical' ? 'text-red-600' : 'text-orange-600'
          }`} />
          <AlertDescription className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Badge className={warning.severity === 'critical' ? 'bg-red-600' : 'bg-orange-600'}>
                  {warning.element}
                </Badge>
              </div>
              <p className="text-sm mb-2">{warning.warning}</p>
              <div className="bg-white/50 p-2 rounded text-xs italic">
                💡 Suggestion: "{warning.suggested_text}"
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <Button
                size="sm"
                onClick={() => {
                  onAddCompliance?.(warning.suggested_text);
                  setDismissed([...dismissed, warning.element]);
                }}
                className="bg-blue-600 hover:bg-blue-700 h-8"
              >
                <Wand2 className="w-3 h-3 mr-1" />
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissed([...dismissed, warning.element])}
                className="h-8"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}