import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Copy,
  Lightbulb,
  BookOpen,
  AlertTriangle
} from "lucide-react";

export default function AIAuditSuggestions({ audit, _onApplySuggestion }) {
  const ai = useAICall();
  const [suggestions, setSuggestions] = useState(null);
  const [expandedIssues, setExpandedIssues] = useState(new Set());
  const [copiedIdx, setCopiedIdx] = useState(null);

  const generateSuggestions = async () => {
    if (!audit?.issues?.length) return;

    try {
      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `Analyze these compliance audit findings and provide specific, actionable improvement suggestions for each issue.

AUDIT DETAILS:
- Compliance Score: ${audit.compliance_score}%
- Status: ${audit.status}
- Nurse: ${audit.nurse_email}

FLAGGED ISSUES:
${audit.issues.map((issue, idx) => `
${idx + 1}. Element: ${issue.element || 'Unknown'}
   Severity: ${issue.severity || 'medium'}
   Problem: ${issue.problem || 'Not specified'}
`).join('\n')}

For each issue, provide:
1. Root cause analysis - why this documentation gap typically occurs
2. Specific corrective text - exact wording the nurse should use
3. Prevention tips - how to avoid this issue in future documentation
4. Training recommendation - specific skill area to focus on
5. Quick fix phrases - 2-3 ready-to-use documentation phrases

Be specific to home health/hospice Medicare documentation requirements.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_assessment: { type: "string" },
            priority_focus: { type: "string" },
            issue_suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue_index: { type: "number" },
                  category: { type: "string" },
                  root_cause: { type: "string" },
                  corrective_text: { type: "string" },
                  prevention_tips: { type: "array", items: { type: "string" } },
                  training_area: { type: "string" },
                  quick_phrases: { type: "array", items: { type: "string" } }
                }
              }
            },
            recommended_training_modules: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  module_name: { type: "string" },
                  priority: { type: "string" },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      });

      setSuggestions(result);
    } catch (error) {
      console.error("Error generating suggestions:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const toggleIssue = (idx) => {
    setExpandedIssues(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  if (!audit?.issues?.length) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4 text-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
          <p className="text-sm text-green-800">No issues found - documentation is compliant!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50 py-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-navy-600" />
            AI Improvement Suggestions
          </div>
          {!suggestions && (
            <Button
              size="sm"
              onClick={generateSuggestions}
              disabled={ai.loading}
              className="bg-navy-600 hover:bg-navy-700 h-7 text-xs"
            >
              {ai.loading ? (
                <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Analyzing...</>
              ) : (
                <><Sparkles className="w-3 h-3 mr-1" /> Generate Suggestions</>
              )}
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {ai.loading ? (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 animate-spin text-navy-600 mx-auto mb-2" />
            <p className="text-sm text-slate-600">Analyzing audit findings...</p>
          </div>
        ) : suggestions ? (
          <>
            {/* Overall Assessment */}
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-xs font-semibold text-blue-800 mb-1">Overall Assessment</p>
              <p className="text-sm text-blue-900">{suggestions.overall_assessment}</p>
              <p className="text-xs text-blue-700 mt-2">
                <strong>Priority Focus:</strong> {suggestions.priority_focus}
              </p>
            </div>

            {/* Issue-by-Issue Suggestions */}
            <div className="space-y-2">
              {audit.issues.map((issue, idx) => {
                const suggestion = suggestions.issue_suggestions?.find(s => s.issue_index === idx) || suggestions.issue_suggestions?.[idx];
                const isExpanded = expandedIssues.has(idx);

                return (
                  <Collapsible key={idx} open={isExpanded} onOpenChange={() => toggleIssue(idx)}>
                    <div className="border rounded-lg overflow-hidden">
                      <CollapsibleTrigger asChild>
                        <div className="p-3 bg-slate-50 cursor-pointer hover:bg-slate-100 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] ${getSeverityColor(issue.severity)}`}>
                              {issue.severity || 'medium'}
                            </Badge>
                            <span className="text-sm font-medium text-slate-900">
                              {issue.element || 'Documentation Issue'}
                            </span>
                            {suggestion?.category && (
                              <Badge variant="outline" className="text-[10px]">
                                {suggestion.category}
                              </Badge>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="p-3 space-y-3 border-t">
                          {/* Problem */}
                          <div className="bg-red-50 p-2 rounded">
                            <p className="text-xs font-semibold text-red-800">Problem:</p>
                            <p className="text-xs text-red-700">{issue.problem}</p>
                          </div>

                          {suggestion && (
                            <>
                              {/* Root Cause */}
                              <div className="bg-orange-50 p-2 rounded">
                                <p className="text-xs font-semibold text-orange-800 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Root Cause:
                                </p>
                                <p className="text-xs text-orange-700">{suggestion.root_cause}</p>
                              </div>

                              {/* Corrective Text */}
                              <div className="bg-green-50 p-2 rounded">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs font-semibold text-green-800 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> Suggested Text:
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 px-2"
                                    onClick={() => handleCopy(suggestion.corrective_text, idx)}
                                  >
                                    {copiedIdx === idx ? (
                                      <CheckCircle2 className="w-3 h-3 text-green-600" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </Button>
                                </div>
                                <p className="text-xs text-green-700 italic">"{suggestion.corrective_text}"</p>
                              </div>

                              {/* Quick Phrases */}
                              {suggestion.quick_phrases?.length > 0 && (
                                <div className="bg-navy-50 p-2 rounded">
                                  <p className="text-xs font-semibold text-navy-800 mb-1">Quick Phrases:</p>
                                  <div className="space-y-1">
                                    {suggestion.quick_phrases.map((phrase, pidx) => (
                                      <div key={pidx} className="flex items-center justify-between bg-white p-1.5 rounded text-xs">
                                        <span className="text-navy-700 italic">"{phrase}"</span>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-5 w-5 p-0"
                                          onClick={() => handleCopy(phrase, `${idx}-${pidx}`)}
                                        >
                                          <Copy className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Prevention Tips */}
                              {suggestion.prevention_tips?.length > 0 && (
                                <div className="bg-blue-50 p-2 rounded">
                                  <p className="text-xs font-semibold text-blue-800 flex items-center gap-1 mb-1">
                                    <Lightbulb className="w-3 h-3" /> Prevention Tips:
                                  </p>
                                  <ul className="space-y-0.5">
                                    {suggestion.prevention_tips.map((tip, tidx) => (
                                      <li key={tidx} className="text-xs text-blue-700">• {tip}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Training Area */}
                              {suggestion.training_area && (
                                <div className="flex items-center gap-2 text-xs">
                                  <BookOpen className="w-3 h-3 text-indigo-600" />
                                  <span className="text-slate-600">Recommended Training:</span>
                                  <Badge variant="outline" className="text-indigo-700">
                                    {suggestion.training_area}
                                  </Badge>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>

            {/* Recommended Training Modules */}
            {suggestions.recommended_training_modules?.length > 0 && (
              <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                <p className="text-xs font-semibold text-indigo-800 mb-2 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" /> Recommended Training Modules
                </p>
                <div className="space-y-2">
                  {suggestions.recommended_training_modules.map((module, idx) => (
                    <div key={idx} className="bg-white p-2 rounded flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-slate-900">{module.module_name}</p>
                        <p className="text-[10px] text-slate-600">{module.reason}</p>
                      </div>
                      <Badge className={`text-[10px] ${
                        module.priority === 'high' ? 'bg-red-100 text-red-800' :
                        module.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {module.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-slate-500">
              Click "Generate Suggestions" to get AI-powered improvement recommendations for each flagged issue.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}