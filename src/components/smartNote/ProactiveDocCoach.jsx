import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lightbulb, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { secureAICall } from "../utils/security";

export default function ProactiveDocCoach({ 
  roughNote, 
  patientData, 
  visitType,
  diagnosis,
  vitalSigns,
  onInsertSuggestion,
  userEmail 
}) {
  const [suggestion, setSuggestion] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dismissed, setDismissed] = useState(new Set());
  const lastAnalyzedRef = useRef("");
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (roughNote.length < 50) return;
    
    // Debounce analysis
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (roughNote !== lastAnalyzedRef.current) {
        analyzeNote();
      }
    }, 3000); // 3 second delay after typing stops

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [roughNote]);

  const analyzeNote = async () => {
    if (roughNote.length < 50) return;
    
    setIsAnalyzing(true);
    lastAnalyzedRef.current = roughNote;

    try {
      const result = await secureAICall(
        () => base44.integrations.Core.InvokeLLM({
          prompt: `Analyze clinical note for missed documentation. Suggest ONE most important follow-up question.

NOTE: ${roughNote}
PATIENT: ${patientData?.first_name} ${patientData?.last_name}
Dx: ${diagnosis}
Meds: ${patientData?.current_medications?.slice(0, 3).map(m => m.name).join(', ') || 'None'}
Visit: ${visitType}

Look for:
- Symptoms mentioned without assessment details
- High-risk meds without monitoring noted
- Abnormal vitals without follow-up
- Patient complaints without interventions
- Missing homebound status if mobility issues mentioned

Return ONE critical suggestion or null:
{
  "suggestion": "Specific question to prompt nurse" or null,
  "rationale": "Why this is important",
  "priority": "critical" or "high" or "medium"
}`,
          response_json_schema: {
            type: "object",
            properties: {
              suggestion: { type: ["string", "null"] },
              rationale: { type: "string" },
              priority: { type: "string" }
            }
          }
        }),
        userEmail
      );

      if (result.suggestion && !dismissed.has(result.suggestion)) {
        setSuggestion(result);
      } else {
        setSuggestion(null);
      }
    } catch (error) {
      setSuggestion(null);
    }
    setIsAnalyzing(false);
  };

  const handleDismiss = () => {
    if (suggestion) {
      setDismissed(prev => new Set([...prev, suggestion.suggestion]));
    }
    setSuggestion(null);
  };

  if (!suggestion || roughNote.length < 50) return null;

  const priorityColors = {
    critical: "bg-red-50 border-red-400",
    high: "bg-orange-50 border-orange-400",
    medium: "bg-yellow-50 border-yellow-400"
  };

  return (
    <Card className={`border-2 ${priorityColors[suggestion.priority] || priorityColors.medium} shadow-lg animate-in slide-in-from-right`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1">
            <Lightbulb className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <Badge className="bg-indigo-600 text-white text-xs mb-1">AI Coach</Badge>
              <p className="text-sm font-medium text-gray-800">{suggestion.suggestion}</p>
              <p className="text-xs text-gray-600 mt-1">{suggestion.rationale}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="h-6 w-6 p-0 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}