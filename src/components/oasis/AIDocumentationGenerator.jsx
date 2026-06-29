import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Loader2,
  FileText,
  Copy,
  CheckCircle2,
  Edit3,
  Sparkles,
  RefreshCw,
  ChevronDown
} from "lucide-react";

export default function AIDocumentationGenerator({ analysisResults, pdgmData, navigationData }) {
  const ai = useAICall();
  const [suggestions, setSuggestions] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedTexts, setEditedTexts] = useState({});
  const [copiedIndices, setCopiedIndices] = useState(new Set());

  const generateDocumentation = async () => {
    if (!analysisResults && !navigationData) return;

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert clinical documentation specialist for home health OASIS assessments. Generate concise, clinically appropriate documentation text snippets to address identified issues.

ANALYSIS RESULTS:
${JSON.stringify({
  accuracy_issues: analysisResults?.accuracy_issues?.slice(0, 5),
  compliance_concerns: analysisResults?.compliance_concerns?.slice(0, 5),
  specific_rescore_opportunities: analysisResults?.specific_rescore_opportunities?.slice(0, 5),
  missing_high_value_documentation: analysisResults?.missing_high_value_documentation?.slice(0, 5)
}, null, 2)}

PDGM DATA:
${JSON.stringify({
  primary_diagnosis: pdgmData?.primary_diagnosis,
  functional_scores: pdgmData?.functional_scores,
  comorbidities: pdgmData?.comorbidities
}, null, 2)}

NAVIGATION DISCREPANCIES:
${JSON.stringify(navigationData?.discrepancies?.slice(0, 5) || [], null, 2)}

Generate documentation snippets that:
1. Are clinically accurate and specific
2. Support M-item scoring with observable evidence
3. Use proper medical terminology
4. Follow Medicare documentation guidelines
5. Are ready to copy/paste into clinical notes
6. Include measurements, timeframes, and patient responses where appropriate

For each suggestion, provide:
- The specific M-item or area being addressed
- Why documentation is needed
- Draft text (2-4 sentences) ready to use
- Key elements that must be included
- Alternative phrasings if applicable

Return JSON:
{
  "suggestions": [
    {
      "category": "functional_status/diagnosis/comorbidity/compliance/other",
      "m_item": "M-item code if applicable",
      "title": "What this addresses",
      "reason": "Why this documentation is needed",
      "priority": "high/medium/low",
      "draft_text": "Complete documentation text ready to use",
      "key_elements": ["element 1", "element 2"],
      "alternative_text": "Optional alternative phrasing",
      "usage_tip": "Brief tip on when/how to use this",
      "compliance_note": "Any compliance considerations"
    }
  ],
  "general_tips": [
    "General documentation improvement tips"
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  m_item: { type: "string" },
                  title: { type: "string" },
                  reason: { type: "string" },
                  priority: { type: "string" },
                  draft_text: { type: "string" },
                  key_elements: { type: "array", items: { type: "string" } },
                  alternative_text: { type: "string" },
                  usage_tip: { type: "string" },
                  compliance_note: { type: "string" }
                }
              }
            },
            general_tips: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSuggestions(result);
      setEditedTexts({});
      setCopiedIndices(new Set());
    } catch (err) {
      console.error("Documentation generation error:", err);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleCopy = (index, text) => {
    navigator.clipboard.writeText(text);
    setCopiedIndices(new Set([...copiedIndices, index]));
    setTimeout(() => {
      setCopiedIndices(prev => {
        const newSet = new Set(prev);
        newSet.delete(index);
        return newSet;
      });
    }, 2000);
  };

  const handleEdit = (index, text) => {
    setEditingIndex(index);
    setEditedTexts({ ...editedTexts, [index]: text });
  };

  const handleSaveEdit = (_index) => {
    setEditingIndex(null);
  };

  const getCategoryColor = (category) => {
    const colors = {
      functional_status: 'bg-navy-100 text-navy-800',
      diagnosis: 'bg-blue-100 text-blue-800',
      comorbidity: 'bg-green-100 text-green-800',
      compliance: 'bg-orange-100 text-orange-800',
      other: 'bg-slate-100 text-slate-800'
    };
    return colors[category] || colors.other;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: 'bg-red-600 text-white',
      medium: 'bg-yellow-500 text-white',
      low: 'bg-blue-500 text-white'
    };
    return colors[priority] || colors.medium;
  };

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          AI Documentation Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!suggestions ? (
          <>
            <p className="text-sm text-slate-600">
              Generate AI-powered documentation snippets to address identified issues and improve OASIS scoring.
            </p>
            <Button
              onClick={generateDocumentation}
              disabled={ai.loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Documentation...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Documentation Snippets
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs">
                {suggestions.suggestions?.length || 0} suggestions generated
              </Badge>
              <Button
                onClick={generateDocumentation}
                disabled={ai.loading}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="w-3 h-3 mr-2" />
                Regenerate
              </Button>
            </div>

            {/* Suggestions Accordion */}
            <Accordion type="multiple" className="space-y-2">
              {suggestions.suggestions?.map((suggestion, idx) => {
                const currentText = editedTexts[idx] !== undefined 
                  ? editedTexts[idx] 
                  : suggestion.draft_text;
                const isCopied = copiedIndices.has(idx);

                return (
                  <AccordionItem key={idx} value={`item-${idx}`} className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getCategoryColor(suggestion.category)}>
                          {(suggestion.category || '').replace('_', ' ')}
                        </Badge>
                        {suggestion.m_item && (
                          <Badge variant="outline" className="font-mono text-xs">
                            {suggestion.m_item}
                          </Badge>
                        )}
                        <span className="text-sm font-medium text-slate-900">{suggestion.title}</span>
                        <Badge className={`ml-auto ${getPriorityColor(suggestion.priority)}`}>
                          {suggestion.priority}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-3">
                        {/* Reason */}
                        <div className="bg-blue-50 p-3 rounded border border-blue-200 text-sm">
                          <p className="text-blue-800">
                            <strong className="text-blue-900">Why needed:</strong> {suggestion.reason}
                          </p>
                        </div>

                        {/* Draft Text */}
                        <div className="bg-white border-2 border-indigo-200 rounded-lg overflow-hidden">
                          <div className="bg-indigo-50 px-3 py-2 flex items-center justify-between border-b border-indigo-200">
                            <span className="text-xs font-medium text-indigo-800 flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              Draft Documentation
                            </span>
                            <div className="flex items-center gap-2">
                              {editingIndex !== idx && (
                                <Button
                                  onClick={() => handleEdit(idx, currentText)}
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                >
                                  <Edit3 className="w-3 h-3 mr-1" />
                                  Edit
                                </Button>
                              )}
                              <Button
                                onClick={() => handleCopy(idx, currentText)}
                                size="sm"
                                variant={isCopied ? "default" : "ghost"}
                                className={`h-6 px-2 text-xs ${isCopied ? 'bg-green-600 hover:bg-green-700' : ''}`}
                              >
                                {isCopied ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    Copied!
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3 mr-1" />
                                    Copy
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                          <div className="p-3">
                            {editingIndex === idx ? (
                              <>
                                <Textarea
                                  value={currentText}
                                  onChange={(e) => setEditedTexts({ ...editedTexts, [idx]: e.target.value })}
                                  className="min-h-[100px] text-sm"
                                />
                                <div className="flex gap-2 mt-2">
                                  <Button
                                    onClick={() => handleSaveEdit(idx)}
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700"
                                  >
                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                    Save Changes
                                  </Button>
                                  <Button
                                    onClick={() => {
                                      setEditingIndex(null);
                                      const newEdited = { ...editedTexts };
                                      delete newEdited[idx];
                                      setEditedTexts(newEdited);
                                    }}
                                    size="sm"
                                    variant="outline"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <p className="text-sm text-slate-800 leading-relaxed">
                                {currentText}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Alternative Text */}
                        {suggestion.alternative_text && (
                          <details className="bg-slate-50 p-3 rounded border">
                            <summary className="text-xs font-medium text-slate-700 cursor-pointer flex items-center gap-1">
                              <ChevronDown className="w-3 h-3" />
                              Alternative Phrasing
                            </summary>
                            <p className="text-sm text-slate-600 mt-2 pl-4">
                              {suggestion.alternative_text}
                            </p>
                          </details>
                        )}

                        {/* Key Elements */}
                        {suggestion.key_elements?.length > 0 && (
                          <div className="bg-green-50 p-3 rounded border border-green-200">
                            <p className="text-xs font-medium text-green-800 mb-2">Key Elements to Include:</p>
                            <ul className="text-xs text-green-700 space-y-1">
                              {suggestion.key_elements.map((element, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <span className="text-green-600">✓</span> {element}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Usage Tip */}
                        {suggestion.usage_tip && (
                          <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-xs">
                            <span className="font-medium text-yellow-800">💡 Tip:</span>{' '}
                            <span className="text-yellow-700">{suggestion.usage_tip}</span>
                          </div>
                        )}

                        {/* Compliance Note */}
                        {suggestion.compliance_note && (
                          <div className="bg-orange-50 p-2 rounded border border-orange-200 text-xs">
                            <span className="font-medium text-orange-800">⚠️ Compliance:</span>{' '}
                            <span className="text-orange-700">{suggestion.compliance_note}</span>
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>

            {/* General Tips */}
            {suggestions.general_tips?.length > 0 && (
              <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                <p className="text-sm font-semibold text-indigo-900 mb-2">General Documentation Tips</p>
                <ul className="text-xs text-indigo-700 space-y-1">
                  {suggestions.general_tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-indigo-600">•</span> {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}