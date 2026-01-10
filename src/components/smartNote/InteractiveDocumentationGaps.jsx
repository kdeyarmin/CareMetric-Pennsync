import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Lightbulb, ArrowRight, Loader2, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { secureAICall } from "../utils/security";

export default function InteractiveDocumentationGaps({ 
  gaps = [], 
  patientData, 
  visitType,
  diagnosis,
  vitalSigns,
  roughNote,
  onApplySuggestion,
  userEmail
}) {
  const [selectedGap, setSelectedGap] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [filledGaps, setFilledGaps] = useState(new Set());

  const handleGapClick = async (gap) => {
    if (selectedGap?.element === gap.element) {
      setSelectedGap(null);
      setSuggestion(null);
      return;
    }

    setSelectedGap(gap);
    setSuggestion(null);
    setIsGenerating(true);

    try {
      const result = await secureAICall(
        () => base44.integrations.Core.InvokeLLM({
          prompt: `Provide specific clinical documentation to address this gap:

GAP: ${gap.element}
REASON: ${gap.reason}

PATIENT CONTEXT:
${patientData ? `- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Dx: ${patientData.primary_diagnosis || diagnosis}
- Medications: ${patientData.current_medications?.slice(0, 3).map(m => m.name).join(', ') || 'None'}
- Allergies: ${patientData.allergies || 'None'}` : ''}

VISIT: ${visitType}
DIAGNOSIS: ${diagnosis}
VITALS: ${Object.entries(vitalSigns || {}).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ')}

CURRENT NOTE EXCERPT:
${roughNote?.substring(0, 300)}...

Provide 2-3 specific, copy-paste ready clinical statements to fill this gap. Use patient data when available.

Return JSON:
{
  "suggestions": [
    {"text": "Clinical statement 1", "rationale": "Why this addresses the gap"},
    {"text": "Clinical statement 2", "rationale": "Why this helps"}
  ],
  "clinical_reference": "Brief clinical best practice note"
}`,
          response_json_schema: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    rationale: { type: "string" }
                  }
                }
              },
              clinical_reference: { type: "string" }
            }
          }
        }),
        userEmail
      );

      setSuggestion(result);
    } catch (error) {
      setSuggestion({ 
        suggestions: [{ 
          text: "Unable to generate suggestions. Please document manually.", 
          rationale: "AI service temporarily unavailable" 
        }],
        clinical_reference: "" 
      });
    }
    setIsGenerating(false);
  };

  const handleApplySuggestion = (suggestionText) => {
    if (onApplySuggestion) {
      onApplySuggestion(suggestionText);
      setFilledGaps(prev => new Set([...prev, selectedGap.element]));
    }
  };

  const criticalGaps = gaps.filter(g => g.priority === 'critical');
  const highGaps = gaps.filter(g => g.priority === 'high');
  const mediumGaps = gaps.filter(g => g.priority === 'medium');

  if (gaps.length === 0) return null;

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'border-red-400 bg-red-50';
      case 'high': return 'border-orange-400 bg-orange-50';
      case 'medium': return 'border-yellow-400 bg-yellow-50';
      default: return 'border-gray-400 bg-gray-50';
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'medium': return 'bg-yellow-600 text-white';
      default: return 'bg-gray-600 text-white';
    }
  };

  return (
    <Card className="border-2 border-orange-400 shadow-lg">
      <CardHeader className="py-3 bg-gradient-to-r from-orange-50 to-yellow-50">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-600" />
          Documentation Gaps ({gaps.length})
          <Badge className="bg-orange-600 text-white ml-auto">Click to get help</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <Alert className="bg-blue-50 border-blue-200">
          <Lightbulb className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-xs text-blue-800">
            Click any gap below to get AI-powered suggestions with relevant clinical examples
          </AlertDescription>
        </Alert>

        {criticalGaps.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-red-700 uppercase">Critical</p>
            {criticalGaps.map((gap, idx) => (
              <div key={idx} className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGapClick(gap)}
                  className={`w-full justify-between text-left h-auto py-3 ${getPriorityColor(gap.priority)} hover:shadow-md transition-all ${selectedGap?.element === gap.element ? 'ring-2 ring-orange-500' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {filledGaps.has(gap.element) ? (
                        <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                      )}
                      <span className="font-semibold text-sm">{gap.element}</span>
                      <Badge className={getPriorityBadge(gap.priority)}>
                        {gap.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 pl-6">{gap.reason}</p>
                  </div>
                  <ArrowRight className={`w-4 h-4 flex-shrink-0 ml-2 transition-transform ${selectedGap?.element === gap.element ? 'rotate-90' : ''}`} />
                </Button>

                {selectedGap?.element === gap.element && (
                  <div className="ml-6 p-3 bg-white rounded-lg border-2 border-orange-300 shadow-sm space-y-3">
                    {isGenerating ? (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating suggestions...
                      </div>
                    ) : suggestion ? (
                      <>
                        {suggestion.suggestions.map((sug, sidx) => (
                          <div key={sidx} className="space-y-2 pb-3 border-b last:border-b-0">
                            <div className="bg-blue-50 border border-blue-200 rounded p-3">
                              <p className="text-sm text-gray-800 italic">"{sug.text}"</p>
                            </div>
                            <p className="text-xs text-gray-600 flex items-start gap-1">
                              <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              {sug.rationale}
                            </p>
                            <Button
                              size="sm"
                              onClick={() => handleApplySuggestion(sug.text)}
                              className="bg-green-600 hover:bg-green-700 w-full"
                            >
                              Add to Note
                            </Button>
                          </div>
                        ))}
                        {suggestion.clinical_reference && (
                          <Alert className="bg-purple-50 border-purple-200">
                            <AlertDescription className="text-xs text-purple-800">
                              <strong>Clinical Note:</strong> {suggestion.clinical_reference}
                            </AlertDescription>
                          </Alert>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {highGaps.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-orange-700 uppercase">High Priority</p>
            {highGaps.map((gap, idx) => (
              <div key={idx} className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGapClick(gap)}
                  className={`w-full justify-between text-left h-auto py-2 ${getPriorityColor(gap.priority)} hover:shadow-md ${selectedGap?.element === gap.element ? 'ring-2 ring-orange-500' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {filledGaps.has(gap.element) ? (
                        <Check className="w-3 h-3 text-green-600 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-orange-600 flex-shrink-0" />
                      )}
                      <span className="font-medium text-sm">{gap.element}</span>
                    </div>
                    <p className="text-xs text-gray-600 pl-5">{gap.reason}</p>
                  </div>
                  <ArrowRight className={`w-4 h-4 flex-shrink-0 ml-2 transition-transform ${selectedGap?.element === gap.element ? 'rotate-90' : ''}`} />
                </Button>

                {selectedGap?.element === gap.element && (
                  <div className="ml-6 p-3 bg-white rounded-lg border-2 border-orange-200 shadow-sm space-y-3">
                    {isGenerating ? (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating suggestions...
                      </div>
                    ) : suggestion ? (
                      <>
                        {suggestion.suggestions.map((sug, sidx) => (
                          <div key={sidx} className="space-y-2 pb-3 border-b last:border-b-0">
                            <div className="bg-blue-50 border border-blue-200 rounded p-2">
                              <p className="text-sm text-gray-800 italic">"{sug.text}"</p>
                            </div>
                            <p className="text-xs text-gray-600">{sug.rationale}</p>
                            <Button
                              size="sm"
                              onClick={() => handleApplySuggestion(sug.text)}
                              className="bg-green-600 hover:bg-green-700 w-full"
                            >
                              Add to Note
                            </Button>
                          </div>
                        ))}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {mediumGaps.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-yellow-700 uppercase">Medium Priority</p>
            {mediumGaps.map((gap, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                onClick={() => handleGapClick(gap)}
                className={`w-full justify-between text-left h-auto py-2 ${getPriorityColor(gap.priority)} hover:shadow-md`}
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{gap.element}</span>
                </div>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}