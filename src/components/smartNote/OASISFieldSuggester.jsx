import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardList, Plus, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function OASISFieldSuggester({ 
  visitType, 
  diagnosis, 
  noteContent,
  patientContext,
  onFieldsGenerated 
}) {
  const [loading, setLoading] = useState(false);
  const [suggestedFields, setSuggestedFields] = useState(null);

  useEffect(() => {
    if (visitType && diagnosis) {
      generateSuggestions();
    }
  }, [visitType, diagnosis]);

  const generateSuggestions = async () => {
    setLoading(true);
    try {
      const prompt = `Based on the following clinical information, suggest relevant OASIS and home health documentation fields that should be assessed and documented:

Visit Type: ${visitType}
Primary Diagnosis: ${diagnosis}
${patientContext ? `Patient History: ${JSON.stringify(patientContext, null, 2)}` : ''}
${noteContent ? `Current Note: ${noteContent.substring(0, 500)}` : ''}

Provide specific OASIS items and home health assessment fields that are:
1. Required for this visit type
2. Relevant to the diagnosis
3. Important for comprehensive assessment

Return JSON with suggested fields organized by category.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            oasis_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item_code: { type: "string" },
                  item_name: { type: "string" },
                  category: { type: "string" },
                  why_relevant: { type: "string" },
                  assessment_tips: { type: "string" }
                }
              }
            },
            clinical_assessments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  assessment_name: { type: "string" },
                  description: { type: "string" },
                  key_questions: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });

      setSuggestedFields(response);
      if (onFieldsGenerated) {
        onFieldsGenerated(response);
      }
    } catch (error) {
      console.error('Error generating OASIS suggestions:', error);
      toast.error('Failed to generate field suggestions');
    } finally {
      setLoading(false);
    }
  };

  const addFieldToNote = (field) => {
    const fieldTemplate = `\n\n${field.item_name} (${field.item_code}):\n- Assessment: \n- Findings: \n`;
    navigator.clipboard.writeText(fieldTemplate);
    toast.success('Field template copied to clipboard');
  };

  if (!visitType || !diagnosis) {
    return null;
  }

  return (
    <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-purple-600" />
            Suggested Assessment Fields
          </span>
          {!loading && suggestedFields && (
            <Button size="sm" variant="outline" onClick={generateSuggestions}>
              Refresh
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
            <span className="ml-2 text-sm text-slate-600">Analyzing visit requirements...</span>
          </div>
        ) : suggestedFields ? (
          <>
            {/* OASIS Items */}
            {suggestedFields.oasis_items?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 text-purple-900 dark:text-purple-300">
                  OASIS Items to Document
                </h4>
                <div className="space-y-2">
                  {suggestedFields.oasis_items.map((item, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-purple-200"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <Badge variant="outline" className="mb-1">{item.category}</Badge>
                          <h5 className="font-medium text-sm">
                            {item.item_name} <span className="text-xs text-slate-500">({item.item_code})</span>
                          </h5>
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => addFieldToNote(item)}
                          className="flex-shrink-0"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add
                        </Button>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
                        <strong>Why relevant:</strong> {item.why_relevant}
                      </p>
                      <p className="text-xs text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900 p-2 rounded">
                        💡 {item.assessment_tips}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical Assessments */}
            {suggestedFields.clinical_assessments?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2 text-purple-900 dark:text-purple-300">
                  Clinical Assessments Needed
                </h4>
                <div className="space-y-2">
                  {suggestedFields.clinical_assessments.map((assessment, idx) => (
                    <div 
                      key={idx} 
                      className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-purple-200"
                    >
                      <h5 className="font-medium text-sm mb-1">{assessment.assessment_name}</h5>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                        {assessment.description}
                      </p>
                      {assessment.key_questions?.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Key Questions:</p>
                          <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5 ml-4">
                            {assessment.key_questions.map((q, qIdx) => (
                              <li key={qIdx}>• {q}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4 text-sm text-slate-500">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-400" />
            Click to generate field suggestions
          </div>
        )}
      </CardContent>
    </Card>
  );
}