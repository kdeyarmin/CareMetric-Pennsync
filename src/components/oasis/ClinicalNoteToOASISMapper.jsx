import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  Loader2,
  Copy,
  FileText
} from "lucide-react";

export default function ClinicalNoteToOASISMapper({ 
  onMappingComplete,
  autoMap = false,
  existingOASISData,
  extractedNarrative 
}) {
  const [clinicalNotes, setClinicalNotes] = useState("");
  const ai = useAICall();
  const [mappedFields, setMappedFields] = useState(null);

  const performMapping = useCallback(async () => {
    if (!clinicalNotes || clinicalNotes.length < 50) return;

    try {
      const prompt = `You are an expert OASIS clinician. Map clinical notes to specific OASIS M-items.

CLINICAL NOTES:
${clinicalNotes}

${existingOASISData ? `EXISTING OASIS DATA (for comparison):
${JSON.stringify(existingOASISData, null, 2)}` : ''}

TASK: Extract and map to OASIS fields. For each field identified:
1. M-item code
2. Recommended score/value
3. Supporting quote from notes
4. Confidence level
5. Additional documentation needed (if any)

Focus on:
- Functional items (M1800-M1860, GG items)
- Clinical items (wounds, dyspnea, pain)
- Cognitive/behavioral items
- Diagnoses and comorbidities
- Episode timing indicators`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            mapped_fields: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  m_item_code: { type: "string" },
                  m_item_name: { type: "string" },
                  recommended_value: { type: "string" },
                  current_value: { type: "string" },
                  supporting_quote: { type: "string" },
                  confidence: { type: "number" },
                  rationale: { type: "string" },
                  additional_documentation_needed: { type: "string" },
                  revenue_impact: { 
                    type: "string",
                    enum: ["high", "medium", "low", "none"]
                  }
                }
              }
            },
            missing_critical_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  m_item_code: { type: "string" },
                  m_item_name: { type: "string" },
                  why_important: { type: "string" },
                  suggested_assessment_question: { type: "string" }
                }
              }
            },
            documentation_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  what_is_missing: { type: "string" },
                  suggested_addition: { type: "string" }
                }
              }
            },
            overall_completeness: { type: "number" }
          }
        }
      });

      setMappedFields(result);
      if (onMappingComplete) {
        onMappingComplete(result);
      }
    } catch (error) {
      console.error('Mapping error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [clinicalNotes, existingOASISData, onMappingComplete]);

  // Auto-populate with extracted narrative from OASIS
  useEffect(() => {
    if (extractedNarrative && !clinicalNotes) {
      setClinicalNotes(extractedNarrative);
    }
  }, [extractedNarrative, clinicalNotes]);

  useEffect(() => {
    if (autoMap && clinicalNotes.length > 100) {
      performMapping();
    }
  }, [autoMap, clinicalNotes, performMapping]);

  const handleCopyValue = (value) => {
    navigator.clipboard.writeText(value);
  };

  return (
    <Card className="border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-navy-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          Clinical Note → OASIS Mapper
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block flex items-center justify-between">
            <span>Paste Clinical Notes</span>
            {extractedNarrative && (
              <Badge variant="outline" className="text-xs">
                <Sparkles className="w-3 h-3 mr-1" />
                Auto-filled from OASIS
              </Badge>
            )}
          </label>
          <Textarea
            value={clinicalNotes}
            onChange={(e) => setClinicalNotes(e.target.value)}
            placeholder="Paste clinical notes, visit documentation, or assessment narrative here..."
            rows={6}
            className="font-mono text-sm"
          />
          <p className="text-xs text-slate-500 mt-1">
            {clinicalNotes.length} characters
            {extractedNarrative && ' • Narrative extracted from uploaded OASIS'}
          </p>
        </div>

        <Button
          onClick={performMapping}
          disabled={ai.loading || clinicalNotes.length < 50}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {ai.loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Mapping to OASIS...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Map to OASIS Fields
            </>
          )}
        </Button>

        {mappedFields && (
          <div className="space-y-4">
            <div className="bg-blue-100 p-3 rounded-lg border border-blue-300">
              <p className="text-sm font-semibold text-blue-900">
                Overall Completeness: {mappedFields.overall_completeness}%
              </p>
              <p className="text-xs text-blue-700 mt-1">
                {mappedFields.mapped_fields?.length || 0} fields mapped from clinical notes
              </p>
            </div>

            {mappedFields.mapped_fields?.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Mapped OASIS Fields ({mappedFields.mapped_fields.length})
                </h4>
                <ScrollArea className="max-h-96">
                  <div className="space-y-2">
                    {mappedFields.mapped_fields.map((field, idx) => (
                      <div key={idx} className="bg-white p-3 rounded-lg border">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {field.m_item_code}
                            </Badge>
                            <span className="font-semibold text-sm">{field.m_item_name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={
                              field.confidence >= 85 ? 'bg-green-100 text-green-800' :
                              field.confidence >= 70 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-orange-100 text-orange-800'
                            }>
                              {field.confidence}% confidence
                            </Badge>
                            {field.revenue_impact !== 'none' && field.revenue_impact !== 'low' && (
                              <Badge className="bg-green-600 text-white">
                                💰 {field.revenue_impact}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {field.current_value && (
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div className="bg-red-50 p-2 rounded text-xs">
                              <p className="text-red-600 font-medium">Current:</p>
                              <p className="text-red-800">{field.current_value}</p>
                            </div>
                            <div className="bg-green-50 p-2 rounded text-xs">
                              <p className="text-green-600 font-medium">From Notes:</p>
                              <p className="text-green-800 flex items-center gap-1">
                                {field.recommended_value}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 w-5 p-0"
                                  onClick={() => handleCopyValue(field.recommended_value)}
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </p>
                            </div>
                          </div>
                        )}

                        {!field.current_value && (
                          <div className="bg-green-50 p-2 rounded mb-2">
                            <p className="text-xs text-green-600 font-medium">Recommended Value:</p>
                            <p className="text-sm text-green-800 flex items-center gap-2">
                              {field.recommended_value}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => handleCopyValue(field.recommended_value)}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </p>
                          </div>
                        )}

                        <div className="bg-blue-50 p-2 rounded mb-2 text-xs">
                          <p className="text-blue-600 font-medium mb-1">Supporting Quote:</p>
                          <p className="text-blue-900 italic">"{field.supporting_quote}"</p>
                        </div>

                        <p className="text-xs text-slate-700 mb-2">{field.rationale}</p>

                        {field.additional_documentation_needed && (
                          <div className="bg-yellow-50 p-2 rounded text-xs border border-yellow-200">
                            <p className="text-yellow-700">
                              <strong>Additional Documentation:</strong> {field.additional_documentation_needed}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {mappedFields.missing_critical_items?.length > 0 && (
              <div className="bg-orange-50 p-3 rounded-lg border border-orange-300">
                <h4 className="font-semibold text-orange-900 mb-2">
                  Missing Critical Items ({mappedFields.missing_critical_items.length})
                </h4>
                <div className="space-y-2">
                  {mappedFields.missing_critical_items.map((item, idx) => (
                    <div key={idx} className="bg-white p-2 rounded text-sm">
                      <p className="font-medium text-orange-800">
                        {item.m_item_code}: {item.m_item_name}
                      </p>
                      <p className="text-xs text-slate-700 mt-1">{item.why_important}</p>
                      <p className="text-xs text-blue-700 mt-1 italic">
                        Ask: "{item.suggested_assessment_question}"
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mappedFields.documentation_gaps?.length > 0 && (
              <div className="bg-red-50 p-3 rounded-lg border border-red-300">
                <h4 className="font-semibold text-red-900 mb-2">
                  Documentation Gaps ({mappedFields.documentation_gaps.length})
                </h4>
                <div className="space-y-2">
                  {mappedFields.documentation_gaps.map((gap, idx) => (
                    <div key={idx} className="bg-white p-2 rounded text-sm">
                      <p className="font-medium text-red-800">{gap.area}</p>
                      <p className="text-xs text-slate-700 mt-1">Missing: {gap.what_is_missing}</p>
                      <div className="bg-green-50 p-2 rounded mt-2 text-xs">
                        <p className="text-green-700">
                          <strong>Add:</strong> {gap.suggested_addition}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}