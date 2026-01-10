import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader, AlertTriangle, Lightbulb, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

export default function AISuggestionPanel({
  transcription = "",
  onApplySuggestion = null,
  isLoading = false
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [applied, setApplied] = useState(new Set());

  const analyzeSuggestions = async () => {
    if (!transcription.trim() || transcription.length < 50) {
      toast.error("Please provide at least 50 characters of transcription");
      return;
    }

    setAnalyzing(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this medical transcription for potential improvements and inconsistencies. Provide specific, actionable suggestions.

TRANSCRIPTION:
${transcription}

Return a JSON with this structure:
{
  "inconsistencies": [
    {
      "issue": "description of the inconsistency",
      "severity": "critical|high|medium",
      "suggested_fix": "how to fix it"
    }
  ],
  "clarity_improvements": [
    {
      "original_text": "text from transcription",
      "improved_text": "improved version",
      "reason": "why this is better",
      "type": "grammar|clarity|medical_terminology|conciseness"
    }
  ],
  "missing_elements": [
    {
      "element": "what's missing",
      "importance": "critical|high|medium",
      "context": "where it should be added"
    }
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            inconsistencies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  severity: { type: "string" },
                  suggested_fix: { type: "string" }
                }
              }
            },
            clarity_improvements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  original_text: { type: "string" },
                  improved_text: { type: "string" },
                  reason: { type: "string" },
                  type: { type: "string" }
                }
              }
            },
            missing_elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  importance: { type: "string" },
                  context: { type: "string" }
                }
              }
            }
          }
        }
      });

      setSuggestions(response || {});
      setApplied(new Set());
      toast.success("Analysis complete");
    } catch (error) {
      toast.error("Failed to analyze transcription");
      console.error(error);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApplySuggestion = (id, improvedText) => {
    onApplySuggestion?.(improvedText);
    const newApplied = new Set(applied);
    newApplied.add(id);
    setApplied(newApplied);
    toast.success("Suggestion applied");
  };

  const totalIssues = (suggestions.inconsistencies?.length || 0) +
    (suggestions.clarity_improvements?.length || 0) +
    (suggestions.missing_elements?.length || 0);

  return (
    <Card className="w-full border-amber-200 bg-amber-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-600" />
            AI Suggestions & Analysis
          </CardTitle>
          <Button
            onClick={analyzeSuggestions}
            disabled={analyzing || isLoading || transcription.length < 50}
            size="sm"
            className="bg-amber-600 hover:bg-amber-700"
          >
            {analyzing ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Analyze Transcription"
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {totalIssues === 0 && !analyzing ? (
          <div className="text-center py-6 text-gray-500">
            <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Click "Analyze Transcription" to get AI suggestions</p>
          </div>
        ) : (
          <>
            {/* Inconsistencies */}
            {suggestions.inconsistencies?.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <h3 className="font-semibold text-sm text-red-900">
                    Inconsistencies ({suggestions.inconsistencies.length})
                  </h3>
                </div>
                {suggestions.inconsistencies.map((item, idx) => (
                  <Alert key={`inc-${idx}`} className="bg-red-50 border-red-200">
                    <AlertDescription className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-red-900">{item.issue}</p>
                          <p className="text-xs text-red-700 mt-1">{item.suggested_fix}</p>
                        </div>
                        <Badge className="bg-red-600 text-white text-xs whitespace-nowrap">
                          {item.severity}
                        </Badge>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {/* Clarity Improvements */}
            {suggestions.clarity_improvements?.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <h3 className="font-semibold text-sm text-green-900">
                    Clarity Improvements ({suggestions.clarity_improvements.length})
                  </h3>
                </div>
                {suggestions.clarity_improvements.map((item, idx) => {
                  const suggestionId = `clarity-${idx}`;
                  const isApplied = applied.has(suggestionId);
                  return (
                    <div
                      key={suggestionId}
                      className={`border rounded p-3 space-y-2 ${isApplied ? 'bg-green-50 border-green-200' : 'bg-white border-amber-200'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-1">
                          <div className="text-xs text-gray-500">Original:</div>
                          <p className="text-sm text-gray-700 italic">"{item.original_text}"</p>
                          <div className="text-xs text-gray-500 mt-2">Improved:</div>
                          <p className="text-sm text-green-700 font-medium">"{item.improved_text}"</p>
                          <p className="text-xs text-gray-600 mt-1">{item.reason}</p>
                        </div>
                        <Badge className="bg-amber-600 text-white text-xs whitespace-nowrap">
                          {item.type}
                        </Badge>
                      </div>
                      <Button
                        onClick={() => handleApplySuggestion(suggestionId, item.improved_text)}
                        disabled={isApplied}
                        size="sm"
                        variant={isApplied ? "outline" : "default"}
                        className={isApplied ? "bg-green-50 text-green-700 border-green-300" : ""}
                      >
                        {isApplied ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Applied
                          </>
                        ) : (
                          "Apply Suggestion"
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Missing Elements */}
            {suggestions.missing_elements?.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  <h3 className="font-semibold text-sm text-orange-900">
                    Missing Elements ({suggestions.missing_elements.length})
                  </h3>
                </div>
                {suggestions.missing_elements.map((item, idx) => (
                  <Alert key={`miss-${idx}`} className="bg-orange-50 border-orange-200">
                    <AlertDescription className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-orange-900">{item.element}</p>
                          <p className="text-xs text-orange-700 mt-1">Context: {item.context}</p>
                        </div>
                        <Badge className="bg-orange-600 text-white text-xs whitespace-nowrap">
                          {item.importance}
                        </Badge>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}