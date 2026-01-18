import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle, CheckCircle2, FileSearch } from "lucide-react";
import { toast } from "sonner";

export default function DocumentationGapDetector({ 
  visitType,
  diagnosis,
  noteContent,
  vitalSigns,
  patientContext,
  onGapIdentified 
}) {
  const [loading, setLoading] = useState(false);
  const [gaps, setGaps] = useState(null);
  const [autoCheck, setAutoCheck] = useState(true);

  useEffect(() => {
    if (autoCheck && visitType && diagnosis && noteContent) {
      const debounce = setTimeout(() => {
        detectGaps();
      }, 2000);
      return () => clearTimeout(debounce);
    }
  }, [noteContent, visitType, diagnosis]);

  const detectGaps = async () => {
    if (!noteContent || !visitType) {
      return;
    }

    setLoading(true);
    try {
      const prompt = `Analyze the following clinical documentation for potential gaps and missing information:

Visit Type: ${visitType}
Diagnosis: ${diagnosis}
Current Documentation: ${noteContent}
${vitalSigns ? `Vital Signs: ${JSON.stringify(vitalSigns)}` : ''}
${patientContext ? `Patient Context: ${JSON.stringify(patientContext)}` : ''}

Identify:
1. Missing critical documentation elements required for this visit type
2. Incomplete assessments that need more detail
3. Missing follow-up information
4. Documentation that doesn't support medical necessity
5. OASIS items that may need to be addressed

For each gap, provide:
- What's missing
- Why it's important
- Severity (critical/high/medium/low)
- Specific questions to ask or information to collect`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_completeness: { type: "number" },
            gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  missing_element: { type: "string" },
                  importance: { type: "string" },
                  severity: { 
                    type: "string",
                    enum: ["critical", "high", "medium", "low"]
                  },
                  suggested_questions: {
                    type: "array",
                    items: { type: "string" }
                  },
                  example_documentation: { type: "string" }
                }
              }
            }
          }
        }
      });

      setGaps(response);
      if (onGapIdentified && response.gaps?.length > 0) {
        onGapIdentified(response.gaps);
      }
    } catch (error) {
      console.error('Error detecting gaps:', error);
    } finally {
      setLoading(false);
    }
  };

  const copySuggestedQuestions = (gap) => {
    const text = gap.suggested_questions?.join('\n- ') || '';
    navigator.clipboard.writeText(`Additional questions to address:\n- ${text}`);
    toast.success('Questions copied to clipboard');
  };

  if (!visitType || !diagnosis) {
    return null;
  }

  const criticalGaps = gaps?.gaps?.filter(g => g.severity === 'critical') || [];
  const highGaps = gaps?.gaps?.filter(g => g.severity === 'high') || [];

  return (
    <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-orange-600" />
            Documentation Gaps
            {gaps && (
              <Badge variant="outline">
                {gaps.overall_completeness}% Complete
              </Badge>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button 
              size="sm" 
              variant="ghost"
              onClick={() => setAutoCheck(!autoCheck)}
              className="text-xs"
            >
              Auto: {autoCheck ? 'ON' : 'OFF'}
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={detectGaps}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                'Check Gaps'
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-600" />
            <span className="ml-2 text-sm text-slate-600">Analyzing documentation...</span>
          </div>
        ) : gaps ? (
          <>
            {/* Overall Status */}
            <Alert className={
              gaps.overall_completeness >= 90 ? 'bg-green-50 border-green-200' :
              gaps.overall_completeness >= 70 ? 'bg-yellow-50 border-yellow-200' :
              'bg-red-50 border-red-200'
            }>
              <AlertDescription className="flex items-center gap-2">
                {gaps.overall_completeness >= 90 ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-green-800 font-medium">
                      Documentation is comprehensive!
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
                    <span className="text-orange-800 font-medium">
                      {gaps.gaps?.length || 0} gap(s) identified
                    </span>
                  </>
                )}
              </AlertDescription>
            </Alert>

            {/* Critical Gaps */}
            {criticalGaps.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-red-900 dark:text-red-300">
                  ⚠️ Critical Gaps ({criticalGaps.length})
                </h4>
                {criticalGaps.map((gap, idx) => (
                  <div 
                    key={idx} 
                    className="bg-red-50 dark:bg-red-950 p-3 rounded-lg border-l-4 border-red-600"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <Badge className="bg-red-600 text-white mb-1">{gap.category}</Badge>
                        <h5 className="font-medium text-sm text-red-900 dark:text-red-300">
                          {gap.missing_element}
                        </h5>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => copySuggestedQuestions(gap)}
                      >
                        Copy Questions
                      </Button>
                    </div>
                    <p className="text-xs text-red-800 dark:text-red-200 mb-2">
                      <strong>Why important:</strong> {gap.importance}
                    </p>
                    {gap.suggested_questions?.length > 0 && (
                      <div className="bg-white dark:bg-slate-900 p-2 rounded mb-2">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Questions to ask:
                        </p>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5 ml-4">
                          {gap.suggested_questions.map((q, qIdx) => (
                            <li key={qIdx}>• {q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {gap.example_documentation && (
                      <div className="bg-green-50 dark:bg-green-900 p-2 rounded">
                        <p className="text-xs font-medium text-green-900 dark:text-green-300 mb-1">
                          Example:
                        </p>
                        <p className="text-xs text-green-800 dark:text-green-200">
                          {gap.example_documentation}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* High Priority Gaps */}
            {highGaps.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-orange-900 dark:text-orange-300">
                  High Priority Gaps ({highGaps.length})
                </h4>
                {highGaps.map((gap, idx) => (
                  <div 
                    key={idx} 
                    className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-orange-200"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <Badge variant="outline" className="mb-1">{gap.category}</Badge>
                        <h5 className="font-medium text-sm">
                          {gap.missing_element}
                        </h5>
                      </div>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => copySuggestedQuestions(gap)}
                        className="text-xs"
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      {gap.importance}
                    </p>
                    {gap.suggested_questions?.length > 0 && (
                      <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5 ml-4">
                        {gap.suggested_questions.map((q, qIdx) => (
                          <li key={qIdx}>• {q}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {gaps.gaps?.length === 0 && (
              <div className="text-center py-6">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
                <p className="text-sm font-medium text-green-700">
                  No documentation gaps detected!
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Your documentation appears complete for this visit type.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-6">
            <FileSearch className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500 mb-3">
              Start typing your notes to check for documentation gaps
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}