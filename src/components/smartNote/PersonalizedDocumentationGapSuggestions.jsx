import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lightbulb, Plus, CheckCircle2, AlertCircle } from "lucide-react";

export default function PersonalizedDocumentationGapSuggestions({
  roughNote,
  patientData,
  visitType,
  diagnosis,
  carePlans,
  vitalSigns,
  onApplySuggestion,
  userEmail
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [appliedSuggestions, setAppliedSuggestions] = useState(new Set());

  // Generate personalized suggestions based on patient context
  useEffect(() => {
    if (roughNote.length < 50) return;

    const generateSuggestions = async () => {
      setIsLoading(true);
      try {
        const activePlans = carePlans.filter(cp => cp.status === 'active');
        const planGoals = activePlans.map(cp => `${cp.problem}: ${cp.goal}`).join('\n');

        const prompt = `Analyze this clinical note for documentation gaps specific to this patient's care plan and visit.

PATIENT CONTEXT:
- Primary Diagnosis: ${diagnosis}
- Current Care Plans: ${planGoals || 'None'}
- Recent Vitals: ${Object.entries(vitalSigns).filter(([k,v]) => v && k !== 'o2Source' && k !== 'o2Flow').map(([k,v]) => `${k}: ${v}`).join(', ') || 'None entered'}
- Visit Type: ${visitType}

ROUGH NOTE:
${roughNote}

Identify 3-5 specific, actionable documentation gaps that:
1. Are relevant to THIS patient's active care plans
2. Are critical for THIS visit type
3. Reference specific diagnoses or care goals this patient has
4. Include specific phrases or data points the nurse should add

Return JSON with:
{
  "gaps": [
    {
      "gap": "Specific gap description",
      "why_important": "Why it matters for this patient",
      "suggested_text": "Exact text to add about this gap",
      "related_care_plan": "Which care plan goal this addresses (if any)",
      "priority": "high/medium"
    }
  ]
}`;

        const result = await base44.integrations.Core.InvokeLLM({
          prompt,
          response_json_schema: {
            type: "object",
            properties: {
              gaps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    gap: { type: "string" },
                    why_important: { type: "string" },
                    suggested_text: { type: "string" },
                    related_care_plan: { type: "string" },
                    priority: { type: "string" }
                  }
                }
              }
            }
          }
        });

        setSuggestions(result.gaps || []);
      } catch (error) {
        console.error("Error generating suggestions:", error);
      }
      setIsLoading(false);
    };

    const debounce = setTimeout(generateSuggestions, 1500);
    return () => clearTimeout(debounce);
  }, [roughNote, patientData, visitType, diagnosis, carePlans, vitalSigns]);

  if (suggestions.length === 0 && !isLoading) return null;

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-indigo-600" />
          Personalized Documentation Gaps
        </CardTitle>
        <p className="text-xs text-indigo-600 font-normal mt-1">
          AI-detected gaps based on {patientData?.first_name}'s care plan and this {visitType} visit
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
            Analyzing your note...
          </div>
        ) : (
          <>
            {suggestions.map((suggestion, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border transition-all ${
                  appliedSuggestions.has(idx)
                    ? "bg-green-50 border-green-300"
                    : "bg-white border-indigo-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900">
                      {suggestion.gap}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      {suggestion.why_important}
                    </p>
                    {suggestion.related_care_plan && (
                      <p className="text-xs text-indigo-700 mt-1 font-medium">
                        📋 Addresses: {suggestion.related_care_plan}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant={suggestion.priority === "high" ? "destructive" : "outline"}
                      className="text-xs whitespace-nowrap"
                    >
                      {suggestion.priority}
                    </Badge>
                    {appliedSuggestions.has(idx) ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    ) : null}
                  </div>
                </div>

                {!appliedSuggestions.has(idx) && (
                  <div className="bg-indigo-50 p-2 rounded text-xs mb-2 border border-indigo-100">
                    <p className="text-indigo-900 font-medium mb-1">Suggested text:</p>
                    <p className="text-indigo-800 italic">{suggestion.suggested_text}</p>
                  </div>
                )}

                {!appliedSuggestions.has(idx) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 w-full justify-center"
                    onClick={() => {
                      onApplySuggestion(suggestion.suggested_text);
                      setAppliedSuggestions(prev => new Set([...prev, idx]));
                    }}
                  >
                    <Plus className="w-3 h-3" />
                    Add to Note
                  </Button>
                )}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}